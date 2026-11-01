/** Serialize already validated JSON values without losing the sign of negative zero. */
export function stringifyWire(value: unknown): string {
  const parts: string[] = [];
  const stack: ({ value: unknown } | { raw: string })[] = [{ value }];
  while (stack.length) {
    const item = stack.pop()!;
    if ('raw' in item) {
      parts.push(item.raw);
      continue;
    }
    const value = item.value;
    if (value === null) {
      parts.push('null');
      continue;
    }
    if (typeof value === 'string') {
      parts.push(JSON.stringify(value));
      continue;
    }
    if (typeof value === 'number') {
      parts.push(Object.is(value, -0) ? '-0' : String(value));
      continue;
    }
    if (typeof value === 'boolean') {
      parts.push(String(value));
      continue;
    }
    if (typeof value !== 'object') throw new TypeError('Expected validated JSON values');
    if (Array.isArray(value)) {
      parts.push('[');
      stack.push({ raw: ']' });
      for (let index = value.length - 1; index >= 0; index--) {
        stack.push({ value: value[index] });
        if (index) stack.push({ raw: ',' });
      }
    } else {
      parts.push('{');
      stack.push({ raw: '}' });
      const keys = Object.keys(value);
      for (let index = keys.length - 1; index >= 0; index--) {
        const key = keys[index]!;
        stack.push(
          { value: (value as Record<string, unknown>)[key] },
          { raw: ':' },
          { raw: JSON.stringify(key) },
        );
        if (index) stack.push({ raw: ',' });
      }
    }
  }
  return parts.join('');
}
