import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamNormalizer } from 'tetra-stream';
import * as binding from '../src/csv-grid.ts';

function grid(parser: StreamNormalizer, chunk: string) { assert.equal(typeof binding.readCsvGrid, 'function', 'the streaming table projection is required'); return binding.readCsvGrid(parser.write(chunk)); }

test('CSV grid exposes growing headers and cells with stable positional identities', () => {
  const parser = new StreamNormalizer({ format: 'csv' });
  const header = grid(parser, 'Na');
  assert.deepEqual(header.columns, [{ id: 'column-0', label: 'Na', status: 'partial' }]);
  assert.deepEqual(header.rows, []);
  const first = grid(parser, 'me,Role,Team\nAlex,Des');
  assert.equal(first.rows.length, 1);
  assert.equal(first.rows[0].id, 'row-1');
  assert.equal(first.rows[0].status, 'partial');
  assert.deepEqual(first.rows[0].cells.map(({ value, status }) => [value, status]), [['Alex', 'complete'], ['Des', 'partial'], [undefined, 'pending']]);
  const next = grid(parser, 'igner,Product\nSam,Engineer,');
  assert.equal(next.rows[0].id, first.rows[0].id);
  assert.equal(next.rows[0].status, 'complete');
  assert.equal(next.completeRows, 1);
  assert.equal(next.rows[1].cells[2].value, '');
  assert.equal(next.rows[1].cells[2].status, 'partial');
});

test('CSV grid distinguishes complete empty cells from cells omitted in a finished short row', () => {
  const parser = new StreamNormalizer({ format: 'csv' });
  const result = grid(parser, 'Name,Role,Team\nAlex,,\nSam\n');
  assert.deepEqual(result.rows[0].cells.map(({ value, status }) => [value, status]), [['Alex', 'complete'], ['', 'complete'], ['', 'complete']]);
  assert.deepEqual(result.rows[1].cells.map(({ value, status }) => [value, status]), [['Sam', 'complete'], [undefined, 'missing'], [undefined, 'missing']]);
});

test('duplicate and blank headers remain separate columns and extra cells are retained', () => {
  const parser = new StreamNormalizer({ format: 'csv' });
  const result = grid(parser, 'Name,Name,\nA,B,C,D\n');
  assert.deepEqual(result.columns.map(({ id, label }) => [id, label]), [['column-0', 'Name'], ['column-1', 'Name'], ['column-2', 'Column 3'], ['column-3', 'Column 4']]);
  assert.deepEqual(result.rows[0].cells.map(cell => cell.value), ['A', 'B', 'C', 'D']);
});

test('quoted comma, escaped quote, and newline render inside a growing cell', () => {
  const parser = new StreamNormalizer({ format: 'csv' });
  const first = grid(parser, 'Name,Notes\r\nAlex,"Design, ""systems""\nIn prog');
  assert.equal(first.rows[0].cells[1].value, 'Design, "systems"\nIn prog');
  assert.equal(first.rows[0].cells[1].status, 'partial');
  const last = grid(parser, 'ress"\r\n');
  assert.equal(last.rows[0].cells[1].value, 'Design, "systems"\nIn progress');
  assert.equal(last.rows[0].status, 'complete');
});

test('final row without newline completes at EOF and interruption preserves available values', () => {
  const parser = new StreamNormalizer({ format: 'csv' });
  grid(parser, 'Name,Role\nAlex,Designer');
  const done = binding.readCsvGrid(parser.end());
  assert.equal(done.completeRows, 1);
  const broken = new StreamNormalizer({ format: 'csv' });
  grid(broken, 'Name,Role\nAlex,"Des');
  assert.throws(() => broken.end());
  const retained = binding.readCsvGrid(broken.snapshot());
  assert.equal(retained.rows[0].cells[1].value, 'Des');
  assert.equal(retained.rows[0].cells[1].status, 'partial');
});

test('CSV table fixture survives every two-chunk split without losing rows or statuses', () => {
  assert.equal(typeof binding.csvGridExample, 'string');
  for (let split = 0; split <= binding.csvGridExample.length; split++) {
    const parser = new StreamNormalizer({ format: 'csv' });
    parser.write(binding.csvGridExample.slice(0, split));
    parser.write(binding.csvGridExample.slice(split));
    const result = binding.readCsvGrid(parser.end());
    assert.equal(result.rows.length, 6, `split ${split}`);
    assert.equal(result.completeRows, 6);
    assert.equal(result.rows[0].cells[0].value, 'Alex Morgan');
    assert.ok(result.rows.every(row => row.cells.every(cell => cell.status === 'complete')));
  }
});
