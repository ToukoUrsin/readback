/**
 * bun server/index.ts
 *   PORT            default 4410
 *   RB_TOUR         default data/live/tour.json
 *   RB_GITHUB=1     a signature also sets the commit status readback/read (through this box's gh)
 *   GEMINI_API_KEY  turns on the guide (RB_ASK_MODEL, default gemini-4-hydrogen)
 *   RB_PREP_KEY        with /full?test=1&prep=<key>&leave=<stop id> the questions are answered ahead, for a recording
 *   RB_GITHUB_WATCH=1  says on the page that a signed full read reaches GitHub within seconds (deploy/watch-github.ts does it)
 *   RB_PUBLIC_URL   address people reach this server at, used as the link on the GitHub status
 *   HOST            default 127.0.0.1
 *   RB_TOUR_SHORT   default data/live/short.json ; when the file exists it is served at / and /short, and the full read at /full
 *   RB_DATA         where reads are kept, default data/readers ; RB_KEEP=0 keeps nothing on disk
 *   RB_EVIDENCE     default data/live/evidence.json (gen/evidence.ts); without the file every stop has to be read
 *   RB_GITHUB_CLIENT_ID, RB_GITHUB_CLIENT_SECRET   a GitHub OAuth app: turns on "Sign in with GitHub" (callback <RB_PUBLIC_URL>/auth/callback)
 *   RB_AUTH_SECRET     signs the sign-in cookie. Alone (no OAuth app) a reviewer proves the GitHub account with a gist
 *   RB_REVIEWERS       comma list of GitHub logins whose review can approve. Unset: any GitHub account
 *   RB_JUDGE_KEY       turns on the judge link /auth/judge?k=<key>: an invited judge signs with a typed name, and it counts
 *   RB_DEMO_MINUTES    an invited judge's approval is taken back after this many minutes (the watcher resets GitHub and Entire)
 *   RB_ENTIRE          default data/live/entire.json (gen/entire.ts): the agent sessions, the callers and the trail of the change
 *   RB_QUESTIONS       default data/live/questions.json (gen/questions.ts): checked questions per stop; each reviewer is asked a draw of them
 *   RB_NEXT            default data/next: a follow-up review (tour.json, evidence.json, entire.json, questions.json, followup.json),
 *                      served at /next when the folder holds a tour and a followup.json for it
 *   RB_CARRY_KEY       with it the watcher reports what it carried to GitHub and Entire, and the signed page shows it
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Entire, Evidence, Followup, Question, SecondRead, Tour } from '../shared/tour';
import { createApp, createShown } from './app';
import { createAuth } from './auth';
import { createGrade, createGradeRuling } from './grade';
import { closeLines } from './close';
import { numbers } from './numbers';
import { setStatus } from './github';
import { createStore } from './store';

const ROOT = resolve(import.meta.dir, '..');
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as Tour;
const tour = read(resolve(ROOT, process.env.RB_TOUR ?? 'data/live/tour.json'));
const shortPath = resolve(ROOT, process.env.RB_TOUR_SHORT ?? 'data/live/short.json');
const shortTour = existsSync(shortPath) ? read(shortPath) : null;
const github = process.env.RB_GITHUB === '1';
const key = process.env.GEMINI_API_KEY;
const port = Number(process.env.PORT ?? 4410);
const dataDir = process.env.RB_KEEP === '0' ? null : resolve(ROOT, process.env.RB_DATA ?? 'data/readers');
const store = createStore(dataDir);
const distDir = resolve(ROOT, 'web/dist');
// one budget for both reads
const ask = key ? { key, model: process.env.RB_ASK_MODEL || 'gemini-4-hydrogen', budget: Number(process.env.RB_ASK_BUDGET || 2000) } : undefined;

const evidencePath = resolve(ROOT, process.env.RB_EVIDENCE ?? 'data/live/evidence.json');
const evidence = existsSync(evidencePath) ? (JSON.parse(readFileSync(evidencePath, 'utf8')) as Evidence) : undefined;
const grade = key ? createGrade({ key, model: process.env.RB_ASK_MODEL || 'gemini-4-hydrogen' }) : undefined;
const gradeRuling = key ? createGradeRuling({ key, model: process.env.RB_ASK_MODEL || 'gemini-4-hydrogen' }) : undefined;
const publicUrl = process.env.RB_PUBLIC_URL ?? `http://localhost:${port}`;
const authSecret = process.env.RB_AUTH_SECRET || process.env.RB_GITHUB_CLIENT_SECRET;
// with an OAuth app: GitHub's sign-in page. Without one: the reviewer proves the account with a gist. Either way GitHub says who it is
const auth = authSecret ? createAuth({ clientId: process.env.RB_GITHUB_CLIENT_ID, clientSecret: process.env.RB_GITHUB_CLIENT_SECRET, secret: authSecret, publicUrl, judgeKey: process.env.RB_JUDGE_KEY || undefined }) : null;
const entirePath = resolve(ROOT, process.env.RB_ENTIRE ?? 'data/live/entire.json');
const entire = existsSync(entirePath) ? (JSON.parse(readFileSync(entirePath, 'utf8')) as Entire) : undefined;
const questionsPath = resolve(ROOT, process.env.RB_QUESTIONS ?? 'data/live/questions.json');
const questionPool = existsSync(questionsPath) ? (JSON.parse(readFileSync(questionsPath, 'utf8')) as { headSha: string; stops: Record<string, Question[]>; added?: { existing?: { id: string }[] }[] }) : undefined;
// a checked question whose lines hold a line that can be planted is kept in the file and not asked: with that line planted its key would be wrong
const heldBack = new Set((questionPool?.added ?? []).flatMap((a) => (a.existing ?? []).map((e) => e.id)));
const pool = questionPool?.headSha === tour.pr.headSha ? Object.fromEntries(Object.entries(questionPool.stops).map(([id, qs]) => [id, qs.filter((q) => !heldBack.has(q.id))])) : undefined;
const secondPath = resolve(ROOT, process.env.RB_SECOND ?? 'data/live/second.json');
const secondRead = existsSync(secondPath) ? (JSON.parse(readFileSync(secondPath, 'utf8')) as SecondRead) : undefined;
const second = secondRead?.headSha === tour.pr.headSha ? secondRead : undefined;
const demoMinutes = Number(process.env.RB_DEMO_MINUTES || 0) || undefined;
const reviewers = process.env.RB_REVIEWERS ? process.env.RB_REVIEWERS.toLowerCase().split(',').map((x) => x.trim().replace(/^@/, '')).filter(Boolean) : undefined;
const efficiencyPath = resolve(ROOT, process.env.RB_EFFICIENCY ?? 'data/live/efficiency.json');
const efficiency = existsSync(efficiencyPath) ? (JSON.parse(readFileSync(efficiencyPath, 'utf8')) as { headSha: string; model: string; functions: number; byModel: { tokens: number; seconds: number; medianTokens: number; medianSeconds: number }; same: number; modelFoundMore: number; graphFoundMore: number; mixed: { asked: number; tokens: number; sameAsModel: boolean } }) : undefined;
const checked = questionPool?.headSha === tour.pr.headSha ? (questionPool as unknown as { madeBy: { writer: string; checker: string; costUsd: number }; checks: { source: string; kept: boolean; withCode: boolean; withoutCode: boolean }[] }) : undefined;
/** what Entire holds about the change and what the question check found, for the numbers and concept pages: all of it read from the files above */
const more = {
  ...(entire && entire.headSha === tour.pr.headSha
    ? {
        history: {
          sessions: entire.sessions.map((s, i) => ({ n: i + 1, asked: s.asked, commit: s.commit.slice(0, 7), tokens: s.tokens.total, written: s.tokens.output, steps: s.transcript })),
          graph: entire.graph,
          versions: entire.versions,
          ...(entire.trail ? { trail: { number: entire.trail.number, findings: Object.keys(entire.trail.findings).length } } : {}),
          ...(efficiency && efficiency.headSha === entire.headSha ? { callers: { functions: efficiency.functions, model: efficiency.model, tokens: efficiency.byModel.tokens, seconds: efficiency.byModel.seconds, medianTokens: efficiency.byModel.medianTokens, medianSeconds: efficiency.byModel.medianSeconds, same: efficiency.same, modelFoundMore: efficiency.modelFoundMore, graphFoundMore: efficiency.graphFoundMore, mixed: efficiency.mixed } } : {}),
        },
      }
    : {}),
  ...(checked && pool
    ? {
        questionCheck: {
          writer: checked.madeBy.writer,
          checker: checked.madeBy.checker,
          costUsd: checked.madeBy.costUsd,
          checked: checked.checks.length,
          kept: checked.checks.filter((c) => c.kept).length,
          wrongKey: checked.checks.filter((c) => !c.withCode).length,
          withoutCode: checked.checks.filter((c) => c.withCode && c.withoutCode).length,
          first: { checked: checked.checks.filter((c) => c.source === 'tour').length, withoutCode: checked.checks.filter((c) => c.source === 'tour' && c.withCode && c.withoutCode).length, kept: checked.checks.filter((c) => c.source === 'tour' && c.kept).length },
          perStop: Math.min(...tour.stops.filter((s) => pool[s.id]).map((s) => pool[s.id]!.length)),
          heldBack: Object.values(questionPool!.stops).flat().filter((q) => heldBack.has(q.id)).length,
          inUse: Object.values(pool).flat().length,
        },
      }
    : {}),
  ...(second ? { second: { model: second.madeBy.model, at: second.at, tokens: second.madeBy.tokens, ...second.counts } } : {}),
  demo: { judgeLink: !!process.env.RB_JUDGE_KEY && !!authSecret, ...(demoMinutes ? { minutes: demoMinutes } : {}), ...(reviewers ? { reviewers: reviewers.length } : {}) },
};

