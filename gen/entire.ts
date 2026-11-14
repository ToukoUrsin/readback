/**
 * bun gen/entire.ts --repo <clone with Entire on> --tour <tour.json> --out <dir> [--findings <file>]
 *
 * What Entire holds about the pull request -> <out>/entire.json (the Entire interface in shared/tour.ts).
 * No model is asked anything here. Every field is the output of an `entire` command on the head commit:
 *
 *   sessions   `entire blame` names the checkpoint and session behind every line of the tour;
 *              `entire checkpoint explain` gives the prompt and the stored transcript, `entire session tokens` the tokens
 *   lines      which session wrote which lines, and what the agent wrote just before the edit that holds them
 *              (found by the text of the line in the transcript's Edit and Write calls)
 *   reach      `entire graph diff` lists the functions the change added or altered; `entire graph impact` says what calls each
 *   trail      `entire trail show`, and the findings that stand for the open points (--findings: RulingItem id -> finding id)
 *
 * The repository at --repo is only read.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Entire, EntireSession, Reach, Tour } from '../shared/tour';
import { exec, log } from './lib/util';

const argv = process.argv.slice(2);
const args: Record<string, string> = {};
for (let i = 0; i < argv.length; i++) if (argv[i]!.startsWith('--')) args[argv[i]!.slice(2)] = argv[++i] ?? '';
if (!args.repo || !args.tour || !args.out) {
  console.error('usage: bun gen/entire.ts --repo <clone with Entire on> --tour <tour.json> --out <dir> [--findings <file>]');
  process.exit(2);
}
const repo = resolve(args.repo);
const tour = JSON.parse(readFileSync(resolve(args.tour), 'utf8')) as Tour;
const env = { PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` };

async function entire(a: string[], timeoutMs = 120_000): Promise<string> {
  const r = await exec('entire', a, { cwd: repo, env, timeoutMs });
  if (r.code !== 0) throw new Error(`entire ${a.slice(0, 4).join(' ')} exited ${r.code}: ${(r.stderr || r.stdout).slice(-400)}`);
  return r.stdout;
}
const json = async <T>(a: string[]) => JSON.parse(await entire(a)) as T;
const git = async (a: string[]) => (await exec('git', a, { cwd: repo, check: true })).stdout.trim();

const head = await git(['rev-parse', 'HEAD']);
if (head !== tour.pr.headSha) throw new Error(`the clone is at ${head.slice(0, 7)}, the tour is of ${tour.pr.headSha.slice(0, 7)}`);

/* ---------- which lines the tour shows ---------- */

const shown = new Map<string, Set<number>>();
for (const st of tour.stops) for (const b of st.blocks) if (b.type === 'code') for (let n = b.from; n <= b.to; n++) (shown.get(b.file) ?? shown.set(b.file, new Set()).get(b.file)!).add(n);

/* ---------- sessions and lines ---------- */

interface BlameLine {
  line_number: number;
  status: string;
  commit_sha: string;
  checkpoint_id?: string;
  session_id?: string;
  agent?: string;
  model?: string;
  prompt?: string;
}
const blamed = new Map<string, BlameLine[]>();
for (const [file, set] of shown) {
  const ns = [...set].sort((a, b) => a - b);
  const j = await json<{ lines: BlameLine[] }>(['blame', `${file}:${ns[0]}-${ns.at(-1)}`, '--json']);
  blamed.set(file, j.lines.filter((l) => set.has(l.line_number)));
}
const first = new Map<string, BlameLine>();
for (const ls of blamed.values()) for (const l of ls) if (l.status === 'checkpoint' && l.session_id && !first.has(l.session_id)) first.set(l.session_id, l);
log('entire', `${[...blamed.values()].reduce((a, l) => a + l.length, 0)} lines of the tour, written in ${first.size} sessions`);

