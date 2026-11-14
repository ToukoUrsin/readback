/**
 * bun gen/followup.ts --row <sign row> --earlier <dir> --dir <dir> --repo <checkout> --answer <out.json> --transcript <jsonl> --issue <n>
 *
 * A review was sent back and the author made one more commit. This writes what the follow-up review shows about that:
 * <dir>/followup.json (the Followup interface in shared/tour.ts), and one open point per point sent back, appended to
 * <dir>/evidence.json: the reviewer rules whether the author's answer does what was asked.
 *
 *   --row         the `sign` row of the review that was sent back (one line of the public copy's reads.jsonl)
 *   --earlier     the folder of that review: tour.json, evidence.json
 *   --dir         the folder of the follow-up review: tour.json, evidence.json, entire.json (made before this runs)
 *   --repo        a checkout that holds both commits; only read
 *   --answer      what `claude -p --output-format json` printed for the author agent's session
 *   --transcript  that session's transcript on this machine (its `entire brain recall` call is counted)
 *   --issue       the issue deploy/send-back.ts wrote from the points sent back
 *
 * No model is asked anything. Every field is read from a record or from git, and `retried` is run: each one-line change
 * the tests did not notice on a line that was sent back is tried again at the new commit, offline in Docker.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { CodeBlock, Entire, Evidence, Followup, Ruling, RulingItem, Tour } from '../shared/tour';
import { prepareSandbox, runTests } from './lib/sandbox';
import { exec, log } from './lib/util';

const argv = process.argv.slice(2);
const args: Record<string, string> = {};
for (let i = 0; i < argv.length; i++) if (argv[i]!.startsWith('--')) args[argv[i]!.slice(2)] = argv[++i] ?? '';
for (const k of ['row', 'earlier', 'dir', 'repo', 'answer', 'transcript', 'issue'])
  if (!args[k]) {
    console.error('usage: bun gen/followup.ts --row <sign row> --earlier <dir> --dir <dir> --repo <checkout> --answer <out.json> --transcript <jsonl> --issue <n>');
    process.exit(2);
  }
const read = <T>(...p: string[]) => JSON.parse(readFileSync(resolve(...p), 'utf8')) as T;
const row = read<{ at: string; who?: string; name?: string; headSha: string; outcome?: string; ours?: boolean; seconds: number; reads: number; lines: number; rulings?: Record<string, Ruling>; checks?: { id: string; text: string }[] }>(args.row!);
const before = { tour: read<Tour>(args.earlier!, 'tour.json'), evidence: read<Evidence>(args.earlier!, 'evidence.json') };
const tour = read<Tour>(args.dir!, 'tour.json');
const evidence = read<Evidence>(args.dir!, 'evidence.json');
const entire = read<Entire>(args.dir!, 'entire.json');
const answer = read<{ session_id: string; num_turns: number; duration_ms: number }>(args.answer!);
const repo = resolve(args.repo!);
const git = async (a: string[]) => (await exec('git', a, { cwd: repo, check: true })).stdout;

if (row.outcome !== 'sent-back') throw new Error(`the signature is "${row.outcome}", not sent back`);
if (row.headSha !== before.tour.pr.headSha) throw new Error('the signature is of another commit than the earlier tour');
if (tour.pr.baseSha !== row.headSha) throw new Error(`the follow-up starts from ${tour.pr.baseSha.slice(0, 7)}, the review that was sent back read ${row.headSha.slice(0, 7)}`);
const A = row.headSha;
const B = tour.pr.headSha;
const one = (s: string) => s.replace(/\s+/g, ' ').trim();
const linesOf = (s: { blocks: { type: string }[] }) => (s.blocks.filter((b) => b.type === 'code') as CodeBlock[]).reduce((n, b) => n + b.to - b.from + 1, 0);

/* ---------- the points sent back ---------- */

const back = before.evidence.rulings.filter((it) => row.rulings?.[it.id]?.decision === 'back');
const points: Followup['points'] = back.map((it, i) => ({ id: it.id, n: i + 1, file: it.file, from: it.from, to: it.to, note: one(row.rulings![it.id]!.note), found: one(it.found) }));
// the issue's criteria are these points, in this order: a mismatch means the issue was written from another signature
for (const p of points) if (!evidence.criteria.find((c) => c.n === p.n)?.text.includes(p.note)) throw new Error(`criterion ${p.n} of the follow-up's evidence is not the reviewer's words for ${p.id}`);

