import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fromSSE, fromNDJSON, createPatchState, applyPatchBatch } from 'tetra-stream/client';
import { wireServerSSE, wireServerNDJSON } from '../src/wire-guide.ts';
const folder = mkdtempSync(join(tmpdir(), 'tetra-wire-guide-'));
symlinkSync(resolve('node_modules'), join(folder, 'node_modules'), 'dir');
after(() => rmSync(folder, { recursive: true, force: true }));
for (const [transport, code] of [
  ['sse', wireServerSSE],
  ['ndjson', wireServerNDJSON],
] as const) {
  test(`copyable ${transport} server recipe streams partial nested profile data to completion`, async () => {
    const file = join(folder, transport + '.mts');
    writeFileSync(file, code);
    const module = (await import(pathToFileURL(file).href)) as {
      POST: (request: Request) => Response;
    };
    const response = module.POST(
      new Request('https://example.com/api/profile', { method: 'POST' }),
    );
    const frames = transport === 'sse' ? fromSSE(response) : fromNDJSON(response);
    const state = createPatchState<{ name: string; bio: string; projects: { name: string }[] }>();
    let partial = false;
    let complete = false;
    for await (const frame of frames) {
      applyPatchBatch(state, frame);
      partial ||= state.data?.name === 'Al' && state.status['/name'] === 'partial';
      complete ||= state.state === 'complete';
    }
    assert.ok(partial);
    assert.ok(complete);
    assert.equal(state.data?.name, 'Alex Morgan');
    assert.equal(state.data?.projects?.[0]?.name, 'Live profile');
  });
}