const shown = createShown(store);
// a follow-up review: the author answered a review that was sent back, and only what that commit changed is read again
const nextDir = resolve(ROOT, process.env.RB_NEXT ?? 'data/next');
const opt = <T>(f: string) => (existsSync(resolve(nextDir, f)) ? (JSON.parse(readFileSync(resolve(nextDir, f), 'utf8')) as T) : undefined);
const nextTour = opt<Tour>('tour.json');
const followup = opt<Followup>('followup.json');
const nextEvidence = opt<Evidence>('evidence.json');
const nextOn = !!nextTour && followup?.headSha === nextTour.pr.headSha && followup.earlier.headSha === tour.pr.headSha;
const span = (t: Tour) => t.stops.reduce((a, s) => a + s.blocks.reduce((b, x) => b + (x.type === 'code' ? x.to - x.from + 1 : 0), 0), 0);
const closely = (t: Tour, e?: Evidence) => [...closeLines(t, e && e.headSha === t.pr.headSha ? e : undefined).values()].reduce((a, s) => a + s.size, 0);
// the questions a reviewer is asked: two per stop that has lines to read closely
const asked = (t: Tour, e?: Evidence) => { const c = closeLines(t, e && e.headSha === t.pr.headSha ? e : undefined); return t.stops.reduce((a, s) => a + (c.get(s.id)?.size ? s.questions.length : 0), 0); };
const after = nextOn ? { href: '/next', pr: nextTour!.pr.number, url: nextTour!.pr.url, who: followup!.earlier.who, at: followup!.earlier.at, points: followup!.points.length, minutesAfter: followup!.answer.minutesAfter, stops: nextTour!.stops.length, questions: asked(nextTour!, nextEvidence), closely: closely(nextTour!, nextEvidence), lines: span(nextTour!) } : undefined;
const full = createApp({ tour, after, key: 'full', store, shown, distDir, ask, evidence, grade, gradeRuling, coldPlants: shortTour?.cold?.plants, entire, second, pool, demoMinutes, openPlants: shortTour?.plants.map((p) => p.id), carryKey: process.env.RB_CARRY_KEY || undefined, me: auth?.me, signIn: !!auth, reviewers, githubSoon: process.env.RB_GITHUB_WATCH === '1', prepKey: process.env.RB_PREP_KEY || undefined, setStatus: github ? setStatus : undefined, publicUrl: process.env.RB_PUBLIC_URL, other: shortTour ? { kind: 'short', href: '/', stops: shortTour.stops.length } : undefined });
// the short read never writes to GitHub: it does not approve anything
const short = shortTour ? createApp({ tour: shortTour, key: 'short', cookie: 'rb_short', store, shown, distDir, ask, evidence, grade, gradeRuling, entire, second, pool, other: { kind: 'full', href: '/full', stops: tour.stops.length } }) : null;

