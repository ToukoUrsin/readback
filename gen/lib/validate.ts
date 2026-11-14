/**
 * Step 2: the tour is checked in code, never by a model.
 * `checkTour` turns whatever the model returned into typed stops and a list of problems, each written so that
 * it can be sent back to the model as is.
 */
import type { DiagramBlock, Focus, PlanBlock, PlanCodeBlock, PlanStop, Question } from '../../shared/tour';
import { ranges } from './util';

export interface Issue {
  /** 'error' blocks the plan; 'warn' is logged and sent along if a repair round happens anyway */
  level: 'error' | 'warn';
  where: string;
  msg: string;
}

export interface RepoView {
  /** lines of a file at head, or null when it does not exist there */
  lines(file: string): string[] | null;
  /** head line numbers the pull request added or changed, per file */
  changed: Map<string, number[]>;
  /** files whose changed lines must all be on the tour */
  mustCover: string[];
}

export const LIMITS = { title: 90, stopsMin: 6, stopsMax: 9, codeLines: 70, notes: 4, reread: 15, labelWords: 4, nodesMin: 3, nodesMax: 7 };

const str = (v: unknown): string => (typeof v === 'string' ? clean(v) : '');
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);

/** Plain text only: dashes a reader has to parse become commas, odd spaces become spaces. */
export function clean(s: string): string {
  return s
    .replace(/[   ]/g, ' ')
    .replace(/\s*—\s*/g, ', ')
    .replace(/(\d)\s*–\s*(\d)/g, '$1-$2')
    .replace(/\s+–\s+/g, ', ')
    .replace(/–/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .trim();
}

function proseProblems(text: string): string | null {
  if (/```/.test(text)) return 'contains a code fence; show code with a code block instead';
  if (/^\s*#{1,6}\s/m.test(text)) return 'contains a heading; only `backticks` and **bold** are allowed';
  if (/^\s*([-*+]|\d+[.)])\s/m.test(text)) return 'contains a list; write sentences, only `backticks` and **bold** are allowed';
  if (/\]\(/.test(text)) return 'contains a link; only `backticks` and **bold** are allowed';
  return null;
}

export interface Checked {
  intro: string;
  stops: PlanStop[];
  issues: Issue[];
}

export function checkTour(raw: unknown, repo: RepoView): Checked {
  const issues: Issue[] = [];
  const err = (where: string, msg: string) => issues.push({ level: 'error', where, msg });
  const warn = (where: string, msg: string) => issues.push({ level: 'warn', where, msg });
  const r = (raw ?? {}) as { intro?: unknown; stops?: unknown };

  const intro = str(r.intro);
  if (!intro) err('intro', 'is empty');
  else if (intro.length > 700) err('intro', `is ${intro.length} characters; keep it to two or three plain sentences`);

  const rawStops = Array.isArray(r.stops) ? r.stops : [];
  if (rawStops.length < LIMITS.stopsMin || rawStops.length > LIMITS.stopsMax) err('stops', `there are ${rawStops.length} stops; there must be ${LIMITS.stopsMin} to ${LIMITS.stopsMax}`);

  const stops: PlanStop[] = [];
  const stopIds = new Set<string>();
  /** file -> line -> stops that show it */
  const shown = new Map<string, Map<number, string[]>>();

  rawStops.forEach((rs: any, si: number) => {
    const id = str(rs?.id);
    const at = `stop ${si + 1} (${id || 'no id'})`;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) err(at, `id "${id}" is not kebab-case`);
    if (stopIds.has(id)) err(at, `id "${id}" is used twice`);
    stopIds.add(id);
    const title = str(rs?.title);
    if (!title) err(at, 'title is empty');
    else if (/^[\w./-]+\.\w{1,5}$/.test(title) || /^`[^`]+`$/.test(title)) err(at, `title "${title}" is a name, not a claim about the code`);
    else if (title.length > LIMITS.title) err(at, `title is ${title.length} characters; at most ${LIMITS.title}`);
    const why = str(rs?.why);
    if (!why) err(at, 'why is empty');

    const blocks: PlanBlock[] = [];
    const codeBlocks: PlanCodeBlock[] = [];
    let diagrams = 0;
    (Array.isArray(rs?.blocks) ? rs.blocks : []).forEach((rb: any, bi: number) => {
      const bat = `${at}, block ${bi + 1}`;
      if (rb?.type === 'prose') {
        const text = str(rb.text);
        if (!text) return err(bat, 'prose text is empty');
        const p = proseProblems(text);
        if (p) err(bat, `prose ${p}`);
        blocks.push({ type: 'prose', text });
      } else if (rb?.type === 'diagram') {
        if (++diagrams > 1) return err(bat, 'a stop may have at most one diagram');
        const d = checkDiagram(rb, bat, err);
        if (d) blocks.push(d);
      } else if (rb?.type === 'code') {
        const file = str(rb.file).replace(/^\.\//, '');
        const from = int(rb.from);
        const to = int(rb.to);
        const lines = repo.lines(file);
        if (!lines) return err(bat, `file "${file}" does not exist at the head commit`);
        if (from === null || to === null) return err(bat, `${file}: from and to must be whole numbers`);
        if (from < 1 || to < from || to > lines.length) return err(bat, `${file}:${from}-${to} is outside the file (it has ${lines.length} lines)`);
        if (to - from + 1 > LIMITS.codeLines) err(bat, `${file}:${from}-${to} is ${to - from + 1} lines; split it into blocks of at most about 60 lines with prose between`);
        const notes: { line: number; text: string }[] = [];
        for (const n of Array.isArray(rb.notes) ? rb.notes : []) {
          const line = int(n?.line);
          const text = str(n?.text);
          if (line === null || !text) {
            err(bat, 'a note needs a line number and a text');
            continue;
          }
          if (line < from || line > to) {
            err(bat, `note on line ${line} is outside this block (${file}:${from}-${to})`);
            continue;
          }
          if (notes.some((x) => x.line === line)) {
            err(bat, `two notes are pinned to line ${line}; keep one`);
            continue;
          }
          if (text.length > 200) err(bat, `note on line ${line} is ${text.length} characters; a note is one short sentence`);
          notes.push({ line, text });
        }
        if (notes.length > LIMITS.notes) err(bat, `${notes.length} notes on one block; at most ${LIMITS.notes}`);
        for (const other of codeBlocks) if (other.file === file && other.from <= to && from <= other.to) err(bat, `${file}:${from}-${to} overlaps ${file}:${other.from}-${other.to} in the same stop`);
        const m = shown.get(file) ?? new Map<number, string[]>();
        shown.set(file, m);
        for (let n = from; n <= to; n++) m.set(n, [...(m.get(n) ?? []), id]);
        const block: PlanCodeBlock = { type: 'code', file, from, to, ...(notes.length ? { notes: notes.sort((a, b) => a.line - b.line) } : {}) };
        blocks.push(block);
        codeBlocks.push(block);
      } else err(bat, `type "${String(rb?.type)}" is not prose, diagram or code`);
    });
    if (!codeBlocks.length) err(at, 'has no code block; every stop shows the code it talks about');
    if (blocks.length && blocks[0]!.type !== 'prose') warn(at, 'does not start with prose; start each stop with a sentence or two that says what the reader is about to see');

    const questions: Question[] = [];
    const rq = Array.isArray(rs?.questions) ? rs.questions : [];
    if (rq.length < 1 || rq.length > 2) err(at, `has ${rq.length} questions; there must be 1 or 2`);
    rq.forEach((q: any, qi: number) => {
      const qat = `${at}, question ${qi + 1}`;
      const prompt = str(q?.prompt);
      if (!prompt) err(qat, 'prompt is empty');
      const options = (Array.isArray(q?.options) ? q.options : []).map(str);
      if (options.length < 3 || options.length > 4) err(qat, `has ${options.length} options; there must be 3 or 4`);
      if (options.some((o: string) => !o)) err(qat, 'has an empty option');
      if (new Set(options).size !== options.length) err(qat, 'has the same option twice');
      if (options.some((o: string) => /\b(all|none|both) of the above\b|\b(option|answer) [A-D1-4]\b/i.test(o))) err(qat, 'an option refers to other options; each option must stand alone');
      const answer = int(q?.answer);
      if (answer === null || answer < 0 || answer >= options.length) err(qat, `answer ${String(q?.answer)} is not the index of an option (0 to ${options.length - 1})`);
      const explain = str(q?.explain);
      if (!explain) err(qat, 'explain is empty');
      else if (!/\blines?\b/i.test(explain)) warn(qat, 'explain does not name the lines that settle the answer');
      const rf = str(q?.reread?.file).replace(/^\.\//, '');
      const from = int(q?.reread?.from);
      const to = int(q?.reread?.to);
      const lines = repo.lines(rf);
      let reread = { file: rf, from: from ?? 0, to: to ?? 0 };
      if (!lines) err(qat, `reread file "${rf}" does not exist at the head commit`);
      else if (from === null || to === null || from < 1 || to < from || to > lines.length) err(qat, `reread ${rf}:${String(from)}-${String(to)} is outside the file (it has ${lines.length} lines)`);
      else {
        if (to - from + 1 > LIMITS.reread) err(qat, `reread ${rf}:${from}-${to} is ${to - from + 1} lines; give the at most ${LIMITS.reread} lines that settle the answer`);
        if (!codeBlocks.some((b) => b.file === rf && b.from <= from && to <= b.to)) err(qat, `reread ${rf}:${from}-${to} is not inside one code block of this stop (${codeBlocks.map((b) => `${b.file}:${b.from}-${b.to}`).join(', ') || 'none'}); a question is about code this stop shows`);
        reread = { file: rf, from, to };
      }
      questions.push({ id: `${id || `stop-${si + 1}`}-q${qi + 1}`, prompt, options, answer: answer ?? 0, explain, reread });
    });

    stops.push({ id, title, why, blocks, questions });
  });

  // coverage: every changed line of the source files is inside some code block (blank lines are joined on later)
  for (const file of repo.mustCover) {
    const lines = repo.lines(file) ?? [];
    const seen = shown.get(file);
    const missing = (repo.changed.get(file) ?? []).filter((n) => (lines[n - 1] ?? '').trim() !== '' && !seen?.has(n));
    if (missing.length) err('coverage', `${file}: changed lines ${ranges(missing)} are not inside any code block. Every changed line of this file must be shown in a stop where it belongs.`);
  }
  for (const [file, m] of shown) {
    const twice = [...m].filter(([, ids]) => new Set(ids).size > 1).map(([n]) => n);
    if (twice.length) warn('overlap', `${file}: lines ${ranges(twice)} are shown in more than one stop; show each line once unless the second stop needs it`);
  }
  return { intro, stops, issues };
}

function checkDiagram(rb: any, at: string, err: (where: string, msg: string) => void): DiagramBlock | null {
  const title = str(rb.title);
  if (!title) err(at, 'diagram title is empty');
  const nodes: DiagramBlock['nodes'] = [];
  const index = new Map<string, number>();
  for (const n of Array.isArray(rb.nodes) ? rb.nodes : []) {
    const id = str(n?.id);
    const label = str(n?.label);
    const sub = str(n?.sub);
    const role = n?.role;
    if (!id || !label) {
      err(at, 'a diagram node needs an id and a label');
      continue;
    }
    if (index.has(id)) {
      err(at, `diagram node id "${id}" is used twice`);
      continue;
    }
    if (label.split(/\s+/).length > LIMITS.labelWords) err(at, `diagram label "${label}" has more than ${LIMITS.labelWords} words`);
    if (sub.length > 40) err(at, `diagram sub "${sub}" is too long; a few words at most`);
    if (!['new', 'changed', 'existing', 'outside'].includes(role)) err(at, `diagram node "${id}" has role "${String(role)}"; it must be new, changed, existing or outside`);
    index.set(id, nodes.length);
    nodes.push({ id, label, ...(sub ? { sub } : {}), role: ['new', 'changed', 'existing', 'outside'].includes(role) ? role : 'existing' });
  }
  if (nodes.length < LIMITS.nodesMin || nodes.length > LIMITS.nodesMax) err(at, `diagram has ${nodes.length} nodes; there must be ${LIMITS.nodesMin} to ${LIMITS.nodesMax}`);
  const edges: DiagramBlock['edges'] = [];
  const touched = new Set<string>();
  for (const e of Array.isArray(rb.edges) ? rb.edges : []) {
    const from = str(e?.from);
    const to = str(e?.to);
    const label = str(e?.label);
    if (!index.has(from) || !index.has(to)) {
      err(at, `diagram edge ${from} -> ${to} joins a node id that does not exist`);
      continue;
    }
    if (index.get(from)! >= index.get(to)!) {
      err(at, `diagram edge ${from} -> ${to} goes backwards; list the nodes in the order the code runs and let every edge go from an earlier node to a later one (no cycles)`);
      continue;
    }
    if (edges.some((x) => x.from === from && x.to === to)) continue;
    if (label.split(/\s+/).length > LIMITS.labelWords) err(at, `diagram edge label "${label}" has more than ${LIMITS.labelWords} words`);
    touched.add(from).add(to);
    edges.push({ from, to, ...(label ? { label } : {}) });
  }
  if (!edges.length) err(at, 'diagram has no edges');
  for (const n of nodes) if (edges.length && !touched.has(n.id)) err(at, `diagram node "${n.id}" is not joined to anything`);
  return { type: 'diagram', title, nodes, edges };
}

/**
 * Changed lines that are blank and sit right after or before a code block are joined on to it, so that the tour
 * passes every changed line and not only the ones with text. Returns how many lines were joined.
 */
export function absorbBlankLines(stops: PlanStop[], repo: RepoView): number {
  let joined = 0;
  for (const file of repo.mustCover) {
    const lines = repo.lines(file) ?? [];
    const blocks = stops.flatMap((s) => s.blocks.filter((b): b is PlanCodeBlock => b.type === 'code' && b.file === file));
    const covered = (n: number) => blocks.some((b) => b.from <= n && n <= b.to);
    const blank = (n: number) => (lines[n - 1] ?? '').trim() === '';
    const changed = new Set(repo.changed.get(file) ?? []);
    for (let again = true; again; ) {
      again = false;
      for (const n of changed) {
        if (!blank(n) || covered(n)) continue;
        const b = blocks.find((x) => x.to === n - 1) ?? blocks.find((x) => x.from === n + 1);
        if (!b) continue;
        if (b.to === n - 1) b.to = n;
        else b.from = n;
        joined++;
        again = true;
      }
    }
  }
  return joined;
}

/** Right answers should not sit in one position. Swaps options so that positions are used evenly; returns how many moved. */
export function spreadAnswers(stops: PlanStop[]): number {
  const qs = stops.flatMap((s) => s.questions);
  const count = [0, 0, 0, 0];
  for (const q of qs) count[q.answer]!++;
  const fair = Math.ceil(qs.length / 3);
  if (Math.max(...count) <= fair) return 0;
  let moved = 0;
  const used = [0, 0, 0, 0];
  for (const q of qs) {
    // keep an answer where it is while its position is not over its share
    if (used[q.answer]! < fair - 1) {
      used[q.answer]!++;
      continue;
    }
    let best = q.answer;
    for (let i = 0; i < q.options.length; i++) if (used[i]! < used[best]!) best = i;
    if (best !== q.answer) {
      [q.options[best], q.options[q.answer]] = [q.options[q.answer]!, q.options[best]!];
      q.answer = best;
      moved++;
    }
    used[best]!++;
  }
  return moved;
}

export function coverageOf(stops: PlanStop[], repo: RepoView, files: string[]) {
  const out = files.map((file) => {
    const changed = repo.changed.get(file) ?? [];
    const blocks = stops.flatMap((s) => s.blocks.filter((b): b is PlanCodeBlock => b.type === 'code' && b.file === file));
    const onTour = changed.filter((n) => blocks.some((b) => b.from <= n && n <= b.to)).length;
    return { file, changed: changed.length, onTour };
  });
  return { changed: out.reduce((a, f) => a + f.changed, 0), onTour: out.reduce((a, f) => a + f.onTour, 0), files: out };
}

/* ---------- focus: the lines a person must read closely ---------- */

export const FOCUS = { maxLines: 8, whyWords: 12, share: 0.25 };

/** How many lines of a stop may be marked: a quarter of the code lines it shows (at least 2). */
export function focusCap(stop: PlanStop): number {
  const shown = stop.blocks.reduce((a, b) => a + (b.type === 'code' ? b.to - b.from + 1 : 0), 0);
  return shown ? Math.max(2, Math.ceil(shown * FOCUS.share)) : 0;
}

const PLUMBING = /^\s*(import\b|export\s+(\*|\{[^}]*\})\s+from\b|\}\s*from\s|\/\/|\/\*|\*|#|[)\]}]+[;,]?\s*$|$)/;

export interface FocusEntry {
  stop: string;
  file: string;
  from: number;
  to: number;
  why: string;
}

export interface CheckedFocus {
  /** valid entries, in the order the model gave them (most important first within a stop) */
  ok: { block: PlanCodeBlock; stop: PlanStop; focus: Focus }[];
  issues: string[];
}

/**
 * Ranges inside one code block of the named stop, 1 to 8 lines, no overlap, a concrete reason of at most 12 words,
 * not only imports or comments, and at most a quarter of the stop's shown lines.
 * With `trim`, a stop that is over its cap loses the entries the model listed last instead of being reported.
 */
export function checkFocus(raw: unknown, stops: PlanStop[], repo: RepoView, trim = false): CheckedFocus {
  const issues: string[] = [];
  const ok: CheckedFocus['ok'] = [];
  const list = Array.isArray((raw as { focus?: unknown })?.focus) ? ((raw as { focus: unknown[] }).focus as any[]) : [];
  for (const e of list) {
    const stopId = str(e?.stop);
    const file = str(e?.file).replace(/^\.\//, '');
    const from = int(e?.from);
    const to = int(e?.to);
    const why = str(e?.why).replace(/[.]$/, '');
    const at = `${stopId || 'no stop'} ${file}:${String(from)}-${String(to)}`;
    const stop = stops.find((s) => s.id === stopId);
    if (!stop) {
      issues.push(`- ${at}: there is no stop with the id "${stopId}"`);
      continue;
    }
    if (from === null || to === null || to < from) {
      issues.push(`- ${at}: from and to must be whole numbers, from not after to`);
      continue;
    }
    const block = stop.blocks.find((b): b is PlanCodeBlock => b.type === 'code' && b.file === file && b.from <= from && to <= b.to);
    if (!block) {
      issues.push(`- ${at}: is not inside one code block of this stop (${stop.blocks.filter((b): b is PlanCodeBlock => b.type === 'code').map((b) => `${b.file}:${b.from}-${b.to}`).join(', ')})`);
      continue;
    }
    if (to - from + 1 > FOCUS.maxLines) {
      issues.push(`- ${at}: is ${to - from + 1} lines; a range is 1 to ${FOCUS.maxLines} lines. Mark only the lines that decide`);
      continue;
    }
    if (!why) {
      issues.push(`- ${at}: why is empty`);
      continue;
    }
    if (why.split(/\s+/).length > FOCUS.whyWords) {
      issues.push(`- ${at}: why has ${why.split(/\s+/).length} words; at most ${FOCUS.whyWords}`);
      continue;
    }
    const lines = repo.lines(file) ?? [];
    if (lines.slice(from - 1, to).every((l) => PLUMBING.test(l))) {
      issues.push(`- ${at}: marks only imports, comments, brackets or blank lines`);
      continue;
    }
    const clash = ok.find((o) => o.block === block && o.focus.from <= to && from <= o.focus.to);
    if (clash) {
      issues.push(`- ${at}: overlaps ${file}:${clash.focus.from}-${clash.focus.to}`);
      continue;
    }
    ok.push({ block, stop, focus: { from, to, why } });
  }
  for (const stop of stops) {
    const mine = ok.filter((o) => o.stop === stop);
    const cap = focusCap(stop);
    let marked = mine.reduce((a, o) => a + o.focus.to - o.focus.from + 1, 0);
    if (marked <= cap) continue;
    if (!trim) {
      issues.push(`- stop ${stop.id}: ${marked} lines are marked, but at most ${cap} may be (a quarter of the ${stop.blocks.reduce((a, b) => a + (b.type === 'code' ? b.to - b.from + 1 : 0), 0)} lines it shows). Keep the ones that matter most`);
      continue;
    }
    for (let i = mine.length - 1; i >= 0 && marked > cap; i--) {
      const o = mine[i]!;
      marked -= o.focus.to - o.focus.from + 1;
      ok.splice(ok.indexOf(o), 1);
      issues.push(`- stop ${stop.id}: ${o.block.file}:${o.focus.from}-${o.focus.to} left out, the stop was over its cap of ${cap} lines`);
    }
  }
  return { ok, issues };
}
