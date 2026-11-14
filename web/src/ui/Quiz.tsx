import { useEffect, useState } from 'react';
import type { AnswerState, PublicQuestion } from '../../../shared/tour';
import { api, bodyOf } from '../api';
import { Check, X } from './icons';
import { inline } from './Prose';

interface Props {
  questions: PublicQuestion[];
  answers: Record<string, AnswerState>;
  /** a wrong try closes its question for this long */
  lockSeconds?: number;
  onAnswer: (id: string, a: AnswerState) => void;
  onReread: (r: { file: string; from: number; to: number }) => void;
}

export function Quiz({ questions, answers, lockSeconds, onAnswer, onReread }: Props) {
  const firstOpen = questions.find((q) => !answers[q.id]?.right)?.id ?? null;
  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-[13px] font-[590] text-fg">Check your reading</h2>
        <span className="text-[12px] text-fg4">
          {questions.filter((q) => answers[q.id]?.right).length} of {questions.length}
        </span>
        {!!lockSeconds && <span className="ml-auto hidden text-[12px] text-fg4 sm:inline">A wrong answer closes its question for {lockSeconds} s and stays on the record.</span>}
      </div>
      <div className="space-y-3">
        {questions.map((q) => (
          <One key={q.id} q={q} a={answers[q.id]} keys={q.id === firstOpen} onAnswer={onAnswer} onReread={onReread} />
        ))}
      </div>
    </section>
  );
}

function One({ q, a, keys, onAnswer, onReread }: { q: PublicQuestion; a: AnswerState | undefined; keys: boolean; onAnswer: Props['onAnswer']; onReread: Props['onReread'] }) {
  const [picked, setPicked] = useState<number | null>(null);
  const [tried, setTried] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState<{ choice: number; reread: { file: string; from: number; to: number } } | null>(null);
  const right = a?.right;
  // a wrong try closes the question for a while: the seconds left tick down here
  const until = a?.lockedUntil ? Date.parse(a.lockedUntil) : 0;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!until || until <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [until]);
  const wait = right ? 0 : Math.max(0, Math.ceil((until - now) / 1000));

  const check = async () => {
    if (picked === null || busy || right || wait > 0) return;
    setBusy(true);
    try {
      const r = await api.answer(q.id, picked);
      onAnswer(q.id, r.answer);
      if (!r.answer.right && r.reread) {
        setWrong({ choice: picked, reread: r.reread });
        setTried((t) => [...t, picked]);
        setPicked(null);
      } else setWrong(null);
    } catch (e) {
      // the question is closed: the server says until when
      const b = bodyOf<{ answer: AnswerState; reread: { file: string; from: number; to: number } }>(e);
      if (b.answer) onAnswer(q.id, b.answer);
      setNow(Date.now());
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!keys || right) return;
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA)$/.test((e.target as HTMLElement).tagName)) return;
      const n = Number(e.key);
      if (n >= 1 && n <= q.options.length && !tried.includes(n - 1)) setPicked(n - 1);
      else if (e.key === 'Enter' && picked !== null) {
        e.preventDefault();
        void check();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  return (
    <div className={`card p-4 transition-colors ${right ? 'border-ok/25' : ''}`}>
      <p className="text-[14.5px] leading-[1.45] font-[510] text-fg">{inline(q.prompt)}</p>
      <div className="mt-3 space-y-1">
        {q.options.map((o, i) => {
          const isRight = right?.choice === i;
          const wasTried = tried.includes(i);
          const sel = picked === i;
          return (
            <button
              key={i}
              disabled={!!right || wasTried || busy}
              onClick={() => setPicked(i)}
              className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2 text-left text-[13.5px] leading-[1.45] transition-colors ${
                isRight ? 'border-ok/40 bg-ok-soft text-fg' : wasTried ? `border-transparent text-fg4 line-through decoration-bad/60 ${wrong?.choice === i ? 'shake' : ''}` : sel ? 'border-accent bg-accent-soft text-fg' : right ? 'border-transparent text-fg4' : 'border-transparent text-fg2 hover:bg-hover hover:text-fg'
              }`}
            >
              <span className={`mt-[2px] flex size-[17px] flex-none items-center justify-center rounded-full border ${isRight ? 'border-ok bg-ok text-bg' : wasTried ? 'border-bad/50 text-bad' : sel ? 'border-accent-hi' : 'border-line-strong'}`}>
                {isRight ? <Check size={11} strokeWidth={2.2} /> : wasTried ? <X size={9} strokeWidth={2} /> : sel ? <i className="size-[7px] rounded-full bg-accent-hi" /> : null}
              </span>
              <span className="min-w-0 flex-1">{inline(o)}</span>
              {!right && !wasTried && <span className="kbd mt-px flex-none">{i + 1}</span>}
            </button>
          );
        })}
      </div>
      {right ? (
        <p className="fade mt-3 border-t border-line pt-3 text-[13px] leading-[1.5] text-fg2">
          <span className="font-[590] text-ok">Right. </span>
          {inline(right.explain)}
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button className="btn btn-primary" disabled={picked === null || busy || wait > 0} onClick={check}>
            {wait > 0 ? `Opens again in ${wait} s` : 'Check'} {wait > 0 ? null : <span className="kbd">↵</span>}
          </button>
          {wrong && (
            <p className="fade min-w-0 flex-1 text-[13px] text-fg2">
              <span className="font-[590] text-bad">That is not what the code does. </span>
              Read{' '}
              <button className="icode underline decoration-fg4 underline-offset-2 hover:decoration-fg" onClick={() => onReread(wrong.reread)}>
                {wrong.reread.file.split('/').pop()}:{wrong.reread.from}–{wrong.reread.to}
              </button>{' '}
              again.{a && a.misses > 0 ? ` ${a.misses} wrong ${a.misses === 1 ? 'try' : 'tries'} on this question.` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
