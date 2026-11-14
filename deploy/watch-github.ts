/**
 * bun deploy/watch-github.ts            runs on this machine, next to gh and entire; the public copy holds no token of either
 * bun deploy/watch-github.ts --reset    put the commit back to "nobody has read this commit" on GitHub and on Entire, and leave
 *
 * Watches the public copy's records. The commit status readback/read on GitHub (required by the branch rule on main)
 * follows the record: a signature whose review met the rule sets it green, one that sent points back sets it red,
 * and a signature that does not count changes nothing. The server decides which (server/gate.ts) and writes the
 * status into the `sign` row; this only carries it. The same row is carried to the trail of the pull request on Entire
 * (server/entire.ts): its findings are the open points, and its approval is given only here.
 * A signature taken back (test reads only) puts both back. So does the end of an invited judge's time on a demo copy
 * (RB_DEMO_MINUTES): the record stays, and the next judge finds the commit blocked.
 * With RB_CARRY_KEY (through the vault) the public copy is told what was carried, and the signed page shows it.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Entire, Evidence, Ruling, Tour } from '../shared/tour';
import { carry, takeBack } from '../server/entire';
import { setRecord, setStatus } from '../server/github';
import { RECORD_MARK, recordGone, recordOf } from '../server/prrecord';

const ROOT = resolve(import.meta.dir, '..');
const APP = process.env.FLY_APP ?? 'readback-demo';
/** which review this watcher carries: 'full', or 'next' for a follow-up review (then RB_TOUR, RB_EVIDENCE, RB_ENTIRE, RB_ENTIRE_REPO and RB_WATCH_DIR point at its files) */
const KEY = process.env.RB_WATCH_KEY ?? 'full';
const URL_FULL = `https://${APP}.fly.dev/${KEY}`;
const DIR = process.env.RB_WATCH_DIR ?? '/bulk3/runs/readback/watch';
const DEMO_MINUTES = Number(process.env.RB_DEMO_MINUTES || 0);
const json = <T>(p: string): T | undefined => (existsSync(resolve(ROOT, p)) ? (JSON.parse(readFileSync(resolve(ROOT, p), 'utf8')) as T) : undefined);
const tour = json<Tour>(process.env.RB_TOUR ?? 'data/live/tour.json')!;
const evidence = json<Evidence>(process.env.RB_EVIDENCE ?? 'data/live/evidence.json');
const trail = json<Entire>(process.env.RB_ENTIRE ?? 'data/live/entire.json')?.trail;
const { repo, headSha } = tour.pr;
mkdirSync(DIR, { recursive: true });
const log = (m: string) => {
  const line = `${new Date().toISOString()} ${m}`;
  console.log(line);
  appendFileSync(resolve(DIR, 'log.txt'), line + '\n');
};
const READ = KEY === 'full' ? 'a full read' : 'a follow-up review';
const NOBODY = `Nobody has read this commit yet. It needs ${READ}.`;
const NOBODY_ENTIRE = `Nobody has read this commit: it needs ${READ} in Readback.`;

interface Row {
  type: string;
  at: string;
  rid: string;
  tour: string;
  headSha: string;
  test: boolean;
  name?: string;
  who?: string;
  via?: string;
  reads?: number;
  outcome?: 'approved' | 'sent-back' | 'not-counted';
  rulings?: Record<string, Ruling>;
  /** what the rule says this signature writes to GitHub; absent when it does not count */
  status?: { state: 'success' | 'failure'; description: string };
  seconds?: number;
}
/** the signature the commit stands on now, and what it left on Entire */
interface Standing {
  rid: string;
  at: string;
  memories: string[];
  /** set for an invited judge on a demo copy: when the approval is taken back */
  until?: number;
  who?: string;
  outcome?: string;
}
const handledPath = resolve(DIR, 'handled.json');
const standingPath = resolve(DIR, 'standing.json');
const handled = new Set<string>(existsSync(handledPath) ? (JSON.parse(readFileSync(handledPath, 'utf8')) as string[]) : []);
let standing: Standing | null = existsSync(standingPath) ? (JSON.parse(readFileSync(standingPath, 'utf8')) as Standing | null) : null;
const stand = (s: Standing | null) => {
  standing = s;
  writeFileSync(standingPath, JSON.stringify(s));
};
const key = (r: Row) => `${r.rid}:${r.type}:${r.at}`;

/** the record on the pull request itself: one comment, rewritten in place; a failure here never holds up the status */
async function comment(body: string) {
  try {
    log(`record on pull request #${tour.pr.number}: ${await setRecord({ repo, pr: tour.pr.number, body, mark: RECORD_MARK })}`);
    return true;
  } catch (e) {
    log(`record on the pull request failed: ${(e as Error).message.slice(0, 160)}`);
    return false;
  }
}

