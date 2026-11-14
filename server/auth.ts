/**
 * Sign in with GitHub, so that a signature carries a name GitHub vouches for.
 *
 *   GET /auth/github?to=/full   -> GitHub's sign-in page (no scope: only the public profile is read)
 *   GET /auth/callback          -> a signed cookie with the login, then back to `to`
 *   GET /auth/out?to=/full      -> forgets the sign-in
 *
 * Without a GitHub OAuth app the same proof is given by hand, and Readback is granted nothing at all:
 *   GET  /auth/code             -> a one-time code for this browser
 *   POST /auth/proof {url}      -> the reviewer put the code in a gist; GitHub says whose gist it is
 *
 * A judge without a GitHub account comes in through a link the team gives out:
 *   GET /auth/judge?k=<key>&to=/full -> a signed cookie for one invited judge (this browser), who types their name when signing
 *
 * Nothing of GitHub's is kept: the token is used once to read the login and is then dropped.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';

export interface Me {
  login: string;
  name?: string;
  /** how the login is vouched for: GitHub's sign-in page (absent), a gist only that account can make, or the team's judge link */
  via?: 'gist' | 'invite';
}

export interface Auth {
  app: Hono;
  /** the signed-in reviewer of this request, if any */
  me(c: Context): Me | null;
}

const COOKIE = 'rb_gh';

