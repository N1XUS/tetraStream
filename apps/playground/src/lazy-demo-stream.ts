import type { FormatName, Snapshot, StreamNormalizer } from 'tetra-stream';

type Engine = typeof import('./seek-stream.ts');
let engine: Promise<Engine> | undefined;
function loadEngine(): Promise<Engine> {
  // A network failure must not poison subsequent attempts.
  return (engine ??= import('./seek-stream.ts').catch((error: unknown) => {
    engine = undefined;
    throw error;
  }));
}

/** SSR needs only an empty snapshot. Parser code loads on the first playback action. */
export class LazyDemoStream {
  private format: FormatName;
  private load: () => Promise<Engine>;
  private parser: StreamNormalizer | undefined;
  private revision = 0;
  private initial: Snapshot;

  constructor(format: FormatName, load: () => Promise<Engine> = loadEngine) {
    this.format = format;
    this.load = load;
    this.initial = this.empty();
  }
  private empty(): Snapshot {
    return { format: this.format, data: undefined, status: {}, state: 'streaming' };
  }
  snapshot(): Snapshot {
    return this.parser?.snapshot() ?? this.initial;
  }
  cancelPending(): void {
    this.revision++;
  }
  reset(format: FormatName = this.format): void {
    this.cancelPending();
    this.format = format;
    this.parser = undefined;
    this.initial = this.empty();
  }
  async prepare(): Promise<boolean> {
    const revision = ++this.revision;
    if (this.parser) return true;
    try {
      const { StreamNormalizer } = await this.load();
      if (revision !== this.revision) return false;
      this.parser = new StreamNormalizer({ format: this.format });
      return true;
    } catch (error) {
      if (revision !== this.revision) return false;
      this.initial = {
        ...this.empty(),
        state: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  }
  async seek(source: string, position: number) {
    const revision = ++this.revision;
    try {
      const { seekStream } = await this.load();
      if (revision !== this.revision) return undefined;
      const replay = seekStream(source, this.format, position);
      this.parser = replay.parser;
      return replay;
    } catch (error) {
      if (revision !== this.revision) return undefined;
      this.initial = {
        ...this.empty(),
        state: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  }
  write(chunk: string): Snapshot {
    if (!this.parser) throw new Error('Prepare the demo parser before writing');
    return this.parser.write(chunk);
  }
  end(): Snapshot {
    if (!this.parser) throw new Error('Prepare the demo parser before ending');
    return this.parser.end();
  }
}
