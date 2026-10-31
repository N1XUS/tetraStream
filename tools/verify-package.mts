import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest: unknown = JSON.parse(readFileSync(join(workspace, 'libs/tetra-stream/package.json'), 'utf8'));
assert.ok(manifest !== null && typeof manifest === 'object' && 'version' in manifest && typeof manifest.version === 'string');
const archive = join(workspace, 'artifacts', `tetra-stream-${manifest.version}.tgz`);
assert.ok(existsSync(archive), 'Build the tarball with npm run pack first');
const consumer = mkdtempSync(join(tmpdir(), 'tetra-consumer-'));

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd: consumer, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} failed in ${consumer}`);
}

try {
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'tetra-package-check', private: true, type: 'module' }));
  run('npm', ['install', archive, 'zod@4', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund']);
  const installed = join(consumer, 'node_modules/tetra-stream');
  const packed: unknown = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
  assert.ok(packed !== null && typeof packed === 'object' && 'dependencies' in packed);
  assert.ok(packed.dependencies !== null && typeof packed.dependencies === 'object');
  assert.deepEqual(Object.keys(packed.dependencies).sort(), ['htmlparser2', 'postcss', 'postcss-safe-parser', 'saxes', 'yaml']);
  for (const excluded of ['src', 'test', 'apps', 'node_modules/@rivetjs']) {
    assert.equal(existsSync(join(installed, excluded)), false, `${excluded} must not be distributed`);
  }
  writeFileSync(join(consumer, 'consumer-runtime.mts'), `
    import assert from 'node:assert/strict';
    import { Format, StreamNormalizer, streamStructured, streamPatches, createPatchState, applyPatchBatch, select, validateSnapshot, streamValidated } from 'tetra-stream';
    import type { CssDocument, LanguageStrategy } from 'tetra-stream';
    import { z } from 'zod';
    function at(value: unknown, ...path: PropertyKey[]): unknown {
      for (const key of path) {
        assert.ok(value !== null && typeof value === 'object');
        value = (value as Record<PropertyKey, unknown>)[key];
      }
      return value;
    }
    assert.equal(Format.CSS, 'css');
    const strategy: LanguageStrategy<{ text: string }> = {
      format: 'plain', create() {
        let text = '';
        return {
          write(chunk) { text += chunk; return { data: { text }, status: { '/text': 'partial' } }; },
          end() { return { data: { text }, status: { '': 'complete', '/text': 'complete' } }; },
        };
      },
    };
    const custom = new StreamNormalizer({ format: strategy });
    const typedText: string | undefined = custom.write('live').data?.text;
    assert.equal(typedText, 'live');
    assert.equal(custom.end().state, 'complete');
    const json = new StreamNormalizer<{ name: string }>({ format: Format.JSON });
    const first = json.write('{"name":"Al');
    assert.equal(first.data?.name, 'Al');
    assert.equal(first.status['/name'], 'partial');
    json.write('ice"}');
    assert.equal(json.end().state, 'complete');
    const xml = new StreamNormalizer({ format: 'xml' });
    const midway = xml.write('<user><![CDATA[Hel');
    assert.equal(at(midway.data, 'children', 0, 'children', 0, 'value'), 'Hel');
    xml.write('lo]]></user>');
    assert.equal(xml.end().state, 'complete');
    const html = new StreamNormalizer({ format: 'html' });
    html.write('<p>Hello');
    assert.equal(at(html.end().data, 'children', 0, 'children', 0, 'value'), 'Hello');
    let last;
    for await (const snapshot of streamStructured<{ x: boolean }>(['{"x":', 'true}'])) last = snapshot;
    assert.ok(last);
    assert.equal(last.state, 'complete');
    assert.equal(last.data?.x, true);
    for (const [format, input, expected] of [
      ['yaml', 'name: Alice', { name: 'Alice' }],
      ['yml', 'name: Alice', { name: 'Alice' }],
      ['ndjson', '{"name":"Alice"}', [{ name: 'Alice' }]],
      ['jsonl', '{"name":"Alice"}', [{ name: 'Alice' }]],
      ['csv', 'name,bio', [['name', 'bio']]],
      ['tsv', 'name\\tbio', [['name', 'bio']]],
    ] as const) {
      const parser = new StreamNormalizer({ format });
      for (const char of input) parser.write(char);
      assert.deepEqual(parser.end().data, expected);
    }
    const css = new StreamNormalizer<CssDocument>({ format: 'css' });
    const growingCss = css.write('.ai-card { color: re');
    assert.equal(at(growingCss.data, 'nodes', 0, 'nodes', 0, 'value'), 're');
    assert.equal(growingCss.status['/nodes/0/nodes/0/value'], 'partial');
    css.write('d; }');
    assert.equal(css.end().status['/nodes/0/nodes/0/value'], 'complete');
    const patches = createPatchState<{ name: string }>();
    for await (const batch of streamPatches(['{"name":"Al', 'ice"}'])) applyPatchBatch(patches, batch);
    const selected = select(patches, '/name', { when: 'complete' });
    assert.ok(selected.status === 'complete');
    assert.equal(selected.value, 'Alice');
    const schema = z.object({ name: z.string().min(1), age: z.string().transform(Number) });
    let validated;
    for await (const item of streamValidated(['{"name":"Alice","age":"25"}'], { schema })) validated = item;
    assert.ok(validated?.validation.status === 'valid');
    assert.deepEqual(validated.validation.value, { name: 'Alice', age: 25 });
    assert.deepEqual(validated.data, { name: 'Alice', age: '25' });
    const invalid = await validateSnapshot({ format: 'json', state: 'complete', data: {}, status: { '': 'complete' } }, schema);
    assert.equal(invalid.status, 'invalid');
    console.log('Packed ESM formats including CSS, patches, selections and real Zod 4 validation passed.');
  `);
  writeFileSync(join(consumer, 'consumer.mts'), `
    import { Format, StreamNormalizer, streamStructured, streamValidated, streamPatches, createPatchState, applyPatchBatch, select, type Snapshot } from 'tetra-stream';
    import type { CssDocument, LanguageStrategy } from 'tetra-stream';
    import { z } from 'zod';
    new StreamNormalizer({ format: 'yml' });
    new StreamNormalizer({ format: 'jsonl' });
    new StreamNormalizer<string[][]>({ format: 'csv' });
    interface User { name: string; nested: { city: string }; skills: string[] }
    const result: Snapshot<User> = new StreamNormalizer<User>().write('{"name":"Al');
    const name: string | undefined = result.data?.name;
    const city: string | undefined = result.data?.nested?.city;
    // @ts-expect-error Incomplete values require a presence check.
    const required: string = result.data.name;
    // @ts-expect-error Transport bytes must be decoded first.
    new StreamNormalizer().write(new Uint8Array());
    for await (const snapshot of streamStructured<User>(['{}'])) {
      const typed: string | undefined = snapshot.data?.name;
      void typed;
    }
    const state = createPatchState<User>();
    for await (const patch of streamPatches(['{"name":"Alice"}'])) applyPatchBatch(state, patch);
    const selected = select(state, '/name', { when: 'complete' });
    if (selected.status === 'complete') { const typedName: string = selected.value; void typedName; }
    // @ts-expect-error Unknown typed field path is rejected.
    select(state, '/noSuchField');
    const schema = z.object({ name: z.string(), age: z.string().transform(Number) });
    for await (const snapshot of streamValidated(['{}'], { schema })) {
      const inputAge: string | undefined = snapshot.data?.age;
      // @ts-expect-error Validation must succeed before exposing full output.
      snapshot.validation.value;
      if (snapshot.validation.status === 'valid') {
        const age: number = snapshot.validation.value.age;
        const requiredName: string = snapshot.validation.value.name;
        // @ts-expect-error Transform infers number, not raw string.
        const wrong: string = snapshot.validation.value.age;
        void [age, requiredName, wrong];
      }
      void inputAge;
    }
    void [name, city];
  `);
  run(process.execPath, [join(workspace, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', '--lib', 'ES2022,DOM', '--typeRoots', join(workspace, 'node_modules/@types'), 'consumer.mts', 'consumer-runtime.mts']);
  run(process.execPath, ['consumer-runtime.mts']);
  console.log('Packed TypeScript declarations and runtime passed in an isolated consumer.');
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
