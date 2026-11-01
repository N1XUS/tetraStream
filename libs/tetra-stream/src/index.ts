export { StreamNormalizer, streamStructured, streamPatches } from './normalizer.js';
export { Format } from './types.js';
export type {
  FormatName,
  LanguageStrategy,
  LanguageParser,
  LanguageUpdate,
  LanguageStrategyOptions,
  Completion,
  JSONValue,
  DeepPartial,
  TextNode,
  ElementNode,
  MarkupNode,
  MarkupDocument,
  CssDocument,
  CssNode,
  CssRule,
  CssDeclaration,
  CssAtRule,
  CssComment,
  Snapshot,
  NormalizerOptions,
} from './types.js';
export { createPatchState, applyPatchBatch } from './patches.js';
export type { StreamPatch, PatchBatch, PatchState, PathIssue } from './patches.js';
export { select } from './selection.js';
export type { Pointer, PathValue } from './paths.js';
export type { SelectionRequirement, SelectionOptions, SelectionResult } from './selection.js';
export { validateSnapshot, streamValidated } from './validation.js';
export type {
  StandardSchemaV1,
  InferInput,
  InferOutput,
  ValidationResult,
  ValidatedSnapshot,
} from './validation.js';
