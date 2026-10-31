import type { Completion, MutableSnapshot } from './types.js';
import type { MutationObserver } from './mutations.js';
import { lookup, type PatchBatch, type StreamPatch } from './patches.js';

type DataChange = { kind: 'set' } | { kind: 'append'; text: string };
/** Coalesce only touched paths; reading a batch never clones unchanged subtrees. */
export class MutationJournal implements MutationObserver {
  private data = new Map<string, DataChange>();
  private completions = new Map<string, Completion | null>();
  private sequence = 0;
  constructor(current: MutableSnapshot) {
    if (current.data !== undefined) this.set('');
    for (const [path, value] of Object.entries(current.status)) this.status(path, value);
  }
  set(path: string): void {
    this.data.set(path, { kind: 'set' });
  }
  append(path: string, text: string): void {
    const previous = this.data.get(path);
    if (previous?.kind === 'set') return;
    if (previous) previous.text += text;
    else this.data.set(path, { kind: 'append', text });
  }
  status(path: string, value: Completion | null): void {
    this.completions.set(path, value);
  }
  flush(current: MutableSnapshot): PatchBatch {
    const patches: StreamPatch[] = [];
    for (const [path, change] of this.data) {
      // A parent set already includes all final descendants in this chunk.
      let parent = path;
      let covered = false;
      while (parent !== '') {
        parent = parent.slice(0, parent.lastIndexOf('/'));
        if (this.data.get(parent)?.kind === 'set') {
          covered = true;
          break;
        }
      }
      if (covered) continue;
      if (change.kind === 'append') patches.push({ op: 'append', path, value: change.text });
      else {
        const { found, value } = lookup(current.data, path);
        patches.push(
          found ? { op: 'set', path, value: structuredClone(value) } : { op: 'remove', path },
        );
      }
    }
    for (const [path, value] of this.completions) patches.push({ op: 'status', path, value });
    this.data.clear();
    this.completions.clear();
    const result: PatchBatch = {
      format: current.format,
      sequence: ++this.sequence,
      patches,
      state: current.state,
    };
    if (current.error !== undefined) return { ...result, error: current.error };
    return result;
  }
}
