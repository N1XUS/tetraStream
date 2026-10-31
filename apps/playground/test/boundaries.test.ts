import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamNormalizer, type MarkupDocument } from 'tetra-stream';
import { examples } from '../src/fixtures.ts';
import { readProfile } from '../src/profile.ts';

test('JSON final values match the standard parser at every possible two-chunk split', () => {
  const cases = ['null', 'true', 'false', '0', '-0', '1.25e-20', '""', '"quotes \\" slash \\\\ café 海🌊"', '[]', '{}', '[1,2,3]', '{"nested":[{"x":null,"y":false},[],{}]}', '{"__proto__":{"polluted":true},"constructor":7,"a/b~c":4}'];
  for (const source of cases) {
    for (let split = 0; split <= source.length; split++) {
      const parser = new StreamNormalizer();
      parser.write(source.slice(0, split));
      parser.write(source.slice(split));
      const result = parser.end();
      assert.deepEqual(result.data, JSON.parse(source), `${source}, split ${split}`);
      assert.ok(Object.values(result.status).every(status => status === 'complete'));
    }
  }
});

for (const format of ['json', 'yaml', 'yml', 'xml', 'html', 'ndjson', 'jsonl', 'csv', 'tsv'] as const) {
  test(`${format} user-card data survives every possible two-chunk split`, () => {
    const source = examples[format];
    for (let split = 0; split <= source.length; split++) {
      const parser = new StreamNormalizer({ format });
      parser.write(source.slice(0, split));
      parser.write(source.slice(split));
      const result = parser.end();
      const profile = readProfile(result);
      assert.equal(profile.name.value, 'Alex Morgan', `split ${split}`);
      assert.equal(profile.bio.value, 'Making complex things feel simple. Currently exploring the space between thoughtful design and useful technology.');
      assert.deepEqual(profile.skills.value, ['Interface design', 'Creative coding', 'Prototyping']);
      assert.ok(Object.values(result.status).every(status => status === 'complete'));
    }
  });
}

test('XML comments, instructions, CDATA, references, and namespaces survive arbitrary boundaries', () => {
  const source = '<?xml version="1.0"?><a xmlns:p="urn:test" p:v="&#x80;">one<!-- ignored -->two<?pi ignored?>three<![CDATA[four&<]]>five</a>';
  for (let split = 0; split <= source.length; split++) {
    const parser = new StreamNormalizer<MarkupDocument>({ format: 'xml' });
    parser.write(source.slice(0, split));
    parser.write(source.slice(split));
    const result = parser.end();
    const element = result.data?.children?.[0];
    assert.ok(element?.kind === 'element');
    assert.deepEqual(element.attributes, { 'xmlns:p': 'urn:test', 'p:v': '\u0080' });
    assert.deepEqual(element.children?.map(node => { assert.ok(node.kind === 'text'); return node.value; }), ['one', 'two', 'three', 'four&<', 'five'], `split ${split}`);
  }
});

test('XML 1.1 normalizes literal NEL and line separators but preserves references', () => {
  const parser = new StreamNormalizer<MarkupDocument>({ format: 'xml' });
  for (const char of '<?xml version="1.1"?><a>x\u0085y\u2028z\r\u0085w&#x85;</a>') parser.write(char);
  const node = parser.end().data?.children?.[0];
  assert.ok(node?.kind === 'element');
  const child = node.children?.[0];
  assert.ok(child?.kind === 'text');
  assert.equal(child.value, 'x\ny\nz\nw\u0085');
});