const nextPool = opt<{ headSha: string; stops: Record<string, Question[]> }>('questions.json');
const next =
  nextOn && nextTour && followup
    ? createApp({ tour: nextTour, key: 'next', cookie: 'rb_next', store, shown, distDir, ask, evidence: nextEvidence, grade, gradeRuling, entire: opt<Entire>('entire.json'), pool: nextPool?.headSha === nextTour.pr.headSha ? nextPool.stops : undefined, demoMinutes, followup, carryKey: process.env.RB_CARRY_KEY || undefined, me: auth?.me, signIn: !!auth, reviewers, githubSoon: process.env.RB_GITHUB_WATCH === '1', prepKey: process.env.RB_PREP_KEY || undefined, setStatus: github ? setStatus : undefined, publicUrl: process.env.RB_PUBLIC_URL })
    : null;

// what happened after a review was sent back, for the numbers page: every value is read from the follow-up's files
const loop = (() => {
  if (!next || !nextTour || !followup) return {};
  return {
    loop: {
      earlier: { who: followup.earlier.who, at: followup.earlier.at, headSha: followup.earlier.headSha.slice(0, 7), seconds: followup.earlier.seconds, ours: followup.earlier.ours },
      points: followup.points.length,
      accepted: followup.accepted,
      issue: followup.issue,
      answer: { ...followup.answer, commit: followup.answer.commit.slice(0, 7) },
      pr: { number: nextTour.pr.number, url: nextTour.pr.url },
      untouched: followup.untouched,
      first: { stops: tour.stops.length, lines: span(tour), closely: closely(tour, evidence), questions: asked(tour, evidence) },
      again: { stops: nextTour.stops.length, lines: span(nextTour), closely: closely(nextTour, nextEvidence), questions: asked(nextTour, nextEvidence) },
      retried: followup.retried ?? [],
    },
  };
})();

