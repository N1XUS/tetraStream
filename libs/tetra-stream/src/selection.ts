import type { Completion, DeepPartial, Snapshot } from './types.js';
import type { PathValue, Pointer } from './paths.js';

export type SelectionWhen = 'partial' | 'complete' | 'document';
export interface SelectionOptions { when?: SelectionWhen }
type SelectionState = Snapshot<unknown>['state'];

/** Only exposed branches have a value; completion is syntactic, not validation. */
export type SelectionResult<Value> =
  | { status: 'pending'; state: SelectionState; completion?: Completion }
  | { status: 'missing'; state: SelectionState }
  | { status: 'partial'; state: SelectionState; value: DeepPartial<Value> }
  | { status: 'complete'; state: SelectionState; value: DeepPartial<Value> };

/**
 * Read one field using a reusable completion policy (default: partial).
 * A terminal error retains completed fields but never satisfies document policy.
 * Missing means the field cannot arrive: its container or the stream has ended.
 */
export function select<T, const P extends Pointer<T>>(
  snapshot: Snapshot<T>, path: P, { when = 'partial' }: SelectionOptions = {},
): SelectionResult<PathValue<T, P>> {
  if (when !== 'partial' && when !== 'complete' && when !== 'document') throw new TypeError(`Unsupported selection policy: ${when}`);
  if (typeof path !== 'string' || (path !== '' && !path.startsWith('/')) || /~(?:[^01]|$)/.test(path)) {
    throw new TypeError('Expected an RFC 6901 JSON Pointer');
  }
  const tokens = path === '' ? [] : path.slice(1).split('/');
  let value: unknown = snapshot.data;
  let exists = value !== undefined;
  let prefix = '';
  const completionAt = (pointer: string): Completion | undefined => Object.hasOwn(snapshot.status, pointer) ? snapshot.status[pointer] : undefined;
  let complete = completionAt('') === 'complete';
  for (const token of tokens) {
    const key = token.replaceAll('~1', '/').replaceAll('~0', '~');
    if (exists && Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key)) {
      if (/^-?\d/.test(key)) throw new TypeError('Expected a canonical non-negative array index');
      exists = false;
    }
    exists = exists && value !== null && typeof value === 'object' && Object.hasOwn(value, key);
    if (exists) value = (value as Record<string, unknown>)[key];
    prefix += `/${token}`;
    complete ||= completionAt(prefix) === 'complete';
  }
  const { state } = snapshot;
  if (!exists) return { status: state !== 'streaming' || complete ? 'missing' : 'pending', state };
  const completion: Completion = complete || state === 'complete' ? 'complete' : 'partial';
  if ((when === 'document' && state !== 'complete') || (when === 'complete' && completion !== 'complete')) {
    return { status: 'pending', state, completion };
  }
  return { status: completion, state, value: value as DeepPartial<PathValue<T, P>> };
}
