import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamNormalizer, type Snapshot } from 'tetra-stream';
import { cssStylingExample, readCssPreview } from '../src/css-styling.ts';
import { seekStream } from '../src/seek-stream.ts';

// Browser CSS.supports is injected at the projection boundary. These tests
// exercise completion and scope policy, rather than reimplementing CSS parsing.
const supports = (property: string, value: string) =>
  property !== 'color' || value !== 'not-a-color';
function snapshot(
  value: string,
  complete = true,
  property = 'color',
  selector = '.ai-card',
): Snapshot<unknown> {
  return {
    format: 'css',
    state: 'streaming',
    data: {
      kind: 'stylesheet',
      nodes: [
        {
          kind: 'rule',
          selector,
          nodes: [{ kind: 'declaration', property, value, important: false }],
        },
      ],
    },
    status: {
      '/nodes/0/selector': 'complete',
      '/nodes/0/nodes/0': complete ? 'complete' : 'partial',
      '/nodes/0/nodes/0/value': complete ? 'complete' : 'partial',
    },
  };
}

test('growing CSS values remain visible in the inspector but are not applied', () => {
  const result = readCssPreview(snapshot('rgb(12,', false), supports);
  assert.deepEqual(result.style, {});
  assert.equal(result.declarations[0].value, 'rgb(12,');
  assert.equal(result.declarations[0].status, 'partial');
  assert.equal(result.partial, 1);
  assert.equal(result.applied, 0);
});

test('completed declarations apply without waiting for document EOF', () => {
  const result = readCssPreview(snapshot('#32265c'), supports);
  assert.deepEqual(result.style, { color: '#32265c' });
  assert.equal(result.complete, 1);
  assert.equal(result.applied, 1);
  assert.equal(result.declarations[0].applied, true);
});

test('complete empty, absent, and unsupported values never become inline styles', () => {
  for (const value of ['', '  ', 'not-a-color']) {
    assert.deepEqual(readCssPreview(snapshot(value), supports).style, {});
  }
  assert.deepEqual(
    readCssPreview({ format: 'css', data: undefined, state: 'streaming', status: {} }, supports)
      .style,
    {},
  );
  assert.deepEqual(readCssPreview({ ...snapshot('red'), status: {} }, supports).style, {});
});

test('rewinding produces a fresh style projection with future properties removed', () => {
  const end = readCssPreview(snapshot('#32265c'), supports);
  assert.deepEqual(end.style, { color: '#32265c' });
  const earlier = readCssPreview(snapshot('#32', false), supports);
  assert.deepEqual(earlier.style, {});
  assert.deepEqual(end.style, { color: '#32265c' });
});

test('selectors and properties stay confined to one fixed preview element', () => {
  for (const selector of [
    'body',
    '.ai-card, body',
    '.ai-card:hover',
    '#css-preview',
    '.ai-card *',
  ]) {
    assert.deepEqual(readCssPreview(snapshot('red', true, 'color', selector), supports).style, {});
  }
  for (const property of [
    'position',
    'display',
    'content',
    '--custom',
    'background-image',
    'animation',
    'all',
  ]) {
    assert.deepEqual(readCssPreview(snapshot('red', true, property), supports).style, {});
  }
});

test('URL, escaped, inherited-variable and resource-image values are blocked', () => {
  for (const value of [
    'url(https://example.com/a.png)',
    'u\\72l(https://example.com/a.png)',
    'var(--remote)',
    'image-set("https://example.com/a.png" 1x)',
    'image("https://example.com/a.png")',
    'red; display: none',
    'red } body { color: blue',
  ]) {
    assert.deepEqual(
      readCssPreview(snapshot(value, true, 'background'), () => true).style,
      {},
      value,
    );
  }
  assert.deepEqual(
    readCssPreview(
      snapshot('linear-gradient(135deg, #fff6e5, #f2e8ff)', true, 'background'),
      () => true,
    ).style,
    { background: 'linear-gradient(135deg, #fff6e5, #f2e8ff)' },
  );
});

