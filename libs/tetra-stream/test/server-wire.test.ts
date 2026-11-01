import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPatchBatch, createPatchState } from '../dist/index.js';
import {
  toEventStream,
  toSSE,
  toNDJSON,
  eventStreamResponse,
  ndjsonResponse,
} from '../dist/server.js';
import * as client from '../dist/client.js';
import type { WireBatch } from '../dist/client.js';

async function collect<T>(source: AsyncIterable<T> | Iterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of source) result.push(value);
  return result;
}
const frame = (sequence = 1, state: WireBatch['state'] = 'complete'): WireBatch => ({
  format: 'json',
  sequence,
  patches: [],
  state,
});
async function text(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

test('server normalizes incremental chunks with first-frame protocol/schema and final metadata', async () => {
  const batches = await collect(
    toEventStream(['{"name":"海', '🌊","count":2}'], {
      schema: { type: 'object' },
      metadata: { request: 'r1' },
    }),
  );
  assert.equal(batches.length, 3);
  assert.equal(batches[0].protocol, 1);
  assert.deepEqual(batches[0].schema, { type: 'object' });
  assert.equal(batches[1].protocol, undefined);
  assert.equal(batches[1].schema, undefined);
  assert.deepEqual(batches.at(-1)?.metadata, { request: 'r1' });
  assert.equal(batches.at(-1)?.state, 'complete');
  const state = createPatchState();
  batches.forEach((batch) => applyPatchBatch(state, batch));
  assert.deepEqual(state.data, { name: '海🌊', count: 2 });
});

test('syntax errors drain valid mutations in the failing chunk and produce exactly one terminal error', async () => {
  const batches = await collect(toEventStream(['{"good":"ok", "bad": !', 'ignored']));
  assert.equal(batches.length, 1);
  assert.equal(batches[0].state, 'error');
  assert.match(batches[0].error!, /./u);
  const state = createPatchState();
  applyPatchBatch(state, batches[0]);
  assert.equal((state.data as { good: string }).good, 'ok');
});

test('source failure preserves partial data and has one terminal frame', async () => {
  async function* source() {
    yield '{"message":"hello';
    throw new Error('upstream failed');
  }
  const batches = await collect(toEventStream(source()));
  assert.deepEqual(
    batches.map((batch) => batch.state),
    ['streaming', 'error'],
  );
  assert.equal(batches[1].error, 'upstream failed');
  const state = createPatchState();
  batches.forEach((batch) => applyPatchBatch(state, batch));
  assert.deepEqual(state.data, { message: 'hello' });
});

test('schema issues use escaped pointers and preserve syntax completion and raw validator input', async () => {
  const batches = await collect(
    toEventStream(['{"a/b~c":3}'], {
      validator: {
        '~standard': {
          version: 1,
          vendor: 'test',
          validate(value) {
            (value as Record<string, unknown>)['a/b~c'] = 99;
            return { issues: [{ path: [{ key: 'a/b~c' }], message: 'Expected a string' }] };
          },
        },
      },
    }),
  );
  assert.equal(batches.at(-1)?.state, 'complete');
  assert.deepEqual(batches.at(-1)?.issues, [
    { path: '/a~1b~0c', code: 'schema', message: 'Expected a string' },
  ]);
  const state = createPatchState();
  batches.forEach((batch) => applyPatchBatch(state, batch));
  assert.deepEqual(state.data, { 'a/b~c': 3 });
});

test('validator rejection becomes a terminal error without a preceding complete frame', async () => {
  const batches = await collect(
    toEventStream(['{"x":1}'], {
      validator: {
        '~standard': {
          version: 1,
          vendor: 'test',
          validate: async () => {
            throw new Error('validator broke');
          },
        },
      },
    }),
  );
  assert.deepEqual(
    batches.map((batch) => batch.state),
    ['streaming', 'error'],
  );
  assert.equal(batches.at(-1)?.sequence, 2);
  assert.equal(batches.at(-1)?.error, 'validator broke');
});

test('unsupported formats and invalid limits/options fail before pulling the source', async () => {
  let pulls = 0;
  async function* source() {
    pulls++;
    yield '{}';
  }
  await assert.rejects(toEventStream(source(), { format: 'xml' as never }).next());
  await assert.rejects(toEventStream(source(), { maxDepth: 0 }).next());
  await assert.rejects(toEventStream(source(), { metadata: { bad: undefined } as never }).next());
  await assert.rejects(toEventStream(source(), { validator: {} as never }).next());
  assert.equal(pulls, 0);
});

test('SSE and NDJSON encoders retain Unicode and exact envelope framing', async () => {
  const batch = { ...frame(5), patches: [{ op: 'set', path: '', value: '海🌊\nline' }] } as const;
  assert.equal(
    await text(toSSE([batch])),
    `id: 5\nevent: patch\ndata: ${JSON.stringify(batch)}\n\n`,
  );
  assert.equal(await text(toNDJSON([batch])), `${JSON.stringify(batch)}\n`);
});

test('encoders reject incomplete, extra, invalid, non-JSON-safe, and out-of-order frames', async () => {
  const cases = [
    [],
    [frame(1, 'streaming')],
    [frame(), frame(2)],
    [frame(2, 'streaming'), frame(4)],
    [{ ...frame(), format: 'yaml' }],
    [{ ...frame(), patches: [{ op: 'set', path: '', value: undefined }] }],
    [{ ...frame(), patches: [{ op: 'append', path: '/bad~2', value: 'x' }] }],
  ];
  for (const batches of cases) {
    await assert.rejects(text(toNDJSON(batches as never)));
  }
  await assert.rejects(text(toSSE([frame() as never], { maxFrameLength: 4 })));
  assert.throws(() => toNDJSON([], { maxPatches: -1 }));
});

test('path issues remain scoped while later sibling patches continue', async () => {
  const batches: WireBatch[] = [
    {
      ...frame(1, 'streaming'),
      protocol: 1,
      patches: [{ op: 'set', path: '', value: { name: '', count: 0 } }],
      issues: [{ path: '/name', code: 'schema', message: 'Required' }],
    },
    { ...frame(2, 'complete'), patches: [{ op: 'set', path: '/count', value: 2 }] },
  ];
  const encoded = await text(toNDJSON(batches as never));
  const state = createPatchState();
  encoded
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .forEach((batch) => applyPatchBatch(state, batch));
  assert.deepEqual(state.data, { name: '', count: 2 });
  assert.deepEqual(state.issues, batches[0].issues);
});

test('encoding is demand-driven, cancellation closes the source, and preserves protocol errors', async () => {
  let pulls = 0;
  let closed = 0;
  async function* source() {
    try {
      while (true) {
        pulls++;
        yield frame(pulls, 'streaming') as never;
      }
    } finally {
      closed++;
    }
  }
  const stream = toNDJSON(source());
  assert.equal(pulls, 0);
  const reader = stream.getReader();
  await reader.read();
  await reader.cancel('done');
  assert.equal(closed, 1);
  assert.ok(pulls <= 2);
  const original = new Error('original transport failure');
  const failing = {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      throw original;
    },
    async return() {
      throw new Error('cleanup failed');
    },
  };
  await assert.rejects(text(toSSE(failing)), (error) => error === original);
});

