import { at, list, record } from './helpers.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamNormalizer, streamStructured } from '../dist/index.js';

test('renders an unfinished string while keeping closed fields complete', () => {
  const parser = new StreamNormalizer({ format: 'json' });
  const first = parser.write('{"name":"Alice","bio":"Software eng');
  assert.deepEqual(first.data, { name: 'Alice', bio: 'Software eng' });
  assert.equal(first.status['/name'], 'complete');
  assert.equal(first.status['/bio'], 'partial');
  assert.equal(first.status[''], 'partial');
  const last = parser.write('ineer"}');
  assert.equal(at(last.data, 'bio'), 'Software engineer');
  assert.equal(last.status['/bio'], 'complete');
  assert.equal(last.state, 'streaming');
  assert.equal(parser.end().state, 'complete');
  assert.equal(at(first.data, 'bio'), 'Software eng', 'old snapshots stay immutable');
});

test('waits for complete escape sequences across arbitrary chunks', () => {
  const parser = new StreamNormalizer({ format: 'json' });
  assert.equal(at(parser.write('{"s":"A\\u00').data, 's'), 'A');
  assert.equal(at(parser.write('e9\\').data, 's'), 'Aé');
  assert.equal(at(parser.write('nB"}').data, 's'), 'Aé\nB');
  assert.equal(parser.end().state, 'complete');
});

test('numbers remain provisional until a delimiter or end', () => {
  const parser = new StreamNormalizer({ format: 'json' });
  assert.equal(at(parser.write('{"age":2').data, 'age'), 2);
  assert.equal(parser.snapshot().status['/age'], 'partial');
  assert.equal(at(parser.write('5').data, 'age'), 25);
  assert.equal(at(parser.write('e').data, 'age'), 25);
  assert.equal(at(parser.write('1, "active":tr').data, 'age'), 250);
  assert.equal(parser.snapshot().status['/age'], 'complete');
  assert.equal(Object.hasOwn(record(parser.snapshot().data), 'active'), false);
  assert.equal(at(parser.write('ue}').data, 'active'), true);
  assert.equal(parser.end().state, 'complete');
});

test('nested arrays, null, escaped pointer keys and prototype keys survive character chunks', () => {
  const source = '{"a/b~c":[null,false,{"__proto__":"safe","name":"海🌊"}]}';
  const parser = new StreamNormalizer({ format: 'json' });
  for (const char of source) parser.write(char);
  const result = parser.end();
  assert.deepEqual(result.data, JSON.parse(source));
  assert.equal(result.status['/a~1b~0c/2/name'], 'complete');
  assert.equal(record({}).safe, undefined);
});

test('interrupted documents retain partial data without claiming completion', () => {
  const parser = new StreamNormalizer({ format: 'json' });
  parser.write('{"name":"Ali');
  assert.throws(() => parser.end(), SyntaxError);
  const result = parser.snapshot();
  assert.equal(result.state, 'error');
  assert.equal(at(result.data, 'name'), 'Ali');
  assert.equal(result.status['/name'], 'partial');
});

test('invalid syntax and duplicate keys are rejected instead of silently repairing', () => {
  for (const source of [
    '{"x":01}',
    '{"x":1,}',
    '{"x":truefalse}',
    '{"x":"\\q"}',
    '{"x":1,"x":2}',
    '[1 2]',
    '{}{}',
  ]) {
    const parser = new StreamNormalizer({ format: 'json' });
    assert.throws(
      () => {
        parser.write(source);
        parser.end();
      },
      SyntaxError,
      source,
    );
    assert.equal(parser.snapshot().state, 'error');
  }
});

for (const format of ['xml', 'html'] as const) {
  test(`${format} streams growing text with the same snapshot contract`, () => {
    const parser = new StreamNormalizer({ format });
    const first = parser.write('<user><name>Alice</name><bio>Software eng');
    assert.equal(at(first.data, 'children', 0, 'name'), 'user');
    assert.equal(at(first.data, 'children', 0, 'children', 0, 'children', 0, 'value'), 'Alice');
    assert.equal(
      at(first.data, 'children', 0, 'children', 1, 'children', 0, 'value'),
      'Software eng',
    );
    assert.equal(first.status['/children/0/children/0'], 'complete');
    assert.equal(first.status['/children/0/children/1'], 'partial');
    parser.write('ineer</bio></user>');
    assert.equal(parser.end().state, 'complete');
  });

  test(`${format} handles chunked attributes and entities without losing mixed content`, () => {
    const source = '<user id="a&amp;b">Hi <b>Alice</b> &amp; welcome</user>';
    const parser = new StreamNormalizer({ format });
    for (const char of source) parser.write(char);
    const result = parser.end();
    assert.deepEqual(at(result.data, 'children', 0, 'attributes'), { id: 'a&b' });
    assert.deepEqual(
      list(at(result.data, 'children', 0, 'children')).map((n) => at(n, 'kind')),
      ['text', 'element', 'text'],
    );
    assert.equal(at(result.data, 'children', 0, 'children', 2, 'value'), ' & welcome');
    assert.ok(Object.values(result.status).every((s) => s === 'complete'));
  });
}

