import {
  StreamNormalizer,
  createPatchState,
  applyPatchBatch,
  select,
  type PatchBatch,
  type PatchState,
  type Pointer,
  type PathValue,
} from '../dist/index.js';

interface User {
  name: string;
  avatar: string;
  age: number;
  skills: string[];
  nested: { city: string };
}
const parser = new StreamNormalizer<User>();
const batch: PatchBatch = parser.writePatch('{"name":"Al');
const state: PatchState<User> = createPatchState<User>();
applyPatchBatch(state, batch);
const name = select(state, '/name');
if (name.status === 'partial' || name.status === 'complete') {
  const value: string = name.value;
  // @ts-expect-error A typed string field is not a number.
  const wrong: number = name.value;
  void [value, wrong];
}
const skillPath: Pointer<User> = '/skills/0';
const skill: PathValue<User, typeof skillPath> = 'design';
void skill;
// @ts-expect-error Unknown model properties are rejected.
select(state, '/notAField');
// @ts-expect-error Patch data remains partial, including after replay.
const city: string = state.data.nested.city;
for (const patch of batch.patches) {
  if (patch.op === 'append') {
    const suffix: string = patch.value;
    void suffix;
  }
  if (patch.op === 'set') {
    // A heterogeneous event needs selection or validation; do not pretend all values have one type.
    // @ts-expect-error Raw patch payload is unknown.
    const unverified: string = patch.value;
    void unverified;
  }
}
void city;
