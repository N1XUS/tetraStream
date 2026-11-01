import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { build } from 'vite';

// Keep every public export, not just one cherry-picked consumer function.
const result = await build({
  configFile: false,
  logLevel: 'silent',
  build: {
    write: false,
    minify: true,
    lib: { entry: resolve('libs/tetra-stream/dist/client.js'), formats: ['es'] },
  },
});
const outputs = Array.isArray(result) ? result : [result];
let bytes = 0;
let gzip = 0;
const modules = new Set<string>();
for (const output of outputs) {
  assert.ok('output' in output, 'Expected a one-shot client build');
  for (const chunk of output.output) {
    if (chunk.type !== 'chunk') continue;
    assert.equal(chunk.imports.length, 0, 'Client must have no external runtime dependencies');
    assert.equal(chunk.dynamicImports.length, 0, 'Client must not lazy-load parsers');
    for (const id of chunk.moduleIds) {
      modules.add(id);
      assert.ok(!id.includes('/node_modules/'), `Third-party client dependency: ${id}`);
      assert.ok(
        !/\/(?:normalizer|validation|json|json-lines|yaml|markup|xml|css|delimited)\.js$/.test(id),
        `Parser reached by client: ${id}`,
      );
    }
    bytes += Buffer.byteLength(chunk.code);
    gzip += gzipSync(chunk.code, { level: 9 }).length;
  }
}
console.log(
  JSON.stringify(
    { client: { bytes, gzip, modules: [...modules].map((id) => id.split('/').pop()) } },
    null,
    2,
  ),
);
assert.ok(gzip <= 8_000, `Parser-free client exceeds 8 kB gzip: ${gzip}`);
