import { StreamNormalizer, streamStructured, type Snapshot, type MarkupDocument } from '../dist/index.js';

interface User { name: string; skills: string[]; address: { city: string } }
const parser = new StreamNormalizer<User>({ format: 'json' });
const partial = parser.write('{"name":"Al');
const name: string | undefined = partial.data?.name;
const city: string | undefined = partial.data?.address?.city;
const skill: string | undefined = partial.data?.skills?.[0];
void [name, city, skill];

// A snapshot never promises missing fields have arrived, even at document end.
// @ts-expect-error Partial fields require a presence check.
const requiredName: string = partial.data.name;
// @ts-expect-error The core API accepts decoded text, not transport bytes.
parser.write(new Uint8Array());
// @ts-expect-error Unknown formats cannot be selected.
new StreamNormalizer({ format: 'toml' });

for (const format of ['yaml', 'yml', 'ndjson', 'jsonl', 'csv', 'tsv'] as const) {
  new StreamNormalizer({ format });
}

async function consume(source: AsyncIterable<string>) {
  for await (const result of streamStructured<User>(source)) {
    const typed: Snapshot<User> = result;
    void typed.data?.name;
  }
}
void consume;
const xml = new StreamNormalizer<MarkupDocument>({ format: 'xml' });
const children = xml.write('<user>').data?.children;
void children;