// "/" and "/short" are the short read (it opens with the cold test), "/full" is the read that approves
Bun.serve({
  port,
  hostname: process.env.HOST ?? '127.0.0.1',
  idleTimeout: 90,
  fetch(req) {
    const u = new URL(req.url);
    const under = (p: string) => u.pathname === p || u.pathname.startsWith(`${p}/`);
    const strip = (p: string, app: { fetch: (r: Request) => Response | Promise<Response> }) => {
      u.pathname = u.pathname.slice(p.length) || '/';
      return app.fetch(new Request(u, req));
    };
    if (auth && under('/auth')) return auth.app.fetch(req);
    // the numbers of this copy: what people did, what agents did, and what the evidence routes to a person
    if (u.pathname === '/api/numbers') return Response.json({ ...numbers(store.events(), { tour, evidence }), ...more, ...loop }, { headers: { 'cache-control': 'no-store' } });
    if (under('/full')) return strip('/full', full);
    if (next && under('/next')) return strip('/next', next);
    if (short && under('/short')) return strip('/short', short);
    return (short ?? full).fetch(req);
  },
});
console.log(`Readback on http://localhost:${port} · ${tour.pr.repo}#${tour.pr.number} · ${tour.stops.length} stops${shortTour ? ` · short read ${shortTour.stops.length} stops at / , full read at /full` : ''} · guide ${key ? 'on' : 'off'} · evidence ${evidence ? 'on' : 'off'} · Entire ${entire ? 'on' : 'off'} · sign-in ${auth ? 'on' : 'off'} · GitHub ${github ? 'on' : 'off'} · readers kept in ${dataDir ?? 'memory only'}`);
