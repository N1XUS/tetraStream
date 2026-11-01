import {
  createPatchState,
  applyPatchBatch,
  select,
  Format,
  fromNDJSON,
  type WireBatch,
} from '../dist/client.js';
import { toEventStream, toSSE, eventStreamResponse } from '../dist/server.js';

type Order = { customer: { name: string }; items: { price: number }[] };
const state = createPatchState<Order>({ format: Format.JSON });
const name = select(state, '/customer/name', { require: 'complete' });
if (name.status === 'complete') {
  const value: string = name.value;
  void value;
}
const frame: WireBatch = {
  format: 'json',
  sequence: 1,
  patches: [],
  state: 'streaming',
  protocol: 1,
};
applyPatchBatch(state, frame, { appendOnly: true, maxFrameLength: 2_000_000 });
const bytes: ReadableStream<Uint8Array> = toSSE(
  toEventStream(['{"ok":true}'], { format: Format.JSON }),
);
const response: Response = eventStreamResponse([frame]);
void fromNDJSON(bytes, { afterSequence: 3, format: Format.JSON });
void response;
// @ts-expect-error Wire v1 does not expose parser strategies or CSS documents.
createPatchState({ format: Format.CSS });
// @ts-expect-error Wire v1 requires JSON or JSON Lines.
toEventStream(['a: b'], { format: Format.YAML });
// @ts-expect-error Sequence is numeric.
const bad: WireBatch = { ...frame, sequence: '1' };
void bad;

// JSON Schema definitions and application metadata are commonly declared as const.
const descriptor = {
  type: 'object',
  required: ['name'],
  properties: { name: { type: 'string' } },
} as const;
toEventStream(['{}'], { schema: descriptor, metadata: { tags: ['reference', 'v1'] } as const });