/* ---------- what the new commit leaves untouched ---------- */

/** lines of the earlier commit that the new one changes or removes, and lines after which it adds some */
const hit = new Map<string, { from: number; to: number }[]>();
for (const l of (await git(['diff', '-U0', A, B])).split('\n')) {
  const f = /^--- a\/(.*)$/.exec(l);
  if (f) hit.set(f[1]!, []);
  const h = /^@@ -(\d+)(?:,(\d+))? \+/.exec(l);
  if (!h) continue;
  const file = [...hit.keys()].at(-1)!;
  const a = Number(h[1]);
  const n = h[2] === undefined ? 1 : Number(h[2]);
  hit.get(file)!.push(n === 0 ? { from: a, to: a } : { from: a, to: a + n - 1 });
}
const touches = (s: Tour['stops'][number]) => (s.blocks.filter((b) => b.type === 'code') as CodeBlock[]).some((b) => hit.get(b.file)?.some((r) => r.from <= b.to && r.to >= b.from));
const touched = before.tour.stops.filter(touches);
const still = before.tour.stops.filter((s) => !touches(s));

/* ---------- the author's answer ---------- */

const session = entire.sessions.find((s) => B.startsWith(s.commit) || s.commit.startsWith(B.slice(0, 7)));
if (!session) throw new Error(`Entire holds no session for commit ${B.slice(0, 7)}`);
if (session.id !== answer.session_id) throw new Error('the session Entire ties to the commit is not the one in --answer');
const committed = (await git(['show', '-s', '--format=%cI', B])).trim();
let recalled = 0;
const calls = new Set<string>();
for (const l of readFileSync(resolve(args.transcript!), 'utf8').split('\n')) {
  if (!l.includes('brain recall') && !l.includes('tool_result')) continue;
  let o: { message?: { content?: unknown } };
  try {
    o = JSON.parse(l);
  } catch {
    continue;
  }
  for (const b of (Array.isArray(o.message?.content) ? o.message!.content : []) as { type: string; id?: string; name?: string; input?: { command?: string }; tool_use_id?: string; content?: unknown }[]) {
    if (b.type === 'tool_use' && b.name === 'Bash' && /entire brain recall/.test(b.input?.command ?? '')) calls.add(b.id!);
    if (b.type === 'tool_result' && calls.has(b.tool_use_id!)) {
      const text = typeof b.content === 'string' ? b.content : (b.content as { text?: string }[]).map((x) => x.text ?? '').join('');
      try {
        recalled += (JSON.parse(text) as { facts: { text: string }[] }).facts.filter((f) => f.text.startsWith('Review ruling')).length;
      } catch {
        /* the call printed something else */
      }
    }
  }
}

/* ---------- the unnoticed changes on the lines sent back, tried again ---------- */

const retried: NonNullable<Followup['retried']> = [];
const again = points.flatMap((p) => {
  const it = back.find((x) => x.id === p.id)!;
  return (before.evidence.stops[it.stopId]?.changes.survived ?? []).filter((s) => s.file === p.file && s.line >= p.from && s.line <= p.to);
});
if (again.length) {
  const headDir = mkdtempSync(join(tmpdir(), 'rb-followup-'));
  try {
    await exec('sh', ['-c', 'git -C "$1" archive "$2" | tar -x -C "$3"', 'sh', repo, B, headDir], { check: true });
    const sb = await prepareSandbox({ repo, headDir, workDir: `/bulk3/runs/readback/followup/${B.slice(0, 7)}`, image: 'oven/bun:1', testCmd: ['bun', 'test'] });
    for (const s of again) {
      // the line must be the same line in the new commit, or the change is not the same change
      const now = readFileSync(join(headDir, s.file), 'utf8').split('\n')[s.line - 1];
      if (now?.trim() !== s.original.trim()) {
        log('retry', `${s.file}:${s.line} is another line at ${B.slice(0, 7)}: not tried`);
        continue;
      }
      const run = await runTests(sb, `retry-${s.file.replace(/\W+/g, '-')}-${s.line}`, { file: s.file, line: s.line, text: s.changed });
      log('retry', `${s.file}:${s.line} -> ${run.failed.length} failed, ${run.passed.length} passed, exit ${run.code}`);
      if (run.code === 124 || (!run.failed.length && run.code !== 0)) continue;
      retried.push({ file: s.file, line: s.line, changed: s.changed.trim(), before: 'unnoticed', now: run.failed.length ? 'noticed' : 'unnoticed', ...(run.failed.length ? { failed: run.failed } : {}) });
    }
  } finally {
    rmSync(headDir, { recursive: true, force: true });
  }
}

