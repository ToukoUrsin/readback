import { expect, test } from 'bun:test';
import type { Tour } from '../shared/tour';
import { createApp, createShown, type Deps } from './app';
import { createStore, type Store } from './store';

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

function reader(store?: Store, test = false, more: Partial<Deps> = {}) {
  const app = createApp({ tour, store, order: (n) => Array.from({ length: n }, (_, i) => i), ...more });
  const jar = new Map<string, string>(test ? [['rb_test', '1']] : []);
  const call = async (path: string, body?: unknown) => {
    const r = await app.request(path, { method: body === undefined ? 'GET' : 'POST', headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie()) {
      const [k, v] = c.split(';')[0]!.split('=');
      jar.set(k!, v!);
    }
    return { status: r.status, json: (await r.json()) as any };
  };
  return Object.assign(call, { jar });
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

test('every hand-in is counted, and our own test reads are left out', async () => {
  const store = createStore(null);
  const read = async (lines: number[], test = false) => {
    const call = reader(store, test);
    await call('/api/start', {});
    await call('/api/answer', { id: 'q1', choice: 0 });
    await call('/api/answer', { id: 'q1', choice: 1 });
    for (const line of lines) {
      await call('/api/flag', { file: 'a.ts', line, note: '' });
      const { json } = await call('/api/handin', {});
      if (json.ok) await call('/api/sign', { name: 'A Reader' });
    }
    return call;
  };
  await read([2]); // caught on the first read
  await read([1, 3]); // missed, then caught the second plant
  await read([1]); // missed and left
  await read([2], true); // ours
  const call = await read([]); // started, never handed in
  const { json } = await call('/api/stats');
  expect(json.all).toMatchObject({ started: 4, reads: 3, caughtFirstRead: 1, missedFirstRead: 2, caughtLater: 1, signed: 2, handIns: 4, medianWrongAnswers: 1 });
  expect(json.testReadersLeftOut).toBe(1);
  expect(JSON.stringify(json)).not.toContain('A Reader');
});

test('a planted line the reader has been shown is never planted for them again; when none is left the read fails', async () => {
  const store = createStore(null);
  const call = reader(store);
  await call('/api/start', {});
  await call('/api/answer', { id: 'q1', choice: 1 });
  const seen: number[] = [];
  for (let i = 0; i < 2; i++) {
    await call('/api/flag', { file: 'a.ts', line: 1, note: '' });
    const { json } = await call('/api/handin', {});
    expect(json.ok).toBe(false);
    seen.push(json.tour.state.missed.at(-1).line);
  }
  expect(seen).toEqual([2, 3]); // both plants shown, each once
  const { json } = await call('/api/tour');
  expect(json.state.exhausted).toBe(true);
  expect(text(json)).toBe('one two three'); // nothing is planted any more
  // flagging the lines they were shown does not get a signature
  await call('/api/flag', { file: 'a.ts', line: 2, note: '' });
  await call('/api/flag', { file: 'a.ts', line: 3, note: '' });
  const again = await call('/api/handin', {});
  expect(again.status).toBe(400);
  expect(again.json.error).toContain('Someone else');
  expect((await call('/api/sign', { name: 'N' })).status).toBe(400);
  expect((await call('/api/stats')).json.all.failed).toBe(1);
});

test('a line shown in one read is not planted in another read of the same person', async () => {
  const shown = createShown();
  const short = reader(undefined, false, { shown, cookie: 'rb_short', key: 'short' });
  await short('/api/start', {});
  await short('/api/answer', { id: 'q1', choice: 1 });
  await short('/api/flag', { file: 'a.ts', line: 1, note: '' });
  expect((await short('/api/handin', {})).json.ok).toBe(false); // shown line 2
  const full = reader(undefined, false, { shown });
  full.jar.set('rb_who', short.jar.get('rb_who')!);
  expect(text((await full('/api/tour')).json)).toBe('one two THREE');
  const other = reader(undefined, false, { shown }); // another person still gets the first plant
  expect(text((await other('/api/tour')).json)).toBe('one TWO three');
});

const coldTour: Tour = { ...tour, cold: { blocks: [tour.stops[0]!.blocks[0] as any], plants: ['p1'] } };

test('the cold test: approving the planted line is recorded, and the read after it has a different line', async () => {
  const store = createStore(null);
  const call = reader(store, false, { tour: coldTour });
  const first = (await call('/api/tour')).json;
  expect(first.stops).toEqual([]); // only the plain diff until it is decided
  expect(first.cold.blocks[0].lines.map((l: any) => l.tokens[0][0]).join(' ')).toBe('one TWO three');
  expect(JSON.stringify(first)).not.toContain('w1');
  expect((await call('/api/handin', {})).status).toBe(400);
  expect((await call('/api/cold', { action: 'flag', file: 'a.ts', line: 9 })).status).toBe(400);
  const done = (await call('/api/cold', { action: 'approve' })).json;
  expect(done.cold).toBeUndefined();
  expect(done.state.cold).toMatchObject({ action: 'approve', caught: false });
  expect(done.state.cold.reveal.line).toBe(2);
  expect(text(done)).toBe('one two THREE');
  expect((await call('/api/cold', { action: 'approve' })).status).toBe(400); // once

  const b = reader(store, false, { tour: coldTour });
  await b('/api/tour');
  expect((await b('/api/cold', { action: 'flag', file: 'a.ts', line: 2 })).json.state.cold.caught).toBe(true);
  const c = reader(store, false, { tour: coldTour });
  await c('/api/tour');
  expect((await c('/api/cold', { action: 'flag', file: 'a.ts', line: 1 })).json.state.cold.caught).toBe(false);
  const d = reader(store, false, { tour: coldTour });
  await d('/api/tour');
  const skipped = (await d('/api/cold', { action: 'skip' })).json;
  expect(skipped.state.cold.reveal).toBeNull();
  expect(text(skipped)).toBe('one TWO three'); // never shown as planted, so it can be the read's line
  await reader(store, true, { tour: coldTour })('/api/tour'); // ours

  // the first reader goes on and catches the guided one
  await call('/api/start', {});
  await call('/api/answer', { id: 'q1', choice: 1 });
  await call('/api/flag', { file: 'a.ts', line: 3, note: '' });
  expect((await call('/api/handin', {})).json.ok).toBe(true);
  const { json } = await call('/api/stats');
  expect(json.cold).toMatchObject({ shown: 4, approved: 1, flaggedPlanted: 1, flaggedOther: 1, skipped: 1, thenGuided: { reads: 1, caughtFirstRead: 1 } });
});

test('the signature carries how fast the lines went by', async () => {
  const call = reader();
  await call('/api/start', {});
  await call('/api/answer', { id: 'q1', choice: 1 });
  await call('/api/flag', { file: 'a.ts', line: 2, note: '' });
  await call('/api/handin', {});
  const sig = (await call('/api/sign', { name: 'Ada' })).json.signature;
  expect(sig.lines).toBe(3);
  expect(typeof sig.linesPerMinute).toBe('number');
});

test('answering ahead needs the key and a test reader, and such a read claims no pace', async () => {
  const visitor = reader(undefined, false, { prepKey: 'k' });
  expect((await visitor('/api/prep', { key: 'k' })).status).toBe(404);
  const noKey = reader(undefined, true);
  expect((await noKey('/api/prep', { key: '' })).status).toBe(404);
  const call = reader(undefined, true, { prepKey: 'k' });
  expect((await call('/api/prep', { key: 'wrong' })).status).toBe(404);
  const t = (await call('/api/prep', { key: 'k' })).json;
  expect(t.state.answers.q1.right).toBeTruthy();
  expect((await call('/api/handin', {})).status).toBe(400); // the planted line still has to be flagged
});

test('a first visit that starts over is one session, with its cold test recorded as shown', async () => {
  const store = createStore(null);
  const call = reader(store, false, { tour: coldTour });
  const t = (await call('/api/reset', {})).json;
  expect(t.cold.blocks.length).toBe(1);
  await call('/api/cold', { action: 'approve' });
  const cold = store.stats().cold;
  expect(cold.shown).toBe(1);
  expect(cold.approved).toBe(1);
  // the session the page was given is the one the next call reaches
  expect((await call('/api/tour')).json.state.cold.action).toBe('approve');
});

test('goes marked as ours afterwards are left out, and the rows stay', async () => {
  const store = createStore(null);
  const call = reader(store);
  await call('/api/start', {});
  expect(store.stats().all.started).toBe(1);
  const seen: string[] = [];
  const record = store.record.bind(store);
  store.record = (e) => (seen.push(e.rid), record(e));
  await call('/api/seen', { stop: 's1' });
  store.record({ type: 'mark', at: new Date().toISOString(), rid: seen[0]!, tour: 'full', headSha: '', test: true, why: 'ours' });
  expect(store.stats().all.started).toBe(0);
  expect(store.stats().testReadersLeftOut).toBe(1);
});
