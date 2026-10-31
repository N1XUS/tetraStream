import assert from 'node:assert/strict';
import test from 'node:test';
import { StreamNormalizer, applyPatchBatch, createPatchState, select } from '../dist/index.js';
import type { CssDocument } from '../dist/index.js';
import { at, record } from './helpers.ts';

test('CSS exposes growing declaration values and only commits actual boundaries', () => {
  const parser = new StreamNormalizer<CssDocument>({ format: 'css' });
  let snapshot = parser.write('.ai-card { color: re');
  assert.deepEqual(snapshot.data, {
    kind: 'stylesheet',
    nodes: [
      {
        kind: 'rule',
        selector: '.ai-card',
        nodes: [{ kind: 'declaration', property: 'color', value: 're', important: false }],
      },
    ],
  });
  assert.equal(snapshot.status['/nodes/0/selector'], 'complete');
  assert.equal(snapshot.status['/nodes/0/nodes/0/property'], 'complete');
  assert.equal(snapshot.status['/nodes/0/nodes/0/value'], 'partial');
  assert.equal(
    select(snapshot, '/nodes/0/nodes/0/value', { require: 'complete' }).status,
    'pending',
  );
  snapshot = parser.write('d; background: linear-gradient(90deg, re');
  assert.equal(snapshot.status['/nodes/0/nodes/0'], 'complete');
  assert.equal(snapshot.status['/nodes/0/nodes/0/value'], 'complete');
  assert.equal(at(snapshot.data, 'nodes', 0, 'nodes', 1, 'value'), 'linear-gradient(90deg, re');
  assert.equal(snapshot.status['/nodes/0/nodes/1/value'], 'partial');
  snapshot = parser.write('d, blue) }');
  assert.equal(snapshot.status['/nodes/0/nodes/1/value'], 'complete');
  assert.equal(snapshot.status['/nodes/0/nodes'], 'complete');
  assert.equal(snapshot.status['/nodes/0'], 'complete');
  assert.equal(snapshot.status[''], 'partial');
  assert.equal(parser.end().status[''], 'complete');
});

test('CSS tokenization preserves delimiters inside strings, URLs, functions and comments', () => {
  const source =
    '/* ; } */.ai-card { content: "a; } \\" b"; background: url("data:image/svg+xml;a={b}"); width: calc(10px + var(--gap, 2px)); --payload: {x:y; z:w}; }';
  const parser = new StreamNormalizer<CssDocument>({ format: 'css' });
  for (const char of source) parser.write(char);
  const snapshot = parser.end();
  assert.equal(at(snapshot.data, 'nodes', 0, 'kind'), 'comment');
  assert.equal(at(snapshot.data, 'nodes', 1, 'nodes', 0, 'value'), '"a; } \\" b"');
  assert.equal(
    at(snapshot.data, 'nodes', 1, 'nodes', 1, 'value'),
    'url("data:image/svg+xml;a={b}")',
  );
  assert.equal(at(snapshot.data, 'nodes', 1, 'nodes', 2, 'value'), 'calc(10px + var(--gap, 2px))');
  assert.equal(at(snapshot.data, 'nodes', 1, 'nodes', 3, 'value'), '{x:y; z:w}');
  assert.ok(Object.values(snapshot.status).every((status) => status === 'complete'));
});

test('CSS retains ordered at-rules, nested rules, comments and important declarations', () => {
  const parser = new StreamNormalizer<CssDocument>({ format: 'css' });
  parser.write(
    '@import url("a;b.css"); @media (min-width: 1px) { .ai-card { /* note */ color: red !important; &:hover { opacity: .8 } } }',
  );
  const snapshot = parser.end();
  assert.equal(at(snapshot.data, 'nodes', 0, 'kind'), 'at-rule');
  assert.equal(at(snapshot.data, 'nodes', 0, 'name'), 'import');
  assert.equal(at(snapshot.data, 'nodes', 1, 'nodes', 0, 'selector'), '.ai-card');
  assert.deepEqual(at(snapshot.data, 'nodes', 1, 'nodes', 0, 'nodes', 1), {
    kind: 'declaration',
    property: 'color',
    value: 'red',
    important: true,
  });
  assert.equal(at(snapshot.data, 'nodes', 1, 'nodes', 0, 'nodes', 2, 'selector'), '&:hover');
  assert.ok(Object.values(snapshot.status).every((status) => status === 'complete'));
});

test('CSS recovery never completes synthetic closings, unfinished comments, or value tokens', () => {
  for (const source of [
    '.ai-card{color:red',
    '.ai-card{content:"red;}',
    '.ai-card{width:calc(1px + 2px',
    '.ai-card{/* unfinished',
  ]) {
    const parser = new StreamNormalizer<CssDocument>({ format: 'css' });
    const snapshot = parser.write(source);
    assert.equal(snapshot.status['/nodes/0'], 'partial', source);
    assert.notEqual(snapshot.status['/nodes/0/nodes/0/value'], 'complete', source);
    assert.throws(() => parser.end(), /unclosed/i, source);
    assert.equal(parser.snapshot().state, 'error');
  }
});

