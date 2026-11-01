import assert from 'node:assert/strict';
import test from 'node:test';
import * as client from '../dist/client.js';

test('client entry exposes parser-free state selection and wire readers', () => {
  assert.equal(typeof client.fromSSE, 'function');
  assert.equal(typeof client.fromNDJSON, 'function');
  assert.equal(typeof client.parsePatchBatch, 'function');
  assert.equal(typeof client.select, 'function');
  assert.equal('StreamNormalizer' in client, false);
});

const frame = (
  sequence: number,
  patches: client.StreamPatch[] = [],
  state: client.WireBatch['state'] = 'streaming',
): client.WireBatch => ({ format: 'json', sequence, patches, state });
const encode = new TextEncoder();
function stream(text: string, oneByte = false, cancelled?: () => void) {
  const data = encode.encode(text);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === data.length) {
        controller.close();
        return;
      }
      const next = oneByte ? offset + 1 : data.length;
      controller.enqueue(data.slice(offset, next));
      offset = next;
    },
    cancel: cancelled,
  });
}
async function collect<T>(source: AsyncIterable<T>) {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}
const done = frame(2, [{ op: 'status', path: '', value: 'complete' }], 'complete');
const first = frame(1, [
  { op: 'set', path: '', value: { name: '海🌊' } },
  { op: 'status', path: '/name', value: 'partial' },
]);
const ndjson = (frames: client.WireBatch[]) =>
  frames.map((value) => JSON.stringify(value)).join('\n');
const sse = (text: string) =>
  new Response(stream(text, true), {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  });

test('NDJSON decodes one-byte UTF-8 chunks, BOM, CRLF and a final line without newline', async () => {
  const frames = await collect(
    client.fromNDJSON(stream('\ufeff' + ndjson([first, done]).replaceAll('\n', '\r\n'), true)),
  );
  const state = client.createPatchState<{ name: string }>();
  frames.forEach((value) => client.applyPatchBatch(state, value));
  assert.deepEqual(state.data, { name: '海🌊' });
  assert.equal(client.select(state, '/name', { require: 'complete' }).status, 'complete');
});

test('SSE accepts comments, CRLF, multiline data and default event types, resetting named events', async () => {
  const text =
    ':heartbeat\r\nevent: unrelated\r\ndata: ignore\r\n\r\nid: 1\r\nevent: patch\r\ndata: ' +
    JSON.stringify(first) +
    '\r\n\r\ndata: {\r\ndata: ' +
    JSON.stringify(done).slice(1) +
    '\r\n\r\n';
  assert.deepEqual(await collect(client.fromSSE(sse(text))), [first, done]);
});

test('resume expects the next sequence and rejects duplicates, gaps, changing format and mismatched SSE ids', async () => {
  const resumed = frame(9, [], 'complete');
  assert.deepEqual(
    await collect(client.fromNDJSON(stream(JSON.stringify(resumed)), { afterSequence: 8 })),
    [resumed],
  );
  for (const frames of [
    [first, first],
    [first, frame(3)],
    [first, { ...done, format: 'jsonl' as const }],
  ]) {
    await assert.rejects(
      collect(client.fromNDJSON(stream(ndjson(frames)))),
      client.WireProtocolError,
    );
  }
  await assert.rejects(
    collect(client.fromSSE(sse('id: 9\ndata: ' + JSON.stringify(first) + '\n\n'))),
    /id.*sequence/i,
  );
});

test('EOF never turns unfinished transport or an unterminated SSE event into completion', async () => {
  for (const text of ['', JSON.stringify(first)])
    await assert.rejects(collect(client.fromNDJSON(stream(text))), /terminal/i);
  await assert.rejects(
    collect(client.fromSSE(sse('data: ' + JSON.stringify({ ...first, state: 'complete' }) + '\n'))),
    /terminal/i,
  );
  await assert.rejects(collect(client.fromSSE(sse('data: [DONE]\n\n'))), /JSON|frame/i);
});

test('HTTP, MIME and named SSE errors are explicit and release response bodies', async () => {
  for (const response of [
    new Response('denied', { status: 401 }),
    new Response('wrong'),
    new Response(null, { headers: { 'content-type': 'text/event-stream' } }),
  ]) {
    await assert.rejects(collect(client.fromSSE(response)), client.WireProtocolError);
  }
  await assert.rejects(collect(client.fromSSE(sse('event: error\ndata: offline\n\n'))), /offline/);
});

test('terminal error is a frame retaining already received data, not a successful completion', async () => {
  const failure = { ...frame(2, [], 'error'), error: 'upstream failed' };
  const state = client.createPatchState();
  for await (const value of client.fromNDJSON(stream(ndjson([first, failure]))))
    client.applyPatchBatch(state, value);
  assert.deepEqual(state.data, { name: '海🌊' });
  assert.equal(state.state, 'error');
  assert.equal(state.error, 'upstream failed');
});

