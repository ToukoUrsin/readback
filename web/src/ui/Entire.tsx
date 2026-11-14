import { useState } from 'react';
import type { CodeBlock, Entire, EntireSession, Reach } from '../../../shared/tour';
import { Rich } from './Prose';

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

const nameOf = (c: { name: string; file: string }) => (c.name === c.file ? `top-level code in ${c.file.split('/').slice(-2).join('/')}` : c.name);

/** "Called by browseInvoices and exportInvoices; through them, listInvoices and exportCsv." */
export function Callers({ r }: { r: Reach }) {
  const direct = r.callers.filter((c) => !c.via);
  const through = r.callers.filter((c) => c.via);
  if (!direct.length) return null;
  const list = (xs: Reach['callers']) =>
    xs.map((c, i) => (
      <span key={`${c.file}:${c.name}`}>
        {i > 0 && (i === xs.length - 1 ? ' and ' : ', ')}
        <code className="icode" title={`${c.file}${c.line ? `:${c.line}` : ''}${c.by === 'model' ? ' · found by a model: the graph lists no caller here' : ''}`}>
          {nameOf(c)}
        </code>
      </span>
    ));
  return (
    <>
      <code className="icode">{r.name}</code> is called by {list(direct)}
      {through.length > 0 && <>; through {direct.length === 1 ? 'it' : 'them'}, by {list(through)}</>}.
    </>
  );
}

/** One line under a "Read closely" mark: what calls this function and which session wrote it. No model wrote this line. */
export function Reached({ en, file, line }: { en: Entire; file: string; line: number }) {
  const r = reachOf(en, file, line);
  const w = sessionOf(en, file, line, line);
  if (!r?.callers.some((c) => !c.via) && !w) return null;
  return (
    <span className="mt-0.5 block text-[12px] leading-[17px] text-fg3">
      {r && <Callers r={r} />} {w && en.sessions.length > 1 && <>Written in session {w.n}.</>} <span className="text-fg4">From Entire{r?.callers.some((c) => c.by === 'model') ? '' : ', no model'}.</span>
    </span>
  );
}

/** Under an open point: which session wrote these lines and what it was asked, so the reviewer rules knowing why the code exists. */
export function Why({ en, file, from, to, finding }: { en: Entire; file: string; from: number; to: number; finding?: string }) {
  const w = sessionOf(en, file, from, to);
  if (!w) return null;
  return (
    <p className="mt-2 border-t border-line pt-2 text-[12px] leading-[1.5] text-fg3">
      <span className="font-[590] text-fg2">Why the agent wrote it. </span>
      Session {w.n} of {en.sessions.length}, which was asked: “{w.s.asked}”{w.s.detail && w.n > 1 ? ` ${w.s.detail}` : ''}
      {finding && en.trail ? <span className="text-fg4"> · Finding on Entire trail #{en.trail.number}: your ruling is written there too.</span> : null}
    </p>
  );
}

/** Where a stop's code comes from: the agent sessions behind its lines, as Entire holds them. */
export function Origin({ en, code }: { en: Entire; code: CodeBlock[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const by = new Map<string, number>();
  for (const b of code) for (const l of en.lines) if (l.file === b.file && l.from <= b.to && l.to >= b.from) by.set(l.session, (by.get(l.session) ?? 0) + Math.min(l.to, b.to) - Math.max(l.from, b.from) + 1);
  const rows = en.sessions.map((s, i) => ({ s, n: i + 1, lines: by.get(s.id) ?? 0 })).filter((x) => x.lines > 0);
  if (!rows.length) return null;
  return (
    <div className="card mt-3 text-[13px]">
      <p className="flex flex-wrap items-baseline gap-x-2 border-b border-line px-4 py-2 text-[11.5px] font-[510] text-fg4">
        <span>Where this code comes from</span>
        <span className="font-normal">The agent’s sessions, kept by Entire and tied to the commit each one wrote</span>
      </p>
      <div className="divide-y divide-line">
        {rows.map(({ s, n, lines }) => (
          <div key={s.id}>
            <button className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 text-left hover:bg-hover" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id}>
              <span className="flex-none font-[590] text-fg">Session {n}</span>
              <span className="min-w-0 flex-1 basis-[240px] leading-[1.45] text-fg2">
                <span className="text-fg4">Asked: </span>
                {s.asked}
              </span>
              <span className="flex-none text-[12px] text-fg4 tabular-nums">
                {lines} {lines === 1 ? 'line' : 'lines'} here · {tokens(s.tokens.total)} tokens
              </span>
            </button>
            {open === s.id && (
              <div className="fade border-t border-line bg-bg px-4 py-3 text-[12.5px] leading-[1.55] text-fg2">
                {s.detail && <p className="text-fg3">{s.detail}</p>}
                <p className="mt-2 text-[11.5px] font-[510] text-fg4">
                  The agent’s own report · {s.agent}, {s.model} · commit <span className="font-mono">{s.commit.slice(0, 7)}</span>
                </p>
                <div className="mt-1 max-h-[220px] overflow-y-auto pr-2">
                  <Rich text={s.report.replace(/^#+\s*/gm, '').replace(/^-{3,}$/gm, '')} />
                </div>
                <p className="mt-2 text-[11.5px] text-fg4">
                  {s.transcript ? `The whole session is kept: every step and tool call${s.tokens.apiCalls ? `, ${s.tokens.apiCalls} model calls` : ''}.` : 'Of this session only the prompt, this report and the token counts were kept, not its steps.'} {tokens(s.tokens.output)} tokens written, {tokens(s.tokens.cacheRead)} read from cache.
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
