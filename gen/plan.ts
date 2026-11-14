/**
 * bun gen/plan.ts --repo <dir> --base <ref> --head <ref> --pr <owner/name#n> --out <dir>
 *
 * Pull request -> Plan (shared/tour.ts), written to <out>/plan.json, with a step log in <out>/gen.log.jsonl.
 *
 *   1. tour      one model session reads the diff, the issue and the head checkout and writes intro + stops
 *   2. validate  in code: files, ranges, answers, ids, diagrams, coverage. One repair round, then fail loudly
 *   3. plants    another model proposes one-line bugs; each is proven by the project's own tests in Docker
 *                and checked once more so that no planted line changes the answer to a question
 *   4. write     plan.json
 *
 * Options
 *   --issue <n>            issue the pull request answers (default: the one the pull request closes)
 *   --author <name>        shown as the author (default: author of the head commit)
 *   --agent true|false     authorIsAgent (default: guessed from the author)
 *   --cover <globs>        comma list of files whose changed lines must all be on the tour
 *                          (default: changed code files that are not tests)
 *   --tour-model <id>      default claude-fable-5-2
 *   --plant-model <id>     default claude-opus-5-5
 *   --image <name>         Docker image for the tests (default oven/bun:1)
 *   --test-cmd "<cmd>"     test command inside the image (default "bun test")
 *   --resume               reuse model answers of an earlier run with the same prompts (kept in the scratch folder)
 *
 * The repository at --repo is only read. Checkouts and sandboxes live under RB_BULK (/bulk3/runs/readback).
 * The pull request is untrusted: models get read-only tools, and its code runs only in Docker without network.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { Plan, PlanCodeBlock, PlanStop, Plant, PrInfo } from '../shared/tour';
import { type AgentResult, runAgent } from './lib/agent';
import { JUDGE_SYSTEM, PLANT_SYSTEM, REPAIR_NOTE, TOUR_SYSTEM } from './lib/prompts';
import { prepareSandbox, runTests, type Sandbox } from './lib/sandbox';
import { ensureDir, exec, log, pool, ranges } from './lib/util';
import { absorbBlankLines, checkTour, coverageOf, type Issue, type RepoView, spreadAnswers } from './lib/validate';

/* ---------- arguments ---------- */

const argv = process.argv.slice(2);
const args: Record<string, string> = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (!a.startsWith('--')) continue;
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('--')) args[a.slice(2)] = 'true';
  else args[a.slice(2)] = argv[++i]!;
}
const prRef = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(args.pr ?? '');
if (!args.repo || !args.base || !args.head || !prRef || !args.out) {
  console.error('usage: bun gen/plan.ts --repo <dir> --base <ref> --head <ref> --pr <owner/name#n> --out <dir> [--resume]');
  process.exit(2);
}
const REPO = resolve(args.repo);
const OUT = ensureDir(resolve(args.out));
const TOUR_MODEL = args['tour-model'] || 'claude-fable-5-2';
const PLANT_MODEL = args['plant-model'] || 'claude-opus-5-5';
const IMAGE = args.image || 'oven/bun:1';
const TEST_CMD = (args['test-cmd'] || 'bun test').split(/\s+/);
const BULK = resolve(process.env.RB_BULK || '/bulk3/runs/readback');
const CANDIDATES = 8;
const KEEP = 3;

const t0 = Date.now();
const LOG = join(OUT, 'gen.log.jsonl');
writeFileSync(LOG, '');
function step(name: string, data: Record<string, unknown>) {
  appendFileSync(LOG, JSON.stringify({ step: name, at: new Date().toISOString(), ...data }) + '\n');
}
function die(msg: string): never {
  step('failed', { error: msg, totalMs: Date.now() - t0, costUsd: round(cost) });
  console.error(`\nplan.ts FAILED: ${msg}\n`);
  process.exit(1);
}
const round = (n: number) => Math.round(n * 10000) / 10000;
let cost = 0;

async function git(a: string[]): Promise<string> {
  return (await exec('git', ['-C', REPO, ...a], { check: true })).stdout;
}

/* ---------- the two commits ---------- */

const headSha = (await git(['rev-parse', '--verify', `${args.head}^{commit}`])).trim();
// like GitHub: the change is measured from where the branch left the base, not from the tip of the base
const baseSha = (await git(['merge-base', args.base, headSha])).trim();
const baseTip = (await git(['rev-parse', '--verify', `${args.base}^{commit}`])).trim();

const SCRATCH = ensureDir(join(BULK, `${basename(OUT)}-${headSha.slice(0, 7)}`));
const HEAD_DIR = join(SCRATCH, 'head');
const STEPS = ensureDir(join(SCRATCH, 'steps'));

