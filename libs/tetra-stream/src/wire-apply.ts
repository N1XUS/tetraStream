import {
  applyPatchBatch as apply,
  createPatchState as create,
  pointerParts,
  type PatchState,
  type PatchBatch,
} from './patches.js';
import { parsePatchBatch, assertWireFormat } from './wire-validation.js';
import { WireProtocolError, type WireFormat, type WireLimits } from './wire-types.js';
import type { JSONValue } from './types.js';

export function createPatchState<T = JSONValue>({
  format = 'json',
}: { format?: WireFormat } = {}): PatchState<T> {
  assertWireFormat(format);
  return create<T>({ format });
}

/** Copy only existing ancestors that this batch can modify; unchanged siblings keep their identity. */
function writableData(data: unknown, batch: PatchBatch): unknown {
  const copies = new WeakMap<object, object>();
  const copy = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') return value;
    let cloned = copies.get(value);
    if (!cloned) {
      cloned = Array.isArray(value)
        ? value.slice()
        : (Object.create(
            Object.getPrototypeOf(value),
            Object.getOwnPropertyDescriptors(value),
          ) as object);
      copies.set(value, cloned);
      copies.set(cloned, cloned);
    }
    return cloned;
  };
  let root = data;
  for (const patch of batch.patches) {
    if (patch.op === 'status') continue;
    const parts = pointerParts(patch.path);
    if (!parts.length) continue;
    root = copy(root);
    let cursor = root;
    for (const part of parts.slice(0, -1)) {
      if (!cursor || typeof cursor !== 'object' || !Object.hasOwn(cursor, part)) break;
      const parent = cursor as Record<string, unknown>;
      const next = copy(parent[part]);
      Object.defineProperty(parent, part, {
        value: next,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      cursor = next;
    }
  }
  return root;
}

/** Validate before committing. A rejected frame leaves the accumulator unchanged. */
export function applyPatchBatch<T>(
  state: PatchState<T>,
  input: PatchBatch,
  options: WireLimits & { appendOnly?: boolean } = {},
): PatchState<T> {
  const batch = parsePatchBatch(input, options);
  assertWireFormat(state.format);
  if (state.state !== 'streaming')
    throw new WireProtocolError('invalid-frame', 'Cannot apply a frame after terminal state');
  if (batch.sequence !== state.sequence + 1)
    throw new WireProtocolError('sequence', 'Patch sequence is out of order');
  if (options.appendOnly && batch.patches.some((patch) => patch.op === 'remove'))
    throw new WireProtocolError('invalid-frame', 'Append-only consumers reject remove operations');
  const next = {
    ...state,
    data: writableData(state.data, batch),
    status: { ...state.status },
  } as PatchState<T>;
  try {
    for (const patch of batch.patches) {
      if (patch.op === 'set') {
        const parts = pointerParts(patch.path);
        let parent: unknown = next.data;
        for (const key of parts.slice(0, -1)) {
          if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, key)) {
            parent = undefined;
            break;
          }
          parent = (parent as Record<string, unknown>)[key];
        }
        if (parts.length && Array.isArray(parent) && Number(parts.at(-1)) > parent.length)
          throw new TypeError('Array indices must not create holes');
      }
      // Stage operations in order; a later invalid target must not commit earlier writes.
      next.sequence = 0;
      apply(next, { format: batch.format, sequence: 1, patches: [patch], state: 'streaming' });
    }
    next.sequence = state.sequence;
    apply(next, { ...batch, patches: [] });
    if (next.state === 'complete' && next.data === undefined)
      throw new WireProtocolError('invalid-frame', 'A complete frame requires document data');
  } catch (cause) {
    if (cause instanceof WireProtocolError) throw cause;
    throw new WireProtocolError('invalid-frame', 'Invalid patch target or format', { cause });
  }
  state.data = next.data;
  state.status = next.status;
  state.sequence = next.sequence;
  state.state = next.state;
  if (next.error !== undefined) state.error = next.error;
  else delete state.error;
  if (next.issues !== undefined) state.issues = next.issues;
  else delete state.issues;
  return state;
}
