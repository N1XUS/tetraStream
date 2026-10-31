import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TestScheduler } from 'rxjs/testing';
import type { Observable } from 'rxjs';
import type { Snapshot } from 'tetra-stream';
import { rxjsPipelineCode } from '../src/rxjs-guide.ts';

type ProfileSnapshot = Snapshot<{ name: string; bio: string }>;
type GenerateProfile = (
  delayMs?: number,
  chunks?: readonly string[],
) => Observable<ProfileSnapshot>;
const folder = mkdtempSync(join(tmpdir(), 'tetra-rxjs-guide-'));
symlinkSync(resolve('node_modules'), join(folder, 'node_modules'), 'dir');
const file = join(folder, 'rxjs-guide.mts');
writeFileSync(file, rxjsPipelineCode);
after(() => rmSync(folder, { recursive: true, force: true }));
const module: unknown = await import(pathToFileURL(file).href);
assert.ok(module && typeof module === 'object' && 'generateProfile$' in module);
assert.equal(typeof module.generateProfile$, 'function');
const generateProfile$ = module.generateProfile$ as GenerateProfile;
const scheduler = () => new TestScheduler((actual, expected) => assert.deepEqual(actual, expected));

test('the RxJS generate recipe exposes a partial value before later chunks and finalizes once', () => {
  const clock = scheduler();
  clock.run(({ flush }) => {
    const values: ProfileSnapshot[] = [];
    let completions = 0;
    generateProfile$(10).subscribe({
      next: (value) => values.push(value),
      complete: () => completions++,
    });
    clock.schedule(() => {
      assert.equal(values.length, 1);
      assert.equal(values[0].data?.name, 'Al');
      assert.equal(values[0].status['/name'], 'partial');
      assert.equal(values[0].state, 'streaming');
      assert.equal(completions, 0);
    }, 11);
    flush();
    assert.equal(values.length, 4);
    assert.equal(values[1].data?.name, 'Alex Morgan');
    assert.equal(values[1].status['/name'], 'complete');
    assert.equal(values[1].status['/bio'], 'partial');
    assert.equal(values[2].state, 'streaming');
    assert.equal(values[3].state, 'complete');
    assert.equal(completions, 1);
  });
});

test('each subscription owns a fresh parser', () => {
  scheduler().run(({ flush }) => {
    const source = generateProfile$(10);
    const left: ProfileSnapshot[] = [];
    const right: ProfileSnapshot[] = [];
    source.subscribe((value) => left.push(value));
    source.subscribe((value) => right.push(value));
    flush();
    assert.equal(left.length, 4);
    assert.deepEqual(left, right);
    assert.notEqual(left[0], right[0]);
    assert.equal(left[0].data?.name, 'Al');
  });
});

test('unsubscribe cancels paced generation without finalizing an unfinished document', () => {
  const clock = scheduler();
  clock.run(({ flush }) => {
    const values: ProfileSnapshot[] = [];
    let completed = false;
    const subscription = generateProfile$(10).subscribe({
      next: (value) => values.push(value),
      complete: () => {
        completed = true;
      },
    });
    clock.schedule(() => subscription.unsubscribe(), 15);
    flush();
    assert.equal(subscription.closed, true);
    assert.equal(values.length, 1);
    assert.equal(values[0].state, 'streaming');
    assert.equal(values[0].status['/name'], 'partial');
    assert.equal(completed, false);
  });
});

test('invalid or truncated JSON errors without emitting a successful final snapshot', () => {
  for (const chunks of [['{"name":"Al'], ['{"name":"Al', 'ex",oops}']]) {
    scheduler().run(({ flush }) => {
      const values: ProfileSnapshot[] = [];
      const errors: unknown[] = [];
      let completed = false;
      generateProfile$(10, chunks).subscribe({
        next: (value) => values.push(value),
        error: (error) => errors.push(error),
        complete: () => {
          completed = true;
        },
      });
      flush();
      assert.equal(errors.length, 1);
      assert.ok(errors[0] instanceof SyntaxError);
      assert.equal(completed, false);
      assert.equal(values.length, 1);
      assert.equal(values[0].data?.name, 'Al');
      assert.ok(values.every((value) => value.state === 'streaming'));
    });
  }
});
