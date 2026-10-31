/** Escape one object key as an RFC 6901 JSON Pointer token. */
type Escape<Token extends string> = Token extends `${infer Head}~${infer Tail}`
  ? `${Escape<Head>}~0${Escape<Tail>}`
  : Token extends `${infer Head}/${infer Tail}` ? `${Escape<Head>}~1${Escape<Tail>}` : Token;

type PointerTail<T, Depth extends unknown[]> = Depth['length'] extends 8 ? never
  : T extends readonly (infer Item)[]
    ? `/${number}` | `/${number}${PointerTail<Item, [...Depth, unknown]>}`
    : T extends object ? {
      [Key in Extract<keyof T, string | number>]: `/${Escape<`${Key}`>}` | `/${Escape<`${Key}`>}${PointerTail<T[Key], [...Depth, unknown]>}`
    }[Extract<keyof T, string | number>] : never;

/** Typed RFC 6901 paths, including the root (''), bounded to eight segments. */
export type Pointer<T> = '' | PointerTail<T, []>;

type Unescape<Token extends string> = Token extends `${infer Head}~1${infer Tail}`
  ? `${Unescape<Head>}/${Unescape<Tail>}`
  : Token extends `${infer Head}~0${infer Tail}` ? `${Unescape<Head>}~${Unescape<Tail>}` : Token;

type ValueAt<T, Key extends string> = T extends readonly (infer Item)[]
  ? Key extends `${number}` ? Key extends keyof T ? T[Key] : Item : never
  : T extends object ? Key extends keyof T ? T[Key] : Key extends `${infer Numeric extends number}` ? Numeric extends keyof T ? T[Numeric] : never : never : never;

/** The declared value at a pointer. Selection applies DeepPartial separately. */
export type PathValue<T, Path extends string> = Path extends '' ? T
  : Path extends `/${infer Head}/${infer Tail}` ? PathValue<ValueAt<T, Unescape<Head>>, `/${Tail}`>
  : Path extends `/${infer Key}` ? ValueAt<T, Unescape<Key>> : never;
