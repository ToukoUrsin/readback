import { type CSSProperties, memo, type TextareaHTMLAttributes, useState } from 'react';
import type { CodeBlock, Entire, Flag, Ruling, RulingItem, StopEvidence, StopSecond, Token } from '../../../shared/tour';
import { reachOf, Reached, sessionOf, Why } from './Entire';
import { Chat, Check, Eye, Flag as FlagIcon, FlagFill, Warn, X } from './icons';
import { inline } from './Prose';

export const lineId = (file: string, n: number) => `L:${file}:${n}`;
/** a flag needs this many characters of reason before the review can be handed in (server/app.ts MIN_NOTE) */
export const MIN_NOTE = 8;
/** a ruling on an open point needs this many characters of reason, to accept as much as to send back */
export const MIN_RULING = 12;
export const POINT_KIND: Record<RulingItem['kind'], string> = { unasked: 'Nobody asked for this', open: 'The issue leaves this open', untested: 'No test checks this', answer: 'A reviewer sent this back' };

export function Tokens({ tokens }: { tokens: Token[] }) {
  return (
    <>
      {tokens.map(([text, c], i) =>
        c ? (
          <span key={i} className={`tk-${c}`}>
            {text}
          </span>
        ) : (
          text
        ),
      )}
    </>
  );
}

/**
 * A long line wraps (index.css .row .src). The wrapped part hangs two characters past the line's own indent,
 * so it never reads as a new line of code.
 */
export function hang(tokens: Token[]): CSSProperties {
  let n = 0;
  scan: for (const [text] of tokens)
    for (const ch of text) {
      if (ch === ' ') n++;
      else if (ch === '\t') n += 2;
      else break scan;
    }
  const by = Math.min(n, 10) + 2;
  return { paddingLeft: `${by}ch`, textIndent: `-${by}ch` };
}

/** A text box as tall as what is typed in it: a reason is read back whole, on a phone too. */
export function Grow({ className = '', onInput, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const fit = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  };
  return (
    <textarea
      rows={1}
      {...p}
      ref={fit}
      onInput={(e) => {
        fit(e.currentTarget);
        onInput?.(e);
      }}
      className={`block resize-none overflow-hidden ${className}`}
    />
  );
}

type Unnoticed = StopEvidence['changes']['survived'][number];

/** the part of the line that was changed, cut at spaces: "= ?" became "LIKE ?" */
function changedPart(a: string, b: string) {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  let from = pre;
  while (from > 0 && !/[\s(,]/.test(a[from - 1]!) && pre - from < 60) from--;
  let endA = a.length - suf;
  let endB = b.length - suf;
  let more = 0;
  while (endA < a.length && !/[\s),;]/.test(a[endA]!) && more < 60) {
    endA++;
    endB++;
    more++;
  }
  return { was: a.slice(from, endA).trim(), now: b.slice(from, endB).trim() };
}

interface Props {
  block: CodeBlock;
  flags: Flag[];
  pulse: { file: string; from: number; to: number; key: number } | null;
  locked: boolean;
  canAsk: boolean;
  onFlag: (f: Flag & { on?: boolean }) => void;
  onAsk: (file: string, line: number) => void;
  /** one-line bugs tried on this stop that every test let through */
  unnoticed?: Unnoticed[];
  /** how many tests the project has: all of them passed with each unnoticed change */
  tests?: number;
  /** what the AI does not decide in this stop */
  points?: RulingItem[];
  rulings?: Record<string, Ruling>;
  onRule?: (id: string, decision: Ruling['decision'], note: string) => Promise<string | null>;
  /** the sessions behind the lines and what calls each changed function */
  entire?: Entire;
  /** what a second model marked in this stop, reading without our marks */
  second?: StopSecond;
}

/** a bar under a line, in the reading font */
const under = 'flex font-sans';

