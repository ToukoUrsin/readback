import type { ReactNode } from 'react';
import type { Flag, PublicTour } from '../../../shared/tour';
import { FlagFill, Logo, Pull, StatusDone, StatusLocked, StatusNow, StatusTodo, X } from './icons';

export type At = 'intro' | 'handin' | (string & {});

interface Props {
  tour: PublicTour;
  at: At;
  done: (stopId: string) => boolean;
  reachable: (at: At) => boolean;
  go: (at: At) => void;
  jump: (file: string, line: number) => void;
  unflag: (f: Flag) => void;
}

export function Sidebar({ tour, at, done, reachable, go, jump, unflag }: Props) {
  const { state } = tour;
  const all = tour.stops.flatMap((s) => s.questions);
  const right = all.filter((q) => state.answers[q.id]?.right).length;
  const signed = !!state.signature;

  const item = (key: At, label: string, mark: ReactNode, n?: number) => {
    const open = reachable(key);
    return (
      <button
        key={key}
        disabled={!open}
        onClick={() => go(key)}
        title={open ? label : 'Answer the questions of the stops before this one first'}
        className={`group flex w-full items-start gap-2.5 rounded-md px-2 py-[6px] text-left text-[13px] leading-[1.35] transition-colors ${at === key ? 'bg-active text-fg' : open ? 'text-fg2 hover:bg-hover hover:text-fg' : 'text-fg4'}`}
      >
        <span className="mt-[2px] flex-none">{mark}</span>
        <span className="line-clamp-2 min-w-0 flex-1">{label}</span>
        {n !== undefined && <span className="mt-px flex-none text-[11px] text-fg4">{n}</span>}
      </button>
    );
  };

  return (
    <nav className="flex h-full w-full flex-col bg-panel">
      <div className="flex h-12 flex-none items-center gap-2.5 px-4">
        <Logo size={20} />
        <span className="text-[14px] font-[590] tracking-[-0.01em]">Readback</span>
      </div>

      <div className="mx-2 mb-3 rounded-lg border border-line bg-raised px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-[11.5px] text-fg3">
          <Pull size={12} />
          <span className="truncate">
            {tour.pr.repo.split('/')[1]} #{tour.pr.number}
          </span>
          {tour.pr.authorIsAgent && <span className="ml-auto rounded bg-accent-soft px-1.5 py-px text-[10.5px] font-[590] text-accent-hi">AI-written</span>}
        </div>
        <p className="mt-1 line-clamp-2 text-[12.5px] leading-[1.4] font-[510] text-fg">{tour.pr.title}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <p className="px-2 pt-1 pb-1.5 text-[11.5px] font-[510] text-fg4">Tour</p>
        {item('intro', 'Before you start', state.startedAt ? <StatusDone /> : <StatusNow />)}
        {tour.stops.map((s, i) => item(s.id, s.title, done(s.id) ? <StatusDone /> : at === s.id ? <StatusNow /> : reachable(s.id) ? <StatusTodo /> : <StatusLocked />, i + 1))}
        {item('handin', signed ? 'Signed' : state.caught ? 'Sign' : 'Hand in', signed ? <StatusDone /> : at === 'handin' ? <StatusNow /> : reachable('handin') ? <StatusTodo /> : <StatusLocked />)}

        <p className="flex items-center gap-2 px-2 pt-5 pb-1.5 text-[11.5px] font-[510] text-fg4">
          Flagged lines
          <span className={state.flags.length > tour.maxFlags ? 'text-bad' : ''}>
            {state.flags.length} of {tour.maxFlags}
          </span>
        </p>
        {state.flags.length === 0 ? (
          <p className="px-2 text-[12px] leading-[1.45] text-fg4">One line you will read was changed on purpose. Flag it when you see it.</p>
        ) : (
          state.flags.map((f) => (
            <div key={`${f.file}:${f.line}`} className="group flex items-center gap-2 rounded-md px-2 py-[5px] hover:bg-hover">
              <FlagFill size={12} className="flex-none text-flag" />
              <button className="min-w-0 flex-1 truncate text-left font-mono text-[12px] text-fg2 hover:text-fg" onClick={() => jump(f.file, f.line)} title={f.note || 'Go to this line'}>
                {f.file.split('/').pop()}:{f.line}
              </button>
              {!state.caught && (
                <button className="flex-none text-fg4 opacity-0 group-hover:opacity-100 hover:text-fg" onClick={() => unflag(f)} title="Remove the flag">
                  <X size={12} />
                </button>
              )}
            </div>
          ))
        )}
      </div>

      <div className="flex-none border-t border-line px-4 py-3">
        <div className="flex items-center justify-between text-[12px] text-fg3">
          <span>Questions</span>
          <span>
            {right} of {all.length}
          </span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-active">
          <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out-quint" style={{ width: `${all.length ? (right / all.length) * 100 : 0}%` }} />
        </div>
        {state.read > 1 && <p className="mt-2.5 text-[12px] text-flag">Read {state.read}: a planted bug was missed before.</p>}
      </div>
    </nav>
  );
}
