import { recordSet, recordAppend, setCompletion } from './mutations.js';
import type { JSONValue, MutableSnapshot } from './types.js';

type Phase = 'value' | 'keyOrEnd' | 'valueOrEnd' | 'key' | 'colon' | 'commaOrEnd' | 'done';
type RootContext = { kind: 'root'; path: ''; phase: Phase };
type ObjectContext = { kind: 'object'; path: string; phase: Phase; value: Record<string, JSONValue>; parent: Context; key: string; keys: Set<string> };
type ArrayContext = { kind: 'array'; path: string; phase: Phase; value: JSONValue[]; parent: Context; keys: Set<string> };
type Context = RootContext | ObjectContext | ArrayContext;
type ValueLocation = { parent: Context; path: string };
type StringToken = ValueLocation & { kind: 'string'; text: string; isKey?: boolean; escape: boolean; unicode: string | null };
type NumberState = 'sign' | 'zero' | 'int' | 'dot' | 'frac' | 'e' | 'esign' | 'exp';
type NumberToken = ValueLocation & { kind: 'number'; raw: string; state: NumberState };
type LiteralToken = ValueLocation & { kind: 'literal'; target: string; index: number };
type Token = StringToken | NumberToken | LiteralToken;

const pointer = (key: string | number): string => String(key).replaceAll('~', '~0').replaceAll('/', '~1');
const whitespace = (char: string): boolean => /[ \t\n\r]/.test(char);
const numericEnd = (state: NumberState): boolean => ['zero', 'int', 'frac', 'exp'].includes(state);
const transitions: Record<NumberState, Record<string, NumberState | undefined>> = {
  sign: { zero: 'zero', digit: 'int' },
  zero: { '.': 'dot', e: 'e' },
  int: { zero: 'int', digit: 'int', '.': 'dot', e: 'e' },
  dot: { zero: 'frac', digit: 'frac' },
  frac: { zero: 'frac', digit: 'frac', e: 'e' },
  e: { '+': 'esign', '-': 'esign', zero: 'exp', digit: 'exp' },
  esign: { zero: 'exp', digit: 'exp' },
  exp: { zero: 'exp', digit: 'exp' },
};

export class JsonMachine {
  private readonly root: RootContext;
  private readonly stack: (ObjectContext | ArrayContext)[];
  private token: Token | null;
  private offset: number;

  constructor(private readonly current: MutableSnapshot, private readonly maxDepth: number) {
    this.root = { kind: 'root', path: '', phase: 'value' };
    this.stack = [];
    this.token = null;
    this.offset = 0;
  }

  private error(message: string): never { throw new SyntaxError(`${message} at offset ${this.offset}`); }
  private parent(): Context { return this.stack.at(-1) ?? this.root; }

  private place(parent: Context): string {
    if (parent.kind === 'root') return '';
    return `${parent.path}/${pointer(parent.kind === 'array' ? parent.value.length : parent.key)}`;
  }

  private assign(parent: Context, value: JSONValue, path: string, appended?: string): void {
    if (appended !== undefined) recordAppend(this.current, path, appended);
    else recordSet(this.current, path);
    if (parent.kind === 'root') this.current.data = value;
    else {
      const key = parent.kind === 'array' ? path.slice(path.lastIndexOf('/') + 1) : parent.key;
      // defineProperty handles keys such as __proto__ as data, without setters.
      Object.defineProperty(parent.value, key, { value, writable: true, configurable: true, enumerable: true });
    }
  }

  private finish(token: ValueLocation): void {
    setCompletion(this.current, token.path, 'complete');
    token.parent.phase = token.parent.kind === 'root' ? 'done' : 'commaOrEnd';
    this.token = null;
  }

  private begin(char: string, parent: Context): void {
    const path = this.place(parent);
    setCompletion(this.current, path, 'partial');
    if (char === '{' || char === '[') {
      if (this.stack.length >= this.maxDepth) throw new RangeError('Document exceeds maxDepth');
      if (char === '{') {
        const value: Record<string, JSONValue> = {};
        this.assign(parent, value, path);
        this.stack.push({ kind: 'object', value, path, parent, phase: 'keyOrEnd', key: '', keys: new Set() });
      } else {
        const value: JSONValue[] = [];
        this.assign(parent, value, path);
        this.stack.push({ kind: 'array', value, path, parent, phase: 'valueOrEnd', keys: new Set() });
      }
    } else if (char === '"') {
      this.assign(parent, '', path);
      this.token = { kind: 'string', parent, path, text: '', escape: false, unicode: null };
    } else if (char === '-' || /[0-9]/.test(char)) {
      const state = char === '-' ? 'sign' : char === '0' ? 'zero' : 'int';
      this.token = { kind: 'number', parent, path, raw: char, state };
      if (numericEnd(state)) this.assign(parent, Number(char), path);
    } else if ('tfn'.includes(char)) {
      this.token = { kind: 'literal', parent, path, target: ({ t: 'true', f: 'false', n: 'null' } as Record<string, string>)[char], index: 1 };
    } else this.error('Expected a JSON value');
  }

