# TetraStream (`tetra-stream`)

Structured data, as it arrives.

Progressively parse streamed **JSON, YAML, XML, HTML, JSON Lines, CSV, TSV, and CSS** while values are still being generated. Each snapshot includes the available data and explicit `partial` / `complete` states. Written in strict TypeScript; distributed as ESM JavaScript with generated declarations.

## Installation

```sh
npm install tetra-stream
```

This early `0.2.x` release requires a modern browser or Node.js 20+. It has no dependency on RivetJS or any UI framework. For an unreleased local build, install the generated `tetra-stream-VERSION.tgz` archive instead.

## Parse growing values

```ts
import { StreamNormalizer } from 'tetra-stream';

interface User {
  name: string;
  bio: string;
  skills: string[];
}

const parser = new StreamNormalizer<User>({ format: 'json' });
const snapshot = parser.write('{"name":"Alice","bio":"Software eng');

snapshot.data;
// { name: 'Alice', bio: 'Software eng' }
snapshot.status;
// { '': 'partial', '/name': 'complete', '/bio': 'partial' }
snapshot.state;
// 'streaming'

parser.write('ineer"}');
const final = parser.end(); // state: 'complete'
```

`data` is `DeepPartial<User> | undefined`: fields that have not arrived remain absent. A generic type describes your expected shape; it does not validate the model's output against a schema. Even a complete document can omit expected fields. Use schema validation below before taking actions.

## Consume an async text stream

```ts
import { streamStructured } from 'tetra-stream';

// HTML: <h2 id="user-name">Waiting…</h2>
const name = document.getElementById('user-name');
if (!name) throw new Error('Missing #user-name');

async function* textChunks() {
  yield '{"name":"Alex';
  await new Promise((resolve) => setTimeout(resolve, 400));
  yield ' Morgan"}';
}

try {
  for await (const snapshot of streamStructured<{ name: string }>(textChunks())) {
    name.textContent = snapshot.data?.name ?? 'Waiting…';
  }
} catch (error) {
  console.error('Stream interrupted:', error);
}
```

`textChunks()` above is a simulated async iterable. In an application, supply an `AsyncIterable<string>` or `Iterable<string>` of decoded text from your provider or transport. Select one ordered content stream first: strip SSE envelopes and separate interleaved tool calls. For byte streams, use an incremental decoder such as `TextDecoderStream` before parsing. No provider SDK or API key is required by this library.

## Typed completion policies

```ts
import { StreamNormalizer, select } from 'tetra-stream';

type Profile = { name: string; avatar: string };
const parser = new StreamNormalizer<Profile>();
const snapshot = parser.write('{"name":"Alex","avatar":"/avatars/ale');

const name = select(snapshot, '/name');
if (name.status === 'partial' || name.status === 'complete') {
  console.log(name.value); // "Alex"; inferred string
}
const avatar = select(snapshot, '/avatar', { require: 'complete' });
console.log(avatar.status); // "pending": do not assign an image src yet

const next = parser.write('x-morgan.png"}');
const ready = select(next, '/avatar', { require: 'complete' });
if (ready.status === 'complete') console.log(ready.value);
// "/avatars/alex-morgan.png"; field complete, document still streaming
console.log(parser.end().state); // "complete" after successful EOF
```

`select()` returns immediately from the supplied snapshot. `require` is `partial`, `complete`, or `document` and filters which values are exposed now. A returned selection stays unchanged; call `select` again with a newer snapshot for updated data. Results discriminate on `status`: `pending`/`missing` have no value; `partial`/`complete` expose the selected value. `state` retains the parser lifecycle. `pending.completion`, when present, describes the withheld value's syntax. An absent field becomes `missing` when its container or stream finishes. A partial value can remain pending after a parse error; inspect `state` to show an interrupted state. Completed fields can remain visible after an unrelated parse error, but document policy only exposes successfully ended documents.

`Pointer<User>` autocompletes nested paths and rejects unknown literal keys; `PathValue<User, '/name'>` infers `string`. Object keys use RFC 6901 escaping; arrays use numeric segments. Typed paths have an eight-segment recursion bound to support recursive models without exhausting the compiler. Runtime array indices must be canonical non-negative integers. `false`, `0`, `null`, and empty strings are real values. Selecting a completed object or array still returns `DeepPartial`: syntax cannot prove required fields exist or types are correct.

## Incremental patch output

