import test from 'node:test';
import assert from 'node:assert/strict';
import type { Snapshot } from 'tetra-stream';
import * as ui from '../src/presentation.ts';

const snapshot = (state: Snapshot['state']): Snapshot => ({ format: 'csv', state, data: [], status: {} });

test('CSV empty state settles after a header-only or empty response finishes', () => {
  assert.equal(typeof ui.csvEmptyState, 'function');
  assert.equal(ui.csvEmptyState(snapshot('streaming'), 0).title, 'Your table starts here');
  assert.equal(ui.csvEmptyState(snapshot('streaming'), 4).title, 'Receiving column names…');
  assert.equal(ui.csvEmptyState(snapshot('complete'), 5).title, 'No data rows');
  assert.equal(ui.csvEmptyState(snapshot('error'), 5).title, 'No rows could be read');
});

test('row summaries use singular grammar and distinguish early EOF from all source received', () => {
  assert.equal(typeof ui.csvSummary, 'function');
  const base: ui.CsvSummaryState = { state: 'complete', rows: 1, completeRows: 1, playing: false, position: 10, length: 10 };
  assert.equal(ui.csvSummary(base), '1 row received. Every available cell is complete.');
  assert.equal(ui.csvSummary({ ...base, rows: 2, completeRows: 2 }), '2 rows received. Every available cell is complete.');
  assert.match(ui.csvSummary({ ...base, length: 20 }), /Ended at this chunk/);
  assert.match(ui.csvSummary({ ...base, state: 'error' }), /interrupted/);
  assert.equal(ui.csvSummary({ ...base, rows: 0, completeRows: 0 }), 'No data rows received. Add a row below the header.');
});

test('transport labels do not claim all text arrived after ending a simulated stream early', () => {
  assert.equal(typeof ui.transportLabel, 'function');
  assert.equal(ui.transportLabel({ state: 'complete', position: 5, length: 20, playing: false }), 'Ended at this chunk');
  assert.equal(ui.transportLabel({ state: 'complete', position: 20, length: 20, playing: false }), 'All text received');
  assert.equal(ui.transportLabel({ state: 'streaming', position: 5, length: 20, playing: false }), 'Paused');
});
