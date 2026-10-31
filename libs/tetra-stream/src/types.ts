/** Built-in language identifiers available at runtime and in TypeScript. */
export enum Format {
  JSON = 'json',
  XML = 'xml',
  HTML = 'html',
  YAML = 'yaml',
  YML = 'yml',
  NDJSON = 'ndjson',
  JSONL = 'jsonl',
  CSV = 'csv',
  TSV = 'tsv',
  CSS = 'css',
}
/** String spellings remain accepted for existing integrations. */
export type FormatName = `${Format}`;

/** Per-stream limits passed to a custom strategy. Enforce nesting in your parser. */
export interface LanguageStrategyOptions {
  readonly maxDepth: number;
  readonly maxLength: number;
}
/** Provisional JSON-compatible plain data and RFC 6901 completion pointers.
 * Omit unavailable properties. Dense arrays only; no nested undefined, cycles, or shared object references. */
export interface LanguageUpdate<T = unknown> {
  readonly data: DeepPartial<T> | undefined;
  readonly status: Readonly<Record<string, Completion>>;
}
/** Synchronous, incremental parser for one document. Throw for invalid input. */
export interface LanguageParser<T = unknown> {
  write(chunk: string): LanguageUpdate<T>;
  /** Validate the original document at EOF and return its final completions. */
  end(): LanguageUpdate<T>;
}
/** Implement with a class or object. create() must return a fresh parser per stream. */
export interface LanguageStrategy<T = unknown> {
  readonly format: string;
  create(options: LanguageStrategyOptions): LanguageParser<T>;
}
export type Completion = 'partial' | 'complete';
export type JSONValue =
  string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue };
export type DeepPartial<T> = T extends readonly (infer Item)[]
  ? DeepPartial<Item>[]
  : T extends object
    ? { [Key in keyof T]?: DeepPartial<T[Key]> }
    : T;
export interface TextNode {
  kind: 'text';
  value: string;
}
export interface ElementNode {
  kind: 'element';
  name: string;
  attributes: Record<string, string>;
  children: MarkupNode[];
}
export type MarkupNode = TextNode | ElementNode;
export interface MarkupDocument {
  kind: 'document';
  children: MarkupNode[];
}

/** Ordered CSS nodes preserve declarations, comments, at-rules and nesting. */
export interface CssDocument {
  kind: 'stylesheet';
  nodes: CssNode[];
}
export interface CssRule {
  kind: 'rule';
  selector: string;
  nodes: CssNode[];
}
export interface CssDeclaration {
  kind: 'declaration';
  property: string;
  value: string;
  important: boolean;
}
export interface CssAtRule {
  kind: 'at-rule';
  name: string;
  params: string;
  nodes?: CssNode[];
}
export interface CssComment {
  kind: 'comment';
  text: string;
}
export type CssNode = CssRule | CssDeclaration | CssAtRule | CssComment;
// Type-only identity preserves model inference through derived snapshot interfaces.
// No symbol property is created or required at runtime, and this is not validation.
declare const snapshotModel: unique symbol;
export interface Snapshot<T = JSONValue | MarkupDocument | CssDocument> {
  readonly [snapshotModel]?: T;
  format: string;
  data: DeepPartial<T> | undefined;
  /** RFC 6901 JSON Pointers. Empty string refers to the document root. */
  status: Record<string, Completion>;
  state: 'streaming' | 'complete' | 'error';
  error?: string;
}

export interface NormalizerOptions<T = unknown> {
  format?: FormatName | LanguageStrategy<T>;
  /** Maximum incoming UTF-16 code units. Defaults to 1,000,000. */
  maxLength?: number;
  /** Maximum nesting depth. Defaults to 128. */
  maxDepth?: number;
}

/** Internal mutable state shared by the format adapters. */
export interface MutableSnapshot {
  format: string;
  data: unknown;
  status: Record<string, Completion>;
  state: 'streaming' | 'complete' | 'error';
  error?: string;
}
