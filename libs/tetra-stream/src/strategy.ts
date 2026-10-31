/** Validate the common data model used by snapshots, selectors and patches. */
export function assertStrategyData(data: unknown, maxDepth: number): void {
  const active = new WeakSet<object>();
  function visit(value: unknown, depth: number): void {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError('Strategy data numbers must be finite');
      return;
    }
    if (typeof value !== 'object')
      throw new TypeError('Strategy data must contain JSON-compatible plain values');
    if (depth >= maxDepth) throw new RangeError('Strategy data exceeds maxDepth');
    if (active.has(value))
      throw new TypeError('Strategy data cannot contain cyclic or shared object references');
    const array = Array.isArray(value);
    if (
      !array &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    ) {
      throw new TypeError('Strategy data must use plain objects and arrays');
    }
    active.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (array) {
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(descriptors, index))
          throw new TypeError('Strategy data cannot contain sparse arrays');
      }
    }
    for (const key of Reflect.ownKeys(descriptors)) {
      if (array && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (
        typeof key !== 'string' ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, 'value') ||
        (array && !/^(0|[1-9][0-9]*)$/u.test(key))
      ) {
        throw new TypeError('Strategy data must use enumerable plain data properties');
      }
      visit(descriptor.value, depth + 1);
    }
  }
  if (data !== undefined) visit(data, 0);
}
