import type { AnswerState, Flag, PublicStop } from '../../../shared/tour';
import { Code } from '../ui/Code';
import { Diagram } from '../ui/Diagram';
import { ArrowLeft, ArrowRight } from '../ui/icons';
import { inline } from '../ui/Prose';
import { Quiz } from '../ui/Quiz';

interface Props {
  stop: PublicStop;
  index: number;
  total: number;
  answers: Record<string, AnswerState>;
  flags: Flag[];
  locked: boolean;
  canAsk: boolean;
  pulse: { file: string; from: number; to: number; key: number } | null;
  onAnswer: (id: string, a: AnswerState) => void;
  onFlag: (f: Flag & { on?: boolean }) => void;
  onAsk: (file: string, line: number) => void;
  onReread: (r: { file: string; from: number; to: number }) => void;
  onPrev: () => void;
  onNext: () => void;
  last: boolean;
}

export function StopView({ stop, index, total, answers, flags, locked, canAsk, pulse, onAnswer, onFlag, onAsk, onReread, onPrev, onNext, last }: Props) {
  const done = stop.questions.every((q) => answers[q.id]?.right);
  const files = [...new Set(stop.blocks.flatMap((b) => (b.type === 'code' ? [b.file] : [])))];
  return (
    <article key={stop.id} className="rise mx-auto max-w-[860px] px-6 pt-10 pb-28">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-fg3">
        <span className="font-[510] text-accent-hi">
          Stop {index + 1} of {total}
        </span>
        {files.map((f) => (
          <span key={f} className="font-mono text-[11.5px] text-fg4">
            {f}
          </span>
        ))}
      </div>
      <h1 className="mt-3 text-[28px] leading-[1.18] font-[590] tracking-[-0.02em] text-fg">{stop.title}</h1>
      <p className="mt-3 text-[16px] leading-[1.6] text-fg2">{inline(stop.why)}</p>

      <div className="mt-7">
        {stop.blocks.map((b, i) =>
          b.type === 'prose' ? (
            <p key={i} className="my-4 text-[15px] leading-[1.65] text-fg2">
              {inline(b.text)}
            </p>
          ) : b.type === 'diagram' ? (
            <Diagram key={i} d={b} />
          ) : (
            <Code key={i} block={b} flags={flags} pulse={pulse} locked={locked} canAsk={canAsk} onFlag={onFlag} onAsk={onAsk} />
          ),
        )}
      </div>

      {stop.questions.length > 0 && <Quiz questions={stop.questions} answers={answers} onAnswer={onAnswer} onReread={onReread} />}

      <div className="mt-10 flex items-center gap-3 border-t border-line pt-5">
        <button className="btn btn-ghost" onClick={onPrev}>
          <ArrowLeft size={14} /> Back
        </button>
        <span className="ml-auto flex items-center gap-1.5 text-[12.5px] text-fg4">
          {done ? (
            <span className="hidden items-center gap-1.5 sm:flex">
              <span className="kbd">←</span>
              <span className="kbd">→</span> move between stops
            </span>
          ) : (
            'Answer the questions to go on'
          )}
        </span>
        <button className="btn btn-primary" disabled={!done} onClick={onNext}>
          {last ? 'Hand in the read' : 'Next stop'} <ArrowRight size={14} />
        </button>
      </div>
    </article>
  );
}
