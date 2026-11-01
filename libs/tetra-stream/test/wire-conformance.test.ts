import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Ajv2020 } from 'ajv/dist/2020.js';
import * as client from '../dist/client.js';
import * as server from '../dist/server.js';
import { StreamNormalizer } from '../dist/index.js';
import type { WireBatch, WireFormat } from '../dist/client.js';

const spec = new URL('../spec/', import.meta.url);
interface Fixture {
  file: string;
  format: WireFormat;
  source?: string;
  expected?: unknown;
  terminal?: string;
  issues?: unknown[];
  phase?: 'frame' | 'transcript' | 'apply' | 'stateful' | 'json';
  reason?: string;
}
const manifest: { version: number; valid: Fixture[]; invalid: Fixture[] } = JSON.parse(
  await readFile(new URL('fixtures/index.json', spec), 'utf8'),
);
const schema = JSON.parse(await readFile(new URL('patch-batch.schema.json', spec), 'utf8'));
const encoder = new TextEncoder();

function byteStream(bytes: Uint8Array, split: number): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, split));
      controller.enqueue(bytes.slice(split));
      controller.close();
    },
  });
}
async function fixtureText(fixture: Fixture): Promise<string> {
  return readFile(new URL(`fixtures/${fixture.file}`, spec), 'utf8');
}
function framesFrom(text: string): unknown[] {
  return text
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
function sseText(text: string): string {
  // This is transport framing of the exact stored batches, not a second producer.
  return text
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      let id = '';
      try {
        id = `id: ${JSON.parse(line).sequence}\n`;
      } catch {
        /* Preserve malformed JSON. */
      }
      return `${id}data: ${line}\n\n`;
    })
    .join('');
}
function snapshot(state: ReturnType<typeof client.createPatchState>) {
  const { sequence: _sequence, issues: _issues, ...result } = state;
  return result;
}
function expectedSnapshot(fixture: Fixture): unknown {
  if (fixture.source === undefined) return fixture.expected;
  const reference = new StreamNormalizer({ format: fixture.format });
  try {
    reference.write(fixture.source);
    reference.end();
  } catch {
    assert.equal(fixture.terminal, 'error', 'only stored source failures may throw');
  }
  return reference.snapshot();
}
async function replay(
  source: AsyncIterable<WireBatch>,
  format: WireFormat,
): Promise<{ state: ReturnType<typeof client.createPatchState>; frames: WireBatch[] }> {
  const state = client.createPatchState({ format });
  const frames: WireBatch[] = [];
  for await (const batch of source) {
    client.applyPatchBatch(state, batch);
    frames.push(batch);
  }
  return { state, frames };
}

// This assertion was written and observed failing before the schema was added.
test('the published wire schema declares a closed v1 PatchBatch envelope', () => {
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ['format', 'sequence', 'patches', 'state']);
  assert.equal(manifest.version, 1);
});

test('JSON Schema 2020-12 accepts all valid frame shapes and rejects shape-invalid fixtures', async () => {
  const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true });
  assert.equal(ajv.validateSchema(schema), true, JSON.stringify(ajv.errors));
  const validate = ajv.compile(schema);
  for (const fixture of [...manifest.valid, ...manifest.invalid]) {
    if (fixture.phase === 'json') continue;
    for (const frame of framesFrom(await fixtureText(fixture))) {
      const valid = validate(frame);
      assert.equal(
        valid,
        fixture.phase !== 'frame',
        `${fixture.file}: ${JSON.stringify(validate.errors)}`,
      );
    }
  }
});

for (const fixture of manifest.valid) {
  test(`${fixture.file}: all frames replay through NDJSON and SSE at every UTF-8 byte split`, async () => {
    const text = await fixtureText(fixture);
    const storedFrames = framesFrom(text);
    const expected = expectedSnapshot(fixture);
    for (const transport of ['ndjson', 'sse'] as const) {
      const bytes = encoder.encode(transport === 'ndjson' ? text : sseText(text));
      for (let split = 0; split <= bytes.length; split++) {
        const source = byteStream(bytes, split);
        const batches =
          transport === 'ndjson'
            ? client.fromNDJSON(source)
            : client.fromSSE(
                new Response(source, { headers: { 'Content-Type': 'text/event-stream' } }),
              );
        const { state, frames } = await replay(batches, fixture.format);
        const context = `${fixture.file} ${transport} byte ${split}/${bytes.length}`;
        assert.equal(
          frames.length,
          storedFrames.length,
          `${context}: every frame, including terminal errors, is delivered`,
        );
        assert.equal(state.sequence, storedFrames.length, context);
        assert.deepEqual(snapshot(state), expected, context);
        assert.deepEqual(
          state.issues ?? [],
          fixture.issues ?? [],
          `${context}: issues accumulate independently`,
        );
        assert.ok(state.state === 'complete' || state.state === 'error', context);
        for (const frame of frames) assert.deepEqual(client.parsePatchBatch(frame), frame, context);
      }
    }
  });
}

