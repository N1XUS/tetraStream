import { profileHtml, profileCode } from './profile-guide.ts';
import { rxjsPipelineCode, rxjsBindingCode } from './rxjs-guide.ts';
import { strategyExample } from './strategy-guide.ts';
import { sseAdapterCode, sseUsageCode } from './sse-guide.ts';

export const profileChunks = [
  '{"name":"Alex',
  ' Morgan","bio":"Making complex ',
  'things feel simple.","avatar":"/avatars/alex-',
  'morgan.webp"}',
];

const profileSource = `async function* textChunks() {
  const chunks = ${JSON.stringify(profileChunks, null, 2)};
  for (const chunk of chunks) {
    await new Promise(resolve => setTimeout(resolve, 400));
    yield chunk;
  }
}`;

export const exampleHtml = profileHtml;

export const guideExamples = {
  rxjs: rxjsPipelineCode + '\n\n' + rxjsBindingCode,
  strategy: strategyExample,
  sse: sseAdapterCode + '\n\n' + sseUsageCode,
  profile: profileCode,
  fields: `import { StreamNormalizer, select } from 'tetra-stream';

type Profile = { name: string; avatar: string };
const parser = new StreamNormalizer<Profile>();
const snapshot = parser.write('{"name":"Alex","avatar":"/avatars/ale');

const name = select(snapshot, '/name');
if (name.status === 'partial' || name.status === 'complete') {
  console.log(name.value); // "Alex"; inferred string
}
const avatar = select(snapshot, '/avatar', { require: 'complete' });
console.log(avatar.status); // "pending": do not assign an image src yet

const next = parser.write('x-morgan.webp"}');
const ready = select(next, '/avatar', { require: 'complete' });
if (ready.status === 'complete') console.log(ready.value);
// "/avatars/alex-morgan.webp"; field complete, document still streaming
console.log(parser.end().state); // "complete" after successful EOF`,
  fetch: `import { streamStructured } from 'tetra-stream';

// For a response whose body is ONLY the model's generated text.
async function* decodedText(response: Response) {
  if (!response.ok) throw new Error('HTTP ' + response.status);
  if (!response.body) throw new Error('Response has no streaming body');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      yield value;
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

const output = document.getElementById('user-name');
if (!output) throw new Error('Add <h1 id="user-name"> to your page');
try {
  // Your application supplies this endpoint; TetraStream is not a server.
  const response = await fetch('/api/profile');
  for await (const snapshot of streamStructured<{ name: string }>(
    decodedText(response), { format: 'json' },
  )) {
    output.textContent = snapshot.data?.name ?? 'Waiting…';
  }
} catch (error) {
  console.error('Keep the last displayed value:', error);
}`,
  csv: `import { streamStructured } from 'tetra-stream';

const table = document.createElement('table');
table.setAttribute('aria-label', 'Streaming team data');
document.body.append(table);

async function* csvChunks() {
  for (const chunk of ['Name,Role\\nAlex,Des', 'igner\\nSam,Eng', 'ineer']) {
    await new Promise(resolve => setTimeout(resolve, 400));
    yield chunk;
  }
}

try {
  for await (const snapshot of streamStructured<string[][]>(csvChunks(), {
    format: 'csv',
  })) {
    const rows = (snapshot.data ?? []).map((values, rowIndex) => {
      const row = document.createElement('tr');
      values.forEach((value, columnIndex) => {
        // This application treats row zero as headers.
        const cell = document.createElement(rowIndex === 0 ? 'th' : 'td');
        const path = '/' + rowIndex + '/' + columnIndex;
        cell.textContent = value ?? '';
        cell.dataset.completion = snapshot.status[path] ?? 'partial';
        cell.title = cell.dataset.completion;
        row.append(cell);
      });
      return row;
    });
    table.replaceChildren(...rows);
  }
} catch (error) {
  console.error('Received table data remains visible:', error);
}`,
  patches: `import { streamPatches, createPatchState, applyPatchBatch } from 'tetra-stream';

type Profile = { name: string; bio: string };
const output = document.createElement('p');
document.body.append(output);
const state = createPatchState<Profile>({ format: 'json' });

async function* textChunks() {
  for (const chunk of ['{"bio":"Making com', 'plex things simple."}']) {
    await new Promise(resolve => setTimeout(resolve, 400));
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
}`,
  validation: `import { streamValidated, type StandardSchemaV1 } from 'tetra-stream';

type Profile = { name: string };
// A complete Standard Schema validator, with no extra dependency.
// A compatible schema from Zod 4, Valibot, etc. can replace this object.
const schema: StandardSchemaV1<Profile> = {
  '~standard': {
    version: 1,
    vendor: 'profile-example',
    validate(value: unknown) {
      if (!value || typeof value !== 'object' || !('name' in value)
          || typeof value.name !== 'string' || !value.name.trim()) {
        return { issues: [{ message: 'A non-empty name is required' }] };
      }
      return { value: { name: value.name } };
    },
  },
};
const output = document.createElement('p');
document.body.append(output);
const chunks = ['{"name":"Alex', ' Morgan"}'];

try {
  for await (const snapshot of streamValidated(chunks, { schema })) {
    output.textContent = snapshot.data?.name ?? 'Waiting…';
    if (snapshot.validation.status === 'valid') {
      // This is fully typed, validated output, separate from partial data.
      output.textContent = 'Validated: ' + snapshot.validation.value.name;
    } else if (snapshot.validation.status === 'invalid') {
      output.textContent = snapshot.validation.issues.map(i => i.message).join('; ');
    } else if (snapshot.validation.status === 'validator-error') {
      console.error(snapshot.validation.error);
    }
  }
} catch (error) {
  console.error('Source or parsing failed:', error);
}`,
  css: `import { streamStructured, type CssDocument } from 'tetra-stream';

const card = document.createElement('article');
card.className = 'ai-card';
card.textContent = 'Good ideas take shape.';
// Keep animation settings outside generated styles and respect reduced motion.
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  card.style.transition = 'color 480ms ease, background-color 480ms ease, '
    + 'padding 480ms ease, border-radius 480ms ease';
}
document.body.append(card);
const allowed = new Set(['color', 'background-color', 'padding', 'border-radius']);

async function* cssChunks() {
  for (const chunk of [
    '.ai-card { color: #382',
    'b59; padding: 32px; background-color: #eee',
    '5ff; border-radius: 24px; }',
  ]) {
    await new Promise(resolve => setTimeout(resolve, 400));
    yield chunk;
  }
}

try {
  for await (const snapshot of streamStructured<CssDocument>(cssChunks(), {
    format: 'css',
  })) {
    // Recompute owned properties, so this also works with rewound snapshots.
    for (const property of allowed) card.style.removeProperty(property);
    snapshot.data?.nodes?.forEach((rule, ruleIndex) => {
      if (rule.kind !== 'rule' || rule.selector !== '.ai-card') return;
      rule.nodes?.forEach((declaration, index) => {
        if (declaration.kind !== 'declaration') return;
        const { property, value } = declaration;
        const path = '/nodes/' + ruleIndex + '/nodes/' + index;
        if (property && typeof value === 'string' && allowed.has(property)
            && !declaration.important // This constrained preview excludes !important.
            && snapshot.status[path] === 'complete'
            && snapshot.status[path + '/value'] === 'complete'
            && CSS.supports(property, value)) {
          // One fixed element; generated selectors are never injected.
          card.style.setProperty(property, value);
        }
      });
    });
  }
} catch (error) {
  console.error('Keep the last complete styles:', error);
}`,
  rivet: `import { signal } from '@rivetjs/reactivity';
import { render } from '@rivetjs/runtime/dom';
import { Button } from '@rivetjs/ui/button';
import { Card } from '@rivetjs/ui/card';
import { Chip } from '@rivetjs/ui/chip';
import { streamStructured } from 'tetra-stream';

${profileSource}

function UserCard() {
  const name = signal('Waiting for a name…');
  const completion = signal('pending');
  const running = signal(false);
  async function play() {
    running.set(true);
    try {
      for await (const snapshot of streamStructured<{ name: string }>(textChunks())) {
        name.set(snapshot.data?.name ?? 'Waiting for a name…');
        completion.set(snapshot.status['/name'] ?? 'pending');
      }
    } catch {
      completion.set('interrupted');
    } finally {
      running.set(false);
    }
  }
  return <Card>
    <Card.Header><Card.Title>{name()}</Card.Title></Card.Header>
    <Card.Content><Chip variant="soft">{completion()}</Chip></Card.Content>
    <Card.Footer><Button isDisabled={running()} onPress={play}>Stream profile</Button></Card.Footer>
  </Card>;
}
const app = document.getElementById('app');
if (!app) throw new Error('Add <div id="app"> to your page');
render(() => <UserCard />, app);`,
} satisfies Record<string, string>;

export const installCommand = 'npm install tetra-stream';
