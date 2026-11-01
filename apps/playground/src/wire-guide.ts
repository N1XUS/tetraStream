/** Complete recipes for the published parser-free wire entry points. */
export const wireHtml = `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8"><title>Streaming wire profile</title></head>
  <body>
    <article aria-label="Streamed profile">
      <h2 id="wire-name">Waiting for a name…</h2>
      <p id="wire-bio">Waiting for a bio…</p>
      <ul id="wire-projects"></ul>
      <p id="wire-state" role="status">Ready</p>
      <button id="wire-stop" type="button">Stop</button>
    </article>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>`;

export const wireServerSSE = `import { toEventStream, eventStreamResponse } from 'tetra-stream/server';

// Replace these simulated deltas with the decoded text iterable from your AI SDK.
async function* generatedText(signal: AbortSignal) {
  const chunks = [
    '{"name":"Al',
    'ex Morgan","bio":"Building interfaces ',
    'as data arrives.","projects":[{"name":"Live pro',
    'file"}]}',
  ];
  for (const chunk of chunks) {
    signal.throwIfAborted();
    await new Promise(resolve => setTimeout(resolve, 120));
    yield chunk;
  }
}

// Expose this fetch-compatible handler as POST /api/profile/events in your app.
export function POST(request: Request): Response {
  const batches = toEventStream(generatedText(request.signal), {
    format: 'json',
    schema: { type: 'object', required: ['name', 'bio', 'projects'] },
    signal: request.signal,
  });
  return eventStreamResponse(batches, {}, { signal: request.signal });
}`;

export const wireClientSSE = `import { fromSSE, createPatchState, applyPatchBatch, select } from 'tetra-stream/client';

type Profile = { name: string; bio: string; projects: { name: string }[] };
function element(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error('Missing #' + id);
  return node;
}
const name = element('wire-name');
const bio = element('wire-bio');
const projects = element('wire-projects');
const status = element('wire-state');
const button = element('wire-stop');
const controller = new AbortController();
const stop = () => controller.abort();
button.addEventListener('click', stop);
const state = createPatchState<Profile>({ format: 'json' });

try {
  const response = await fetch('/api/profile/events', {
    method: 'POST',
    headers: { Accept: 'text/event-stream' },
    signal: controller.signal,
  });
  for await (const batch of fromSSE(response, { signal: controller.signal })) {
    applyPatchBatch(state, batch);
    const currentName = select(state, '/name');
    if ('value' in currentName) name.textContent = currentName.value;
    bio.textContent = state.data?.bio ?? 'Waiting for a bio…';
    const items = state.data?.projects?.map((project, index) => {
      const item = document.createElement('li');
      const completion = state.status['/projects/' + index + '/name'] ?? 'pending';
      item.textContent = (project.name ?? 'Waiting…') + ' · ' + completion;
      return item;
    }) ?? [];
    projects.replaceChildren(...items);
    status.textContent = state.state + ' · Name: ' + currentName.status;
    if (state.issues?.length) status.textContent += ' · Validation issues: ' + state.issues.length;
    if (state.error) status.textContent += ' · ' + state.error;
  }
} catch (error) {
  status.textContent = controller.signal.aborted
    ? 'Stopped. Received values remain visible.'
    : 'Stream interrupted. Received values remain visible.';
  console.error(error);
} finally {
  button.removeEventListener('click', stop);
}`;

export const wireServerNDJSON = wireServerSSE
  .replaceAll('eventStreamResponse', 'ndjsonResponse')
  .replaceAll('/api/profile/events', '/api/profile/lines');
export const wireClientNDJSON = wireClientSSE
  .replaceAll('fromSSE', 'fromNDJSON')
  .replaceAll('/api/profile/events', '/api/profile/lines')
  .replaceAll('text/event-stream', 'application/x-ndjson');

export const wireFrameExample = `id: 1
event: patch
data: {"format":"json","sequence":1,"state":"streaming","protocol":1,"patches":[{"op":"set","path":"","value":{"name":"Al"}},{"op":"status","path":"/name","value":"partial"}]}

id: 2
event: patch
data: {"format":"json","sequence":2,"state":"streaming","patches":[{"op":"append","path":"/name","value":"ex Morgan"},{"op":"status","path":"/name","value":"complete"}]}

id: 3
event: patch
data: {"format":"json","sequence":3,"state":"complete","patches":[{"op":"status","path":"","value":"complete"}]}

`;
