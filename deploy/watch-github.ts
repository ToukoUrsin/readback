/**
 * bun deploy/watch-github.ts            runs on this machine, next to gh; the public copy holds no GitHub token
 * bun deploy/watch-github.ts --reset    put the commit status back to "nobody has read this commit" and leave
 *
 * Watches the public copy's records. When a full read of the pull request's head commit is signed there,
 * it sets the commit status readback/read on GitHub, which the branch rule on main requires.
 * A signature taken back (test reads only) sets it to pending again.
 *
 * A visitor's typed name is not written to GitHub: only our own test reads carry their name there.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Tour } from '../shared/tour';
import { setStatus } from '../server/github';

const ROOT = resolve(import.meta.dir, '..');
const APP = process.env.FLY_APP ?? 'readback-demo';
const URL_FULL = `https://${APP}.fly.dev/full`;
const DIR = process.env.RB_WATCH_DIR ?? '/bulk3/runs/readback/watch';
const tour = JSON.parse(readFileSync(resolve(ROOT, process.env.RB_TOUR ?? 'data/live/tour.json'), 'utf8')) as Tour;
const { repo, headSha } = tour.pr;
const questions = tour.stops.reduce((a, s) => a + s.questions.length, 0);
mkdirSync(DIR, { recursive: true });
const log = (m: string) => {
  const line = `${new Date().toISOString()} ${m}`;
  console.log(line);
  appendFileSync(resolve(DIR, 'log.txt'), line + '\n');
};
const NOBODY = 'Nobody has read this commit yet. It needs a full read.';

if (process.argv.includes('--reset')) {
  await setStatus({ repo, sha: headSha, state: 'pending', description: NOBODY, targetUrl: URL_FULL });
  log(`reset: readback/read is pending on ${headSha.slice(0, 7)}`);
  process.exit(0);
}

interface Row {
  type: string;
  at: string;
  rid: string;
  tour: string;
  headSha: string;
  test: boolean;
  name?: string;
  reads?: number;
}
const handledPath = resolve(DIR, 'handled.json');
const handled = new Set<string>(existsSync(handledPath) ? (JSON.parse(readFileSync(handledPath, 'utf8')) as string[]) : []);
const key = (r: Row) => `${r.rid}:${r.type}:${r.at}`;

async function rows(): Promise<Row[]> {
  const p = Bun.spawn(['hsec', 'exec', '--only', 'FLY_API_TOKEN', '--', 'flyctl', 'ssh', 'console', '--app', APP, '-C', 'tail -n 400 /data/reads.jsonl'], { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
  const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  if (code !== 0) throw new Error(`flyctl exited with ${code}`);
  return out.split('\n').flatMap((l) => {
    if (!l.startsWith('{')) return [];
    try {
      return [JSON.parse(l) as Row];
    } catch {
      return [];
    }
  });
}
const mine = (r: Row) => (r.type === 'sign' || r.type === 'unsign') && r.tour === 'full' && r.headSha === headSha;
const clean = (name: string) => name.replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, 40) || 'a test reader';

// what is already there when the watcher starts is history, not news
let first = !existsSync(handledPath);
log(`watching ${APP} for full reads of ${repo}@${headSha.slice(0, 7)}`);
for (;;) {
  try {
    for (const r of (await rows()).filter(mine)) {
      if (handled.has(key(r))) continue;
      handled.add(key(r));
      if (first) continue;
      if (r.type === 'sign') {
        const description = r.test ? `Read by ${clean(r.name ?? '')}: ${questions}/${questions} questions, planted bug caught on read ${r.reads ?? 1}` : `Read by a visitor of the public demo: ${questions}/${questions} questions, planted bug caught on read ${r.reads ?? 1}`;
        await setStatus({ repo, sha: headSha, state: 'success', description, targetUrl: URL_FULL });
        log(`success: ${description}`);
      } else {
        await setStatus({ repo, sha: headSha, state: 'pending', description: NOBODY, targetUrl: URL_FULL });
        log('pending: a test signature was taken back');
      }
    }
    first = false;
    writeFileSync(handledPath, JSON.stringify([...handled]));
  } catch (e) {
    log(`error: ${(e as Error).message.slice(0, 200)}`);
  }
  await Bun.sleep(2500);
}
