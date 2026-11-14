import { expect, test } from 'bun:test';
import type { Tour } from '../shared/tour';
import { createApp } from './app';

const line = (n: number, text: string) => ({ n, kind: 'add' as const, tokens: [[text, '']] as [string, string][] });
const tour: Tour = {
  schema: 1,
  pr: { repo: 'o/r', number: 1, title: 't', url: 'u', author: 'a', authorIsAgent: true, baseSha: 'b', headSha: 'h'.repeat(40), additions: 3, deletions: 0, files: 1 },
  intro: 'i',
  stops: [
    { id: 's1', title: 'S1', why: 'w', blocks: [{ type: 'code', file: 'a.ts', from: 1, to: 3, lines: [line(1, 'one'), line(2, 'two'), line(3, 'three')] }], questions: [{ id: 'q1', prompt: 'p', options: ['x', 'y'], answer: 1, explain: 'e', reread: { file: 'a.ts', from: 1, to: 1 } }] },
  ],
  plants: [
    { id: 'p1', file: 'a.ts', line: 2, original: 'two', planted: 'TWO', what: 'w1', failedTests: ['t1'], tokens: [['TWO', '']], originalTokens: [['two', '']] },
    { id: 'p2', file: 'a.ts', line: 3, original: 'three', planted: 'THREE', what: 'w2', failedTests: ['t2'], tokens: [['THREE', '']], originalTokens: [['three', '']] },
  ],
  coverage: { changed: 3, onTour: 3, files: [{ file: 'a.ts', changed: 3, onTour: 3 }] },
  madeBy: { model: 'm', costUsd: 0, at: 'now' },
};

function reader() {
  const app = createApp({ tour, order: (n) => Array.from({ length: n }, (_, i) => i) });
  let cookie = '';
  const call = async (path: string, body?: unknown) => {
    const r = await app.request(path, { method: body === undefined ? 'GET' : 'POST', headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0]!;
    return { status: r.status, json: (await r.json()) as any };
  };
  return call;
}
const text = (t: any) => t.stops[0].blocks[0].lines.map((l: any) => l.tokens[0][0]).join(' ');

test('the reader sees the planted line and never the answer key', async () => {
  const call = reader();
  const { json } = await call('/api/tour');
  expect(text(json)).toBe('one TWO three');
  expect(JSON.stringify(json)).not.toContain('"answer"');
  expect(JSON.stringify(json)).not.toContain('w1');
});

test('a read without the planted line among the flags is not approved, and the next read has another line', async () => {
  const call = reader();
  await call('/api/tour');
  expect((await call('/api/handin', {})).status).toBe(400); // question open
  expect((await call('/api/answer', { id: 'q1', choice: 0 })).json.answer.misses).toBe(1);
  expect((await call('/api/answer', { id: 'q1', choice: 1 })).json.answer.right.explain).toBe('e');
  expect((await call('/api/handin', {})).status).toBe(400); // nothing flagged
  await call('/api/flag', { file: 'a.ts', line: 1, note: '' });
  const miss = await call('/api/handin', {});
  expect(miss.json.ok).toBe(false);
  expect(miss.json.tour.state.read).toBe(2);
  expect(miss.json.tour.state.missed[0].line).toBe(2);
  expect(miss.json.tour.state.flags).toEqual([]);
  expect(text(miss.json.tour)).toBe('one two THREE');
  expect((await call('/api/sign', { name: 'N' })).status).toBe(400);
});

test('catching it shows the real branch and lets a named person sign', async () => {
  const call = reader();
  await call('/api/start', {});
  await call('/api/answer', { id: 'q1', choice: 1 });
  await call('/api/flag', { file: 'a.ts', line: 2, note: '' });
  await call('/api/flag', { file: 'a.ts', line: 1, note: 'why' });
  const hit = await call('/api/handin', {});
  expect(hit.json.ok).toBe(true);
  expect(text(hit.json.tour)).toBe('one two three');
  expect((await call('/api/sign', { name: ' ' })).status).toBe(400);
  const sig = (await call('/api/sign', { name: 'Ada' })).json.signature;
  expect(sig.name).toBe('Ada');
  expect(sig.reads).toBe(1);
  expect(sig.flagsForAuthor).toEqual([{ file: 'a.ts', line: 1, note: 'why' }]);
});

test('a line that is not on the tour cannot be flagged', async () => {
  const call = reader();
  await call('/api/tour');
  expect((await call('/api/flag', { file: 'a.ts', line: 9, note: '' })).status).toBe(400);
  expect((await call('/api/flag', { file: 'b.ts', line: 1, note: '' })).status).toBe(400);
});
