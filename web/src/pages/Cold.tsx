import { useEffect, useState } from 'react';
import type { CodeBlock, ColdResult, PublicTour } from '../../../shared/tour';
import { api, type ColdStats } from '../api';
import { Tokens } from '../ui/Code';
import { ArrowRight, Bot, Check, Eye, FlagFill, Logo, X } from '../ui/icons';
import { RevealCard } from '../ui/Reveal';
import { Title } from '../ui/Title';

const Bar = ({ tour }: { tour: PublicTour }) => (
  <header className="flex h-12 flex-none items-center gap-2.5 border-b border-line px-4">
    <Logo size={20} />
    <span className="text-[14px] font-[590] tracking-[-0.01em]">Readback</span>
    <span className="ml-auto truncate text-[12.5px] text-fg4">
      {tour.pr.repo} #{tour.pr.number}
    </span>
  </header>
);

/**
 * The cold test: a plain diff, the way a pull request usually reaches a reviewer.
 * Two things to do: approve, or ask for a change on a line. Nothing here says a line was changed.
 */
export function Cold({ tour, setTour }: { tour: PublicTour; setTour: (t: PublicTour) => void }) {
  const blocks = tour.cold!.blocks.filter((b): b is CodeBlock => b.type === 'code');
  const [pick, setPick] = useState<{ file: string; line: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const { pr } = tour;

  const send = async (b: Parameters<typeof api.cold>[0]) => {
    setBusy(true);
    setErr('');
    try {
      setTour(await api.cold(b));
      window.scrollTo(0, 0);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <Bar tour={tour} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="rise mx-auto max-w-[900px] px-4 pt-8 pb-10 sm:px-6 sm:pt-12">
          <div className="flex flex-wrap items-center gap-2">
            {pr.authorIsAgent && (
              <span className="chip border-transparent! bg-accent-soft! text-accent-hi!">
                <Bot size={12} /> Written by an AI agent
              </span>
            )}
            <span className="chip">
              <span className="text-ok">+{pr.additions}</span>
              <span className="text-bad">−{pr.deletions}</span>
              <span>{pr.files} files</span>
            </span>
          </div>
          <h1 className="mt-4 text-[26px] leading-[1.15] font-[590] tracking-[-0.022em] text-fg sm:text-[34px]">An AI agent wrote this pull request. You are the reviewer.</h1>
          <p className="mt-3 text-[15px] leading-[1.6] text-fg2">
            “{pr.title}”. This is one part of it. Approve it, or click the line you want changed.
          </p>

          {blocks.map((b) => {
            const slash = b.file.lastIndexOf('/') + 1;
            return (
              <div key={`${b.file}:${b.from}`} className="card mt-6 overflow-hidden">
                <div className="flex items-center gap-3 border-b border-line px-4 py-2">
                  <span className="min-w-0 truncate font-mono text-[12px]">
                    <span className="text-fg4">{b.file.slice(0, slash)}</span>
                    <span className="text-fg2">{b.file.slice(slash)}</span>
                  </span>
                  <span className="ml-auto flex gap-2 text-[11.5px] whitespace-nowrap">
                    <span className="text-ok">+{b.lines.filter((l) => l.kind === 'add').length}</span>
                    <span className="text-bad">−{b.lines.filter((l) => l.kind === 'del').length}</span>
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <div className="code w-max min-w-full py-2">
                    {b.lines.map((l, i) => {
                      const on = l.n !== null && pick?.file === b.file && pick.line === l.n;
                      return (
                        <div key={i} className={`row ${l.kind === 'add' ? 'add' : l.kind === 'del' ? 'del' : ''} ${l.n !== null ? 'pick' : ''} ${on ? 'sel' : ''}`} onClick={() => l.n !== null && !window.getSelection()?.toString() && setPick(on ? null : { file: b.file, line: l.n })}>
                          <span className="num">{l.n ?? '−'}</span>
                          <span className="src">
                            <Tokens tokens={l.tokens} />
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex-none border-t border-line bg-panel pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-[900px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap sm:px-6">
          <p className={`min-w-0 text-[13px] text-fg3 ${err ? 'basis-full sm:flex-1 sm:basis-auto' : 'hidden sm:block sm:flex-1'}`}>
            {err ? (
              <span className="text-bad">{err}</span>
            ) : pick ? (
              <>
                <span className="font-mono text-[12px] text-fg2">
                  {pick.file.split('/').pop()}:{pick.line}
                </span>{' '}
                selected
              </>
            ) : null}
          </p>
          <button className="btn btn-lg min-w-0 flex-1 sm:flex-none" disabled={!pick || busy} onClick={() => pick && send({ action: 'flag', ...pick })}>
            <FlagFill size={13} className={`flex-none ${pick ? 'text-flag' : ''}`} />
            <span className="truncate">{pick ? `Request a change on line ${pick.line}` : 'Request a change'}</span>
          </button>
          <button className="btn btn-ok btn-lg flex-none" disabled={busy} onClick={() => send({ action: 'approve' })}>
            <Check size={14} strokeWidth={2} /> Approve
          </button>
        </div>
      </div>
    </div>
  );
}

/** What the cold test showed, and the way into the guided read. */
export function ColdOutcome({ tour, result, onStart }: { tour: PublicTour; result: ColdResult; onStart: () => void }) {
  const r = result.reveal!;
  const [stats, setStats] = useState<ColdStats | null>(null);
  useEffect(() => {
    api.stats().then((s) => setStats(s.cold ?? null), () => {});
  }, []);
  const questions = tour.stops.reduce((a, s) => a + s.questions.length, 0);
  const lines = tour.stops.reduce((a, s) => a + s.blocks.reduce((b, x) => b + (x.type === 'code' ? x.to - x.from + 1 : 0), 0), 0);
  const minutes = Math.max(3, Math.round(lines / 45 + questions * 0.5));
  const decided = stats ? stats.approved + stats.flaggedPlanted + stats.flaggedOther : 0;
  const good = result.caught;
  const headline = good ? 'You caught it, with nothing to help you.' : result.action === 'approve' ? (r.headline ?? 'You approved a bug.') : `You asked for a change on line ${result.flagged!.line}. The bug is on line ${r.line}.`;

  return (
    <div className="flex h-full flex-col">
      <Bar tour={tour} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="rise mx-auto max-w-[720px] px-4 pt-10 pb-24 sm:px-6 sm:pt-14">
          {good ? (
            <span className="chip border-ok/30! bg-ok-soft! text-ok!">
              <Check size={12} /> Caught
            </span>
          ) : (
            <span className="chip border-bad/30! bg-bad-soft! text-bad!">
              <X size={12} /> Not approved
            </span>
          )}
          <Title text={headline}>{headline}</Title>
          <p className="mt-4 mb-6 text-[15.5px] leading-[1.6] text-fg2">
            {good
              ? 'Readback changed this one line before you saw it. The agent never wrote it. It is a real bug: the project’s own tests fail with it.'
              : result.action === 'approve'
                ? 'Readback changed one line before you saw it. The agent never wrote it. It is a real bug: the project’s own tests fail with it. In a real review this approval would have merged it.'
                : `${r.headline ? `${r.headline} ` : ''}Readback changed one line before you saw it, and it is still there after your review. The project’s own tests fail with it.`}
          </p>
          <RevealCard r={r} shownAs={good ? 'What you were shown, and sent back' : 'What you were shown'} />
          {stats && decided >= 3 && (
            <p className="mt-4 text-[13px] leading-[1.6] text-fg3">
              So far {decided} people have reviewed a plain diff here: {stats.approved} approved the bug, {stats.flaggedOther} asked for a change on another line, {stats.flaggedPlanted} caught it.
            </p>
          )}

          <h2 className="mt-12 text-[20px] leading-[1.25] font-[590] tracking-[-0.015em] text-fg">Now review it with Readback</h2>
          <p className="mt-2 text-[15px] leading-[1.6] text-fg2">The same change, taken apart for you. Your review only counts if you can show you understood it.</p>
          <div className="card mt-5 divide-y divide-line">
            {[
              { mark: <Eye size={13} className="text-warn" />, title: `${tour.stops.length} stops, in any order`, body: 'Each one explains a part of the change and marks the lines to read closely.' },
              { mark: <Check size={13} className="text-ok" />, title: `${questions} questions`, body: 'Each can only be answered from the code.' },
              { mark: <FlagFill size={13} className="text-flag" />, title: 'One more planted bug', body: 'A different line is changed now. Click it and flag it, or the review does not count.' },
            ].map((x) => (
              <div key={x.title} className="flex gap-3.5 px-4 py-3">
                <span className="mt-px flex size-6 flex-none items-center justify-center rounded-md bg-active">{x.mark}</span>
                <div>
                  <p className="text-[13.5px] font-[590] text-fg">{x.title}</p>
                  <p className="mt-0.5 text-[13px] leading-[1.5] text-fg3">{x.body}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button className="btn btn-primary btn-lg" onClick={onStart}>
              Review it with Readback <ArrowRight size={15} />
            </button>
            <span className="text-[13px] text-fg3">About {minutes} minutes</span>
          </div>
          {tour.short && tour.other && (
            <p className="mt-4 text-[13px] leading-[1.6] text-fg3">
              This is the short read: {tour.short.stops} of the {tour.short.of} stops.{' '}
              <a className="text-accent-hi underline-offset-2 hover:underline" href={tour.other.href}>
                The full read
              </a>{' '}
              is the one that approves the change.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
