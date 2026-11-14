import { memo, useState } from 'react';
import type { CodeBlock, Flag, Token } from '../../../shared/tour';
import { Chat, Eye, Flag as FlagIcon, FlagFill, X } from './icons';
import { inline } from './Prose';

export const lineId = (file: string, n: number) => `L:${file}:${n}`;

export function Tokens({ tokens }: { tokens: Token[] }) {
  return (
    <>
      {tokens.map(([text, c], i) =>
        c ? (
          <span key={i} className={`tk-${c}`}>
            {text}
          </span>
        ) : (
          text
        ),
      )}
    </>
  );
}

interface Props {
  block: CodeBlock;
  flags: Flag[];
  pulse: { file: string; from: number; to: number; key: number } | null;
  locked: boolean;
  canAsk: boolean;
  onFlag: (f: Flag & { on?: boolean }) => void;
  onAsk: (file: string, line: number) => void;
}

/** a bar under a line, as wide as the card however far the code is scrolled sideways */
const under = 'sticky left-0 flex w-[100cqw] font-sans';

export const Code = memo(function Code({ block, flags, pulse, locked, canAsk, onFlag, onAsk }: Props) {
  const removed = block.lines.filter((l) => l.kind === 'del').length;
  const added = block.lines.filter((l) => l.kind === 'add').length;
  const [showRemoved, setShowRemoved] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const notes = new Map((block.notes ?? []).map((n) => [n.line, n.text]));
  const mine = new Map(flags.filter((f) => f.file === block.file).map((f) => [f.line, f]));
  const focus = block.focus ?? [];
  const slash = block.file.lastIndexOf('/') + 1;
  const act = !locked || canAsk;

  return (
    <div className="card my-5 overflow-hidden">
      <div className="flex items-center gap-3 border-b border-line px-4 py-2">
        <span className="min-w-0 truncate font-mono text-[12px]">
          <span className="text-fg4">{block.file.slice(0, slash)}</span>
          <span className="text-fg2">{block.file.slice(slash)}</span>
        </span>
        <span className="text-[11.5px] whitespace-nowrap text-fg4">
          lines {block.from}–{block.to}
        </span>
        <span className="ml-auto flex items-center gap-2 text-[11.5px] whitespace-nowrap">
          {focus.length > 0 && (
            <span className="flex items-center gap-1 text-warn">
              <Eye size={12} /> {focus.length}
            </span>
          )}
          {added > 0 && <span className="text-ok">+{added}</span>}
          {removed > 0 && (
            <button className={`rounded px-1 hover:bg-hover ${showRemoved ? 'text-bad' : 'text-fg4'}`} onClick={() => setShowRemoved((v) => !v)} title="Lines this change removed">
              −{removed} {showRemoved ? 'shown' : 'hidden'}
            </button>
          )}
        </span>
      </div>
      <div className="overflow-x-auto [container-type:inline-size]">
        <div className="code w-max min-w-full py-2">
          {block.lines.map((l, i) => {
            if (l.n === null)
              return showRemoved ? (
                <div key={`d${i}`} className="row del">
                  <span className="num cursor-default!">−</span>
                  <span className="src">
                    <Tokens tokens={l.tokens} />
                  </span>
                </div>
              ) : null;
            const n = l.n;
            const flag = mine.get(n);
            const note = notes.get(n);
            const starts = focus.filter((f) => f.from === n);
            const inFocus = focus.some((f) => f.from <= n && n <= f.to);
            const pulsing = pulse && pulse.file === block.file && pulse.from <= n && n <= pulse.to;
            const open = sel === n;
            const toggle = () => onFlag({ file: block.file, line: n, note: flag?.note ?? '', on: !flag });
            return (
              <div key={`${n}${pulsing ? `p${pulse.key}` : ''}`}>
                {starts.map((f) => (
                  <div key={`${f.from}-${f.to}`} className={`${under} items-start gap-2 py-1.5 pr-4 pl-[14px] ${i > 0 ? 'mt-1' : ''}`}>
                    <Eye size={13} className="mt-[2px] flex-none text-warn" />
                    <span className="text-[12.5px] leading-[18px] whitespace-normal text-fg2">
                      <span className="font-[590] text-warn">Read closely{f.to > f.from ? `, lines ${f.from}–${f.to}` : ''}. </span>
                      {inline(f.why)}
                    </span>
                  </div>
                ))}
                <div
                  id={lineId(block.file, n)}
                  className={`row ${act ? 'pick' : ''} ${l.kind === 'add' ? 'add' : ''} ${inFocus ? 'focus' : ''} ${flag ? 'flagged' : ''} ${open ? 'sel' : ''} ${pulsing ? 'pulse' : ''}`}
                  onClick={() => act && !window.getSelection()?.toString() && setSel(open ? null : n)}
                >
                  <span className="num">{n}</span>
                  <span className="src">
                    <Tokens tokens={l.tokens} />
                  </span>
                </div>
                {note && (
                  <div className={`${under} gap-2.5 py-1.5 pr-4 pl-[46px]`}>
                    <span className="mt-[3px] w-0.5 flex-none self-stretch rounded bg-accent" />
                    <span className="text-[12.5px] leading-[18px] whitespace-normal text-fg2">{inline(note)}</span>
                  </div>
                )}
                {open && act && (
                  <div className={`${under} fade flex-wrap items-center gap-2 border-y border-line bg-raised py-1.5 pr-3 pl-[14px]`}>
                    <span className="mr-1 text-[12px] text-fg4">Line {n}</span>
                    {!locked && (
                      <button
                        className={`tool ${flag ? 'on' : ''}`}
                        onClick={() => {
                          toggle();
                          if (flag) setSel(null);
                        }}
                      >
                        {flag ? <FlagFill size={12} /> : <FlagIcon size={12} />}
                        {flag ? 'Remove the flag' : 'Flag as wrong'}
                      </button>
                    )}
                    {canAsk && (
                      <button className="tool" onClick={() => onAsk(block.file, n)}>
                        <Chat size={12} />
                        Ask the guide
                      </button>
                    )}
                    <button className="ml-auto flex size-6 items-center justify-center rounded text-fg4 hover:bg-hover hover:text-fg" onClick={() => setSel(null)} title="Close">
                      <X size={12} />
                    </button>
                  </div>
                )}
                {flag && !locked && (
                  <div className={`${under} items-center gap-2 bg-flag-soft py-1 pr-3 pl-[14px]`}>
                    <FlagFill size={12} className="flex-none text-flag" />
                    <input
                      className="h-6 min-w-0 flex-1 text-[12.5px] text-fg placeholder:text-fg4"
                      placeholder="What is wrong here? (optional, goes to the author)"
                      defaultValue={flag.note}
                      maxLength={400}
                      onBlur={(e) => e.target.value !== flag.note && onFlag({ file: block.file, line: n, note: e.target.value })}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    />
                    {!open && (
                      <button className="flex size-6 flex-none items-center justify-center rounded text-fg4 hover:bg-hover hover:text-fg" onClick={toggle} title="Remove the flag">
                        <X size={12} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