/** A plain copy of the head commit (no .git): `git archive` only reads the repository. */
async function checkoutHead() {
  const marker = join(SCRATCH, 'head.sha');
  if (existsSync(HEAD_DIR) && existsSync(marker) && readFileSync(marker, 'utf8').trim() === headSha) return;
  if (!HEAD_DIR.startsWith(BULK + '/')) throw new Error('scratch folder is outside RB_BULK');
  rmSync(HEAD_DIR, { recursive: true, force: true });
  ensureDir(HEAD_DIR);
  const tar = join(SCRATCH, 'head.tar');
  await git(['archive', '--format=tar', '-o', tar, headSha]);
  await exec('tar', ['-xf', tar, '-C', HEAD_DIR], { check: true });
  rmSync(tar, { force: true });
  writeFileSync(marker, headSha);
}
await checkoutHead();
const HEAD_REAL = realpathSync(HEAD_DIR);

const fileCache = new Map<string, string[] | null>();
function headLines(file: string): string[] | null {
  if (fileCache.has(file)) return fileCache.get(file)!;
  let out: string[] | null = null;
  try {
    const p = realpathSync(resolve(HEAD_DIR, file));
    if (file && p.startsWith(HEAD_REAL + '/')) {
      const rows = readFileSync(p, 'utf8').split('\n');
      if (rows[rows.length - 1] === '') rows.pop();
      out = rows;
    }
  } catch {
    out = null;
  }
  fileCache.set(file, out);
  return out;
}

/* ---------- what the pull request changed ---------- */

const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|swift|php|cs|vue|svelte)$/;
const TEST = /(^|\/)(tests?|__tests__|specs?|e2e)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$/;
const isTest = (f: string) => TEST.test(f);

const changedFiles = (await git(['diff', '--name-only', baseSha, headSha])).split('\n').filter(Boolean);
const changed = new Map<string, number[]>();
for (const f of changedFiles) {
  if (!headLines(f)) continue; // removed by the pull request, or binary
  const lines: number[] = [];
  const out = await git(['diff', '-U0', '--no-color', baseSha, headSha, '--', f]);
  for (const m of out.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    for (let i = 0; i < count; i++) lines.push(start + i);
  }
  if (lines.length) changed.set(f, lines);
}
const coverGlobs = args.cover ? args.cover.split(',').map((g) => new Bun.Glob(g.trim())) : null;
const mustCover = [...changed.keys()].filter((f) => (coverGlobs ? coverGlobs.some((g) => g.match(f)) : CODE.test(f) && !isTest(f)));
const testFiles = [...changed.keys()].filter((f) => CODE.test(f) && isTest(f));
const repoView: RepoView = { lines: headLines, changed, mustCover };

const shortstat = (await git(['diff', '--shortstat', baseSha, headSha])).trim();
const additions = Number(/(\d+) insertion/.exec(shortstat)?.[1] ?? 0);
const deletions = Number(/(\d+) deletion/.exec(shortstat)?.[1] ?? 0);
const unified = await git(['diff', '--no-color', baseSha, headSha]);

/* ---------- the pull request on GitHub ---------- */

async function gh<T>(a: string[]): Promise<T | null> {
  const r = await exec('gh', a, { timeoutMs: 60_000 }).catch(() => null);
  if (!r || r.code !== 0) {
    log('github', `gh ${a.slice(0, 3).join(' ')} failed: ${(r?.stderr ?? '').trim().slice(0, 200)}`);
    return null;
  }
  return JSON.parse(r.stdout) as T;
}

async function prInfo(): Promise<{ pr: PrInfo; liveHead: string | null }> {
  const [, repo, num] = prRef!;
  const number = Number(num);
  const v = await gh<{ title: string; url: string; body: string; headRefOid: string; author: { login: string; is_bot: boolean }; closingIssuesReferences?: { number: number }[] }>([
    'pr',
    'view',
    String(number),
    '--repo',
    repo!,
    '--json',
    'title,url,body,headRefOid,author,closingIssuesReferences',
  ]);
  const [commitAuthor, commitEmail, subject] = (await git(['log', '-1', '--format=%an%x00%ae%x00%s', headSha])).trim().split('\0');
  const author = args.author || commitAuthor || v?.author.login || 'unknown';
  const guess = Boolean(v?.author.is_bot) || /\b(agent|bot|claude|codex|copilot|devin|cursor)\b/i.test(`${commitAuthor} ${commitEmail}`) || /\[bot\]/.test(v?.author.login ?? '');
  const issueNo = Number(args.issue) || v?.closingIssuesReferences?.[0]?.number || Number(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i.exec(v?.body ?? '')?.[1]) || 0;
  const iss = issueNo ? await gh<{ number: number; title: string; url: string; body: string }>(['issue', 'view', String(issueNo), '--repo', repo!, '--json', 'number,title,url,body']) : null;
  const pr: PrInfo = {
    repo: repo!,
    number,
    title: v?.title || subject || `Pull request ${number}`,
    url: v?.url || `https://github.com/${repo}/pull/${number}`,
    author,
    authorIsAgent: args.agent ? args.agent === 'true' : guess,
    baseSha,
    headSha,
    additions,
    deletions,
    files: changedFiles.length,
    ...(iss ? { issue: { number: iss.number, title: iss.title, url: iss.url, body: iss.body.replace(/\r\n/g, '\n').trim() } } : {}),
  };
  return { pr, liveHead: v?.headRefOid ?? null };
}
const { pr, liveHead } = await prInfo();

