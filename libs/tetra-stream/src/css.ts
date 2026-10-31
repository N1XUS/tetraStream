import { parse, type ChildNode } from 'postcss';
import safeParse from 'postcss-safe-parser';
import { replaceCompletions, replaceData } from './mutations.js';
import type { Completion, CssDocument, CssNode, MutableSnapshot } from './types.js';

/**
 * Balance unfinished lexical tokens and blocks for recovery. PostCSS still
 * parses all selectors, declarations, at-rules and nesting. Keeping strings and
 * comments intact prevents their delimiters from becoming repaired CSS rules.
 */
function recoverTokens(source: string, maxDepth: number): {
  input: string; delimiters: Map<number, ';' | '}'>;
} {
  let quote: string | undefined;
  let comment = false;
  let danglingEscape = false;
  const brackets: { closing: ')' | ']' | '}'; url: boolean }[] = [];
  let blockDepth = 0;
  let groupDepth = 0;
  const delimiters = new Map<number, ';' | '}'>();
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (comment) {
      if (char === '*' && source[index + 1] === '/') { comment = false; index++; }
      continue;
    }
    // Escape handling precedes every other token mode, including URL tokens.
    // An escaped semicolon/brace is part of a word, never a boundary.
    if (char === '\\') {
      danglingEscape = index + 1 === source.length;
      index++;
      continue;
    }
    danglingEscape = false;
    if (quote) { if (char === quote) quote = undefined; continue; }
    if (brackets.at(-1)?.url) {
      if (char === ')') { brackets.pop(); groupDepth--; }
      continue;
    }
    if (char === '/' && source[index + 1] === '*') { comment = true; index++; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '(' || char === '[' || char === '{') {
      // PostCSS treats unquoted url(...) as one opaque token, including /*.
      const previous = source[index - 4] ?? '';
      const next = source[index + 1] ?? '';
      const url = char === '(' && source.slice(index - 3, index) === 'url'
        && !/[-_a-zA-Z0-9\\\u0080-\uFFFF]/u.test(previous) && !/[\s'"]/u.test(next);
      brackets.push({ closing: char === '(' ? ')' : char === '[' ? ']' : '}', url });
      if (char === '{') blockDepth++;
      else groupDepth++;
      if (blockDepth > maxDepth || groupDepth > maxDepth) throw new RangeError('Document exceeds maxDepth');
    } else if (char === brackets.at(-1)?.closing) {
      brackets.pop();
      if (char === '}') {
        blockDepth--;
        if (!groupDepth) delimiters.set(index, char);
      } else groupDepth--;
    } else if (!groupDepth && (char === ';' || char === '}')) delimiters.set(index, char);
  }
  return {
    input: source + (comment ? '*/' : quote ? `${danglingEscape ? '\\' : ''}${quote}` : '') + brackets.reverse().map(frame => frame.closing).join(''),
    delimiters,
  };
}

/** Reparse CSS prefixes; strict EOF validation always uses the original input. */
export class CssMachine {
  private source = '';

  constructor(private readonly current: MutableSnapshot, private readonly maxDepth: number) {
    replaceData(current, { kind: 'stylesheet', nodes: [] });
    replaceCompletions(current, { '': 'partial', '/kind': 'complete', '/nodes': 'partial' });
  }

