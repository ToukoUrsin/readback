import type { Reveal, Token } from '../../../shared/tour';
import { X } from './icons';
import { inline } from './Prose';

/** The two lines without their shared indent, and where they differ (character offsets into each). */
function differ(a: Token[], b: Token[]) {
  const ta = a.map((t) => t[0]).join('');
  const tb = b.map((t) => t[0]).join('');
  const indent = Math.min(ta.length - ta.trimStart().length, tb.length - tb.trimStart().length);
  let pre = 0;
  while (pre < ta.length && pre < tb.length && ta[pre] === tb[pre]) pre++;
  let suf = 0;
  while (suf < ta.length - pre && suf < tb.length - pre && ta[ta.length - 1 - suf] === tb[tb.length - 1 - suf]) suf++;
  return { indent, pre, endA: ta.length - suf, endB: tb.length - suf };
}

/** tokens from `skip` on, with the characters in [from, to) marked */
function Marked({ tokens, skip, from, to, mark }: { tokens: Token[]; skip: number; from: number; to: number; mark: string }) {
  const out: { text: string; c: string; on: boolean }[] = [];
  let at = 0;
  for (const [text, c] of tokens) {
    const cuts = [...new Set([0, text.length, skip - at, from - at, to - at].filter((x) => x >= 0 && x <= text.length))].sort((x, y) => x - y);
    for (let i = 0; i + 1 < cuts.length; i++) {
      const s = at + cuts[i]!;
      if (s >= skip) out.push({ text: text.slice(cuts[i]!, cuts[i + 1]!), c, on: s >= from && s < to });
    }
    at += text.length;
  }
  return (
    <>
      {out.map((o, i) => (
        <span key={i} className={`${o.c ? `tk-${o.c}` : ''} ${o.on ? mark : ''}`}>
          {o.text}
        </span>
      ))}
    </>
  );
}

/** The planted line next to the real one, what it breaks, and the project's tests that fail with it. */
export function RevealCard({ r, where, shownAs = 'What you were shown' }: { r: Reveal; where?: string; shownAs?: string }) {
  const d = differ(r.planted, r.original);
  const row = (sign: string, tokens: Token[], cls: string, to: number, mark: string) => (
    <div className={`row min-w-0! ${cls}`}>
      <span className="num cursor-default!">{sign}</span>
      <span className="src min-w-0 pr-4! whitespace-pre-wrap! [overflow-wrap:anywhere]">
        <Marked tokens={tokens} skip={d.indent} from={d.pre} to={to} mark={mark} />
      </span>
    </div>
  );
  const fails = r.failures?.length ? r.failures : r.failedTests.map((test) => ({ test, message: undefined as string | undefined }));
  const shownFails = fails.slice(0, 4);
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2.5">
        <span className="font-mono text-[12px] text-fg2">
          {r.file}:{r.line}
        </span>
        {where && <span className="text-[12px] text-fg4">in “{where}”</span>}
      </div>
      <div className="code py-2">
        <p className="px-4 pb-1 font-sans text-[11.5px] text-fg4">{shownAs}</p>
        {row('−', r.planted, 'del [&_.src]:no-underline! [&_.src]:opacity-100!', d.endA, 'rounded-[3px] bg-[#e5484d]/30')}
        <p className="px-4 pt-2 pb-1 font-sans text-[11.5px] text-fg4">What the agent wrote</p>
        {row('+', r.original, 'add', d.endB, 'rounded-[3px] bg-[#3fb950]/25')}
      </div>
      <div className="border-t border-line px-4 py-3">
        <p className="text-[13.5px] leading-[1.55] text-fg2">{inline(r.what)}</p>
        {r.stated && (
          <p className="mt-2 text-[12.5px] leading-[1.55] text-fg3">
            <span className="text-fg4">What you had been told about this line: </span>
            {inline(r.stated)}
          </p>
        )}
      </div>
      {fails.length > 0 && (
        <div className="border-t border-line">
          <div className="flex items-center gap-2 px-4 py-2 text-[12px]">
            <span className="flex size-4 flex-none items-center justify-center rounded-full bg-bad text-bg">
              <X size={9} strokeWidth={2.4} />
            </span>
            <span className="font-[590] text-fg">
              {fails.length} {fails.length === 1 ? 'test' : 'tests'} of the project {fails.length === 1 ? 'fails' : 'fail'} with this line
            </span>
            <span className="ml-auto hidden font-mono text-[11px] text-fg4 sm:inline">bun test</span>
          </div>
          {shownFails.map((f) => (
            <div key={f.test} className="flex gap-2.5 border-t border-line px-4 py-2">
              <X size={12} strokeWidth={2} className="mt-[3px] flex-none text-bad" />
              <div className="min-w-0">
                <p className="text-[12.5px] leading-[1.45] text-fg2">{f.test}</p>
                {f.message && <p className="mt-0.5 font-mono text-[11.5px] leading-[1.5] [overflow-wrap:anywhere] whitespace-pre-wrap text-fg3">{f.message}</p>}
              </div>
            </div>
          ))}
          {fails.length > shownFails.length && <p className="border-t border-line px-4 py-2 text-[12px] text-fg4">and {fails.length - shownFails.length} more</p>}
        </div>
      )}
    </div>
  );
}
