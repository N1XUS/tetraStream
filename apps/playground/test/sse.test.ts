import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { streamStructured, type Snapshot } from 'tetra-stream';
import { sseAdapterCode, sseWireExample } from '../src/sse-guide.ts';

type Adapter = (response: Response) => AsyncGenerator<string>;
const folder = mkdtempSync(join(tmpdir(), 'tetra-sse-guide-'));
const file = join(folder, 'adapter.mts');
writeFileSync(file, sseAdapterCode);
after(() => rmSync(folder, { recursive: true, force: true }));
const module: unknown = await import(pathToFileURL(file).href);
assert.ok(module && typeof module === 'object' && 'sseTextChunks' in module);
assert.equal(typeof module.sseTextChunks, 'function');
const sseTextChunks = module.sseTextChunks as Adapter;
const encoder = new TextEncoder();
const headers = { 'Content-Type': 'text/event-stream; charset=utf-8' };

function responseFromBytes(chunks: Uint8Array[]): Response {
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    chunks.forEach(chunk => controller.enqueue(chunk));
    controller.close();
  } }), { headers });
}
function responseFromText(text: string): Response {
  return responseFromBytes([encoder.encode(text)]);
}
function event(text: string): string { return 'data: ' + JSON.stringify({ text }) + '\n\n'; }
async function collect(response: Response): Promise<string[]> {
  const values: string[] = [];
  for await (const value of sseTextChunks(response)) values.push(value);
  return values;
}

// Live connection proves that decoding does not wait for complete profile JSON,
// a terminal event, or network EOF before yielding a provisional snapshot.
test('document text reaches the profile while the SSE connection is still open', async () => {
  let cancelled = false;
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(value) { controller = value; }, cancel() { cancelled = true; },
  }), { headers });
  const snapshots = streamStructured<{ name: string }>(sseTextChunks(response));
  controller.enqueue(encoder.encode(event('{"name":"Al')));
  const first = await snapshots.next();
  assert.equal(first.done, false);
  assert.equal(first.value?.data?.name, 'Al');
  assert.equal(first.value?.state, 'streaming');
  assert.equal(first.value?.status['/name'], 'partial');
  assert.equal(cancelled, false);
  controller.enqueue(encoder.encode(event('ice"}') + 'data: [DONE]\n\n'));
  assert.equal((await snapshots.next()).value?.data?.name, 'Alice');
  assert.equal((await snapshots.next()).value?.state, 'complete');
  assert.equal((await snapshots.next()).done, true);
  assert.equal(cancelled, true);
});

test('UTF-8, BOM, multiline data, comments and all SSE line endings survive byte fragmentation', async () => {
  const wire = '\ufeff: heartbeat\r\nid: ignored\r\nretry: 1000\r\nevent: delta\r\ndata: {"text":\r\ndata: "海🌊"}\r\n\r\nevent: message\rdata: {"text":"!"}\r\rdata: [DONE]\n\n';
  const bytes = encoder.encode(wire);
  assert.deepEqual(await collect(responseFromBytes(Array.from(bytes, byte => Uint8Array.of(byte)))), ['海🌊', '!']);
  for (let split = 0; split <= bytes.length; split++) {
    assert.deepEqual(await collect(responseFromBytes([bytes.slice(0, split), bytes.slice(split)])), ['海🌊', '!'], `byte split ${split}`);
  }
});

test('the exact displayed wire example forms a complete document from partial text events', async () => {
  const snapshots: Snapshot<{ name: string }>[] = [];
  for await (const snapshot of streamStructured<{ name: string }>(sseTextChunks(responseFromText(sseWireExample)))) snapshots.push(snapshot);
  assert.equal(snapshots[0].data?.name, 'Al');
  assert.equal(snapshots[0].status['/name'], 'partial');
  assert.equal(snapshots.at(-1)?.data?.name, 'Alice');
  assert.equal(snapshots.at(-1)?.state, 'complete');
});

test('[DONE] stops reading and cancels the connection before following events', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(encoder.encode(event('one') + 'data: [DONE]\n\n' + 'data: invalid\n\n')); },
    cancel() { cancelled = true; },
  }), { headers });
  assert.deepEqual(await collect(response), ['one']);
  assert.equal(cancelled, true);
  assert.equal(response.body?.locked, false);
});