function Point({ p, ruling, locked, onRule, entire, brief }: { p: RulingItem; ruling?: Ruling; locked: boolean; onRule?: Props['onRule']; entire?: Entire; brief?: boolean }) {
  // one step: the reason first, then one of two buttons. Accepting needs a reason as much as sending back does
  const [note, setNote] = useState(ruling?.note ?? '');
  const [edit, setEdit] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  /** the reason is not there yet */
  const short = note.trim().length < MIN_RULING;
  const send = async (decision: Ruling['decision']) => {
    if (short || busy) return;
    setBusy(true);
    const e = await onRule?.(p.id, decision, note);
    setBusy(false);
    setErr(e ?? '');
    if (!e) setEdit(false);
  };
  const cancel = () => {
    setNote(ruling?.note ?? '');
    setErr('');
    setEdit(false);
  };
  const open = !ruling || edit;
  return (
    <div id={`P:${p.id}`} className={`${under} px-[14px] py-2`}>
      <div className={`w-full rounded-lg border px-3.5 py-3 whitespace-normal ${ruling && !edit ? (ruling.decision === 'accept' ? 'border-ok/30 bg-ok-soft' : 'border-flag/35 bg-flag-soft') : 'border-accent/45 bg-accent-soft'}`}>
        <p className="flex flex-wrap items-center gap-x-2 text-[11.5px] font-[590] text-accent-hi">
          <span>{p.kind === 'answer' ? 'The author answered a point sent back' : 'The AI does not decide this'}</span>
          <span className="font-[510] text-fg3">
            {p.kind === 'answer' ? 'You decide if it is answered' : POINT_KIND[p.kind]} · {p.to > p.from ? `lines ${p.from}–${p.to}` : `line ${p.from}`}
          </span>
        </p>
        <p className="mt-1.5 text-[13px] leading-[1.5] text-fg2">{inline(p.found)}</p>
        <p className="mt-1.5 text-[13.5px] leading-[1.45] font-[590] text-fg">{p.question}</p>
        {open ? (
          <div className="mt-2.5">
            {/* a reason is a sentence or two: it gets room to be read back whole, on a phone too */}
            <Grow
              autoFocus={edit}
              rows={2}
              value={note}
              disabled={locked}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && edit) cancel();
              }}
              maxLength={400}
              aria-label="Your reason"
              placeholder="Why is it fine as it is, or what must the author change? Say something that is true of these lines."
              aria-invalid={err ? true : undefined}
              className={`min-h-[54px] w-full rounded-md border bg-bg px-2.5 py-1.5 text-[13px] leading-[1.5] transition-colors placeholder:text-fg4 focus:border-accent ${err ? 'border-bad/60' : 'border-line-strong'}`}
            />
            {err && (
              <p className="mt-1.5 text-[12.5px] leading-[1.45] text-bad" role="alert">
                {err}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" className="btn" disabled={locked || short || busy} onClick={() => void send('accept')}>
                <Check size={13} className={short ? '' : 'text-ok'} /> {p.kind === 'answer' ? 'It is answered' : 'Accept as it is'}
              </button>
              <button type="button" className="btn" disabled={locked || short || busy} onClick={() => void send('back')}>
                <X size={12} className={short ? '' : 'text-flag'} /> {p.kind === 'answer' ? (
                  'Send back again'
                ) : (
                  <span>
                    Send back<span className="max-sm:sr-only"> to the author</span>
                  </span>
                )}
              </button>
              {edit && (
                <button type="button" className="btn btn-ghost" onClick={cancel}>
                  Cancel
                </button>
              )}
              <span className="text-[12px] text-fg3">{short ? `Write your reason first, at least ${MIN_RULING} characters.` : 'Your ruling and your reason go on the record under your name.'}</span>
            </div>
          </div>
        ) : (
          <p className="mt-2.5 flex flex-wrap items-center gap-x-2 text-[13px]">
            {ruling.decision === 'accept' ? (
              <span className="min-w-0 text-fg2">
                <span className="font-[590] text-ok">
                  <Check size={13} className="mr-1.5 inline align-[-2px]" />
                  You accepted this.{' '}
                </span>
                {ruling.note}
              </span>
            ) : (
              <span className="min-w-0 text-fg2">
                <span className="font-[590] text-flag">You sent this back. </span>
                {ruling.note}
              </span>
            )}
            {!locked && (
              <button className="text-[12px] text-fg4 underline-offset-2 hover:text-fg hover:underline" onClick={() => setEdit(true)}>
                Change
              </button>
            )}
          </p>
        )}
        {entire && <Why en={entire} file={p.file} from={p.from} to={p.to} finding={entire.trail?.findings[p.id]} brief={brief} />}
      </div>
    </div>
  );
}

