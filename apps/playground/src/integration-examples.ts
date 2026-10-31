export const integrationExamples = {
  stream: `import { streamStructured } from 'tetra-stream';

// HTML: <h2 id="user-name">Waiting…</h2>
const name = document.getElementById('user-name');
if (!name) throw new Error('Missing #user-name');

async function* textChunks() {
  yield '{"name":"Alex';
  await new Promise(resolve => setTimeout(resolve, 400));
  yield ' Morgan"}';
}

try {
  for await (const snapshot of streamStructured<{ name: string }>(textChunks())) {
    name.textContent = snapshot.data?.name ?? 'Waiting…';
  }
} catch (error) {
  console.error('Stream interrupted:', error);
}`,
};
