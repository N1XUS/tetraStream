import { recordSet, recordAppend, setCompletion } from './mutations.js';
import type { MutableSnapshot } from './types.js';

/** RFC 4180-style rows; all cells stay strings and headers are application data. */
export class DelimitedMachine {
  private readonly rows: string[][] = [];
  private row: string[] | null = null;
  private column = 0;
  private mode: 'start' | 'unquoted' | 'quoted' | 'quote' = 'start';
  private skipLF = false;
  private offset = 0;

  constructor(
    private readonly current: MutableSnapshot,
    private readonly separator: string,
  ) {
    current.data = this.rows;
    setCompletion(current, '', 'partial');
  }

  private ensureCell(): void {
    if (!this.row) {
      this.row = [];
      this.rows.push(this.row);
      recordSet(this.current, `/${this.rows.length - 1}`);
      setCompletion(this.current, `/${this.rows.length - 1}`, 'partial');
    }
    if (!(this.column in this.row)) {
      this.row[this.column] = '';
      recordSet(this.current, `/${this.rows.length - 1}/${this.column}`);
      setCompletion(this.current, `/${this.rows.length - 1}/${this.column}`, 'partial');
    }
  }

  private finishCell(): void {
    this.ensureCell();
    setCompletion(this.current, `/${this.rows.length - 1}/${this.column}`, 'complete');
    this.mode = 'start';
  }

  private finishRow(): void {
    this.finishCell();
    setCompletion(this.current, `/${this.rows.length - 1}`, 'complete');
    this.row = null;
    this.column = 0;
  }

  write(chunk: string): void {
    for (const char of chunk) {
      const initial = this.offset === 0;
      this.offset += char.length;
      if (initial && char === '\uFEFF') continue;
      if (this.skipLF) {
        this.skipLF = false;
        if (char === '\n') continue;
      }
      this.ensureCell();
      if (this.mode === 'quoted') {
        if (char === '"') this.mode = 'quote';
        else {
          this.row![this.column] += char;
          recordAppend(this.current, `/${this.rows.length - 1}/${this.column}`, char);
        }
        continue;
      }
      if (this.mode === 'quote' && char === '"') {
        this.row![this.column] += '"';
        recordAppend(this.current, `/${this.rows.length - 1}/${this.column}`, '"');
        this.mode = 'quoted';
      } else if (char === this.separator) {
        this.finishCell();
        this.column++;
        this.ensureCell();
      } else if (char === '\n' || char === '\r') {
        this.finishRow();
        this.skipLF = char === '\r';
      } else if (this.mode === 'quote')
        throw new SyntaxError(
          `Unexpected character after a closing quote at offset ${this.offset - 1}`,
        );
      else if (char === '"') {
        if (this.mode !== 'start')
          throw new SyntaxError(`Quote inside an unquoted cell at offset ${this.offset - 1}`);
        this.mode = 'quoted';
      } else {
        this.row![this.column] += char;
        recordAppend(this.current, `/${this.rows.length - 1}/${this.column}`, char);
        this.mode = 'unquoted';
      }
    }
  }

  end(): void {
    if (this.mode === 'quoted') throw new SyntaxError('Stream ended inside a quoted cell');
    if (this.row) this.finishRow();
    setCompletion(this.current, '', 'complete');
  }
}
