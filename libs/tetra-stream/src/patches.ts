import type { Completion, DeepPartial, LanguageStrategy, JSONValue, MarkupDocument, CssDocument, Snapshot } from './types.js';

/** Values are unknown until selected against a model or validated against a schema. */
export type StreamPatch =
  | { readonly op: 'set'; readonly path: string; readonly value: unknown }
  | { readonly op: 'append'; readonly path: string; readonly value: string }
  | { readonly op: 'remove'; readonly path: string }
  | { readonly op: 'status'; readonly path: string; readonly value: Completion | null };
export interface PatchBatch {
  readonly format: string;
  /** Starts at 1; replay batches from one parser in order. */
  readonly sequence: number;
  readonly patches: readonly StreamPatch[];
  readonly state: Snapshot['state'];
  readonly error?: string;
}
/** A consumer-owned mutable accumulator. Use select() for typed field access. */
export interface PatchState<T = JSONValue | MarkupDocument | CssDocument> extends Snapshot<T> { sequence: number }

export function createPatchState<T = JSONValue | MarkupDocument | CssDocument>({ format = 'json' }: { format?: string | LanguageStrategy<T> } = {}): PatchState<T> {
  return { format: typeof format === 'string' ? format : format.format, sequence: 0, data: undefined, status: {}, state: 'streaming' };
}

export function pointerParts(path: string): string[] {
  if (path === '') return [];
  if (!path.startsWith('/') || /~(?![01])/u.test(path)) throw new TypeError(`Invalid JSON Pointer: ${path}`);
  return path.slice(1).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'));
}
function arrayKey(value: object, key: string): boolean {
  return !Array.isArray(value) || /^(0|[1-9][0-9]*)$/u.test(key) && Number(key) < 4_294_967_295;
}
export function lookup(data: unknown, path: string): { found: boolean; value: unknown } {
  let value = data;
  for (const key of pointerParts(path)) {
    if (!value || typeof value !== 'object' || !arrayKey(value, key) || !Object.hasOwn(value, key)) return { found: false, value: undefined };
    value = (value as Record<string, unknown>)[key];
  }
  return { found: value !== undefined, value };
}
function parentOf(data: unknown, parts: string[]): { parent: Record<string, unknown>; key: string } {
  const key = parts.at(-1)!;
  let value = data;
  for (const part of parts.slice(0, -1)) {
    if (!value || typeof value !== 'object' || !arrayKey(value, part) || !Object.hasOwn(value, part)) throw new TypeError('Patch ancestor is unavailable');
    value = (value as Record<string, unknown>)[part];
  }
  if (!value || typeof value !== 'object' || !arrayKey(value, key)) throw new TypeError('Invalid patch target');
  return { parent: value as Record<string, unknown>, key };
}

/** Apply in place; incoming set values are copied so neither events nor parser data alias the consumer. */
export function applyPatchBatch<T>(state: PatchState<T>, batch: PatchBatch): PatchState<T> {
  if (state.format !== batch.format) throw new TypeError('Patch format does not match the accumulator');
  if (batch.sequence !== state.sequence + 1) throw new RangeError('Patch sequence is out of order');
  for (const patch of batch.patches) {
    const parts = pointerParts(patch.path);
    if (patch.op === 'status') {
      if (patch.value === null) delete state.status[patch.path];
      else Object.defineProperty(state.status, patch.path, { value: patch.value, enumerable: true, configurable: true, writable: true });
      continue;
    }
    if (!parts.length) {
      if (patch.op === 'remove') state.data = undefined;
      else if (patch.op === 'set') state.data = structuredClone(patch.value) as DeepPartial<T>;
      else {
        if (typeof state.data !== 'string') throw new TypeError('Append patch target must be a string');
        state.data = (state.data + patch.value) as DeepPartial<T>;
      }
      continue;
    }
    const { parent, key } = parentOf(state.data, parts);
    if (patch.op === 'remove') delete parent[key];
    else if (patch.op === 'set') Object.defineProperty(parent, key, { value: structuredClone(patch.value), enumerable: true, configurable: true, writable: true });
    else {
      if (!Object.hasOwn(parent, key) || typeof parent[key] !== 'string') throw new TypeError('Append patch target must be a string');
      Object.defineProperty(parent, key, { value: parent[key] + patch.value, enumerable: true, configurable: true, writable: true });
    }
  }
  state.sequence = batch.sequence;
  state.state = batch.state;
  if (batch.error !== undefined) state.error = batch.error;
  else delete state.error;
  return state;
}