  private update(final: boolean): void {
    const lexical = recoverTokens(this.source, this.maxDepth);
    const input = final ? this.source : lexical.input;
    let root;
    try {
      if (final) root = parse(this.source);
      else {
        // Prefer PostCSS's exact custom-property/block handling. The safe
        // parser is only needed when lexical EOF balancing cannot parse a prefix.
        try { root = parse(this.source); }
        catch {
          try { root = parse(input); }
          catch { root = safeParse(input); }
        }
      }
    }
    catch (error) {
      throw new SyntaxError(error instanceof Error ? error.message : String(error));
    }
    if (root.type !== 'root') throw new SyntaxError('Expected a CSS stylesheet');
    const status: Record<string, Completion> = {};
    const mark = (path: string, complete: boolean): void => { status[path] = complete ? 'complete' : 'partial'; };
    const validFragment = (node: ChildNode): boolean => {
      const start = node.source?.start?.offset;
      const end = node.source?.end?.offset;
      if (start === undefined || end === undefined || end > this.source.length) return false;
      const fragment = this.source.slice(start, end);
      const parentStart = node.parent?.source?.start?.offset;
      const declarationContext = parentStart === undefined ? `x{${fragment}}`
        : this.source.slice(parentStart, end) + (node.parent?.type === 'root' ? '' : '}');
      try {
        parse(node.type === 'decl' ? declarationContext : fragment);
        if (node.type !== 'decl') return true;
        const isolated = parse(`x{${fragment}}`).first;
        if (isolated?.type !== 'rule') return false;
        const declarations = isolated.nodes.filter(child => child.type === 'decl');
        return declarations.length === 1 && declarations[0].prop === node.prop
          && declarations[0].value === node.value && !!declarations[0].important === !!node.important;
      }
      catch { return false; }
    };
    const walk = (node: ChildNode, path: string, parentComplete: boolean, depth: number): CssNode => {
      const end = node.source?.end?.offset;
      const originalEnd = end !== undefined && end <= this.source.length;
      const last = originalEnd ? lexical.delimiters.get(end - 1) : undefined;
      const hasChildren = node.type === 'rule' || node.type === 'atrule' && node.nodes !== undefined;
      if (hasChildren && depth >= this.maxDepth) throw new RangeError('Document exceeds maxDepth');
      let complete = final;
      if (node.type === 'comment') complete ||= originalEnd && this.source.slice(end - 2, end) === '*/';
      else if (hasChildren) complete ||= last === '}' && validFragment(node);
      else if (node.type === 'decl') complete ||= (parentComplete || last === ';') && validFragment(node);
      else complete ||= last === ';' && validFragment(node);
      mark(path, complete);
      mark(`${path}/kind`, true);
      const originalText = (value: string): string => {
        // Only lexical balancing characters can occur beyond the real prefix.
        // Remove them from the displayed value, retaining the original spelling.
        if (!final && end !== undefined && end > this.source.length) {
          const suffix = input.slice(this.source.length, Math.min(end, input.length));
          if (suffix && value.endsWith(suffix)) value = value.slice(0, -suffix.length).trimEnd();
        }
        return value;
      };
      if (node.type === 'decl') {
        const value = originalText(node.value);
        mark(`${path}/property`, true);
        mark(`${path}/value`, complete);
        mark(`${path}/important`, complete);
        const leading = this.source[node.source?.start?.offset ?? 0];
        const property = (leading === '_' || leading === '*' ? leading : '') + node.prop;
        return { kind: 'declaration', property, value, important: !!node.important };
      }
      if (node.type === 'comment') {
        mark(`${path}/text`, complete);
        return { kind: 'comment', text: node.text };
      }
      const children = (): CssNode[] => {
        mark(`${path}/nodes`, complete);
        return (node.nodes ?? []).map((child, index) => walk(child, `${path}/nodes/${index}`, complete, depth + 1));
      };
      if (node.type === 'rule') {
        mark(`${path}/selector`, true);
        return { kind: 'rule', selector: node.selector, nodes: children() };
      }
      const nameEnd = (node.source?.start?.offset ?? 0) + 1 + node.name.length;
      mark(`${path}/name`, final || nameEnd < this.source.length);
      mark(`${path}/params`, complete || hasChildren);
      return { kind: 'at-rule', name: node.name, params: originalText(node.params), ...(node.nodes ? { nodes: children() } : {}) };
    };
    mark('', final);
    mark('/kind', true);
    mark('/nodes', final);
    const data: CssDocument = { kind: 'stylesheet', nodes: root.nodes.map((node, index) => walk(node, `/nodes/${index}`, final, 0)) };
    replaceData(this.current, data);
    replaceCompletions(this.current, status);
  }

  write(chunk: string): void { this.source += chunk; this.update(false); }
  end(): void { this.update(true); }
}
