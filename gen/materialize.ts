/**
 * bun gen/materialize.ts --repo <dir> --plan <plan.json> [--out <tour.json>]
 *
 * Plan + the repository -> Tour. No model here: it reads files at the two commits, marks which lines the
 * pull request added, attaches removed lines, highlights everything, and counts how many changed lines the tour passes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createCssVariablesTheme, createHighlighter } from 'shiki';
import type { Block, CodeBlock, Line, Plan, Token, Tour, TourPlant } from '../shared/tour';

const args = Object.fromEntries(process.argv.slice(2).reduce<[string, string][]>((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1] ?? '']] : a), []));
if (!args.repo || !args.plan) {
  console.error('usage: bun gen/materialize.ts --repo <dir> --plan <plan.json> [--out <tour.json>]');
  process.exit(2);
}
const repo = resolve(args.repo);
const planPath = resolve(args.plan);
const outPath = args.out ? resolve(args.out) : resolve(dirname(planPath), 'tour.json');
const plan = JSON.parse(readFileSync(planPath, 'utf8')) as Plan;
const { baseSha, headSha } = plan.pr;

function git(a: string[]): string {
  const p = Bun.spawnSync(['git', '-C', repo, ...a], { stdout: 'pipe', stderr: 'pipe' });
  if (p.exitCode !== 0) throw new Error(`git ${a.join(' ')}: ${p.stderr.toString().trim()}`);
  return p.stdout.toString();
}
function show(sha: string, file: string): string | null {
  const p = Bun.spawnSync(['git', '-C', repo, 'show', `${sha}:${file}`], { stdout: 'pipe', stderr: 'pipe' });
  return p.exitCode === 0 ? p.stdout.toString() : null;
}

/* ---------- highlighting: colours are named, the page owns the palette ---------- */

const theme = createCssVariablesTheme({ name: 'vars', variablePrefix: '--t-', variableDefaults: {}, fontStyle: false });
const LANGS: Record<string, string> = { ts: 'typescript', tsx: 'tsx', js: 'javascript', mjs: 'javascript', css: 'css', json: 'json', md: 'markdown', yml: 'yaml', yaml: 'yaml', sql: 'sql', py: 'python', cs: 'csharp', html: 'html', sh: 'bash' };
const hl = await createHighlighter({ themes: [theme], langs: [...new Set(Object.values(LANGS))] });

/** 'var(--t-token-keyword)' -> 'keyword' ; the default text colour -> '' */
function short(color: string | undefined): string {
  const m = /--t-token-([a-z-]+)/.exec(color ?? '');
  return m ? m[1]! : '';
}

function highlight(file: string, text: string): Token[][] {
  const lang = LANGS[file.split('.').pop() ?? ''];
  const rows = text.split('\n');
  if (!lang) return rows.map((r) => [[r, '']]);
  const { tokens } = hl.codeToTokens(text, { lang: lang as never, theme: 'vars' });
  return rows.map((r, i) => {
    const out: Token[] = [];
    for (const t of tokens[i] ?? []) {
      const c = short(t.color);
      const last = out[out.length - 1];
      if (last && last[1] === c) last[0] += t.content;
      else out.push([t.content, c]);
    }
    return out.length ? out : [[r, '']];
  });
}

/* ---------- what the pull request changed ---------- */

interface FileDiff {
  /** head line numbers this pull request added or changed */
  added: Set<number>;
  /** removed lines, keyed by the head line they sit in front of (or fileLength + 1 at the very end) */
  removedBefore: Map<number, number[]>;
}

function diffOf(file: string): FileDiff {
  const d: FileDiff = { added: new Set(), removedBefore: new Map() };
  const out = git(['diff', '-U0', '--no-color', baseSha, headSha, '--', file]);
  for (const m of out.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    const oldStart = Number(m[1]);
    const oldCount = m[2] === undefined ? 1 : Number(m[2]);
    const newStart = Number(m[3]);
    const newCount = m[4] === undefined ? 1 : Number(m[4]);
    for (let i = 0; i < newCount; i++) d.added.add(newStart + i);
    if (oldCount > 0) {
      // with nothing added, git gives the head line the removal comes after
      const before = newCount === 0 ? newStart + 1 : newStart;
      const list = d.removedBefore.get(before) ?? [];
      for (let i = 0; i < oldCount; i++) list.push(oldStart + i);
      d.removedBefore.set(before, list);
    }
  }
  return d;
}

interface FileView {
  head: string[];
  headTokens: Token[][];
  baseTokens: Token[][];
  diff: FileDiff;
}
const views = new Map<string, FileView>();
function view(file: string): FileView {
  let v = views.get(file);
  if (v) return v;
  const head = show(headSha, file);
  if (head === null) throw new Error(`${file} does not exist at ${headSha.slice(0, 7)}`);
  const base = show(baseSha, file);
  v = { head: head.split('\n'), headTokens: highlight(file, head), baseTokens: base === null ? [] : highlight(file, base), diff: diffOf(file) };
  views.set(file, v);
  return v;
}

