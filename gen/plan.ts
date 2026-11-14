/**
 * bun gen/plan.ts --repo <dir> --base <ref> --head <ref> --pr <owner/name#n> --out <dir>
 *
 * Pull request -> Plan (shared/tour.ts), written to <out>/plan.json, with a step log in <out>/gen.log.jsonl.
 *
 *   1. tour      one model session reads the diff, the issue and the head checkout and writes intro + stops
 *   2. validate  in code: files, ranges, answers, ids, diagrams, coverage. One repair round, then fail loudly
 *   3. focus     the tour model marks, per code block, the few lines a person must read closely.
 *                It never sees a planted line, and no planted line is chosen with the marks in view
 *   4. plants    another model proposes one-line bugs (access and money first). Each is kept only when
 *                  - the stop that shows the line already says what the line must do (the quote is checked in code),
 *                  - the project's own tests, in Docker, pass without it and fail with it,
 *                  - a second session finds that it changes no quiz answer and that the quote and the headline hold.
 *                Every line that passes is kept
 *   5. write     plan.json
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
 *   --reuse <dir,dir>      with --resume: also look for saved answers in these scratch folders of other runs
 *   --must-reuse <names>   stop instead of asking again when one of these steps (tour, tour-repair, ...) has no saved answer
 *
 * The repository at --repo is only read. Checkouts and sandboxes live under RB_BULK (/bulk3/runs/readback).
 * The pull request is untrusted: models get read-only tools, and its code runs only in Docker without network.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { Plan, PlanCodeBlock, PlanStop, Plant, PrInfo } from '../shared/tour';
import { type AgentResult, runAgent } from './lib/agent';
import { FOCUS_REPAIR_NOTE, FOCUS_SYSTEM, JUDGE_SYSTEM, PLANT_SYSTEM, REPAIR_NOTE, TOUR_SYSTEM } from './lib/prompts';
import { prepareSandbox, runTests, type Sandbox } from './lib/sandbox';
import { ensureDir, exec, log, pool, ranges } from './lib/util';
import { findStated, headlineProblem, type Kind, KINDS, type StatedSource, stopTexts } from './lib/stated';
import { absorbBlankLines, type CheckedFocus, checkFocus, checkTour, clean, coverageOf, focusCap, type Issue, type RepoView, spreadAnswers } from './lib/validate';

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
/** how many planted lines the first session is asked for, and the second one if fewer than MIN_KEPT pass every check */
const CANDIDATES = 14;
const CANDIDATES_MORE = 10;
const MIN_KEPT = 6;
/** the kinds a bank or hospital reader should meet first; fewer than MIN_STRONG of them kept = one more round only for them */
const STRONG: Kind[] = ['access', 'money'];
const MIN_STRONG = 5;

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
const REUSE = args.reuse && args.reuse !== 'true' ? args.reuse.split(',').map((d) => resolve(d.trim())) : [];
const MUST_REUSE = args['must-reuse'] && args['must-reuse'] !== 'true' ? args['must-reuse'].split(',').map((d) => d.trim()) : [];

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
  if (args.resume)
    for (const f of [file, ...REUSE.map((d) => join(d, 'steps', `${name}.json`))]) {
      if (!existsSync(f)) continue;
      const saved = JSON.parse(readFileSync(f, 'utf8'));
      if (saved.hash !== hash) continue;
      log('agent', `${name}: reusing the saved answer${f === file ? '' : ` from ${f}`}`);
      if (f !== file) writeFileSync(file, JSON.stringify(saved, null, 1));
      cost += saved.result.costUsd;
      return { ...saved.result, reused: true };
    }
  writeFileSync(join(STEPS, `${name}.prompt.md`), `${o.system}\n\n=====\n\n${o.prompt}`);
  if (MUST_REUSE.includes(name)) die(`--must-reuse ${name}: no saved answer fits this prompt (see ${join(STEPS, `${name}.prompt.md`)}). Nothing was asked.`);
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

/* ---------- step 3: focus, the lines a person must read closely ---------- */

