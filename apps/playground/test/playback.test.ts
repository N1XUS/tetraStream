import test from 'node:test';
import assert from 'node:assert/strict';
import * as playback from '../src/seek-stream.ts';
import { readAvatarSource, readProfile } from '../src/profile.ts';
import { readCsvGrid } from '../src/csv-grid.ts';
import { examples } from '../src/fixtures.ts';

test('rewinding removes future values and withholds an unfinished avatar URL', () => {
  assert.equal(typeof playback.seekStream, 'function');
  const source = '{"name":"Alex","avatar":"/avatar.png","bio":"Hello world"}';
  const full = playback.seekStream(source, 'json', source.length);
  assert.equal(readAvatarSource(full.snapshot), '/avatar.png');
  const cursor = source.indexOf('.png');
  const rewound = playback.seekStream(source, 'json', cursor);
  assert.equal(rewound.position, cursor);
  assert.equal(readAvatarSource(rewound.snapshot), undefined);
  assert.equal(readProfile(rewound.snapshot).avatar.status, 'partial');
  assert.equal(readProfile(rewound.snapshot).bio.status, 'pending');
  rewound.parser.write(source.slice(cursor));
  assert.equal(readProfile(rewound.parser.end()).bio.value, 'Hello world');
});

test('seeking to the end finalizes each supported profile format; zero restores pending fields', () => {
  assert.equal(typeof playback.seekStream, 'function');
  for (const format of [
    'json',
    'yaml',
    'yml',
    'xml',
    'html',
    'ndjson',
    'jsonl',
    'csv',
    'tsv',
  ] as const) {
    const full = playback.seekStream(examples[format], format, examples[format].length);
    assert.equal(full.snapshot.state, 'complete', format);
    assert.equal(readProfile(full.snapshot).name.value, 'Alex Morgan', format);
    const start = playback.seekStream(examples[format], format, 0);
    assert.equal(start.snapshot.state, 'streaming', format);
    assert.equal(readProfile(start.snapshot).name.status, 'pending', format);
  }
});

test('CSV seeking removes future rows and keeps an unfinished cell partial', () => {
  assert.equal(typeof playback.seekStream, 'function');
  const source = 'Name,Role\nAlex,Designer\nSam,Engineer';
  assert.equal(
    readCsvGrid(playback.seekStream(source, 'csv', source.length).snapshot).rows.length,
    2,
  );
  const midway = playback.seekStream(source, 'csv', 14); // Name,Role\nAlex
  const grid = readCsvGrid(midway.snapshot);
  assert.equal(grid.rows.length, 1);
  assert.equal(grid.rows[0].cells[0].value, 'Alex');
  assert.equal(grid.rows[0].cells[0].status, 'partial');
  assert.equal(grid.completeRows, 0);
});

test('a malformed suffix reports the parser error and rewinding before it allows recovery', () => {
  assert.equal(typeof playback.seekStream, 'function');
  const source = '{"name":"Alex",oops}';
  assert.equal(playback.seekStream(source, 'json', source.length).snapshot.state, 'error');
  const recovered = playback.seekStream(source, 'json', 14); // before the invalid key
  assert.equal(recovered.snapshot.state, 'streaming');
  assert.equal(readProfile(recovered.snapshot).name.value, 'Alex');
});

test('playback clamps to source boundaries and handles an empty response', () => {
  assert.equal(typeof playback.seekStream, 'function');
  assert.equal(playback.seekStream('{}', 'json', -10).position, 0);
  assert.equal(playback.seekStream('{}', 'json', 99).position, 2);
  const empty = playback.seekStream('', 'json', 0);
  assert.equal(empty.position, 0);
  assert.equal(empty.snapshot.state, 'streaming');
});
