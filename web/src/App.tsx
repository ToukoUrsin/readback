import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AnswerState, Flag, PublicTour, Reveal } from '../../shared/tour';
import { api } from './api';
import { Cold, ColdOutcome } from './pages/Cold';
import { HandIn } from './pages/HandIn';
import { Intro } from './pages/Intro';
import { StopView } from './pages/StopView';
import { Ask, type Msg } from './ui/Ask';
import { lineId } from './ui/Code';
import { Chat, FlagFill, Menu } from './ui/icons';
import { Sidebar, type At } from './ui/Sidebar';

const fromHash = (): At => decodeURIComponent(location.hash.replace(/^#\/?/, '')) || 'intro';
const typing = (e: KeyboardEvent) => /^(INPUT|TEXTAREA)$/.test((e.target as HTMLElement).tagName);

function Clock({ from, until }: { from: string; until?: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (until) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [until]);
  const s = Math.max(0, Math.round(((until ? Date.parse(until) : Date.now()) - Date.parse(from)) / 1000));
  return (
    <span className="chip hidden sm:inline-flex" title="Time since you started reading">
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
  const main = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // "?new=1" starts over as a new reader: one link puts the page back to its first screen
    const q = new URLSearchParams(location.search);
    const fresh = q.get('new') === '1';
    if (fresh) {
      q.delete('new');
      history.replaceState(null, '', location.pathname + (q.size ? `?${q}` : ''));
    }
    (fresh ? api.reset() : api.tour()).then(setTour, (e) => setFailed((e as Error).message));
    const on = () => setAt(fromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const done = useCallback((id: string) => !!tour && (tour.stops.find((s) => s.id === id)?.questions.every((q) => tour.state.answers[q.id]?.right) ?? false), [tour]);
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
  useEffect(() => {
    if (!pulse) return;
    const t = setTimeout(() => document.getElementById(lineId(pulse.file, pulse.from))?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
    return () => clearTimeout(t);
  }, [pulse]);

  const patch = (p: Partial<PublicTour['state']>) => setTour((t) => (t ? { ...t, state: { ...t.state, ...p } } : t));
  const onAnswer = (id: string, a: AnswerState) => setTour((t) => (t ? { ...t, state: { ...t.state, answers: { ...t.state.answers, [id]: a } } } : t));
  const onFlag = useCallback((f: Flag & { on?: boolean }) => {
    api.flag(f).then((r) => patch({ flags: r.flags }), () => {});
  }, []);
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
    const first = tour.stops.find((s) => !s.questions.every((q) => tour.state.answers[q.id]?.right));
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

  if (failed) return <div className="flex h-full items-center justify-center text-fg3">Readback could not load the tour: {failed}</div>;
  if (!tour) return <div className="h-full bg-bg" />;

  const { state } = tour;
  if (tour.cold) return <Cold tour={tour} setTour={setTour} />;
  if (state.cold?.reveal && !state.startedAt) return <ColdOutcome tour={tour} result={state.cold} onStart={start} />;
  const stop = tour.stops.find((s) => s.id === at) ?? null;
  const stopIndex = stop ? tour.stops.indexOf(stop) : -1;
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
            <span className="truncate font-[510] text-fg">{stop ? `Stop ${stopIndex + 1} of ${tour.stops.length}` : at === 'handin' ? (state.signature ? 'Signed' : 'Hand in') : 'Before you start'}</span>
          </div>
          <div className="ml-auto flex flex-none items-center gap-2">
            {state.read > 1 && !state.signature && <span className="chip border-flag/30! text-flag!">Read {state.read}</span>}
            {state.startedAt && <Clock from={state.startedAt} until={state.signature?.at} />}
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

        <div ref={main} className="min-h-0 flex-1 overflow-y-auto">
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
              onAnswer={onAnswer}
              onFlag={onFlag}
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
