import { streamStructured } from './normalizer.js';
import type { NormalizerOptions, Snapshot } from './types.js';

/**
 * Dependency-free structural Standard Schema V1 contract.
 * Compatible schema libraries can supply this interface directly.
 * @see https://standardschema.dev/
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardSchemaV1.Props<Input, Output>;
}

export declare namespace StandardSchemaV1 {
  interface Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown, options?: Options | undefined) => Result<Output> | Promise<Result<Output>>;
    readonly types?: Types<Input, Output> | undefined;
  }
  interface Options {
    readonly libraryOptions?: Record<string, unknown> | undefined;
  }
  type Result<Output> = SuccessResult<Output> | FailureResult;
  interface SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }
  interface FailureResult {
    readonly issues: ReadonlyArray<Issue>;
  }
  interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }
  interface PathSegment {
    readonly key: PropertyKey;
  }
  interface Types<Input = unknown, Output = Input> {
    readonly input: Input;
    readonly output: Output;
  }
  type InferInput<Schema extends StandardSchemaV1> = NonNullable<Schema['~standard']['types']>['input'];
  type InferOutput<Schema extends StandardSchemaV1> = NonNullable<Schema['~standard']['types']>['output'];
}

export type InferInput<Schema extends StandardSchemaV1> = StandardSchemaV1.InferInput<Schema>;
export type InferOutput<Schema extends StandardSchemaV1> = StandardSchemaV1.InferOutput<Schema>;

/**
 * Only `valid` exposes the schema's fully typed, possibly transformed output.
 * `pending` means document EOF has not been reached. `invalid` contains schema
 * issues after successful parsing. `parse-error` is an existing parser failure;
 * `validator-error` preserves an exception thrown or rejected by validation.
 */
export type ValidationResult<Output> =
  | { status: 'pending' }
  | { status: 'valid'; value: Output }
  | { status: 'invalid'; issues: ReadonlyArray<StandardSchemaV1.Issue> }
  | { status: 'parse-error'; error: string | undefined }
  | { status: 'validator-error'; error: unknown };

/** A partial input snapshot accompanied by a separate validation outcome. */
export type ValidatedSnapshot<Schema extends StandardSchemaV1> = Snapshot<InferInput<Schema>> & {
  validation: ValidationResult<InferOutput<Schema>>;
};

/**
 * Validate only a successfully completed document, never provisional data.
 * The schema receives a clone so transforms or mutating validators cannot alter
 * the raw snapshot. Parser generic parameters do not supply runtime validation.
 */
export async function validateSnapshot<Schema extends StandardSchemaV1>(
  snapshot: Snapshot<unknown>,
  schema: Schema,
): Promise<ValidationResult<InferOutput<Schema>>> {
  if (snapshot.state === 'streaming') return { status: 'pending' };
  if (snapshot.state === 'error') return { status: 'parse-error', error: snapshot.error };
  try {
    const result = await schema['~standard'].validate(structuredClone(snapshot.data));
    if (result.issues) return { status: 'invalid', issues: result.issues };
    return { status: 'valid', value: result.value as InferOutput<Schema> };
  } catch (error) {
    return { status: 'validator-error', error };
  }
}

/**
 * Preserve incremental input snapshots and validate the final document at EOF.
 * Parsing and source errors propagate as with streamStructured. Schema issues
 * and validator exceptions appear in `validation` on the final snapshot.
 */
export async function* streamValidated<Schema extends StandardSchemaV1>(
  source: AsyncIterable<string> | Iterable<string>,
  options: NormalizerOptions & { schema: Schema },
): AsyncGenerator<ValidatedSnapshot<Schema>> {
  const { schema, ...normalizerOptions } = options;
  for await (const snapshot of streamStructured<InferInput<Schema>>(source, normalizerOptions)) {
    yield { ...snapshot, validation: await validateSnapshot(snapshot, schema) };
  }
}