const warnings: string[] = [];
if (liveHead && liveHead !== headSha) warnings.push(`GitHub says the head of ${pr.repo}#${pr.number} is ${liveHead.slice(0, 7)}; this plan is made for ${headSha.slice(0, 7)}`);
if (baseTip !== baseSha) warnings.push(`${args.base} is at ${baseTip.slice(0, 7)}; the change is measured from the merge base ${baseSha.slice(0, 7)}`);
if (!pr.issue) warnings.push('no issue found for this pull request; the tour is written from the code alone');
for (const w of warnings) log('setup', `WARNING: ${w}`);
log('setup', `${pr.repo}#${pr.number} ${baseSha.slice(0, 7)}..${headSha.slice(0, 7)} · ${changedFiles.length} files +${additions} -${deletions} · must cover: ${mustCover.join(', ')}`);
step('setup', {
  repo: REPO,
  pr: `${pr.repo}#${pr.number}`,
  baseSha,
  headSha,
  scratch: SCRATCH,
  files: changedFiles.length,
  additions,
  deletions,
  mustCover: mustCover.map((f) => ({ file: f, changed: changed.get(f)!.length })),
  testFiles,
  warnings,
  ms: Date.now() - t0,
});

/* ---------- model sessions, kept so that --resume does not pay twice ---------- */

async function ask<T>(name: string, o: { system: string; prompt: string; schema: object; model: string; timeoutMs?: number }): Promise<AgentResult<T> & { reused: boolean }> {
  const hash = createHash('sha256').update(JSON.stringify([o.model, o.system, o.prompt, o.schema])).digest('hex').slice(0, 16);
  const file = join(STEPS, `${name}.json`);
  if (args.resume && existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    if (saved.hash === hash) {
      log('agent', `${name}: reusing the saved answer`);
      cost += saved.result.costUsd;
      return { ...saved.result, reused: true };
    }
  }
  writeFileSync(join(STEPS, `${name}.prompt.md`), `${o.system}\n\n=====\n\n${o.prompt}`);
  const result = await runAgent<T>({ name, system: o.system, prompt: o.prompt, schema: o.schema, model: o.model, cwd: HEAD_DIR, effort: 'high', timeoutMs: o.timeoutMs });
  writeFileSync(file, JSON.stringify({ hash, result }, null, 1));
  cost += result.costUsd;
  return { ...result, reused: false };
}

/* ---------- step 1: the tour ---------- */

function listing(file: string, mark: (n: number) => string): string {
  const lines = headLines(file) ?? [];
  const w = String(lines.length).length;
  return `<file path="${file}" lines="${lines.length}">\n${lines.map((l, i) => `${String(i + 1).padStart(w)} ${mark(i + 1)} ${l}`).join('\n')}\n</file>`;
}

const kindOf = (f: string) => (mustCover.includes(f) ? 'source, every changed line must be on the tour' : isTest(f) ? 'test' : 'other');
const material = [
  `# Pull request\n${pr.repo}#${pr.number}, base ${baseSha.slice(0, 7)}, head ${headSha.slice(0, 7)}. ${changedFiles.length} files changed, ${additions} lines added, ${deletions} removed.`,
  pr.issue ? `# Issue ${pr.issue.number}: ${pr.issue.title}\n<issue>\n${pr.issue.body}\n</issue>` : '# Issue\nThere is no issue text for this pull request.',
  `# Changed files\n${changedFiles.map((f) => `- ${f} (${headLines(f) ? `${changed.get(f)?.length ?? 0} lines added or changed; ${kindOf(f)}` : 'removed'})`).join('\n')}`,
  `# Lines that must be on the tour\nEvery one of these head line numbers must be inside a code block.\n${mustCover.map((f) => `- ${f}: ${ranges(changed.get(f)!)}`).join('\n')}`,
  `# Unified diff, base to head\n<diff>\n${unified}\n</diff>`,
  `# Changed code files at the head commit\nEach line: number, "+" if the pull request added or changed it, then the text.\n\n${[...mustCover, ...testFiles].map((f) => listing(f, (n) => (changed.get(f)!.includes(n) ? '+' : ' '))).join('\n\n')}`,
].join('\n\n');

