/** Complete custom-language example; compiled with the other guide recipes. */
export const strategyExample = `import { Format, StreamNormalizer, streamStructured } from 'tetra-stream';
import type { LanguageStrategy, LanguageParser, LanguageUpdate } from 'tetra-stream';

// Built-in formats have runtime enum values. String spellings still work.
const json = new StreamNormalizer({ format: Format.JSON });
json.write('{"name":"Al');

interface Message { text: string }
class PlainTextStrategy implements LanguageStrategy<Message> {
  readonly format = 'plain-text';
  create(): LanguageParser<Message> {
    // This state belongs to one stream, never to the strategy instance.
    let text = '';
    const result = (complete: boolean): LanguageUpdate<Message> => ({
      data: { text },
      status: {
        '': complete ? 'complete' : 'partial',
        '/text': complete ? 'complete' : 'partial',
      },
    });
    return {
      write(chunk) { text += chunk; return result(false); },
      end() { return result(true); },
    };
  }
}

// The output model is inferred from the strategy.
for await (const snapshot of streamStructured(['Hello, ', 'world!'], {
  format: new PlainTextStrategy(),
})) {
  const text: string | undefined = snapshot.data?.text;
  console.log(text, snapshot.status['/text'], snapshot.state);
}`;
