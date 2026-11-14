/**
 * What /concept and /numbers share: the top bar, the page frame with its section list, the fetch of /api/numbers,
 * and the rule the commit status follows. Every number on both pages comes from /api/numbers; nothing is written in.
 */
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Logo } from './icons';

/* ---- the shape of GET /api/numbers (server/numbers.ts, server/store.ts) ---- */

export interface Counts {
  started: number;
  reads: number;
  caughtFirstRead: number;
  missedFirstRead: number;
  caughtLater: number;
  signed: number;
  handIns: number;
  medianSeconds: number | null;
  medianSecondsToSignature: number | null;
  medianWrongAnswers: number | null;
  failed: number;
  fastSignatures: number;
  approved: number;
  sentBack: number;
  notCounted: number;
  noteFailed: number;
}
export interface ColdCounts {
  shown: number;
  approved: number;
  flaggedPlanted: number;
  flaggedOther: number;
  skipped: number;
  medianSeconds: number | null;
  thenGuided: { reads: number; caughtFirstRead: number };
}
export interface Band {
  band: string;
  met: number;
  caught: number;
  missed: number;
}
export interface Group {
  goes: number;
  cold: ColdCounts;
  reviews: Record<string, Counts | undefined>;
  rulings: { accepted: number; sentBack: number };
  asked: number;
  pace: Band[];
  coldPace: Band[];
}
export interface ReaderRow {
  reader: string;
  area: string;
  met: number;
  caught: number;
  missed: number;
  needsSecond: boolean;
}
export interface RouteStop {
  id: string;
  title: string;
  route: 'read' | 'evidence';
  lines: number;
  closely: number;
  risk: string[];
  criteria: number[];
  tried: number;
  caught: number;
  unnoticed: number;
  why: string[];
}
export interface Point {
  id: string;
  kind: string;
  stopId: string;
  file: string;
  from: number;
  to: number;
  found: string;
  question: string;
  people: { accepted: number; sentBack: number };
  agents: { accepted: number; sentBack: number };
}
export interface Rule {
  maxWrong: number;
  maxReads: number;
  fastLinesPerMinute: number;
  paceLimit: number;
  lockSeconds: number;
  maxFlags: number;
}
export interface Numbers {
  at: string;
  people: Group;
  agents: Group;
  readers: ReaderRow[];
  route: { linesAll: number; linesToRead: number; stopsToRead: number; stops: RouteStop[]; tests: { passed: number; failed: number }; tried: number; caught: number; unnoticed: number } | null;
  points: Point[];
  planted: { total: number; byKind: Record<string, number> };
  rule: Rule;
  pr: { repo: string; number: number; title: string; url: string; headSha: string; additions: number; deletions: number; files: number; issue?: { number: number; title: string } };
  criteria: { n: number; text: string }[];
  madeBy: { plan: { model: string; plantModel?: string; costUsd: number }; evidence?: { model: string; costUsd: number } };
  stops: number;
  questions: number;
  /** what Entire holds about the change (gen/entire.ts), and the same caller question asked of a model (gen/efficiency.ts) */
  history?: {
    sessions: { n: number; asked: string; commit: string; tokens: number; written: number; steps: boolean }[];
    graph: { files: number; symbols: number; relations: number; functions: number; msPerQuery: number };
    versions: { cli: string; graph: string };
    trail?: { number: number; findings: number };
    callers?: { functions: number; model: string; tokens: number; seconds: number; medianTokens: number; medianSeconds: number; same: number; modelFoundMore: number; graphFoundMore: number; mixed: { asked: number; tokens: number; sameAsModel: boolean } };
  };
  /** the questions, checked by a second model with the code and without it (gen/questions.ts) */
  questionCheck?: { writer: string; checker: string; costUsd: number; checked: number; kept: number; wrongKey: number; withoutCode: number; first: { checked: number; withoutCode: number; kept: number }; perStop: number };
  demo?: { judgeLink: boolean; minutes?: number; reviewers?: number };
}

/* ---- data ---- */

/** Reads /api/numbers once, and again every `refreshMs` while the tab is in front. A failed refresh keeps the last counts. */
export function useNumbers(refreshMs = 0) {
  const [data, setData] = useState<Numbers | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const r = await fetch('/api/numbers', { credentials: 'omit', headers: { accept: 'application/json' } });
        if (!r.ok) throw new Error(`the server answered ${r.status}`);
        const d = (await r.json()) as Numbers;
        if (!live) return;
        setData(d);
        setError('');
      } catch (e) {
        if (live) setError((e as Error).message || 'no answer');
      }
    };
    void load();
    const t = refreshMs ? setInterval(() => !document.hidden && void load(), refreshMs) : undefined;
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [refreshMs]);
  return { data, error, loading: !data && !error };
}

