/**
 * Checks on a planted line that code can make.
 *
 * The reader's rule is "find the line that does not do what its stop says". So a planted line is kept only when
 * the stop that shows it already says what that line must do, and the model has to quote those words. Here the
 * quote is looked up in what the reader is shown: the stop's title, `why`, prose, pinned notes, and the comments
 * inside the code lines the stop shows. Nothing is ever added to a stop to make a quote fit.
 */
import type { Plant, PlanStop } from '../../shared/tour';

export type StatedSource = 'title' | 'why' | 'prose' | 'note' | 'comment';
export interface StopText {
  source: StatedSource;
  text: string;
}

export const KINDS = ['access', 'money', 'data', 'logic', 'format'] as const satisfies readonly NonNullable<Plant['kind']>[];
export type Kind = (typeof KINDS)[number];

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const HASH = /\.(py|rb|sh|ya?ml|toml)$/;

/** Where a line comment starts on this line, or -1. Quotes are counted so that "https://..." in a string is not one. */
function lineComment(line: string, mark: string): number {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (line.startsWith(mark, i) && (mark !== '//' || line[i - 1] !== ':')) return i;
  }
  return -1;
}

/**
 * The comments inside lines from..to of a file, one text per comment (a run of comment lines is one comment).
 * Block comments are followed from the top of the file, so a doc comment that starts above `from` still counts
 * for the part that is shown.
 */
export function commentsIn(lines: string[], from: number, to: number, file: string): string[] {
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    const t = norm(run.join(' '));
    if (t) out.push(t);
    run = [];
  };
  const hash = HASH.test(file);
  let inBlock = false;
  for (let n = 1; n <= Math.min(to, lines.length); n++) {
    const line = lines[n - 1]!;
    const shown = n >= from;
    let text = '';
    let whole = false; // the whole line is comment
    if (hash) {
      const i = lineComment(line, '#');
      if (i >= 0) {
        text = line.slice(i + 1);
        whole = line.slice(0, i).trim() === '';
      }
    } else if (inBlock) {
      const end = line.indexOf('*/');
      text = (end >= 0 ? line.slice(0, end) : line).replace(/^\s*\*+/, '');
      whole = end < 0 || line.slice(end + 2).trim() === '';
      if (end >= 0) inBlock = false;
    } else {
      const lc = lineComment(line, '//');
      const bc = lineComment(line, '/*');
      if (bc >= 0 && (lc < 0 || bc < lc)) {
        const end = line.indexOf('*/', bc + 2);
        text = (end >= 0 ? line.slice(bc + 2, end) : line.slice(bc + 2)).replace(/^\*+/, '');
        whole = line.slice(0, bc).trim() === '' && (end < 0 || line.slice(end + 2).trim() === '');
        if (end < 0) inBlock = true;
      } else if (lc >= 0) {
        text = line.slice(lc + 2).replace(/^\/+/, '');
        whole = line.slice(0, lc).trim() === '';
      }
    }
    if (!shown) continue;
    if (text.trim()) {
      // a comment at the end of a code line stands alone; whole comment lines join the run they are in
      if (!whole) flush();
      run.push(text);
      if (!whole) flush();
    } else if (!whole || !line.trim()) flush();
  }
  flush();
  return out;
}

/**
 * Everything in a stop that can say what a line must do, as the reader sees it.
 * `edit` puts the planted line in place first: the reader never sees the original.
 */
export function stopTexts(stop: PlanStop, linesOf: (file: string) => string[] | null, edit?: { file: string; line: number; text: string }): StopText[] {
  const out: StopText[] = [
    { source: 'title', text: stop.title },
    { source: 'why', text: stop.why },
  ];
  for (const b of stop.blocks) {
    if (b.type === 'prose') out.push({ source: 'prose', text: b.text });
    if (b.type !== 'code') continue;
    for (const n of b.notes ?? []) out.push({ source: 'note', text: n.text });
    let lines = linesOf(b.file);
    if (!lines) continue;
    if (edit && edit.file === b.file) {
      lines = [...lines];
      lines[edit.line - 1] = edit.text;
    }
    for (const c of commentsIn(lines, b.from, b.to, b.file)) out.push({ source: 'comment', text: c });
  }
  return out.map((t) => ({ source: t.source, text: norm(t.text) }));
}

const MARKUP = /[`*]/;

/**
 * Find the quote in the stop. Whitespace is normalised and nothing else, except that the model may leave out
 * the `backticks` and **bold** marks of the prose; the words returned are then the ones in the stop, marks included.
 */
export function findStated(quote: string, texts: StopText[]): { source: StatedSource; stated: string } | { problem: string } {
  const q = norm(quote ?? '').replace(/^["“]|["”]$/g, '').trim();
  if (q.split(' ').length < 3 || q.length < 12) return { problem: 'stated is too short to say what a line must do (it needs at least three words copied from the stop)' };
  if (q.length > 400) return { problem: 'stated is too long; quote the one sentence or phrase that says what the line must do' };
  for (const t of texts) if (t.text.includes(q)) return { source: t.source, stated: q };
  const bare = q.replace(/[`*]/g, '');
  for (const t of texts) {
    const map: number[] = [];
    let plain = '';
    for (let i = 0; i < t.text.length; i++)
      if (!MARKUP.test(t.text[i]!)) {
        plain += t.text[i];
        map.push(i);
      }
    const at = plain.indexOf(bare);
    if (at < 0 || !bare) continue;
    let a = map[at]!;
    let b = map[at + bare.length - 1]! + 1;
    while (a > 0 && MARKUP.test(t.text[a - 1]!)) a--;
    while (b < t.text.length && MARKUP.test(t.text[b]!)) b++;
    return { source: t.source, stated: t.text.slice(a, b) };
  }
  return { problem: 'the words in stated are not in the stop that shows this line (its title, why, prose, notes, or a comment inside the shown code)' };
}

const START = 'You would have approved';

/**
 * A headline is one plain sentence for someone who does not read code. `facts` is everything it may take a number
 * from: what goes wrong, the two lines, the failing tests and what they printed.
 */
export function headlineProblem(headline: string, facts: string): string {
  const h = norm(headline ?? '');
  if (!h) return 'headline is empty';
  if (!h.startsWith(START + ' ')) return `headline does not start with "${START}"`;
  if (h.length > 170) return `headline is ${h.length} characters; one short sentence of at most 170`;
  if (!/[.]$/.test(h) || /[.!?;:]\s/.test(h.slice(0, -1)) || /[!?]/.test(h)) return 'headline is not exactly one sentence that ends with a full stop';
  const code = /[`_{}[\]<>=|\\]|\(\)|[a-z][A-Z]|\b[\w-]+\.(ts|js|json|csv|sql|py)\b|(^|\s)\/[\w-]|\b(NULL|WHERE|SELECT|UPDATE|INSERT|JOIN|LIKE|HTTP|CSRF|SQL|API|JSON|URL|regex|boolean|string|null|undefined)\b/.exec(h);
  if (code) return `headline uses a code term ("${code[0].trim()}"); say it in words a bank manager understands`;
  if (/[–—]/.test(h)) return 'headline has a dash; write one plain sentence';
  const known = new Set(facts.match(/\d+(?:[.,]\d+)?/g) ?? []);
  for (const n of h.match(/\d+(?:[.,]\d+)?/g) ?? []) if (!known.has(n)) return `headline has the number ${n}, which is not in what the planted line does or in what the failing tests printed`;
  return '';
}