test('CSS validates original syntax at EOF while preserving the last partial snapshot', () => {
  for (const source of [
    '.a { broken }',
    '.a { color: red background: blue }',
    '.a { color: red }}',
    'not-a-rule',
  ]) {
    const parser = new StreamNormalizer<CssDocument>({ format: 'css' });
    parser.write(source);
    assert.throws(() => parser.end(), Error, source);
    assert.equal(parser.snapshot().state, 'error');
  }
  const empty = new StreamNormalizer<CssDocument>({ format: 'css' });
  assert.deepEqual(empty.end().data, { kind: 'stylesheet', nodes: [] });
});

test('CSS retains prototype-like property names as ordinary declaration strings', () => {
  const parser = new StreamNormalizer<CssDocument>({ format: 'css' });
  parser.write('.ai-card { __proto__: safe; constructor: value; --toString: x; }');
  const snapshot = parser.end();
  assert.equal(at(snapshot.data, 'nodes', 0, 'nodes', 0, 'property'), '__proto__');
  assert.equal(at(snapshot.data, 'nodes', 0, 'nodes', 1, 'property'), 'constructor');
  assert.equal(record({}).safe, undefined);
});

test('CSS enforces document size and nested-container limits', () => {
  const small = new StreamNormalizer({ format: 'css', maxLength: 10 });
  assert.throws(() => small.write('.a{color:red;}'), RangeError);
  const shallow = new StreamNormalizer({ format: 'css', maxDepth: 1 });
  shallow.write('.a { color: red; }');
  assert.equal(shallow.end().state, 'complete');
  const nested = new StreamNormalizer({ format: 'css', maxDepth: 1 });
  assert.throws(() => nested.write('@media all { .a { color: red; } }'), RangeError);
});

test('CSS patches reconstruct snapshots at every prefix and every two-chunk boundary', () => {
  const source = '@media all { .ai-card { color: red; content: "a;}"; --x: calc(1px + 2px) } }';
  const incremental = new StreamNormalizer<CssDocument>({ format: 'css' });
  const state = createPatchState<CssDocument>({ format: 'css' });
  for (const char of source) {
    applyPatchBatch(state, incremental.writePatch(char));
    const { sequence, ...snapshot } = state;
    assert.deepEqual(snapshot, incremental.snapshot());
  }
  applyPatchBatch(state, incremental.endPatch());
  const { sequence, ...snapshot } = state;
  assert.deepEqual(snapshot, incremental.snapshot());
  for (let split = 0; split <= source.length; split++) {
    const parser = new StreamNormalizer<CssDocument>({ format: 'css' });
    const replay = createPatchState<CssDocument>({ format: 'css' });
    applyPatchBatch(replay, parser.writePatch(source.slice(0, split)));
    applyPatchBatch(replay, parser.writePatch(source.slice(split)));
    applyPatchBatch(replay, parser.endPatch());
    assert.deepEqual(replay.data, snapshot.data, `split ${split}`);
    assert.deepEqual(replay.status, snapshot.status, `split ${split}`);
  }
});

test('CSS at-rule parameters and quoted declaration prefixes expose no synthetic tokens', () => {
  const atRule = new StreamNormalizer<CssDocument>({ format: 'css' });
  const parameters = atRule.write('@import url("a;b');
  assert.equal(at(parameters.data, 'nodes', 0, 'params'), 'url("a;b');
  assert.equal(parameters.status['/nodes/0/params'], 'partial');
  const rule = new StreamNormalizer<CssDocument>({ format: 'css' });
  const quoted = rule.write('.ai-card{content:"a;}');
  assert.equal(at(quoted.data, 'nodes', 0, 'nodes', 0, 'value'), '"a;}');
  assert.equal(quoted.status['/nodes/0/nodes/0/value'], 'partial');
});

test('CSS recovery cannot commit declarations separated by an invented semicolon', () => {
  const parser = new StreamNormalizer<CssDocument>({ format: 'css' });
  const snapshot = parser.write('.ai-card{opacity:1; color:red background:blue;}');
  assert.equal(snapshot.status['/nodes/0/nodes/0/value'], 'complete');
  assert.equal(snapshot.status['/nodes/0/nodes/1/value'], 'partial');
  assert.equal(snapshot.status['/nodes/0/nodes/2/value'], 'partial');
  assert.throws(() => parser.end(), SyntaxError);
  assert.equal(
    select(parser.snapshot(), '/nodes/0/nodes/0/value', { require: 'complete' }).status,
    'complete',
  );
});

test('CSS parse errors remain drainable through patch replay', () => {
  const parser = new StreamNormalizer<CssDocument>({ format: 'css' });
  const replay = createPatchState<CssDocument>({ format: 'css' });
  applyPatchBatch(replay, parser.writePatch('.ai-card{color:red; padding:3'));
  assert.throws(() => parser.endPatch(), SyntaxError);
  applyPatchBatch(replay, parser.patch());
  const { sequence, ...snapshot } = replay;
  assert.deepEqual(snapshot, parser.snapshot());
  assert.equal(replay.state, 'error');
  assert.equal(replay.status['/nodes/0/nodes/0/value'], 'complete');
  assert.equal(replay.status['/nodes/0/nodes/1/value'], 'partial');
});

