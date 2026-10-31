import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../dist/index.js';
import type { LanguageStrategy, LanguageParser, LanguageUpdate, LanguageStrategyOptions } from '../dist/index.js';

interface Message { text: string }
class TextStrategy implements LanguageStrategy<Message> {
  readonly format = 'plain-message';
  readonly sessions: LanguageStrategyOptions[] = [];
  create(options: LanguageStrategyOptions): LanguageParser<Message> {
    this.sessions.push(options);
    let text = '';
    const update = (complete: boolean): LanguageUpdate<Message> => ({
      data: { text }, status: { '': complete ? 'complete' : 'partial', '/text': complete ? 'complete' : 'partial' },
    });
    return {
      write(chunk) { text += chunk; if (text.includes('!')) throw new SyntaxError('No exclamations'); return update(false); },
      end() { if (!text) throw new SyntaxError('Empty message'); return update(true); },
    };
  }
}

test('public enum includes every built-in format and works at runtime', () => {
  assert.deepEqual(Object.values(api.Format), ['json', 'xml', 'html', 'yaml', 'yml', 'ndjson', 'jsonl', 'csv', 'tsv', 'css']);
  assert.deepEqual(new api.StreamNormalizer({ format: api.Format.JSON }).write('{"name":"Al').data, { name: 'Al' });
  assert.equal(new api.StreamNormalizer({ format: api.Format.CSS }).end().format, 'css');
});

test('a strategy instance produces partial and complete typed snapshots in independent sessions', async () => {
  const strategy = new TextStrategy();
  const left = new api.StreamNormalizer({ format: strategy, maxDepth: 12 });
  const right = new api.StreamNormalizer({ format: strategy });
  const first = left.write('Al');
  assert.equal(first.format, 'plain-message');
  assert.deepEqual(first.data, { text: 'Al' });
  assert.equal(first.status['/text'], 'partial');
  right.write('Other');
  left.write('ice');
  assert.deepEqual(left.end().data, { text: 'Alice' });
  assert.equal(left.snapshot().status['/text'], 'complete');
  assert.deepEqual(right.end().data, { text: 'Other' });
  assert.deepEqual(first.data, { text: 'Al' });
  assert.equal(strategy.sessions[0].maxDepth, 12);
  const streamed = [];
  for await (const item of api.streamStructured(['h', 'i'], { format: strategy })) streamed.push(item);
  assert.deepEqual(streamed.map(item => item.data), [{ text: 'h' }, { text: 'hi' }, { text: 'hi' }]);
  assert.equal(streamed.at(-1)?.state, 'complete');
});

test('custom strategies support replayable patch batches and reused mutable parser results', () => {
  const data = { text: '' };
  const strategy: LanguageStrategy<Message> = { format: 'mutable-text', create() {
    return { write(chunk) { data.text += chunk; return { data, status: { '/text': 'partial' } }; },
      end() { return { data, status: { '': 'complete', '/text': 'complete' } }; } };
  } };
  const parser = new api.StreamNormalizer({ format: strategy });
  const state = api.createPatchState<Message>({ format: strategy });
  api.applyPatchBatch(state, parser.writePatch('a'));
  const next = parser.writePatch('b');
  assert.ok(next.patches.some(patch => patch.op === 'append' && patch.path === '/text' && patch.value === 'b'));
  api.applyPatchBatch(state, next);
  api.applyPatchBatch(state, parser.endPatch());
  assert.deepEqual(state.data, { text: 'ab' });
  assert.equal(state.status['/text'], 'complete');
  assert.equal(state.state, 'complete');
});

test('limits and parser failures preserve normalizer error and closed-stream behavior', () => {
  const parser = new api.StreamNormalizer({ format: new TextStrategy(), maxLength: 2 });
  parser.write('ok');
  assert.throws(() => parser.write('x'), /maxLength/);
  assert.equal(parser.snapshot().state, 'error');
  assert.throws(() => parser.end(), /closed/);
  const invalid = new api.StreamNormalizer({ format: new TextStrategy() });
  assert.throws(() => invalid.write('!'), /No exclamations/);
  assert.equal(invalid.patch().state, 'error');
  const empty = new api.StreamNormalizer({ format: new TextStrategy() });
  assert.throws(() => empty.end(), /Empty message/);
  assert.equal(empty.snapshot().state, 'error');
});

test('invalid strategies and malformed completion maps fail with useful errors', () => {
  for (const format of [null, {}, { format: '', create() {} }, { format: 'bad', create: 1 }]) {
    assert.throws(() => new api.StreamNormalizer({ format: format as never }), /format|strategy/i);
  }
  assert.throws(() => new api.StreamNormalizer({ format: { format: 'bad', create() { return {} as LanguageParser; } } }), /parser/i);
  for (const status of [{ bad: 'partial' }, { '/x~3': 'complete' }, { '/text': 'unknown' }]) {
    const parser = new api.StreamNormalizer({ format: { format: 'bad', create() {
      return { write() { return { data: {}, status } as unknown as LanguageUpdate; }, end() { throw new Error('unused'); } };
    } } });
    assert.throws(() => parser.write('a'), /completion|pointer/i);
    assert.equal(parser.snapshot().state, 'error');
  }
});

test('custom strategies reject data that cannot round-trip through JSON tree patches', () => {
  for (const data of [{ x: undefined }, Array(2), new Date(), new Map(), { value: Infinity }, { value: 1n }, { get text() { return 'hidden getter'; } }]) {
    const strategy: LanguageStrategy = { format: 'invalid-tree', create() {
      return { write: () => ({ data, status: {} }), end: () => ({ data, status: {} }) };
    } };
    const parser = new api.StreamNormalizer({ format: strategy });
    assert.throws(() => parser.write('a'), /plain|JSON|sparse|finite|data/i);
    assert.equal(parser.snapshot().state, 'error');
    assert.equal(parser.snapshot().data, undefined);
  }
  const shared = { text: 'a' };
  const aliases = new api.StreamNormalizer({ format: { format: 'shared', create() {
    return { write: () => ({ data: { a: shared, b: shared }, status: {} }), end: () => ({ data: {}, status: {} }) };
  } } });
  assert.throws(() => aliases.write('a'), /shared/);
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  const parser = new api.StreamNormalizer({ format: { format: 'cycle', create() {
    return { write: () => ({ data: cyclic, status: {} }), end: () => ({ data: cyclic, status: {} }) };
  } } });
  assert.throws(() => parser.write('a'), /cyclic/i);
});

test('custom output trees obey maxDepth before their data is committed', () => {
  const parser = new api.StreamNormalizer({ maxDepth: 1, format: { format: 'nested', create() {
    return { write: () => ({ data: { nested: {} }, status: {} }), end: () => ({ data: {}, status: {} }) };
  } } });
  assert.throws(() => parser.write('a'), /maxDepth/);
  assert.equal(parser.snapshot().data, undefined);
});