/** The stops as the reader sees them, with the code. No questions and no planted lines: this session knows neither. */
function tourForFocus(): string {
  return stops
    .map((s, i) => {
      const blocks = s.blocks.map((b) => {
        if (b.type === 'prose') return `prose: ${b.text}`;
        if (b.type === 'diagram') return `diagram: ${b.title}`;
        const lines = headLines(b.file) ?? [];
        const w = String(b.to).length;
        const ch = changed.get(b.file) ?? [];
        const body = lines.slice(b.from - 1, b.to).map((l, k) => `${String(b.from + k).padStart(w)} ${ch.includes(b.from + k) ? '+' : ' '} ${l}`);
        const notes = (b.notes ?? []).map((n) => `note on line ${n.line}: ${n.text}`);
        return `<code file="${b.file}" from="${b.from}" to="${b.to}">\n${body.join('\n')}\n</code>${notes.length ? `\n${notes.join('\n')}` : ''}`;
      });
      return `## Stop ${i + 1}, id "${s.id}": ${s.title}\nwhy: ${s.why}\nAt most ${focusCap(s)} lines may be marked in this stop.\n\n${blocks.join('\n\n')}`;
    })
    .join('\n\n');
}

const focusSchema = {
  type: 'object',
  properties: {
    focus: {
      type: 'array',
      items: {
        type: 'object',
        properties: { stop: { type: 'string' }, file: { type: 'string' }, from: { type: 'integer' }, to: { type: 'integer' }, why: { type: 'string' } },
        required: ['stop', 'file', 'from', 'to', 'why'],
      },
    },
    security: { type: 'string' },
  },
  required: ['focus'],
};

/**
 * Runs beside the planted-bug step and shares nothing with it: this session never sees a planted line, and the
 * planted-bug sessions never see a mark. The marks are put on the stops only when both are done.
 */
async function focusStep(): Promise<CheckedFocus['ok']> {
  const material = `# The tour\nEach code line: number, "+" if the pull request added or changed it, then the text.\n\n${tourForFocus()}`;
  const first = await ask<{ focus: unknown[]; security?: string }>('focus', { system: FOCUS_SYSTEM, prompt: `${material}\n\nMark the lines.`, schema: focusSchema, model: TOUR_MODEL, timeoutMs: 30 * 60_000 });
  let got = checkFocus(first.out, stops, repoView);
  step('focus', { model: first.model, ms: first.durationMs, costUsd: round(first.costUsd), turns: first.turns, reused: first.reused, returned: first.out.focus?.length ?? 0, valid: got.ok.length, problems: got.issues, security: first.out.security || '' });
  if (got.issues.length) {
    log('focus', `${got.issues.length} problems:\n${got.issues.join('\n')}`);
    const fix = await ask<{ focus: unknown[]; security?: string }>('focus-repair', {
      system: `${FOCUS_SYSTEM}\n\n${FOCUS_REPAIR_NOTE}`,
      prompt: `${material}\n\n# Your earlier answer\n<answer>\n${JSON.stringify({ focus: first.out.focus }, null, 1)}\n</answer>\n\n# What is wrong\n${got.issues.join('\n')}\n\nReturn the corrected list.`,
      schema: focusSchema,
      model: TOUR_MODEL,
      timeoutMs: 30 * 60_000,
    });
    // after the one repair round nothing is sent back: what is still wrong is left out
    got = checkFocus(fix.out, stops, repoView, true);
    step('focus-repair', { model: fix.model, ms: fix.durationMs, costUsd: round(fix.costUsd), turns: fix.turns, reused: fix.reused, returned: fix.out.focus?.length ?? 0, valid: got.ok.length, leftOut: got.issues, security: fix.out.security || '' });
    if (got.issues.length) log('focus', `WARNING: left out after the repair round:\n${got.issues.join('\n')}`);
  }
  return got.ok;
}
const focusJob: Promise<CheckedFocus['ok'] | Error> = focusStep().catch((e) => e as Error);

/* ---------- step 4: planted bugs, each proven by the tests ---------- */

interface Candidate {
  file: string;
  line: number;
  original: string;
  planted: string;
  what: string;
  kind: Kind;
  headline: string;
  stated: string;
  test?: string;
}
interface Verdict {
  c: Candidate;
  round: number;
  stopId: string;
  hasNote: boolean;
  /** where in the stop the stated words were found */
  statedIn: StatedSource | '';
  failedTests: string[];
  failures: NonNullable<Plant['failures']>;
  /** why it was dropped; empty when kept */
  why: string;
}

