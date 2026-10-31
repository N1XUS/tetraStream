/** Copyable application adapter, deliberately separate from the parser library. */
export const sseAdapterCode = String.raw`// Generic backend contract for THIS example:
// data: {"text":"a piece of the generated document"}
// data: [DONE] after the final piece, each followed by a blank line.
// Optional event types: message or delta. event: error reports a failure.
// Map your provider's own envelope to this contract on your backend.
export async function* sseTextChunks(response: Response): AsyncGenerator<string> {
  if (!response.ok) throw new Error('HTTP ' + response.status);
  if (!response.body) throw new Error('Response has no streaming body');
  const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (mime !== 'text/event-stream') throw new Error('Expected text/event-stream');

  // Decodes UTF-8 across byte boundaries and strips one initial BOM.
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  const limit = 64_000; // Maximum line/event characters; adapt to your backend.
  let line = '';
  let skipLF = false;
  let data: string[] = [];
  let dataLength = 0;
  let eventType = '';

  function acceptLine(value: string): { text: string } | 'done' | undefined {
    if (value === '') {
      const payload = data.join('\n');
      const type = eventType || 'message';
      const hasData = data.length > 0;
      data = []; dataLength = 0; eventType = '';
      if (!hasData) return;
      if (type === 'error') throw new Error('SSE error: ' + payload);
      if (type !== 'message' && type !== 'delta') return;
      if (payload === '[DONE]') return 'done';
      let envelope: unknown;
      try { envelope = JSON.parse(payload); }
      catch (cause) { throw new Error('Invalid SSE JSON envelope', { cause }); }
      if (!envelope || typeof envelope !== 'object' || !('text' in envelope)
          || typeof envelope.text !== 'string') {
        throw new Error('SSE envelope must contain a string text field');
      }
      return { text: envelope.text };
    }
    if (value.startsWith(':')) return; // Heartbeat/comment.
    const colon = value.indexOf(':');
    const field = colon < 0 ? value : value.slice(0, colon);
    let content = colon < 0 ? '' : value.slice(colon + 1);
    if (content.startsWith(' ')) content = content.slice(1);
    if (field === 'event') eventType = content;
    if (field === 'data') {
      dataLength += content.length + 1;
      if (dataLength > limit) throw new Error('SSE event exceeds buffer limit');
      data.push(content);
    }
    // id/retry/unknown fields are irrelevant: this adapter does not reconnect.
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        // SSE discards a frame without its final blank line. Even if the
        // document looks complete, EOF without [DONE] is a transport failure.
        throw new Error('SSE connection ended before [DONE]');
      }
      for (const character of value) {
        if (skipLF) {
          skipLF = false;
          if (character === '\n') continue;
        }
        if (character === '\r' || character === '\n') {
          skipLF = character === '\r';
          const event = acceptLine(line);
          line = '';
          if (event === 'done') return;
          if (event) yield event.text; // May be INCOMPLETE document JSON.
        } else {
          line += character;
          if (line.length > limit) throw new Error('SSE line exceeds buffer limit');
        }
      }
    }
  } finally {
    // Also runs when a downstream parser fails or the consumer stops early.
    try { await reader.cancel(); }
    catch { /* Cleanup must not replace the parsing/transport error. */ }
    finally { reader.releaseLock(); }
  }
}`;

/** Paste after the adapter above in your browser application's main.ts. */
export const sseUsageCode = String.raw`import { streamStructured } from 'tetra-stream';

type Profile = { name: string; bio: string };
const output = document.getElementById('user-name');
if (!output) throw new Error('Add <h1 id="user-name"> to your page');
try {
  // This endpoint belongs to YOUR application. It maps your provider's events
  // to the text/[DONE] contract above; it is not supplied by TetraStream.
  const response = await fetch('/api/profile/events', {
    headers: { Accept: 'text/event-stream' },
  });
  for await (const snapshot of streamStructured<Profile>(sseTextChunks(response))) {
    output.textContent = snapshot.data?.name ?? 'Waiting…';
    // A partial name appears after the FIRST text event, before [DONE].
  }
} catch (error) {
  console.error('Keep the last displayed value:', error);
}`;

/** Each envelope is valid JSON; its text value is a piece of one document. */
export const sseWireExample = [
  'data: ' + JSON.stringify({ text: '{"name":"Al' }),
  '',
  'data: ' + JSON.stringify({ text: 'ice"}' }),
  '',
  'data: [DONE]',
  '',
  '',
].join('\n');