test('completed duplicate declarations cascade while a growing replacement waits', () => {
  const source = snapshot('red');
  source.data = {
    kind: 'stylesheet',
    nodes: [
      {
        kind: 'rule',
        selector: '.ai-card',
        nodes: [
          { kind: 'declaration', property: 'color', value: 'red', important: false },
          { kind: 'declaration', property: 'color', value: 'blu', important: false },
        ],
      },
    ],
  };
  source.status['/nodes/0/nodes/1'] = 'partial';
  source.status['/nodes/0/nodes/1/value'] = 'partial';
  assert.deepEqual(readCssPreview(source, supports).style, { color: 'red' });
  source.status['/nodes/0/nodes/1'] = 'complete';
  source.status['/nodes/0/nodes/1/value'] = 'complete';
  assert.deepEqual(readCssPreview(source, supports).style, { color: 'blu' });
});

test('nested rules and at-rules do not escape the fixed top-level styling contract', () => {
  const source: Snapshot<unknown> = {
    format: 'css',
    state: 'complete',
    status: { '': 'complete' },
    data: {
      kind: 'stylesheet',
      nodes: [
        {
          kind: 'at-rule',
          name: 'media',
          params: 'all',
          nodes: [
            {
              kind: 'rule',
              selector: '.ai-card',
              nodes: [{ kind: 'declaration', property: 'color', value: 'red', important: false }],
            },
          ],
        },
      ],
    },
  };
  assert.deepEqual(readCssPreview(source, supports).style, {});
});

test('a value boundary alone cannot label an unfinished declaration complete', () => {
  const source = snapshot('red');
  source.status['/nodes/0/nodes/0'] = 'partial';
  const result = readCssPreview(source, supports);
  assert.deepEqual(result.style, {});
  assert.equal(result.complete, 0);
  assert.equal(result.partial, 1);
});

test('only a stylesheet snapshot participates in the CSS preview', () => {
  assert.deepEqual(readCssPreview({ ...snapshot('red'), format: 'json' }, supports).style, {});
  assert.deepEqual(
    readCssPreview(
      {
        ...snapshot('red'),
        data: {
          nodes: [
            {
              kind: 'rule',
              selector: '.ai-card',
              nodes: [{ kind: 'declaration', property: 'color', value: 'red' }],
            },
          ],
        },
      },
      supports,
    ).style,
    {},
  );
});

test('the real CSS stream applies only closed declarations before document EOF', () => {
  const parser = new StreamNormalizer({ format: 'css' });
  const partial = readCssPreview(parser.write('.ai-card { color: #382b59; padding: 3'), () => true);
  assert.deepEqual(partial.style, { color: '#382b59' });
  assert.equal(partial.partial, 1);
  const next = parser.write('2px; }');
  assert.equal(next.state, 'streaming');
  assert.deepEqual(readCssPreview(next, () => true).style, { color: '#382b59', padding: '32px' });
  assert.equal(parser.end().state, 'complete');
});

test('CSS playback rebuild removes future declarations and resets to neutral', () => {
  const end = seekStream(cssStylingExample, 'css', cssStylingExample.length);
  assert.equal(end.snapshot.state, 'complete');
  assert.equal(readCssPreview(end.snapshot, () => true).applied, 9);
  const position = cssStylingExample.indexOf('padding:') + 'padding: 3'.length;
  const middle = seekStream(cssStylingExample, 'css', position);
  assert.deepEqual(readCssPreview(middle.snapshot, () => true).style, {
    background: 'linear-gradient(135deg, #fff6e5, #eee5ff)',
    color: '#382b59',
  });
  assert.deepEqual(
    readCssPreview(seekStream(cssStylingExample, 'css', 0).snapshot, () => true).style,
    {},
  );
});

test('important declarations are explicitly excluded while later normal declarations apply', () => {
  const parser = new StreamNormalizer({ format: 'css' });
  const source = parser.write('.ai-card { color: red !important; color: blue; }');
  const result = readCssPreview(source, () => true);
  assert.deepEqual(result.style, { color: 'blue' });
  assert.equal(result.declarations[0].applied, false);
  assert.equal(result.declarations[0].reason, '!important not enabled');
  assert.equal(result.declarations[1].applied, true);
  assert.equal(result.applied, 1);
});