test('bounded frames, depth, patch count and pointers reject runaway input', async () => {
  await assert.rejects(
    collect(client.fromNDJSON(stream(' '.repeat(100)), { maxFrameLength: 16 })),
    /maxFrameLength/i,
  );
  const oversized = frame(1, [{ op: 'set', path: '', value: { a: { b: { c: 1 } } } }]);
  assert.throws(() => client.parsePatchBatch(oversized, { maxDepth: 1 }), /maxDepth/i);
  assert.throws(() => client.parsePatchBatch(first, { maxPatches: 1 }), /patches/i);
  assert.throws(() => client.parsePatchBatch(first, { maxPathLength: 2 }), /Path/i);
  await assert.rejects(
    collect(client.fromSSE(sse('data: ' + ' '.repeat(200) + '\n\n'), { maxFrameLength: 16 })),
    /maxFrameLength/i,
  );
});

test('unknown op, version, key, lossy JSON and invalid status/error shapes are rejected', () => {
  const values: unknown[] = [
    { ...first, protocol: 2 },
    { ...first, extra: true },
    { ...first, state: 'done' },
    { ...first, patches: [{ op: 'move', path: '' }] },
    { ...first, patches: [{ op: 'status', path: '', value: 'ready' }] },
    { ...first, patches: [{ op: 'set', path: '', value: undefined }] },
    { ...first, patches: [{ op: 'set', path: '', value: NaN }] },
    { ...first, patches: [{ op: 'set', path: '', value: new Date() }] },
    { ...first, error: 'not terminal' },
    { ...first, state: 'error' },
    { ...first, patches: [{ op: 'remove', path: '', value: 'extra' }] },
  ];
  for (const value of values)
    assert.throws(() => client.parsePatchBatch(value), client.WireProtocolError);
});

test('invalid UTF-8 and frame parse failures cancel input; cleanup rejection never replaces the original error', async () => {
  let cancelled = false;
  const invalid = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([0xff]));
    },
    cancel() {
      cancelled = true;
      throw new Error('cleanup');
    },
  });
  await assert.rejects(collect(client.fromNDJSON(invalid)), /UTF-8/i);
  assert.ok(cancelled);
  let stopped = false;
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encode.encode(JSON.stringify(first) + '\n'));
    },
    cancel() {
      stopped = true;
    },
  });
  for await (const _ of client.fromNDJSON(source)) break;
  assert.ok(stopped);
});

test('abort unblocks a pending read and cancels the body', async () => {
  let cancelled = false;
  const abort = new AbortController();
  const source = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  const reading = client.fromNDJSON(source, { signal: abort.signal }).next();
  abort.abort(new Error('stop now'));
  await assert.rejects(reading, /stop now/);
  assert.ok(cancelled);
});

test('atomic apply rejects malformed targets without changing earlier values or metadata', () => {
  const state = client.createPatchState();
  client.applyPatchBatch(state, first);
  const original = structuredClone(state);
  assert.throws(
    () =>
      client.applyPatchBatch(
        state,
        frame(2, [
          { op: 'set', path: '/name', value: 'changed' },
          { op: 'append', path: '/missing', value: 'bad' },
        ]),
      ),
    client.WireProtocolError,
  );
  assert.deepEqual(state, original);
  assert.throws(
    () =>
      client.applyPatchBatch(
        state,
        frame(2, [{ op: 'set', path: '/missing/child', value: 'bad' }]),
      ),
    client.WireProtocolError,
  );
  assert.deepEqual(state, original);
});

test('atomic apply preserves unchanged subtree identity and safely handles prototype keys', () => {
  const state = client.createPatchState();
  client.applyPatchBatch(
    state,
    frame(1, [
      {
        op: 'set',
        path: '',
        value: JSON.parse('{"__proto__":{"safe":1},"items":["A"],"unchanged":{"x":1}}'),
      },
    ]),
  );
  const before = state.data as { unchanged: unknown; items: string[] };
  const unchanged = before.unchanged;
  client.applyPatchBatch(
    state,
    frame(2, [
      { op: 'append', path: '/items/0', value: 'B' },
      { op: 'set', path: '/__proto__/safe', value: 2 },
    ]),
  );
  assert.equal((state.data as typeof before).unchanged, unchanged);
  assert.equal(before.items[0], 'A');
  assert.equal(Object.hasOwn(state.data as object, '__proto__'), true);
  assert.equal(({} as Record<string, unknown>).safe, undefined);
});