```ts
import { streamPatches, createPatchState, applyPatchBatch } from 'tetra-stream';

type Profile = { name: string; bio: string };
const output = document.createElement('p');
document.body.append(output);
const state = createPatchState<Profile>({ format: 'json' });

async function* textChunks() {
  for (const chunk of ['{"bio":"Making com', 'plex things simple."}']) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    yield chunk;
  }
}

try {
  for await (const batch of streamPatches(textChunks(), { format: 'json' })) {
    applyPatchBatch(state, batch); // replay every batch in order
    output.textContent = state.data?.bio ?? 'Waiting…';
  }
} catch (error) {
  console.error('The last rendered value remains visible:', error);
}
```

Or use `parser.writePatch(chunk)` and `parser.endPatch()`. The existing `write()`/`end()` snapshot API is preserved. Patch mode journals touched paths and clones only newly set values, rather than accumulated documents. Decoded string growth emits only the suffix. YAML still reparses the prefix and diffs the resulting tree.

A `PatchBatch` contains `format`, a sequential `sequence` starting at 1, `patches`, parser `state`, and optional `error`. The operations are a TetraStream protocol, not RFC 6902 JSON Patch:

| Operation | Meaning                                                   |
| --------- | --------------------------------------------------------- |
| `set`     | Replace the value at `path` with `value`.                 |
| `append`  | Append the decoded string suffix in `value` at `path`.    |
| `remove`  | Remove a provisional value.                               |
| `status`  | Set the path's completion; `null` removes its old status. |

Paths are RFC 6901 pointers relative to data. Replay batches from one parser in order into a fresh accumulator of the same format. `applyPatchBatch` mutates and returns that consumer-owned accumulator; it copies incoming set values so events, parser state, and consumer state do not alias. Do not treat the accumulator as an immutable historical snapshot. A raw event's heterogeneous `set.value` is intentionally `unknown`; typed model access goes through `PatchState<User>` and `select`, and validated output goes through a schema.

Parsing errors still throw. With the direct parser, catch the error and drain `parser.patch()` to replay retained data, completion updates, and error state. `streamPatches` propagates source and parsing errors just like `streamStructured`; keep the last rendered state. To change output modes after parsing has started, use a fresh accumulator: the first patch batch includes the current baseline. Calling `patch()` drains pending changes and advances the sequence; do not discard batches needed by a consumer.

## Schema validation and inferred types