/** the first heading of a prompt and the paragraph under it */
function askedOf(prompt: string): { asked: string; detail: string } {
  const ls = prompt.split('\n');
  const h = ls.findIndex((l) => /^#{1,4} /.test(l));
  if (h < 0) return { asked: ls[0]!.slice(0, 200), detail: '' };
  const detail = ls.slice(h + 1).find((l) => l.trim() && !l.startsWith('#')) ?? '';
  return { asked: ls[h]!.replace(/^#+ /, '').trim(), detail: detail.trim().slice(0, 400) };
}

/** the agent's report, at most `max` characters: cut after the last sentence or line that ends before the limit, never inside a word */
function cutReport(text: string, max = 4000): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const stop = head.lastIndexOf('. ');
  const line = head.lastIndexOf('\n');
  const at = Math.max(stop + 1, line, 0) || head.lastIndexOf(' ');
  return `${head.slice(0, at > 0 ? at : max).trimEnd()} …`;
}

interface Edit {
  file: string;
  text: string;
  said: string;
}
const edits = new Map<string, Edit[]>();
const sessions: EntireSession[] = [];
for (const [id, l] of first) {
  const rows = (await entire(['checkpoint', 'explain', l.checkpoint_id!, '--transcript']))
    .split('\n')
    .filter((x) => x.startsWith('{'))
    .map((x) => JSON.parse(x) as { type?: string; message?: { content?: unknown } });
  const es: Edit[] = [];
  let said = '';
  let report = '';
  let steps = 0;
  for (const r of rows) {
    if (r.type !== 'assistant' || !Array.isArray(r.message?.content)) continue;
    for (const c of r.message.content as { type: string; text?: string; name?: string; input?: Record<string, unknown> }[]) {
      if (c.type === 'text' && c.text?.trim()) report = said = c.text.trim();
      if (c.type !== 'tool_use') continue;
      steps++;
      const path = String(c.input?.file_path ?? '');
      const text = c.name === 'Edit' ? String(c.input?.new_string ?? '') : c.name === 'Write' ? String(c.input?.content ?? '') : '';
      if (path.startsWith(repo + '/') && text) es.push({ file: path.slice(repo.length + 1), text, said });
    }
  }
  edits.set(id, es);
  const t = await json<{ tokens: { total: number; input: number; cache_read: number; cache_write: number; output: number; api_calls: number } }>(['session', 'tokens', id, '--json']);
  sessions.push({
    id,
    agent: l.agent ?? '',
    model: l.model ?? '',
    commit: l.commit_sha,
    subject: await git(['log', '-1', '--format=%s', l.commit_sha]),
    checkpoint: l.checkpoint_id!,
    ...askedOf(l.prompt ?? ''),
    report: cutReport(report),
    transcript: steps > 0,
    tokens: { total: t.tokens.total, input: t.tokens.input, cacheRead: t.tokens.cache_read, cacheWrite: t.tokens.cache_write, output: t.tokens.output, ...(steps > 0 ? { apiCalls: t.tokens.api_calls } : {}) },
  });
}
const order = (await git(['rev-list', '--reverse', `${tour.pr.baseSha}..${head}`])).split('\n');
sessions.sort((a, b) => order.indexOf(a.commit) - order.indexOf(b.commit));

const lines: Entire['lines'] = [];
for (const [file, ls] of blamed) {
  const src = (await git(['show', `${head}:${file}`])).split('\n');
  // the edit that holds each line: the last one of its session whose new text has the line, word for word
  const at = ls.map((l) => {
    const text = (src[l.line_number - 1] ?? '').trim();
    if (!l.session_id || text.length < 8) return -1;
    const es = edits.get(l.session_id) ?? [];
    for (let i = es.length - 1; i >= 0; i--) if (es[i]!.file === file && es[i]!.text.includes(text)) return i;
    return -1;
  });
  // a short line (a brace, a blank) belongs to the edit of the lines around it
  for (let i = 0; i < at.length; i++) if (at[i] === -1 && i > 0 && ls[i - 1]!.session_id === ls[i]!.session_id && ls[i - 1]!.line_number === ls[i]!.line_number - 1) at[i] = at[i - 1]!;
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i]!;
    if (!l.session_id) continue;
    const said = at[i]! >= 0 ? edits.get(l.session_id)![at[i]!]!.said : '';
    const last = lines.at(-1);
    if (last && last.file === file && last.to === l.line_number - 1 && last.session === l.session_id && (last.said ?? '') === said) last.to = l.line_number;
    else lines.push({ file, from: l.line_number, to: l.line_number, session: l.session_id, ...(said ? { said } : {}) });
  }
}

