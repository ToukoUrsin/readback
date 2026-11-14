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
  const app = createApp({ tour, store, order: (n) => Array.from({ length: n }, (_, i) => i), lockSeconds: 0, ...more });
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
  await call('/api/flag', { file: 'a.ts', line: 1, note: 'this line does the wrong thing' });
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
  await call('/api/flag', { file: 'a.ts', line: 2, note: 'this line does the wrong thing' });
  await call('/api/flag', { file: 'a.ts', line: 1, note: 'why is this here at all' });
  const hit = await call('/api/handin', {});
  expect(hit.json.ok).toBe(true);
  expect(text(hit.json.tour)).toBe('one two three');
  expect((await call('/api/sign', { name: ' ' })).status).toBe(400);
  const sig = (await call('/api/sign', { name: 'Ada' })).json.signature;
  expect(sig.name).toBe('Ada');
  expect(sig.reads).toBe(1);
  expect(sig.flagsForAuthor).toEqual([{ file: 'a.ts', line: 1, note: 'why is this here at all' }]);
});

test('a line that is not on the tour cannot be flagged', async () => {
  const call = reader();
  await call('/api/tour');
  expect((await call('/api/flag', { file: 'a.ts', line: 9, note: 'this line does the wrong thing' })).status).toBe(400);
  expect((await call('/api/flag', { file: 'b.ts', line: 1, note: 'this line does the wrong thing' })).status).toBe(400);
});

