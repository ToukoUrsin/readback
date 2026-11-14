import type { AnswerState, CodeBlock, Flag, PublicStop, PublicTour, Ruling, RulingItem } from '../../../shared/tour';
import { Code } from '../ui/Code';
import { Diagram } from '../ui/Diagram';
import { ArrowLeft, ArrowRight, Check, Eye, FlagFill, Warn } from '../ui/icons';
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
  /** the change's evidence, when it has one */
  evidence?: PublicTour['evidence'];
  /** number of the issue the acceptance criteria belong to */
  issue?: number;
  points: RulingItem[];
  rulings: Record<string, Ruling>;
  lockSeconds: number;
  onAnswer: (id: string, a: AnswerState) => void;
  onFlag: (f: Flag & { on?: boolean }) => void;
  onRule: (id: string, decision: Ruling['decision'], note: string) => Promise<string | null>;
  onAsk: (file: string, line: number) => void;
  onReread: (r: { file: string; from: number; to: number }) => void;
  onPrev: () => void;
  onNext: () => void;
  last: boolean;
}

const HARM: Record<string, string> = { access: 'who sees what', money: 'money', data: 'stored data' };

/** What this stop can show for itself: the criteria it serves, the tests that cover it, and how many tried bugs they noticed. */
function Evidence({ stop, evidence, lines, issue }: { stop: PublicStop; evidence: NonNullable<PublicTour['evidence']>; lines: number; issue?: number }) {
  const e = stop.evidence!;
  const unnoticed = e.changes.survived.length;
  const share = e.changes.tried ? e.changes.caught / e.changes.tried : 0;
  return (
    <div className="card mt-5 grid grid-cols-1 divide-y divide-line text-[13px] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      <div className="px-4 py-3">
        <p className="text-[11.5px] font-[510] text-fg4">Asked for by</p>
        {e.criteria.length ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {e.criteria.map((n) => (
              <span key={n} className="cursor-help rounded-md border border-line-strong px-1.5 py-px font-mono text-[11.5px] text-fg2" title={evidence.criteria.find((c) => c.n === n)?.text}>
                #{issue ?? 1}.{n}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-1 font-[510] text-flag">No acceptance criterion</p>
        )}
        <p className="mt-1.5 text-[12px] leading-[1.45] text-fg3">{e.criteria.length ? (e.criteria.length === 1 ? evidence.criteria.find((c) => c.n === e.criteria[0])?.text : 'Acceptance criteria of the issue. Hover a number for its text.') : 'Nothing in the issue asks for this code.'}</p>
      </div>
      <div className="px-4 py-3">
        <p className="text-[11.5px] font-[510] text-fg4">How sure the tests are</p>
        {e.changes.tried ? (
          <>
            <p className="mt-1 font-[590] text-fg">
              Noticed {e.changes.caught} of {e.changes.tried} bugs tried here
            </p>
            <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-warn/70">
              <div className="h-full bg-ok" style={{ width: `${share * 100}%` }} />
            </div>
            <p className="mt-1.5 text-[12px] leading-[1.45] text-fg3">
              {unnoticed ? (
                <>
                  <span className="text-warn">{unnoticed} went unnoticed.</span> Those lines are marked below.
                </>
              ) : (
                'Every tried bug made a test fail.'
              )}{' '}
              {e.tests.length} {e.tests.length === 1 ? 'test covers' : 'tests cover'} this code.
            </p>
          </>
        ) : (
          <p className="mt-1 text-fg3">No bug was tried here.</p>
        )}
      </div>
      <div className="px-4 py-3">
        <p className="text-[11.5px] font-[510] text-fg4">Left for you</p>
        {stop.required ? (
          <>
            <p className="mt-1 flex items-center gap-1.5 font-[590] text-fg">
              <Eye size={13} className="text-warn" /> Read {stop.closely} of {lines} lines closely
            </p>
            <p className="mt-1.5 text-[12px] leading-[1.45] text-fg3">{e.risk.length ? <>Can harm {e.risk.map((r) => HARM[r] ?? r).join(' and ')} (a model's reading). </> : null}The rest is shown as context.</p>
          </>
        ) : (
          <>
            <p className="mt-1 flex items-center gap-1.5 font-[590] text-ok">
              <Check size={13} /> Nothing to read closely
            </p>
            <p className="mt-1.5 text-[12px] leading-[1.45] text-fg3">The evidence carries this stop. It asks nothing, and no line is planted here.</p>
          </>
        )}
      </div>
    </div>
  );
}

export function StopView({ stop, answers, flags, locked, canAsk, pulse, evidence, issue, points, rulings, lockSeconds, onAnswer, onFlag, onRule, onAsk, onReread, onPrev, onNext, last }: Props) {
  const open = stop.questions.filter((q) => !answers[q.id]?.right).length;
  const code = stop.blocks.filter((b): b is CodeBlock => b.type === 'code');
  const files = [...new Set(code.map((b) => b.file))];
  const lines = code.reduce((a, b) => a + b.to - b.from + 1, 0);
  const unruled = points.filter((p) => !rulings[p.id]);
  const unnoticed = stop.evidence?.changes.survived ?? [];
  const marks = [
    ...code.flatMap((b) => (b.focus ?? []).map((f) => ({ file: b.file, from: f.from, to: f.to, why: f.why, kind: 'risk' as const }))),
    ...unnoticed.map((u) => ({ file: u.file, from: u.line, to: u.line, why: `No test notices this line. ${u.effect}`, kind: 'untested' as const })),
    ...points.map((p) => ({ file: p.file, from: p.from, to: p.to, why: p.question, kind: 'point' as const })),
  ]
    .filter((m, i, all) => all.findIndex((x) => x.file === m.file && x.from === m.from) === i)
    .sort((a, b) => files.indexOf(a.file) - files.indexOf(b.file) || a.from - b.from);
  const here = flags.filter((f) => code.some((b) => b.file === f.file && b.from <= f.line && f.line <= b.to)).length;
  const todo = open + unruled.length;
  return (
    <article key={stop.id} className="rise mx-auto max-w-[920px] px-4 pt-6 pb-28 sm:px-8 sm:pt-12">
      <h1 className="text-[22px] leading-[1.2] font-[590] tracking-[-0.02em] text-fg sm:text-[28px]">{stop.title}</h1>
      <p className="mt-2 max-w-[68ch] text-[14.5px] leading-[1.55] text-fg2 sm:mt-3 sm:text-[15.5px] sm:leading-[1.6]">{inline(stop.why)}</p>

      {stop.evidence && evidence && <Evidence stop={stop} evidence={evidence} lines={lines} issue={issue} />}

      {marks.length > 0 && (
        <div className="-mx-4 mt-4 flex items-center gap-x-2 gap-y-1.5 overflow-x-auto px-4 text-[12.5px] [scrollbar-width:none] sm:mx-0 sm:mt-5 sm:flex-wrap sm:overflow-visible sm:px-0">
          <span className="flex flex-none items-center gap-1.5 font-[590] text-warn">
            <Eye size={13} /> Read closely
          </span>
          {files.map((file) => {
            const here = marks.filter((m) => m.file === file);
            const base = file.split('/').pop();
            // two files of one name (lib/invoices.ts, routes/invoices.ts) are told apart by their folder
            const name = files.filter((x) => x.split('/').pop() === base).length > 1 ? file.split('/').slice(-2).join('/') : base;
            return here.length ? (
              <span key={file} className="flex flex-none items-center gap-1.5">
                {files.length > 1 && <span className="flex-none pl-1 font-mono text-[11.5px] text-fg4">{name}</span>}
                {here.map((f) => (
                  <button
                    key={`${f.file}:${f.from}`}
                    className={`flex flex-none items-center gap-1 rounded-md border px-2 py-[3px] font-mono text-[11.5px] tabular-nums transition-colors hover:text-fg ${f.kind === 'point' ? 'border-accent/45 text-accent-hi hover:border-accent' : 'border-line-strong text-fg3 hover:border-warn/45'}`}
                    title={f.why}
                    aria-label={`${name}, ${f.to > f.from ? `lines ${f.from} to ${f.to}` : `line ${f.from}`}`}
                    onClick={() => onReread(f)}
                  >
                    {f.kind === 'untested' && <Warn size={11} className="text-warn" />}
                    {files.length > 1 ? '' : f.to > f.from ? 'lines ' : 'line '}
                    {f.from}
                    {f.to > f.from ? `–${f.to}` : ''}
                  </button>
                ))}
              </span>
            ) : null;
          })}
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
            <Code key={i} block={b} flags={flags} pulse={pulse} locked={locked} canAsk={canAsk} onFlag={onFlag} onAsk={onAsk} unnoticed={unnoticed} tests={evidence?.tests.passed} points={points} rulings={rulings} onRule={onRule} />
          ),
        )}
      </div>

      {stop.questions.length > 0 && <Quiz questions={stop.questions} answers={answers} lockSeconds={lockSeconds} onAnswer={onAnswer} onReread={onReread} />}

      <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <button className="btn btn-ghost" onClick={onPrev}>
          <ArrowLeft size={14} /> Back
        </button>
        <span className="ml-auto flex items-center gap-1.5 text-[12.5px] text-fg4">
          {here > 0 ? (
            <span className="flex items-center gap-1.5 text-flag">
              <FlagFill size={12} /> {here} flagged here
            </span>
          ) : todo > 0 ? (
            [open ? `${open} ${open === 1 ? 'question' : 'questions'}` : '', unruled.length ? `${unruled.length} open ${unruled.length === 1 ? 'point' : 'points'}` : ''].filter(Boolean).join(' and ') + ' left here'
          ) : (
            <span className="hidden items-center gap-1.5 sm:flex">
              <span className="kbd">←</span>
              <span className="kbd">→</span> move between stops
            </span>
          )}
        </span>
        <button className={`btn ${todo ? '' : 'btn-primary'}`} onClick={onNext}>
          {last ? 'Hand in' : todo ? 'Next stop' : here ? 'Flagged, next stop' : stop.required ? 'Looks right, next stop' : 'Next stop'} <ArrowRight size={14} />
        </button>
      </div>
    </article>
  );
}