const codeBlocks = stops.flatMap((s) => s.blocks.filter((b): b is PlanCodeBlock => b.type === 'code').map((b) => ({ stop: s.id, b })));
const blockOf = (file: string, line: number) => codeBlocks.find((x) => x.b.file === file && x.b.from <= line && line <= x.b.to);
const stopsOf = (file: string, line: number) => stops.filter((s) => codeBlocks.some((x) => x.stop === s.id && x.b.file === file && x.b.from <= line && line <= x.b.to));
const inReread = (file: string, line: number) => stops.some((s) => s.questions.some((q) => q.reread.file === file && q.reread.from <= line && line <= q.reread.to));
const hasNote = (file: string, line: number) => codeBlocks.some((x) => x.b.file === file && x.b.notes?.some((n) => n.line === line));
const strip = (s: string) => s.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '').replace(/\s+/g, '');
const allowed = (file: string, line: number) => {
  const text = headLines(file)?.[line - 1] ?? '';
  return mustCover.includes(file) && changed.get(file)!.includes(line) && Boolean(blockOf(file, line)) && !inReread(file, line) && strip(text).length > 2 && !/^\s*(\/\/|\/\*|\*)/.test(text);
};
const plantFiles = mustCover.filter((f) => changed.get(f)!.some((n) => allowed(f, n)));

/** The words of the tour, without the code and without any focus mark. */
function tourText(withQuestions: boolean): string {
  return stops
    .map((s, i) => {
      const blocks = s.blocks.map((b) =>
        b.type === 'prose'
          ? `  prose: ${b.text}`
          : b.type === 'code'
            ? `  code: ${b.file}:${b.from}-${b.to}${b.notes?.length ? `\n${b.notes.map((n) => `    note on line ${n.line}: ${n.text}`).join('\n')}` : ''}`
            : `  diagram: ${b.title}: ${b.nodes.map((n) => n.label).join(' -> ')}`,
      );
      const qs = withQuestions ? s.questions.map((q) => `  question: ${q.prompt}\n    right answer: ${q.options[q.answer]}\n    settled by ${q.reread.file}:${q.reread.from}-${q.reread.to}`) : [];
      return `## Stop ${i + 1} (${s.id})\n  title: ${s.title}\n  why: ${s.why}\n${[...blocks, ...qs].join('\n')}`;
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
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          original: { type: 'string' },
          planted: { type: 'string' },
          kind: { type: 'string', enum: [...KINDS] },
          stated: { type: 'string' },
          what: { type: 'string' },
          headline: { type: 'string' },
          test: { type: 'string' },
        },
        required: ['file', 'line', 'original', 'planted', 'kind', 'stated', 'what', 'headline'],
      },
    },
    security: { type: 'string' },
  },
  required: ['candidates'],
};

