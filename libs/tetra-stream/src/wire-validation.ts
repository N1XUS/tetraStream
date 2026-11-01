import { stringifyWire } from './wire-json.js';
import { pointerParts } from './patches.js';
import {
  WireProtocolError,
  type WireBatch,
  type WireFormat,
  type WireLimits,
} from './wire-types.js';

export function wireLimits(options: WireLimits = {}) {
  const result = {
    maxFrameLength: options.maxFrameLength ?? 1_048_576,
    maxDepth: options.maxDepth ?? 128,
    maxPatches: options.maxPatches ?? 100_000,
    maxPathLength: options.maxPathLength ?? 4_096,
  };
  for (const [name, value] of Object.entries(result)) {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new RangeError(`${name} must be a positive safe integer`);
  }
  return result;
}
function invalid(message: string): never {
  throw new WireProtocolError('invalid-frame', message);
}
function record(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)
  );
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) invalid(`Unknown frame key: ${key}`);
}
/** Reject lossy JSON serialization (undefined, Infinity, accessors, sparse arrays, classes, cycles). */
function json(value: unknown, maxDepth: number): void {
  const ancestors = new WeakSet<object>();
  const stack: { value: unknown; depth: number; exit?: boolean }[] = [{ value, depth: 0 }];
  while (stack.length) {
    const entry = stack.pop()!;
    const value = entry.value;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') continue;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) invalid('Numbers must be finite');
      continue;
    }
    if (typeof value !== 'object') invalid('Expected JSON-safe frame values');
    if (entry.exit) {
      ancestors.delete(value);
      continue;
    }
    if (entry.depth >= maxDepth) throw new WireProtocolError('limit', 'Frame exceeds maxDepth');
    if (!Array.isArray(value) && !record(value)) invalid('Expected plain JSON objects');
    if (ancestors.has(value)) invalid('Cyclic frame value');
    ancestors.add(value);
    stack.push({ value, depth: entry.depth, exit: true });
    const names = Object.keys(value);
    if (Object.getOwnPropertyNames(value).length !== names.length + (Array.isArray(value) ? 1 : 0))
      invalid('Non-enumerable properties are not JSON values');
    if (
      Array.isArray(value) &&
      (names.length !== value.length || names.some((key, index) => key !== String(index)))
    )
      invalid('Sparse or decorated arrays are not JSON values');
    for (const key of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!('value' in descriptor)) invalid('Accessors are not JSON values');
      stack.push({ value: descriptor.value, depth: entry.depth + 1 });
    }
    if (Object.getOwnPropertySymbols(value).length)
      invalid('Symbol properties are not JSON values');
  }
}
export function assertWireFormat(format: string): asserts format is WireFormat {
  if (format !== 'json' && format !== 'jsonl' && format !== 'ndjson')
    invalid(`Unsupported wire format: ${String(format)}`);
}
/** Validate a standalone wire frame. Sequence continuity and application targets are stateful checks. */
export function parsePatchBatch(value: unknown, options: WireLimits = {}): WireBatch {
  const limits = wireLimits(options);
  // Frame wrappers cost a few levels; data, schema and metadata get their own depth checks below.
  json(value, limits.maxDepth + 8);
  if (!record(value)) invalid('Expected a frame object');
  keys(value, [
    'format',
    'sequence',
    'patches',
    'state',
    'error',
    'issues',
    'protocol',
    'schema',
    'metadata',
  ]);
  if (typeof value.format !== 'string') invalid('Frame format must be a string');
  assertWireFormat(value.format);
  if (
    typeof value.sequence !== 'number' ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1
  )
    invalid('Invalid sequence number');
  if (!['streaming', 'complete', 'error'].includes(value.state as string))
    invalid('Invalid stream state');
  if (value.state === 'error' ? typeof value.error !== 'string' : Object.hasOwn(value, 'error'))
    invalid('Only error frames must carry an error string');
  if (Object.hasOwn(value, 'protocol') && value.protocol !== 1)
    invalid('Unsupported protocol version');
  if (Object.hasOwn(value, 'schema')) {
    if (
      typeof value.schema !== 'string' &&
      typeof value.schema !== 'boolean' &&
      !record(value.schema)
    )
      invalid('Invalid schema descriptor');
    json(value.schema, limits.maxDepth);
  }
  if (Object.hasOwn(value, 'metadata')) {
    if (!record(value.metadata)) invalid('Metadata must be an object');
    json(value.metadata, limits.maxDepth);
  }
  const pointer = (path: unknown) => {
    if (typeof path !== 'string') invalid('Path must be a JSON Pointer');
    if (path.length > limits.maxPathLength)
      throw new WireProtocolError('limit', 'Path exceeds maxPathLength');
    let depth: number;
    try {
      depth = pointerParts(path).length;
    } catch (cause) {
      throw new WireProtocolError('invalid-frame', 'Invalid JSON Pointer', { cause });
    }
    if (depth > limits.maxDepth) throw new WireProtocolError('limit', 'Path exceeds maxDepth');
    return depth;
  };
  if (!Array.isArray(value.patches)) invalid('Frame patches must be an array');
  if (value.patches.length > limits.maxPatches)
    throw new WireProtocolError('limit', 'Too many patches');
  for (const patch of value.patches) {
    if (!record(patch)) invalid('Invalid patch');
    const depth = pointer(patch.path);
    keys(patch, patch.op === 'remove' ? ['op', 'path'] : ['op', 'path', 'value']);
    if (patch.op === 'remove') continue;
    if (patch.op === 'set') {
      if (!Object.hasOwn(patch, 'value')) invalid('Set requires a value');
      json(patch.value, limits.maxDepth - depth);
    } else if (patch.op === 'append') {
      if (typeof patch.value !== 'string') invalid('Append requires a string');
    } else if (patch.op === 'status') {
      if (patch.value !== null && patch.value !== 'partial' && patch.value !== 'complete')
        invalid('Invalid completion status');
    } else invalid('Unknown patch operation');
  }
  if (Object.hasOwn(value, 'issues')) {
    if (!Array.isArray(value.issues)) invalid('Issues must be an array');
    if (value.issues.length > limits.maxPatches)
      throw new WireProtocolError('limit', 'Too many issues');
    for (const issue of value.issues) {
      if (!record(issue)) invalid('Invalid path issue');
      keys(issue, ['path', 'code', 'message']);
      pointer(issue.path);
      if (typeof issue.code !== 'string' || !issue.code || typeof issue.message !== 'string')
        invalid('Invalid path issue details');
    }
  }
  if (stringifyWire(value).length > limits.maxFrameLength)
    throw new WireProtocolError('limit', 'Frame exceeds maxFrameLength');
  return value as unknown as WireBatch;
}
