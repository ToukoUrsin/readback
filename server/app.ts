/**
 * One reader, one read. The browser never gets an answer key or the place of a planted line:
 * both are checked here.
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { Block, Flag, PublicTour, ReaderState, Reveal, Signature, Tour, TourPlant } from '../shared/tour';
import { ask, type AskDeps } from './ask';
import type { ReadEvent, Store } from './store';

export const MAX_FLAGS = 3;

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

export interface Deps {
  tour: Tour;
  distDir?: string;
  /** writes the signature to GitHub as a commit status; absent on the public demo */
  setStatus?: (s: { repo: string; sha: string; description: string; targetUrl: string }) => Promise<void>;
  publicUrl?: string;
  ask?: AskDeps;
  /** called with every signature (the box keeps them in a file) */
  onSign?: (s: Signature) => void;
  /** plant order for a new reader; the default shuffles */
  order?: (n: number) => number[];
  /** which read this is, in the records: 'full' or 'short' */
  key?: string;
  /** cookie name; two tours on one host need two */
  cookie?: string;
  /** keeps what readers did, and the open reads */
  store?: Store;
  other?: PublicTour['other'];
}

interface Session extends ReaderState {
  order: number[];
  asked: number;
  /** names this go in the records; not the cookie */
  rid: string;
  test: boolean;
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
  const saved = d.store?.load<{ headSha: string; sessions: [string, Session][] }>(`sessions-${key}`);
  const sessions = new Map<string, Session>(saved?.headSha === tour.pr.headSha ? saved.sessions : []);
  const keep = () => d.store?.save(`sessions-${key}`, () => ({ headSha: tour.pr.headSha, sessions: [...sessions] }));
  const seconds = (s: Session) => (s.startedAt ? Math.round((Date.now() - Date.parse(s.startedAt)) / 1000) : 0);
  const wrong = (s: Session) => Object.values(s.answers).reduce((a, x) => a + x.misses, 0);
  const record = (s: Session, type: ReadEvent['type'], more: Record<string, unknown> = {}) => d.store?.record({ type, at: new Date().toISOString(), rid: s.rid, tour: key, headSha: tour.pr.headSha, test: s.test, ...more });
  const questions = new Map(tour.stops.flatMap((s) => s.questions.map((q) => [q.id, q] as const)));
  const stopOf = (file: string, line: number) => tour.stops.find((s) => s.blocks.some((b) => b.type === 'code' && b.file === file && b.from <= line && line <= b.to))?.id ?? '';
  const onTour = (file: string, line: number) => stopOf(file, line) !== '';

  const fresh = (test = false): Session => ({ rid: randomBytes(6).toString('hex'), test, order: (d.order ?? shuffle)(tour.plants.length), asked: 0, read: 1, answers: {}, flags: [], startedAt: null, missed: [], caught: null, signature: null });

  /** the planted line of this read, or null once it is caught (the reader then sees the real branch) */
  const plantOf = (s: Session): TourPlant | null => (s.caught || !tour.plants.length ? null : tour.plants[s.order[(s.read - 1) % s.order.length]!]!);

  const reveal = (p: TourPlant): Reveal => ({ file: p.file, line: p.line, stopId: stopOf(p.file, p.line), original: p.originalTokens, planted: p.tokens, what: p.what, failedTests: p.failedTests });

  const withPlant = (blocks: Block[], p: TourPlant | null): Block[] =>
    !p ? blocks : blocks.map((b) => (b.type === 'code' && b.file === p.file && b.from <= p.line && p.line <= b.to ? { ...b, lines: b.lines.map((l) => (l.n === p.line ? { ...l, tokens: p.tokens } : l)) } : b));

  const state = (s: Session): ReaderState => ({ read: s.read, answers: s.answers, flags: s.flags, startedAt: s.startedAt, missed: s.missed, caught: s.caught, signature: s.signature });