test('early consumer stop cancels the stream and releases its lock', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(encoder.encode(event('one') + event('two'))); },
    cancel() { cancelled = true; },
  }), { headers });
  for await (const text of sseTextChunks(response)) { assert.equal(text, 'one'); break; }
  assert.equal(cancelled, true);
  assert.equal(response.body?.locked, false);
});

test('EOF cannot masquerade as successful completion and an unfinished final frame is discarded', async () => {
  for (const suffix of ['', 'data: [DONE]', 'data: [DONE]\n', 'data: invalid']) {
    const values: string[] = [];
    await assert.rejects(async () => {
      for await (const value of sseTextChunks(responseFromText(event('before') + suffix))) values.push(value);
    }, /before \[DONE\]/);
    assert.deepEqual(values, ['before']);
  }
});

test('invalid envelope and named error events preserve the already rendered partial profile', async () => {
  for (const frame of ['data: invalid\n\n', 'data: {"other":"wrong"}\n\n', 'data: {"text":12}\n\n', 'event: error\ndata: backend unavailable\n\n']) {
    const values: Snapshot<{ name: string }>[] = [];
    await assert.rejects(async () => {
      for await (const snapshot of streamStructured<{ name: string }>(sseTextChunks(responseFromText(event('{"name":"Al') + frame)))) values.push(snapshot);
    }, frame.startsWith('event: error') ? /backend unavailable/ : /SSE/);
    assert.equal(values.at(-1)?.data?.name, 'Al');
    assert.equal(values.at(-1)?.state, 'streaming');
  }
});

test('event type resets at blank lines and unrelated named events do not become text', async () => {
  const wire = 'event: metrics\ndata: ignored\n\nevent: error\n\n' + event('one') + 'data:\n\ndata: [DONE]\n\n';
  await assert.rejects(() => collect(responseFromText(wire)), /SSE/); // Empty data is a dispatched, invalid envelope.
  assert.deepEqual(await collect(responseFromText('event: metrics\ndata: ignored\n\nevent: error\n\n' + event('one') + 'data: [DONE]\n\n')), ['one']);
});

test('transport failures and cleanup rejection retain the original failure', async () => {
  const transport = new Error('network disconnected');
  const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.error(transport); } }), { headers });
  await assert.rejects(() => collect(response), error => error === transport);
  const badEnvelope = new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(encoder.encode('data: invalid\n\n')); },
    cancel() { throw new Error('cleanup failed'); },
  }), { headers });
  await assert.rejects(() => collect(badEnvelope), /SSE/);
  assert.equal(badEnvelope.body?.locked, false);
});

test('a bounded event buffer rejects runaway payloads and HTTP/body errors are explicit', async () => {
  await assert.rejects(() => collect(responseFromText('data: ' + 'x'.repeat(64_001))), /limit/);
  await assert.rejects(() => collect(responseFromText(('data: ' + 'x'.repeat(1000) + '\n').repeat(65))), /limit/);
  await assert.rejects(() => collect(new Response('failed', { status: 500 })), /HTTP 500/);
  await assert.rejects(() => collect(new Response(null, { headers })), /body/);
  await assert.rejects(() => collect(new Response('not SSE')), /text\/event-stream/);
});

test('a complete-looking document stays streaming if the final SSE marker is truncated', async () => {
  const snapshots: Snapshot<{ name: string }>[] = [];
  await assert.rejects(async () => {
    const response = responseFromText(event('{"name":"Alice"}') + 'data: [DONE]\n');
    for await (const snapshot of streamStructured<{ name: string }>(sseTextChunks(response))) snapshots.push(snapshot);
  }, /before \[DONE\]/);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].data?.name, 'Alice');
  assert.equal(snapshots[0].status[''], 'complete');
  assert.equal(snapshots[0].state, 'streaming');
});

test('a downstream document syntax failure cancels SSE and preserves the syntax error', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(encoder.encode(event('!'))); },
    cancel() { cancelled = true; throw new Error('cleanup failed'); },
  }), { headers });
  await assert.rejects(async () => {
    for await (const _ of streamStructured(sseTextChunks(response))) { /* consume */ }
  }, SyntaxError);
  assert.equal(cancelled, true);
  assert.equal(response.body?.locked, false);
});
