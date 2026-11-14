/**
 * One reader, one read. The browser never gets an answer key or the place of a planted line:
 * both are checked here. A line the reader has been shown as planted is never planted for them again.
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { Block, ColdResult, CommitState, Evidence, Flag, GateCheck, PublicTour, ReaderState, Reveal, Ruling, Signature, Tour, TourPlant } from '../shared/tour';
import { ask, type AskDeps } from './ask';
import type { Me } from './auth';
import { closeLines } from './close';
import { gate, outcomeOf, RULE, statusFor } from './gate';
import type { Grade } from './grade';
import type { ReadEvent, Store } from './store';

export const MAX_FLAGS = 3;
/** a flag needs this many characters of reason before the review can be handed in */
export const MIN_NOTE = 8;

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
/** a reader meets these first */
const KIND_RANK: Record<string, number> = { access: 0, money: 1, data: 2, logic: 3, format: 5 };

export interface Deps {
  tour: Tour;
  distDir?: string;
  /** writes the signature to GitHub as a commit status; absent on the public demo */
  setStatus?: (s: { repo: string; sha: string; description: string; targetUrl: string; state?: 'success' | 'pending' | 'failure' }) => Promise<void>;
  publicUrl?: string;
  ask?: AskDeps;
  /** called with every signature */
  onSign?: (s: Signature) => void;
  /** plant order for a new reader; the default is by kind (access and money first), random within a kind */
  order?: (n: number) => number[];
  /** which read this is, in the records: 'full' or 'short' */
  key?: string;
  /** cookie name; two tours on one host need two */
  cookie?: string;
  /** keeps what readers did, and the open reads */
  store?: Store;
  other?: PublicTour['other'];
  /** a watcher outside this server turns signatures into the GitHub status (deploy/watch-github.ts) */
  githubSoon?: boolean;
  /** with this key a test reader can have the questions answered ahead, for a recording (POST /api/prep) */
  prepKey?: string;
  /** planted lines each person has been shown, shared by every read on this host: a line shown in the short read is not planted again in the full one */
  shown?: Shown;
  /** the change's own evidence (gen/evidence.ts): what the tests carry, what a person has to read, what the AI does not decide */
  evidence?: Evidence;
  /** checks the reviewer's note on the planted line; without it a note is only required, not checked */
  grade?: Grade;
  /** the signed-in reviewer of a request (server/auth.ts) */
  me?: (c: Context) => Me | null;
  /** GitHub sign-in is set up */
  signIn?: boolean;
  /** GitHub logins (lower case) whose review can approve; without it any GitHub account can */
  reviewers?: string[];
  /** seconds a question stays closed after a wrong try; the default is the rule's */
  lockSeconds?: number;
  /** the clock, in milliseconds; tests move it */
  now?: () => number;
}

export interface Shown {
  has(who: string, line: string): boolean;
  add(who: string, line: string): void;
  /** a visitor who signs in keeps what they were shown before */
  copy(from: string, to: string): void;
}

/** who has been shown which planted line, kept in the store when there is one */
export function createShown(store?: Store): Shown {
  const m = new Map<string, string[]>(store?.load<[string, string[]][]>('shown') ?? []);
  return {
    has: (who, line) => !!m.get(who)?.includes(line),
    add(who, line) {
      const a = m.get(who) ?? [];
      if (!a.includes(line)) a.push(line);
      m.set(who, a);
      if (m.size > 20000) m.delete(m.keys().next().value!);
      store?.save('shown', () => [...m]);
    },
    copy(from, to) {
      for (const l of m.get(from) ?? []) this.add(to, l);
    },
  };
}

interface Session extends ReaderState {
  order: number[];
  asked: number;
  /** names this go in the records; not the cookie */
  rid: string;
  test: boolean;
  /** the person, across reads on this host (cookie rb_who) */
  who: string;
  /** ids of planted lines this reader has been shown as planted */
  shown: string[];
  /** the planted line of the cold test, while it is open */
  coldPlant: string | null;
  coldShownAt: string | null;
  cold: ColdResult | null;
  /** an agent of ours looking at the page (its browser names itself rb-agent): it sees what a visitor sees, and is left out of every count */
  ours?: boolean;
  /** questions were answered ahead for a recording (POST /api/prep): no pace is claimed for this read */
  prepared?: boolean;
  /** GitHub login of a signed-in reviewer: their one review of this commit, whatever browser they come from */
  login?: string;
  /** set when the login was proven with a gist instead of GitHub's sign-in page */
  via?: 'gist';
  /** seconds each stop has been open */
  dwell?: Record<string, number>;
  /** the stop that is open now */
  at?: { stop: string; since: number } | null;
  /** seconds from the start to the hand-in that caught the planted bug */
  caughtSeconds?: number;
  /** the note on the planted line was checked by the model (true), or only required (null) */
  noteChecked?: boolean | null;
  /** a hand-in is being checked */
  busy?: boolean;
}

