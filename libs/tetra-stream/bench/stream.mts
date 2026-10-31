import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Snapshot, PatchBatch } from '../dist/index.js';
import { StreamNormalizer, applyPatchBatch, createPatchState } from '../dist/index.js';

type BenchmarkFormat = 'json' | 'yaml' | 'csv';
type Mode = 'snapshots' | 'patches';

const args: Record<string, string | undefined> = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
const rows = Number(args.rows ?? 2000);
const chunkSize = Number(args.chunk ?? 256);
const repeats = Number(args.repeats ?? 3);
for (const [name, value] of Object.entries({ rows, chunkSize, repeats })) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`);
}
function input(format: BenchmarkFormat, count: number) {
  const records = Array.from({ length: count }, (_, index) => ({ name: `Person ${index}`, role: 'Engineer', notes: 'Building useful things, one chunk at a time.' }));
  if (format === 'json') return JSON.stringify(records);
  if (format === 'yaml') return records.map(row => `- name: ${row.name}\n  role: ${row.role}\n  notes: ${row.notes}\n`).join('');
  return 'name,role,notes\r\n' + records.map(row => `${row.name},${row.role},"${row.notes}"\r\n`).join('');
}
const median = (values: number[]) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
function run(format: BenchmarkFormat, source: string, mode: Mode) {
  globalThis.gc?.();
  const parser = new StreamNormalizer({ format, maxLength: source.length + 1 });
  const state = mode === 'patches' ? createPatchState({ format }) : undefined;
  let emittedBytes = 0;
  let updates = 0;
  let final: Snapshot | undefined;
  const started = performance.now();
  const receive = (output: Snapshot | PatchBatch) => {
    emittedBytes += Buffer.byteLength(JSON.stringify(output));
    updates++;
    if (state) {
      assert.ok('patches' in output);
      applyPatchBatch(state, output);
    } else {
      assert.ok(!('patches' in output));
      final = output;
    }
  };
  for (let offset = 0; offset < source.length; offset += chunkSize) {
    const chunk = source.slice(offset, offset + chunkSize);
    receive(mode === 'patches' ? parser.writePatch(chunk) : parser.write(chunk));
  }
  receive(mode === 'patches' ? parser.endPatch() : parser.end());
  const milliseconds = performance.now() - started;
  if (state) {
    const { sequence, ...snapshot } = state;
    final = snapshot;
  }
  assert.ok(final);
  return { milliseconds, emittedBytes, updates, final };
}

const cases: [BenchmarkFormat, number][] = [
  ['json', Math.min(rows, 250)], ['json', rows],
  ['csv', Math.min(rows, 250)], ['csv', rows],
  // YAML reparses the whole input prefix. Keep its default benchmark bounded.
  ['yaml', Math.min(rows, 50)], ['yaml', Math.min(rows, 150)],
];
const results = [];
for (const [format, count] of cases) {
  const source = input(format, count);
  const warm = input(format, Math.min(count, 20));
  run(format, warm, 'snapshots'); run(format, warm, 'patches');
  const reference = new StreamNormalizer({ format, maxLength: source.length + 1 });
  reference.write(source);
  const expected = reference.end();
  for (const mode of ['snapshots', 'patches'] as const) {
    const runs = Array.from({ length: repeats }, () => run(format, source, mode));
    for (const result of runs) {
      assert.deepEqual(result.final, expected, `${format}/${mode} output must match snapshots`);
    }
    results.push({ format, rows: count, mode, inputBytes: Buffer.byteLength(source), chunkUnits: chunkSize, updates: runs[0].updates,
      medianMs: Math.round(median(runs.map(run => run.milliseconds)) * 100) / 100, emittedBytes: runs[0].emittedBytes });
  }
}
const report = { generatedAt: new Date().toISOString(), node: process.version, platform: `${process.platform}/${process.arch}`, repeats,
  methodology: 'Median wall time; includes parsing, output JSON serialization, and (patch mode only) mutable consumer replay. Snapshot mode emits independent full copies. ASCII fixture bytes equal UTF-16 units. Not a universal throughput guarantee.',
  limitations: 'YAML still reparses each accumulated prefix. Snapshot copying is intentionally preserved for compatibility. UI rendering and transport latency are excluded.', results };
console.table(results.map(result => ({ format: result.format, rows: result.rows, mode: result.mode, 'median ms': result.medianMs, 'output KiB': Math.round(result.emittedBytes / 1024) })));
const output = resolve(args.output ?? 'artifacts/stream-benchmark.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(`Verified matching results for every workload. Saved ${output}`);