export function createAuth(d: { clientId?: string; clientSecret?: string; secret: string; publicUrl: string; judgeKey?: string }): Auth {
  const mac = (v: string) => createHmac('sha256', d.secret).update(v).digest('base64url');
  const seal = (m: Me) => {
    const v = Buffer.from(JSON.stringify(m)).toString('base64url');
    return `${v}.${mac(v)}`;
  };
  const open = (raw: string | undefined): Me | null => {
    const [v, sig] = (raw ?? '').split('.');
    if (!v || !sig) return null;
    const want = Buffer.from(mac(v));
    const got = Buffer.from(sig);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    try {
      const m = JSON.parse(Buffer.from(v, 'base64url').toString()) as Me;
      if (typeof m.login !== 'string' || !/^[A-Za-z0-9-]{1,39}$/.test(m.login)) return null;
      // an invited judge is not a GitHub account, and no GitHub login has two hyphens in a row
      return (m.via === 'invite') === m.login.startsWith('judge--') ? m : null;
    } catch {
      return null;
    }
  };
  const safe = (to: string | undefined) => (to && /^\/[A-Za-z0-9/_#?=&.-]*$/.test(to) && !to.startsWith('//') ? to : '/full');
  const cookie = { httpOnly: true, sameSite: 'Lax' as const, path: '/', secure: d.publicUrl.startsWith('https:') };

  const app = new Hono();
  app.get('/auth/github', (c) => {
    if (!d.clientId || !d.clientSecret) return c.redirect(`/signin?to=${encodeURIComponent(safe(c.req.query('to')))}`);
    const state = randomBytes(16).toString('hex');
    setCookie(c, 'rb_oauth', `${state}:${safe(c.req.query('to'))}`, { ...cookie, maxAge: 600 });
    const u = new URL('https://github.com/login/oauth/authorize');
    u.searchParams.set('client_id', d.clientId);
    u.searchParams.set('redirect_uri', `${d.publicUrl}/auth/callback`);
    u.searchParams.set('state', state);
    u.searchParams.set('allow_signup', 'false');
    return c.redirect(u.toString());
  });
  app.get('/auth/callback', async (c) => {
    if (!d.clientId || !d.clientSecret) return c.text('GitHub sign-in is not set up on this copy.', 404);
    const [state, to] = (getCookie(c, 'rb_oauth') ?? '').split(/:(.*)/s);
    const code = c.req.query('code');
    if (!code || !state || c.req.query('state') !== state) return c.text('The sign-in did not come back the way it left. Go back and try again.', 400);
    try {
      const t = (await (
        await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ client_id: d.clientId, client_secret: d.clientSecret, code, redirect_uri: `${d.publicUrl}/auth/callback` }), signal: AbortSignal.timeout(15_000) })
      ).json()) as { access_token?: string; error_description?: string };
      if (!t.access_token) return c.text(`GitHub did not sign you in: ${t.error_description ?? 'no reason given'}`, 400);
      const u = (await (await fetch('https://api.github.com/user', { headers: { authorization: `Bearer ${t.access_token}`, accept: 'application/vnd.github+json', 'user-agent': 'readback' }, signal: AbortSignal.timeout(15_000) })).json()) as { login?: string; name?: string | null };
      if (!u.login) return c.text('GitHub did not say who you are.', 400);
      setCookie(c, COOKIE, seal({ login: u.login, ...(u.name ? { name: u.name.slice(0, 80) } : {}) }), { ...cookie, maxAge: 60 * 60 * 24 * 7 });
      setCookie(c, 'rb_oauth', '', { ...cookie, maxAge: 0 });
      return c.redirect(safe(to));
    } catch (e) {
      return c.text(`GitHub did not answer: ${(e as Error).message.slice(0, 120)}`, 502);
    }
  });
  // the code lives 30 minutes in a signed cookie: a gist with it proves nothing to any other browser
  const proofOf = (raw: string | undefined): { code: string; exp: number } | null => {
    const [v, sig] = (raw ?? '').split('.');
    if (!v || !sig || sig !== mac(`proof:${v}`)) return null;
    try {
      const p = JSON.parse(Buffer.from(v, 'base64url').toString()) as { code: string; exp: number };
      return p.exp > Date.now() ? p : null;
    } catch {
      return null;
    }
  };
  app.get('/auth/code', (c) => {
    let p = proofOf(getCookie(c, 'rb_proof'));
    if (!p) {
      p = { code: `readback-${randomBytes(9).toString('base64url')}`, exp: Date.now() + 30 * 60_000 };
      const v = Buffer.from(JSON.stringify(p)).toString('base64url');
      setCookie(c, 'rb_proof', `${v}.${mac(`proof:${v}`)}`, { ...cookie, maxAge: 1800 });
    }
    const me = open(getCookie(c, COOKIE));
    return c.json({ code: p.code, minutes: Math.max(1, Math.round((p.exp - Date.now()) / 60_000)), ...(me ? { me: { login: me.login } } : {}) }, 200, { 'cache-control': 'no-store' });
  });
  app.post('/auth/proof', async (c) => {
    const p = proofOf(getCookie(c, 'rb_proof'));
    if (!p) return c.json({ error: 'The code has run out. Reload this page for a new one.' }, 400);
    const b = (await c.req.json().catch(() => ({}))) as { url?: unknown };
    const id = /(?:^|\/)([0-9a-f]{20,40})(?:[/#?.]|$)/.exec(typeof b.url === 'string' ? b.url.trim().slice(0, 300) : '')?.[1];
    if (!id) return c.json({ error: 'That is not the address of a gist. It looks like https://gist.github.com/your-name/0123abcd…' }, 400);
    try {
      // GitHub answers the bare address of a gist with the address under its owner: that is who made it
      const r = await fetch(`https://gist.github.com/${id}`, { redirect: 'manual', headers: { 'user-agent': 'readback' }, signal: AbortSignal.timeout(15_000) });
      const login = /^https:\/\/gist\.github\.com\/([A-Za-z0-9-]{1,39})\/[0-9a-f]+$/.exec(r.headers.get('location') ?? '')?.[1];
      if (!login) return c.json({ error: r.status === 404 ? 'GitHub has no gist at that address.' : 'GitHub did not say whose gist that is. Try again in a moment.' }, r.status === 404 ? 400 : 502);
      const raw = await fetch(`https://gist.githubusercontent.com/${login}/${id}/raw?${Date.now()}`, { headers: { 'user-agent': 'readback' }, signal: AbortSignal.timeout(15_000) });
      if (!raw.ok) return c.json({ error: 'GitHub did not hand over the text of that gist. Try again in a moment.' }, 502);
      const text = (await raw.text()).slice(0, 20_000);
      if (!text.includes(p.code)) return c.json({ error: `That gist is @${login}'s, but the code ${p.code} is not in it.` }, 400);
      setCookie(c, COOKIE, seal({ login, via: 'gist' }), { ...cookie, maxAge: 60 * 60 * 24 * 7 });
      setCookie(c, 'rb_proof', '', { ...cookie, maxAge: 0 });
      return c.json({ ok: true, login });
    } catch (e) {
      return c.json({ error: `GitHub did not answer: ${(e as Error).message.slice(0, 120)}` }, 502);
    }
  });
  // the team's judge link: every browser that opens it is one invited judge, with one review of the commit
  app.get('/auth/judge', (c) => {
    const k = Buffer.from(c.req.query('k') ?? '');
    const want = Buffer.from(d.judgeKey ?? '');
    if (!want.length || k.length !== want.length || !timingSafeEqual(k, want)) return c.text('This judge link is not valid on this copy.', 404);
    if (open(getCookie(c, COOKIE))?.via !== 'invite') setCookie(c, COOKIE, seal({ login: `judge--${randomBytes(3).toString('hex')}`, via: 'invite' }), { ...cookie, maxAge: 60 * 60 * 24 * 7 });
    return c.redirect(safe(c.req.query('to')));
  });
  app.get('/auth/out', (c) => {
    setCookie(c, COOKIE, '', { ...cookie, maxAge: 0 });
    return c.redirect(safe(c.req.query('to')));
  });
  return { app, me: (c) => open(getCookie(c, COOKIE)) };
}