/* ---------- write ---------- */

const followup: Followup = {
  schema: 1,
  headSha: B,
  earlier: {
    pr: before.tour.pr.number,
    url: before.tour.pr.url,
    headSha: A,
    who: row.who ?? row.name ?? 'a reviewer',
    at: row.at,
    seconds: row.seconds,
    questions: Number(/^(\d+) of/.exec(row.checks?.find((c) => c.id === 'questions')?.text ?? '')?.[1] ?? 0),
    reads: row.reads,
    stops: before.tour.stops.length,
    lines: before.tour.stops.reduce((n, s) => n + linesOf(s), 0),
    closely: row.lines,
    ours: !!row.ours,
    href: '/full',
  },
  issue: { number: Number(args.issue), url: `https://github.com/${tour.pr.repo}/issues/${Number(args.issue)}` },
  points,
  accepted: before.evidence.rulings.filter((it) => row.rulings?.[it.id]?.decision === 'accept').length,
  answer: {
    commit: B,
    at: committed,
    session: session.id,
    model: session.model,
    turns: answer.num_turns,
    seconds: Math.round(answer.duration_ms / 1000),
    tokens: session.tokens.total,
    minutesAfter: Math.round((Date.parse(committed) - Date.parse(row.at)) / 6000) / 10,
    recalled,
    tests: { before: before.evidence.tests.passed, after: evidence.tests.passed },
    added: tour.pr.additions,
    removed: tour.pr.deletions,
  },
  untouched: { stops: still.length, of: before.tour.stops.length, lines: still.reduce((n, s) => n + linesOf(s), 0) },
  touched: touched.map((s) => ({ id: s.id, title: s.title })),
  ...(retried.length ? { retried } : {}),
};
writeFileSync(resolve(args.dir!, 'followup.json'), JSON.stringify(followup, null, 1) + '\n');

// one open point per point sent back, on the stop that serves its criterion: the reviewer rules whether it is answered
const answers: RulingItem[] = points.flatMap((p) => {
  const stop = tour.stops.find((s) => evidence.stops[s.id]?.criteria.includes(p.n)) ?? tour.stops.find((s) => s.blocks.some((b) => b.type === 'code' && b.file === p.file));
  const code = (stop?.blocks.filter((b) => b.type === 'code') ?? []) as CodeBlock[];
  // the first run of added lines of the stop, in the file of the point when the stop shows it
  const block = code.find((b) => b.file === p.file && b.lines.some((l) => l.kind === 'add')) ?? code.find((b) => b.lines.some((l) => l.kind === 'add'));
  if (!stop || !block) {
    log('answers', `no stop of the follow-up serves criterion ${p.n} (${p.id}): it gets no open point`);
    return [];
  }
  const adds = block.lines.filter((l) => l.kind === 'add' && l.n !== null).map((l) => l.n!);
  let to = adds[0]!;
  while (adds.includes(to + 1)) to++;
  return [{ id: `answer-${p.id}`, kind: 'answer' as const, stopId: stop.id, file: block.file, from: adds[0]!, to, found: `A reviewer sent this back at \`${p.file}:${p.from}\` of commit ${A.slice(0, 7)}: “${p.note}” This stop is the author's answer.`, question: 'Does this commit do what the reviewer asked?' }];
});
evidence.rulings = [...evidence.rulings.filter((r) => r.kind !== 'answer'), ...answers];
writeFileSync(resolve(args.dir!, 'evidence.json'), JSON.stringify(evidence, null, 1) + '\n');
log('followup', `${points.length} points sent back, ${answers.length} come back as open points · ${still.length} of ${before.tour.stops.length} earlier stops untouched · ${retried.length} unnoticed changes tried again: ${retried.filter((r) => r.now === 'noticed').length} now noticed · answer ${followup.answer.minutesAfter} min after the signature, ${followup.answer.tokens} tokens, ${recalled} rulings recalled`);
