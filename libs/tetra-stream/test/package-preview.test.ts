import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { packLibrary } from '../../../tools/pack-library.mts';

function fixture() {
  const workspace = mkdtempSync(join(tmpdir(), 'tetra-package-preview-'));
  const library = join(workspace, 'libs/tetra-stream');
  const downloads = join(workspace, 'apps/playground/public/downloads');
  mkdirSync(library, { recursive: true });
  mkdirSync(downloads, { recursive: true });
  writeFileSync(
    join(library, 'package.json'),
    JSON.stringify({ name: 'tetra-stream', version: '3.2.1' }),
  );
  writeFileSync(join(library, 'README.md'), 'A package fixture.\n');
  return { workspace, library, preview: join(downloads, 'tetra-stream.tgz') };
}

test('successful npm packing refreshes both versioned archive and stable preview', () => {
  const { workspace, preview } = fixture();
  try {
    writeFileSync(preview, 'previous preview');
    assert.equal(packLibrary(workspace), 0);
    const archive = readFileSync(join(workspace, 'artifacts/tetra-stream-3.2.1.tgz'));
    assert.ok(archive.byteLength > 0);
    assert.deepEqual(readFileSync(preview), archive);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('failed npm packing preserves the prior working preview', () => {
  const { workspace, library, preview } = fixture();
  try {
    writeFileSync(preview, 'previous preview');
    // A deliberately failing lifecycle hook exercises a real npm failure
    // without a network dependency or an executable test double.
    const manifest: unknown = JSON.parse(readFileSync(join(library, 'package.json'), 'utf8'));
    assert.ok(manifest && typeof manifest === 'object');
    writeFileSync(
      join(library, 'package.json'),
      JSON.stringify({ ...manifest, scripts: { prepack: 'exit 23' } }),
    );
    assert.notEqual(packLibrary(workspace), 0);
    assert.equal(readFileSync(preview, 'utf8'), 'previous preview');
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
