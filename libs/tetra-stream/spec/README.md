# TetraStream wire protocol v1

**Resume is application-managed:** the reference helpers do not include frame storage, a replay endpoint or automatic reconnection. `afterSequence` validates the next expected sequence only.

Canonical v1 URLs: [specification](https://tetrastream.severyn.pro/protocol/v1/README.md) · [JSON Schema](https://tetrastream.severyn.pro/protocol/v1/patch-batch.schema.json) · [fixtures](https://tetrastream.severyn.pro/protocol/v1/fixtures/index.json). For a release-pinned source snapshot, use the [0.3.0 tag](https://github.com/N1XUS/tetraStream/tree/tetra-stream%400.3.0/libs/tetra-stream/spec). This document is the canonical contract; explanatory RFC drafts must use this batch vocabulary.

This document defines the public wire contract. **MUST**, **MUST NOT**, **SHOULD** and **MAY** express requirements. The existing in-process `PatchBatch` shape is also the wire frame; optional fields add protocol and application context. Wire v1 supports `json`, `jsonl` and `ndjson`. The core package continues to support its other in-process formats.

[patch-batch.schema.json](./patch-batch.schema.json) is the structural [JSON Schema 2020-12](https://json-schema.org/draft/2020-12/json-schema-core) for one frame. It rejects unknown envelope, operation and issue fields. Sequence order, format consistency, terminal transitions and patch targets require a stateful consumer; passing this schema alone does not establish a valid transcript.

## Frame

```json
{"format":"json","sequence":1,"patches":[{"op":"set","path":"","value":{"name":"Ad"}},{"op":"status","path":"","value":"partial"}],"state":"streaming","protocol":1,"schema":{"type":"object"},"metadata":{"requestId":"example"}}
{"format":"json","sequence":2,"patches":[{"op":"append","path":"/name","value":"a"},{"op":"status","path":"/name","value":"complete"},{"op":"status","path":"","value":"complete"}],"state":"complete"}
```

Each frame MUST be a JSON object containing:

| Field      | Requirement                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| `format`   | `json`, `jsonl` or `ndjson`; constant throughout the transcript.                                              |
| `sequence` | Positive safe integer; starts at 1 and increases by exactly 1 per frame, including empty and terminal frames. |
| `patches`  | An ordered array of operations, possibly empty.                                                               |
| `state`    | `streaming`, `complete` or `error`.                                                                           |
| `error`    | A string required exactly when `state` is `error`; forbidden otherwise.                                       |
| `protocol` | Optional literal `1`; omission accepts existing bare `PatchBatch` frames as v1.                               |
| `schema`   | Optional JSON Schema descriptor: URL string, schema object or boolean.                                        |
| `metadata` | Optional JSON object for application context.                                                                 |
| `issues`   | Optional array of `{ "path": string, "code": string, "message": string }`; `code` MUST be nonempty.           |

All nested values MUST be JSON values: null, boolean, finite number, string, array or object. JavaScript-only values, cycles and nonfinite numbers are invalid. Reference encoders preserve negative zero as the JSON number `-0`, instead of the `0` produced by ordinary `JSON.stringify`; producers requiring exact snapshot equivalence MUST preserve this distinction. Metadata and schema descriptors travel on the frame and do not become document data. Server helpers put protocol/schema context on the first frame and optional metadata on the terminal frame. Consumers MUST accept frames without these optional fields. A descriptor never authorizes fetching its URL and is never executed as a validator implicitly.

## Paths and operations

Paths use the string representation of [RFC 6901 JSON Pointer](https://www.rfc-editor.org/rfc/rfc6901). The empty string addresses the root; `/` addresses an empty object key. Decode `~1` as `/` and `~0` as `~`. Other tilde escapes and fragment/URI pointer syntax are invalid. Keys such as `__proto__`, `constructor` and `prototype` are ordinary own properties. Consumers MUST preserve them without modifying object prototypes.

| Operation | Shape and effect                                                                                                                                                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `set`     | `{ "op": "set", "path": "…", "value": <JSON value> }` replaces or creates the addressed value. A root set initializes or replaces the document. A set MAY carry a complete nested subtree, including unchanged descendants coalesced by a producer. |
| `append`  | `{ "op": "append", "path": "…", "value": "suffix" }` concatenates a decoded string suffix onto an existing string. It MUST NOT coerce numbers, booleans or missing values to strings.                                                               |
| `remove`  | `{ "op": "remove", "path": "…" }` removes the addressed own property; at the root it clears document data. Removal is explicitly non-monotonic.                                                                                                     |
| `status`  | `{ "op": "status", "path": "…", "value": "partial" \| "complete" \| null }` records syntactic completion for that path, or removes its status entry when null. It does not change data.                                                             |

Operations MUST apply in array order. Except for root operations, data operations require an existing object or array parent; they do not create missing ancestors. Array segments MUST be canonical nonnegative decimal indices below 2³²−1; `-` and leading zeroes are invalid array indices. Set replaces an index rather than inserting or shifting elements; a new array index MUST equal its current length and MUST NOT skip indices. Remove deletes a property rather than splicing an array. Status entries are independent: removing data does not implicitly clear statuses, so producers SHOULD emit explicit null statuses when needed. Append requires an existing string target. A successful terminal frame MUST leave document data available; an error frame MAY arrive before any data. Consumers MUST reject invalid targets atomically for the whole batch.

Consumers MAY opt into an append-only policy that rejects `remove`. Such a policy does not redefine the wire operations: `set` remains a replacement operation. Callers that need richer monotonicity constraints must enforce them separately.

There is no numeric coercion: a producer receiving `"42"` MUST retain a string unless it explicitly emits a numeric replacement. String suffixes contain decoded content, including Unicode and escaped newlines; they are not slices of JSON source text.

## Completion and issues

A new accumulator starts at sequence 0 with undefined data, empty statuses and `state: "streaming"`. The transcript MUST end with exactly one terminal `complete` or `error` frame. No frame is valid after a terminal frame. Transport EOF before a terminal frame is truncation, even if the current data looks complete. A terminal error frame is delivered and applied, preserving all available partial data and statuses; it is distinct from malformed transport or invalid protocol errors.

`complete` describes successful syntactic completion of the source. A path marked `complete` is not a claim that its value passes a schema. An `error` frame describes a source or production failure and MUST contain an error string.

Issues accumulate separately from data and statuses, in arrival order, including issues carried on empty or terminal batches. They do not change syntactic completion. A manual producer MAY report a path issue while siblings continue streaming. A server's explicit Standard Schema validator MAY add issues after parsing finishes. It MUST NOT silently coerce data or infer a validator from the `schema` descriptor. A syntactically complete document MAY have issues and still finish with `state: "complete"`.

## Transports and resume

NDJSON transport uses UTF-8, with one complete serialized frame per line and media type `application/x-ndjson`. LF and CRLF line separators are supported. Empty lines are ignored. The final frame MAY omit the trailing newline if its JSON is complete. This transport encoding is independent of the document's `format`: for example, `format: "json"` frames can travel over NDJSON.

SSE transport follows [WHATWG server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html): UTF-8, media type `text/event-stream`, `data:` containing the serialized frame, and a blank line dispatching each event. Standard `id:` values emitted by server helpers are the decimal frame sequence. Comments and events without data do not contain frames. Multiple `data:` lines join with newline before JSON decoding. A final SSE event requires its blank-line terminator. Unknown SSE fields do not extend the frame's JSON envelope.

A consumer MUST preserve split UTF-8 code points, JSON escapes, lines and SSE fields across arbitrary transport byte chunks. Chunk boundaries do not define frames. Client readers return and cancel their input after a terminal frame; a transcript validator that consumes an archived transcript MUST independently reject extra frames after that terminal.

`fromNDJSON` accepts a `Response` or `ReadableStream<Uint8Array>`; `fromSSE` accepts a `Response`. Their `afterSequence` option explicitly supplies the last applied cursor; the next frame MUST have sequence `afterSequence + 1`. The caller must retain matching document state and arrange the resumed request. For an EventSource-style reconnect, the standard request header is `Last-Event-ID`. Applications must define replay storage and availability themselves. These APIs do not reconnect automatically or provide replay storage.

## Limits

Default reader and encoder policy limits are 1,048,576 UTF-16 code units per frame (`maxFrameLength`), nesting depth 128 (`maxDepth`), 100,000 operations or issues per frame (`maxPatches`), and 4,096 UTF-16 code units per pointer (`maxPathLength`). Depth checks include a data pointer plus its new subtree, so incremental frames cannot bypass the depth cap. These are resource limits rather than JSON Schema instance constraints; APIs accepting `WireLimits` may configure them. Limit breaches are protocol failures. Frame lengths count decoded UTF-16 code units, not UTF-8 bytes. Raw line/event buffering is bounded as well as decoded batch validation.

## Conformance assets

[fixtures/index.json](./fixtures/index.json) lists stored valid and invalid NDJSON transcripts. Generated valid transcripts record their source, format, terminal state and producer; manual fixtures record the expected snapshot. They cover nested/coalesced values, escaped and prototype-like keys, Unicode, scalar roots, JSON Lines, terminal syntax errors, explicit removals and independently accumulated path issues. Invalid entries state the rejection reason and the phase requiring rejection: frame shape, transcript order/completion, stateful application or JSON decoding.

The conformance suite replays every valid frame, including terminal errors, and compares reconstructed snapshots against the reference parser (or the manual expected snapshot), excluding accumulator sequence and optional wire context. It tests every two-chunk split at every UTF-8 byte offset for NDJSON and SSE. Producers and source chunkings may legally emit different frames; conformance requires legal operations with the same final data, status and terminal state, not byte-identical transcripts. The closed frame schema is checked separately against all structurally valid fixtures and shape-invalid examples.
