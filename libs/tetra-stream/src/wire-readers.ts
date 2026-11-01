import { parsePatchBatch, wireLimits, assertWireFormat } from './wire-validation.js';
import { WireProtocolError, type WireBatch, type WireReadOptions } from './wire-types.js';

function readOptions(options: WireReadOptions) {
  const limits = wireLimits(options);
  const after = options.afterSequence ?? 0;
  if (!Number.isSafeInteger(after) || after < 0)
    throw new RangeError('afterSequence must be a non-negative safe integer');
  if (options.format !== undefined) assertWireFormat(options.format);
  let sequence = after;
  let format = options.format;
  return {
    limits,
    parse(source: string): WireBatch {
      let value: unknown;
      try {
        value = JSON.parse(source);
      } catch (cause) {
        throw new WireProtocolError('invalid-frame', 'Invalid frame JSON', { cause });
      }
      const frame = parsePatchBatch(value, limits);
      if (frame.sequence !== sequence + 1)
        throw new WireProtocolError(
          'sequence',
          `Expected sequence ${sequence + 1}, received ${frame.sequence}`,
        );
      if (format !== undefined && frame.format !== format)
        throw new WireProtocolError('invalid-frame', 'Stream format changed');
      sequence = frame.sequence;
      format = frame.format;
      return frame;
    },
  };
}
async function body(response: Response, media: string[]): Promise<ReadableStream<Uint8Array>> {
  const mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (response.ok && response.body && mime && media.includes(mime)) return response.body;
  try {
    void response.body?.cancel().catch(() => {});
  } catch {
    /* Preserve the response error. */
  }
  throw new WireProtocolError(
    'transport',
    !response.ok
      ? `HTTP ${response.status}`
      : !response.body
        ? 'Response has no streaming body'
        : `Expected ${media.join(' or ')}`,
  );
}

/** Decode once across byte boundaries. CR, LF and CRLF are accepted; one leading BOM is stripped. */
async function* lines(
  source: ReadableStream<Uint8Array>,
  limit: number,
  flushLast: boolean,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  signal?.throwIfAborted();
  const reader = source.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let line = '';
  let skipLF = false;
  const abort = () => {
    void reader.cancel(signal?.reason).catch(() => {});
  };
  signal?.addEventListener('abort', abort, { once: true });
  function* split(text: string) {
    for (const char of text) {
      if (skipLF) {
        skipLF = false;
        if (char === '\n') continue;
      }
      if (char === '\r' || char === '\n') {
        skipLF = char === '\r';
        const complete = line;
        line = '';
        signal?.throwIfAborted();
        yield complete;
      } else {
        line += char;
        if (line.length > limit)
          throw new WireProtocolError('limit', 'Line exceeds maxFrameLength');
      }
    }
  }
  try {
    while (true) {
      signal?.throwIfAborted();
      const next = await reader.read();
      signal?.throwIfAborted();
      if (next.done) break;
      if (!(next.value instanceof Uint8Array))
        throw new WireProtocolError('transport', 'Expected UTF-8 byte chunks');
      // Decode through delimiters before examining later bytes. A bad suffix must
      // not invalidate an earlier frame just because both arrived in one chunk.
      const decode = (bytes: Uint8Array): string => {
        try {
          return decoder.decode(bytes, { stream: true });
        } catch (cause) {
          throw new WireProtocolError('invalid-frame', 'Invalid UTF-8', { cause });
        }
      };
      let start = 0;
      for (let index = 0; index < next.value.length; index++) {
        const byte = next.value[index];
        if (byte === 10 || byte === 13 || index - start >= 16_383) {
          yield* split(decode(next.value.subarray(start, index + 1)));
          start = index + 1;
        }
      }
      if (start < next.value.length) yield* split(decode(next.value.subarray(start)));
    }
    let tail: string;
    try {
      tail = decoder.decode();
    } catch (cause) {
      throw new WireProtocolError('invalid-frame', 'Truncated UTF-8', { cause });
    }
    yield* split(tail);
    if (flushLast && line) yield line;
  } finally {
    signal?.removeEventListener('abort', abort);
    try {
      void reader.cancel().catch(() => {});
    } catch {
      /* Cleanup must not replace a parse/transport error. */
    } finally {
      reader.releaseLock();
    }
  }
}

/** Consume framed JSON, not raw model text. EOF without a terminal frame is an error. */
export async function* fromNDJSON(
  source: Response | ReadableStream<Uint8Array>,
  options: WireReadOptions = {},
): AsyncGenerator<WireBatch> {
  const reader = readOptions(options);
  options.signal?.throwIfAborted();
  const stream =
    source instanceof Response
      ? await body(source, ['application/x-ndjson', 'application/ndjson', 'application/jsonl'])
      : source;
  for await (const line of lines(stream, reader.limits.maxFrameLength, true, options.signal)) {
    options.signal?.throwIfAborted();
    if (!line.trim()) continue;
    const frame = reader.parse(line);
    yield frame;
    if (frame.state !== 'streaming') return;
  }
  throw new WireProtocolError('truncated', 'NDJSON ended before a terminal frame');
}

/** A fetch SSE reader with explicit resume cursor, bounded buffers and no automatic reconnection. */
export async function* fromSSE(
  response: Response,
  options: WireReadOptions = {},
): AsyncGenerator<WireBatch> {
  const reader = readOptions(options);
  options.signal?.throwIfAborted();
  const stream = await body(response, ['text/event-stream']);
  let data: string[] = [];
  let length = 0;
  let type = '';
  let id: string | undefined;
  for await (const line of lines(
    stream,
    reader.limits.maxFrameLength + 64,
    false,
    options.signal,
  )) {
    options.signal?.throwIfAborted();
    if (line === '') {
      const payload = data.join('\n');
      const hasData = data.length > 0;
      const event = type || 'message';
      const eventId = id;
      data = [];
      length = 0;
      type = '';
      id = undefined;
      if (!hasData) continue;
      if (event === 'error')
        throw new WireProtocolError('transport', 'Remote SSE error: ' + payload);
      if (event !== 'message' && event !== 'patch') continue;
      const frame = reader.parse(payload);
      if (
        eventId !== undefined &&
        eventId !== '' &&
        (!/^[1-9][0-9]*$/.test(eventId) || Number(eventId) !== frame.sequence)
      )
        throw new WireProtocolError('sequence', 'SSE id does not match frame sequence');
      yield frame;
      if (frame.state !== 'streaming') return;
      continue;
    }
    if (line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') {
      length += value.length + (data.length ? 1 : 0);
      if (length > reader.limits.maxFrameLength)
        throw new WireProtocolError('limit', 'SSE frame exceeds maxFrameLength');
      data.push(value);
    } else if (field === 'event') type = value;
    else if (field === 'id' && !value.includes('\0')) id = value;
  }
  throw new WireProtocolError('truncated', 'SSE ended before a terminal frame');
}