const noteSchema = { type: 'object', properties: { line: { type: 'integer' }, text: { type: 'string' } }, required: ['line', 'text'] };
const blockSchema = {
  type: 'object',
  description: 'prose: type + text. code: type + file + from + to (+ notes). diagram: type + title + nodes + edges.',
  properties: {
    type: { type: 'string', enum: ['prose', 'code', 'diagram'] },
    text: { type: 'string' },
    file: { type: 'string' },
    from: { type: 'integer' },
    to: { type: 'integer' },
    notes: { type: 'array', items: noteSchema },
    title: { type: 'string' },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, label: { type: 'string' }, sub: { type: 'string' }, role: { type: 'string', enum: ['new', 'changed', 'existing', 'outside'] } },
        required: ['id', 'label', 'role'],
      },
    },
    edges: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' } }, required: ['from', 'to'] } },
  },
  required: ['type'],
};
const questionSchema = {
  type: 'object',
  properties: {
    prompt: { type: 'string' },
    options: { type: 'array', items: { type: 'string' } },
    answer: { type: 'integer', description: 'index of the right option, from 0' },
    explain: { type: 'string' },
    reread: { type: 'object', properties: { file: { type: 'string' }, from: { type: 'integer' }, to: { type: 'integer' } }, required: ['file', 'from', 'to'] },
  },
  required: ['prompt', 'options', 'answer', 'explain', 'reread'],
};
const stopSchema = {
  type: 'object',
  properties: { id: { type: 'string' }, title: { type: 'string' }, why: { type: 'string' }, blocks: { type: 'array', items: blockSchema }, questions: { type: 'array', items: questionSchema } },
  required: ['id', 'title', 'why', 'blocks', 'questions'],
};
const tourSchema = { type: 'object', properties: { intro: { type: 'string' }, stops: { type: 'array', items: stopSchema }, security: { type: 'string' } }, required: ['intro', 'stops'] };
const repairSchema = { type: 'object', properties: { full: { type: 'boolean' }, intro: { type: 'string' }, stops: { type: 'array', items: stopSchema }, security: { type: 'string' } }, required: ['full', 'stops'] };

interface RawTour {
  intro: string;
  stops: any[];
  security?: string;
}

const tour = await ask<RawTour>('tour', { system: TOUR_SYSTEM, prompt: `${material}\n\nWrite the tour.`, schema: tourSchema, model: TOUR_MODEL, timeoutMs: 45 * 60_000 });
step('tour', { model: tour.model, ms: tour.durationMs, costUsd: round(tour.costUsd), turns: tour.turns, reused: tour.reused, stops: tour.out.stops?.length ?? 0, security: tour.out.security || '' });

/* ---------- step 2: validate, one repair round ---------- */

const fmt = (i: Issue) => `- ${i.where}: ${i.msg}`;
let raw: RawTour = tour.out;
let checked = checkTour(raw, repoView);
let errors = checked.issues.filter((i) => i.level === 'error');
step('validate', { round: 1, ok: errors.length === 0, errors: errors.map(fmt), warnings: checked.issues.filter((i) => i.level === 'warn').map(fmt) });
log('validate', errors.length ? `${errors.length} problems:\n${errors.map(fmt).join('\n')}` : 'tour is valid');

if (errors.length) {
  const fix = await ask<{ full: boolean; intro?: string; stops: any[]; security?: string }>('tour-repair', {
    system: `${TOUR_SYSTEM}\n\n${REPAIR_NOTE}`,
    prompt: `${material}\n\n# Your earlier answer\n<answer>\n${JSON.stringify({ intro: raw.intro, stops: raw.stops }, null, 1)}\n</answer>\n\n# What is wrong\n${checked.issues.map(fmt).join('\n')}\n\nReturn the corrected stops.`,
    schema: repairSchema,
    model: TOUR_MODEL,
    timeoutMs: 45 * 60_000,
  });
  const byId = new Map((fix.out.stops ?? []).map((s) => [String(s?.id), s]));
  const known = new Set(raw.stops.map((s) => String(s?.id)));
  const merged = fix.out.full || [...byId.keys()].some((id) => !known.has(id)) ? fix.out.stops : raw.stops.map((s) => byId.get(String(s?.id)) ?? s);
  raw = { intro: fix.out.intro?.trim() ? fix.out.intro : raw.intro, stops: merged };
  checked = checkTour(raw, repoView);
  errors = checked.issues.filter((i) => i.level === 'error');
  step('repair', { model: fix.model, ms: fix.durationMs, costUsd: round(fix.costUsd), turns: fix.turns, reused: fix.reused, full: fix.out.full, returned: [...byId.keys()], security: fix.out.security || '' });
  step('validate', { round: 2, ok: errors.length === 0, errors: errors.map(fmt), warnings: checked.issues.filter((i) => i.level === 'warn').map(fmt) });
  if (errors.length) die(`the tour is still wrong after one repair round:\n${errors.map(fmt).join('\n')}`);
  log('validate', 'tour is valid after one repair round');
}

