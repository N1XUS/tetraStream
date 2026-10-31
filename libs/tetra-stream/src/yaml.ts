import { replaceData, replaceCompletions, setCompletion } from './mutations.js';
import { isAlias, isMap, isScalar, isSeq, parseDocument, type Node, type Scalar } from 'yaml';
import type { Completion, JSONValue, MutableSnapshot } from './types.js';

const pointer = (key: string): string => key.replaceAll('~', '~0').replaceAll('/', '~1');
const absent = Symbol('not-yet-available');
const tags = new Set(['str', 'int', 'float', 'bool', 'null', 'map', 'seq'].map(name => `tag:yaml.org,2002:${name}`));

/**
 * Reparse the prefix with public YAML AST/CST APIs. YAML indentation and plain
 * scalars are ambiguous until following structure arrives. Snapshots are
 * provisional; syntax validation is strict at end(). No repair changes input.
 */
export class YamlMachine {
  private source = '';

  constructor(private readonly current: MutableSnapshot, private readonly maxDepth: number) {}

  private quotedValue(node: Scalar): string {
    const token = node.srcToken;
    if (!token || !('source' in token)) return String(node.value ?? '');
    const raw = token.source;
    if (node.type === 'QUOTE_SINGLE') {
      const body = raw.slice(1);
      const closed = body.endsWith("'") && body.match(/'+$/)![0].length % 2 === 1;
      const prefix = closed ? body.slice(0, -1) : body;
      // Do not expose the first half of an escaped quote until the second arrives.
      const safe = !closed && prefix.endsWith("'") && prefix.match(/'+$/)![0].length % 2 === 1 ? prefix.slice(0, -1) : prefix;
      return String(parseDocument(`'${safe}'`).toJS() ?? '');
    }
    let end = raw.length;
    let closed = false;
    for (let index = 1; index < raw.length; index++) {
      if (raw[index] === '"') { closed = true; break; }
      if (raw[index] !== '\\') continue;
      const escapeStart = index;
      const kind = raw[++index];
      const digits = kind === 'x' ? 2 : kind === 'u' ? 4 : kind === 'U' ? 8 : 0;
      if (kind === undefined || (kind === '\r' && index === raw.length - 1) || (digits && raw.length - index - 1 < digits)) { end = escapeStart; break; }
      index += digits;
    }
    const repaired = closed ? raw : `${raw.slice(0, end)}"`;
    const value = parseDocument(repaired);
    return value.errors.length ? '' : String(value.toJS() ?? '');
  }

  private update(final: boolean): void {
    const document = parseDocument(this.source, { keepSourceTokens: true, strict: true, uniqueKeys: true, schema: 'core', version: '1.2' });
    if (final && document.errors.length) throw new SyntaxError(document.errors.map(error => error.message).join('; '));
    if (final && document.warnings.length) throw new SyntaxError(document.warnings.map(warning => warning.message).join('; '));
    const status: Record<string, Completion> = { '': 'partial' };
    const walk = (node: Node | null, path: string, settled: boolean, depth: number, isMapValue = false): JSONValue | typeof absent => {
      status[path] = 'partial';
      if (!node) { if (final || settled) { status[path] = 'complete'; return null; } return absent; }
      if (node.tag && !tags.has(node.tag)) {
        if (final) throw new SyntaxError(`Unsupported YAML tag ${node.tag}`);
        return absent;
      }
      if (isAlias(node)) {
        if (final) throw new SyntaxError('YAML aliases are unsupported');
        return absent;
      }
      if (isMap(node) || isSeq(node)) {
        if (depth >= this.maxDepth) throw new RangeError('Document exceeds maxDepth');
        const closed = node.srcToken?.type === 'flow-collection' && node.srcToken.end.some(token => token.type === 'flow-map-end' || token.type === 'flow-seq-end');
        const complete = final || settled || closed;
        status[path] = complete ? 'complete' : 'partial';
        if (isMap(node)) {
          const value: Record<string, JSONValue> = {};
          for (let index = 0; index < node.items.length; index++) {
            const pair = node.items[index];
            if (!isScalar(pair.key) || typeof pair.key.value !== 'string') {
              if (final) throw new SyntaxError('YAML mapping keys must be strings');
              continue;
            }
            const hasColon = pair.srcToken?.sep?.some(token => token.type === 'map-value-ind');
            if (!hasColon && !complete) continue;
            const key = pair.key.value;
            if (Object.hasOwn(value, key)) continue; // Final parser validation rejects duplicate keys.
            const boundary = index + 1 < node.items.length || complete;
            const child = walk(pair.value as Node | null, `${path}/${pointer(key)}`, boundary, depth + 1, true);
            if (child !== absent) Object.defineProperty(value, key, { value: child, enumerable: true, writable: true, configurable: true });
          }
          return value;
        }
        const value: JSONValue[] = [];
        node.items.forEach((item, index) => {
          const child = walk(item as Node | null, `${path}/${index}`, index + 1 < node.items.length || complete, depth + 1);
          if (child !== absent) value[index] = child;
        });
        return value;
      }
      if (!isScalar(node)) throw new SyntaxError('Unsupported YAML node');
      const token = node.srcToken;
      let closed = false;
      if (node.type === 'QUOTE_DOUBLE' && token && 'source' in token) {
        // A closing double quote is definitive unless it is escaped.
        const raw = token.source;
        let escaped = false;
        for (let index = 1; index < raw.length; index++) {
          if (escaped) { escaped = false; continue; }
          if (raw[index] === '\\') escaped = true;
          else if (raw[index] === '"') { closed = true; break; }
        }
      }
      if (node.type === 'QUOTE_SINGLE' && token && 'source' in token) {
        const raw = token.source;
        closed = raw.endsWith("'") && (raw.slice(1).match(/'+$/)?.[0].length ?? 0) % 2 === 1 && (node.range?.[1] ?? this.source.length) < this.source.length;
      }
      // In a flow collection a comma/closing bracket is also a scalar boundary.
      const flowBoundary = !!token && 'end' in token && token.end?.some(end => end.type === 'comma' || end.type === 'flow-map-end' || end.type === 'flow-seq-end');
      const complete = final || settled || (closed && isMapValue) || !!flowBoundary;
      status[path] = complete ? 'complete' : 'partial';
      if (node.source === '' && node.value === null && !complete) return absent;
      let value: unknown = node.value;
      if (node.type === 'QUOTE_DOUBLE' || node.type === 'QUOTE_SINGLE') value = final ? node.value : this.quotedValue(node);
      if (!complete && (node.type === 'BLOCK_LITERAL' || node.type === 'BLOCK_FOLDED') && token?.type === 'block-scalar' && !token.source.endsWith('\n') && typeof value === 'string' && value.endsWith('\n')) value = value.slice(0, -1);
      if (typeof value === 'number' && !Number.isFinite(value)) {
        if (final) throw new SyntaxError('YAML numbers must be finite');
        return absent;
      }
      if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw new SyntaxError('YAML value is not JSON-compatible');
      return value as JSONValue;
    };
    const data = document.contents ? walk(document.contents, '', false, 0) : final ? null : absent;
    replaceData(this.current, data === absent ? undefined : data);
    replaceCompletions(this.current, status);
    if (final) setCompletion(this.current, '', 'complete');
  }

  write(chunk: string): void { this.source += chunk; this.update(false); }
  end(): void { this.update(true); }
}
