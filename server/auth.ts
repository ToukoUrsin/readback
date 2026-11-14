/**
 * Sign in with GitHub, so that a signature carries a name GitHub vouches for.
 *
 *   GET /auth/github?to=/full   -> GitHub's sign-in page (no scope: only the public profile is read)
 *   GET /auth/callback          -> a signed cookie with the login, then back to `to`
 *   GET /auth/out?to=/full      -> forgets the sign-in
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
}

export interface Auth {
  app: Hono;
  /** the signed-in reviewer of this request, if any */
  me(c: Context): Me | null;
}

const COOKIE = 'rb_gh';

export function createAuth(d: { clientId: string; clientSecret: string; secret: string; publicUrl: string }): Auth {
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
      return typeof m.login === 'string' && /^[A-Za-z0-9-]{1,39}$/.test(m.login) ? m : null;
    } catch {
      return null;
    }
  };
  const safe = (to: string | undefined) => (to && /^\/[A-Za-z0-9/_#?=&.-]*$/.test(to) && !to.startsWith('//') ? to : '/full');
  const cookie = { httpOnly: true, sameSite: 'Lax' as const, path: '/', secure: d.publicUrl.startsWith('https:') };

  const app = new Hono();
  app.get('/auth/github', (c) => {
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
  app.get('/auth/out', (c) => {
    setCookie(c, COOKIE, '', { ...cookie, maxAge: 0 });
    return c.redirect(safe(c.req.query('to')));
  });
  return { app, me: (c) => open(getCookie(c, COOKIE)) };
}
