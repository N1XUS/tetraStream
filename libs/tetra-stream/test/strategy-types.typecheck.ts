import {
  Format,
  StreamNormalizer,
  streamStructured,
  streamPatches,
  createPatchState,
  select,
} from '../dist/index.js';
import type {
  FormatName,
  LanguageStrategy,
  LanguageParser,
  LanguageStrategyOptions,
  LanguageUpdate,
  Snapshot,
} from '../dist/index.js';
interface Message {
  text: string;
  count: number;
}
class MessageStrategy implements LanguageStrategy<Message> {
  readonly format = 'message';
  create(_options: LanguageStrategyOptions): LanguageParser<Message> {
    const update: LanguageUpdate<Message> = {
      data: { text: 'hello' },
      status: { '/text': 'partial' },
    };
    return { write: () => update, end: () => update };
  }
}
const strategy = new MessageStrategy();
const parser = new StreamNormalizer({ format: strategy });
const snapshot: Snapshot<Message> = parser.write('hello');
const text: string | undefined = snapshot.data?.text;
const count: number | undefined = parser.snapshot().data?.count;
// @ts-expect-error A custom parser's model is inferred rather than any.
const wrong: number = parser.snapshot().data?.text;
select(parser.snapshot(), '/text');
// @ts-expect-error Custom models retain pointer checking.
select(parser.snapshot(), '/missing');
const literal: FormatName = 'json';
const enumValue: Format = Format.JSON;
new StreamNormalizer({ format: literal });
new StreamNormalizer({ format: enumValue });
const inferredState = createPatchState({ format: strategy });
const inferred: string | undefined = inferredState.data?.text;
// @ts-expect-error Accumulators also infer custom strategy models.
const incorrect: number = inferredState.data?.text;
void [inferred, incorrect];
// @ts-expect-error Unsupported names require a strategy implementation.
new StreamNormalizer({ format: 'toml' });
// @ts-expect-error A parser result must supply completion metadata.
const invalid: LanguageParser<Message> = { write: () => ({ data: {} }), end: () => ({ data: {} }) };
async function consume() {
  for await (const item of streamStructured(['a'], { format: strategy })) {
    const value: string | undefined = item.data?.text;
    // @ts-expect-error Stream helper infers the strategy's model too.
    const invalid: boolean = item.data?.count;
    void [value, invalid];
  }
  for await (const item of streamPatches(['a'], { format: strategy })) void item.format;
}
void [text, count, wrong, invalid, consume];