const stops: PlanStop[] = checked.stops;
const joined = absorbBlankLines(stops, repoView);
const moved = spreadAnswers(stops);
const cover = coverageOf(stops, repoView, mustCover);
const coverAll = coverageOf(stops, repoView, [...changed.keys()]);
const nQuestions = stops.reduce((a, s) => a + s.questions.length, 0);
step('tidy', { blankLinesJoined: joined, answersMoved: moved, answerPositions: [0, 1, 2, 3].map((i) => stops.flatMap((s) => s.questions).filter((q) => q.answer === i).length), coverage: cover, coverageAllFiles: { changed: coverAll.changed, onTour: coverAll.onTour } });
log('validate', `${stops.length} stops, ${nQuestions} questions · source lines on the tour: ${cover.onTour}/${cover.changed} · all changed lines: ${coverAll.onTour}/${coverAll.changed}`);
if (cover.onTour !== cover.changed) log('validate', `WARNING: ${cover.changed - cover.onTour} blank changed lines are not next to any block`);

/* ---------- step 3: planted bugs, each proven by the tests ---------- */

interface Candidate {
  file: string;
  line: number;
  original: string;
  planted: string;
  what: string;
  kind?: string;
  test?: string;
}
interface Verdict {
  c: Candidate;
  round: number;
  stopId: string;
  hasNote: boolean;
  failedTests: string[];
  /** why it was dropped; empty when proven */
  why: string;
}

const codeBlocks = stops.flatMap((s) => s.blocks.filter((b): b is PlanCodeBlock => b.type === 'code').map((b) => ({ stop: s.id, b })));
const blockOf = (file: string, line: number) => codeBlocks.find((x) => x.b.file === file && x.b.from <= line && line <= x.b.to);
const inReread = (file: string, line: number) => stops.some((s) => s.questions.some((q) => q.reread.file === file && q.reread.from <= line && line <= q.reread.to));
const hasNote = (file: string, line: number) => codeBlocks.some((x) => x.b.file === file && x.b.notes?.some((n) => n.line === line));
const strip = (s: string) => s.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '').replace(/\s+/g, '');
const allowed = (file: string, line: number) => {
  const text = headLines(file)?.[line - 1] ?? '';
  return mustCover.includes(file) && changed.get(file)!.includes(line) && Boolean(blockOf(file, line)) && !inReread(file, line) && strip(text).length > 2 && !/^\s*(\/\/|\/\*|\*)/.test(text);
};
const plantFiles = mustCover.filter((f) => changed.get(f)!.some((n) => allowed(f, n)));

function tourForPlants(): string {
  return stops
    .map((s, i) => {
      const blocks = s.blocks.map((b) =>
        b.type === 'prose'
          ? `  prose: ${b.text}`
          : b.type === 'code'
            ? `  code: ${b.file}:${b.from}-${b.to}${b.notes?.length ? `\n${b.notes.map((n) => `    note on line ${n.line}: ${n.text}`).join('\n')}` : ''}`
            : `  diagram: ${b.title}: ${b.nodes.map((n) => n.label).join(' -> ')}`,
      );
      const qs = s.questions.map((q) => `  question: ${q.prompt}\n    right answer: ${q.options[q.answer]}\n    settled by ${q.reread.file}:${q.reread.from}-${q.reread.to}`);
      return `## Stop ${i + 1} (${s.id}): ${s.title}\n  why: ${s.why}\n${[...blocks, ...qs].join('\n')}`;
    })
    .join('\n\n');
}

const plantSchema = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: { file: { type: 'string' }, line: { type: 'integer' }, original: { type: 'string' }, planted: { type: 'string' }, what: { type: 'string' }, kind: { type: 'string' }, test: { type: 'string' } },
        required: ['file', 'line', 'original', 'planted', 'what'],
      },
    },
    security: { type: 'string' },
  },
  required: ['candidates'],
};

