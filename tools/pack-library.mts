import { copyFileSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Build the installable archive and refresh the website's stable download. */
export function packLibrary(workspace: string = workspaceRoot): number {
  const library = join(workspace, 'libs/tetra-stream');
  const manifest: unknown = JSON.parse(readFileSync(join(library, 'package.json'), 'utf8'));
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    !('name' in manifest) ||
    typeof manifest.name !== 'string' ||
    !('version' in manifest) ||
    typeof manifest.version !== 'string'
  ) {
    throw new TypeError('The library manifest must declare its package name and version');
  }
  const artifacts = join(workspace, 'artifacts');
  mkdirSync(artifacts, { recursive: true });
  const result = spawnSync('npm', ['pack', library, '--pack-destination', artifacts], {
    cwd: workspace,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) return result.status ?? 1;

  const archive = `${manifest.name.replace(/^@/, '').replace('/', '-')}-${manifest.version}.tgz`;
  const downloads = join(workspace, 'apps/playground/public/downloads');
  mkdirSync(downloads, { recursive: true });
  const preview = join(downloads, 'tetra-stream.tgz');
  // Rename only after a successful copy so an unsuccessful refresh leaves the
  // previous complete download available to an already-running dev server.
  copyFileSync(join(artifacts, archive), `${preview}.tmp`);
  renameSync(`${preview}.tmp`, preview);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = packLibrary();
}
