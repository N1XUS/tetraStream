---
title: 'Render nested AI-generated JSON before the response is finished'
published: false
description: 'A TypeScript example of streaming nested objects, arrays of objects, and arrays inside those objects with explicit completion states.'
tags: typescript, javascript, ai, opensource
---

Your AI response is streaming. Your user card is still showing a loading indicator.

The model has already generated the name, contact details, and the start of a project:

```text
{"name":"Alex Morgan","contact":{"email":"alex@example.com"},"projects":[{"name":"Live data grid","details":{"stack":["TypeScript","Riv
```

There is enough information to show Alex's name, email, first project, and its first technology. The second technology is still arriving. `JSON.parse()` rejects the unfinished document.

I built **TetraStream** to make those intermediate states useful. It reads incoming text and exposes structured snapshots containing the available values, completion metadata, and the state of the document.

[Try the live demos](https://tetrastream.severyn.pro/) · [GitHub](https://github.com/N1XUS/tetraStream)

A useful example needs more than a flat object. This profile contains:

- A `contact` object, with a `socials` array of objects.
- A `projects` array of objects.
- A `details` object inside each project.
- A `stack` array inside each project's details.

Each level can finish independently. The string at `/projects/0/details/stack/0` can be complete while its stack array, project object, and outer projects array are still partial.

Install the library in a browser TypeScript app:

```bash
npm install tetra-stream
```

Use this HTML with the TypeScript module below. For the portrait, [download the sample WebP](https://tetrastream.severyn.pro/avatars/alex-morgan.webp) into `public/avatars/alex-morgan.webp`. The portrait is AI-generated and depicts a fictional person.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Nested streaming profile</title>
  </head>
  <body>
    <article aria-label="User profile">
      <span id="avatar-placeholder">Waiting for avatar…</span>
      <img id="avatar" alt="Profile portrait" width="48" height="48" hidden />
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
</html>
```

The generator simulates provider text deltas and deliberately stops inside nested values. The rendering code reuses each project's DOM nodes and its nested list items as their values grow.

```typescript
import { streamStructured, select } from 'tetra-stream';

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
image.onload = () => {
  image.hidden = false;
  placeholder.hidden = true;
};
image.onerror = () => {
  image.hidden = true;
  placeholder.textContent = 'Image unavailable';
};

// Reuse a node for each array index as its partial value grows.
const socialRows = new Map<number, HTMLLIElement>();
const projectRows = new Map<
  number,
  {
    root: HTMLElement;
    title: HTMLElement;
    summary: HTMLElement;
    stack: HTMLUListElement;
    tags: Map<number, HTMLLIElement>;
    state: HTMLElement;
  }
>();
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
  const chunks = [
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
  for (const chunk of chunks) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    yield chunk;
  }
}

try {
  for await (const snapshot of streamStructured<Profile>(textChunks())) {
    name.textContent = snapshot.data?.name ?? 'Waiting for a name…';
    bio.textContent = snapshot.data?.bio ?? 'Waiting for a bio…';
    email.textContent = snapshot.data?.contact?.email ?? 'Waiting for email…';
    status.textContent =
      snapshot.state +
      ' · Contact: ' +
      (snapshot.status['/contact'] ?? 'pending') +
      ' · Projects: ' +
      (snapshot.status['/projects'] ?? 'pending');

    snapshot.data?.contact?.socials?.forEach((social, index) => {
      let row = socialRows.get(index);
      if (!row) {
        row = document.createElement('li');
        socialRows.set(index, row);
        socials.append(row);
      }
      const path = '/contact/socials/' + index + '/handle';
      row.textContent =
        (social.network ?? 'Account') +
        ': ' +
        (social.handle ?? '') +
        ' · ' +
        (snapshot.status[path] ?? 'pending');
    });

    snapshot.data?.projects?.forEach((project, index) => {
      const row = projectRow(index);
      const path = '/projects/' + index;
      row.title.textContent = project.name ?? 'Waiting for project name…';
      row.summary.textContent = project.details?.summary ?? '';
      row.state.textContent =
        'Object: ' +
        (snapshot.status[path] ?? 'pending') +
        ' · Stack array: ' +
        (snapshot.status[path + '/details/stack'] ?? 'pending');
      project.details?.stack?.forEach((tag, itemIndex) => {
        let item = row.tags.get(itemIndex);
        if (!item) {
          item = document.createElement('li');
          row.tags.set(itemIndex, item);
          row.stack.append(item);
        }
        const pointer = path + '/details/stack/' + itemIndex;
        item.textContent = tag + ' · ' + (snapshot.status[pointer] ?? 'pending');
      });
    });

    // Synchronous filter: expose the URL only if it is complete in THIS snapshot.
    const avatar = select(snapshot, '/avatar', { require: 'complete' });
    if (avatar.status === 'complete' && avatar.value.trim()) {
      const url = new URL(avatar.value, window.location.href);
      if (['https:', 'http:'].includes(url.protocol) && image.src !== url.href)
        image.src = url.href;
    }
  }
} catch (error) {
  // Keep the last displayed values and report the parsing/source error.
  status.textContent = error instanceof Error ? error.message : 'Stream failed';
}
```

The name appears first. Contact details then fill in, followed by projects and their stack items. The first project can be complete while the second is still being generated. The live demo's playback slider lets you rewind to any of those states.

The avatar has a different requirement. Its URL is assigned only after the complete string is present; the placeholder stays until the image loads.

`select(snapshot, path, { require: 'complete' })` is a **synchronous read of that snapshot**. The requirement filters which values are exposed now. Its result stays fixed. Call it again with a newer snapshot to read updated data. It does not schedule a future return.

Three kinds of completeness matter:

- **Field completion:** a value ended syntactically. The surrounding object or array can still be partial.
- **Document completion:** input ended and final parsing succeeded.
- **Schema validation:** the decoded data satisfies your application's requirements.

The TypeScript model describes the expected shape. Snapshots expose `DeepPartial<Profile> | undefined`, because nested properties and array contents can still be absent. A syntactically complete document can still omit required fields. TetraStream supports final validation through Standard Schema-compatible validators.

SSE fits into the same flow. An event envelope can be complete JSON while its text delta contains only part of the generated document. Your application decodes the transport and passes the ordered document text to the parser. The [guide includes a complete SSE adapter](https://tetrastream.severyn.pro/guide/#transport) and an [RxJS generate recipe](https://tetrastream.severyn.pro/guide/#rxjs).

TetraStream also supports YAML, XML, HTML, JSON Lines, CSV, TSV, and CSS. Their output structures remain format-specific: tabular formats produce rows, and markup and CSS produce document trees. The playground uses RivetJS and Rivet UI; the parser is independent of the UI layer.

The nested card example is available in the [guide](https://tetrastream.severyn.pro/guide/#quickstart). Feedback on completion semantics and parser edge cases is welcome.