/** True while the numbers are on their way: a missing value is then a placeholder, not "n/a". */
export const Pending = createContext(false);

/** One value from the API. Never a made-up fallback: a grey block while loading, "n/a" when the server did not give it. */
export function N({ v }: { v: number | string | null | undefined }) {
  const pending = useContext(Pending);
  if (v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v)))
    return pending ? (
      <span className="skeleton inline-block h-[0.85em] w-[2.4ch] rounded-[3px] align-[-0.06em]" role="status" aria-label="loading" />
    ) : (
      <span className="text-fg3" title="The server did not give this number">
        n/a
      </span>
    );
  return <span className="tabular-nums">{typeof v === 'number' ? v.toLocaleString('en-US') : v}</span>;
}

export const fmtSeconds = (s: number | null | undefined) => (s === null || s === undefined ? 'none yet' : s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`);

/** "9.8%", "42%"; null when there is nothing to divide by. */
export const pct = (part: number | undefined, whole: number | undefined) => {
  if (part === undefined || !whole) return null;
  const p = (part / whole) * 100;
  return `${p > 0 && p < 10 ? p.toFixed(1) : Math.round(p)}%`;
};

/* ---- frame ---- */

type Where = 'concept' | 'numbers';

function TopBar({ current }: { current: Where }) {
  const link = (to: Where, label: string) => (
    <a
      href={`/${to}`}
      aria-current={current === to ? 'page' : undefined}
      className={`flex h-[28px] items-center rounded-md px-[10px] text-[13px] font-[510] transition-colors ${current === to ? 'bg-active text-fg' : 'text-fg3 hover:bg-hover hover:text-fg'}`}
    >
      {label}
    </a>
  );
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg">
      <div className="mx-auto flex h-[48px] max-w-[1160px] items-center gap-[4px] px-4 sm:px-6">
        <a href="/" className="mr-[8px] flex items-center gap-[8px] rounded-md text-[14px] font-[590] tracking-[-0.01em] text-fg sm:mr-[14px]" aria-label="Readback, start">
          <Logo size={20} />
          <span className="max-[430px]:hidden">Readback</span>
        </a>
        <nav className="flex items-center gap-[2px]" aria-label="Pages">
          {link('concept', 'Concept')}
          {link('numbers', 'Numbers')}
        </nav>
        <a href="/?new=1" className="btn btn-primary ml-auto">
          <span>
            Review<span className="max-[349px]:hidden"> the change</span>
          </span>
        </a>
      </div>
    </header>
  );
}

export interface SectionRef {
  id: string;
  label: string;
}

/**
 * One scrolling page (body does not scroll): top bar, a section list that stays in view on wide screens, the content.
 * `sections` must be a constant array.
 */
export function Shell({ current, sections, wide, children }: { current: Where; sections: SectionRef[]; wide?: boolean; children: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(sections[0]?.id);

  // narrow screens: keep the section you are in visible in the row of sections
  useEffect(() => {
    const row = strip.current;
    const on = row?.querySelector<HTMLElement>('[aria-current]');
    if (!row || !on || !row.clientWidth) return;
    row.scrollTo({ left: on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2, behavior: 'smooth' });
  }, [active]);

  useEffect(() => {
    document.title = `${current === 'concept' ? 'Concept' : 'Numbers'} · Readback`;
  }, [current]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const line = el.getBoundingClientRect().top + 150;
        let cur = sections[0]?.id;
        for (const s of sections) {
          const node = document.getElementById(s.id);
          if (node && node.getBoundingClientRect().top <= line) cur = s.id;
        }
        if (el.scrollTop > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 4) cur = sections.at(-1)?.id ?? cur;
        setActive(cur);
      });
    };
    on();
    el.addEventListener('scroll', on, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', on);
    };
  }, [sections]);

  return (
    <div ref={scroller} className="h-full overflow-x-hidden overflow-y-auto scroll-smooth motion-reduce:scroll-auto">
      <TopBar current={current} />
      <nav aria-label="On this page" className="sticky top-[48px] z-10 border-b border-line bg-bg lg:hidden">
        <ul ref={strip} className="relative flex gap-[2px] overflow-x-auto [mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)] px-[10px] py-[6px] [scrollbar-width:none] sm:px-[18px] [&::-webkit-scrollbar]:hidden">
          {sections.map((s) => (
            <li key={s.id} className="flex-none last:pr-6">
              <a
                href={`#${s.id}`}
                aria-current={active === s.id ? 'location' : undefined}
                className={`flex h-[28px] items-center rounded-md px-[9px] text-[12.5px] whitespace-nowrap transition-colors ${active === s.id ? 'bg-active font-[510] text-fg' : 'text-fg3 hover:text-fg'}`}
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mx-auto flex max-w-[1160px] px-4 sm:px-6 lg:gap-[56px]">
        <nav aria-label="On this page" className="sticky top-[48px] hidden max-h-[calc(100dvh-48px)] w-[176px] flex-none self-start overflow-y-auto pt-[60px] pb-10 lg:block">
          <ul className="border-l border-line">
            {sections.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  aria-current={active === s.id ? 'location' : undefined}
                  className={`-ml-px block border-l py-[5px] pl-[14px] text-[12.5px] leading-[1.35] transition-colors ${active === s.id ? 'border-fg2 font-[510] text-fg' : 'border-transparent text-fg3 hover:text-fg'}`}
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <main className={`min-w-0 flex-1 pt-9 pb-24 sm:pt-[56px] ${wide ? '' : 'max-w-[780px]'}`}>{children}</main>
      </div>
    </div>
  );
}

