import { StreamNormalizer } from '../dist/normalizer.js';
import type { Pointer, PathValue } from '../dist/paths.js';
import { select } from '../dist/selection.js';

interface Model {
  name: string;
  active: boolean;
  count: number;
  nullable: null;
  address: { city: string; zip: number };
  people: { name: string; age: number }[];
  tags: string[];
  optional?: { value: number };
  'a/b': { '~key': string };
}
const parser = new StreamNormalizer<Model>();
const snapshot = parser.write('{"name":"Ada"}');
const name = select(snapshot, '/name');
if (name.status === 'partial' || name.status === 'complete') {
  const text: string = name.value;
  // @ts-expect-error Scalar selection preserves the declared scalar type.
  const number: number = name.value;
  void [text, number];
}
const count = select(snapshot, '/count');
if (count.status === 'complete') {
  const n: number = count.value;
  void n;
}
const person = select(snapshot, '/people/0', { require: 'complete' });
if (person.status === 'complete') {
  const maybeName: string | undefined = person.value.name;
  // @ts-expect-error Syntactic completion never validates required object fields.
  const name: string = person.value.name;
  void [maybeName, name];
}
const people = select(snapshot, '/people', { require: 'document' });
if (people.status === 'complete') {
  const maybeAge: number | undefined = people.value[0]?.age;
  // @ts-expect-error Document completion never validates required array item fields.
  const requiredAge: number = people.value[0].age;
  void [maybeAge, requiredAge];
}
const address = select(snapshot, '/address', { require: 'complete' });
if (address.status === 'complete') {
  // @ts-expect-error Required object properties remain partial even when closed.
  const requiredCity: string = address.value.city;
  void requiredCity;
}
const tag = select(snapshot, '/tags/1');
if (tag.status === 'complete') {
  const text: string = tag.value;
  void text;
}
const escaped = select(snapshot, '/a~1b/~0key');
if (escaped.status === 'complete') {
  const text: string = escaped.value;
  void text;
}
const optional = select(snapshot, '/optional/value');
if (optional.status === 'complete') {
  const n: number = optional.value;
  void n;
}
if (name.status === 'pending' || name.status === 'missing') {
  // @ts-expect-error Withheld or missing selections do not expose a value.
  void name.value;
}
// @ts-expect-error Unknown fields are rejected at compile time.
select(snapshot, '/unknown');
// @ts-expect-error Unknown nested fields are rejected at compile time.
select(snapshot, '/address/nope');
// @ts-expect-error Array methods are not data paths.
select(snapshot, '/people/map');
// @ts-expect-error JSON Pointer escapes must be reflected in typed keys.
select(snapshot, '/a/b/~key');
// @ts-expect-error Completion policies are a fixed set.
select(snapshot, '/name', { require: 'closed' });

type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type ArrayLeaf = Assert<Equal<PathValue<Model, '/people/0/name'>, string>>;
type EscapedLeaf = Assert<Equal<PathValue<Model, '/a~1b/~0key'>, string>>;
type Root = Assert<Equal<PathValue<Model, ''>, Model>>;
type Union = Assert<Equal<PathValue<{ data: { a: string } | { b: number } }, '/data/a'>, string>>;
interface Recursive {
  value: string;
  child: Recursive;
}
const bounded: Pointer<Recursive> = '/child/child/child/child/child/child/child/value';
// @ts-expect-error Typed pointers have an eight-segment recursion bound.
const tooDeep: Pointer<Recursive> = '/child/child/child/child/child/child/child/child/value';
void [bounded, tooDeep];

// @ts-expect-error Selection options use require; there is no when alias.
select(snapshot, '/name', { when: 'complete' });