  private string(char: string, token: StringToken): void {
    const previousLength = token.text.length;
    if (token.unicode !== null) {
      if (!/[a-fA-F0-9]/.test(char)) this.error('Invalid Unicode escape');
      token.unicode += char;
      if (token.unicode.length === 4) {
        token.text += String.fromCharCode(parseInt(token.unicode, 16));
        token.unicode = null;
      }
    } else if (token.escape) {
      token.escape = false;
      if (char === 'u') token.unicode = '';
      else {
        const escapes: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (!Object.hasOwn(escapes, char)) this.error('Invalid string escape');
        token.text += escapes[char];
      }
    } else if (char === '\\') token.escape = true;
    else if (char === '"') {
      if (token.isKey) {
        if (token.parent.kind !== 'object') this.error('Object key outside an object');
        if (token.parent.keys.has(token.text)) this.error(`Duplicate key ${JSON.stringify(token.text)}`);
        token.parent.keys.add(token.text);
        token.parent.key = token.text;
        token.parent.phase = 'colon';
        this.token = null;
      } else this.finish(token);
      return;
    } else {
      if (char.charCodeAt(0) < 0x20) this.error('Unescaped control character');
      token.text += char;
    }
    if (!token.isKey && token.text.length !== previousLength) this.assign(token.parent, token.text, token.path, token.text.slice(previousLength));
  }

  private number(char: string, token: NumberToken): boolean {
    const category = char === '0' ? 'zero' : /[1-9]/.test(char) ? 'digit' : /[eE]/.test(char) ? 'e' : char;
    const next = transitions[token.state][category];
    if (next) {
      token.state = next;
      token.raw += char;
      if (numericEnd(next) && Number.isFinite(Number(token.raw))) this.assign(token.parent, Number(token.raw), token.path);
      return true;
    }
    if (!whitespace(char) && ![',', '}', ']'].includes(char)) this.error('Invalid number');
    this.finishNumber(token);
    return false; // The delimiter belongs to the container; process it again.
  }

  private finishNumber(token: NumberToken): void {
    if (!numericEnd(token.state)) this.error('Incomplete number');
    const value = Number(token.raw);
    if (!Number.isFinite(value)) this.error('Number is outside the finite JavaScript range');
    this.assign(token.parent, value, token.path);
    this.finish(token);
  }

  write(chunk: string): void {
    for (let index = 0; index < chunk.length; index++, this.offset++) {
      const char = chunk[index];
      const token = this.token;
      if (token?.kind === 'string') { this.string(char, token); continue; }
      if (token?.kind === 'literal') {
        if (char !== token.target[token.index++]) this.error('Invalid literal');
        if (token.index === token.target.length) {
          this.assign(token.parent, JSON.parse(token.target), token.path);
          this.finish(token);
        }
        continue;
      }
      if (token?.kind === 'number' && this.number(char, token)) continue;
      if (whitespace(char)) continue;
      const parent = this.parent();
      const close = parent.kind === 'object' ? '}' : ']';
      if (parent.phase === 'done') this.error('Unexpected content after the root value');
      if (['keyOrEnd', 'valueOrEnd', 'commaOrEnd'].includes(parent.phase) && char === close && parent.kind !== 'root') {
        this.stack.pop();
        this.finish(parent);
      } else if (parent.kind === 'object' && ['key', 'keyOrEnd'].includes(parent.phase)) {
        if (char !== '"') this.error('Expected an object key');
        this.token = { kind: 'string', parent, path: '', isKey: true, text: '', escape: false, unicode: null };
      } else if (parent.phase === 'colon') {
        if (char !== ':') this.error('Expected a colon');
        parent.phase = 'value';
      } else if (parent.phase === 'commaOrEnd') {
        if (char !== ',') this.error('Expected a comma or closing delimiter');
        parent.phase = parent.kind === 'object' ? 'key' : 'value';
      } else if (['value', 'valueOrEnd'].includes(parent.phase)) this.begin(char, parent);
      else this.error('Unexpected token');
    }
  }

  end(): void {
    if (this.token?.kind === 'number') this.finishNumber(this.token);
    if (this.token || this.stack.length || this.root.phase !== 'done') this.error('Stream ended before the JSON document was complete');
  }
}