export const Code = memo(function Code({ block, flags, pulse, locked, canAsk, onFlag, onAsk, unnoticed, tests, points, rulings, onRule, entire, second }: Props) {
  const removed = block.lines.filter((l) => l.kind === 'del').length;
  const added = block.lines.filter((l) => l.kind === 'add').length;
  const [showRemoved, setShowRemoved] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const notes = new Map((block.notes ?? []).map((n) => [n.line, n.text]));
  const mine = new Map(flags.filter((f) => f.file === block.file).map((f) => [f.line, f]));
  const focus = block.focus ?? [];
  const here = (unnoticed ?? []).filter((u) => u.file === block.file && block.from <= u.line && u.line <= block.to);
  const pts = (points ?? []).filter((p) => p.file === block.file && p.from <= block.to && p.to >= block.from);
  const slash = block.file.lastIndexOf('/') + 1;
  const act = !locked || canAsk;
  const closely = new Set<number>();
  for (const f of focus) for (let n = f.from; n <= f.to; n++) closely.add(n);
  for (const u of here) closely.add(u.line);
  for (const p of pts) for (let n = Math.max(p.from, block.from); n <= Math.min(p.to, block.to); n++) closely.add(n);
  // the second reader: which of our marked lines it marked too, and the lines only it would send to a person (never counted, never planted)
  const agreed = new Set((second?.agreed ?? []).filter((a) => a.file === block.file).map((a) => a.line));
  const extra = (second?.also ?? []).filter((a) => a.file === block.file && a.from <= block.to && a.to >= block.from);
  const also = new Set<number>();
  for (const a of extra) for (let n = Math.max(a.from, block.from); n <= Math.min(a.to, block.to); n++) if (!closely.has(n)) also.add(n);
  const second2 = (f: { from: number; to: number }) => {
    if (!second) return null;
    const all = f.to - f.from + 1;
    let n = 0;
    for (let l = f.from; l <= f.to; l++) if (agreed.has(l)) n++;
    return n === all ? 'The second reader marked this too.' : n ? `The second reader marked ${n} of these ${all} lines.` : 'The second reader did not mark this.';
  };
  // what calls a function is said under the first mark inside it, not again under every mark that follows in the same function
  const told = new Set<string>();
  const firstIn = (line: number) => {
    if (!entire) return false;
    const r = reachOf(entire, block.file, line);
    const key = r ? `${r.file}:${r.from}` : `s:${sessionOf(entire, block.file, line, line)?.n}`;
    if (told.has(key)) return false;
    told.add(key);
    return true;
  };
  // the long form of what a session was asked is said under the first open point it wrote, not again under each of the next five
  const asked = new Set<number>();
  const saidAbove = (p: RulingItem) => {
    const w = entire && sessionOf(entire, p.file, p.from, p.to);
    if (!w) return false;
    if (asked.has(w.n)) return true;
    asked.add(w.n);
    return false;
  };

  return (
    <div className="card my-5 overflow-hidden">
      <div className="flex items-center gap-3 border-b border-line px-4 py-2">
        <span className="min-w-0 truncate font-mono text-[12px]">
          <span className="text-fg4">{block.file.slice(0, slash)}</span>
          <span className="text-fg2">{block.file.slice(slash)}</span>
        </span>
        <span className="text-[11.5px] whitespace-nowrap text-fg4">
          lines {block.from}–{block.to}
        </span>
        <span className="ml-auto flex items-center gap-2 text-[11.5px] whitespace-nowrap">
          {closely.size > 0 && (
            <span className="flex items-center gap-1 text-warn" title="Lines to read closely in this block">
              <Eye size={12} /> {closely.size}
            </span>
          )}
          {added > 0 && <span className="text-ok">+{added}</span>}
          {removed > 0 && (
            <button className={`rounded px-1 hover:bg-hover ${showRemoved ? 'text-bad' : 'text-fg4'}`} onClick={() => setShowRemoved((v) => !v)} title="Lines this change removed">
              −{removed} {showRemoved ? 'shown' : 'hidden'}
            </button>
          )}
        </span>
      </div>
      <div>
        <div className="code py-2">
          {block.lines.map((l, i) => {
            if (l.n === null)
              return showRemoved ? (
                <div key={`d${i}`} className="row del">
                  <span className="num cursor-default!">−</span>
                  <span className="src" style={hang(l.tokens)}>
                    <Tokens tokens={l.tokens} />
                  </span>
                </div>
              ) : null;
            const n = l.n;
            const flag = mine.get(n);
            const note = notes.get(n);
            const starts = focus.filter((f) => f.from === n);
            const pointsHere = pts.filter((p) => Math.max(p.from, block.from) === n);
            const tried = here.filter((u) => u.line === n);
            const pulsing = pulse && pulse.file === block.file && pulse.from <= n && n <= pulse.to;
            const open = sel === n;
            const bare = !!flag && flag.note.trim().length < MIN_NOTE;
            const toggle = () => onFlag({ file: block.file, line: n, note: flag?.note ?? '', on: !flag });
            return (
              <div key={`${n}${pulsing ? `p${pulse.key}` : ''}`}>
                {pointsHere.map((p) => (
                  <Point key={p.id} p={p} ruling={rulings?.[p.id]} locked={locked} onRule={onRule} entire={entire} brief={saidAbove(p)} />
                ))}
                {starts.map((f) => (
                  <div key={`${f.from}-${f.to}`} className={`${under} items-start gap-2 py-1.5 pr-4 pl-[14px] ${i > 0 ? 'mt-1' : ''}`}>
                    <Eye size={13} className="mt-[2px] flex-none text-warn" />
                    <span className="text-[12.5px] leading-[18px] whitespace-normal text-fg2">
                      <span className="font-[590] text-warn">Read closely{f.to > f.from ? `, lines ${f.from}–${f.to}` : ''}. </span>
                      {inline(f.why)}
                      {entire && firstIn(f.from) && <Reached en={entire} file={block.file} line={f.from} />}
                      {second2(f) && <span className="block text-[12px] text-fg4">{second2(f)}</span>}
                    </span>
                  </div>
                ))}
                {extra
                  .filter((a) => Math.max(a.from, block.from) === n && also.has(n))
                  .map((a) => (
                    <div key={`s${a.from}`} className={`${under} items-start gap-2 py-1.5 pr-4 pl-[14px] ${i > 0 ? 'mt-1' : ''}`}>
                      <Eye size={13} className="mt-[2px] flex-none text-fg4" />
                      <span className="text-[12.5px] leading-[18px] whitespace-normal text-fg3">
                        <span className="font-[590] text-fg2">Second reader only{a.to > a.from ? `, lines ${a.from}–${a.to}` : ''}. </span>
                        {inline(a.why)} <span className="text-fg4">Our marks do not send this to you, so it is not counted in the lines to read closely.</span>
                      </span>
                    </div>
                  ))}
                <div
                  id={lineId(block.file, n)}
                  className={`row ${act ? 'pick' : ''} ${l.kind === 'add' ? 'add' : ''} ${closely.has(n) ? 'focus' : also.has(n) ? 'also' : ''} ${flag ? 'flagged' : ''} ${open ? 'sel' : ''} ${pulsing ? 'pulse' : ''}`}
                  onClick={() => act && !window.getSelection()?.toString() && setSel(open ? null : n)}
                >
                  <span className="num">{n}</span>
                  <span className="src" style={hang(l.tokens)}>
                    <Tokens tokens={l.tokens} />
                  </span>
                </div>
                {tried.map((u, k) => {
                  const c = changedPart(u.original, u.changed);
                  return (
                    <div key={k} className={`${under} items-start gap-2 py-1.5 pr-4 pl-[46px]`}>
                      <Warn size={13} className="mt-[2px] flex-none text-warn" />
                      <span className="text-[12.5px] leading-[18px] whitespace-normal text-fg2">
                        <span className="font-[590] text-warn">No test notices this line. </span>
                        We changed <code className="icode whitespace-normal! [overflow-wrap:anywhere]">{c.was}</code> to <code className="icode whitespace-normal! [overflow-wrap:anywhere]">{c.now}</code>
                        {tests ? ` and all ${tests} tests still passed` : ' and every test still passed'}. {u.effect}
                      </span>
                    </div>
                  );
                })}
                {note && (
                  <div className={`${under} items-start gap-2 py-1.5 pr-4 pl-[46px]`}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mt-[2px] flex-none text-fg4" aria-hidden>
                      <path d="M3.5 3v4.5a1 1 0 0 0 1 1h8M9.5 5.5l3 3-3 3" />
                    </svg>
                    <span className="text-[12.5px] leading-[18px] whitespace-normal text-fg2">{inline(note)}</span>
                  </div>
                )}
                {open && act && (
                  <div className={`${under} fade flex-wrap items-center gap-2 border-y border-line bg-raised py-1.5 pr-3 pl-[14px]`}>
                    <span className="mr-1 text-[12px] text-fg4">Line {n}</span>
                    {!locked && (
                      <button
                        className={`tool ${flag ? 'on' : ''}`}
                        onClick={() => {
                          toggle();
                          setSel(null);
                        }}
                      >
                        {flag ? <FlagFill size={12} /> : <FlagIcon size={12} />}
                        {flag ? 'Remove the flag' : 'Flag as wrong'}
                      </button>
                    )}
                    {canAsk && (
                      <button className="tool" onClick={() => onAsk(block.file, n)}>
                        <Chat size={12} />
                        Ask the guide
                      </button>
                    )}
                    <button className="ml-auto flex size-6 items-center justify-center rounded text-fg4 hover:bg-hover hover:text-fg" onClick={() => setSel(null)} title="Close">
                      <X size={12} />
                    </button>
                  </div>
                )}
                {flag && !locked && (
                  <div className={`${under} items-start gap-2 bg-flag-soft py-1 pr-3 pl-[14px]`}>
                    <FlagFill size={12} className="mt-2 flex-none text-flag" />
                    <Grow
                      className="min-w-0 flex-1 py-[5px] text-[12.5px] leading-[18px] text-fg placeholder:text-fg3"
                      placeholder="What goes wrong on this line? Needed: the reason is checked."
                      defaultValue={flag.note}
                      autoFocus={!flag.note}
                      maxLength={400}
                      onBlur={(e) => e.target.value !== flag.note && onFlag({ file: block.file, line: n, note: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        e.preventDefault();
                        e.currentTarget.blur();
                      }}
                    />
                    {bare && <span className="mt-[5px] hidden flex-none text-[11.5px] font-[510] text-flag sm:inline">reason needed</span>}
                    <button className="mt-0.5 flex size-6 flex-none items-center justify-center rounded text-fg4 hover:bg-hover hover:text-fg" onClick={toggle} title="Remove the flag">
                      <X size={12} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
