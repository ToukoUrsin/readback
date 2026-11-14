import type { PublicTour } from '../../../shared/tour';
import { ArrowRight, Bot, Check, FlagFill } from '../ui/icons';
import { inline } from '../ui/Prose';

export function Intro({ tour, onStart }: { tour: PublicTour; onStart: () => void }) {
  const { pr, coverage, state } = tour;
  const questions = tour.stops.reduce((a, s) => a + s.questions.length, 0);
  const src = coverage.files.filter((f) => !/(^|\/)(test|tests|__tests__)\//.test(f.file) && !/\.(md|css|ya?ml)$/.test(f.file));
  const srcChanged = src.reduce((a, f) => a + f.changed, 0);
  const srcOnTour = src.reduce((a, f) => a + f.onTour, 0);
  const lines = tour.stops.reduce((a, s) => a + s.blocks.reduce((b, x) => b + (x.type === 'code' ? x.to - x.from + 1 : 0), 0), 0);
  const minutes = Math.max(3, Math.round(lines / 45 + questions * 0.5));

  const rules = [
    { mark: <span className="text-[12px] font-[590] text-fg2">{tour.stops.length}</span>, title: `Read ${tour.stops.length} stops, in order`, body: 'Each stop shows one part of the change: what it does, why it is built that way, and the code itself.' },
    { mark: <Check size={13} className="text-ok" />, title: `Answer ${questions} questions`, body: 'Each one can only be answered from the code of its stop. A stop opens when the one before it is answered.' },
    { mark: <FlagFill size={13} className="text-flag" />, title: 'Catch the planted bug', body: 'One line you will read was changed on purpose. It is a real bug: the project’s own tests fail with it. Flag it, or the read does not count and you read again with a different one.' },
    { mark: <Bot size={13} className="text-accent-hi" />, title: 'Ask the guide', body: 'It explains any line. It will not tell you what is wrong.' },
  ];

  return (
    <div className="rise mx-auto max-w-[720px] px-6 pt-14 pb-24 sm:pt-20">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-fg3">
        <span className="chip">
          {pr.repo} #{pr.number}
        </span>
        {pr.authorIsAgent && <span className="chip border-transparent! bg-accent-soft! text-accent-hi!">Written by an AI agent</span>}
        <span className="chip">
          <span className="text-ok">+{pr.additions}</span>
          <span className="text-bad">−{pr.deletions}</span>
          <span>{pr.files} files</span>
        </span>
      </div>
      <h1 className="mt-5 text-[32px] leading-[1.12] font-[590] tracking-[-0.022em] text-fg sm:text-[40px]">{pr.title}</h1>
      <p className="mt-5 text-[16px] leading-[1.6] text-fg2">{inline(tour.intro)}</p>

      <p className="mt-10 text-[15px] leading-[1.6] text-fg">Nobody has read this code yet. Before it can merge, you read it, and you show that you did.</p>

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
          {state.startedAt ? 'Continue reading' : 'Start reading'} <ArrowRight size={15} />
        </button>
        <span className="text-[13px] text-fg3">
          About {minutes} minutes · {lines} lines of code
        </span>
      </div>

      <p className="mt-10 border-t border-line pt-5 text-[12.5px] leading-[1.6] text-fg4">
        The tour passes {srcOnTour} of the {srcChanged} source lines this change added or changed{coverage.changed > srcChanged ? `, and ${coverage.onTour - srcOnTour} of the ${coverage.changed - srcChanged} lines of tests, styles and docs` : ''}. Tour written by {tour.madeBy.model}
        {tour.madeBy.plantModel ? `, bugs planted by ${tour.madeBy.plantModel}` : ''}.
      </p>
    </div>
  );
}
