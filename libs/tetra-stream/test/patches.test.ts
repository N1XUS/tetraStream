import { at, record } from './helpers.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../dist/index.js';

const sources = {
  json: '{"name":"海🌊","a/b~c":[false,0,null],"__proto__":{"safe":true}}',
  yaml: 'name: "海🌊"\na/b~c: [false, 0, null]\nnotes: >-\n  Hello\n  world\n',
  yml: '- "a": x\n- b\n',
  xml: '<user id="a&amp;b"><name>海🌊</name><![CDATA[Hello & <]]></user>',
  html: '<article><p>海🌊 &amp; hello<li>A<li>B</article>',
  ndjson: '{"name":"海🌊"}\n{"x":[false,0,null]}\n',
  jsonl: 'false\n0\n{"a/b~c":"Hi"}',
  csv: 'name,notes\r\nAlex,"Design, ""systems""\nReady"\r\nSam,\r\n',
  tsv: 'name\tnotes\nAlex\t"Hi\tthere"\nSam\t\n',
};

function publicState(state: api.PatchState) {
  const { sequence, ...snapshot } = state;
  return snapshot;
}

for (const [format, source] of Object.entries(sources) as [keyof typeof sources, string][]) {
  test(`${format} patch batches reconstruct every growing snapshot without waiting for EOF`, () => {
    assert.equal(typeof api.createPatchState, 'function');
    const parser = new api.StreamNormalizer({ format });
    const reference = new api.StreamNormalizer({ format });
    const state = api.createPatchState({ format });
    for (const char of source) {
      const expected = reference.write(char);
      const batch = parser.writePatch(char);
      assert.equal(api.applyPatchBatch(state, batch), state, 'the accumulator updates in place');
      assert.deepEqual(publicState(state), expected, JSON.stringify(char));
    }
    api.applyPatchBatch(state, parser.endPatch());
    assert.deepEqual(publicState(state), reference.end());
  });
}

test('long text updates emit only new decoded suffixes and do not resend unchanged siblings', () => {
  const parser = new api.StreamNormalizer();
  assert.equal(typeof parser.writePatch, 'function');
  parser.writePatch('{"unchanged":[1,2,3],"bio":"Hello');
  const batch = parser.writePatch(' world\\n海');
  assert.deepEqual(batch.patches, [{ op: 'append', path: '/bio', value: ' world\n海' }]);
});

test('patch events and replayed values do not alias parser state or earlier events', () => {
  const parser = new api.StreamNormalizer();
  const state = api.createPatchState();
  const first = parser.writePatch('{"items":[{"name":"Al');
  const saved = structuredClone(first);
  api.applyPatchBatch(state, first);
  api.applyPatchBatch(state, parser.writePatch('ice"}]}'));
  assert.deepEqual(first, saved);
  assert.equal(at(state.data, 'items', 0, 'name'), 'Alice');
  record(at(state.data, 'items', 0)).name = 'Changed by consumer';
  assert.equal(at(parser.snapshot().data, 'items', 0, 'name'), 'Alice');
  assert.deepEqual(first, saved);
});

test('errors have drainable patch state and closed parsers still reject input', () => {
  const parser = new api.StreamNormalizer();
  const state = api.createPatchState();
  api.applyPatchBatch(state, parser.writePatch('{"bio":"Hel'));
  assert.throws(() => parser.endPatch(), SyntaxError);
  api.applyPatchBatch(state, parser.patch());
  assert.deepEqual(publicState(state), parser.snapshot());
  assert.equal(at(state.data, 'bio'), 'Hel');
  assert.equal(state.state, 'error');
  assert.throws(() => parser.writePatch('lo"}'), /closed/i);
});

test('replay rejects out-of-order batches and safely preserves prototype-like keys', () => {
  const parser = new api.StreamNormalizer();
  const first = parser.writePatch('{"__proto__":{"polluted":false},"constructor":"safe"}');
  const state = api.createPatchState();
  assert.throws(() => api.applyPatchBatch(state, { ...first, sequence: 2 }), /sequence/i);
  api.applyPatchBatch(state, first);
  assert.equal(Object.hasOwn(record(state.data), '__proto__'), true);
  assert.equal(at(state.data, '__proto__', 'polluted'), false);
  assert.equal(record({}).polluted, undefined);
  assert.throws(() => api.applyPatchBatch(state, first), /sequence/i);
});

test('YAML rewrites and removed provisional paths are reflected in patch replay', () => {
  const source = '- "a": x\n- value\n';
  for (let split = 0; split <= source.length; split++) {
    const parser = new api.StreamNormalizer({ format: 'yaml' });
    const state = api.createPatchState({ format: 'yaml' });
    api.applyPatchBatch(state, parser.writePatch(source.slice(0, split)));
    api.applyPatchBatch(state, parser.writePatch(source.slice(split)));
    api.applyPatchBatch(state, parser.endPatch());
    assert.deepEqual(publicState(state), parser.snapshot());
  }
});

test('patch mode never calls the full-snapshot cloning API', () => {
  const parser = new api.StreamNormalizer({ format: 'csv' });
  parser.snapshot = () => {
    throw new Error('Unexpected full snapshot');
  };
  const state = api.createPatchState({ format: 'csv' });
  for (const chunk of ['name,role\n', 'Alex,Des', 'igner\n'])
    api.applyPatchBatch(state, parser.writePatch(chunk));
  api.applyPatchBatch(state, parser.endPatch());
  assert.deepEqual(state.data, [
    ['name', 'role'],
    ['Alex', 'Designer'],
  ]);
});

for (const [format, source] of Object.entries(sources) as [keyof typeof sources, string][]) {
  test(`${format} coalesced patches match snapshots at every possible two-chunk split`, () => {
    for (let split = 0; split <= source.length; split++) {
      const parser = new api.StreamNormalizer({ format });
      const state = api.createPatchState({ format });
      api.applyPatchBatch(state, parser.writePatch(source.slice(0, split)));
      assert.deepEqual(publicState(state), parser.snapshot());
      api.applyPatchBatch(state, parser.writePatch(source.slice(split)));
      api.applyPatchBatch(state, parser.endPatch());
      assert.deepEqual(publicState(state), parser.snapshot());
    }
  });
}

test('async patch stream replays in order with typed-accumulator semantics', async () => {
  assert.equal(typeof api.streamPatches, 'function');
  const state = api.createPatchState();
  for await (const batch of api.streamPatches(['{"name":"Al', 'ice"}']))
    api.applyPatchBatch(state, batch);
  assert.equal(state.state, 'complete');
  assert.deepEqual(state.data, { name: 'Alice' });
});
