import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamNormalizer } from 'tetra-stream';
import { readProfile, readSkillItems } from '../src/profile.ts';

for (const [format, prefix, suffix] of [
  ['json', '{"name":"Alice","bio":"Software eng', 'ineer"}'],
  ['xml', '<user><name>Alice</name><bio>Software eng', 'ineer</bio></user>'],
  [
    'html',
    '<article><h2 data-field="name">Alice</h2><p data-field="bio">Software eng',
    'ineer</p></article>',
  ],
  ['yaml', 'name: "Alice"\nbio: Software eng', 'ineer\nwebsite: test'],
  ['yml', 'name: "Alice"\nbio: Software eng', 'ineer\nwebsite: test'],
  ['ndjson', '{"name":"Alice"}\n{"bio":"Software eng', 'ineer"}\n'],
  ['jsonl', '{"name":"Alice"}\n{"bio":"Software eng', 'ineer"}\n'],
  ['csv', 'name,bio\nAlice,Software eng', 'ineer\n'],
  ['tsv', 'name\tbio\nAlice\tSoftware eng', 'ineer\n'],
] as const) {
  test(`user card binding renders ${format} fields while text is still growing`, () => {
    const parser = new StreamNormalizer({ format });
    const first = readProfile(parser.write(prefix));
    assert.deepEqual(first.name, { value: 'Alice', status: 'complete' });
    assert.deepEqual(first.bio, { value: 'Software eng', status: 'partial' });
    assert.equal(first.role.status, 'pending');
    const last = readProfile(parser.write(suffix));
    assert.deepEqual(last.bio, { value: 'Software engineer', status: 'complete' });
  });
}

test('non-string skills do not shift completion states onto later string values', () => {
  const parser = new StreamNormalizer();
  const snapshot = parser.write('{"skills":[0,"Ali');
  assert.deepEqual(readSkillItems(snapshot), [{ value: 'Ali', status: 'partial', sourceIndex: 1 }]);
});

test('user card binding keeps empty strings and ignores markup outside configured fields', () => {
  const parser = new StreamNormalizer();
  assert.deepEqual(readProfile(parser.write('{"name":""}')).name, {
    value: '',
    status: 'complete',
  });
  const html = new StreamNormalizer({ format: 'html' });
  assert.equal(
    readProfile(html.write('<script>window.pwned=true</script>')).name.status,
    'pending',
  );
});

for (const format of ['xml', 'html'] as const) {
  test(`${format} skill items become complete independently of their parent`, () => {
    const parser = new StreamNormalizer({ format });
    const source =
      format === 'xml'
        ? '<user><skills><skill>Design</skill><skill>Cod'
        : '<article><ul data-field="skills"><li>Design</li><li>Cod';
    const result = readProfile(parser.write(source));
    assert.equal(result.skills.status, 'partial');
    assert.deepEqual(result.skills.itemStatus, ['complete', 'partial']);
  });
}
