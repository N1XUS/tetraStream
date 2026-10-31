import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { integrationExamples } from '../src/integration-examples.ts';
import { guideExamples } from '../src/guide-examples.ts';

function exampleWorkspace(run: (folder: string) => void) {
  const folder = mkdtempSync(join(tmpdir(), 'tetrastream-examples-'));
  try {
    symlinkSync(resolve('node_modules'), join(folder, 'node_modules'), 'dir');
    run(folder);
  } finally { rmSync(folder, { recursive: true, force: true }); }
}

test('every homepage and guide TypeScript example compiles without ambient application stubs', () => {
  exampleWorkspace(folder => {
    const snippets = { homepage: integrationExamples.stream, ...guideExamples };
    const files = Object.entries(snippets).map(([key, source]) => {
      const file = join(folder, `${key}.${key === 'rivet' ? 'tsx' : 'mts'}`);
      writeFileSync(file, source);
      return file;
    });
    const check = spawnSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--jsx', 'preserve', '--jsxImportSource', '@rivetjs/runtime', '--lib', 'ES2022,DOM,DOM.Iterable', ...files], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stdout + check.stderr);
  });
});

test('the completion guide example actually withholds the partial avatar and finalizes EOF', () => {
  exampleWorkspace(folder => {
    const file = join(folder, 'fields.mts');
    writeFileSync(file, guideExamples.fields);
    const run = spawnSync(process.execPath, [file], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), 'Alex\npending\n/avatars/alex-morgan.png\ncomplete');
  });
});
