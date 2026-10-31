import { at, record } from './helpers.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamNormalizer, streamStructured } from '../dist/index.js';

for (const format of ['yaml', 'yml'] as const) {
  test(`${format} exposes growing plain values and withholds unfinished keys and empty values`, () => {
    const parser = new StreamNormalizer({ format });
    let result = parser.write('name: Alice\nbio: Software eng');
    assert.deepEqual(result.data, { name: 'Alice', bio: 'Software eng' });
    assert.equal(result.status['/name'], 'complete');
    assert.equal(result.status['/bio'], 'partial');
    result = parser.write('ineer\nwebsite:');
    assert.equal(at(result.data, 'bio'), 'Software engineer');
    assert.equal(Object.hasOwn(record(result.data), 'website'), false);
    result = parser.end();
    assert.equal(at(result.data, 'website'), null);
    assert.equal(result.state, 'complete');
  });
}

test('YAML supports flow collections, nested blocks, folded text and provisional scalar types', () => {
  const parser = new StreamNormalizer({ format: 'yaml' });
  let result = parser.write('user:\n  name: Alice\nskills: [Design, Cod');
  assert.equal(result.status['/user'], 'complete');
  assert.deepEqual(at(result.data, 'skills'), ['Design', 'Cod']);
  assert.equal(result.status['/skills/0'], 'complete');
  assert.equal(result.status['/skills/1'], 'partial');
  result = parser.write('ing]\nactive: true');
  assert.equal(at(result.data, 'active'), true);
  assert.equal(result.status['/active'], 'partial');
  result = parser.write('ish\nbio: >-\n  Makes complex\n  things simple');
  assert.equal(at(result.data, 'active'), 'trueish');
  assert.equal(at(result.data, 'bio'), 'Makes complex things simple');
  assert.equal(parser.end().state, 'complete');
});

test('YAML plain strings can continue across lines; single quotes can be doubled across chunks', () => {
  const plain = new StreamNormalizer({ format: 'yaml' });
  assert.equal(plain.write('bio: Makes things\n').status['/bio'], 'partial');
  assert.equal(at(plain.write('  simple').data, 'bio'), 'Makes things simple');
  const quoted = new StreamNormalizer({ format: 'yaml' });
  assert.equal(quoted.write("name: 'Alice'").status['/name'], 'partial');
  assert.equal(at(quoted.write("'s'").data, 'name'), "Alice's");
  assert.equal(at(quoted.end().data, 'name'), "Alice's");
});

test('YAML buffers incomplete escapes and preserves ordinary prototype-like keys', () => {
  const parser = new StreamNormalizer({ format: 'yaml' });
  assert.equal(at(parser.write('name: "A\\u00').data, 'name'), 'A');
  assert.equal(at(parser.write('e9"\n__proto__: safe\n').data, 'name'), 'Aé');
  const result = parser.end();
  assert.equal(Object.hasOwn(record(result.data), '__proto__'), true);
  assert.equal(at(result.data, '__proto__'), 'safe');
});

test('YAML buffers a split escaped CRLF without erasing the available string prefix', () => {
  const parser = new StreamNormalizer({ format: 'yaml' });
  assert.equal(at(parser.write('a: "hello').data, 'a'), 'hello');
  assert.equal(at(parser.write('\\\r').data, 'a'), 'hello');
  assert.equal(at(parser.write('\n').data, 'a'), 'hello');
  parser.write('  world"');
  assert.equal(at(parser.end().data, 'a'), 'helloworld');
});

test('YAML finalization rejects invalid syntax, duplicate keys and unsupported non-JSON constructs', () => {
  for (const source of [
    'a: [x',
    'a: "unfinished',
    'a: 1\na: 2',
    'a: &x [1]\nb: *x',
    'a: !custom x',
    '? [a, b]\n: value',
    '1: value',
    'true: value',
    'null: value',
    'a: .inf',
    '---\na: 1\n---\nb: 2',
  ]) {
    const parser = new StreamNormalizer({ format: 'yaml' });
    assert.throws(
      () => {
        parser.write(source);
        parser.end();
      },
      SyntaxError,
      source,
    );
    assert.equal(parser.snapshot().state, 'error');
  }
  const deep = new StreamNormalizer({ format: 'yaml', maxDepth: 1 });
  assert.throws(() => deep.write('a: [1]'), RangeError);
});

for (const format of ['ndjson', 'jsonl'] as const) {
  test(`${format} renders the open record and commits each record at its newline`, () => {
    const parser = new StreamNormalizer({ format });
    let result = parser.write('{"name":"Al');
    assert.deepEqual(result.data, [{ name: 'Al' }]);
    assert.equal(result.status['/0/name'], 'partial');
    result = parser.write('ice"}\r\n\n{"name":"Bo');
    assert.deepEqual(result.data, [{ name: 'Alice' }, { name: 'Bo' }]);
    assert.equal(result.status['/0'], 'complete');
    assert.equal(result.status['/1/name'], 'partial');
    parser.write('b"}');
    assert.equal(parser.end().status['/1'], 'complete');
  });
}

test('NDJSON accepts primitive records and rejects malformed or interrupted records', () => {
  const parser = new StreamNormalizer({ format: 'ndjson' });
  parser.write('false\n0\nnull\n"hello"');
  assert.deepEqual(parser.end().data, [false, 0, null, 'hello']);
  const bad = new StreamNormalizer({ format: 'jsonl' });
  bad.write('{"ok":true}\n{"name":"Al');
  assert.throws(() => bad.end(), SyntaxError);
  assert.equal(bad.snapshot().status['/1/name'], 'partial');
});

for (const [format, separator] of [
  ['csv', ','],
  ['tsv', '\t'],
] as const) {
  test(`${format} exposes growing cells and distinguishes complete cells from complete rows`, () => {
    const parser = new StreamNormalizer({ format });
    let result = parser.write(`name${separator}bio\r\nAlice${separator}Software eng`);
    assert.deepEqual(result.data, [
      ['name', 'bio'],
      ['Alice', 'Software eng'],
    ]);
    assert.equal(result.status['/0'], 'complete');
    assert.equal(result.status['/1/0'], 'complete');
    assert.equal(result.status['/1/1'], 'partial');
    parser.write('ineer');
    assert.equal(parser.end().state, 'complete');
  });
}

test('CSV supports quoted commas, multiline fields, split escaped quotes and empty cells', () => {
  const parser = new StreamNormalizer({ format: 'csv' });
  assert.equal(parser.write('"Alice"').status['/0/0'], 'partial');
  assert.equal(at(parser.write('"s",').data, 0, 0), 'Alice"s');
  parser.write('"hello,\r\nworld",\r\n');
  assert.deepEqual(parser.end().data, [['Alice"s', 'hello,\r\nworld', '']]);
});

test('CSV rejects unterminated quotes and characters after closing quotes', () => {
  for (const input of ['"unfinished', '"ok"x', 'un"quoted']) {
    const parser = new StreamNormalizer({ format: 'csv' });
    assert.throws(() => {
      parser.write(input);
      parser.end();
    }, SyntaxError);
  }
});

test('new formats retain async iteration and maxLength behavior', async () => {
  for (const [format, source] of [
    ['yaml', 'name: Alice'],
    ['ndjson', '{"name":"Alice"}'],
    ['csv', 'name\nAlice'],
  ] as const) {
    let last;
    for await (const result of streamStructured([...source], { format })) last = result;
    assert.ok(last);
    assert.equal(last.state, 'complete');
    const small = new StreamNormalizer({ format, maxLength: 3 });
    assert.throws(() => small.write(source), RangeError);
  }
});
