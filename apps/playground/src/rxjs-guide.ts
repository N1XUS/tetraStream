/** The exact pipeline shown in the guide is executed in virtual-time tests. */
export const rxjsPipelineCode = `import {
  generate, defer, of, concatMap, delay, map, concatWith, type Observable,
} from 'rxjs';
import { Format, StreamNormalizer, type Snapshot } from 'tetra-stream';

interface Profile { name: string; bio: string }
const profileChunks = [
  '{"name":"Al',
  'ex Morgan","bio":"Building ',
  'interfaces as data arrives."}',
];

// A simulated AI response. Replace generate(...) with your Observable<string>
// of decoded provider text deltas when connecting a real provider.
export function generateProfile$(
  delayMs = 250,
  chunks: readonly string[] = profileChunks,
): Observable<Snapshot<Profile>> {
  return defer(() => {
    // Every subscription gets a parser for its own document.
    const parser = new StreamNormalizer<Profile>({ format: Format.JSON });
    const chunks$ = generate<string, number>({
      initialState: 0,
      condition: index => index < chunks.length,
      iterate: index => index + 1,
      resultSelector: index => chunks[index],
    });

    return chunks$.pipe(
      // generate is synchronous by default. Pace each chunk so the browser
      // can paint growing values, rather than delaying a batch of values.
      concatMap(chunk => of(chunk).pipe(delay(delayMs))),
      map(chunk => parser.write(chunk)),
      // Run only after normal source completion. Errors and unsubscribe
      // must never mark a partial document complete.
      concatWith(defer(() => of(parser.end()))),
    );
  });
}`;

export const rxjsBindingCode = `// Complete native DOM binding; no hidden renderProfile helper.
const card = document.createElement('article');
const name = document.createElement('h2');
const bio = document.createElement('p');
const state = document.createElement('p');
const stop = document.createElement('button');
name.textContent = 'Waiting for a name…';
bio.textContent = 'Waiting for a bio…';
state.setAttribute('role', 'status');
state.textContent = 'Waiting for the first chunk…';
stop.textContent = 'Stop generation';
card.append(name, bio, state, stop);
document.body.append(card);

const subscription = generateProfile$().subscribe({
  next(snapshot) {
    name.textContent = snapshot.data?.name ?? 'Waiting for a name…';
    bio.textContent = snapshot.data?.bio ?? 'Waiting for a bio…';
    state.textContent = 'Name: ' + (snapshot.status['/name'] ?? 'pending')
      + ' · Bio: ' + (snapshot.status['/bio'] ?? 'pending')
      + ' · Document: ' + snapshot.state;
  },
  error(error: unknown) {
    // Keep the last visible data; report failure separately.
    state.textContent = 'Generation failed: '
      + (error instanceof Error ? error.message : String(error));
    stop.disabled = true;
  },
  complete() { stop.disabled = true; },
});

stop.addEventListener('click', () => {
  subscription.unsubscribe();
  state.textContent = 'Stopped. Last values may still be partial.';
  stop.disabled = true;
}, { once: true });
window.addEventListener('pagehide', () => subscription.unsubscribe(), { once: true });`;
