/**
 * One reader, one read. The browser never gets an answer key or the place of a planted line:
 * both are checked here. A line the reader has been shown as planted is never planted for them again.
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { Block, ColdResult, Flag, PublicTour, ReaderState, Reveal, Signature, Tour, TourPlant } from '../shared/tour';
import { ask, type AskDeps } from './ask';
import type { ReadEvent, Store } from './store';

export const MAX_FLAGS = 3;
/** lines a minute from which a read is marked as fast: a line a second, which nobody reads code at */
export const FAST_LINES_PER_MINUTE = 60;

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
/** a reader meets these first */
const KIND_RANK: Record<string, number> = { access: 0, money: 1, data: 2, logic: 3, format: 5 };

export interface Deps {
  tour: Tour;
  distDir?: string;
  /** writes the signature to GitHub as a commit status; absent on the public demo */
  setStatus?: (s: { repo: string; sha: string; description: string; targetUrl: string }) => Promise<void>;
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
}

export interface Shown {
  has(who: string, line: string): boolean;
  add(who: string, line: string): void;
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
  const questions = new Map(tour.stops.flatMap((s) => s.questions.map((q) => [q.id, q] as const)));
  const lines = tour.stops.reduce((a, s) => a + s.blocks.reduce((b, x) => b + (x.type === 'code' ? x.to - x.from + 1 : 0), 0), 0);
  const stopOf = (file: string, line: number) => tour.stops.find((s) => s.blocks.some((b) => b.type === 'code' && b.file === file && b.from <= line && line <= b.to))?.id ?? '';
  const onTour = (file: string, line: number) => stopOf(file, line) !== '';
  const inCold = (file: string, line: number) => !!tour.cold?.blocks.some((b) => b.file === file && b.from <= line && line <= b.to);

  const seconds = (s: Session) => (s.startedAt ? Math.round((Date.now() - Date.parse(s.startedAt)) / 1000) : 0);
  const wrong = (s: Session) => Object.values(s.answers).reduce((a, x) => a + x.misses, 0);
  const speed = (secs: number) => (secs > 0 ? Math.round((lines / secs) * 60) : 0);
  const record = (s: Session, type: ReadEvent['type'], more: Record<string, unknown> = {}) => d.store?.record({ type, at: new Date().toISOString(), rid: s.rid, tour: key, headSha: tour.pr.headSha, test: s.test, ...(s.ours ? { ours: true } : {}), ...more });

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
    return { rid: randomBytes(6).toString('hex'), test, who, order, asked: 0, read: 1, answers: {}, flags: [], startedAt: null, missed: [], caught: null, signature: null, shown: [], coldPlant, coldShownAt: null, cold: null };
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

  const state = (s: Session): ReaderState => ({ read: s.read, answers: s.answers, flags: s.flags, startedAt: s.startedAt, missed: s.missed, caught: s.caught, signature: s.signature, cold: s.cold, exhausted: exhausted(s) });

  const view = (s: Session): PublicTour => {
    const cold = coldOpen(s);
    const p = plantOf(s);
    return {
      pr: tour.pr,
      intro: tour.intro,
      // while the cold test is open the reader gets only its lines: two copies of the same code with different planted lines would give both away
      stops: cold ? [] : tour.stops.map((st) => ({ id: st.id, title: st.title, why: st.why, blocks: withPlant(st.blocks, p), questions: st.questions.map((q) => ({ id: q.id, prompt: q.prompt, options: q.options })) })),
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
    if (!id || !sessions.has(id)) {
      id = randomBytes(16).toString('hex');
      sessions.set(id, fresh(test, who));
      setCookie(c, cookie, id, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 60 * 60 * 24 * 7 });
      if (sessions.size > 5000) sessions.delete(sessions.keys().next().value!);
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
      s.startedAt = new Date().toISOString();
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
      s.startedAt = new Date().toISOString();
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
    s.prepared = true;
    record(s, 'prep', { answered, leave: leave ?? '' });
    return c.json(view(s));
  });

  /** which stop the reader opened: time per stop comes from these */
  app.post('/api/seen', async (c) => {
    const s = c.get('s');
    const { stop } = (await c.req.json().catch(() => ({}))) as { stop?: string };
    if (typeof stop === 'string' && (stop === 'handin' || tour.stops.some((x) => x.id === stop))) record(s, 'stop', { stop, read: s.read, seconds: seconds(s) });
    return c.json({ ok: true });
  });

  app.post('/api/answer', async (c) => {
    const s = c.get('s');
    const { id, choice } = (await c.req.json().catch(() => ({}))) as { id?: string; choice?: number };
    const q = id ? questions.get(id) : undefined;
    if (!q || typeof choice !== 'number') return c.json({ error: 'No such question.' }, 400);
    const a = (s.answers[q.id] ??= { misses: 0 });
    if (a.right) return c.json({ answer: a });
    if (choice === q.answer) a.right = { choice, explain: q.explain };
    else a.misses++;
    record(s, 'answer', { question: q.id, choice, right: !!a.right, read: s.read, seconds: seconds(s) });
    return c.json({ answer: a, ...(a.right ? {} : { reread: q.reread }) });
  });

