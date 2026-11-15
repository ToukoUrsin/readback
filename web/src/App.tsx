import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AnswerState, Flag, PublicTour, Reveal, Ruling } from '../../shared/tour';
import { api, bodyOf } from './api';
import { Cold, ColdOutcome } from './pages/Cold';
import { HandIn } from './pages/HandIn';
import { Intro } from './pages/Intro';
import { StopView } from './pages/StopView';
import { Ask, type Msg } from './ui/Ask';
import { lineId } from './ui/Code';
import { Chat, FlagFill, Menu } from './ui/icons';
import { Sidebar, type At } from './ui/Sidebar';
import { LoadFailed, Loading } from './ui/States';

const fromHash = (): At => decodeURIComponent(location.hash.replace(/^#\/?/, '')) || 'intro';
const NONE: Record<string, Ruling> = {};
const typing = (e: KeyboardEvent) => /^(INPUT|TEXTAREA)$/.test((e.target as HTMLElement).tagName);

/**
 * The time the review takes. It counts from the start to the hand-in that caught the planted bug and stands still from then on:
 * a signed review shows the seconds its signature carries.
 */
function Clock({ from, caught, took }: { from: string; caught: boolean; took?: number }) {
  const running = !caught && took === undefined;
  const key = `rb_took:${location.pathname}:${from}`;
  // handed in before this page was loaded: the time is known only if this browser kept it
  const [now, setNow] = useState<number | null>(() => {
    if (running) return Date.now();
    try {
      const kept = Number(sessionStorage.getItem(key));
      return kept > 0 ? kept : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  useEffect(() => {
    if (running || now === null) return;
    try {
      sessionStorage.setItem(key, String(now));
    } catch {
      /* no storage: the time stands still until the page is loaded again */
    }
  }, [running, now, key]);
  if (took === undefined && now === null) return null;
  const s = took ?? Math.max(0, Math.round((now! - Date.parse(from)) / 1000));
  return (
    <span className="chip hidden sm:inline-flex" title={running ? 'Time since you started reading' : 'The time this review took, up to the hand-in'}>
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
    </span>
  );
}

export default function App() {
  const [tour, setTour] = useState<PublicTour | null>(null);
  const [failed, setFailed] = useState('');
  const [at, setAt] = useState<At>(fromHash);
  const [askOpen, setAskOpen] = useState(false);
  const [askLine, setAskLine] = useState<{ file: string; line: number } | null>(null);
  const [askFocus, setAskFocus] = useState(0);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [menu, setMenu] = useState(false);
  const [pulse, setPulse] = useState<{ file: string; from: number; to: number; key: number } | null>(null);
  const [missedNow, setMissedNow] = useState<Reveal | null>(null);
  const [flash, setFlash] = useState('');
  const main = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // "?new=1" starts over as a new reader: one link puts the page back to its first screen
    const q = new URLSearchParams(location.search);
    const fresh = q.get('new') === '1';
    if (fresh) {
      q.delete('new');
      history.replaceState(null, '', location.pathname + (q.size ? `?${q}` : ''));
    }
    // "?prep=<key>&leave=<stop>[&plant=<id>]": for a recording, the questions are answered ahead (test readers with the key only)
    const prep = q.get('prep');
    const leave = q.get('leave') ?? '';
    const plant = q.get('plant') ?? '';
    if (prep) {
      q.delete('prep');
      q.delete('leave');
      q.delete('plant');
      q.delete('test');
      history.replaceState(null, '', location.pathname + (q.size ? `?${q}` : '') + (leave ? `#/${leave}` : ''));
      if (leave) setAt(leave);
    }
    (fresh ? api.reset() : api.tour())
      .then((t) => (prep ? api.prep(prep, leave, plant).catch(() => t) : t))
      .then(setTour, (e) => setFailed((e as Error).message));
    const on = () => setAt(fromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  // a stop is done when its questions are right and its open points are ruled on; a stop the evidence carries has nothing to do
  const done = useCallback(
    (id: string) => {
      const st = tour?.stops.find((s) => s.id === id);
      if (!tour || !st) return false;
      return st.questions.every((q) => tour.state.answers[q.id]?.right) && (tour.evidence?.rulings ?? []).filter((r) => r.stopId === id).every((r) => tour.state.rulings?.[r.id]);
    },
    [tour],
  );
  // every stop is open once the review has started: a reviewer moves the way the code leads
  const reachable = useCallback((a: At) => !!tour && (a === 'intro' || (!!tour.state.startedAt && (a === 'handin' || tour.stops.some((s) => s.id === a)))), [tour]);

  const go = useCallback((a: At) => {
    setMenu(false);
    setPulse(null);
    if (fromHash() !== a) location.hash = `/${a}`;
    setAt(a);
    main.current?.scrollTo({ top: 0 });
  }, []);

  // an address the reader cannot be at yet falls back to the start
  useEffect(() => {
    if (tour && !reachable(at)) go('intro');
  }, [tour, at, reachable, go]);

  const jump = useCallback(
    (file: string, line: number, to = line) => {
      if (!tour) return;
      const stop = tour.stops.find((s) => s.blocks.some((b) => b.type === 'code' && b.file === file && b.from <= line && line <= b.to));
      if (!stop || !reachable(stop.id)) return;
      setMenu(false);
      if (fromHash() !== stop.id) location.hash = `/${stop.id}`;
      setAt(stop.id);
      setPulse({ file, from: line, to, key: Date.now() });
    },
    [tour, reachable],
  );
  const started = !!tour?.state.startedAt;
  useEffect(() => {
    if (started && at !== 'intro') void api.seen(at);
  }, [at, started]);
  // Only time with a stop on screen counts as reading. Every half minute the page says "still here" while the tab is visible and
  // the reviewer moved in the last 90 seconds; a hidden tab says "away" and says where it is again when it comes back.
  useEffect(() => {
    if (!started || at === 'intro' || at === 'handin') return;
    let moved = Date.now();
    const move = () => void (moved = Date.now());
    const kinds = ['pointermove', 'keydown', 'wheel', 'scroll', 'touchstart'] as const;
    for (const k of kinds) window.addEventListener(k, move, { passive: true, capture: true });
    const beat = setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - moved < 90_000) void api.seen(at, true);
    }, 30_000);
    const vis = () => void (document.visibilityState === 'visible' ? ((moved = Date.now()), api.seen(at)) : api.seen('away', true));
    document.addEventListener('visibilitychange', vis);
    return () => {
      for (const k of kinds) window.removeEventListener(k, move, { capture: true });
      clearInterval(beat);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [at, started]);
  useEffect(() => {
    if (!pulse) return;
    const t = setTimeout(() => document.getElementById(lineId(pulse.file, pulse.from))?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
    return () => clearTimeout(t);
  }, [pulse]);

  const patch = (p: Partial<PublicTour['state']>) => setTour((t) => (t ? { ...t, state: { ...t.state, ...p } } : t));
  const onAnswer = (id: string, a: AnswerState) => setTour((t) => (t ? { ...t, state: { ...t.state, answers: { ...t.state.answers, [id]: a } } } : t));
  const onFlag = useCallback((f: Flag & { on?: boolean }) => {
    // a new flag shows at once, so the box for the reason is there when the reviewer starts typing; the server's answer replaces it
    if (f.on !== false) setTour((t) => (t && !t.state.flags.some((x) => x.file === f.file && x.line === f.line) ? { ...t, state: { ...t.state, flags: [...t.state.flags, { file: f.file, line: f.line, note: f.note ?? '' }] } } : t));
    api.flag(f).then(
      (r) => patch({ flags: r.flags }),
      (e) => {
        const b = bodyOf<{ flags: Flag[] }>(e);
        if (b.flags) patch({ flags: b.flags });
        else api.tour().then(setTour, () => undefined);
        setFlash((e as Error).message);
      },
    );
  }, []);
  const onRule = useCallback(async (id: string, decision: Ruling['decision'], note: string) => {
    try {
      patch({ rulings: (await api.rule(id, decision, note)).rulings });
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, []);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(''), 4000);
    return () => clearTimeout(t);
  }, [flash]);
  const unflag = (f: Flag) => onFlag({ ...f, on: false });
  const onAsk = useCallback((file: string, line: number) => {
    setAskLine({ file, line });
    setAskOpen(true);
    setAskFocus((n) => n + 1);
  }, []);

  const order = useMemo<At[]>(() => (tour ? ['intro', ...tour.stops.map((s) => s.id), 'handin'] : ['intro']), [tour]);
  const idx = order.indexOf(at);
  const next = order[idx + 1];
  const prev = order[idx - 1];

  const start = async () => {
    if (!tour) return;
    if (!tour.state.startedAt) patch(await api.start());
    const first = tour.stops.find((s) => s.required && !done(s.id));
    go(first ? first.id : 'handin');
  };

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e)) return;
      if (e.key === 'a') {
        e.preventDefault();
        setAskOpen((v) => !v);
        setAskFocus((n) => n + 1);
      } else if (tour?.cold) return;
      else if ((e.key === 'j' || e.key === 'ArrowRight') && next && reachable(next) && at !== 'intro') go(next);
      else if ((e.key === 'k' || e.key === 'ArrowLeft') && prev) go(prev);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  if (failed) return <LoadFailed message={failed} />;
  if (!tour) return <Loading />;

  const { state } = tour;
  if (tour.cold) return <Cold tour={tour} setTour={setTour} />;
  if (state.cold?.reveal && !state.startedAt) return <ColdOutcome tour={tour} result={state.cold} onStart={start} />;
  const stop = tour.stops.find((s) => s.id === at) ?? null;
  const stopIndex = stop ? tour.stops.indexOf(stop) : -1;
  const points = (id: string) => (tour.evidence?.rulings ?? []).filter((r) => r.stopId === id);
  const sidebar = <Sidebar tour={tour} at={at} done={done} go={go} jump={jump} unflag={unflag} />;

  return (
    <div className="flex h-full">
      <div className="hidden w-[264px] flex-none border-r border-line lg:block">{sidebar}</div>
      {menu && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="fade absolute inset-0 bg-black/60" onClick={() => setMenu(false)} />
          <div className="absolute inset-y-0 left-0 w-[284px] border-r border-line shadow-2xl">{sidebar}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 flex-none items-center gap-2 border-b border-line px-3 sm:px-4">
          <button className="btn btn-ghost size-8! p-0! lg:hidden" onClick={() => setMenu(true)} title="Stops">
            <Menu size={15} />
          </button>
          <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-fg3">
            <span className="hidden truncate sm:inline">{tour.pr.repo.split('/')[1]}</span>
            <span className="hidden text-fg4 sm:inline">›</span>
            <span className="hidden truncate md:inline">Pull request #{tour.pr.number}</span>
            <span className="hidden text-fg4 md:inline">›</span>
            <span className="truncate font-[510] text-fg">{stop ? `Stop ${stopIndex + 1} of ${tour.stops.length}` : at === 'handin' ? (state.signature ? 'Signed' : state.caught ? 'Sign' : 'Hand in') : 'Before you start'}</span>
          </div>
          <div className="ml-auto flex flex-none items-center gap-2">
            {state.read > 1 && !state.signature && <span className="chip border-flag/30! text-flag!">Read {state.read}</span>}
            {state.startedAt && <Clock key={state.startedAt} from={state.startedAt} caught={!!state.caught} took={state.signature?.seconds} />}
            {state.startedAt && !state.caught && (
              <span className={`chip ${state.flags.length > tour.maxFlags ? 'border-bad/40! text-bad!' : ''}`} title="Lines you flagged as wrong">
                <FlagFill size={11} className={state.flags.length ? 'text-flag' : 'text-fg4'} />
                {state.flags.length} of {tour.maxFlags}
              </span>
            )}
            {tour.ask && (
              <button
                className={`btn h-7! px-2.5! ${askOpen ? 'border-accent/50! bg-accent-soft! text-fg!' : ''}`}
                onClick={() => {
                  setAskOpen((v) => !v);
                  setAskFocus((n) => n + 1);
                }}
              >
                <Chat size={13} /> Ask <span className="kbd hidden sm:inline-flex">A</span>
              </button>
            )}
          </div>
        </header>

        <div ref={main} data-main className="min-h-0 flex-1 overflow-y-auto">
          {stop ? (
            <StopView
              key={`${stop.id}:${state.read}`}
              stop={stop}
              index={stopIndex}
              total={tour.stops.length}
              answers={state.answers}
              flags={state.flags}
              locked={!!state.caught}
              canAsk={tour.ask}
              pulse={pulse}
              evidence={tour.evidence}
              entire={tour.entire}
              issue={tour.pr.issue?.number}
              points={points(stop.id)}
              rulings={state.rulings ?? NONE}
              lockSeconds={tour.rule.lockSeconds}
              onAnswer={onAnswer}
              onFlag={onFlag}
              onRule={onRule}
              onAsk={onAsk}
              onReread={(r) => jump(r.file, r.from, r.to)}
              onPrev={() => prev && go(prev)}
              onNext={() => next && go(next)}
              last={next === 'handin'}
            />
          ) : at === 'handin' ? (
            <HandIn
              tour={tour}
              missedNow={missedNow}
              setTour={setTour}
              setMissedNow={setMissedNow}
              jump={jump}
              unflag={unflag}
              onFlag={onFlag}
              readAgain={() => go(tour.stops[0]!.id)}
              go={go}
              reset={async () => {
                setTour(await api.reset());
                setMsgs([]);
                setMissedNow(null);
                go('intro');
              }}
            />
          ) : (
            <Intro tour={tour} onStart={start} />
          )}
        </div>
      </div>

      {flash && <div className="fade fixed bottom-5 left-1/2 z-[60] max-w-[92vw] -translate-x-1/2 rounded-lg border border-bad/40 bg-raised px-3.5 py-2 text-[13px] text-fg shadow-2xl">{flash}</div>}
      {tour.ask && askOpen && (
        <>
          <div className="fade fixed inset-0 z-40 bg-black/60 xl:hidden" onClick={() => setAskOpen(false)} />
          <div className="fixed inset-y-0 right-0 z-50 w-[min(400px,92vw)] border-l border-line shadow-2xl xl:static xl:z-auto xl:w-[360px] xl:flex-none xl:shadow-none">
            <Ask stop={stop} line={askLine} clearLine={() => setAskLine(null)} msgs={msgs} setMsgs={setMsgs} onJump={jump} onClose={() => setAskOpen(false)} focusKey={askFocus} />
          </div>
        </>
      )}
    </div>
  );
}
