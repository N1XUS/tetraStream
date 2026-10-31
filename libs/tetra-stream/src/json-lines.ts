import { forwardMutations, setCompletion } from './mutations.js';
import { JsonMachine } from './json.js';
import type { JSONValue, MutableSnapshot } from './types.js';

/** One incremental JSON parser per record; a synthetic array collects records. */
export class JsonLinesMachine {
  private readonly rows: JSONValue[] = [];
  private record: { state: MutableSnapshot; parser: JsonMachine; index: number } | undefined;

  constructor(private readonly current: MutableSnapshot, private readonly maxDepth: number) {
    current.data = this.rows;
    setCompletion(current, '', 'partial');
  }

  private sync(): void {
    if (!this.record) return;
    const { state, index } = this.record;
    if (state.data !== undefined) this.rows[index] = state.data as JSONValue;
    for (const [path, completion] of Object.entries(state.status)) setCompletion(this.current, `/${index}${path}`, completion);
  }

  private finishRecord(): void {
    if (!this.record) return;
    this.record.parser.end();
    this.sync();
    this.record = undefined;
  }

  write(chunk: string): void {
    try {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') { this.finishRecord(); continue; }
        if (!this.record) {
          if (char === ' ' || char === '\t') continue;
          const state: MutableSnapshot = { format: 'json', data: undefined, status: {}, state: 'streaming' };
          forwardMutations(state, this.current, `/${this.rows.length}`);
          this.record = { state, parser: new JsonMachine(state, this.maxDepth), index: this.rows.length };
        }
        this.record.parser.write(char);
      }
    } finally { this.sync(); }
  }

  end(): void {
    try { this.finishRecord(); } finally { this.sync(); }
    setCompletion(this.current, '', 'complete');
  }
}
