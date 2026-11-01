import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve('dist/apps/playground/client');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const ahead = /data-fo="([^"]+)"/.exec(html)?.[1];
assert.ok(ahead, 'Expected Rivet fetch-ahead metadata in the production homepage');
const later = /data-fl="([^"]*)"/.exec(html)?.[1] ?? '';
const files = [...new Set((ahead + ' ' + later).trim().split(/\s+/))].filter((file) =>
  file.endsWith('.js'),
);
const chunks = files.map((file) => {
  const source = readFileSync(resolve(root, '.' + file));
  return { file, bytes: source.length, gzip: gzipSync(source, { level: 9 }).length };
});
const result = {
  chunks: chunks.length,
  bytes: chunks.reduce((sum, chunk) => sum + chunk.bytes, 0),
  gzip: chunks.reduce((sum, chunk) => sum + chunk.gzip, 0),
};
console.log(
  JSON.stringify(
    { homepage: result, largest: chunks.sort((a, b) => b.bytes - a.bytes).slice(0, 6) },
    null,
    2,
  ),
);
// Count the entire idle fetch-ahead list, not only the HTML entry script.
assert.ok(result.bytes <= 550_000, `Homepage JS exceeds 550 kB: ${result.bytes} bytes`);
assert.ok(result.gzip <= 190_000, `Homepage JS exceeds 190 kB gzip: ${result.gzip} bytes`);
