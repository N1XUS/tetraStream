/** Parser-free browser entry. Never import normalizer/validation strategies from this module. */
export { fromSSE, fromNDJSON } from './wire-readers.js';
export { applyPatchBatch, createPatchState } from './wire-apply.js';
export { select } from './selection.js';
export { Format } from './types.js';
export { parsePatchBatch } from './wire-validation.js';
export { WireProtocolError } from './wire-types.js';
export type {
  WireBatch,
  WireJSONValue,
  WireFormat,
  WireLimits,
  WireReadOptions,
  WireErrorCode,
  SchemaDescriptor,
} from './wire-types.js';
export type { StreamPatch, PatchBatch, PatchState, PathIssue } from './patches.js';
export type { Pointer, PathValue } from './paths.js';
export type { SelectionRequirement, SelectionOptions, SelectionResult } from './selection.js';
export type { Snapshot, DeepPartial, JSONValue, Completion } from './types.js';
