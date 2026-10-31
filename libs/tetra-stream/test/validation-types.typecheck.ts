import {
  streamValidated,
  validateSnapshot,
  type StandardSchemaV1,
  type InferInput,
  type InferOutput,
  type ValidationResult,
} from '../dist/validation.js';
import { StreamNormalizer } from '../dist/normalizer.js';

interface Input {
  name: string;
  age?: number;
  nested: { enabled: boolean };
}
interface Output {
  label: string;
  age?: number;
  createdAt: Date;
}

// A validator can carry types only at compile time, as Standard Schema specifies.
const schema: StandardSchemaV1<Input, Output> = {
  '~standard': {
    version: 1,
    vendor: 'typed-test',
    validate(value) {
      if (
        typeof value !== 'object' ||
        value === null ||
        !('name' in value) ||
        typeof value.name !== 'string'
      ) {
        return { issues: [{ message: 'Expected name', path: [{ key: 'name' }] }] };
      }
      return { value: { label: value.name, createdAt: new Date() } };
    },
  },
};
const input: InferInput<typeof schema> = { name: 'A', nested: { enabled: true } };
const output: InferOutput<typeof schema> = { label: 'A', createdAt: new Date() };
// @ts-expect-error Input retains required fields.
const missing: InferInput<typeof schema> = { name: 'A' };
// @ts-expect-error Transform outputs retain their distinct type.
const wrong: InferOutput<typeof schema> = { name: 'A', nested: { enabled: true } };
void [input, output, missing, wrong];

async function consume() {
  for await (const snapshot of streamValidated(['{}'], { schema })) {
    const name: string | undefined = snapshot.data?.name;
    const enabled: boolean | undefined = snapshot.data?.nested?.enabled;
    const age: number | undefined = snapshot.data?.age;
    void [name, enabled, age];
    // @ts-expect-error Stream input stays partial even at EOF.
    const requiredName: string = snapshot.data.name;
    // @ts-expect-error Raw data keeps the schema input type.
    snapshot.data?.createdAt;
    // @ts-expect-error Only successful validation exposes typed output.
    snapshot.validation.value;
    if (snapshot.validation.status === 'valid') {
      const label: string = snapshot.validation.value.label;
      const optionalAge: number | undefined = snapshot.validation.value.age;
      const createdAt: Date = snapshot.validation.value.createdAt;
      // @ts-expect-error Optional schema outputs stay optional.
      const requiredAge: number = snapshot.validation.value.age;
      // @ts-expect-error Transformed output does not expose raw input fields.
      snapshot.validation.value.name;
      void [label, optionalAge, createdAt, requiredAge];
    }
    void requiredName;
  }
}

const asyncSchema: StandardSchemaV1<{ count: string }, { count: number }> = {
  '~standard': {
    version: 1,
    vendor: 'typed-async-test',
    async validate(value) {
      if (
        typeof value !== 'object' ||
        value === null ||
        !('count' in value) ||
        typeof value.count !== 'string'
      ) {
        return { issues: [{ message: 'Expected string count' }] };
      }
      return { value: { count: Number(value.count) } };
    },
  },
};
async function consumeAsync() {
  const parser = new StreamNormalizer<{ unrelated: boolean }>();
  parser.write('{"count":"2"}');
  // The untrusted generic on the parser cannot alter the validator's output.
  const result = await validateSnapshot(parser.end(), asyncSchema);
  const typed: ValidationResult<{ count: number }> = result;
  if (typed.status === 'valid') {
    const count: number = typed.value.count;
    // @ts-expect-error Async output infers the transformed number.
    const text: string = typed.value.count;
    void [count, text];
  }
  for await (const snapshot of streamValidated(['{}'], { schema: asyncSchema })) {
    const count: string | undefined = snapshot.data?.count;
    void count;
  }
}

// Accept a structurally compatible vendor class without adapting or extending it.
class VendorSchema {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly types?: { readonly input: string; readonly output: number };
    readonly validate: (
      input: unknown,
    ) => { value: number } | Promise<{ issues: readonly { message: string }[] }>;
  } = {
    version: 1,
    vendor: 'external-shape',
    validate: (input) =>
      typeof input === 'string'
        ? { value: input.length }
        : Promise.resolve({ issues: [{ message: 'string required' }] }),
  };
}
async function vendor() {
  for await (const snapshot of streamValidated(['"name"'], { schema: new VendorSchema() })) {
    const partial: string | undefined = snapshot.data;
    if (snapshot.validation.status === 'valid') {
      const length: number = snapshot.validation.value;
      void length;
    }
    void partial;
  }
}
void [consume, consumeAsync, vendor];