test('every hand-in is counted, and our own test reads are left out', async () => {
  const store = createStore(null);
  const read = async (lines: number[], test = false) => {
    const call = reader(store, test);
    await call('/api/start', {});
    await call('/api/answer', { id: 'q1', choice: 0 });
    await call('/api/answer', { id: 'q1', choice: 1 });
    for (const line of lines) {
      await call('/api/flag', { file: 'a.ts', line, note: 'this line does the wrong thing' });
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
    await call('/api/flag', { file: 'a.ts', line: 1, note: 'this line does the wrong thing' });
    const { json } = await call('/api/handin', {});
    expect(json.ok).toBe(false);
    seen.push(json.tour.state.missed.at(-1).line);
  }
  expect(seen).toEqual([2, 3]); // both plants shown, each once
  const { json } = await call('/api/tour');
  expect(json.state.exhausted).toBe(true);
  expect(text(json)).toBe('one two three'); // nothing is planted any more
  // flagging the lines they were shown does not get a signature
  await call('/api/flag', { file: 'a.ts', line: 2, note: 'this line does the wrong thing' });
  await call('/api/flag', { file: 'a.ts', line: 3, note: 'this line does the wrong thing' });
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
  await short('/api/flag', { file: 'a.ts', line: 1, note: 'this line does the wrong thing' });
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
  await call('/api/flag', { file: 'a.ts', line: 3, note: 'this line does the wrong thing' });
  expect((await call('/api/handin', {})).json.ok).toBe(true);
  const { json } = await call('/api/stats');
  expect(json.cold).toMatchObject({ shown: 4, approved: 1, flaggedPlanted: 1, flaggedOther: 1, skipped: 1, thenGuided: { reads: 1, caughtFirstRead: 1 } });
});

test('the signature carries how fast the lines went by', async () => {
  const call = reader();
  await call('/api/start', {});
  await call('/api/answer', { id: 'q1', choice: 1 });
  await call('/api/flag', { file: 'a.ts', line: 2, note: 'this line does the wrong thing' });
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

/* ---------- the rule the commit status follows ---------- */

import type { Evidence } from '../shared/tour';
import { gate, outcomeOf, statusFor } from './gate';

const ok = { login: 'ada', test: false, prepared: false, questions: 12, wrong: 1, reads: 1, linesPerMinute: 10, fastAt: 15, skimmed: 0, rulings: { total: 2, open: 0, back: 0 } };

test('the gate: every check has to hold, and a typed name never approves', () => {
  expect(outcomeOf(gate(ok), 0)).toBe('approved');
  expect(outcomeOf(gate({ ...ok, login: undefined }), 0)).toBe('not-counted');
  expect(outcomeOf(gate({ ...ok, login: undefined, test: true }), 0)).toBe('approved');
  expect(outcomeOf(gate({ ...ok, wrong: 4 }), 0)).toBe('not-counted');
  expect(outcomeOf(gate({ ...ok, reads: 3 }), 0)).toBe('not-counted');
  expect(outcomeOf(gate({ ...ok, linesPerMinute: 156 }), 0)).toBe('not-counted');
  expect(outcomeOf(gate({ ...ok, skimmed: 2 }), 0)).toBe('not-counted');
  expect(outcomeOf(gate({ ...ok, prepared: true }), 0)).toBe('not-counted'); // prepared reads are for our own recordings only
  // a review that counts can send the change back; one that does not count cannot
  expect(outcomeOf(gate({ ...ok, rulings: { total: 2, open: 0, back: 1 } }), 1)).toBe('sent-back');
  expect(outcomeOf(gate({ ...ok, wrong: 9, rulings: { total: 2, open: 0, back: 1 } }), 1)).toBe('not-counted');
  expect(statusFor({ outcome: 'not-counted', who: '@ada', questions: 12, wrong: 9, reads: 1, back: 0 })).toBeNull();
  expect(statusFor({ outcome: 'sent-back', who: '@ada', questions: 12, wrong: 0, reads: 1, back: 1 })!.state).toBe('failure');
  expect(statusFor({ outcome: 'approved', who: '@ada', questions: 12, wrong: 1, reads: 1, linesPerMinute: 30, back: 0 })!.description).toContain('@ada');
});

const evidence: Evidence = {
  schema: 1,
  headSha: tour.pr.headSha,
  criteria: [{ n: 1, text: 'c1' }],
  tests: { passed: 3, failed: 0, at: 'now' },
  stops: { s1: { criteria: [1], tests: ['t1'], changes: { tried: 3, caught: 2, survived: [1, 2, 3].map((n) => ({ file: 'a.ts', line: n, original: 'x', changed: 'X', effect: 'e' })) }, risk: ['access'], riskWhy: 'r', route: 'read', routeWhy: ['x'] } },
  rulings: [{ id: 'r1', kind: 'unasked', stopId: 's1', file: 'a.ts', from: 1, to: 1, found: 'f', question: 'q?' }],
  madeBy: { model: 'm', costUsd: 0, at: 'now' },
};

async function toHandIn(call: ReturnType<typeof reader>, note = 'the value is upper case now') {
  await call('/api/tour');
  await call('/api/start', {});
  await call('/api/seen', { stop: 's1' });
  await call('/api/answer', { id: 'q1', choice: 1 });
  await call('/api/flag', { file: 'a.ts', line: 2, note });
}

test('a flag needs a reason, and the reason on the planted line is checked', async () => {
  const seen: string[] = [];
  const call = reader(undefined, false, { grade: async ({ note }) => (seen.push(note), note.includes('upper')) });
  await toHandIn(call, 'short');
  expect((await call('/api/handin', {})).status).toBe(400); // no reason
  await call('/api/flag', { file: 'a.ts', line: 2, note: 'this looks different from the diff' });
  const miss = await call('/api/handin', {});
  expect(miss.json.ok).toBe(false); // the right line, without knowing why
  expect(miss.json.tour.state.missed[0].noteFailed).toBe('this looks different from the diff');
  expect(miss.json.tour.state.read).toBe(2);
  await call('/api/flag', { file: 'a.ts', line: 3, note: 'the value is upper case now' });
  expect((await call('/api/handin', {})).json.ok).toBe(true);
  expect(seen.length).toBe(2);
});

test('a wrong answer closes the question, a fourth flag is refused, an answer that does not exist is an error', async () => {
  const call = reader(undefined, false, { lockSeconds: 20 });
  await call('/api/tour');
  expect((await call('/api/answer', { id: 'q1', choice: 7 })).status).toBe(400);
  const wrong = await call('/api/answer', { id: 'q1', choice: 0 });
  expect(wrong.json.answer.lockedUntil).toBeString();
  const again = await call('/api/answer', { id: 'q1', choice: 1 });
  expect(again.status).toBe(429);
  expect(again.json.answer.right).toBeUndefined();
  for (const line of [1, 2, 3]) expect((await call('/api/flag', { file: 'a.ts', line, note: 'n' })).status).toBe(200);
  const b = reader();
  await b('/api/tour');
  const tour4 = { ...tour, stops: [{ ...tour.stops[0]!, blocks: [{ ...(tour.stops[0]!.blocks[0] as any), to: 4, lines: [line(1, 'one'), line(2, 'two'), line(3, 'three'), line(4, 'four')] }] }] };
  const app = createApp({ tour: tour4 as Tour });
  let cookie = '';
  const post = async (body: unknown) => {
    const r = await app.request('/api/flag', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    cookie = cookie || r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    return r.status;
  };
  expect([await post({ file: 'a.ts', line: 1, note: '' }), await post({ file: 'a.ts', line: 2, note: '' }), await post({ file: 'a.ts', line: 3, note: '' }), await post({ file: 'a.ts', line: 4, note: '' })]).toEqual([200, 200, 200, 400]);
});

test('a visitor who types a name signs a record that does not approve; a signed-in reviewer has one review and it can approve or send back', async () => {
  const statuses: any[] = [];
  const store = createStore(null);
  let t = Date.now();
  const deps: Partial<Deps> = { now: () => t, evidence, setStatus: async (s) => void statuses.push(s), me: (c) => (c.req.header('x-login') ? { login: c.req.header('x-login')! } : null), signIn: true };
  // a visitor
  const v = reader(store, false, deps);
  await toHandIn(v);
  expect((await v('/api/handin', {})).status).toBe(400); // the open point is not ruled on
  expect((await v('/api/rule', { id: 'r1', decision: 'back', note: '' })).status).toBe(400); // sending back needs a reason
  await v('/api/rule', { id: 'r1', decision: 'accept' });
  const vt = (await v('/api/handin', {})).json.tour;
  expect(vt.state.checks.find((c: any) => c.id === 'who').ok).toBe(false);
  const vs = (await v('/api/sign', { name: 'Linus Torvalds' })).json.signature;
  expect(vs.outcome).toBe('not-counted');
  expect(statuses).toEqual([]);

  // signed in: the same person from two browsers is one review
  const app = createApp({ tour, store, order: (n) => Array.from({ length: n }, (_, i) => i), lockSeconds: 0, ...deps });
  const as = (login: string) => async (path: string, body?: unknown) => {
    const r = await app.request(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'x-login': login, 'user-agent': 'Mozilla/5.0', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: (await r.json()) as any };
  };
  const ada = as('ada');
  expect((await ada('/api/tour')).json.me.login).toBe('ada');
  await ada('/api/start', {});
  await ada('/api/seen', { stop: 's1' });
  expect((await ada('/api/answer', { id: 'q1', choice: 0 })).json.answer.misses).toBe(1);
  expect((await as('ADA')('/api/tour')).json.state.answers.q1.misses).toBe(1); // another browser, the same review
  expect((await ada('/api/reset', {})).status).toBe(403); // no fresh start
  await ada('/api/answer', { id: 'q1', choice: 1 });
  await ada('/api/rule', { id: 'r1', decision: 'accept' });
  await ada('/api/flag', { file: 'a.ts', line: 2, note: 'the value is upper case now' });
  t += 60_000; // three lines in a minute
  expect((await ada('/api/handin', {})).json.ok).toBe(true);
  const sig = (await ada('/api/sign', {})).json.signature;
  expect(sig.login).toBe('ada');
  expect(sig.checks.map((c: any) => [c.id, c.ok])).toEqual([['who', true], ['questions', true], ['planted', true], ['pace', true], ['rulings', true]]);
  expect(sig.outcome).toBe('approved');
  expect(statuses.at(-1).state).toBe('success');
  expect(statuses.at(-1).description).toContain('@ada');
  expect((await v('/api/tour')).json.commit.approvedBy.who).toBe('@ada');

  // another signed-in reviewer sends it back
  const bob = as('bob');
  await bob('/api/tour');
  await bob('/api/start', {});
  await bob('/api/seen', { stop: 's1' });
  await bob('/api/answer', { id: 'q1', choice: 1 });
  await bob('/api/rule', { id: 'r1', decision: 'back', note: 'nobody asked for this code' });
  await bob('/api/flag', { file: 'a.ts', line: 2, note: 'the value is upper case now' });
  t += 60_000;
  await bob('/api/handin', {});
  expect((await bob('/api/sign', {})).json.signature.outcome).toBe('sent-back');
  expect(statuses.at(-1).state).toBe('failure');
  // counted: three signatures, one of each kind, and the visitor is a person
  const st = store.stats();
  expect([st.all.approved, st.all.sentBack, st.all.notCounted]).toEqual([1, 1, 1]);
});

test('a stop the evidence carries asks nothing and never holds the planted line', async () => {
  const two: Tour = { ...tour, stops: [tour.stops[0]!, { id: 's2', title: 'S2', why: 'w', blocks: [{ type: 'code', file: 'b.ts', from: 1, to: 2, lines: [line(1, 'uno'), line(2, 'dos')] }], questions: [{ id: 'q2', prompt: 'p', options: ['x', 'y'], answer: 0, explain: 'e', reread: { file: 'b.ts', from: 1, to: 1 } }] }], plants: [{ id: 'p0', file: 'b.ts', line: 1, original: 'uno', planted: 'UNO', what: 'w0', failedTests: ['t0'], tokens: [['UNO', '']], originalTokens: [['uno', '']] }, ...tour.plants] };
  const ev: Evidence = { ...evidence, rulings: [], stops: { ...evidence.stops, s2: { criteria: [1], tests: ['t0'], changes: { tried: 2, caught: 2, survived: [] }, risk: [], riskWhy: '', route: 'evidence', routeWhy: ['2 of 2 changes made a test fail'] } } };
  const app = createApp({ tour: two, evidence: ev, order: (n) => Array.from({ length: n }, (_, i) => i), lockSeconds: 0 });
  let cookie = '';
  const call = async (path: string, body?: unknown) => {
    const r = await app.request(path, { method: body === undefined ? 'GET' : 'POST', headers: { cookie, 'user-agent': 'Mozilla/5.0', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    cookie = cookie || r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    return (await r.json()) as any;
  };
  const t = await call('/api/tour');
  expect(t.stops.map((s: any) => [s.required, s.questions.length])).toEqual([[true, 1], [false, 0]]);
  expect(t.stops[1].blocks[0].lines[0].tokens[0][0]).toBe('uno'); // p0 is first in order, and is not planted
  expect(t.lines).toEqual({ required: 3, all: 5 }); // the three lines where a tried bug went unnoticed
  await call('/api/start', {});
  await call('/api/answer', { id: 'q1', choice: 1 });
  await call('/api/flag', { file: 'a.ts', line: 2, note: 'the value is upper case now' });
  expect((await call('/api/handin', {})).ok).toBe(true); // q2 was never asked
});
