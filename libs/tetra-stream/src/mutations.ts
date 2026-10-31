import type { Completion, MutableSnapshot } from './types.js';

export interface MutationObserver {
  set(path: string): void;
  append(path: string, text: string): void;
  status(path: string, completion: Completion | null): void;
}
const observers = new WeakMap<MutableSnapshot, MutationObserver>();
export function observeMutations(state: MutableSnapshot, observer: MutationObserver): void { observers.set(state, observer); }
export function recordSet(state: MutableSnapshot, path: string): void { observers.get(state)?.set(path); }
export function recordAppend(state: MutableSnapshot, path: string, text: string): void { if (text) observers.get(state)?.append(path, text); }
export function setCompletion(state: MutableSnapshot, path: string, completion: Completion): void {
  if (state.status[path] === completion) return;
  state.status[path] = completion;
  observers.get(state)?.status(path, completion);
}
export function forwardMutations(child: MutableSnapshot, parent: MutableSnapshot, prefix: string): void {
  observeMutations(child, {
    set: path => recordSet(parent, prefix + path),
    append: (path, text) => recordAppend(parent, prefix + path, text),
    status: (path, value) => observers.get(parent)?.status(prefix + path, value),
  });
}
const encode = (key: string): string => key.replaceAll('~', '~0').replaceAll('/', '~1');
function diff(previous: unknown, next: unknown, path: string, observer: MutationObserver): void {
  if (Object.is(previous, next)) return;
  if (typeof previous === 'string' && typeof next === 'string' && next.startsWith(previous)) {
    observer.append(path, next.slice(previous.length));
    return;
  }
  if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object' || Array.isArray(previous) !== Array.isArray(next)
    || Array.isArray(previous) && Array.isArray(next) && next.length < previous.length) {
    observer.set(path);
    return;
  }
  for (const key of Object.keys(previous)) if (!Object.hasOwn(next, key)) observer.set(`${path}/${encode(key)}`);
  for (const key of Object.keys(next)) {
    const before = Object.hasOwn(previous, key) ? (previous as Record<string, unknown>)[key] : undefined;
    diff(before, (next as Record<string, unknown>)[key], `${path}/${encode(key)}`, observer);
  }
}
/** YAML replaces provisional trees; other adapters journal their incremental mutations. */
export function replaceData(state: MutableSnapshot, data: MutableSnapshot['data']): void {
  const observer = observers.get(state);
  if (observer) diff(state.data, data, '', observer);
  state.data = data;
}
export function replaceCompletions(state: MutableSnapshot, status: Record<string, Completion>): void {
  const observer = observers.get(state);
  if (observer) {
    for (const path of Object.keys(state.status)) if (!Object.hasOwn(status, path)) observer.status(path, null);
    for (const [path, value] of Object.entries(status)) if (state.status[path] !== value) observer.status(path, value);
  }
  state.status = status;
}
