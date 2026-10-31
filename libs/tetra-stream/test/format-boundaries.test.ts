import test from 'node:test';
import assert from 'node:assert/strict';
import type { FormatName as Format, JSONValue } from '../dist/index.js';
import { StreamNormalizer } from '../dist/index.js';

const cases: [Format, string, JSONValue][] = [
  ['yaml', 'name: Alice\nbio: "Café\\u0020海"\nskills:\n  - Design\n  - Coding\nactive: false\nage: 25\nempty: null', { name: 'Alice', bio: 'Café 海', skills: ['Design', 'Coding'], active: false, age: 25, empty: null }],
  ['yml', "user: {name: 'Alice''s', skills: [Design, Coding]}\nbio: |\n  Hello\n  world\n", { user: { name: "Alice's", skills: ['Design', 'Coding'] }, bio: 'Hello\nworld\n' }],
  ['yaml', '- "Alice"\n- {bio: simple}\n- null\n', ['Alice', { bio: 'simple' }, null]],
  ['ndjson', '\n{"name":"海🌊"}\r\nfalse\n[1,2]\n', [{ name: '海🌊' }, false, [1, 2]]],
  ['csv', '\uFEFFname,bio,empty\r\n"Alice""s","Hello,\r\nworld",\r\n', [['name', 'bio', 'empty'], ['Alice"s', 'Hello,\r\nworld', '']]],
  ['tsv', 'name\tbio\nAlice\t"Hello\tworld"', [['name', 'bio'], ['Alice', 'Hello\tworld']]],
];

for (const [format, source, expected] of cases) {
  test(`${format} final data and completion are independent of chunk boundaries`, () => {
    for (let split = 0; split <= source.length; split++) {
      const parser = new StreamNormalizer({ format });
      parser.write(source.slice(0, split));
      parser.write(source.slice(split));
      const result = parser.end();
      assert.deepEqual(result.data, expected, `split ${split}`);
      assert.ok(Object.values(result.status).every(status => status === 'complete'), `split ${split}`);
    }
    const characters = new StreamNormalizer({ format });
    for (const char of source) characters.write(char);
    assert.deepEqual(characters.end().data, expected);
  });
}

test('empty record and tabular streams are empty arrays, not phantom records', () => {
  for (const format of ['csv', 'tsv', 'ndjson', 'jsonl'] as const) {
    const parser = new StreamNormalizer({ format });
    assert.deepEqual(parser.end().data, []);
  }
});

test('a quoted YAML root or sequence item stays partial while it could become a map key', () => {
  const root = new StreamNormalizer({ format: 'yaml' });
  assert.equal(root.write('"name"').status[''], 'partial');
  root.write(': Alice');
  assert.deepEqual(root.end().data, { name: 'Alice' });
  const list = new StreamNormalizer({ format: 'yaml' });
  assert.equal(list.write('- "name"').status['/0'], 'partial');
  list.write(': Alice');
  assert.deepEqual(list.end().data, [{ name: 'Alice' }]);
});
