import type { PublicTour } from '../../../shared/tour';
import { ArrowRight, Bot, Check, Eye, FlagFill, Pull } from '../ui/icons';
import { inline } from '../ui/Prose';

export function Intro({ tour, onStart }: { tour: PublicTour; onStart: () => void }) {
  const { pr, coverage, state, short, other } = tour;
  const questions = tour.stops.reduce((a, s) => a + s.questions.length, 0);
  const src = coverage.files.filter((f) => !/(^|\/)(test|tests|__tests__)\//.test(f.file) && !/\.(md|css|ya?ml)$/.test(f.file));
  const srcChanged = src.reduce((a, f) => a + f.changed, 0);
  const srcOnTour = src.reduce((a, f) => a + f.onTour, 0);
  const lines = tour.stops.reduce((a, s) => a + s.blocks.reduce((b, x) => b + (x.type === 'code' ? x.to - x.from + 1 : 0), 0), 0);
  const minutes = Math.max(3, Math.round(lines / 45 + questions * 0.5));

  const focus = tour.stops.reduce((a, s) => a + s.blocks.reduce((b, x) => b + (x.type === 'code' ? (x.focus?.length ?? 0) : 0), 0), 0);
  const rules = [
    { mark: <span className="text-[12px] font-[590] text-fg2">{tour.stops.length}</span>, title: short ? `Review ${short.stops} of the ${short.of} stops, in any order` : `Review ${tour.stops.length} stops, in any order`, body: 'Each stop shows one part of the change: what it does, why it is built that way, and the code itself. Move between them as you like.' },
    ...(focus ? [{ mark: <Eye size={13} className="text-warn" />, title: `${focus} places marked “Read closely”`, body: 'The guide marked the lines where a mistake would cost the most, and says why. The rest still has to be read: the marks were made without knowing which line is planted.' }] : []),
    { mark: <Check size={13} className="text-ok" />, title: `Answer ${questions} questions`, body: 'Each one can only be answered from the code of its stop. All of them have to be right before you hand in.' },
    { mark: <FlagFill size={13} className="text-flag" />, title: 'Catch the planted bug', body: 'One line was changed on purpose. It is a real bug: the project’s own tests fail with it. Click it and flag it, or the review does not count and you review again with a different one.' },
    { mark: <Bot size={13} className="text-accent-hi" />, title: 'Ask the guide', body: 'Click any line to ask about it. The guide explains; it will not tell you what is wrong.' },
  ];

  return (
    <div className="rise mx-auto max-w-[720px] px-4 pt-10 pb-24 sm:px-6 sm:pt-16">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-fg3">
        <span className="inline-flex items-center gap-1.5">
          <Pull size={13} className="text-fg4" />
          {pr.repo} #{pr.number}
        </span>
        {pr.authorIsAgent && (
          <>
            <span className="text-fg4">·</span>
            <span className="inline-flex items-center gap-1.5 text-accent-hi">
              <Bot size={13} /> Written by an AI agent
            </span>
          </>
        )}
        <span className="text-fg4">·</span>
        <span className="tabular-nums">
          <span className="text-ok">+{pr.additions}</span> <span className="text-bad">−{pr.deletions}</span> <span className="text-fg4">in</span> {pr.files} files
        </span>
        {short && <span className="ml-1 rounded bg-flag/15 px-1.5 py-px text-[11.5px] font-[590] text-flag">Short read</span>}
      </div>
      <h1 className="mt-4 text-[28px] leading-[1.12] font-[590] tracking-[-0.024em] text-fg sm:text-[36px]">{pr.title}</h1>
      <p className="mt-5 text-[16px] leading-[1.6] text-fg2">{inline(tour.intro)}</p>

      <p className="mt-10 text-[15px] leading-[1.6] text-fg">
        {short ? (
          <>
            This is the short read: {short.stops} of the {short.of} stops. It works like the full read, but it does not approve the change.{' '}
            {other && (
              <a className="text-accent-hi underline-offset-2 hover:underline" href={other.href}>
                The full read does
              </a>
            )}
          </>
        ) : (
          'This is the read that approves. Nobody has read this code yet: before it can merge, you review all of it, and you show that you did.'
        )}
      </p>

      <div className="card mt-5 divide-y divide-line">
        {rules.map((r) => (
          <div key={r.title} className="flex gap-3.5 px-4 py-3.5">
            <span className="mt-px flex size-6 flex-none items-center justify-center rounded-md bg-active">{r.mark}</span>
            <div>
              <p className="text-[13.5px] font-[590] text-fg">{r.title}</p>
              <p className="mt-0.5 text-[13px] leading-[1.5] text-fg3">{r.body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <button className="btn btn-primary btn-lg" onClick={onStart} autoFocus>
          {state.startedAt ? 'Continue the review' : 'Start the review'} <ArrowRight size={15} />
        </button>
        <span className="text-[13px] text-fg3">
          About {minutes} minutes · {lines} lines of code
        </span>
      </div>
      {!short && other?.kind === 'short' && (
        <p className="mt-4 text-[13px] text-fg3">
          Only a few minutes?{' '}
          <a className="text-accent-hi underline-offset-2 hover:underline" href={other.href}>
            Take the short read: {other.stops} stops
          </a>
          . It does not approve the change.
        </p>
      )}

      <p className="mt-10 border-t border-line pt-5 text-[12.5px] leading-[1.6] text-fg4">
        The tour passes {srcOnTour} of the {srcChanged} source lines this change added or changed{coverage.changed > srcChanged ? `, and ${coverage.onTour - srcOnTour} of the ${coverage.changed - srcChanged} lines of tests, styles and docs` : ''}. Tour written by {tour.madeBy.model}
        {tour.madeBy.plantModel ? `, bugs planted by ${tour.madeBy.plantModel}` : ''}.
      </p>
    </div>
  );
}