const shuffle = (n: number) => {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};

export function createApp(d: Deps) {
  const { tour } = d;
  const key = d.key ?? 'full';
  const cookie = d.cookie ?? 'rb';
  const stamp = `${tour.pr.headSha}:${tour.madeBy.at}:${tour.plants.map((p) => p.id).join(',')}`;
  const saved = d.store?.load<{ stamp: string; sessions: [string, Session][] }>(`sessions-${key}`);
  const sessions = new Map<string, Session>(saved?.stamp === stamp ? saved.sessions : []);
  const keep = () => d.store?.save(`sessions-${key}`, () => ({ stamp, sessions: [...sessions] }));
  const ev = d.evidence && d.evidence.headSha === tour.pr.headSha ? d.evidence : undefined;
  const rulingItems = (ev?.rulings ?? []).filter((r) => tour.stops.some((s) => s.id === r.stopId));
  const linesOf = (s: { blocks: Block[] }) => s.blocks.reduce((b, x) => b + (x.type === 'code' ? x.to - x.from + 1 : 0), 0);
  const close = closeLines(tour, ev);
  /** a stop with nothing to read closely is carried by its evidence: it asks nothing and holds no planted line */
  const required = (stopId: string) => (close.get(stopId)?.size ?? 0) > 0;
  const mustRead = tour.stops.filter((s) => required(s.id));
  const questions = new Map(mustRead.flatMap((s) => s.questions.map((q) => [q.id, q] as const)));
  const allLines = tour.stops.reduce((a, s) => a + linesOf(s), 0);
  /** the lines a person has to read closely: pace is counted over these */
  const lines = mustRead.reduce((a, s) => a + close.get(s.id)!.size, 0);
  /** lines a minute from which a read is too fast: a line a second over whole stops, a line in four seconds over lines picked for a close read */
  const fastAt = ev ? RULE.closeLinesPerMinute : RULE.fastLinesPerMinute;
  const lockSeconds = d.lockSeconds ?? RULE.lockSeconds;
  const stopOf = (file: string, line: number) => tour.stops.find((s) => s.blocks.some((b) => b.type === 'code' && b.file === file && b.from <= line && line <= b.to))?.id ?? '';
  /** a line a reviewer can be held to: one they were told to read closely */
  /** lines whose real text the evidence shows beside them (a tried bug the tests did not notice): never planted, the two would not match */
  const quoted = new Set(Object.values(ev?.stops ?? {}).flatMap((x) => x.changes.survived.map((v) => `${v.file}:${v.line}`)));
  const onTour = (file: string, line: number) => !quoted.has(`${file}:${line}`) && !!close.get(stopOf(file, line))?.has(`${file}:${line}`);
  const shownAnywhere = (file: string, line: number) => stopOf(file, line) !== '';
  const inCold = (file: string, line: number) => !!tour.cold?.blocks.some((b) => b.file === file && b.from <= line && line <= b.to);

  const clock = d.now ?? Date.now;
  const seconds = (s: Session) => (s.startedAt ? Math.round((clock() - Date.parse(s.startedAt)) / 1000) : 0);
  const wrong = (s: Session) => Object.values(s.answers).reduce((a, x) => a + x.misses, 0);
  const speed = (secs: number) => (secs > 0 ? Math.round((lines / secs) * 60) : 0);
  /** the person across goes, without their name: readers are counted by this */
  const by = (s: Session) => createHash('sha256').update(s.who).digest('hex').slice(0, 10);
  const record = (s: Session, type: ReadEvent['type'], more: Record<string, unknown> = {}) => d.store?.record({ type, at: new Date().toISOString(), rid: s.rid, tour: key, headSha: tour.pr.headSha, test: s.test, by: by(s), ...(s.ours ? { ours: true } : {}), ...(s.login ? { verified: true } : {}), ...more });

  /** how long a stop was open: counted from one "opened" to the next, a single stay capped at 15 minutes */
  const touch = (s: Session, stop: string | null) => {
    const now = clock();
    s.dwell ??= {};
    if (s.at) s.dwell[s.at.stop] = (s.dwell[s.at.stop] ?? 0) + Math.min(now - s.at.since, 15 * 60_000) / 1000;
    s.at = stop ? { stop, since: now } : null;
  };
  /** stops to read that were open for less time than it takes to scroll them: 4 lines a second, at most a minute */
  const skimmed = (s: Session) => mustRead.filter((st) => (s.dwell?.[st.id] ?? 0) < Math.min(60, linesOf(st) / 4)).length;
  const isFast = (lpm: number) => lpm >= fastAt;
  const ruled = (s: Session) => {
    const r = s.rulings ?? {};
    return { total: rulingItems.length, open: rulingItems.filter((x) => !r[x.id]).length, back: rulingItems.filter((x) => r[x.id]?.decision === 'back').length };
  };
  const checksOf = (s: Session): GateCheck[] =>
    gate({ login: s.login, via: s.via, ...(d.reviewers && s.login ? { listed: d.reviewers.includes(s.login.toLowerCase()) } : {}), test: s.test && !!s.prepared, prepared: !!s.prepared, questions: questions.size, wrong: wrong(s), reads: s.read, linesPerMinute: speed(s.caughtSeconds ?? seconds(s)), fastAt, skimmed: s.prepared ? 0 : skimmed(s), rulings: ruled(s) });
  const whoOf = (sig: Signature) => (sig.login ? `@${sig.login}` : `${sig.name} (test read)`);
  /** what the reviews that counted say about this commit */
  const commit = (): CommitState => {
    const out: CommitState = {};
    for (const s of sessions.values()) {
      const g = s.signature;
      if (!g?.outcome || g.outcome === 'not-counted') continue;
      if (g.outcome === 'approved' && (!out.approvedBy || g.at > out.approvedBy.at)) out.approvedBy = { who: whoOf(g), at: g.at };
      if (g.outcome === 'sent-back' && (!out.sentBackBy || g.at > out.sentBackBy.at)) out.sentBackBy = { who: whoOf(g), at: g.at, points: Object.values(s.rulings ?? {}).filter((r) => r.decision === 'back').length };
    }
    return out;
  };

  const rank = (i: number) => KIND_RANK[tour.plants[i]!.kind ?? ''] ?? 4;
  // our own test reads get the same order every time, so a filmed run does not depend on luck
  const inOrder = (n: number) => Array.from({ length: n }, (_, i) => i).sort((a, b) => rank(a) - rank(b));
  const lineKey = (p: { file: string; line: number }) => `${tour.pr.headSha.slice(0, 12)}:${p.file}:${p.line}`;
  const seenBefore = (s: Session, p: TourPlant) => s.shown.includes(p.id) || !!d.shown?.has(s.who, lineKey(p));
  const markShown = (s: Session, p: TourPlant) => {
    if (!s.shown.includes(p.id)) s.shown.push(p.id);
    d.shown?.add(s.who, lineKey(p));
  };
  const inFocus = (p: TourPlant) => tour.stops.some((st) => st.blocks.some((b) => b.type === 'code' && b.file === p.file && (b.focus ?? []).some((f) => f.from <= p.line && p.line <= f.to)));

  const byKind = (n: number) => shuffle(n).sort((a, b) => (KIND_RANK[tour.plants[a]!.kind ?? ''] ?? 4) - (KIND_RANK[tour.plants[b]!.kind ?? ''] ?? 4));

  const fresh = (test: boolean, who: string): Session => {
    const order = (d.order ?? (test ? inOrder : byKind))(tour.plants.length);
    const coldPlant = tour.cold ? (order.map((i) => tour.plants[i]!).find((p) => tour.cold!.plants.includes(p.id) && !d.shown?.has(who, lineKey(p)))?.id ?? null) : null;
    return { rid: randomBytes(6).toString('hex'), test, who, order, asked: 0, read: 1, answers: {}, flags: [], startedAt: null, missed: [], caught: null, signature: null, shown: [], coldPlant, coldShownAt: null, cold: null, rulings: {}, dwell: {}, at: null };
  };

  const coldOpen = (s: Session) => !!tour.cold && !!s.coldPlant && !s.cold;

  /** the planted line of this read: the first in this reader's order they have not been shown. null once caught, or when none is left */
  const plantOf = (s: Session): TourPlant | null => {
    if (s.caught) return null;
    for (const i of s.order) {
      const p = tour.plants[i]!;
      // a planted line of the cold test that is not in a stop cannot be flagged in the read, so it is never the read's line
      if (!seenBefore(s, p) && p.id !== s.coldPlant && onTour(p.file, p.line)) return p;
    }
    return null;
  };
  const exhausted = (s: Session) => !s.caught && tour.plants.some((p) => onTour(p.file, p.line)) && !plantOf(s);

  // in the cold test nothing was said about the line, so its reveal carries no `stated`
  const coldReveal = (p: TourPlant): Reveal => {
    const { stated: _, ...r } = reveal(p);
    return r;
  };
  const reveal = (p: TourPlant): Reveal => ({ file: p.file, line: p.line, stopId: stopOf(p.file, p.line), original: p.originalTokens, planted: p.tokens, what: p.what, failedTests: p.failedTests, ...(p.kind ? { kind: p.kind } : {}), ...(p.headline ? { headline: p.headline } : {}), ...(p.stated ? { stated: p.stated } : {}), ...(p.failures ? { failures: p.failures } : {}) });

  const withPlant = <B extends Block>(blocks: B[], p: TourPlant | null | undefined): B[] =>
    !p ? blocks : blocks.map((b) => (b.type === 'code' && b.file === p.file && b.from <= p.line && p.line <= b.to ? { ...b, lines: b.lines.map((l) => (l.n === p.line ? { ...l, tokens: p.tokens } : l)) } : b));

  const state = (s: Session): ReaderState => ({ read: s.read, answers: s.answers, flags: s.flags, startedAt: s.startedAt, missed: s.missed, caught: s.caught, signature: s.signature, cold: s.cold, exhausted: exhausted(s), rulings: s.rulings ?? {}, ...(s.caught && !tour.short ? { checks: s.signature?.checks ?? checksOf(s) } : {}) });

  /** `real`: the change as the agent wrote it, without this reviewer's planted line (what the guide is given) */
  const view = (s: Session, real = false): PublicTour => {
    const cold = coldOpen(s);
    const p = real ? null : plantOf(s);
    return {
      pr: tour.pr,
      intro: tour.intro,
      // while the cold test is open the reader gets only its lines: two copies of the same code with different planted lines would give both away
      stops: cold ? [] : tour.stops.map((st) => ({ id: st.id, title: st.title, why: st.why, blocks: withPlant(st.blocks, p), questions: required(st.id) ? st.questions.map((q) => ({ id: q.id, prompt: q.prompt, options: q.options })) : [], required: required(st.id), closely: close.get(st.id)!.size, ...(ev?.stops[st.id] ? { evidence: ev.stops[st.id] } : {}) })),
      coverage: tour.coverage,
      madeBy: tour.madeBy,
      maxFlags: MAX_FLAGS,
      state: state(s),
      github: !!d.setStatus,
      ask: !!d.ask,
      ...(tour.short ? { short: tour.short } : {}),
      ...(s.test ? { test: true } : {}),
      ...(d.githubSoon ? { githubSoon: true } : {}),
      ...(cold ? { cold: { blocks: withPlant(tour.cold!.blocks, tour.plants.find((x) => x.id === s.coldPlant)) } } : {}),
      ...(d.other ? { other: d.other } : {}),
      ...(ev ? { evidence: { criteria: ev.criteria, tests: ev.tests, rulings: rulingItems, madeBy: ev.madeBy } } : {}),
      lines: { required: lines, all: allLines },
      rule: { maxWrong: RULE.maxWrong, maxReads: RULE.maxReads, fastLinesPerMinute: fastAt, lockSeconds },
      ...(d.signIn ? { signIn: true } : {}),
      ...(s.login ? { me: { login: s.login } } : {}),
      ...(!tour.short ? { commit: commit() } : {}),
    };
  };

  const app = new Hono<{ Variables: { s: Session; id: string } }>();

  // counts only: no names, no lines. Before the reader check, so asking for it starts no read.
  app.get('/api/stats', (c) => (d.store ? c.json(d.store.stats()) : c.json({ error: 'Nothing is kept on this server.' }, 404)));

  app.use('/api/*', async (c, next) => {
    // our own reads carry the cookie; a client that names itself and is not a browser (curl, a health check) is not a person either
    const ua = c.req.header('user-agent');
    const test = getCookie(c, 'rb_test') === '1' || (!!ua && !ua.includes('Mozilla'));
    let who = getCookie(c, 'rb_who');
    if (!who || !/^[0-9a-f]{16,64}$/.test(who)) {
      who = randomBytes(12).toString('hex');
      setCookie(c, 'rb_who', who, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 60 * 60 * 24 * 30 });
    }
    let id = getCookie(c, cookie);
    const me = d.me?.(c) ?? null;
    if (me) {
      // a signed-in reviewer has one review of this commit, from whatever browser: no second try in a fresh window
      const gid = `gh:${me.login.toLowerCase()}`;
      if (!sessions.has(gid)) {
        d.shown?.copy(who, gid);
        // a visitor who signs in part-way keeps their review, with everything the record already says about it
        const open = id && !id.startsWith('gh:') ? sessions.get(id) : undefined;
        const s = open && !open.signature && !open.login ? open : fresh(test, gid);
        if (s === open) sessions.delete(id!);
        s.login = me.login;
        if (me.via) s.via = me.via;
        s.who = gid;
        sessions.set(gid, s);
        record(s, 'signin', { login: me.login, via: me.via ?? 'oauth', kept: s === open });
        keep();
      }
      id = gid;
    } else if (!id || id.startsWith('gh:') || !sessions.has(id)) {
      id = randomBytes(16).toString('hex');
      sessions.set(id, fresh(test, who));
      setCookie(c, cookie, id, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 60 * 60 * 24 * 7 });
      // signed-in reviews are the record of the commit: they are never dropped to make room
      if (sessions.size > 5000) sessions.delete([...sessions.keys()].find((k) => !k.startsWith('gh:'))!);
    }
    const s = sessions.get(id)!;
    if (test) s.test = true;
    if (ua?.includes('rb-agent')) s.ours = true;
    s.who ??= who;
    s.shown ??= [];
    c.set('s', s);
    c.set('id', id);
    await next();
    if (c.req.method === 'POST') keep();
  });

  /** the cold test goes to the browser now: its clock starts, and the record says it was shown */
  const coldShown = (s: Session, agent: string | undefined) => {
    if (!coldOpen(s) || s.coldShownAt) return;
    s.coldShownAt = new Date().toISOString();
    record(s, 'cold-shown', { plant: s.coldPlant, agent: (agent ?? '').slice(0, 200) });
    keep();
  };

  app.get('/api/tour', (c) => {
    const s = c.get('s');
    coldShown(s, c.req.header('user-agent'));
    return c.json(view(s));
  });

  /** The cold test: approve the plain diff, or ask for changes on one line. Nothing told the reader a line was planted. */
  app.post('/api/cold', async (c) => {
    const s = c.get('s');
    const b = (await c.req.json().catch(() => ({}))) as { action?: string; file?: string; line?: number };
    if (!coldOpen(s)) return c.json({ error: 'There is no open test.' }, 400);
    const p = tour.plants.find((x) => x.id === s.coldPlant)!;
    const secs = s.coldShownAt ? Math.round((Date.now() - Date.parse(s.coldShownAt)) / 1000) : 0;
    if (b.action === 'skip') {
      s.cold = { action: 'skip', caught: false, reveal: null };
      s.coldPlant = null; // never shown, so it may be planted in the read
    } else if (b.action === 'approve') {
      s.cold = { action: 'approve', caught: false, reveal: coldReveal(p) };
    } else if (b.action === 'flag' && typeof b.file === 'string' && typeof b.line === 'number' && inCold(b.file, b.line)) {
      s.cold = { action: 'flag', caught: b.file === p.file && b.line === p.line, flagged: { file: b.file, line: b.line }, reveal: coldReveal(p) };
    } else return c.json({ error: 'Approve, or pick a line.' }, 400);
    if (s.cold.reveal) markShown(s, p);
    record(s, 'cold', { action: s.cold.action, caught: s.cold.caught, plant: `${p.file}:${p.line}`, kind: p.kind ?? '', ...(s.cold.flagged ? { flagged: `${s.cold.flagged.file}:${s.cold.flagged.line}` } : {}), seconds: secs });
    return c.json(view(s));
  });

  app.post('/api/start', (c) => {
    const s = c.get('s');
    if (!s.startedAt) {
      s.startedAt = new Date(clock()).toISOString();
      record(s, 'start', { agent: (c.req.header('user-agent') ?? '').slice(0, 200), afterCold: s.cold?.action ?? '' });
    }
    return c.json(state(s));
  });

  /**
   * For a recording: a test reader who has the key gets the questions answered ahead, all but those of one stop.
   * The planted line still has to be found and flagged, and the record says the read was prepared.
   */
  app.post('/api/prep', async (c) => {
    const s = c.get('s');
    const { key, leave } = (await c.req.json().catch(() => ({}))) as { key?: string; leave?: string };
    if (!d.prepKey || key !== d.prepKey || !s.test) return c.json({ error: 'Not found.' }, 404);
    if (s.signature || s.caught) return c.json(view(s));
    if (!s.startedAt) {
      s.startedAt = new Date(clock()).toISOString();
      record(s, 'start', { agent: (c.req.header('user-agent') ?? '').slice(0, 200), afterCold: s.cold?.action ?? '' });
    }
    let answered = 0;
    for (const st of tour.stops) {
      if (st.id === leave) continue;
      for (const q of st.questions) {
        const a = (s.answers[q.id] ??= { misses: 0 });
        if (!a.right) {
          a.right = { choice: q.answer, explain: q.explain };
          answered++;
        }
      }
    }
    // the open points of the stop that is left are ruled on in front of the camera
    s.rulings ??= {};
    for (const r of rulingItems) if (r.stopId !== leave) s.rulings[r.id] ??= { decision: 'accept', note: '' };
    s.prepared = true;
    record(s, 'prep', { answered, leave: leave ?? '' });
    return c.json(view(s));
  });

  /** which stop the reader opened: time per stop comes from these */
  app.post('/api/seen', async (c) => {
    const s = c.get('s');
    const { stop } = (await c.req.json().catch(() => ({}))) as { stop?: string };
    if (typeof stop === 'string' && (stop === 'handin' || tour.stops.some((x) => x.id === stop))) {
      if (!s.caught) touch(s, stop === 'handin' ? null : stop);
      record(s, 'stop', { stop, read: s.read, seconds: seconds(s) });
    }
    return c.json({ ok: true });
  });

  app.post('/api/answer', async (c) => {
    const s = c.get('s');
    const { id, choice } = (await c.req.json().catch(() => ({}))) as { id?: string; choice?: number };
    const q = id ? questions.get(id) : undefined;
    if (!q || typeof choice !== 'number' || !Number.isInteger(choice) || choice < 0 || choice >= q.options.length) return c.json({ error: 'No such question or answer.' }, 400);
    const a = (s.answers[q.id] ??= { misses: 0 });
    if (a.right) return c.json({ answer: a });
    // a wrong try closes the question for a while: trying every answer is slower than reading the lines
    const wait = a.lockedUntil ? Math.ceil((Date.parse(a.lockedUntil) - Date.now()) / 1000) : 0;
    if (wait > 0) return c.json({ error: `This question opens again in ${wait} s. Read the lines again.`, answer: a, reread: q.reread }, 429);
    if (choice === q.answer) {
      a.right = { choice, explain: q.explain };
      delete a.lockedUntil;
    } else {
      a.misses++;
      if (lockSeconds > 0) a.lockedUntil = new Date(Date.now() + lockSeconds * 1000).toISOString();
    }
    record(s, 'answer', { question: q.id, choice, right: !!a.right, read: s.read, seconds: seconds(s) });
    return c.json({ answer: a, ...(a.right ? {} : { reread: q.reread }) });
  });

  app.post('/api/flag', async (c) => {
    const s = c.get('s');
    const b = (await c.req.json().catch(() => ({}))) as Partial<Flag> & { on?: boolean };
    if (typeof b.file !== 'string' || typeof b.line !== 'number' || !shownAnywhere(b.file, b.line)) return c.json({ error: 'That line is not on the tour.' }, 400);
    if (s.caught) return c.json({ error: 'This read is already handed in.' }, 400);
    const i = s.flags.findIndex((f) => f.file === b.file && f.line === b.line);
    if (b.on === false) {
      if (i >= 0) s.flags.splice(i, 1);
    } else {
      if (i < 0 && s.flags.length >= MAX_FLAGS) return c.json({ error: `At most ${MAX_FLAGS} lines can be flagged. Remove one first.`, flags: s.flags }, 400);
      const f = { file: b.file, line: b.line, note: String(b.note ?? (i >= 0 ? s.flags[i]!.note : '')).slice(0, 400) };
      if (i >= 0) s.flags[i] = f;
      else s.flags.push(f);
    }
    return c.json({ flags: s.flags });
  });

  /** A ruling on one thing the AI did not decide: accept it, or send it back to the author with what has to change. */
  app.post('/api/rule', async (c) => {
    const s = c.get('s');
    const b = (await c.req.json().catch(() => ({}))) as { id?: string; decision?: string; note?: string };
    const item = rulingItems.find((r) => r.id === b.id);
    if (!item) return c.json({ error: 'No such open point.' }, 400);
    if (s.caught) return c.json({ error: 'This read is already handed in.' }, 400);
    if (b.decision !== 'accept' && b.decision !== 'back') return c.json({ error: 'Accept it, or send it back.' }, 400);
    const note = String(b.note ?? '').trim().slice(0, 400);
    if (b.decision === 'back' && note.length < MIN_NOTE) return c.json({ error: 'Say what the author has to change.' }, 400);
    s.rulings ??= {};
    s.rulings[item.id] = { decision: b.decision, note } satisfies Ruling;
    record(s, 'rule', { point: item.id, kind: item.kind, stop: item.stopId, decision: b.decision, note, read: s.read, seconds: seconds(s) });
    return c.json({ rulings: s.rulings });
  });

  /** Hand in the read: every question right, every open point ruled on, and the planted line among the flagged lines with what it does wrong. */
  app.post('/api/handin', async (c) => {
    const s = c.get('s');
    if (s.caught) return c.json({ ok: true, tour: view(s) });
    if (coldOpen(s)) return c.json({ error: 'The read has not started.' }, 400);
    const open = [...questions.keys()].filter((id) => !s.answers[id]?.right);
    if (open.length) return c.json({ error: `${open.length} ${open.length === 1 ? 'question is' : 'questions are'} not answered yet.` }, 400);
    const unruled = ruled(s).open;
    if (unruled) return c.json({ error: `${unruled} open ${unruled === 1 ? 'point is' : 'points are'} not ruled on yet.` }, 400);
    if (!s.flags.length) return c.json({ error: 'Flag the line you think was changed on purpose.' }, 400);
    if (s.flags.length > MAX_FLAGS) return c.json({ error: `Flag at most ${MAX_FLAGS} lines. Remove the ones you are least sure of.` }, 400);
    const bare = s.flags.filter((f) => f.note.trim().length < MIN_NOTE).length;
    if (bare) return c.json({ error: `Say what goes wrong on each flagged line: ${bare} ${bare === 1 ? 'flag has' : 'flags have'} no reason.` }, 400);
    const p = plantOf(s);
    if (!p) return c.json({ error: tour.plants.length ? 'Every planted line has been shown to you. Someone else has to read this commit.' : 'This tour has no planted line.' }, 400);
    if (s.busy) return c.json({ error: 'This hand-in is being checked.' }, 409);
    const mine = s.flags.find((f) => f.file === p.file && f.line === p.line);
    // the right line with no idea why is a guess, or a comparison with the raw diff: the reason is checked
    let noteOk: boolean | null = null;
    if (mine && d.grade) {
      s.busy = true;
      try {
        noteOk = await d.grade({ note: mine.note, plant: p, stopTitle: tour.stops.find((st) => st.id === stopOf(p.file, p.line))?.title ?? '' });
      } finally {
        s.busy = false;
      }
    }
    const caught = !!mine && noteOk !== false;
    touch(s, null);
    const r: Reveal = { ...reveal(p), ...(mine && !caught ? { noteFailed: mine.note } : {}) };
    const secs = seconds(s);
    record(s, 'handin', { read: s.read, caught, plant: `${p.file}:${p.line}`, kind: p.kind ?? '', flags: s.flags, ...(mine ? { note: mine.note, noteOk } : {}), wrongAnswers: wrong(s), seconds: secs, lines, linesPerMinute: speed(secs), plantInFocus: inFocus(p), afterCold: s.cold?.action ?? '', skimmed: skimmed(s), dwell: s.dwell });
    markShown(s, p);
    if (caught) {
      s.caught = r;
      s.caughtSeconds = secs;
      s.noteChecked = noteOk;
      return c.json({ ok: true, tour: view(s) });
    }
    s.missed.push(r);
    s.read++;
    s.flags = [];
    if (exhausted(s)) record(s, 'failed', { reads: s.read - 1 });
    return c.json({ ok: false, tour: view(s) });
  });

  app.post('/api/sign', async (c) => {
    const s = c.get('s');
    // a signed-in reviewer signs with the name GitHub gives; a typed name is kept, and marked as not verified
    const typed = String(((await c.req.json().catch(() => ({}))) as { name?: string }).name ?? '').trim().slice(0, 80);
    const name = s.login ?? typed;
    if (!s.caught) return c.json({ error: 'The read is not handed in.' }, 400);
    if (!name) return c.json({ error: 'A signature needs a name.' }, 400);
    if (s.signature) return c.json(state(s));
    const caught = s.caught;
    const secs = s.caughtSeconds ?? seconds(s);
    const checks = tour.short ? undefined : checksOf(s);
    const back = ruled(s).back;
    const sig: Signature = {
      name,
      at: new Date().toISOString(),
      headSha: tour.pr.headSha,
      seconds: secs,
      reads: s.read,
      questions: questions.size,
      misses: wrong(s),
      flagsForAuthor: s.flags.filter((f) => !(f.file === caught.file && f.line === caught.line)),
      ...(s.prepared ? {} : { lines, linesPerMinute: speed(secs), fast: isFast(speed(secs)) }),
      ...(s.login ? { login: s.login } : {}),
      ...(checks ? { checks, outcome: outcomeOf(checks, back) } : {}),
    };
    const status = sig.outcome ? statusFor({ outcome: sig.outcome, who: whoOf(sig), questions: sig.questions, wrong: sig.misses, reads: sig.reads, linesPerMinute: sig.linesPerMinute, back }) : null;
    if (d.setStatus && status) {
      try {
        await d.setStatus({ repo: tour.pr.repo, sha: tour.pr.headSha, description: status.description, state: status.state, targetUrl: d.publicUrl ?? tour.pr.url });
        sig.github = { ok: true, note: 'readback/read is set on the commit.' };
      } catch (e) {
        sig.github = { ok: false, note: (e as Error).message.slice(0, 200) };
      }
    }
    s.signature = sig;
    record(s, 'sign', { name, ...(sig.login ? { login: sig.login } : {}), reads: sig.reads, wrongAnswers: sig.misses, seconds: sig.seconds, lines, linesPerMinute: sig.linesPerMinute, fast: sig.fast, ...(s.prepared ? { prepared: true } : {}), plant: `${caught.file}:${caught.line}`, noteChecked: s.noteChecked ?? null, flagsForAuthor: sig.flagsForAuthor, rulings: s.rulings ?? {}, ...(sig.outcome ? { outcome: sig.outcome, checks: sig.checks, ...(status ? { status } : {}) } : {}), ...(sig.github ? { github: sig.github } : {}) });
    d.onSign?.(sig);
    return c.json(state(s));
  });

  /** Our own test reads only: take the signature back, so the last step can be shown again. The first signature stays in the records. */
  app.post('/api/unsign', (c) => {
    const s = c.get('s');
    if (!s.test) return c.json({ error: 'Only a test read can take its signature back.' }, 403);
    if (!s.signature) return c.json({ error: 'There is no signature.' }, 400);
    record(s, 'unsign', { name: s.signature.name });
    s.signature = null;
    return c.json(state(s));
  });

  app.post('/api/reset', (c) => {
    // the id of this request's session: on a first visit the cookie is only on its way to the browser
    const id = c.get('id');
    const old = c.get('s');
    if (old.login && !old.test) return c.json({ error: 'A signed-in reviewer has one review of a commit. Sign out to look around as a visitor.' }, 403);
    // "a new reader" is a new person: on this copy a person is a browser, on a real repository it is the GitHub login
    const who = randomBytes(12).toString('hex');
    setCookie(c, 'rb_who', who, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 60 * 60 * 24 * 30 });
    const s = fresh(old.test, who);
    if (old.ours) s.ours = true;
    if (old.login) s.login = old.login;
    record(old, 'reset', { next: s.rid, agent: (c.req.header('user-agent') ?? '').slice(0, 200) });
    sessions.set(id, s);
    coldShown(s, c.req.header('user-agent'));
    return c.json(view(s));
  });

  // the guide is given the change as the agent wrote it: it cannot give away a line it has never seen
  if (d.ask) ask(app, d.ask, (c) => view(c.get('s'), true), (c) => ++c.get('s').asked, (c, q, stopId) => record(c.get('s'), 'ask', { q, stop: stopId ?? '', read: c.get('s').read }));

  app.get('/healthz', (c) => c.text('ok'));

  // the built page; any other address gets index.html
  if (d.distDir) {
    const root = resolve(d.distDir);
    app.get('*', (c) => {
      const rel = decodeURIComponent(c.req.path).replace(/^\/+/, '');
      const hit = rel ? resolve(root, rel) : '';
      const type = TYPES[extname(hit)];
      if (hit.startsWith(root + sep) && type && existsSync(hit)) return new Response(Bun.file(hit), { headers: { 'content-type': type, 'cache-control': rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' } });
      const index = resolve(root, 'index.html');
      if (!existsSync(index)) return c.text('The page is not built yet. Run: cd web && bun run build', 503);
      return new Response(Bun.file(index), { headers: { 'content-type': TYPES['.html']!, 'cache-control': 'no-cache' } });
    });
  }

  return app;
}
