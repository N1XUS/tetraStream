import { computed, createRoot, getOwner, runWithOwner } from '@rivetjs/reactivity';
import type { CsvGrid, GridCell, GridColumn, GridRow } from './csv-grid.ts';

export interface CsvGridCollection {
  columns: () => GridColumn[];
  rows: () => GridRow[];
  reset(): void;
}

/** Keep Rivet collection identities stable while streaming values change. */
export function createCsvGridCollection(readGrid: () => CsvGrid): CsvGridCollection {
  const owner = getOwner();
  const newCellScope = () => runWithOwner(owner, () => createRoot(() => getOwner()));
  let cellScope = newCellScope();
  // Collection items keep their identity while getters expose the latest snapshot.
  // This lets the table update text without remounting a focused row or cell.
  const columnCache = new Map<number, GridColumn>();
  const rowCache = new Map<number, GridRow>();
  const numberColumn: GridColumn = { id: 'row-number', label: '#', status: 'complete' };
  const stateColumn: GridColumn = { id: 'row-state', label: 'Row status', status: 'complete' };
  let previousColumns: GridColumn[] = [];
  let previousRows: GridRow[] = [];
  const columns = computed(() => {
    const next = [numberColumn, ...readGrid().columns.map((_, index) => {
      if (!columnCache.has(index)) columnCache.set(index, {
        id: `column-${index}`,
        get label() { return readGrid().columns[index]?.label ?? ''; },
        get status() { return readGrid().columns[index]?.status ?? 'missing'; },
      });
      return columnCache.get(index)!;
    }), stateColumn];
    if (next.length === previousColumns.length && next.every((column, index) => column === previousColumns[index])) return previousColumns;
    return previousColumns = next;
  });
  const tableRows = computed(() => {
    const next = readGrid().rows.map((row, index) => {
      if (!rowCache.has(index)) {
        const cellCache = new Map<number, GridCell>();
        const numberCell: GridCell = { columnId: 'row-number', value: String(row.index), status: 'complete' };
        const stateCell: GridCell = { columnId: 'row-state', get value() { return readGrid().rows[index]?.status; }, get status() { return readGrid().rows[index]?.status ?? 'partial'; } };
        let previousCells: GridCell[] = [];
        // Per-row membership must outlive tableRows reevaluations. A separate
        // scope keeps these computeds alive and releases them on dataset reset.
        const cells = runWithOwner(cellScope.value, () => computed(() => {
          const next = [numberCell, ...readGrid().columns.map((column, cell) => {
            if (!cellCache.has(cell)) cellCache.set(cell, {
              columnId: column.id,
              get value() { return readGrid().rows[index]?.cells[cell]?.value; },
              get status() { return readGrid().rows[index]?.cells[cell]?.status ?? 'pending'; },
            });
            return cellCache.get(cell)!;
          }), stateCell];
          if (next.length === previousCells.length && next.every((cell, index) => cell === previousCells[index])) return previousCells;
          return previousCells = next;
        }));
        rowCache.set(index, {
          id: row.id,
          index: row.index,
          get status() { return readGrid().rows[index]?.status ?? 'partial'; },
          get cells() { return cells(); },
        });
      }
      return rowCache.get(index)!;
    });
    if (next.length === previousRows.length && next.every((row, index) => row === previousRows[index])) return previousRows;
    return previousRows = next;
  });
  return { columns, rows: tableRows, reset() {
    cellScope.dispose();
    cellScope = newCellScope();
    columnCache.clear();
    rowCache.clear();
  } };
}