async function back(why: string, entireWhy: string, said = 'It was taken back.') {
  await setStatus({ repo, sha: headSha, state: 'pending', description: NOBODY, targetUrl: URL_FULL });
  await comment(recordGone({ tour, url: URL_FULL, read: READ, why: said, ...(standing?.who ? { last: { who: standing.who, at: standing.at, outcome: standing.outcome } } : {}) }));
  if (trail) {
    const e = await takeBack({ trail, why: entireWhy, memories: standing?.memories });
    log(`entire: ${e.note}`);
  }
  stand(null);
  log(`pending: ${why}`);
}

if (process.argv.includes('--reset')) {
  await back('reset by hand', NOBODY_ENTIRE, 'The commit was put back to unread by hand.');
  process.exit(0);
}

/** tell the public copy what was carried, so the signed page can show it; the key stays in the vault */
async function report(r: Row, body: { github?: { ok: boolean; note: string }; entire?: { ok: boolean; note: string } }) {
  const p = Bun.spawn(['hsec', 'exec', '--only', 'READBACK_CARRY_KEY', '--', 'bun', resolve(ROOT, 'deploy/carried.ts'), URL_FULL, JSON.stringify({ rid: r.rid, at: r.at, ...body })], { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
  if ((await p.exited) !== 0) log(`report: ${(await new Response(p.stderr).text()).trim().slice(0, 160)}`);
}

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
const mine = (r: Row) => (r.type === 'sign' || r.type === 'unsign') && r.tour === KEY && r.headSha === headSha;

// what is already there when the watcher starts is history, not news
let first = !existsSync(handledPath);
log(`watching ${APP} for ${KEY} reads of ${repo}@${headSha.slice(0, 7)}${trail ? `, carried to Entire trail #${trail.number}` : ''}`);
for (;;) {
  try {
    for (const r of (await rows()).filter(mine)) {
      if (handled.has(key(r))) continue;
      handled.add(key(r));
      if (first) continue;
      if (r.type === 'sign') {
        if (!r.status || !r.outcome || r.outcome === 'not-counted') {
          log(`no change: a signature that does not count (${r.outcome ?? 'made before the rule'})`);
          continue;
        }
        const description = r.status.description.slice(0, 140);
        await setStatus({ repo, sha: headSha, state: r.status.state, description, targetUrl: URL_FULL });
        log(`${r.status.state}: ${description}`);
        const who = r.who ?? r.name ?? 'a reviewer';
        const github = { ok: true, note: `readback/read is ${r.status.state === 'success' ? 'green' : 'red'} on ${headSha.slice(0, 7)}: "${description}"` };
        await report(r, { github });
        let memories: string[] = [];
        if (trail) {
          // a signature replaces the one before it: what that one resolved is opened again first
          if (standing) await takeBack({ trail, why: 'A newer review replaces this one.', memories: standing.memories });
          const e = await carry({ trail, headSha, who, outcome: r.outcome, description, rulings: r.rulings ?? {}, items: evidence?.rulings ?? [], remember: !r.test });
          memories = e.memories;
          log(`entire: ${e.note}`);
          await report(r, { entire: { ok: e.ok, note: e.note } });
        }
        // the status is what blocks or frees the merge, so it goes first; the record on the pull request follows
        if (await comment(recordOf({ tour, evidence, url: URL_FULL, read: READ, signed: { who, at: r.at, outcome: r.outcome, description, seconds: r.seconds, rulings: r.rulings ?? {} } })))
          await report(r, { github: { ok: true, note: `${github.note} The trace of this review is written on the pull request.` } });
        stand({ rid: r.rid, at: r.at, memories, who, outcome: r.outcome, ...(r.via === 'invite' && DEMO_MINUTES ? { until: Date.parse(r.at) + DEMO_MINUTES * 60_000 } : {}) });
      } else if (standing?.rid === r.rid) {
        await back('a test signature was taken back', 'The signature was taken back. ' + NOBODY_ENTIRE, 'The signature was taken back by the reviewer.');
      }
    }
    if (standing?.until && Date.now() > standing.until) await back(`an invited judge's ${DEMO_MINUTES} minutes are over`, `The demo time of an invited judge's review is over. ${NOBODY_ENTIRE}`, `On this demo copy an invited judge's review counts for ${DEMO_MINUTES} minutes, so the next judge finds the commit blocked.`);
    first = false;
    writeFileSync(handledPath, JSON.stringify([...handled]));
  } catch (e) {
    log(`error: ${(e as Error).message.slice(0, 200)}`);
  }
  await Bun.sleep(2500);
}
