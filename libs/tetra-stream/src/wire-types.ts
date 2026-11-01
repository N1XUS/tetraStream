import type { PatchBatch } from './patches.js';

export type WireFormat = 'json' | 'jsonl' | 'ndjson';
export type WireJSONValue =
  | null
  | string
  | number
  | boolean
  | readonly WireJSONValue[]
  | { readonly [key: string]: WireJSONValue };
/** A JSON Schema descriptor, not an executable validator or permission to fetch a URL. */
export type SchemaDescriptor = string | boolean | { readonly [key: string]: WireJSONValue };
export interface WireBatch extends PatchBatch {
  readonly format: WireFormat;
  readonly protocol?: 1;
  readonly schema?: SchemaDescriptor;
  readonly metadata?: { readonly [key: string]: WireJSONValue };
}
export interface WireLimits {
  /** UTF-16 code units in a line / complete frame. Default 1,048,576. */
  readonly maxFrameLength?: number;
  /** Maximum JSON nesting depth. Default 128. */
  readonly maxDepth?: number;
  /** Maximum operations or issues in one frame. Default 100,000. */
  readonly maxPatches?: number;
  /** Maximum pointer length. Default 4,096. */
  readonly maxPathLength?: number;
}
export interface WireReadOptions extends WireLimits {
  /** Last applied sequence; this reader expects exactly afterSequence + 1 next. Default 0. */
  readonly afterSequence?: number;
  readonly format?: WireFormat;
  readonly signal?: AbortSignal;
}
export type WireErrorCode = 'invalid-frame' | 'sequence' | 'truncated' | 'limit' | 'transport';
export class WireProtocolError extends Error {
  readonly code: WireErrorCode;
  constructor(code: WireErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'WireProtocolError';
    this.code = code;
  }
}