test('path issues remain distinct from syntactic completion and retain siblings', () => {
  const state = client.createPatchState();
  client.applyPatchBatch(state, first);
  client.applyPatchBatch(state, {
    ...done,
    issues: [{ path: '/score', code: 'schema', message: 'Expected number' }],
  });
  assert.equal(state.state, 'complete');
  assert.equal(state.issues?.[0]?.path, '/score');
  assert.deepEqual(state.data, { name: '海🌊' });
  assert.throws(() => client.applyPatchBatch(state, frame(3)), /terminal/i);
});

test('sparse array expansion and non-enumerable serialization traps are rejected', () => {
  const state = client.createPatchState();
  client.applyPatchBatch(state, frame(1, [{ op: 'set', path: '', value: [] }]));
  assert.throws(
    () =>
      client.applyPatchBatch(state, frame(2, [{ op: 'set', path: '/4294967294', value: 'large' }])),
    client.WireProtocolError,
  );
  assert.deepEqual(state.data, []);
  const trapped = { ...first };
  Object.defineProperty(trapped, 'toJSON', { value: () => ({}), enumerable: false });
  assert.throws(() => client.parsePatchBatch(trapped), client.WireProtocolError);
});

test('terminal completion and HTTP rejection never wait for uncooperative cancel cleanup', async () => {
  async function promptly<T>(value: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        value,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('cancel blocked completion')), 200);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  const uncooperative = () =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encode.encode(JSON.stringify({ ...first, state: 'complete' }) + '\n'));
      },
      cancel() {
        return new Promise<void>(() => {});
      },
    });
  const reader = client.fromNDJSON(uncooperative());
  assert.equal((await reader.next()).value?.state, 'complete');
  assert.equal((await promptly(reader.next())).done, true);
  await assert.rejects(
    promptly(collect(client.fromSSE(new Response(uncooperative())))),
    /text\/event-stream/,
  );
});

test('trailing invalid UTF-8 cannot undo a terminal frame at any transport byte split', async () => {
  const terminal = { ...first, state: 'complete' as const };
  for (const transport of ['ndjson', 'sse'] as const) {
    const text =
      transport === 'ndjson'
        ? JSON.stringify(terminal) + '\n'
        : 'data: ' + JSON.stringify(terminal) + '\n\n';
    const data = new Uint8Array([...encode.encode(text), 0xff]);
    for (let split = 0; split <= data.length; split++) {
      const source = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(data.slice(0, split));
          controller.enqueue(data.slice(split));
          controller.close();
        },
      });
      const frames =
        transport === 'ndjson'
          ? client.fromNDJSON(source)
          : client.fromSSE(
              new Response(source, { headers: { 'content-type': 'text/event-stream' } }),
            );
      assert.deepEqual(await collect(frames), [terminal], `${transport} split ${split}`);
    }
  }
});

test('a malformed UTF-8 suffix preserves earlier complete frames in the same network chunk', async () => {
  const data = new Uint8Array([...encode.encode(JSON.stringify(first) + '\n'), 0xff]);
  const reader = client.fromNDJSON(
    new ReadableStream({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      },
    }),
  );
  assert.deepEqual((await reader.next()).value, first);
  await assert.rejects(reader.next(), /UTF-8/);
});

test('depth limits cover paths plus subtree depth across incremental frames', () => {
  const state = client.createPatchState();
  client.applyPatchBatch(state, frame(1, [{ op: 'set', path: '', value: {} }]), { maxDepth: 1 });
  assert.throws(
    () =>
      client.applyPatchBatch(state, frame(2, [{ op: 'set', path: '/nested', value: {} }]), {
        maxDepth: 1,
      }),
    /depth/i,
  );
  assert.throws(
    () =>
      client.parsePatchBatch(frame(2, [{ op: 'status', path: '/a/b', value: 'partial' }]), {
        maxDepth: 1,
      }),
    /depth/i,
  );
  assert.deepEqual(state.data, {});
});

test('a terminal complete frame requires document data', () => {
  const state = client.createPatchState();
  assert.throws(
    () => client.applyPatchBatch(state, frame(1, [], 'complete')),
    client.WireProtocolError,
  );
  assert.equal(state.sequence, 0);
});

test('abort stops buffered frames even when they arrived in the same byte chunk', async () => {
  for (const transport of ['ndjson', 'sse'] as const) {
    const abort = new AbortController();
    const text =
      transport === 'ndjson'
        ? ndjson([first, done]) + '\n'
        : [first, done].map((value) => 'data: ' + JSON.stringify(value) + '\n\n').join('');
    const source = stream(text);
    const events =
      transport === 'ndjson'
        ? client.fromNDJSON(source, { signal: abort.signal })
        : client.fromSSE(
            new Response(source, { headers: { 'content-type': 'text/event-stream' } }),
            { signal: abort.signal },
          );
    assert.equal((await events.next()).value?.sequence, 1);
    abort.abort(new Error('stop buffered frames'));
    await assert.rejects(events.next(), /stop buffered frames/);
  }
});