/* ---------- reach ---------- */

interface Change {
  type: string;
  kind: string;
  name: string;
  after_start_line?: number;
}
interface Endpoint {
  endpoint: { name: string; kind: string; file_path: string };
  depth: number;
  via?: string;
  call_site?: { file_path: string; line: number };
}
interface Impact {
  focus?: { name: string; file_path: string; start_line: number; end_line: number };
  callers: { entries: Endpoint[] };
  stats: { files: number; symbols: number; relations: number };
  total_latency_ms: number;
}
const diff = await json<{ files: { path: string; changes: Change[] }[] }>(['graph', 'diff', '--base', tour.pr.baseSha, '--head', head, '--json']);
const isTest = (f: string) => /(^|\/)(test|tests|__tests__)\//.test(f) || /\.test\.[a-z]+$/.test(f);
const reach: Reach[] = [];
let stats = { files: 0, symbols: 0, relations: 0 };
const ms: number[] = [];
for (const f of diff.files) {
  if (!shown.has(f.path) || isTest(f.path)) continue;
  for (const c of f.changes) {
    if (c.kind !== 'function' || !c.after_start_line) continue;
    const j = await json<Impact>(['graph', 'impact', '--symbol', `${f.path}:${c.after_start_line}`, '--repo', '.', '--depth', '2', '--limit', '40', '--format', 'json', '--head']);
    if (!j.focus || j.focus.name !== c.name) continue;
    stats = { files: j.stats.files, symbols: j.stats.symbols, relations: j.stats.relations };
    ms.push(j.total_latency_ms);
    const callers = j.callers.entries.filter((e) => !isTest(e.endpoint.file_path));
    reach.push({
      name: c.name,
      file: f.path,
      from: j.focus.start_line,
      to: j.focus.end_line,
      change: c.type === 'added' ? 'added' : 'changed',
      callers: callers.map((e) => ({ name: e.endpoint.kind === 'file' ? e.endpoint.file_path : e.endpoint.name, file: e.endpoint.file_path, ...(e.call_site ? { line: e.call_site.line } : {}), ...(e.via ? { via: e.via } : {}) })),
      testCallers: j.callers.entries.length - callers.length,
    });
  }
}
ms.sort((a, b) => a - b);
log('entire', `${reach.length} functions the change added or altered, ${reach.filter((r) => !r.callers.length).length} with no caller outside the tests`);

/* ---------- trail ---------- */

let trail: Entire['trail'];
try {
  const t = await json<{ number: number; url: string; changes: { repository: string; branch: string }[]; project: { name: string } }>(['trail', 'show', '--json']);
  const findings = args.findings ? (JSON.parse(readFileSync(resolve(args.findings), 'utf8')) as Record<string, string>) : {};
  trail = { number: t.number, url: t.url, repo: `${t.project.name}/${t.changes[0]?.repository ?? ''}`, findings };
} catch (e) {
  log('entire', `no trail: ${(e as Error).message.slice(0, 160)}`);
}

const out: Entire = {
  schema: 1,
  headSha: head,
  at: new Date().toISOString(),
  versions: { cli: (await entire(['version'])).split('\n')[0]!.replace(/^Entire CLI /, ''), graph: (JSON.parse(await entire(['graph', 'version', '--json'])) as { version: string }).version },
  sessions,
  lines,
  reach,
  graph: { ...stats, functions: reach.length, msPerQuery: ms[Math.floor(ms.length / 2)] ?? 0 },
  ...(trail ? { trail } : {}),
};
writeFileSync(resolve(args.out, 'entire.json'), JSON.stringify(out, null, 1) + '\n');
log('entire', `wrote ${resolve(args.out, 'entire.json')}: ${sessions.length} sessions, ${lines.length} line ranges, ${reach.length} functions${trail ? `, trail #${trail.number} with ${Object.keys(trail.findings).length} findings` : ''}`);
