/**
 * bun server/index.ts
 *   PORT            default 4410
 *   RB_TOUR         default data/kuitti-2/tour.json
 *   RB_GITHUB=1     a signature also sets the commit status readback/read (through this box's gh)
 *   GEMINI_API_KEY  turns on the guide (RB_ASK_MODEL, default gemini-4-hydrogen)
 *   RB_PUBLIC_URL   address people reach this server at, used as the link on the GitHub status
 *   HOST            default 127.0.0.1
 *   RB_TOUR_SHORT   default data/kuitti-2-short/tour.json ; served at /short when the file exists
 *   RB_DATA         where reads are kept, default data/readers ; RB_KEEP=0 keeps nothing on disk
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Tour } from '../shared/tour';
import { createApp } from './app';
import { setStatus } from './github';
import { createStore } from './store';

const ROOT = resolve(import.meta.dir, '..');
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as Tour;
const tour = read(resolve(ROOT, process.env.RB_TOUR ?? 'data/kuitti-2/tour.json'));
const shortPath = resolve(ROOT, process.env.RB_TOUR_SHORT ?? 'data/kuitti-2-short/tour.json');
const shortTour = existsSync(shortPath) ? read(shortPath) : null;
const github = process.env.RB_GITHUB === '1';
const key = process.env.GEMINI_API_KEY;
const port = Number(process.env.PORT ?? 4410);
const dataDir = process.env.RB_KEEP === '0' ? null : resolve(ROOT, process.env.RB_DATA ?? 'data/readers');
const store = createStore(dataDir);
const distDir = resolve(ROOT, 'web/dist');
// one budget for both reads
const ask = key ? { key, model: process.env.RB_ASK_MODEL || 'gemini-4-hydrogen', budget: Number(process.env.RB_ASK_BUDGET || 2000) } : undefined;

const full = createApp({ tour, key: 'full', store, distDir, ask, setStatus: github ? setStatus : undefined, publicUrl: process.env.RB_PUBLIC_URL, other: shortTour ? { kind: 'short', href: '/short', stops: shortTour.stops.length } : undefined });
// the short read lives under /short and never writes to GitHub: it does not approve anything
const short = shortTour ? createApp({ tour: shortTour, key: 'short', cookie: 'rb_short', store, distDir, ask, other: { kind: 'full', href: '/', stops: tour.stops.length } }) : null;

Bun.serve({
  port,
  hostname: process.env.HOST ?? '127.0.0.1',
  idleTimeout: 90,
  fetch(req) {
    const u = new URL(req.url);
    if (short && (u.pathname === '/short' || u.pathname.startsWith('/short/'))) {
      u.pathname = u.pathname.slice('/short'.length) || '/';
      return short.fetch(new Request(u, req));
    }
    return full.fetch(req);
  },
});
console.log(`Readback on http://localhost:${port} · ${tour.pr.repo}#${tour.pr.number} · ${tour.stops.length} stops${shortTour ? ` · short read ${shortTour.stops.length} stops at /short` : ''} · guide ${key ? 'on' : 'off'} · GitHub ${github ? 'on' : 'off'} · readers kept in ${dataDir ?? 'memory only'}`);