test('AbortSignal cancellation rejects normalization and closes encoders', async () => {
  const abort = new AbortController();
  const events = toEventStream(['{}'], { signal: abort.signal });
  await events.next();
  abort.abort();
  await assert.rejects(events.next(), { name: 'AbortError' });
  const controller = new AbortController();
  let returned = false;
  const source = {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      return new Promise<IteratorResult<never>>(() => {});
    },
    async return() {
      returned = true;
      return { done: true as const, value: undefined };
    },
  };
  const reader = toSSE(source, { signal: controller.signal }).getReader();
  const read = reader.read();
  controller.abort();
  await assert.rejects(read, { name: 'AbortError' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(returned, true);
});

test('response helpers set stream headers, preserve custom init, and strip stale length', async () => {
  const response = eventStreamResponse([frame() as never], {
    status: 201,
    headers: { 'x-request-id': 'a', 'content-length': '9', 'content-type': 'wrong' },
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-cache');
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  assert.equal(response.headers.get('x-request-id'), 'a');
  assert.equal(response.headers.get('content-length'), null);
  await response.text();
  const lines = ndjsonResponse([frame() as never]);
  assert.equal(lines.headers.get('content-type'), 'application/x-ndjson; charset=utf-8');
  await lines.text();
});

for (const format of ['jsonl', 'ndjson'] as const) {
  test(`${format} input emits wire patches in its declared format`, async () => {
    const batches = await collect(toEventStream(['{"name":"A"}\n', '{"name":"海🌊"}'], { format }));
    const state = createPatchState({ format });
    batches.forEach((batch) => applyPatchBatch(state, batch));
    assert.equal(state.state, 'complete');
    assert.deepEqual(state.data, [{ name: 'A' }, { name: '海🌊' }]);
  });
}

test('encoders enforce nesting, operation count, and pointer limits', async () => {
  const batches = [
    [
      { ...frame(), patches: [{ op: 'set', path: '', value: { a: { b: { c: 1 } } } }] },
      { maxDepth: 1 },
    ],
    [
      {
        ...frame(),
        patches: [
          { op: 'set', path: '', value: {} },
          { op: 'status', path: '', value: 'complete' },
        ],
      },
      { maxPatches: 1 },
    ],
    [{ ...frame(), patches: [{ op: 'remove', path: '/long' }] }, { maxPathLength: 2 }],
  ] as const;
  for (const [batch, limits] of batches)
    await assert.rejects(text(toNDJSON([batch as never], limits)));
});

test('client reads a normalized SSE response end to end', async () => {
  const response = eventStreamResponse(toEventStream(['{"name":"海', '🌊","count":2}']));
  const state = client.createPatchState();
  for await (const batch of client.fromSSE(response)) client.applyPatchBatch(state, batch);
  assert.equal(state.state, 'complete');
  assert.deepEqual(state.data, { name: '海🌊', count: 2 });
});

test('cancellation finishes while producer next and return remain pending', async () => {
  let pulled!: () => void;
  const started = new Promise<void>((resolve) => {
    pulled = resolve;
  });
  let returned = false;
  const source = {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next(): Promise<IteratorResult<WireBatch>> {
      pulled();
      return await new Promise(() => {});
    },
    async return(): Promise<IteratorResult<WireBatch>> {
      returned = true;
      return await new Promise(() => {});
    },
  };
  const reader = toNDJSON(source).getReader();
  const pending = reader.read();
  await started;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      reader.cancel('done'),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Cancellation hung')), 250);
      }),
    ]);
    assert.equal(returned, true);
    assert.deepEqual(await pending, { done: true, value: undefined });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
});

test('terminal source/syntax errors are not delayed by a blocked iterator.return', async () => {
  const source: AsyncIterable<string> = {
    [Symbol.asyncIterator]() {
      return {
        next: async () => ({ done: false as const, value: '!' }),
        return: () => new Promise<IteratorResult<string>>(() => {}),
      };
    },
  };
  const events = toEventStream(source);
  assert.equal((await events.next()).value?.state, 'error');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const next = await Promise.race([
      events.next(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('return blocked terminal error')), 200);
      }),
    ]);
    assert.equal(next.done, true);
  } finally {
    clearTimeout(timer);
  }
});

test('wire transport preserves negative zero rather than silently normalizing parsed JSON', async () => {
  const client = await import('../dist/client.js');
  for (const response of [
    eventStreamResponse(toEventStream(['{"value":-0}'])),
    ndjsonResponse(toEventStream(['{"value":-0}'])),
  ]) {
    const state = client.createPatchState<{ value: number }>();
    const frames = response.headers.get('content-type')!.startsWith('text/event-stream')
      ? client.fromSSE(response)
      : client.fromNDJSON(response);
    for await (const batch of frames) client.applyPatchBatch(state, batch);
    assert.ok(Object.is(state.data?.value, -0));
  }
});