  app.post('/api/flag', async (c) => {
    const s = c.get('s');
    const b = (await c.req.json().catch(() => ({}))) as Partial<Flag> & { on?: boolean };
    if (typeof b.file !== 'string' || typeof b.line !== 'number' || !onTour(b.file, b.line)) return c.json({ error: 'That line is not on the tour.' }, 400);
    if (s.caught) return c.json({ error: 'This read is already handed in.' }, 400);
    const i = s.flags.findIndex((f) => f.file === b.file && f.line === b.line);
    if (b.on === false) {
      if (i >= 0) s.flags.splice(i, 1);
    } else {
      const f = { file: b.file, line: b.line, note: String(b.note ?? (i >= 0 ? s.flags[i]!.note : '')).slice(0, 400) };
      if (i >= 0) s.flags[i] = f;
      else s.flags.push(f);
    }
    return c.json({ flags: s.flags });
  });

  /** Hand in the read: every question right, and the planted line among the flagged lines. */
  app.post('/api/handin', (c) => {
    const s = c.get('s');
    if (s.caught) return c.json({ ok: true, tour: view(s) });
    if (coldOpen(s)) return c.json({ error: 'The read has not started.' }, 400);
    const open = [...questions.keys()].filter((id) => !s.answers[id]?.right);
    if (open.length) return c.json({ error: `${open.length} ${open.length === 1 ? 'question is' : 'questions are'} not answered yet.` }, 400);
    if (!s.flags.length) return c.json({ error: 'Flag the line you think was changed on purpose.' }, 400);
    if (s.flags.length > MAX_FLAGS) return c.json({ error: `Flag at most ${MAX_FLAGS} lines. Remove the ones you are least sure of.` }, 400);
    const p = plantOf(s);
    if (!p) return c.json({ error: tour.plants.length ? 'Every planted line has been shown to you. Someone else has to read this commit.' : 'This tour has no planted line.' }, 400);
    const r = reveal(p);
    const caught = s.flags.some((f) => f.file === p.file && f.line === p.line);
    const secs = seconds(s);
    record(s, 'handin', { read: s.read, caught, plant: `${p.file}:${p.line}`, kind: p.kind ?? '', flags: s.flags, wrongAnswers: wrong(s), seconds: secs, lines, linesPerMinute: speed(secs), plantInFocus: inFocus(p), afterCold: s.cold?.action ?? '' });
    markShown(s, p);
    if (caught) {
      s.caught = r;
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
    const name = String(((await c.req.json().catch(() => ({}))) as { name?: string }).name ?? '').trim().slice(0, 80);
    if (!s.caught) return c.json({ error: 'The read is not handed in.' }, 400);
    if (!name) return c.json({ error: 'A signature needs a name.' }, 400);
    if (s.signature) return c.json(state(s));
    const caught = s.caught;
    const secs = seconds(s);
    const sig: Signature = {
      name,
      at: new Date().toISOString(),
      headSha: tour.pr.headSha,
      seconds: secs,
      reads: s.read,
      questions: questions.size,
      misses: wrong(s),
      flagsForAuthor: s.flags.filter((f) => !(f.file === caught.file && f.line === caught.line)),
      ...(s.prepared ? {} : { lines, linesPerMinute: speed(secs), fast: speed(secs) >= FAST_LINES_PER_MINUTE }),
    };
    if (d.setStatus) {
      const description = `Read by ${name}: ${sig.questions}/${sig.questions} questions, planted bug caught on read ${sig.reads}`;
      try {
        await d.setStatus({ repo: tour.pr.repo, sha: tour.pr.headSha, description, targetUrl: d.publicUrl ?? tour.pr.url });
        sig.github = { ok: true, note: 'readback/read is set on the commit.' };
      } catch (e) {
        sig.github = { ok: false, note: (e as Error).message.slice(0, 200) };
      }
    }
    s.signature = sig;
    record(s, 'sign', { name, reads: sig.reads, wrongAnswers: sig.misses, seconds: sig.seconds, lines, linesPerMinute: sig.linesPerMinute, fast: sig.fast, ...(s.prepared ? { prepared: true } : {}), plant: `${caught.file}:${caught.line}`, flagsForAuthor: sig.flagsForAuthor, ...(sig.github ? { github: sig.github } : {}) });
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
    // "a new reader" is a new person: on this copy a person is a browser, on a real repository it is the GitHub login
    const who = randomBytes(12).toString('hex');
    setCookie(c, 'rb_who', who, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 60 * 60 * 24 * 30 });
    const s = fresh(old.test, who);
    if (old.ours) s.ours = true;
    record(old, 'reset', { next: s.rid, agent: (c.req.header('user-agent') ?? '').slice(0, 200) });
    sessions.set(id, s);
    coldShown(s, c.req.header('user-agent'));
    return c.json(view(s));
  });

  if (d.ask) ask(app, d.ask, (c) => view(c.get('s')), (c) => ++c.get('s').asked, (c, q, stopId) => record(c.get('s'), 'ask', { q, stop: stopId ?? '', read: c.get('s').read }));

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
