import { useLayoutEffect, useRef, useState } from 'react';
import type { CodeBlock, Entire, EntireSession, Reach } from '../../../shared/tour';
import { inline, Rich } from './Prose';

/** 2487719 -> "2.49M", 272850 -> "273k" */
export const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

const numberOf = (en: Entire, id: string) => en.sessions.findIndex((s) => s.id === id) + 1;

/** the session that wrote most of these lines, with its number in the order the sessions ran */
export function sessionOf(en: Entire, file: string, from: number, to: number): { s: EntireSession; n: number } | null {
  const by = new Map<string, number>();
  for (const l of en.lines) if (l.file === file && l.from <= to && l.to >= from) by.set(l.session, (by.get(l.session) ?? 0) + Math.min(l.to, to) - Math.max(l.from, from) + 1);
  const top = [...by].sort((a, b) => b[1] - a[1])[0];
  const s = top && en.sessions.find((x) => x.id === top[0]);
  return s ? { s, n: numberOf(en, s.id) } : null;
}

/** the changed function a line sits in, as Entire's code graph has it */
export const reachOf = (en: Entire, file: string, line: number): Reach | undefined => en.reach.filter((r) => r.file === file && r.from <= line && line <= r.to).sort((a, b) => a.to - a.from - (b.to - b.from))[0];

/** a function or file name inside a small grey line: mono, one step brighter, no chip */
const NAME = 'font-mono text-[11.5px] text-fg2 [overflow-wrap:anywhere]';

/** "Called by browseInvoices and exportInvoices; through them, listInvoices and exportCsv." */
export function Callers({ r }: { r: Reach }) {
  const direct = r.callers.filter((c) => !c.via);
  const through = r.callers.filter((c) => c.via);
  if (!direct.length) return null;
  const list = (xs: Reach['callers']) =>
    xs.map((c, i) => (
      <span key={`${c.file}:${c.name}`}>
        {i > 0 && (i === xs.length - 1 ? ' and ' : ', ')}
        <span title={`${c.file}${c.line ? `:${c.line}` : ''}${c.by === 'model' ? ' · found by a model: the graph lists no caller here' : ''}`}>
          {c.name === c.file ? (
            <>
              top-level code in <code className={NAME}>{c.file.split('/').slice(-2).join('/')}</code>
            </>
          ) : (
            <code className={NAME}>{c.name}</code>
          )}
        </span>
      </span>
    ));
  return (
    <>
      <code className={NAME}>{r.name}</code> is called by {list(direct)}
      {through.length > 0 && (
        <>
          ; through {direct.length === 1 ? 'it' : 'them'}, by {list(through)}
        </>
      )}
      .
    </>
  );
}

/** One line under a "Read closely" mark: what calls this function and which session wrote it. No model wrote this line. */
export function Reached({ en, file, line }: { en: Entire; file: string; line: number }) {
  const r = reachOf(en, file, line);
  const w = sessionOf(en, file, line, line);
  if (!r?.callers.some((c) => !c.via) && !w) return null;
  return (
    <span className="mt-1 block text-[12px] leading-[17px] text-fg3">
      {r && <Callers r={r} />} {w && en.sessions.length > 1 && <>Written in session {w.n}.</>} <span className="text-fg4">From Entire{r?.callers.some((c) => c.by === 'model') ? '' : ', no model'}.</span>
    </span>
  );
}

