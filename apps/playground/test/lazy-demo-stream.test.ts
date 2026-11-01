import assert from 'node:assert/strict';
import test from 'node:test';
import { LazyDemoStream } from '../src/lazy-demo-stream.ts';
import { StreamNormalizer, seekStream } from '../src/seek-stream.ts';

const engine = { StreamNormalizer, seekStream };

test('initial render and reset never download a parser', () => {
  let loads = 0;
  const stream = new LazyDemoStream('json', async () => {
    loads++;
    return engine;
  });
  assert.deepEqual(stream.snapshot(), {
    format: 'json',
    data: undefined,
    status: {},
    state: 'streaming',
  });
  stream.reset('yaml');
  assert.equal(stream.snapshot().format, 'yaml');
  assert.equal(loads, 0);
});

test('loads on demand and preserves nested values and completion', async () => {
  const stream = new LazyDemoStream('json', async () => engine);
  assert.equal(await stream.prepare(), true);
  assert.equal(stream.write('{"projects":[{"name":"Li').status['/projects/0/name'], 'partial');
  stream.write('ve"}]}');
  assert.equal(stream.end().state, 'complete');
  assert.deepEqual(stream.snapshot().data, { projects: [{ name: 'Live' }] });
});

test('reset during import discards stale work; seeking uses the latest format', async () => {
  let finish!: (value: typeof engine) => void;
  const loaded = new Promise<typeof engine>((resolve) => {
    finish = resolve;
  });
  const stream = new LazyDemoStream('json', () => loaded);
  const old = stream.prepare();
  stream.reset('csv');
  finish(engine);
  assert.equal(await old, false);
  const replay = await stream.seek('name\nAlex\n', 10);
  assert.equal(replay?.snapshot.state, 'complete');
  assert.deepEqual(replay?.snapshot.data, [['name'], ['Alex']]);
});

test('only the latest pending seek or prepare commits', async () => {
  const stream = new LazyDemoStream('json', async () => engine);
  const first = stream.seek('{"name":"Alex"}', 15);
  const second = stream.seek('{"name":"Alex"}', 11);
  assert.equal(await first, undefined);
  assert.equal((await second)?.position, 11);
  assert.equal(stream.snapshot().state, 'streaming');
});

test('a failed download can be retried and cancelled work never starts playback', async () => {
  let attempts = 0;
  const stream = new LazyDemoStream('json', async () => {
    if (++attempts === 1) throw new Error('Offline');
    return engine;
  });
  await assert.rejects(stream.prepare(), /Offline/);
  const pending = stream.prepare();
  stream.cancelPending();
  assert.equal(await pending, false);
  assert.equal(await stream.prepare(), true);
});
