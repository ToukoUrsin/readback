import { type CSSProperties, memo, useState } from 'react';
import type { CodeBlock, Flag, Ruling, RulingItem, StopEvidence, Token } from '../../../shared/tour';
import { Chat, Check, Eye, Flag as FlagIcon, FlagFill, Warn, X } from './icons';
import { inline } from './Prose';

export const lineId = (file: string, n: number) => `L:${file}:${n}`;
/** a flag needs this many characters of reason before the review can be handed in (server/app.ts MIN_NOTE) */
export const MIN_NOTE = 8;
export const POINT_KIND: Record<RulingItem['kind'], string> = { unasked: 'Nobody asked for this', open: 'The issue leaves this open', untested: 'No test checks this' };

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
}

/** a bar under a line, in the reading font */
const under = 'flex font-sans';

function Point({ p, ruling, locked, onRule }: { p: RulingItem; ruling?: Ruling; locked: boolean; onRule?: Props['onRule'] }) {
  const [back, setBack] = useState(false);
  const [note, setNote] = useState(ruling?.decision === 'back' ? ruling.note : '');
  const [edit, setEdit] = useState(false);
  const [err, setErr] = useState('');
  const send = async (decision: Ruling['decision']) => {
    const e = await onRule?.(p.id, decision, decision === 'back' ? note : '');
    setErr(e ?? '');
    if (!e) {
      setBack(false);
      setEdit(false);
    }
  };
  const open = !ruling || edit;
  return (
    <div id={`P:${p.id}`} className={`${under} px-[14px] py-2`}>
      <div className={`w-full rounded-lg border px-3.5 py-3 whitespace-normal ${ruling && !edit ? (ruling.decision === 'accept' ? 'border-ok/30 bg-ok-soft' : 'border-flag/35 bg-flag-soft') : 'border-accent/45 bg-accent-soft'}`}>
        <p className="flex flex-wrap items-center gap-x-2 text-[11.5px] font-[590] text-accent-hi">
          <span>The AI does not decide this</span>
          <span className="font-[510] text-fg3">
            {POINT_KIND[p.kind]} · {p.to > p.from ? `lines ${p.from}–${p.to}` : `line ${p.from}`}
          </span>
        </p>
        <p className="mt-1.5 text-[13px] leading-[1.5] text-fg2">{inline(p.found)}</p>
        <p className="mt-1.5 text-[13.5px] leading-[1.45] font-[590] text-fg">{p.question}</p>
        {open ? (
          <div className="mt-2.5">
            {back ? (
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send('back');
                }}
              >
                <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} placeholder="What does the author have to change?" className="h-8 min-w-[200px] flex-1 rounded-md border border-line-strong bg-bg px-2.5 text-[13px] placeholder:text-fg4 focus:border-flag" />
                <button className="btn" disabled={note.trim().length < MIN_NOTE}>
                  Send back
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setBack(false)}>
                  Cancel
                </button>
              </form>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn" disabled={locked} onClick={() => void send('accept')}>
                  <Check size={13} className="text-ok" /> Accept as it is
                </button>
                <button className="btn" disabled={locked} onClick={() => setBack(true)}>
                  <X size={12} className="text-flag" /> Send back to the author
                </button>
                <span className="text-[12px] text-fg4">Your ruling goes on the record under your name.</span>
              </div>
            )}
            {err && <p className="mt-1.5 text-[12.5px] text-bad">{err}</p>}
          </div>
        ) : (
          <p className="mt-2.5 flex flex-wrap items-center gap-x-2 text-[13px]">
            {ruling.decision === 'accept' ? (
              <span className="flex items-center gap-1.5 font-[590] text-ok">
                <Check size={13} /> You accepted this.
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
      </div>
    </div>
  );
}

export const Code = memo(function Code({ block, flags, pulse, locked, canAsk, onFlag, onAsk, unnoticed, tests, points, rulings, onRule }: Props) {
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
                  <Point key={p.id} p={p} ruling={rulings?.[p.id]} locked={locked} onRule={onRule} />
                ))}
                {starts.map((f) => (
                  <div key={`${f.from}-${f.to}`} className={`${under} items-start gap-2 py-1.5 pr-4 pl-[14px] ${i > 0 ? 'mt-1' : ''}`}>
                    <Eye size={13} className="mt-[2px] flex-none text-warn" />
                    <span className="text-[12.5px] leading-[18px] whitespace-normal text-fg2">
                      <span className="font-[590] text-warn">Read closely{f.to > f.from ? `, lines ${f.from}–${f.to}` : ''}. </span>
                      {inline(f.why)}
                    </span>
                  </div>
                ))}
                <div
                  id={lineId(block.file, n)}
                  className={`row ${act ? 'pick' : ''} ${l.kind === 'add' ? 'add' : ''} ${closely.has(n) ? 'focus' : ''} ${flag ? 'flagged' : ''} ${open ? 'sel' : ''} ${pulsing ? 'pulse' : ''}`}
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
                  <div className={`${under} items-center gap-2 bg-flag-soft py-1 pr-3 pl-[14px]`}>
                    <FlagFill size={12} className="flex-none text-flag" />
                    <input
                      className="h-7 min-w-0 flex-1 text-[12.5px] text-fg placeholder:text-fg3"
                      placeholder="What goes wrong on this line? Needed: the reason is checked."
                      defaultValue={flag.note}
                      autoFocus={!flag.note}
                      maxLength={400}
                      onBlur={(e) => e.target.value !== flag.note && onFlag({ file: block.file, line: n, note: e.target.value })}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    />
                    {bare && <span className="hidden flex-none text-[11.5px] font-[510] text-flag sm:inline">reason needed</span>}
                    <button className="flex size-6 flex-none items-center justify-center rounded text-fg4 hover:bg-hover hover:text-fg" onClick={toggle} title="Remove the flag">
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
