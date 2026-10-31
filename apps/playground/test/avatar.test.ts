import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamNormalizer } from 'tetra-stream';
import * as binding from '../src/profile.ts';
import { examples } from '../src/fixtures.ts';

const avatar = '/avatars/alex-morgan.png';
const cases = [
  ['json', '{"avatar":"', '"', ',"bio":"Still writing'],
  ['yaml', 'avatar: "', '"\n', 'bio: Still writing'],
  ['yml', 'avatar: "', '"\n', 'bio: Still writing'],
  ['xml', '<user><avatar>', '</avatar>', '<bio>Still writing'],
  ['html', '<article><span data-field="avatar">', '</span>', '<p data-field="bio">Still writing'],
  ['ndjson', '{"avatar":"', '"}\n', '{"bio":"Still writing'],
  ['jsonl', '{"avatar":"', '"}\n', '{"bio":"Still writing'],
  ['csv', 'avatar,bio\n"', '",', 'Still writing'],
  ['tsv', 'avatar\tbio\n"', '"\t', 'Still writing'],
] as const;

for (const [format, prefix, delimiter, rest] of cases) {
  test(`${format} avatar image source is withheld until the URL value is complete`, () => {
    assert.equal(typeof binding.readAvatarSource, 'function', 'the card needs a completion-gated image binding');
    const parser = new StreamNormalizer({ format });
    assert.equal(binding.readAvatarSource(parser.snapshot()), undefined);
    parser.write(prefix);
    for (const char of avatar) {
      const snapshot = parser.write(char);
      assert.equal(binding.readAvatarSource(snapshot), undefined, 'even a valid-looking URL must wait for its closing boundary');
    }
    const complete = parser.write(delimiter);
    assert.equal(binding.readAvatarSource(complete), avatar);
    assert.equal(complete.state, 'streaming', 'the avatar should not wait for the whole document');
    assert.equal(binding.readAvatarSource(parser.write(rest)), avatar);
  });

  test(`${format} demo includes a complete generated avatar URL`, () => {
    const parser = new StreamNormalizer({ format });
    parser.write(examples[format]);
    const profile = binding.readProfile(parser.end());
    assert.deepEqual(profile.avatar, { value: avatar, status: 'complete' });
  });
}

test('empty, non-string, and incomplete replacements never become avatar image sources', () => {
  assert.equal(typeof binding.readAvatarSource, 'function');
  for (const value of ['', null, 42, {}, []]) {
    const parser = new StreamNormalizer();
    assert.equal(binding.readAvatarSource(parser.write(JSON.stringify({ avatar: value }))), undefined);
  }
  const parser = new StreamNormalizer({ format: 'ndjson' });
  parser.write('{"avatar":"/avatars/first.png"}\n');
  assert.equal(binding.readAvatarSource(parser.write('{"avatar":"/avatars/new')), undefined);
});

test('missing and unusable avatar values stop pending when no URL can still arrive', () => {
  assert.equal(typeof binding.isAvatarPending, 'function');
  const missing = new StreamNormalizer();
  assert.equal(binding.isAvatarPending(missing.snapshot()), true);
  missing.write('{"name":"Alex Morgan"}');
  assert.equal(binding.isAvatarPending(missing.end()), false);
  for (const value of ['', null, 42, {}, []]) {
    const parser = new StreamNormalizer();
    assert.equal(binding.isAvatarPending(parser.write(JSON.stringify({ avatar: value }))), false);
  }
  const interrupted = new StreamNormalizer();
  interrupted.write('{"avatar":"/avatars/alex');
  assert.equal(binding.isAvatarPending(interrupted.snapshot()), true);
  try { interrupted.end(); } catch { /* An interrupted URL cannot finish. */ }
  assert.equal(binding.isAvatarPending(interrupted.snapshot()), false);
});