function plantPrompt(n: number, earlier: Verdict[], only: Kind[] = []): string {
  const dropped = earlier.filter((v) => v.why);
  const kept = earlier.filter((v) => !v.why);
  return [
    `# The tour the reader follows\nThe words in \`stated\` must come from the stop that shows the line: its title, why, prose or notes as written here, or a comment inside the code lines that stop shows.\n\n${tourText(true)}`,
    `# Test files in the working folder\n${testFilesAtHead.map((f) => `- ${f}`).join('\n') || '- none found; look for them'}\nThe tests are run with: ${TEST_CMD.join(' ')}`,
    `# Source files at the head commit\nEach line: number, a marker, then the text. ">" = you may plant here. "n" = you may plant here, but a note is pinned to this line, so prefer another. No marker = not allowed (unchanged line, a line that settles a question, or a line that is not on the tour).\n\n${plantFiles.map((f) => listing(f, (ln) => (allowed(f, ln) ? (hasNote(f, ln) ? 'n' : '>') : ' '))).join('\n\n')}`,
    ...(earlier.length
      ? [
          `# Earlier candidates\nThese were checked already. Do not propose them again.\n${dropped.map((v) => `- DROPPED ${v.c.file}:${v.c.line}  \`${v.c.planted.trim()}\`  because: ${v.why}`).join('\n')}${kept.length ? `\n${kept.map((v) => `- kept ${v.c.file}:${v.c.line} (${v.c.kind}); do not use this line again`).join('\n')}` : ''}\nLearn from the dropped ones: choose lines whose effect a test asserts directly and whose stop says in words what the line must do.`,
        ]
      : []),
    only.length
      ? `Propose up to ${n} more candidates, this time only of kind ${only.join(' or ')}. Go through every line marked ">" or "n" that limits rows to one workspace, checks an owner, a session or a token, decides what a public link shows, or computes, rounds or prints an amount. The rules are the same: a test must fail, and the stop must already say in words what the line must do. Propose fewer rather than a line that breaks a rule.`
      : `Propose ${n} candidates.`,
  ].join('\n\n');
}

function staticCheck(c: Candidate, taken: Set<string>): { why: string; statedIn: StatedSource | '' } {
  const no = (why: string) => ({ why, statedIn: '' as const });
  const lines = headLines(c.file);
  if (!lines) return no('the file does not exist at the head commit');
  if (!mustCover.includes(c.file)) return no('the file is not a source file of this change');
  if (!Number.isInteger(c.line) || c.line < 1 || c.line > lines.length) return no('the line number is outside the file');
  if (typeof c.original !== 'string' || typeof c.planted !== 'string' || /[\r\n]/.test(c.planted)) return no('planted must be exactly one line');
  if (lines[c.line - 1] !== c.original) {
    // the right line with the wrong number or indentation: take the line from the file, never from the model
    const hits = lines.map((l, i) => (l.trim() === c.original.trim() ? i + 1 : 0)).filter(Boolean);
    if (lines[c.line - 1]!.trim() !== c.original.trim() && hits.length !== 1) return no(`original is not line ${c.line} of the file`);
    if (lines[c.line - 1]!.trim() !== c.original.trim()) c.line = hits[0]!;
    c.original = lines[c.line - 1]!;
    c.planted = c.original.match(/^\s*/)![0] + c.planted.trim();
  }
  if (!changed.get(c.file)!.includes(c.line)) return no('the pull request did not add or change this line');
  if (!blockOf(c.file, c.line)) return no('the line is not inside a code block of the tour');
  if (inReread(c.file, c.line)) return no('the line is inside the reread range of a question');
  if (c.planted === c.original || c.planted.trim() === c.original.trim()) return no('planted is the same as the original');
  if (/^\s*(\/\/|\/\*|\*)/.test(c.original) || strip(c.planted) === strip(c.original)) return no('only a comment or whitespace changed');
  if (taken.has(`${c.file}:${c.line}`)) return no('another candidate already uses this line');
  const ext = c.file.split('.').pop()!;
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'].includes(ext)) {
    const mutated = [...lines];
    mutated[c.line - 1] = c.planted;
    try {
      new Bun.Transpiler({ loader: ext === 'tsx' ? 'tsx' : ext === 'jsx' ? 'jsx' : ext.includes('ts') ? 'ts' : 'js' }).transformSync(mutated.join('\n'));
    } catch (e) {
      return no(`the file no longer parses: ${String((e as Error).message).split('\n')[0]!.slice(0, 120)}`);
    }
  }
  if (!String(c.what ?? '').trim()) return no('what is empty');
  if (!(KINDS as readonly string[]).includes(c.kind)) return no(`kind "${String(c.kind)}" is not one of ${KINDS.join(', ')}`);
  // the stated gate: the words must be in a stop that shows this line, as the reader sees it (planted line in place)
  let found: ReturnType<typeof findStated> = { problem: '' };
  for (const s of stopsOf(c.file, c.line)) {
    found = findStated(c.stated, stopTexts(s, headLines, { file: c.file, line: c.line, text: c.planted }));
    if ('stated' in found) break;
  }
  if ('problem' in found) return no(`not stated: ${found.problem}. Quote given: "${String(c.stated ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)}"`);
  c.stated = found.stated;
  return { why: '', statedIn: found.source };
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
          stated_ok: { type: 'boolean' },
          stated_why: { type: 'string' },
          kind: { type: 'string', enum: [...KINDS] },
          headline_ok: { type: 'boolean' },
          headline: { type: 'string' },
        },
        required: ['candidate', 'conflicts', 'stated_ok', 'stated_why', 'kind', 'headline_ok'],
      },
    },
    security: { type: 'string' },
  },
  required: ['verdicts'],
};
interface JudgeVerdict {
  candidate: number;
  conflicts: { question: string; why: string }[];
  stated_ok: boolean;
  stated_why: string;
  kind: Kind;
  headline_ok: boolean;
  headline?: string;
}

/** Everything a headline may take a number from. */
const factsOf = (v: Verdict) => [v.c.what, v.c.original, v.c.planted, ...v.failedTests, ...v.failures.map((f) => f.message ?? '')].join('\n');

/**
 * What code cannot see, checked by one more session for the lines the tests have proven:
 * a planted line outside a question's reread range can still change that question (a function the question's
 * code calls); the quoted words can be in the stop and still not say what the line must do; and the headline
 * has to follow from what the tests printed, which the session that proposed the line had not seen.
 */
async function judge(roundNo: number, list: Verdict[]) {
  if (!list.length) return;
  const questions = stops
    .flatMap((s) => s.questions.map((q) => `- ${q.id} (stop "${s.title}")\n  ${q.prompt}\n${q.options.map((o, i) => `    ${i === q.answer ? 'RIGHT' : 'wrong'}: ${o}`).join('\n')}\n  settled by ${q.reread.file}:${q.reread.from}-${q.reread.to}`))
    .join('\n');
  const cands = list
    .map((v, i) => {
      const hp = headlineProblem(v.c.headline, factsOf(v));
      return [
        `${i + 1}. ${v.c.file}:${v.c.line}, shown in stop ${v.stopId}`,
        `   original: ${v.c.original.trim()}`,
        `   planted:  ${v.c.planted.trim()}`,
        `   what goes wrong, as proposed: ${v.c.what.trim()}`,
        `   kind, as proposed: ${v.c.kind}`,
        `   stated (found in the stop's ${v.statedIn}): "${v.c.stated}"`,
        `   headline: ${v.c.headline.trim()}${hp ? `\n   the program found a problem with this headline: ${hp}` : ''}`,
        `   tests that fail with the planted line:\n${v.failures.map((f) => `     - ${f.test}${f.message ? `\n       printed: ${f.message}` : ''}`).join('\n')}`,
      ].join('\n');
    })
    .join('\n\n');
  const files = [...new Set([...list.map((v) => v.c.file), ...stops.flatMap((s) => s.questions.map((q) => q.reread.file))])].filter((f) => mustCover.includes(f));
  const r = await ask<{ verdicts: JudgeVerdict[]; security?: string }>(`plants-judge-${roundNo}`, {
    system: JUDGE_SYSTEM,
    prompt: [
      `# The tour the reader follows\n${tourText(false)}`,
      `# Questions of the tour\n${questions}`,
      `# Candidate planted lines\n${cands}`,
      `# Source files at the head commit (with the original lines)\n${files.map((f) => listing(f, () => ' ')).join('\n\n')}`,
      'Check every candidate.',
    ].join('\n\n'),
    schema: judgeSchema,
    model: PLANT_MODEL,
    timeoutMs: 30 * 60_000,
  });
  const ids = new Set(stops.flatMap((s) => s.questions.map((q) => q.id)));
  const out: Record<string, unknown>[] = [];
  list.forEach((v, i) => {
    const got = (r.out.verdicts ?? []).find((x) => Number(x.candidate) === i + 1);
    const conflicts = (got?.conflicts ?? []).filter((c) => ids.has(c.question));
    const row: Record<string, unknown> = { at: `${v.c.file}:${v.c.line}`, conflicts, statedOk: got?.stated_ok ?? null, statedWhy: got?.stated_why ?? '' };
    out.push(row);
    if (!got) v.why = 'the second check gave no verdict for this line';
    else if (conflicts.length) v.why = `it changes the answer to a question (${conflicts.map((c) => `${c.question}: ${c.why}`).join('; ')})`;
    else if (got.stated_ok !== true) v.why = `not stated: the quoted words are in the stop but do not say what this line must do (${got.stated_why}). Quote: "${v.c.stated}"`;
    else {
      if ((KINDS as readonly string[]).includes(got.kind) && got.kind !== v.c.kind) {
        row.kind = `${v.c.kind} -> ${got.kind}`;
        v.c.kind = got.kind;
      }
      const mine = headlineProblem(v.c.headline, factsOf(v));
      if (got.headline_ok !== true || mine) {
        const fixed = clean(String(got.headline ?? ''));
        const still = headlineProblem(fixed, factsOf(v));
        row.headline = { from: v.c.headline, to: fixed, because: mine || 'the second check did not accept it' };
        if (still) v.why = `no usable headline: ${still}`;
        else v.c.headline = fixed;
      }
    }
    if (v.why) log('plants', `${v.c.file}:${v.c.line} dropped: ${v.why}`);
  });
  step('plants-judge', { round: roundNo, model: r.model, ms: r.durationMs, costUsd: round(r.costUsd), turns: r.turns, reused: r.reused, checked: out, security: r.out.security || '' });
}

