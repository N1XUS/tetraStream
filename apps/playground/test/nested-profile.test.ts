import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamNormalizer } from 'tetra-stream';
import { examples } from '../src/fixtures.ts';
import { readNestedProfile } from '../src/nested-profile.ts';
import { seekStream } from '../src/seek-stream.ts';

test('nested project text and stack items stream before their object and array close', () => {
  const parser = new StreamNormalizer();
  let snapshot = parser.write('{"contact":{"email":"alex@');
  let profile = readNestedProfile(snapshot);
  assert.equal(profile.email.value, 'alex@');
  assert.equal(profile.email.status, 'partial');
  snapshot = parser.write(
    'example.com"},"projects":[{"name":"Grid","details":{"summary":"Live cells","stack":["TypeScript","Riv',
  );
  profile = readNestedProfile(snapshot);
  assert.equal(profile.email.status, 'complete');
  assert.equal(profile.projectsStatus, 'partial');
  assert.equal(profile.projects[0].status, 'partial');
  assert.equal(profile.projects[0].name.status, 'complete');
  assert.equal(profile.projects[0].stack[0].status, 'complete');
  assert.equal(profile.projects[0].stack[1].value, 'Riv');
  assert.equal(profile.projects[0].stack[1].status, 'partial');
  assert.equal(profile.projects[0].stack[1].path, '/projects/0/details/stack/1');
  parser.write('etJS"]}},{"name":"Second","details":{"stack":["CS');
  profile = readNestedProfile(parser.snapshot());
  assert.equal(profile.projects[0].status, 'complete');
  assert.equal(profile.projects[1].status, 'partial');
  assert.equal(profile.projects[1].stack[0].status, 'partial');
  parser.write('S"]}}]}');
  profile = readNestedProfile(parser.end());
  assert.equal(profile.projectsStatus, 'complete');
  assert.ok(profile.projects.every((project) => project.status === 'complete'));
});

test('JSON Lines uses the latest nested update and its real source pointers', () => {
  const parser = new StreamNormalizer({ format: 'ndjson' });
  parser.write(
    '{"projects":[{"name":"Old"}]}\n{"contact":{"socials":[{"network":"GitHub","handle":"@alex"}]}}\n',
  );
  const profile = readNestedProfile(
    parser.write('{"projects":[{"name":"New","details":{"stack":["Riv'),
  );
  assert.equal(profile.socials[0].handle.value, '@alex');
  assert.equal(profile.socials[0].handle.path, '/1/contact/socials/0/handle');
  assert.equal(profile.projects[0].name.value, 'New');
  assert.equal(profile.projects[0].stack[0].path, '/2/projects/0/details/stack/0');
  assert.equal(profile.projects[0].stack[0].status, 'partial');
});

test('rewinding drops future nested objects and values and restores partial statuses', () => {
  const source = '{"projects":[{"name":"One","details":{"stack":["RivetJS"]}},{"name":"Two"}]}';
  const full = readNestedProfile(seekStream(source, 'json', source.length).snapshot);
  assert.equal(full.projects.length, 2);
  const earlier = readNestedProfile(
    seekStream(source, 'json', source.indexOf('Rivet') + 3).snapshot,
  );
  assert.equal(earlier.projects.length, 1);
  assert.equal(earlier.projects[0].stack[0].value, 'Riv');
  assert.equal(earlier.projects[0].stack[0].status, 'partial');
  assert.equal(readNestedProfile(seekStream(source, 'json', 0).snapshot).projects.length, 0);
});

test('non-object entries and non-string stack items retain their original array positions', () => {
  const parser = new StreamNormalizer();
  const profile = readNestedProfile(
    parser.write('{"projects":[null,{"name":"Kept","details":{"stack":[1,"Riv'),
  );
  assert.equal(profile.projects[0].sourceIndex, 1);
  assert.equal(profile.projects[0].stack[0].sourceIndex, 1);
  assert.equal(profile.projects[0].stack[0].path, '/projects/1/details/stack/1');
});

for (const format of ['json', 'yaml', 'yml', 'ndjson', 'jsonl'] as const) {
  test(`${format} demo includes nested contact objects and project arrays`, () => {
    const parser = new StreamNormalizer({ format });
    parser.write(examples[format]);
    const profile = readNestedProfile(parser.end());
    assert.equal(profile.email.value, 'alex@example.com');
    assert.equal(profile.socials[0].handle.value, '@alexmorgan');
    assert.equal(profile.projects.length, 2);
    assert.equal(profile.projects[0].name.value, 'Live data grid');
    assert.deepEqual(
      profile.projects[0].stack.map((item) => item.value),
      ['TypeScript', 'RivetJS'],
    );
    assert.equal(profile.projects[1].status, 'complete');
  });
}

test('empty or unavailable nested values settle after EOF and flat formats stay supported', () => {
  const parser = new StreamNormalizer();
  parser.write('{"projects":[]}');
  const profile = readNestedProfile(parser.end());
  assert.equal(profile.email.status, 'missing');
  assert.equal(profile.projectsStatus, 'complete');
  for (const format of ['csv', 'tsv', 'xml', 'html'] as const) {
    assert.equal(readNestedProfile(new StreamNormalizer({ format }).snapshot()).supported, false);
  }
});

test('closed empty child arrays complete independently of their open parent objects', () => {
  const parser = new StreamNormalizer();
  let profile = readNestedProfile(parser.write('{"contact":{"socials":[],"email":"still'));
  assert.equal(profile.contactStatus, 'partial');
  assert.equal(profile.socialsStatus, 'complete');
  assert.equal(profile.socials.length, 0);
  parser.write(' writing"},"projects":[{"details":{"stack":[]},"name":"grow');
  profile = readNestedProfile(parser.snapshot());
  assert.equal(profile.projects[0].status, 'partial');
  assert.equal(profile.projects[0].stackStatus, 'complete');
  assert.equal(profile.projects[0].stack.length, 0);
});
