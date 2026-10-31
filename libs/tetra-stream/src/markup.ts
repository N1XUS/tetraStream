import { recordSet, recordAppend, setCompletion } from './mutations.js';
import { Parser } from 'htmlparser2';
import { XmlExtractor } from './xml.js';
import type { ElementNode, MarkupDocument, MarkupNode, MutableSnapshot, TextNode } from './types.js';

type TreeEntry<Node extends MarkupNode | MarkupDocument = ElementNode | MarkupDocument> = { node: Node; path: string };

/** Preserve elements, attributes and ordered mixed text instead of flattening markup. */
export class MarkupMachine {
  private readonly stack: TreeEntry[];
  private lastText: TreeEntry<TextNode> | null;
  private readonly parser: Parser | XmlExtractor;

  constructor(private readonly current: MutableSnapshot, private readonly maxDepth: number) {
    const document: MarkupDocument = { kind: 'document', children: [] };
    this.current.data = document;
    setCompletion(this.current, '', 'partial');
    this.stack = [{ node: document, path: '' }];
    this.lastText = null;
    if (current.format === 'xml') {
      this.parser = new XmlExtractor({
        open: (name, attributes) => this.open(name, attributes),
        close: () => this.close(),
        text: text => this.text(text),
        boundary: () => this.closeText(),
      });
    } else {
      let attributes: Record<string, string> = {};
      this.parser = new Parser({
        // The aggregate htmlparser2 attributes object loses __proto__ keys.
        onattribute: (name, value) => {
          if (!Object.hasOwn(attributes, name)) Object.defineProperty(attributes, name, { value, enumerable: true, configurable: true });
        },
        onopentag: name => { this.open(name, attributes); attributes = {}; },
        ontext: text => this.text(text),
        onclosetag: () => this.close(),
        oncomment: () => this.closeText(),
        onprocessinginstruction: () => this.closeText(),
      }, { decodeEntities: true });
    }
  }

  private open(name: string, attributes: Record<string, string>): void {
    this.closeText();
    if (this.stack.length > this.maxDepth) throw new RangeError('Document exceeds maxDepth');
    const entry = this.append({ kind: 'element', name, attributes, children: [] });
    this.stack.push(entry);
    for (const key of Object.keys(attributes)) {
      setCompletion(this.current, `${entry.path}/attributes/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`, 'complete');
    }
  }

  private close(): void {
    this.closeText();
    const entry = this.stack.pop();
    if (entry && entry.path !== '') setCompletion(this.current, entry.path, 'complete');
  }

  private append<Node extends MarkupNode>(node: Node): TreeEntry<Node> {
    const parent = this.stack.at(-1)!;
    const entry = { node, path: `${parent.path}/children/${parent.node.children.length}` };
    parent.node.children.push(node);
    recordSet(this.current, entry.path);
    setCompletion(this.current, entry.path, 'partial');
    return entry;
  }

  private text(value: string): void {
    if (!value) return;
    if (this.lastText) { this.lastText.node.value += value; recordAppend(this.current, `${this.lastText.path}/value`, value); }
    else this.lastText = this.append({ kind: 'text', value });
  }

  private closeText(): void {
    if (this.lastText) setCompletion(this.current, this.lastText.path, 'complete');
    this.lastText = null;
  }

  write(chunk: string): void { this.parser.write(chunk); }

  end(): void {
    this.parser.end();
    this.closeText();
    setCompletion(this.current, '', 'complete');
  }
}