for (const fixture of manifest.invalid.filter((entry) => entry.phase !== 'stateful')) {
  test(`${fixture.file}: rejects ${fixture.reason}`, async () => {
    const text = await fixtureText(fixture);
    for (const transport of ['ndjson', 'sse'] as const) {
      const bytes = encoder.encode(transport === 'ndjson' ? text : sseText(text));
      for (let split = 0; split <= bytes.length; split++) {
        const source = byteStream(bytes, split);
        await assert.rejects(
          replay(
            transport === 'ndjson'
              ? client.fromNDJSON(source)
              : client.fromSSE(
                  new Response(source, { headers: { 'Content-Type': 'text/event-stream' } }),
                ),
            fixture.format,
          ),
          {
            name: 'WireProtocolError',
            code:
              fixture.file.includes('sequence-') && !fixture.file.includes('sequence-zero')
                ? 'sequence'
                : fixture.file.includes('missing-terminal') || fixture.file.includes('empty.ndjson')
                  ? 'truncated'
                  : 'invalid-frame',
          },
          `${fixture.file} ${transport} byte ${split}: ${fixture.reason}`,
        );
      }
    }
  });
}

for (const fixture of manifest.invalid.filter((entry) => entry.phase === 'stateful')) {
  test(`${fixture.file}: archived transcripts reject frames after terminal`, async () => {
    const frames = framesFrom(await fixtureText(fixture)).map((frame) =>
      client.parsePatchBatch(frame),
    );
    const state = client.createPatchState({ format: fixture.format });
    client.applyPatchBatch(state, frames[0]!);
    assert.throws(() => client.applyPatchBatch(state, frames[1]!), /terminal|complete|closed/iu);
  });
}

test('the correction fixture is valid with remove opt-out and rejected atomically by appendOnly', async () => {
  const fixture = manifest.valid.find((entry) => entry.file === 'valid/corrections.ndjson')!;
  const frames = framesFrom(await fixtureText(fixture)).map((frame) =>
    client.parsePatchBatch(frame),
  );
  const state = client.createPatchState({ format: fixture.format });
  client.applyPatchBatch(state, frames[0]!);
  const before = structuredClone(state);
  assert.throws(
    () => client.applyPatchBatch(state, frames[1]!, { appendOnly: true }),
    /remove|append/iu,
  );
  assert.deepEqual(state, before, 'the set before remove must not be partially applied');
  client.applyPatchBatch(state, frames[1]!, { appendOnly: false });
  assert.deepEqual(snapshot(state), fixture.expected);
});

for (const fixture of manifest.valid.filter((entry) => entry.source !== undefined)) {
  test(`${fixture.file}: server producers preserve the result with coalesced and fine source chunks`, async () => {
    const expected = expectedSnapshot(fixture);
    for (const chunks of [[fixture.source!], Array.from(fixture.source!)]) {
      for (const transport of ['ndjson', 'sse'] as const) {
        const stream =
          transport === 'ndjson'
            ? server.toNDJSON(server.toEventStream(chunks, { format: fixture.format }))
            : server.toSSE(server.toEventStream(chunks, { format: fixture.format }));
        const { state, frames } = await replay(
          transport === 'ndjson'
            ? client.fromNDJSON(stream)
            : client.fromSSE(
                new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }),
              ),
          fixture.format,
        );
        assert.deepEqual(snapshot(state), expected);
        assert.ok(frames.length > 0);
        assert.equal(frames.at(-1)!.state, fixture.terminal);
        for (const frame of frames) assert.deepEqual(client.parsePatchBatch(frame), frame);
      }
    }
  });
}
