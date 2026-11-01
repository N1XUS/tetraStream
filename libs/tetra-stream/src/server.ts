import { stringifyWire } from './wire-json.js';
import { StreamNormalizer } from './normalizer.js';
import type { PathIssue, PatchBatch } from './patches.js';
import type { NormalizerOptions } from './types.js';
import type { StandardSchemaV1 } from './validation.js';
import { assertWireFormat, parsePatchBatch, wireLimits } from './wire-validation.js';
import { WireProtocolError } from './wire-types.js';
import type {
  SchemaDescriptor,
  WireBatch,
  WireFormat,
  WireLimits,
  WireJSONValue,
} from './wire-types.js';

export type { WireBatch, WireFormat, WireLimits, SchemaDescriptor } from './wire-types.js';
export { WireProtocolError } from './wire-types.js';

export type EventStreamOptions = Omit<NormalizerOptions, 'format'> & {
  readonly format?: WireFormat;
  readonly schema?: SchemaDescriptor;
  readonly validator?: StandardSchemaV1;
  readonly metadata?: Readonly<Record<string, WireJSONValue>>;
  readonly signal?: AbortSignal;
};
export interface EncoderOptions extends WireLimits {
  readonly signal?: AbortSignal;
}

type Source<T> = AsyncIterable<T> | Iterable<T>;
function iteratorOf<T>(source: Source<T>): AsyncIterator<T> | Iterator<T> {
  if (source == null) throw new TypeError('A stream source must be iterable');
  const asyncIterator = (source as AsyncIterable<T>)[Symbol.asyncIterator];
  if (typeof asyncIterator === 'function') return asyncIterator.call(source);
  const iterator = (source as Iterable<T>)[Symbol.iterator];
  if (typeof iterator === 'function') return iterator.call(source);
  throw new TypeError('A stream source must be iterable');
}
function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
}
function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
}
async function abortable<T>(work: () => T | PromiseLike<T>, signal?: AbortSignal): Promise<T> {
  checkAbort(signal);
  if (!signal) return await work();
  let listener: (() => void) | undefined;
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        listener = () => reject(abortReason(signal));
        signal.addEventListener('abort', listener, { once: true });
      }),
      Promise.resolve().then(work),
    ]);
  } finally {
    if (listener) signal.removeEventListener('abort', listener);
  }
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function issuePath(path: StandardSchemaV1.Issue['path']): string {
  return (path ?? [])
    .map((segment) => {
      const key = typeof segment === 'object' && segment !== null ? segment.key : segment;
      return `/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`;
    })
    .join('');
}

