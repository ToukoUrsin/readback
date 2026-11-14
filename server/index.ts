/**
 * bun server/index.ts
 *   PORT            default 4410
 *   RB_TOUR         default data/kuitti-2/tour.json
 *   RB_GITHUB=1     a signature also sets the commit status readback/read (through this box's gh)
 *   GEMINI_API_KEY  turns on the guide (RB_ASK_MODEL, default gemini-4-hydrogen)
 *   RB_PUBLIC_URL   address people reach this server at, used as the link on the GitHub status
 *   HOST            default 127.0.0.1
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Tour } from '../shared/tour';
import { createApp } from './app';
import { setStatus } from './github';

const ROOT = resolve(import.meta.dir, '..');
const tourPath = resolve(ROOT, process.env.RB_TOUR ?? 'data/kuitti-2/tour.json');
const tour = JSON.parse(readFileSync(tourPath, 'utf8')) as Tour;
const github = process.env.RB_GITHUB === '1';
const key = process.env.GEMINI_API_KEY;
const port = Number(process.env.PORT ?? 4410);

const app = createApp({
  tour,
  distDir: resolve(ROOT, 'web/dist'),
  setStatus: github ? setStatus : undefined,
  publicUrl: process.env.RB_PUBLIC_URL,
  ask: key ? { key, model: process.env.RB_ASK_MODEL || 'gemini-4-hydrogen', budget: Number(process.env.RB_ASK_BUDGET || 2000) } : undefined,
  onSign: process.env.RB_KEEP === '0' ? undefined : (s) => {
    try {
      appendFileSync(resolve(dirname(tourPath), 'signatures.jsonl'), JSON.stringify(s) + '\n');
    } catch {
      /* a read-only disk is fine */
    }
  },
});

Bun.serve({ port, hostname: process.env.HOST ?? '127.0.0.1', fetch: app.fetch, idleTimeout: 90 });
console.log(`Readback on http://localhost:${port} · ${tour.pr.repo}#${tour.pr.number} · ${tour.stops.length} stops · guide ${key ? 'on' : 'off'} · GitHub ${github ? 'on' : 'off'}`);
