/** Shared by the guide and the Dev.to draft so their nested example stays consistent. */
export const nestedProfileChunks = [
  '{"name":"Alex',
  ' Morgan","avatar":"/avatars/alex-',
  'morgan.webp","bio":"Making complex things simple.","contact":{"email":"alex@',
  'example.com","socials":[{"network":"GitHub","handle":"@alex',
  'morgan"}]},"projects":[{"name":"Live data grid","details":{"summary":"Tables that ',
  'render one cell at a time.","stack":["Type',
  'Script","Rivet',
  'JS"]}},{"name":"Adaptive profile","details":{"summary":"A card that ',
  'keeps up with its stream.","stack":["CSS","Accessibility"]}}]}',
];

export const profileHtml = `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8"><title>Nested streaming profile</title></head>
  <body>
    <article aria-label="User profile">
      <span id="avatar-placeholder">Waiting for avatar…</span>
      <img id="avatar" alt="Profile portrait" width="48" height="48" hidden>
      <h1 id="user-name">Waiting for a name…</h1>
      <p id="user-bio">Waiting for a bio…</p>
      <h2>Contact</h2>
      <p id="user-email">Waiting for email…</p>
      <ul id="user-socials"></ul>
      <h2>Projects</h2>
      <div id="user-projects"></div>
      <p id="profile-state" role="status">Ready</p>
    </article>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>`;

export const profileCode = `import { streamStructured, select } from 'tetra-stream';

interface Profile {
  name: string;
  bio: string;
  avatar: string;
  contact: {
    email: string;
    socials: { network: string; handle: string }[];
  };
  projects: {
    name: string;
    details: { summary: string; stack: string[] };
  }[];
}

// Every element is provided by index.html above.
function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error('Missing element: ' + id);
  return node as T;
}
const name = element('user-name');
const bio = element('user-bio');
const email = element('user-email');
const socials = element('user-socials');
const projects = element('user-projects');
const status = element('profile-state');
const image = element<HTMLImageElement>('avatar');
const placeholder = element('avatar-placeholder');
image.onload = () => { image.hidden = false; placeholder.hidden = true; };
image.onerror = () => { image.hidden = true; placeholder.textContent = 'Image unavailable'; };

// Reuse a node for each array index as its partial value grows.
const socialRows = new Map<number, HTMLLIElement>();
const projectRows = new Map<number, {
  root: HTMLElement; title: HTMLElement; summary: HTMLElement;
  stack: HTMLUListElement; tags: Map<number, HTMLLIElement>; state: HTMLElement;
}>();
function projectRow(index: number) {
  const existing = projectRows.get(index);
  if (existing) return existing;
  const root = document.createElement('section');
  const title = document.createElement('h3');
  const summary = document.createElement('p');
  const stack = document.createElement('ul');
  const state = document.createElement('p');
  root.append(title, summary, stack, state);
  projects.append(root);
  const row = { root, title, summary, stack, state, tags: new Map<number, HTMLLIElement>() };
  projectRows.set(index, row);
  return row;
}

// Simulated provider deltas. Each chunk can stop inside a nested value.
async function* textChunks() {
  const chunks = ${JSON.stringify(nestedProfileChunks, null, 2)};
  for (const chunk of chunks) {
    await new Promise(resolve => setTimeout(resolve, 400));
    yield chunk;
  }
}

try {
  for await (const snapshot of streamStructured<Profile>(textChunks())) {
    name.textContent = snapshot.data?.name ?? 'Waiting for a name…';
    bio.textContent = snapshot.data?.bio ?? 'Waiting for a bio…';
    email.textContent = snapshot.data?.contact?.email ?? 'Waiting for email…';
    status.textContent = snapshot.state + ' · Contact: '
      + (snapshot.status['/contact'] ?? 'pending') + ' · Projects: '
      + (snapshot.status['/projects'] ?? 'pending');

    snapshot.data?.contact?.socials?.forEach((social, index) => {
      let row = socialRows.get(index);
      if (!row) { row = document.createElement('li'); socialRows.set(index, row); socials.append(row); }
      const path = '/contact/socials/' + index + '/handle';
      row.textContent = (social.network ?? 'Account') + ': ' + (social.handle ?? '')
        + ' · ' + (snapshot.status[path] ?? 'pending');
    });

    snapshot.data?.projects?.forEach((project, index) => {
      const row = projectRow(index);
      const path = '/projects/' + index;
      row.title.textContent = project.name ?? 'Waiting for project name…';
      row.summary.textContent = project.details?.summary ?? '';
      row.state.textContent = 'Object: ' + (snapshot.status[path] ?? 'pending')
        + ' · Stack array: ' + (snapshot.status[path + '/details/stack'] ?? 'pending');
      project.details?.stack?.forEach((tag, itemIndex) => {
        let item = row.tags.get(itemIndex);
        if (!item) { item = document.createElement('li'); row.tags.set(itemIndex, item); row.stack.append(item); }
        const pointer = path + '/details/stack/' + itemIndex;
        item.textContent = tag + ' · ' + (snapshot.status[pointer] ?? 'pending');
      });
    });

    // Synchronous filter: expose the URL only if it is complete in THIS snapshot.
    const avatar = select(snapshot, '/avatar', { require: 'complete' });
    if (avatar.status === 'complete' && avatar.value.trim()) {
      const url = new URL(avatar.value, window.location.href);
      if (['https:', 'http:'].includes(url.protocol) && image.src !== url.href) image.src = url.href;
    }
  }
} catch (error) {
  // Keep the last displayed values and report the parsing/source error.
  status.textContent = error instanceof Error ? error.message : 'Stream failed';
}`;