/** A section of a page. `id` is what the section list points at. */
export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mt-[48px] scroll-mt-[104px] border-t border-line pt-[32px] sm:mt-[56px] lg:scroll-mt-[64px] sm:pt-[36px]">
      <h2 className="text-[20px] leading-[1.25] font-[590] tracking-[-0.016em] text-fg sm:text-[22px]">{title}</h2>
      {children}
    </section>
  );
}

/** The plain line shown when /api/numbers did not answer. */
export function LoadError({ error, stale }: { error: string; stale?: boolean }) {
  return (
    <p className="mb-6 rounded-lg border border-bad/30 bg-bad-soft px-3.5 py-2.5 text-[13px] leading-[1.5] text-fg2" role="alert">
      {stale ? 'Could not refresh the numbers' : 'Could not load the numbers'} ({error}). {stale ? 'These are the last counts that arrived.' : 'They come from /api/numbers on this copy. Load the page again in a moment.'}
    </p>
  );
}

/** A share as a bar: `part` of `whole`. */
export function Bar({ part, whole, tone = 'bg-warn', className = '' }: { part: number; whole: number; tone?: string; className?: string }) {
  const w = whole > 0 ? Math.min(100, (part / whole) * 100) : 0;
  return (
    <div className={`h-[6px] overflow-hidden rounded-full bg-active ${className}`} aria-hidden>
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${w}%`, minWidth: part > 0 ? 3 : 0 }} />
    </div>
  );
}

/* ---- the rule the commit status follows: the same text on both pages ---- */

export function RuleCard({ rule }: { rule: Rule | undefined }) {
  const holds: ReactNode[] = [
    <>Signed in with GitHub, or invited by the repository’s team with its judge link. Any other typed name is recorded and never approves.</>,
    <>
      Every question right, with at most <N v={rule?.maxWrong} /> wrong tries.
    </>,
    <>
      The planted bug flagged by read <N v={rule?.maxReads} /> at the latest, with a reason that says what the line does wrong.
    </>,
    <>
      Under <N v={rule?.paceLimit} /> of the lines to read closely a minute over the whole review, and every stop that has such lines open for at least the time it takes to scroll it (4 lines a second, a minute at most).
    </>,
    <>Every open point ruled on, and none sent back.</>,
  ];
  const head = (dot: string, name: string, status: string) => (
    <p className="flex flex-wrap items-center gap-x-[8px] gap-y-1 text-[14px] font-[590] text-fg">
      <span className={`size-[8px] flex-none rounded-full ${dot}`} aria-hidden />
      {name}
      <span className="font-[450] text-fg3">{status}</span>
    </p>
  );
  return (
    <div className="card mt-5 divide-y divide-line">
      <div className="px-4 py-4">
        {head('bg-ok', 'Approved', 'status green, only when all of these hold')}
        <ul className="mt-3 space-y-[9px]">
          {holds.map((h, i) => (
            <li key={i} className="flex gap-[10px] text-[13.5px] leading-[1.5] text-fg2">
              <Check size={14} className="mt-[3px] flex-none text-ok" />
              <span className="min-w-0">{h}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="px-4 py-3.5">
        {head('bg-bad', 'Sent back', 'status red')}
        <p className="mt-1.5 pl-[16px] text-[13.5px] leading-[1.5] text-fg2">The same read, with one or more points sent back to the author.</p>
      </div>
      <div className="px-4 py-3.5">
        {head('bg-fg4', 'Anything else', 'no status change')}
        <p className="mt-1.5 pl-[16px] text-[13.5px] leading-[1.5] text-fg2">The review is recorded and changes nothing on GitHub.</p>
      </div>
    </div>
  );
}

export function ReviewLink({ large }: { large?: boolean }) {
  return (
    <a href="/?new=1" className={`btn btn-primary ${large ? 'btn-lg' : ''}`}>
      Review the change <ArrowRight size={large ? 15 : 14} />
    </a>
  );
}
