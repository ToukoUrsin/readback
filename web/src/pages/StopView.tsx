import type { AnswerState, CodeBlock, Flag, PublicStop } from '../../../shared/tour';
import { Code } from '../ui/Code';
import { Diagram } from '../ui/Diagram';
import { ArrowLeft, ArrowRight, Eye, FlagFill } from '../ui/icons';
import { inline } from '../ui/Prose';
import { Quiz } from '../ui/Quiz';

interface Props {
  stop: PublicStop;
  /** where the stop sits; the header shows it */
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

export function StopView({ stop, answers, flags, locked, canAsk, pulse, onAnswer, onFlag, onAsk, onReread, onPrev, onNext, last }: Props) {
  const open = stop.questions.filter((q) => !answers[q.id]?.right).length;
  const code = stop.blocks.filter((b): b is CodeBlock => b.type === 'code');
  const files = [...new Set(code.map((b) => b.file))];
  const focus = code.flatMap((b) => (b.focus ?? []).map((f) => ({ ...f, file: b.file })));
  const here = flags.filter((f) => code.some((b) => b.file === f.file && b.from <= f.line && f.line <= b.to)).length;
  return (
    <article key={stop.id} className="rise mx-auto max-w-[920px] px-4 pt-6 pb-28 sm:px-8 sm:pt-12">
      <h1 className="text-[22px] leading-[1.2] font-[590] tracking-[-0.02em] text-fg sm:text-[28px]">{stop.title}</h1>
      <p className="mt-2 max-w-[68ch] text-[14.5px] leading-[1.55] text-fg2 sm:mt-3 sm:text-[15.5px] sm:leading-[1.6]">{inline(stop.why)}</p>

      {focus.length > 0 && (
        <div className="-mx-4 mt-4 flex items-center gap-x-2 gap-y-1.5 overflow-x-auto px-4 text-[12.5px] [scrollbar-width:none] sm:mx-0 sm:mt-5 sm:flex-wrap sm:overflow-visible sm:px-0">
          <span className="flex flex-none items-center gap-1.5 font-[590] text-warn">
            <Eye size={13} /> Read closely
          </span>
          {focus.map((f) => (
            <button key={`${f.file}:${f.from}`} className="flex-none rounded-md border border-line-strong px-2 py-[3px] font-mono text-[11.5px] text-fg3 transition-colors hover:border-warn/45 hover:text-fg" title={f.why} onClick={() => onReread(f)}>
              {files.length > 1 ? `${f.file.split('/').pop()}:` : f.to > f.from ? 'lines ' : 'line '}
              {f.from}
              {f.to > f.from ? `–${f.to}` : ''}
            </button>
          ))}
        </div>
      )}

      <div className="mt-5 sm:mt-6">
        {stop.blocks.map((b, i) =>
          b.type === 'prose' ? (
            <p key={i} className="my-4 max-w-[68ch] text-[15px] leading-[1.65] text-fg2">
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

      <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <button className="btn btn-ghost" onClick={onPrev}>
          <ArrowLeft size={14} /> Back
        </button>
        <span className="ml-auto flex items-center gap-1.5 text-[12.5px] text-fg4">
          {here > 0 ? (
            <span className="flex items-center gap-1.5 text-flag">
              <FlagFill size={12} /> {here} flagged here
            </span>
          ) : open > 0 ? (
            `${open} ${open === 1 ? 'question' : 'questions'} open here`
          ) : (
            <span className="hidden items-center gap-1.5 sm:flex">
              <span className="kbd">←</span>
              <span className="kbd">→</span> move between stops
            </span>
          )}
        </span>
        <button className={`btn ${open ? '' : 'btn-primary'}`} onClick={onNext}>
          {last ? 'Hand in' : open ? 'Next stop' : here ? 'Flagged, next stop' : 'Looks right, next stop'} <ArrowRight size={14} />
        </button>
      </div>
    </article>
  );
}