  const view = (s: Session): PublicTour => {
    const p = plantOf(s);
    return {
      pr: tour.pr,
      intro: tour.intro,
      stops: tour.stops.map((st) => ({ id: st.id, title: st.title, why: st.why, blocks: withPlant(st.blocks, p), questions: st.questions.map((q) => ({ id: q.id, prompt: q.prompt, options: q.options })) })),
      coverage: tour.coverage,
      madeBy: tour.madeBy,
      maxFlags: MAX_FLAGS,
      state: state(s),
      github: !!d.setStatus,
      ask: !!d.ask,
      ...(tour.short ? { short: tour.short } : {}),
      ...(d.other ? { other: d.other } : {}),
    };
  };

  const app = new Hono<{ Variables: { s: Session } }>();

  // counts only: no names, no lines. Before the reader check, so asking for it starts no read.
  app.get('/api/stats', (c) => (d.store ? c.json(d.store.stats()) : c.json({ error: 'Nothing is kept on this server.' }, 404)));

  app.use('/api/*', async (c, next) => {
    const test = getCookie(c, 'rb_test') === '1';
    let id = getCookie(c, cookie);
    if (!id || !sessions.has(id)) {
      id = randomBytes(16).toString('hex');
      sessions.set(id, fresh(test));
      setCookie(c, cookie, id, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 60 * 60 * 24 * 7 });
      if (sessions.size > 5000) sessions.delete(sessions.keys().next().value!);
    }
    const s = sessions.get(id)!;
    if (test) s.test = true;
    c.set('s', s);
    await next();
    if (c.req.method === 'POST') keep();
  });

  app.get('/api/tour', (c) => c.json(view(c.get('s'))));

  app.post('/api/start', (c) => {
    const s = c.get('s');
    if (!s.startedAt) {
      s.startedAt = new Date().toISOString();
      record(s, 'start', { agent: (c.req.header('user-agent') ?? '').slice(0, 200) });
    }
    return c.json(state(s));
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
    const open = [...questions.keys()].filter((id) => !s.answers[id]?.right);
    if (open.length) return c.json({ error: `${open.length} ${open.length === 1 ? 'question is' : 'questions are'} not answered yet.` }, 400);
    if (!s.flags.length) return c.json({ error: 'Flag the line you think was changed on purpose.' }, 400);
    if (s.flags.length > MAX_FLAGS) return c.json({ error: `Flag at most ${MAX_FLAGS} lines. Remove the ones you are least sure of.` }, 400);
    const p = plantOf(s);
    if (!p) return c.json({ error: 'This tour has no planted line.' }, 400);
    const r = reveal(p);
    const caught = s.flags.some((f) => f.file === p.file && f.line === p.line);
    record(s, 'handin', { read: s.read, caught, plant: `${p.file}:${p.line}`, flags: s.flags, wrongAnswers: wrong(s), seconds: seconds(s) });
    if (caught) {
      s.caught = r;
      return c.json({ ok: true, tour: view(s) });
    }
    s.missed.push(r);
    s.read++;
    s.flags = [];
    return c.json({ ok: false, tour: view(s) });
  });

  app.post('/api/sign', async (c) => {
    const s = c.get('s');
    const name = String(((await c.req.json().catch(() => ({}))) as { name?: string }).name ?? '').trim().slice(0, 80);
    if (!s.caught) return c.json({ error: 'The read is not handed in.' }, 400);
    if (!name) return c.json({ error: 'A signature needs a name.' }, 400);
    if (s.signature) return c.json(state(s));
    const caught = s.caught;
    const sig: Signature = {
      name,
      at: new Date().toISOString(),
      headSha: tour.pr.headSha,
      seconds: seconds(s),
      reads: s.read,
      questions: questions.size,
      misses: wrong(s),
      flagsForAuthor: s.flags.filter((f) => !(f.file === caught.file && f.line === caught.line)),
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
    record(s, 'sign', { name, reads: sig.reads, wrongAnswers: sig.misses, seconds: sig.seconds, plant: `${caught.file}:${caught.line}`, flagsForAuthor: sig.flagsForAuthor, ...(sig.github ? { github: sig.github } : {}) });
    d.onSign?.(sig);
    return c.json(state(s));
  });

  app.post('/api/reset', (c) => {
    const id = getCookie(c, cookie)!;
    const old = c.get('s');
    const s = fresh(old.test);
    record(old, 'reset', { next: s.rid });
    sessions.set(id, s);
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