/* ---------- blocks ---------- */

function codeBlock(b: { file: string; from: number; to: number; notes?: { line: number; text: string }[]; focus?: { from: number; to: number; why: string }[] }): CodeBlock {
  const v = view(b.file);
  const last = v.head[v.head.length - 1] === '' ? v.head.length - 1 : v.head.length;
  const from = Math.max(1, b.from);
  const to = Math.min(last, b.to);
  if (from > to) throw new Error(`${b.file}:${b.from}-${b.to} is outside the file (${last} lines)`);
  const lines: Line[] = [];
  const removed = (before: number) => {
    for (const o of v.diff.removedBefore.get(before) ?? []) lines.push({ n: null, kind: 'del', tokens: v.baseTokens[o - 1] ?? [['', '']] });
  };
  for (let n = from; n <= to; n++) {
    removed(n);
    lines.push({ n, kind: v.diff.added.has(n) ? 'add' : 'ctx', tokens: v.headTokens[n - 1] ?? [['', '']] });
  }
  if (to === last) removed(last + 1);
  const notes = (b.notes ?? []).filter((x) => x.line >= from && x.line <= to);
  const focus = (b.focus ?? []).filter((x) => x.from >= from && x.to <= to && x.from <= x.to);
  return { type: 'code', file: b.file, from, to, lines, ...(notes.length ? { notes } : {}), ...(focus.length ? { focus } : {}) };
}

const stops = plan.stops.map((s) => ({
  ...s,
  blocks: s.blocks.map((b): Block => (b.type === 'code' ? codeBlock(b) : b)),
}));

/* ---------- planted lines ---------- */

const plants: TourPlant[] = plan.plants.map((p) => {
  const v = view(p.file);
  if (v.head[p.line - 1] !== p.original) throw new Error(`plant ${p.id}: ${p.file}:${p.line} is not the line the plan says it is`);
  const onTour = stops.some((s) => s.blocks.some((b) => b.type === 'code' && b.file === p.file && b.from <= p.line && p.line <= b.to));
  const onCold = !!plan.cold?.plants.includes(p.id) && plan.cold.blocks.some((b) => b.file === p.file && b.from <= p.line && p.line <= b.to);
  if (!onTour && !onCold) throw new Error(`plant ${p.id}: ${p.file}:${p.line} is not on the tour`);
  const mutated = [...v.head];
  mutated[p.line - 1] = p.planted;
  return { ...p, tokens: highlight(p.file, mutated.join('\n'))[p.line - 1]!, originalTokens: v.headTokens[p.line - 1]! };
});

/* ---------- coverage ---------- */

const changedFiles = git(['diff', '--name-only', baseSha, headSha]).split('\n').filter(Boolean);
const onTourLines = new Map<string, Set<number>>();
for (const s of stops)
  for (const b of s.blocks)
    if (b.type === 'code') {
      const set = onTourLines.get(b.file) ?? new Set<number>();
      for (let n = b.from; n <= b.to; n++) set.add(n);
      onTourLines.set(b.file, set);
    }
const files = changedFiles
  .filter((f) => show(headSha, f) !== null)
  .map((f) => {
    const added = [...diffOf(f).added];
    const seen = onTourLines.get(f);
    return { file: f, changed: added.length, onTour: seen ? added.filter((n) => seen.has(n)).length : 0 };
  })
  .filter((f) => f.changed > 0);
const coverage = { changed: files.reduce((a, f) => a + f.changed, 0), onTour: files.reduce((a, f) => a + f.onTour, 0), files };

/* ---------- the cold test ---------- */

let cold: Tour['cold'];
if (plan.cold) {
  const blocks = plan.cold.blocks.map((b) => codeBlock(b));
  for (const id of plan.cold.plants) {
    const p = plants.find((x) => x.id === id);
    if (!p) throw new Error(`cold test: no plant ${id}`);
    if (!blocks.some((b) => b.file === p.file && b.from <= p.line && p.line <= b.to)) throw new Error(`cold test: plant ${id} is not in the lines it shows`);
  }
  if (!plan.cold.plants.length) throw new Error('cold test: it needs a planted line');
  cold = { blocks, plants: plan.cold.plants };
}

const tour: Tour = { schema: 1, pr: plan.pr, intro: plan.intro, stops, plants, coverage, madeBy: plan.madeBy, ...(plan.short ? { short: plan.short } : {}), ...(cold ? { cold } : {}) };
writeFileSync(outPath, JSON.stringify(tour));
console.log(`${outPath}: ${stops.length} stops, ${stops.reduce((a, s) => a + s.questions.length, 0)} questions, ${plants.length} planted lines, ${coverage.onTour} of ${coverage.changed} changed lines on the tour`);
for (const f of files) console.log(`  ${f.onTour}/${f.changed}  ${f.file}`);
process.exit(0);