function plantPrompt(n: number, earlier: Verdict[]): string {
  const dropped = earlier.filter((v) => v.why);
  const kept = earlier.filter((v) => !v.why);
  return [
    `# The tour the reader follows\n${tourForPlants()}`,
    `# Test files in the working folder\n${testFilesAtHead.map((f) => `- ${f}`).join('\n') || '- none found; look for them'}\nThe tests are run with: ${TEST_CMD.join(' ')}`,
    `# Source files at the head commit\nEach line: number, a marker, then the text. ">" = you may plant here. "n" = you may plant here, but a note is pinned to this line, so prefer another. No marker = not allowed (unchanged line, a line that settles a question, or a line that is not on the tour).\n\n${plantFiles.map((f) => listing(f, (ln) => (allowed(f, ln) ? (hasNote(f, ln) ? 'n' : '>') : ' '))).join('\n\n')}`,
    ...(earlier.length
      ? [
          `# Earlier candidates\nThese were checked already. Do not propose them again.\n${dropped.map((v) => `- DROPPED ${v.c.file}:${v.c.line}  \`${v.c.planted.trim()}\`  because: ${v.why}`).join('\n')}${kept.length ? `\n${kept.map((v) => `- kept ${v.c.file}:${v.c.line} (a test caught it); do not use this line again`).join('\n')}` : ''}\nLearn from the dropped ones: choose lines whose effect a test asserts directly.`,
        ]
      : []),
    `Propose ${n} candidates.`,
  ].join('\n\n');
}

function staticCheck(c: Candidate, taken: Set<string>): string {
  const lines = headLines(c.file);
  if (!lines) return 'the file does not exist at the head commit';
  if (!mustCover.includes(c.file)) return 'the file is not a source file of this change';
  if (!Number.isInteger(c.line) || c.line < 1 || c.line > lines.length) return 'the line number is outside the file';
  if (typeof c.original !== 'string' || typeof c.planted !== 'string' || /[\r\n]/.test(c.planted)) return 'planted must be exactly one line';
  if (lines[c.line - 1] !== c.original) {
    // the right line with the wrong number or indentation: take the line from the file, never from the model
    const hits = lines.map((l, i) => (l.trim() === c.original.trim() ? i + 1 : 0)).filter(Boolean);
    if (lines[c.line - 1]!.trim() !== c.original.trim() && hits.length !== 1) return `original is not line ${c.line} of the file`;
    if (lines[c.line - 1]!.trim() !== c.original.trim()) c.line = hits[0]!;
    c.original = lines[c.line - 1]!;
    c.planted = c.original.match(/^\s*/)![0] + c.planted.trim();
  }
  if (!changed.get(c.file)!.includes(c.line)) return 'the pull request did not add or change this line';
  if (!blockOf(c.file, c.line)) return 'the line is not inside a code block of the tour';
  if (inReread(c.file, c.line)) return 'the line is inside the reread range of a question';
  if (c.planted === c.original || c.planted.trim() === c.original.trim()) return 'planted is the same as the original';
  if (/^\s*(\/\/|\/\*|\*)/.test(c.original) || strip(c.planted) === strip(c.original)) return 'only a comment or whitespace changed';
  if (taken.has(`${c.file}:${c.line}`)) return 'another candidate already uses this line';
  const ext = c.file.split('.').pop()!;
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'].includes(ext)) {
    const mutated = [...lines];
    mutated[c.line - 1] = c.planted;
    try {
      new Bun.Transpiler({ loader: ext === 'tsx' ? 'tsx' : ext === 'jsx' ? 'jsx' : ext.includes('ts') ? 'ts' : 'js' }).transformSync(mutated.join('\n'));
    } catch (e) {
      return `the file no longer parses: ${String((e as Error).message).split('\n')[0]!.slice(0, 120)}`;
    }
  }
  if (!String(c.what ?? '').trim()) return 'what is empty';
  return '';
}

const testFilesAtHead = [...new Bun.Glob('**/*').scanSync({ cwd: HEAD_DIR, onlyFiles: true })].filter((f) => !f.includes('node_modules/') && CODE.test(f) && isTest(f)).sort();

const sandbox: Sandbox = await prepareSandbox({ repo: REPO, headDir: HEAD_DIR, workDir: join(SCRATCH, 'sandbox'), image: IMAGE, testCmd: TEST_CMD });
const baseline = await runTests(sandbox, 'baseline');
step('tests-baseline', { image: IMAGE, cmd: TEST_CMD.join(' '), network: 'none', modules: sandbox.installed, ms: baseline.ms, exit: baseline.code, passed: baseline.passed.length, failed: baseline.failed });
if (baseline.code !== 0 || baseline.failed.length || !baseline.passed.length) die(`the project's tests do not pass on the head commit as it is (exit ${baseline.code}, ${baseline.passed.length} passed, ${baseline.failed.length} failed):\n${baseline.tail.slice(-800)}`);
log('plants', `head as is: ${baseline.passed.length} tests pass (${(baseline.ms / 1000).toFixed(0)}s)`);
const totalTests = baseline.passed.length;

const judgeSchema = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          candidate: { type: 'integer' },
          conflicts: { type: 'array', items: { type: 'object', properties: { question: { type: 'string' }, why: { type: 'string' } }, required: ['question', 'why'] } },
        },
        required: ['candidate', 'conflicts'],
      },
    },
    security: { type: 'string' },
  },
  required: ['verdicts'],
};

