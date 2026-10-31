import type { Snapshot } from 'tetra-stream';

export interface TransportState {
  state: Snapshot['state'];
  playing: boolean;
  position: number;
  length: number;
}
export interface CsvSummaryState extends TransportState {
  rows: number;
  completeRows: number;
}
export interface EmptyStateCopy {
  title: string;
  description: string;
}

export function csvEmptyState(snapshot: Pick<Snapshot, 'state'>, position: number): EmptyStateCopy {
  if (snapshot.state === 'error')
    return {
      title: 'No rows could be read',
      description: 'Edit the CSV source or reset the example to try again.',
    };
  if (snapshot.state === 'complete')
    return {
      title: 'No data rows',
      description: 'Add a row below your CSV header to populate the table.',
    };
  return position
    ? {
        title: 'Receiving column names…',
        description: 'Rows appear as soon as their first cell arrives.',
      }
    : {
        title: 'Your table starts here',
        description: 'Each row appears as soon as its first cell arrives.',
      };
}
export function csvSummary({
  state,
  rows,
  completeRows,
  playing,
  position,
  length,
}: CsvSummaryState): string {
  const count = `${rows} ${rows === 1 ? 'row' : 'rows'}`;
  const ready = `${completeRows} complete ${completeRows === 1 ? 'row' : 'rows'}`;
  if (state === 'error') return 'Stream interrupted. Received cells stay visible.';
  if (state === 'complete')
    return position < length
      ? `Ended at this chunk. ${count} parsed from the received CSV.`
      : rows === 0
        ? 'No data rows received. Add a row below the header.'
        : `${count} received. Every available cell is complete.`;
  if (playing) return `${ready}. New cells are arriving…`;
  if (position) return `${ready}. Continue or step through the next chunk.`;
  return 'Watch values appear before the row is finished.';
}
export function transportLabel({ state, playing, position, length }: TransportState): string {
  if (state === 'error') return 'Stream interrupted';
  if (state === 'complete') return position < length ? 'Ended at this chunk' : 'All text received';
  return playing ? 'Receiving text…' : position ? 'Paused' : 'Ready when you are';
}