test('CSS escaped semicolons stay partial until a real declaration or at-rule delimiter', () => {
  const declaration = new StreamNormalizer<CssDocument>({ format: 'css' });
  let snapshot = declaration.write('.a{--x:red\\;');
  assert.equal(snapshot.status['/nodes/0/nodes/0/value'], 'partial');
  snapshot = declaration.write('blue;}');
  assert.equal(at(snapshot.data, 'nodes', 0, 'nodes', 0, 'value'), 'red\\;blue');
  assert.equal(snapshot.status['/nodes/0/nodes/0/value'], 'complete');
  declaration.end();

  const atRule = new StreamNormalizer<CssDocument>({ format: 'css' });
  let parameters = atRule.write('@hello foo\\;');
  assert.equal(parameters.status['/nodes/0'], 'partial');
  assert.equal(parameters.status['/nodes/0/params'], 'partial');
  parameters = atRule.write('bar;');
  assert.equal(at(parameters.data, 'nodes', 0, 'params'), 'foo\\;bar');
  assert.equal(parameters.status['/nodes/0/params'], 'complete');
  atRule.end();
});

test('CSS lexical boundaries distinguish escaped braces and URL contents from real delimiters', () => {
  const escaped = new StreamNormalizer<CssDocument>({ format: 'css' });
  let snapshot = escaped.write('.a{--x:red\\}');
  assert.equal(snapshot.status['/nodes/0'], 'partial');
  snapshot = escaped.write('blue;}');
  assert.equal(at(snapshot.data, 'nodes', 0, 'nodes', 0, 'value'), 'red\\}blue');
  assert.equal(snapshot.status['/nodes/0'], 'complete');
  escaped.end();

  const url = new StreamNormalizer<CssDocument>({ format: 'css' });
  const complete = url.write('.a{background:url(data:text/plain;/*x);color:red;}');
  assert.equal(at(complete.data, 'nodes', 0, 'nodes', 0, 'value'), 'url(data:text/plain;/*x)');
  assert.equal(complete.status['/nodes/0/nodes/0/value'], 'complete');
  assert.equal(complete.status['/nodes/0/nodes/1/value'], 'complete');
  url.end();
});

test('CSS custom-property token blocks stay one declaration before and after EOF', () => {
  const parser = new StreamNormalizer<CssDocument>({ format: 'css' });
  const snapshot = parser.write('a{--x:{a:b;};}');
  assert.deepEqual(at(snapshot.data, 'nodes', 0, 'nodes'), [
    { kind: 'declaration', property: '--x', value: '{a:b;}', important: false },
  ]);
  assert.deepEqual(select(snapshot, '/nodes/0/nodes/0/value', { require: 'complete' }), {
    status: 'complete',
    state: 'streaming',
    value: '{a:b;}',
  });
  assert.deepEqual(parser.end().data, snapshot.data);
});

test('CSS nested custom-property block prefixes never fabricate completed sibling declarations', () => {
  const parser = new StreamNormalizer<CssDocument>({ format: 'css' });
  let snapshot = parser.write('a{--x:{a:{b:c;');
  assert.deepEqual(at(snapshot.data, 'nodes', 0, 'nodes'), [
    { kind: 'declaration', property: '--x', value: '{a:{b:c;', important: false },
  ]);
  assert.equal(snapshot.status['/nodes/0/nodes/0/value'], 'partial');
  snapshot = parser.write('}};color:r');
  assert.deepEqual(at(snapshot.data, 'nodes', 0, 'nodes'), [
    { kind: 'declaration', property: '--x', value: '{a:{b:c;}}', important: false },
    { kind: 'declaration', property: 'color', value: 'r', important: false },
  ]);
  assert.equal(snapshot.status['/nodes/0/nodes/0/value'], 'complete');
  assert.equal(snapshot.status['/nodes/0/nodes/1/value'], 'partial');
  parser.write('ed;}');
  assert.equal(at(parser.end().data, 'nodes', 0, 'nodes', 0, 'value'), '{a:{b:c;}}');
});

test('CSS custom token blocks replay without fabricated declarations at every character', () => {
  const source = 'a{--x:{a:{b:c;d:e}};color:red;}';
  const parser = new StreamNormalizer<CssDocument>({ format: 'css' });
  const replay = createPatchState<CssDocument>({ format: 'css' });
  for (const char of source) {
    applyPatchBatch(replay, parser.writePatch(char));
    const { sequence, ...snapshot } = replay;
    assert.deepEqual(snapshot, parser.snapshot());
    const value = select(snapshot, '/nodes/0/nodes/0/value', { require: 'complete' });
    if (value.status === 'complete') assert.equal(value.value, '{a:{b:c;d:e}}');
  }
  applyPatchBatch(replay, parser.endPatch());
  assert.equal(at(replay.data, 'nodes', 0, 'nodes', 0, 'property'), '--x');
  assert.equal(at(replay.data, 'nodes', 0, 'nodes', 1, 'property'), 'color');
});
