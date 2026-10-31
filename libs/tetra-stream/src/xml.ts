import { SaxesParser } from 'saxes';

const namedEntities: Record<string, string> = { amp: '&', lt: '<', gt: '>', apos: "'", quot: '"' };
const openings = ['<!--', '<![CDATA[', '<?'];

/**
 * Saxes owns validation, structure and attribute normalization. A small lexical
 * observer exposes character data without waiting for saxes' text/CDATA buffers
 * to flush. It uses no parser internals and never changes the input.
 */
export interface XmlEvents {
  open(name: string, attributes: Record<string, string>): void;
  close(): void;
  text(value: string): void;
  boundary(): void;
}

export class XmlExtractor {
  private mode: 'text' | 'opening' | 'tag' | 'cdata' | 'comment' | 'pi';
  private buffer: string;
  private entity: string;
  private quote: string | null;
  private previousCR: boolean;
  private version: string;
  private offset: number;
  private readonly parser: SaxesParser<{ xmlns: true }>;

  constructor(private readonly events: XmlEvents) {
    this.mode = 'text';
    this.buffer = '';
    this.entity = '';
    this.quote = null;
    this.previousCR = false;
    this.version = '1.0';
    this.offset = 0;
    this.parser = new SaxesParser({ xmlns: true });
    this.parser.on('error', (error) => {
      throw new SyntaxError(error.message);
    });
    this.parser.on('doctype', () => {
      throw new SyntaxError('DTD declarations are unsupported');
    });
    this.parser.on('xmldecl', (declaration) => {
      this.version = declaration.version ?? '1.0';
    });
    this.parser.on('opentag', (tag) => {
      const attributes = Object.fromEntries(
        Object.values(tag.attributes).map((attribute) => [attribute.name, attribute.value]),
      );
      events.open(tag.name, attributes);
    });
    this.parser.on('closetag', () => events.close());
  }

  private literal(char: string): void {
    const xml11 = this.version === '1.1';
    const pairedNewline = char === '\n' || (xml11 && char === '\u0085');
    if (this.previousCR && pairedNewline) {
      this.previousCR = false;
      return;
    }
    this.previousCR = char === '\r';
    const newline = char === '\r' || (xml11 && (char === '\u0085' || char === '\u2028'));
    this.events.text(newline ? '\n' : char);
  }

  private observe(char: string): void {
    if (this.mode === 'text') {
      if (this.entity) {
        this.entity += char;
        if (char === ';') {
          const body = this.entity.slice(1, -1);
          const value = body.startsWith('#x')
            ? String.fromCodePoint(parseInt(body.slice(2), 16))
            : body.startsWith('#')
              ? String.fromCodePoint(parseInt(body.slice(1), 10))
              : namedEntities[body];
          // Validation checks references first. Character references bypass
          // literal whitespace normalization (e.g. &#13; stays CR).
          this.events.text(value);
          this.entity = '';
        }
      } else if (char === '&') {
        this.previousCR = false;
        this.entity = '&';
      } else if (char === '<') {
        this.events.boundary();
        this.previousCR = false;
        this.mode = 'opening';
        this.buffer = '<';
      } else if (!(this.offset === 0 && char === '\uFEFF')) this.literal(char);
      return;
    }

    if (this.mode === 'opening') {
      this.buffer += char;
      if (this.buffer === '<!--') {
        this.mode = 'comment';
        this.buffer = '';
      } else if (this.buffer === '<![CDATA[') {
        this.mode = 'cdata';
        this.buffer = '';
      } else if (this.buffer === '<?') {
        this.mode = 'pi';
        this.buffer = '';
      } else if (!openings.some((opening) => opening.startsWith(this.buffer))) {
        this.mode = 'tag';
        this.buffer = '';
      }
      return;
    }

    if (this.mode === 'tag') {
      if (this.quote) {
        if (char === this.quote) this.quote = null;
      } else if (char === '"' || char === "'") this.quote = char;
      else if (char === '>') this.mode = 'text';
      return;
    }

    if (this.mode === 'cdata') {
      this.buffer += char;
      if (this.buffer === ']]>') {
        this.events.boundary();
        this.previousCR = false;
        this.buffer = '';
        this.mode = 'text';
      } else {
        // Hold only a possible closing delimiter, at most two trailing ']'.
        while (this.buffer && !']]>'.startsWith(this.buffer)) {
          this.literal(this.buffer[0]);
          this.buffer = this.buffer.slice(1);
        }
      }
      return;
    }

    const ending = this.mode === 'comment' ? '-->' : '?>';
    this.buffer = (this.buffer + char).slice(-ending.length);
    if (this.buffer === ending) {
      this.mode = 'text';
      this.buffer = '';
    }
  }

  write(chunk: string): void {
    // Coordinate structural events with the observer in source order. Validate
    // each character before exposing it to consumers.
    for (const char of chunk) {
      this.parser.write(char);
      this.observe(char);
      this.offset += char.length;
    }
  }

  end(): void {
    this.parser.close();
  }
}