/** Normalize decoded model text into protocol v1 frames; validation never transforms raw data. */
export async function* toEventStream(
  source: Source<string>,
  options: EventStreamOptions = {},
): AsyncGenerator<WireBatch> {
  const { format = 'json', schema, metadata, validator, signal, ...normalizerOptions } = options;
  assertWireFormat(format);
  // Validate serializable descriptors before touching the text source. Never serialize validator.
  parsePatchBatch({
    format,
    sequence: 1,
    patches: [],
    state: 'complete',
    protocol: 1,
    ...(schema !== undefined ? { schema } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  });
  if (
    validator !== undefined &&
    (!validator ||
      validator['~standard']?.version !== 1 ||
      typeof validator['~standard'].vendor !== 'string' ||
      typeof validator['~standard'].validate !== 'function')
  )
    throw new TypeError('validator must implement Standard Schema V1');
  const normalizer = new StreamNormalizer({ ...normalizerOptions, format });
  checkAbort(signal);
  const iterator = iteratorOf(source);
  let first = true;
  let sourceDone = false;
  let pending: PatchBatch | undefined;
  const envelope = (batch: PatchBatch, terminal = false): WireBatch => {
    const result: WireBatch = {
      ...batch,
      format,
      ...(first ? { protocol: 1 as const, ...(schema !== undefined ? { schema } : {}) } : {}),
      ...(terminal && metadata !== undefined ? { metadata } : {}),
    };
    first = false;
    return result;
  };
  try {
    while (true) {
      const next = await abortable(() => iterator.next(), signal);
      checkAbort(signal);
      if (next.done) {
        sourceDone = true;
        break;
      }
      yield envelope(normalizer.writePatch(next.value));
    }
    checkAbort(signal);
    pending = normalizer.endPatch();
    let issues: PathIssue[] | undefined;
    if (validator) {
      const result = await abortable(
        () => validator['~standard'].validate(normalizer.snapshot().data),
        signal,
      );
      if (result.issues)
        issues = result.issues.map((issue) => ({
          path: issuePath(issue.path),
          code: 'schema',
          message: issue.message,
        }));
    }
    checkAbort(signal);
    yield envelope({ ...pending, ...(issues?.length ? { issues } : {}) }, true);
  } catch (error) {
    if (signal?.aborted) throw abortReason(signal);
    yield envelope(
      { ...(pending ?? normalizer.patch()), state: 'error', error: message(error) },
      true,
    );
  } finally {
    if (!sourceDone && iterator.return) {
      // Closing a blocked producer must not conceal an abort or the original parse/source failure.
      try {
        const returned = iterator.return();
        void Promise.resolve(returned).catch(() => {});
      } catch {
        /* Keep the original stream outcome. */
      }
    }
  }
}

function encode(
  batches: Source<WireBatch>,
  options: EncoderOptions,
  sse: boolean,
): ReadableStream<Uint8Array> {
  const { signal } = options;
  const limits = wireLimits(options);
  const iterator = iteratorOf(batches);
  const encoder = new TextEncoder();
  let sequence: number | undefined;
  let format: WireFormat | undefined;
  let terminal = false;
  let stopped = false;
  let returned = false;
  let abortListener: (() => void) | undefined;
  const cleanup = (): void => {
    if (signal && abortListener) signal.removeEventListener('abort', abortListener);
  };
  const closeIterator = async (): Promise<void> => {
    if (returned) return;
    returned = true;
    try {
      await iterator.return?.();
    } catch {
      /* Preserve the error or cancellation that closed us. */
    }
  };
  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        abortListener = () => {
          if (stopped) return;
          stopped = true;
          cleanup();
          controller.error(abortReason(signal!));
          void closeIterator();
        };
        if (signal?.aborted) abortListener();
        else signal?.addEventListener('abort', abortListener, { once: true });
      },
      async pull(controller) {
        if (stopped) return;
        try {
          const next = await abortable(() => iterator.next(), signal);
          if (stopped) return;
          if (next.done) {
            if (!terminal)
              throw new WireProtocolError('truncated', 'Stream ended without a terminal frame');
            stopped = true;
            cleanup();
            controller.close();
            return;
          }
          if (terminal)
            throw new WireProtocolError('invalid-frame', 'Frame follows a terminal frame');
          const batch = parsePatchBatch(next.value, limits);
          if (sequence !== undefined && batch.sequence !== sequence + 1)
            throw new WireProtocolError('sequence', 'Frame sequence must increase by one');
          if (format !== undefined && batch.format !== format)
            throw new WireProtocolError('invalid-frame', 'Frame format changed');
          sequence = batch.sequence;
          format = batch.format;
          terminal = batch.state !== 'streaming';
          const json = stringifyWire(batch);
          if (json.length > (limits.maxFrameLength ?? 1_048_576))
            throw new WireProtocolError('limit', 'Frame exceeds maxFrameLength');
          controller.enqueue(
            encoder.encode(sse ? `id: ${sequence}\nevent: patch\ndata: ${json}\n\n` : `${json}\n`),
          );
        } catch (error) {
          if (stopped) return;
          stopped = true;
          cleanup();
          controller.error(error);
          void closeIterator();
        }
      },
      cancel() {
        stopped = true;
        cleanup();
        // A producer may keep next() (and therefore return()) pending indefinitely.
        // Request cleanup without blocking the consumer's cancellation.
        void closeIterator();
      },
    },
    { highWaterMark: 0 },
  );
}

/** Encode a validated wire stream as UTF-8 Server-Sent Events, on demand. */
export function toSSE(
  batches: Source<WireBatch>,
  options: EncoderOptions = {},
): ReadableStream<Uint8Array> {
  return encode(batches, options, true);
}
/** Encode a validated wire stream as one JSON frame per UTF-8 line, on demand. */
export function toNDJSON(
  batches: Source<WireBatch>,
  options: EncoderOptions = {},
): ReadableStream<Uint8Array> {
  return encode(batches, options, false);
}
function response(
  batches: Source<WireBatch>,
  init: ResponseInit,
  options: EncoderOptions,
  sse: boolean,
): Response {
  const headers = new Headers(init.headers);
  headers.set(
    'Content-Type',
    sse ? 'text/event-stream; charset=utf-8' : 'application/x-ndjson; charset=utf-8',
  );
  headers.set('Cache-Control', 'no-cache');
  if (sse) headers.set('X-Accel-Buffering', 'no');
  headers.delete('Content-Length');
  return new Response(encode(batches, options, sse), { ...init, headers });
}
/** HTTP init and encoder limits are separate so headers cannot become protocol options. */
export function eventStreamResponse(
  batches: Source<WireBatch>,
  init: ResponseInit = {},
  options: EncoderOptions = {},
): Response {
  return response(batches, init, options, true);
}
export function ndjsonResponse(
  batches: Source<WireBatch>,
  init: ResponseInit = {},
  options: EncoderOptions = {},
): Response {
  return response(batches, init, options, false);
}