/**
 * A planted line outside a question's reread range can still change that question (a function the question's code
 * calls). Code cannot see that, so one more session traces every question with each proven line in place.
 */
async function judge(roundNo: number, list: Verdict[]) {
  if (!list.length) return;
  const questions = stops
    .flatMap((s) => s.questions.map((q) => `- ${q.id} (stop "${s.title}")\n  ${q.prompt}\n${q.options.map((o, i) => `    ${i === q.answer ? 'RIGHT' : 'wrong'}: ${o}`).join('\n')}\n  settled by ${q.reread.file}:${q.reread.from}-${q.reread.to}`))
    .join('\n');
  const cands = list.map((v, i) => `${i + 1}. ${v.c.file}:${v.c.line}\n   original: ${v.c.original.trim()}\n   planted:  ${v.c.planted.trim()}`).join('\n');
  const files = [...new Set([...list.map((v) => v.c.file), ...stops.flatMap((s) => s.questions.map((q) => q.reread.file))])].filter((f) => mustCover.includes(f));
  const r = await ask<{ verdicts: { candidate: number; conflicts: { question: string; why: string }[] }[]; security?: string }>(`plants-judge-${roundNo}`, {
    system: JUDGE_SYSTEM,
    prompt: [`# Questions of the tour\n${questions}`, `# Candidate planted lines\n${cands}`, `# Source files at the head commit (with the original lines)\n${files.map((f) => listing(f, () => ' ')).join('\n\n')}`, 'Check every candidate against every question.'].join('\n\n'),
    schema: judgeSchema,
    model: PLANT_MODEL,
    timeoutMs: 30 * 60_000,
  });
  const ids = new Set(stops.flatMap((s) => s.questions.map((q) => q.id)));
  const out: { at: string; conflicts: { question: string; why: string }[] }[] = [];
  list.forEach((v, i) => {
    const got = (r.out.verdicts ?? []).find((x) => Number(x.candidate) === i + 1);
    const conflicts = (got?.conflicts ?? []).filter((c) => ids.has(c.question));
    if (!got) v.why = 'the question check gave no verdict for this line';
    else if (conflicts.length) v.why = `it changes the answer to a question (${conflicts.map((c) => `${c.question}: ${c.why}`).join('; ')})`;
    if (v.why) log('plants', `${v.c.file}:${v.c.line} dropped: ${v.why}`);
    out.push({ at: `${v.c.file}:${v.c.line}`, conflicts });
  });
  step('plants-judge', { round: roundNo, model: r.model, ms: r.durationMs, costUsd: round(r.costUsd), turns: r.turns, reused: r.reused, checked: out, security: r.out.security || '' });
}