/** Under an open point: which session wrote these lines and what it was asked, so the reviewer rules knowing why the code exists. */
export function Why({ en, file, from, to, finding }: { en: Entire; file: string; from: number; to: number; finding?: string }) {
  const w = sessionOf(en, file, from, to);
  if (!w) return null;
  return (
    <div className="mt-3 border-t border-white/[0.07] pt-2.5 text-[12px] leading-[1.5] text-fg3">
      <p>
        <span className="font-[590] text-fg2">Why the agent wrote it. </span>
        Session {w.n} of {en.sessions.length}, which was asked: “{w.s.asked}”{w.s.detail && w.n > 1 ? ` ${w.s.detail}` : ''}
      </p>
      {finding && en.trail ? <p className="mt-0.5 text-fg4">Finding on Entire trail #{en.trail.number}: your ruling is written there too.</p> : null}
    </div>
  );
}

/**
 * The agent's report as it wrote it. The first lines show, the rest opens in place:
 * a scroll box inside a scrolling page hides most of the report and traps the wheel.
 */
function Report({ text }: { text: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [all, setAll] = useState(false);
  useLayoutEffect(() => {
    if (box.current) setLong(box.current.scrollHeight > CLAMP + 48);
  }, [text]);
  // a markdown heading stays a heading: one bold line over its part
  const parts: { head?: string; body: string[] }[] = [{ body: [] }];
  // gen/entire.ts keeps the first 4000 characters of a report: one that long stops mid-sentence, and the page says so
  const cutOff = text.length >= REPORT_KEPT;
  for (const l of (cutOff ? `${text.trimEnd()}…` : text).split('\n')) {
    const h = /^#+\s+(.*)$/.exec(l.trim());
    if (h) parts.push({ head: h[1]!, body: [] });
    else if (!/^-{3,}$/.test(l.trim())) parts.at(-1)!.body.push(l);
  }
  const cut = long && !all;
  return (
    <>
      <div ref={box} className="relative overflow-hidden" style={cut ? { maxHeight: CLAMP, maskImage: 'linear-gradient(#000 calc(100% - 56px), transparent)', WebkitMaskImage: 'linear-gradient(#000 calc(100% - 56px), transparent)' } : undefined}>
        {parts.map((p, i) => (
          <div key={i} className={i > 0 && p.head ? 'mt-3' : ''}>
            {p.head && <p className="mb-1 font-[590] text-fg">{inline(p.head)}</p>}
            {p.body.some((l) => l.trim()) && <Rich text={p.body.join('\n')} />}
          </div>
        ))}
        {cutOff && <p className="mt-2 text-fg4">The report goes on. Shown here: its first {REPORT_KEPT.toLocaleString('en-US')} characters.</p>}
      </div>
      {long && (
        <button className="mt-2 text-[12px] font-[510] text-accent-hi underline-offset-2 hover:underline" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? 'Show less of the report' : cutOff ? 'Show more of the report' : 'Show the whole report'}
        </button>
      )}
    </>
  );
}
const CLAMP = 176;
const REPORT_KEPT = 4000;

/** Where a stop's code comes from: the agent sessions behind its lines, as Entire holds them. */
export function Origin({ en, code }: { en: Entire; code: CodeBlock[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const by = new Map<string, number>();
  for (const b of code) for (const l of en.lines) if (l.file === b.file && l.from <= b.to && l.to >= b.from) by.set(l.session, (by.get(l.session) ?? 0) + Math.min(l.to, b.to) - Math.max(l.from, b.from) + 1);
  const rows = en.sessions.map((s, i) => ({ s, n: i + 1, lines: by.get(s.id) ?? 0 })).filter((x) => x.lines > 0);
  if (!rows.length) return null;
  return (
    <div className="card mt-3 overflow-hidden text-[13px]">
      <p className="flex flex-wrap items-baseline gap-x-2 border-b border-line px-4 py-2 text-[11.5px] font-[510] text-fg4">
        <span>Where this code comes from</span>
        <span className="font-normal">The agent’s sessions, kept by Entire and tied to the commit each one wrote</span>
      </p>
      <div className="divide-y divide-line">
        {rows.map(({ s, n, lines }) => (
          <div key={s.id}>
            <button className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 text-left transition-colors hover:bg-hover" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id}>
              <span className="flex flex-none items-center gap-1.5 font-[590] text-fg">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={`flex-none text-fg4 transition-transform duration-200 ease-out-quint ${open === s.id ? 'rotate-90' : ''}`} aria-hidden>
                  <path d="m3.5 2 3 3-3 3" />
                </svg>
                Session {n}
              </span>
              <span className="min-w-0 flex-1 basis-[240px] leading-[1.45] text-fg2">
                <span className="text-fg4">Asked: </span>
                {s.asked}
              </span>
              <span className="flex-none text-[12px] text-fg4 tabular-nums max-sm:basis-full max-sm:pl-4">
                {lines} {lines === 1 ? 'line' : 'lines'} here · {tokens(s.tokens.total)} tokens
              </span>
            </button>
            {open === s.id && (
              <div className="fade border-t border-line bg-bg px-4 pt-3 pb-3.5 text-[12.5px] leading-[1.55] text-fg2 sm:pl-[38px]">
                {s.detail && <p className="max-w-[72ch] text-fg3">{s.detail}</p>}
                <p className={`mb-1.5 text-[11.5px] font-[510] text-fg4 ${s.detail ? 'mt-3.5' : ''}`}>
                  The agent’s own report · {s.agent}, {s.model} · commit <span className="font-mono">{s.commit.slice(0, 7)}</span>
                </p>
                <div className="max-w-[72ch]">
                  <Report text={s.report} />
                </div>
                <p className="mt-3 border-t border-line pt-2.5 text-[11.5px] leading-[1.5] text-fg4">
                  {s.transcript ? `The whole session is kept: every step and tool call${s.tokens.apiCalls ? `, ${s.tokens.apiCalls} model calls` : ''}.` : 'Of this session only the prompt, this report and the token counts were kept, not its steps.'} {tokens(s.tokens.output)} tokens written,{' '}
                  {tokens(s.tokens.cacheRead)} read from cache.
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
