import { at } from './helpers.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pointer, JSONValue, MarkupDocument } from '../dist/index.js';
import { StreamNormalizer } from '../dist/normalizer.js';

import { select } from '../dist/selection.js';

test('select withholds a partial string until its requested completion boundary', () => {
  const parser = new StreamNormalizer();
  let snapshot = parser.write('{"name":"Al');
  assert.deepEqual(select(snapshot, '/name'), {
    status: 'partial',
    state: 'streaming',
    value: 'Al',
  });
  assert.deepEqual(select(snapshot, '/name', { require: 'complete' }), {
    status: 'pending',
    state: 'streaming',
    completion: 'partial',
  });
  snapshot = parser.write('ice"');
  assert.deepEqual(select(snapshot, '/name', { require: 'complete' }), {
    status: 'complete',
    state: 'streaming',
    value: 'Alice',
  });
  assert.deepEqual(select(snapshot, '/name', { require: 'document' }), {
    status: 'pending',
    state: 'streaming',
    completion: 'complete',
  });
  parser.write('}');
  snapshot = parser.end();
  assert.deepEqual(select(snapshot, '/name', { require: 'document' }), {
    status: 'complete',
    state: 'complete',
    value: 'Alice',
  });
});

test('select distinguishes absent terminal fields from fields that may still arrive', () => {
  const parser = new StreamNormalizer();
  assert.deepEqual(select(parser.snapshot(), '/future'), { status: 'pending', state: 'streaming' });
  parser.write('{"done":{}}');
  assert.deepEqual(select(parser.snapshot(), '/done/future'), {
    status: 'missing',
    state: 'streaming',
  });
  assert.deepEqual(select(parser.end(), '/future'), { status: 'missing', state: 'complete' });
});

test('select retains complete fields after parse errors but withholds document policy', () => {
  const parser = new StreamNormalizer();
  parser.write('{"ready":false,"unfinished":"a');
  assert.throws(() => parser.end(), SyntaxError);
  const snapshot = parser.snapshot();
  assert.deepEqual(select(snapshot, '/ready', { require: 'complete' }), {
    status: 'complete',
    state: 'error',
    value: false,
  });
  assert.deepEqual(select(snapshot, '/unfinished'), {
    status: 'partial',
    state: 'error',
    value: 'a',
  });
  assert.deepEqual(select(snapshot, '/unfinished', { require: 'complete' }), {
    status: 'pending',
    state: 'error',
    completion: 'partial',
  });
  assert.deepEqual(select(snapshot, '/ready', { require: 'document' }), {
    status: 'pending',
    state: 'error',
    completion: 'complete',
  });
  assert.deepEqual(select(snapshot, '/absent'), { status: 'missing', state: 'error' });
});

test('select preserves falsy values, roots, escaped keys, arrays, and empty keys', () => {
  const parser = new StreamNormalizer();
  parser.write('{"a/b":{"~key":[null,false,0,""]},"":7}');
  const snapshot = parser.end();
  for (const [path, value] of [
    ['/a~1b/~0key/0', null],
    ['/a~1b/~0key/1', false],
    ['/a~1b/~0key/2', 0],
    ['/a~1b/~0key/3', ''],
    ['/', 7],
  ] as const) {
    assert.deepEqual(select(snapshot, path), { status: 'complete', state: 'complete', value });
  }
  assert.deepEqual(at(select(snapshot, ''), 'value'), {
    'a/b': { '~key': [null, false, 0, ''] },
    '': 7,
  });
});

test('select rejects malformed pointers and never follows inherited properties', () => {
  const parser = new StreamNormalizer();
  parser.write('{"items":["ok"],"__proto__":{"safe":true}}');
  const snapshot = parser.end();
  for (const path of [
    'name',
    '/bad~',
    '/bad~2escape',
    '#/items',
    '/items/01',
    '/items/-1',
    '/items/1.0',
  ]) {
    assert.throws(() => select(snapshot, path as Pointer<JSONValue | MarkupDocument>), TypeError);
  }
  for (const path of [
    '/constructor',
    '/toString',
    '/items/length',
    '/items/map',
    '/__proto__/constructor',
  ] as const) {
    assert.equal(select(snapshot, path).status, 'missing');
  }
  assert.equal(at(select(snapshot, '/__proto__/safe'), 'value'), true);
});

test('select infers descendant completion from completed containers in markup', () => {
  const parser = new StreamNormalizer({ format: 'xml' });
  let snapshot = parser.write('<user id="1"><name>Ada</name></user>');
  assert.deepEqual(select(snapshot, '/children/0/name', { require: 'complete' }), {
    status: 'complete',
    state: 'streaming',
    value: 'user',
  });
  snapshot = parser.end();
  assert.deepEqual(select(snapshot, '/children', { require: 'document' }), {
    status: 'complete',
    state: 'complete',
    value: at(snapshot.data, 'children'),
  });
});

test('select distinguishes a failed literal with no value from an exposed partial field', () => {
  const parser = new StreamNormalizer();
  parser.write('{"waiting":tr');
  assert.deepEqual(select(parser.snapshot(), '/waiting'), {
    status: 'pending',
    state: 'streaming',
  });
  assert.throws(() => parser.end(), SyntaxError);
  assert.deepEqual(select(parser.snapshot(), '/waiting'), { status: 'missing', state: 'error' });
});

test('select rejects malformed escape sequences even when the target field is absent', () => {
  const parser = new StreamNormalizer();
  parser.write('{}');
  const snapshot = parser.end();
  for (const path of ['/absent/~2', '/absent/~', '/absent/~00~3']) {
    assert.throws(() => select(snapshot, path as Pointer<JSONValue | MarkupDocument>), TypeError);
  }
});

test('require filters the current snapshot synchronously without waiting for future writes', () => {
  const parser = new StreamNormalizer<{ bio: string }>();
  const first = parser.write('{"bio":"Making com');
  const hidden = select(first, '/bio', { require: 'complete' });
  assert.equal(hidden.status, 'pending');
  assert.equal('value' in hidden, false);
  const visible = select(first, '/bio', { require: 'partial' });
  assert.equal(visible.status, 'partial');
  if ('value' in visible) assert.equal(visible.value, 'Making com');
  parser.write('plex things simple."}');
  assert.equal(
    hidden.status,
    'pending',
    'a selection is an immediate result, not a live subscription',
  );
  assert.equal(select(parser.snapshot(), '/bio', { require: 'complete' }).status, 'complete');
  assert.equal(select(parser.snapshot(), '/bio', { require: 'document' }).status, 'pending');
  assert.equal(select(parser.end(), '/bio', { require: 'document' }).status, 'complete');
});

test('unknown selection options are rejected instead of silently bypassing requirements', () => {
  const snapshot = new StreamNormalizer().write('{"name":"Al');
  assert.throws(
    () => select(snapshot, '/name', { when: 'complete' } as never),
    /Unsupported selection option/,
  );
});
