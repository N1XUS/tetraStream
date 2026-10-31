import { assertStrategyData } from './strategy.js';
import { CssMachine } from './css.js';
import { MutationJournal } from './journal.js';
import { observeMutations, replaceData, replaceCompletions } from './mutations.js';
import type { PatchBatch } from './patches.js';
import { JsonMachine } from './json.js';
import { MarkupMachine } from './markup.js';
import { YamlMachine } from './yaml.js';
import { JsonLinesMachine } from './json-lines.js';
import { DelimitedMachine } from './delimited.js';
import { Format } from './types.js';
import { pointerParts } from './patches.js';
import type { LanguageStrategy, LanguageUpdate, JSONValue, MarkupDocument, CssDocument, MutableSnapshot, NormalizerOptions, Snapshot } from './types.js';

export { Format } from './types.js';
export type { FormatName, LanguageStrategy, LanguageParser, LanguageUpdate, LanguageStrategyOptions, Completion, JSONValue, DeepPartial, TextNode, ElementNode, MarkupNode, MarkupDocument, CssDocument, CssNode, CssRule, CssDeclaration, CssAtRule, CssComment, Snapshot, NormalizerOptions } from './types.js';

/** Accept any async iterable of decoded text chunks from an AI SDK or transport. */
export async function* streamStructured<T = JSONValue | MarkupDocument | CssDocument>(
  source: AsyncIterable<string> | Iterable<string>,
  options?: NormalizerOptions<T>,
): AsyncGenerator<Snapshot<T>> {
  const normalizer = new StreamNormalizer<T>(options);
  for await (const chunk of source) yield normalizer.write(chunk);
  yield normalizer.end();
}

/** Stream opt-in change batches without cloning accumulated snapshots. */
export async function* streamPatches(
  source: AsyncIterable<string> | Iterable<string>, options?: NormalizerOptions,
): AsyncGenerator<PatchBatch> {
  const normalizer = new StreamNormalizer(options);
  for await (const chunk of source) yield normalizer.writePatch(chunk);
  yield normalizer.endPatch();
}

/** Incrementally decode one document. Paths use RFC 6901 JSON Pointer. */
export class StreamNormalizer<T = JSONValue | MarkupDocument | CssDocument> {
  readonly format: string;
  private readonly maxLength: number;
  private length: number;
  private readonly current: MutableSnapshot;
  private journal: MutationJournal | undefined;
  private readonly machine: { write(chunk: string): void; end(): void };

  constructor({ format = Format.JSON, maxLength = 1_000_000, maxDepth = 128 }: NormalizerOptions<T> = {}) {
    const custom = typeof format === 'object' && format !== null;
    if (custom) {
      if (typeof format.format !== 'string' || !format.format.trim() || typeof format.create !== 'function') {
        throw new TypeError('A language strategy requires a nonempty format and create()');
      }
    } else if (!Object.values(Format).includes(format as Format)) throw new TypeError(`Unsupported format: ${String(format)}`);
    if (!Number.isSafeInteger(maxLength) || maxLength < 1 || !Number.isSafeInteger(maxDepth) || maxDepth < 1) {
      throw new TypeError('maxLength and maxDepth must be positive safe integers');
    }
    this.format = custom ? (format as LanguageStrategy<T>).format : format as string;
    this.maxLength = maxLength;
    this.length = 0;
    this.current = { format: this.format, data: undefined, status: {}, state: 'streaming' };
    if (custom) {
      const parser = (format as LanguageStrategy<T>).create(Object.freeze({ maxLength, maxDepth }));
      if (!parser || typeof parser.write !== 'function' || typeof parser.end !== 'function') {
        throw new TypeError('A language strategy must create a parser with write() and end()');
      }
      const commit = (update: LanguageUpdate<T>): void => {
        if (!update || !update.status || typeof update.status !== 'object' || Array.isArray(update.status)) {
          throw new TypeError('A language parser must return data and a completion map');
        }
        for (const [path, completion] of Object.entries(update.status)) {
          pointerParts(path);
          if (completion !== 'partial' && completion !== 'complete') throw new TypeError(`Invalid completion at ${path}`);
        }
        assertStrategyData(update.data, maxDepth);
        // Own the result before the strategy mutates its next provisional tree.
        const owned = structuredClone(update);
        replaceData(this.current, owned.data);
        replaceCompletions(this.current, owned.status);
      };
      this.machine = { write: chunk => commit(parser.write(chunk)), end: () => commit(parser.end()) };
      return;
    }
    switch (format) {
      case 'css': this.machine = new CssMachine(this.current, maxDepth); break;
      case 'json': this.machine = new JsonMachine(this.current, maxDepth); break;
      case 'xml': case 'html': this.machine = new MarkupMachine(this.current, maxDepth); break;
      case 'yaml': case 'yml': this.machine = new YamlMachine(this.current, maxDepth); break;
      case 'ndjson': case 'jsonl': this.machine = new JsonLinesMachine(this.current, maxDepth); break;
      case 'csv': case 'tsv': this.machine = new DelimitedMachine(this.current, format === 'csv' ? ',' : '\t'); break;
      default: throw new TypeError(`Unsupported format: ${String(format)}`);
    }
  }

  write(chunk: string): Snapshot<T> { this.writeCore(chunk); return this.snapshot(); }

  /** Emit only changed paths and decoded text suffixes; no full snapshot copy. */
  writePatch(chunk: string): PatchBatch { this.enablePatches(); this.writeCore(chunk); return this.patch(); }

  end(): Snapshot<T> { this.endCore(); return this.snapshot(); }
  endPatch(): PatchBatch { this.enablePatches(); this.endCore(); return this.patch(); }

  /** Drain retained updates, including after a caught parser error. */
  patch(): PatchBatch { this.enablePatches(); return this.journal!.flush(this.current); }

  private enablePatches(): void {
    if (this.journal) return;
    this.journal = new MutationJournal(this.current);
    observeMutations(this.current, this.journal);
  }
  private writeCore(chunk: string): void {
    this.assertOpen();
    if (typeof chunk !== 'string') throw new TypeError('write() expects decoded text chunks');
    this.guard(() => {
      if (this.length + chunk.length > this.maxLength) throw new RangeError('Document exceeds maxLength');
      this.length += chunk.length;
      this.machine.write(chunk);
    });
  }
  private endCore(): void {
    this.assertOpen();
    this.guard(() => { this.machine.end(); this.current.state = 'complete'; });
  }

  snapshot(): Snapshot<T> { return structuredClone(this.current) as Snapshot<T>; }

  private assertOpen(): void {
    if (this.current.state !== 'streaming') throw new Error('Stream is closed; create a new normalizer');
  }

  private guard(action: () => void): void {
    try { action(); }
    catch (error) {
      this.current.state = 'error';
      this.current.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }
}