Compatible [Standard Schema V1](https://standardschema.dev/) validators plug in without a required validator dependency. This example uses optional Zod 4:

```ts
import { z } from 'zod';
import { streamValidated } from 'tetra-stream';

const schema = z.object({
  name: z.string().min(1),
  age: z.string().transform(Number),
});
for await (const snapshot of streamValidated(textChunks, { format: 'json', schema })) {
  snapshot.data?.age; // string | undefined: partial, unvalidated input
  if (snapshot.validation.status === 'valid') {
    snapshot.validation.value.name; // string: validated required field
    snapshot.validation.value.age; // number: inferred transform output
  }
}
```

`validateSnapshot(snapshot, schema)` is also available for an existing parser or patch accumulator. Both sync and async schema validators are accepted; this helper always returns a promise. Validation runs only after successful document EOF, so incomplete required fields do not produce premature failures. Raw data remains unchanged: validators receive a clone, and transformed output is separate.

| Validation status | Meaning                                                               |
| ----------------- | --------------------------------------------------------------------- |
| `pending`         | Input is still streaming; the schema has not run.                     |
| `valid`           | `value` has the schema's full inferred output type.                   |
| `invalid`         | Parsing succeeded but the schema returned `issues`.                   |
| `parse-error`     | The supplied snapshot has a parser error; the schema did not run.     |
| `validator-error` | The validator threw or rejected; this is distinct from invalid input. |

`streamValidated` propagates parser/source exceptions as the existing stream adapters do. Its snapshots infer the schema's input type, while only the narrowed `validation.value` exposes its output type. Exported `InferInput`, `InferOutput`, `ValidatedSnapshot`, and `StandardSchemaV1` are available for application declarations. Type parameters on `StreamNormalizer<T>` alone never validate model output.

## Completion contract

| Signal                        | Meaning                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| No value at a path            | The value is not available yet. Consumers can show a placeholder.                                            |
| `status[path] === 'partial'`  | The value can still grow or change.                                                                          |
| `status[path] === 'complete'` | The value ended syntactically. The rest of the document may still fail.                                      |
| `state === 'streaming'`       | The input is still open, even when the root has closed.                                                      |
| `state === 'complete'`        | `end()` succeeded under the selected format's syntax rules.                                                  |
| `state === 'error'`           | Input was malformed, a limit was exceeded, or the document was truncated. Available data remains accessible. |

Paths use RFC 6901 JSON Pointer. `''` identifies the root, `/skills/0` identifies an array item, and `~` and `/` inside keys are escaped as `~0` and `~1`. Incomplete object keys are never exposed. A path can have partial status before a value is available, such as an initial `-` or `tr`.

`write()`, `end()`, and `snapshot()` return independent copies. Invalid input throws; use `parser.snapshot()` after catching the error to inspect the retained data and error state. Failed or completed instances reject further writes. Create a new normalizer for another document.

### JSON

Strings expose decoded characters immediately; unfinished escapes wait until enough characters arrive. Numbers remain partial until a delimiter or EOF: `2` can become `25`, `2.5`, or `2e3`. While a suffix such as `25e` is unfinished, the last finite numeric prefix (`25`) remains visible as partial. Booleans and `null` appear when the full literal is available. Empty strings, `false`, `0`, and `null` remain real values.

Malformed syntax and duplicate keys are rejected. The parser does not invent missing values or repair invalid output. Numbers use JavaScript `number` precision; nonfinite results are rejected. Prototype-like keys such as `__proto__` remain ordinary data properties.

### YAML / YML

Use `format: 'yaml'` or `format: 'yml'`. YAML maps and sequences become JSON-compatible objects and arrays with the same pointer paths as JSON. Both flow and indentation syntax, quoted strings, literal/folded blocks, comments, and core scalar types are supported.

```ts
const yaml = new StreamNormalizer<User>({ format: 'yml' });
yaml.write('name: Alice\nbio: Software eng');
// { name: 'Alice', bio: 'Software eng' }
// name: complete; bio: partial
```

A newline alone does not complete a plain YAML scalar: an indented continuation may follow. Following sibling structure or EOF settles it. A trailing single quote can become the first half of a doubled quote, so it remains partial until enough input arrives. Plain values can change type as they grow, e.g. `true` → `trueish`. Empty values are withheld until a boundary/EOF establishes YAML null. An unfinished root scalar or sequence scalar can also become a mapping key.

The adapter reparses the current prefix using the public `yaml` AST/CST APIs and buffers unfinished quoted escapes. Syntax errors may be provisional while input is open; `end()` strictly validates. Only **one JSON-compatible YAML document** is accepted: mapping keys must be strings, numbers finite, and custom tags, aliases, and complex keys are rejected. Anchors without aliases carry no output metadata. Empty YAML finalizes as null. Duplicate keys are rejected; provisional snapshots retain the first occurrence rather than overwriting an already-complete value.

YAML prefix reparsing adds work proportional to accumulated input per update, in addition to snapshot cloning. Throttle/chunk updates for large documents; this adapter is not a constant-memory incremental YAML parser.

### JSON Lines / NDJSON

Use `format: 'ndjson'` or `format: 'jsonl'`. Data is an array of records. The open record is visible immediately, including its growing strings. `/0/name` tracks the first record's name. Record roots complete syntactically just as in JSON; line endings validate each record. The synthetic array remains partial until `end()`.

LF, CRLF, and lone CR separate records; blank/whitespace-only lines are ignored. Each nonempty line must contain one JSON value. A final record need not end with a newline. Primitive records are accepted; malformed/truncated records throw while previously available records remain visible. `maxDepth` applies within each JSON record, excluding the synthetic result array.

### CSV / TSV

Use `format: 'csv'` (comma) or `format: 'tsv'` (tab). Data is an array of **string rows**, including the first row: headers and type conversion are application decisions. `/1/2` tracks row 2, column 3. Fields grow immediately, finish at a delimiter/row boundary/EOF, and rows finish at a row boundary/EOF. Quoted cells may contain separators, newlines, and doubled quotes split across chunks. A possible closing quote stays provisional until a boundary or EOF rules out another escaped quote.

LF, CRLF, and lone CR end rows; line endings inside quoted cells are preserved. Empty cells and rows are retained, a trailing record separator creates no phantom row, an empty document is `[]`, and an initial BOM is ignored. Widths may vary. Quotes inside unquoted cells, non-delimiter text after closing quotes, and unterminated quoted cells are rejected. Spaces after closing quotes are not silently trimmed. `maxLength` applies; `maxDepth` is not relevant to these flat input grammars.

### CSS

Use `format: 'css'` with `CssDocument` to parse an ordered stylesheet tree:

```ts
import { StreamNormalizer, select, type CssDocument } from 'tetra-stream';

const css = new StreamNormalizer<CssDocument>({ format: 'css' });
const growing = css.write('.ai-card { color: re');
// data.nodes[0]: { kind: 'rule', selector: '.ai-card', nodes: [
//   { kind: 'declaration', property: 'color', value: 're', important: false }
// ] }
const waiting = select(growing, '/nodes/0/nodes/0/value', { require: 'complete' });
// waiting.status === 'pending'
const ready = css.write('d; padding: 32px; }');
const color = select(ready, '/nodes/0/nodes/0/value', { require: 'complete' });
// color: { status: 'complete', state: 'streaming', value: 'red' }
css.end();
```

`CssDocument` has `{ kind: 'stylesheet', nodes: CssNode[] }`. Nodes are `CssRule` (`kind: 'rule'`, `selector`, `nodes`), `CssDeclaration` (`kind: 'declaration'`, `property`, `value`, `important`), `CssAtRule` (`kind: 'at-rule'`, `name`, `params`, optional `nodes`), or `CssComment` (`kind: 'comment'`, `text`). Comments, duplicate declarations, nested rules and at-rules retain their order. Values remain CSS strings, including quotes and function notation; `!important` is represented separately. Prototype-like names remain strings in a declaration's `property` field.

A declaration and its value complete at a real semicolon or its containing block's real closing brace. Selectors settle when their block opens; an open stylesheet remains partial until `end()`. Quotes, comments, URLs and function arguments keep internal semicolons/braces inside their tokens. Unfinished lexical tokens and blocks may be balanced internally for provisional parsing, but balancing characters are removed from exposed values and never establish completion. A synthetic repaired block cannot make a rule complete. Malformed prefixes remain provisional; `end()` parses the **original input** with PostCSS and rejects structural syntax errors, unclosed blocks, comments, strings and brackets.

The adapter first parses the original prefix with PostCSS, then tries EOF-only balancing, and uses fault-tolerant recovery when neither strict parse succeeds. Completed recovered declarations must match their original strict-parsed fragments. The adapter uses [PostCSS](https://postcss.org/api/) and its [safe parser](https://github.com/postcss/postcss-safe-parser). It supports the syntax those parsers preserve, including unknown at-rules and modern nesting; it does not validate selector/property/value support in a browser or whether an at-rule's prelude satisfies its specific specification. This is a stylesheet tree, not a CSS sanitizer or stylesheet injector. Applications decide how to use it; the playground's separate styling example applies completed, allowed, `CSS.supports`-valid declarations only to one fixed card.

CSS reparses the accumulated prefix, like YAML, and additionally validates completed fragments. Full snapshots additionally clone it; patches avoid snapshot cloning but still require reparsing and tree comparison. Chunk/throttle large inputs. `maxLength` covers the source; `maxDepth` bounds nested rule/at-rule/custom-property token blocks and nested parenthesis/bracket groups, excluding the synthetic stylesheet root.

### XML and HTML

Markup retains elements, attributes, and ordered mixed content:

```ts
import { StreamNormalizer, type MarkupDocument } from 'tetra-stream';

const parser = new StreamNormalizer<MarkupDocument>({ format: 'xml' });
parser.write('<user><name>Ali');
// data:
// { kind: 'document', children: [
//   { kind: 'element', name: 'user', attributes: {}, children: [
//     { kind: 'element', name: 'name', attributes: {}, children: [
//       { kind: 'text', value: 'Ali' }
//     ] }
//   ] }
// ] }
// status['/children/0/children/0'] === 'partial'
```

Text grows as chunks arrive, including XML CDATA. Incomplete entities wait until they can be decoded. Attributes appear once their opening tag is complete; partial attribute values are not exposed yet. Comments and processing instructions are omitted. CDATA is represented as text. Qualified XML names and namespace declarations remain in names and attributes.

XML uses `saxes` with namespace checks for structure, validation, and attribute normalization, plus a lexical observer for progressive text and CDATA. Literal line endings follow XML normalization; character references retain their actual XML code points. A complete, well-formed XML document is required; DTD declarations are unsupported.

HTML uses `htmlparser2`'s forgiving fragment semantics, including void elements, implied closes, and EOF closing. This is not the full browser HTML tree-construction algorithm; some malformed markup and table layouts can produce a different tree. Early EOF may be accepted in HTML even when it would fail for XML. Parsing markup as data is not sanitization: do not execute untrusted generated HTML.

## Options

```ts
new StreamNormalizer({
  format: 'json', // See supported formats below; explicit, not detected
  maxLength: 1_000_000, // incoming UTF-16 code units
  maxDepth: 128, // nested containers/elements
});
```

## Supported format names

`json`, `yaml`, `yml`, `xml`, `html`, `ndjson`, `jsonl`, `csv`, `tsv`, `css`. Aliases retain the selected name in `snapshot.format`; `yaml`/`yml` and `ndjson`/`jsonl` have identical parsing semantics.

## Scope and performance

This is a prototype with a consistent consumption model across formats. It does not handle Markdown fences, mixed prose, transport reconnection, model retractions, or finalizing repaired syntax. Schema validation is opt-in and runs on completed documents.

Parser state persists across chunks. Full snapshots still clone accumulated data and metadata, so total snapshot work can be quadratic for long streams. Opt-in patches avoid these accumulated copies and emit string suffixes, but the parser and accumulator still retain the document. YAML prefix reparsing remains proportional to accumulated input per update. CSS also validates completed fragments, so its work depends on stylesheet size and update frequency. Patches do not make either parser a constant-memory incremental parser.

The workspace benchmark is `npm run benchmark`, backed by `libs/tetra-stream/bench/stream.mts`. It compares equivalent JSON/CSV workloads and bounded YAML workloads, verifies matching final results, and records median times plus serialized output size. Timing includes output serialization and, for patches, consumer replay. UI rendering and network latency are excluded. Local results are in `artifacts/stream-benchmark.json`; performance depends on document shape, chunk size, runtime, and hardware. No advantage over other parser libraries is claimed.

Source, tests, demo, and release commands are organized in the enclosing Nx workspace. Development requires Node.js 24+ to execute TypeScript tests and scripts directly; strict typechecking covers tests, benchmarks, and release tools. Build with `nx build tetra-stream`, test with `nx test tetra-stream`, and create an installable artifact with `nx run tetra-stream:pack`.

MIT licensed. Runtime dependencies: `htmlparser2`, `postcss`, `postcss-safe-parser`, `saxes`, and `yaml`.

## Custom language strategies

Built-in languages are exposed as the runtime `Format` enum: `Format.JSON`, `Format.XML`, `Format.HTML`, `Format.YAML`, `Format.YML`, `Format.NDJSON`, `Format.JSONL`, `Format.CSV`, `Format.TSV`, and `Format.CSS`. Existing string spellings remain supported; `FormatName` is their string union.

Pass an instance implementing `LanguageStrategy<T>` as `format` to add a language without global registration. The model is inferred, and each stream gets its own parser:

```typescript
import { Format, StreamNormalizer, streamStructured } from 'tetra-stream';
import type { LanguageStrategy, LanguageParser, LanguageUpdate } from 'tetra-stream';

// Built-in formats have runtime enum values. String spellings still work.
const json = new StreamNormalizer({ format: Format.JSON });
json.write('{"name":"Al');

interface Message {
  text: string;
}
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
      write(chunk) {
        text += chunk;
        return result(false);
      },
      end() {
        return result(true);
      },
    };
  }
}

// The output model is inferred from the strategy.
for await (const snapshot of streamStructured(['Hello, ', 'world!'], {
  format: new PlainTextStrategy(),
})) {
  const text: string | undefined = snapshot.data?.text;
  console.log(text, snapshot.status['/text'], snapshot.state);
}
```

`create(options)` receives readonly `maxLength` and `maxDepth`. Return a fresh synchronous `LanguageParser<T>` with `write(chunk)` and `end()`. Both return `LanguageUpdate<T>` containing `DeepPartial<T> | undefined` data and a completion map keyed by RFC 6901 JSON Pointer. `end()` must validate the original document and mark finished values complete; throw on invalid syntax. Input length is enforced by the normalizer. Your strategy must enforce nesting depth and its own grammar.

Return JSON-compatible plain data: strings, finite numbers, booleans, null, dense arrays, and objects with enumerable data properties. Omit unavailable fields rather than assigning `undefined`; only the entire `data` result may be `undefined`. Cycles, shared object references, sparse arrays, getters, symbols, and class objects are rejected before commit. Output tree depth is also checked against `maxDepth`. Results are copied before ownership transfers, so parsers may reuse their mutable working trees. Snapshots, selection, schema validation, and patch replay work with custom formats. Patch mode diffs the returned tree; it does not provide the built-ins' direct mutation-journal performance. Use the strategy or its `format` string with `createPatchState({ format: strategy })`.
