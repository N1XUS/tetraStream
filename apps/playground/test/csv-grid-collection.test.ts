import test from 'node:test';
import assert from 'node:assert/strict';
import { computed, createRoot, signal } from '@rivetjs/reactivity';
import { StreamNormalizer } from 'tetra-stream';
import { readCsvGrid } from '../src/csv-grid.ts';
import { createCsvGridCollection } from '../src/csv-grid-collection.ts';

test('a cached streaming row gains extra cells after collection reevaluation', () => {
  const root = createRoot(() => {
    const parser = new StreamNormalizer({ format: 'csv' });
    const snapshot = signal(parser.snapshot());
    const grid = computed(() => readCsvGrid(snapshot()));
    const collection = createCsvGridCollection(grid);
    snapshot.set(parser.write('Name\nA'));
    const row = collection.rows()[0];
    assert.equal(row.cells.length, 3); // row number, value, row state
    snapshot.set(parser.write(',B'));
    assert.equal(collection.rows()[0], row, 'keep the row object stable for focus');
    assert.equal(collection.columns().length, 4);
    assert.equal(row.cells.length, 4, 'extra streamed values must become cells');
    assert.equal(row.cells[2].value, 'B');
    snapshot.set(parser.write(',C\n'));
    collection.rows();
    assert.equal(row.cells[3].value, 'C');
    assert.equal(row.cells.at(-1)?.value, 'complete');
  });
  root.dispose();
});

test('value changes preserve collection identities and reset allows a new schema', () => {
  const root = createRoot(() => {
    let parser = new StreamNormalizer({ format: 'csv' });
    const snapshot = signal(parser.snapshot());
    const collection = createCsvGridCollection(computed(() => readCsvGrid(snapshot())));
    snapshot.set(parser.write('Name,Role\nAlex,Des'));
    const rows = collection.rows();
    const row = rows[0];
    const cells = row.cells;
    const role = cells[2];
    const columns = collection.columns();
    snapshot.set(parser.write('igner'));
    assert.equal(collection.rows(), rows);
    assert.equal(collection.columns(), columns);
    assert.equal(row.cells, cells);
    assert.equal(role.value, 'Designer');
    collection.reset();
    parser = new StreamNormalizer({ format: 'csv' });
    snapshot.set(parser.snapshot());
    assert.deepEqual(collection.rows(), []);
    snapshot.set(parser.write('City\nParis\n'));
    const next = collection.rows()[0];
    assert.notEqual(next, row);
    assert.equal(collection.columns()[1].label, 'City');
    assert.equal(next.cells[1].value, 'Paris');
  });
  root.dispose();
});
