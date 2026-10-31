import assert from 'node:assert/strict';

/** Narrow unknown parser output while retaining runtime fixture checks. */
export function record(value: unknown): Record<PropertyKey, unknown> {
  assert.ok(value !== null && typeof value === 'object', 'expected object fixture data');
  return value as Record<PropertyKey, unknown>;
}

export function list(value: unknown): unknown[] {
  assert.ok(Array.isArray(value), 'expected array fixture data');
  return value;
}

export function at(value: unknown, ...path: PropertyKey[]): unknown {
  for (const key of path) {
    const object = record(value);
    value = Object.hasOwn(object, key) ? object[key] : undefined;
  }
  return value;
}
