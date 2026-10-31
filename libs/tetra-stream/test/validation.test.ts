import { at, record } from './helpers.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamNormalizer } from '../dist/normalizer.js';
import { validateSnapshot, streamValidated } from '../dist/validation.js';

// This structural Standard Schema implementation has real required-field checks
// and a transform, without coupling the consumer to a validator dependency.
const personSchema = {
  '~standard': {
    version: 1 as const,
    vendor: 'tetra-tests',
    validate(value: unknown) {
      if (value === null || typeof value !== 'object' || !('name' in value) || typeof value.name !== 'string') {
        return { issues: [{ message: 'Name is required', path: ['name'] }] };
      }
      return { value: { name: value.name.trim(), nameLength: value.name.trim().length } };
    },
  },
};

function complete(text: string) {
  const parser = new StreamNormalizer();
  parser.write(text);
  return parser.end();
}

test('validation waits for EOF even when the document root is already closed', async () => {
  const parser = new StreamNormalizer();
  const closed = parser.write('{}');
  const pending = await validateSnapshot(closed, personSchema);
  assert.deepEqual(pending, { status: 'pending' });
  const invalid = await validateSnapshot(parser.end(), personSchema);
  assert.deepEqual(invalid, {
    status: 'invalid', issues: [{ message: 'Name is required', path: ['name'] }],
  });
});

test('successful validation exposes transformed output while preserving raw snapshots', async () => {
  const snapshot = complete('{"name":" Alice "}');
  assert.deepEqual(await validateSnapshot(snapshot, personSchema), {
    status: 'valid', value: { name: 'Alice', nameLength: 5 },
  });
  assert.deepEqual(snapshot.data, { name: ' Alice ' });
});

test('mutating validators receive an isolated copy of the parsed data', async () => {
  const snapshot = complete('{"nested":{"value":1}}');
  const mutating = { '~standard': { version: 1 as const, vendor: 'tetra-tests', validate(value: unknown) {
    record(at(value, 'nested')).value = 2;
    return { value };
  } } };
  assert.deepEqual(await validateSnapshot(snapshot, mutating), {
    status: 'valid', value: { nested: { value: 2 } },
  });
  assert.deepEqual(snapshot.data, { nested: { value: 1 } });
});

test('parse failure skips validation and preserves the parser error', async () => {
  const parser = new StreamNormalizer();
  parser.write('{"name":"Al');
  assert.throws(() => parser.end(), SyntaxError);
  const snapshot = parser.snapshot();
  const result = await validateSnapshot(snapshot, personSchema);
  assert.ok(result.status === 'parse-error');
  assert.equal(result.error, snapshot.error);
});

test('pending and parse-error snapshots never invoke the validator', async () => {
  const schema = { '~standard': { version: 1 as const, vendor: 'tetra-tests', validate() {
    assert.fail('validation must wait for a successfully parsed document');
  } } };
  const parser = new StreamNormalizer();
  const partial = parser.write('{"name":"A');
  assert.deepEqual(await validateSnapshot(partial, schema), { status: 'pending' });
  assert.throws(() => parser.end(), SyntaxError);
  assert.equal((await validateSnapshot(parser.snapshot(), schema)).status, 'parse-error');
});

test('async validation is awaited and rejection stays distinct from invalid input', async () => {
  const error = new Error('validator unavailable');
  const schemas = [
    { '~standard': { version: 1 as const, vendor: 'tetra-tests', async validate(value: unknown) {
      const name = at(value, 'name');
      assert.equal(typeof name, 'string');
      assert.ok(typeof name === 'string');
      return { value: name.toUpperCase() };
    } } },
    { '~standard': { version: 1 as const, vendor: 'tetra-tests', async validate() { throw error; } } },
    { '~standard': { version: 1 as const, vendor: 'tetra-tests', validate() { throw error; } } },
  ];
  assert.deepEqual(await validateSnapshot(complete('{"name":"Alice"}'), schemas[0]), {
    status: 'valid', value: 'ALICE',
  });
  for (const schema of schemas.slice(1)) {
    assert.deepEqual(await validateSnapshot(complete('{}'), schema), { status: 'validator-error', error });
  }
});

test('Standard Schema issues including empty issue lists mean invalid', async () => {
  const schema = { '~standard': { version: 1 as const, vendor: 'tetra-tests', validate() {
    return { issues: [] };
  } } };
  assert.deepEqual(await validateSnapshot(complete('null'), schema), { status: 'invalid', issues: [] });
});

test('streamValidated preserves partial raw data and validates its final value once', async () => {
  const snapshots = [];
  let validations = 0;
  const schema = { '~standard': { ...personSchema['~standard'], async validate(value: unknown) {
    validations++;
    return personSchema['~standard'].validate(value);
  } } };
  async function* chunks() { yield '{"name":" Al'; yield 'ice "}'; }
  for await (const snapshot of streamValidated(chunks(), { schema })) snapshots.push(snapshot);
  assert.equal(at(snapshots[0].data, "name"), ' Al');
  assert.equal(snapshots[0].status['/name'], 'partial');
  assert.equal(snapshots[0].validation.status, 'pending');
  assert.equal(snapshots[1].validation.status, 'pending');
  assert.equal(snapshots[2].state, 'complete');
  assert.deepEqual(snapshots[2].data, { name: ' Alice ' });
  assert.deepEqual(snapshots[2].validation, { status: 'valid', value: { name: 'Alice', nameLength: 5 } });
  assert.equal(validations, 1);
});

test('schema invalidity at EOF keeps parsing complete and raw data available', async () => {
  const snapshots = [];
  for await (const snapshot of streamValidated(['{}'], { schema: personSchema })) snapshots.push(snapshot);
  const last = snapshots.at(-1);
  assert.ok(last);
  assert.equal(last.state, 'complete');
  assert.deepEqual(last.data, {});
  assert.equal(last.validation.status, 'invalid');
});

test('streamValidated propagates parser and source failures without validating', async () => {
  for (const chunks of [['{"name":"Al'], ['{"name":!}'], ['{}', 'true']]) {
    await assert.rejects(async () => {
      for await (const snapshot of streamValidated(chunks, { schema: personSchema })) {
        assert.equal(snapshot.validation.status, 'pending');
      }
    }, SyntaxError);
  }
  const error = new Error('transport failed');
  async function* failing() { yield '{'; throw error; }
  await assert.rejects(async () => {
    for await (const _ of streamValidated(failing(), { schema: personSchema })) { /* consume */ }
  }, error);
});