test('XML rejects mismatched tags and truncated elements', () => {
  for (const source of [
    '<user><name>Alice</user>',
    '<user><name>Ali',
    '<user>&bogus;</user>',
    '<a/><b/>',
  ]) {
    const parser = new StreamNormalizer({ format: 'xml' });
    assert.throws(
      () => {
        parser.write(source);
        parser.end();
      },
      SyntaxError,
      source,
    );
    assert.equal(parser.snapshot().state, 'error');
  }
});

test('HTML understands void elements and optional closing tags', () => {
  const parser = new StreamNormalizer({ format: 'html' });
  parser.write('<section><img src="x"><ul><li>A<li>B</ul></section>');
  const result = parser.end();
  const section = at(result.data, 'children', 0);
  assert.equal(at(section, 'children', 0, 'name'), 'img');
  assert.equal(list(at(section, 'children', 1, 'children')).length, 2);
  assert.ok(Object.values(result.status).every((s) => s === 'complete'));
});

test('closed or failed parsers refuse more writes', () => {
  const parser = new StreamNormalizer({ format: 'json' });
  parser.write('true');
  parser.end();
  assert.throws(() => parser.write('false'), /closed/i);
});

test('document size and nesting limits fail while preserving prior snapshots', () => {
  const small = new StreamNormalizer({ maxLength: 8 });
  const before = small.write('{"x":"a');
  assert.throws(() => small.write('long value'), RangeError);
  assert.equal(small.snapshot().state, 'error');
  assert.equal(before.state, 'streaming');
  assert.throws(() => new StreamNormalizer({ maxDepth: 1 }).write('[[0]]'), RangeError);
  assert.throws(
    () => new StreamNormalizer({ format: 'xml', maxDepth: 1 }).write('<a><b/>'),
    RangeError,
  );
});

test('async adapter emits partial values and a validated final snapshot', async () => {
  async function* source() {
    yield '{"name":"Al';
    yield 'ice"}';
  }
  const values = [];
  for await (const value of streamStructured(source(), { format: 'json' })) values.push(value);
  assert.equal(at(values[0].data, 'name'), 'Al');
  assert.equal(values[0].status['/name'], 'partial');
  const last = values.at(-1);
  assert.ok(last);
  assert.equal(at(last.data, 'name'), 'Alice');
  assert.equal(last.state, 'complete');
});

test('async adapter propagates a truncated source as an error', async () => {
  async function* source() {
    yield '{"name":"Al';
  }
  await assert.rejects(async () => {
    for await (const _ of streamStructured(source())) {
      /* consume */
    }
  }, SyntaxError);
});

test('XML CDATA text appears before its closing delimiter', () => {
  const parser = new StreamNormalizer({ format: 'xml' });
  let result = parser.write('<user><bio><![CDATA[Software eng');
  assert.equal(
    at(result.data, 'children', 0, 'children', 0, 'children', 0, 'value'),
    'Software eng',
  );
  assert.equal(result.status['/children/0/children/0/children/0'], 'partial');
  result = parser.write('ineer & <designer>]]');
  assert.equal(
    at(result.data, 'children', 0, 'children', 0, 'children', 0, 'value'),
    'Software engineer & <designer>',
  );
  parser.write('></bio></user>');
  result = parser.end();
  assert.equal(
    at(result.data, 'children', 0, 'children', 0, 'children', 0, 'value'),
    'Software engineer & <designer>',
  );
});

for (const format of ['xml', 'html'] as const) {
  test(`${format} preserves prototype-like attribute names as data`, () => {
    const parser = new StreamNormalizer({ format });
    parser.write('<a __proto__="safe" constructor="value"/>');
    const result = parser.end();
    assert.equal(
      Object.hasOwn(record(at(result.data, 'children', 0, 'attributes')), '__proto__'),
      true,
    );
    assert.equal(at(result.data, 'children', 0, 'attributes', '__proto__'), 'safe');
    assert.equal(at(result.data, 'children', 0, 'attributes', 'constructor'), 'value');
  });
}

test('XML normalizes literal line endings and attribute whitespace while preserving character references', () => {
  const parser = new StreamNormalizer({ format: 'xml' });
  for (const char of '<a label="x\t\r\ny&#10;z">x\r\ny\rz&#13;</a>') parser.write(char);
  const result = parser.end();
  assert.equal(at(result.data, 'children', 0, 'attributes', 'label'), 'x  y\nz');
  assert.equal(at(result.data, 'children', 0, 'children', 0, 'value'), 'x\ny\nz\r');
});

test('XML numeric entities preserve XML code points instead of HTML replacements', () => {
  const parser = new StreamNormalizer({ format: 'xml' });
  for (const char of '<a>&#x80;&#x85;&#x9f;</a>') parser.write(char);
  const result = parser.end();
  assert.equal(at(result.data, 'children', 0, 'children', 0, 'value'), '\u0080\u0085\u009f');
});