const verdicts: Verdict[] = [];
async function plantRound(roundNo: number, n: number) {
  const r = await ask<{ candidates: Candidate[]; security?: string }>(`plants-${roundNo}`, { system: PLANT_SYSTEM, prompt: plantPrompt(n, verdicts), schema: plantSchema, model: PLANT_MODEL, timeoutMs: 30 * 60_000 });
  const cands = (r.out.candidates ?? []).map((c) => ({ ...c, file: String(c.file ?? '').replace(/^\.\//, ''), line: Number(c.line) }));
  step('plants-ask', { round: roundNo, model: r.model, ms: r.durationMs, costUsd: round(r.costUsd), turns: r.turns, reused: r.reused, candidates: cands.length, security: r.out.security || '' });
  const taken = new Set(verdicts.map((v) => `${v.c.file}:${v.c.line}`));
  const tv = Date.now();
  const fresh: Verdict[] = cands.map((c) => {
    const why = staticCheck(c, taken);
    if (why) log('plants', `${c.file}:${c.line} dropped before the tests: ${why}`);
    else taken.add(`${c.file}:${c.line}`);
    return { c, round: roundNo, stopId: blockOf(c.file, c.line)?.stop ?? '', hasNote: hasNote(c.file, c.line), failedTests: [], why };
  });
  await pool(
    fresh.filter((v) => !v.why),
    4,
    async (v, i) => {
      const run = await runTests(sandbox, `r${roundNo}-${i}`, { file: v.c.file, line: v.c.line, text: v.c.planted }, Math.max(90_000, baseline.ms * 6));
      const failed = run.failed.filter((t) => !baseline.failed.includes(t));
      if (run.code === 124) v.why = 'the tests did not finish with this line (timed out)';
      else if (run.code === 0 && !failed.length) v.why = 'no test caught it: all tests still pass with this line';
      else if (!failed.length) v.why = `the test run broke without a failing test (exit ${run.code}): ${run.tail.split('\n').find((l) => /error/i.test(l))?.slice(0, 160) ?? ''}`;
      else if (failed.length > Math.max(8, totalTests * 0.4)) v.why = `${failed.length} of ${totalTests} tests fail with this line: that is a crash, not a hidden bug`;
      else v.failedTests = failed;
      log('plants', `${v.c.file}:${v.c.line} ${v.why ? `dropped: ${v.why}` : `proven: ${failed.length} test${failed.length === 1 ? '' : 's'} fail`}`);
    },
  );
  const msTests = Date.now() - tv;
  await judge(roundNo, fresh.filter((v) => !v.why));
  verdicts.push(...fresh);
  step('plants-verify', {
    round: roundNo,
    ms: msTests,
    proven: fresh.filter((v) => !v.why).map((v) => ({ at: `${v.c.file}:${v.c.line}`, stop: v.stopId, kind: v.c.kind ?? '', original: v.c.original, planted: v.c.planted, failedTests: v.failedTests })),
    rejected: fresh.filter((v) => v.why).map((v) => ({ at: `${v.c.file}:${v.c.line}`, kind: v.c.kind ?? '', original: v.c.original, planted: v.c.planted, why: v.why, ...(v.failedTests.length ? { failedTests: v.failedTests } : {}) })),
  });
}

await plantRound(1, CANDIDATES);
if (verdicts.filter((v) => !v.why).length < 2) {
  log('plants', 'fewer than 2 proven; asking once more');
  await plantRound(2, CANDIDATES);
}

/**
 * Up to KEEP. Lines without a note first, then the order the model gave (best first). Each next one is taken from
 * a stop and a file not used yet where possible, and as far along the tour from the ones already taken as possible,
 * so that a second read cannot be passed by looking where the first planted line was.
 */
function choose(proven: Verdict[]): Verdict[] {
  const order = [...proven].sort((a, b) => Number(a.hasNote) - Number(b.hasNote));
  const out: Verdict[] = [];
  const at = (v: Verdict) => stops.findIndex((s) => s.id === v.stopId);
  const score = (v: Verdict) =>
    (out.some((o) => o.stopId === v.stopId) ? 0 : 200) + (out.some((o) => o.c.file === v.c.file) ? 0 : 100) + Math.min(99, ...out.map((o) => Math.abs(at(o) - at(v))));
  while (out.length < KEEP && order.length) {
    let best = 0;
    if (out.length) for (let i = 1; i < order.length; i++) if (score(order[i]!) > score(order[best]!)) best = i;
    out.push(order.splice(best, 1)[0]!);
  }
  return out;
}
const proven = verdicts.filter((v) => !v.why);
const chosen = choose(proven);
const plants: Plant[] = chosen.map((v) => ({
  id: `plant-${basename(v.c.file).replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${v.c.line}`,
  file: v.c.file,
  line: v.c.line,
  original: v.c.original,
  planted: v.c.planted,
  what: v.c.what.trim(),
  failedTests: v.failedTests,
}));
step('plants-choose', { proven: proven.length, kept: chosen.map((v) => ({ at: `${v.c.file}:${v.c.line}`, stop: v.stopId })), notKept: proven.filter((v) => !chosen.includes(v)).map((v) => ({ at: `${v.c.file}:${v.c.line}`, stop: v.stopId, why: 'proven, but three others were kept' })) });

/* ---------- step 4: write ---------- */

const plan: Plan = { schema: 1, pr, intro: checked.intro, stops, plants, madeBy: { model: TOUR_MODEL, costUsd: round(cost), at: new Date().toISOString(), plantModel: PLANT_MODEL } };
writeFileSync(join(OUT, 'plan.json'), JSON.stringify(plan, null, 1) + '\n');
step('write', {
  path: join(OUT, 'plan.json'),
  stops: stops.length,
  questions: nQuestions,
  plants: plants.length,
  coverage: { changed: cover.changed, onTour: cover.onTour },
  costUsd: round(cost),
  totalMs: Date.now() - t0,
  warnings,
});

console.log(`${join(OUT, 'plan.json')}: ${stops.length} stops, ${nQuestions} questions, ${plants.length} planted lines · source lines on the tour ${cover.onTour}/${cover.changed} · $${cost.toFixed(2)} · ${((Date.now() - t0) / 60000).toFixed(1)} min`);
for (const p of plants) console.log(`  ${p.file}:${p.line}\n    - ${p.original.trim()}\n    + ${p.planted.trim()}\n    fails: ${p.failedTests.join(' | ')}`);
for (const w of warnings) console.log(`  WARNING: ${w}`);
if (plants.length < 2) {
  console.error(`\nplan.ts: only ${plants.length} planted line${plants.length === 1 ? '' : 's'} could be proven by the tests. plan.json is written, but a read needs at least one, and a second read needs another.`);
  process.exit(plants.length ? 0 : 1);
}
process.exit(0);