const verdicts: Verdict[] = [];
async function plantRound(roundNo: number, n: number, only: Kind[] = []) {
  const r = await ask<{ candidates: Candidate[]; security?: string }>(`plants-${roundNo}`, { system: PLANT_SYSTEM, prompt: plantPrompt(n, verdicts, only), schema: plantSchema, model: PLANT_MODEL, timeoutMs: 30 * 60_000 });
  const cands = (r.out.candidates ?? []).map((c) => ({ ...c, file: String(c.file ?? '').replace(/^\.\//, ''), line: Number(c.line), headline: clean(String(c.headline ?? '')), what: clean(String(c.what ?? '')), stated: String(c.stated ?? '') }));
  step('plants-ask', {
    round: roundNo,
    model: r.model,
    ms: r.durationMs,
    costUsd: round(r.costUsd),
    turns: r.turns,
    reused: r.reused,
    asked: n,
    only,
    candidates: cands.map((c) => ({ at: `${c.file}:${c.line}`, kind: c.kind, original: c.original, planted: c.planted, stated: c.stated, what: c.what, headline: c.headline, test: c.test ?? '' })),
    security: r.out.security || '',
  });
  const taken = new Set(verdicts.map((v) => `${v.c.file}:${v.c.line}`));
  const tv = Date.now();
  const fresh: Verdict[] = cands.map((c) => {
    let { why, statedIn } = staticCheck(c, taken);
    if (!why && only.length && !only.includes(c.kind)) why = `this round asked only for ${only.join(' and ')}; this one is ${c.kind}`;
    if (why) log('plants', `${c.file}:${c.line} dropped before the tests: ${why}`);
    else taken.add(`${c.file}:${c.line}`);
    return { c, round: roundNo, stopId: blockOf(c.file, c.line)?.stop ?? '', hasNote: hasNote(c.file, c.line), statedIn, failedTests: [], failures: [], why };
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
      else {
        v.failedTests = failed;
        v.failures = failed.map((t) => ({ test: t, ...(run.failures[t] ? { message: run.failures[t] } : {}) }));
      }
      log('plants', `${v.c.file}:${v.c.line} ${v.why ? `dropped: ${v.why}` : `proven: ${failed.length} test${failed.length === 1 ? '' : 's'} fail`}`);
    },
  );
  const msTests = Date.now() - tv;
  await judge(roundNo, fresh.filter((v) => !v.why));
  verdicts.push(...fresh);
  step('plants-verify', {
    round: roundNo,
    ms: msTests,
    kept: fresh.filter((v) => !v.why).map((v) => ({ at: `${v.c.file}:${v.c.line}`, stop: v.stopId, kind: v.c.kind, original: v.c.original, planted: v.c.planted, stated: v.c.stated, statedIn: v.statedIn, headline: v.c.headline, failures: v.failures })),
    dropped: fresh.filter((v) => v.why).map((v) => ({ at: `${v.c.file}:${v.c.line}`, stop: v.stopId, kind: v.c.kind, original: v.c.original, planted: v.c.planted, why: v.why, ...(v.failedTests.length ? { failedTests: v.failedTests } : {}) })),
  });
}

await plantRound(1, CANDIDATES);
{
  // one more round at most: for anything when few lines passed, or only for access and money when those are few
  const ok = verdicts.filter((v) => !v.why);
  const strong = ok.filter((v) => STRONG.includes(v.c.kind)).length;
  if (ok.length < MIN_KEPT) {
    log('plants', `${ok.length} kept, fewer than ${MIN_KEPT}; asking once more`);
    await plantRound(2, CANDIDATES_MORE);
  } else if (strong < MIN_STRONG) {
    log('plants', `${strong} access or money lines kept, fewer than ${MIN_STRONG}; asking once more, only for those`);
    await plantRound(2, CANDIDATES_MORE, STRONG);
  }
}

/** Every planted line that passed every check is kept. A reader meets access and money first, format last. */
const kept = verdicts
  .filter((v) => !v.why)
  .map((v, i) => ({ v, i }))
  .sort((a, b) => KINDS.indexOf(a.v.c.kind) - KINDS.indexOf(b.v.c.kind) || Number(a.v.hasNote) - Number(b.v.hasNote) || a.i - b.i)
  .map((x) => x.v);
const plantId = (v: Verdict, long: boolean) => {
  const parts = v.c.file.replace(/\.[^./]+$/, '').split('/');
  return `plant-${(long ? parts.slice(-2) : parts.slice(-1)).join('-').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${v.c.line}`;
};
const shortIds = kept.map((v) => plantId(v, false));
const plants: Plant[] = kept.map((v, i) => ({
  id: shortIds.indexOf(shortIds[i]!) !== shortIds.lastIndexOf(shortIds[i]!) ? plantId(v, true) : shortIds[i]!,
  file: v.c.file,
  line: v.c.line,
  original: v.c.original,
  planted: v.c.planted,
  what: v.c.what.trim(),
  failedTests: v.failedTests,
  kind: v.c.kind,
  headline: v.c.headline,
  stated: v.c.stated,
  failures: v.failures,
}));
const byKind = Object.fromEntries(KINDS.map((k) => [k, plants.filter((p) => p.kind === k).length]));
step('plants-keep', {
  candidates: verdicts.length,
  kept: plants.length,
  byKind,
  plants: kept.map((v, i) => ({ id: plants[i]!.id, at: `${v.c.file}:${v.c.line}`, stop: v.stopId, kind: v.c.kind, statedIn: v.statedIn, round: v.round })),
  dropped: verdicts.filter((v) => v.why).map((v) => ({ at: `${v.c.file}:${v.c.line}`, kind: v.c.kind, round: v.round, why: v.why })),
});

/* ---------- step 5: write ---------- */

// the marks go on now, after every planted line is settled: neither step has seen the other's result
const focus = await focusJob;
if (focus instanceof Error) die(`the focus step failed: ${focus.message}`);
for (const s of stops) for (const b of s.blocks) if (b.type === 'code') delete b.focus;
for (const f of focus) (f.block.focus ??= []).push(f.focus);
for (const s of stops) for (const b of s.blocks) if (b.type === 'code') b.focus?.sort((x, y) => x.from - y.from);
const focusByStop = stops.map((s) => {
  const mine = focus.filter((f) => f.stop === s);
  return { stop: s.id, ranges: mine.length, lines: mine.reduce((a, f) => a + f.focus.to - f.focus.from + 1, 0), cap: focusCap(s) };
});
step('focus-apply', { ranges: focus.length, lines: focusByStop.reduce((a, f) => a + f.lines, 0), stopsWithout: focusByStop.filter((f) => !f.ranges).map((f) => f.stop), byStop: focusByStop });

const plan: Plan = { schema: 1, pr, intro: checked.intro, stops, plants, madeBy: { model: TOUR_MODEL, costUsd: round(cost), at: new Date().toISOString(), plantModel: PLANT_MODEL } };
writeFileSync(join(OUT, 'plan.json'), JSON.stringify(plan, null, 1) + '\n');
step('write', {
  path: join(OUT, 'plan.json'),
  stops: stops.length,
  questions: nQuestions,
  plants: plants.length,
  plantsByKind: byKind,
  focusRanges: focus.length,
  coverage: { changed: cover.changed, onTour: cover.onTour },
  costUsd: round(cost),
  totalMs: Date.now() - t0,
  warnings,
});

console.log(`${join(OUT, 'plan.json')}: ${stops.length} stops, ${nQuestions} questions, ${plants.length} planted lines (${KINDS.map((k) => `${byKind[k]} ${k}`).join(', ')}), ${focus.length} focus ranges · source lines on the tour ${cover.onTour}/${cover.changed} · $${cost.toFixed(2)} · ${((Date.now() - t0) / 60000).toFixed(1)} min`);
for (const p of plants) console.log(`  [${p.kind}] ${p.file}:${p.line}\n    - ${p.original.trim()}\n    + ${p.planted.trim()}\n    ${p.headline}\n    stated: "${p.stated}"\n    fails: ${p.failures!.map((f) => `${f.test}${f.message ? ` (${f.message})` : ''}`).join(' | ')}`);
for (const v of verdicts.filter((x) => x.why)) console.log(`  dropped ${v.c.file}:${v.c.line} [${v.c.kind}]: ${v.why.slice(0, 300)}`);
for (const w of warnings) console.log(`  WARNING: ${w}`);
if (plants.length < 2) {
  console.error(`\nplan.ts: only ${plants.length} planted line${plants.length === 1 ? '' : 's'} passed every check. plan.json is written, but a read needs at least one, and a second read needs another.`);
  process.exit(plants.length ? 0 : 1);
}
process.exit(0);
