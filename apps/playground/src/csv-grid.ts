import type { Completion, Snapshot } from 'tetra-stream';

export type GridCellStatus = Completion | 'missing' | 'pending';
export interface GridColumn {
  id: string;
  label: string;
  status: Completion | 'missing';
}
export interface GridCell {
  columnId: string;
  value: string | undefined;
  status: GridCellStatus;
}
export interface GridRow {
  id: string;
  index: number;
  status: Completion;
  cells: GridCell[];
}
export interface CsvGrid {
  columns: GridColumn[];
  rows: GridRow[];
  completeRows: number;
}

function isStringRow(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((cell) => typeof cell === 'string');
}

/** A separate dataset: quoted commas, quotes, and a multiline field are intentional. */
export const csvGridExample = `Name,Role,Team,Location,Notes
Alex Morgan,Product designer,Product,"Portland, OR","Design systems, made simple"
Sam Rivera,Frontend engineer,Engineering,"Austin, TX","Building the live preview"
Jordan Lee,Researcher,Research,"Toronto, ON","Talking to customers\nand sharing what matters"
Taylor Chen,Design engineer,Product,"Seattle, WA","Calls it ""a work in progress"""
Casey Patel,Product manager,Product,"London, UK",
Riley Brooks,Data analyst,Analytics,"Dublin, IE","Turning findings into next steps"
`;

/** Preserve source positions: duplicate/empty labels never collapse columns. */
export function readCsvGrid(snapshot: Snapshot<unknown>): CsvGrid {
  const source = Array.isArray(snapshot.data) ? snapshot.data.filter(isStringRow) : [];
  const header = source[0] ?? [];
  const width = source.reduce((max, row) => Math.max(max, row.length), header.length);
  const columns: GridColumn[] = Array.from({ length: width }, (_, column) => ({
    id: `column-${column}`,
    label: header[column] || `Column ${column + 1}`,
    status: snapshot.status[`/0/${column}`] ?? 'missing',
  }));
  const rows: GridRow[] = source.slice(1).map((row, index) => {
    const sourceIndex = index + 1;
    const status = snapshot.status[`/${sourceIndex}`] ?? 'partial';
    return {
      id: `row-${sourceIndex}`,
      index: sourceIndex,
      status,
      cells: columns.map((column, cell) => ({
        columnId: column.id,
        value: row[cell],
        status:
          snapshot.status[`/${sourceIndex}/${cell}`] ??
          (status === 'complete' ? 'missing' : 'pending'),
      })),
    };
  });
  return { columns, rows, completeRows: rows.filter((row) => row.status === 'complete').length };
}
