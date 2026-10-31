import {
  StreamNormalizer,
  applyPatchBatch,
  createPatchState,
  select,
  streamStructured,
} from '../dist/index.js';
import type {
  CssDocument,
  CssNode,
  CssRule,
  CssDeclaration,
  CssAtRule,
  CssComment,
  PathValue,
  Pointer,
} from '../dist/index.js';

const parser = new StreamNormalizer<CssDocument>({ format: 'css' });
const snapshot = parser.write('.ai-card { color: re');
const value = select(snapshot, '/nodes/0/nodes/0/value', { when: 'complete' });
if (value.status === 'complete') {
  const text: string = value.value;
  // @ts-expect-error CSS values retain their declared string type.
  const wrong: number = value.value;
  void [text, wrong];
}
const declaration = select(snapshot, '/nodes/0/nodes/0', { when: 'document' });
if (declaration.status === 'complete' && declaration.value.kind === 'declaration') {
  const partial: string | undefined = declaration.value.value;
  // @ts-expect-error Syntax completion does not validate required model fields.
  const required: string = declaration.value.value;
  void [partial, required];
}
// @ts-expect-error Unknown CSS tree paths are rejected.
select(snapshot, '/rules/0/declarations/0/value');
// @ts-expect-error Unknown CSS formats have no aliases.
new StreamNormalizer({ format: 'scss' });
const state = createPatchState<CssDocument>({ format: 'css' });
applyPatchBatch(state, parser.writePatch('d; }'));
const kind: 'stylesheet' | undefined = state.data?.kind;
const pointer: Pointer<CssDocument> = '/nodes/0/nodes/0/important';
const important: PathValue<CssDocument, '/nodes/0/nodes/0/important'> = true;
const nodes: CssNode[] = [
  { kind: 'rule', selector: '.ai-card', nodes: [] } satisfies CssRule,
  {
    kind: 'declaration',
    property: 'color',
    value: 'red',
    important: false,
  } satisfies CssDeclaration,
  { kind: 'at-rule', name: 'media', params: 'all', nodes: [] } satisfies CssAtRule,
  { kind: 'comment', text: 'hello' } satisfies CssComment,
];
async function consume() {
  for await (const item of streamStructured<CssDocument>(['.ai-card { color: red; }'], {
    format: 'css',
  })) {
    const document: 'stylesheet' | undefined = item.data?.kind;
    void document;
  }
}
void [kind, pointer, important, nodes, consume];
