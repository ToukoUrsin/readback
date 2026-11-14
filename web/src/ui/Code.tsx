import { memo, useState } from 'react';
import type { CodeBlock, Flag, Token } from '../../../shared/tour';
import { Chat, Flag as FlagIcon, FlagFill } from './icons';

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

export const Code = memo(function Code({ block, flags, pulse, locked, canAsk, onFlag, onAsk }: Props) {
  const removed = block.lines.filter((l) => l.kind === 'del').length;
  const added = block.lines.filter((l) => l.kind === 'add').length;
  const [showRemoved, setShowRemoved] = useState(false);
  const notes = new Map((block.notes ?? []).map((n) => [n.line, n.text]));
  const mine = new Map(flags.filter((f) => f.file === block.file).map((f) => [f.line, f]));
  const slash = block.file.lastIndexOf('/') + 1;

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
            const pulsing = pulse && pulse.file === block.file && pulse.from <= n && n <= pulse.to;
            return (
              <div key={`${n}${pulsing ? `p${pulse.key}` : ''}`}>
                <div id={lineId(block.file, n)} className={`row ${l.kind === 'add' ? 'add' : ''} ${flag ? 'flagged' : ''} ${pulsing ? 'pulse' : ''}`}>
                  <span className="num" onClick={() => !locked && onFlag({ file: block.file, line: n, note: flag?.note ?? '', on: !flag })} title={locked ? undefined : flag ? 'Remove the flag' : 'Flag this line'}>
                    {n}
                  </span>
                  <span className="src">
                    <Tokens tokens={l.tokens} />
                  </span>
                  <span className="tools">
                    {!locked && (
                      <button className={`tool ${flag ? 'on' : ''}`} onClick={() => onFlag({ file: block.file, line: n, note: flag?.note ?? '', on: !flag })} title={flag ? 'Remove the flag' : 'Flag this line as wrong'}>
                        {flag ? <FlagFill size={11} /> : <FlagIcon size={11} />}
                        {flag ? 'Flagged' : 'Flag'}
                      </button>
                    )}
                    {canAsk && (
                      <button className="tool" onClick={() => onAsk(block.file, n)} title="Ask the guide about this line">
                        <Chat size={11} />
                        Ask
                      </button>
                    )}
                  </span>
                </div>
                {note && (
                  <div className="sticky left-0 flex w-[100cqw] gap-2.5 py-1.5 pr-4 pl-[46px] font-sans">
                    <span className="mt-[3px] w-0.5 flex-none self-stretch rounded bg-accent" />
                    <span className="text-[12.5px] leading-[18px] whitespace-normal text-fg2">{note}</span>
                  </div>
                )}
                {flag && !locked && (
                  <div className="sticky left-0 flex w-[100cqw] items-center gap-2 bg-flag-soft py-1 pr-4 pl-[48px] font-sans">
                    <FlagFill size={11} className="flex-none text-flag" />
                    <input
                      className="h-6 min-w-0 flex-1 text-[12.5px] text-fg placeholder:text-fg4"
                      placeholder="What looks wrong here? (optional, goes to the author)"
                      defaultValue={flag.note}
                      maxLength={400}
                      onBlur={(e) => e.target.value !== flag.note && onFlag({ file: block.file, line: n, note: e.target.value })}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    />
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
