import { useEffect, useRef, useState } from 'react';
import type { PublicStop } from '../../../shared/tour';
import { askGuide } from '../api';
import { ArrowUp, Bot, X } from './icons';
import { Rich } from './Prose';

export interface Msg {
  role: 'user' | 'model';
  text: string;
  about?: string;
}

interface Props {
  stop: PublicStop | null;
  line: { file: string; line: number } | null;
  clearLine: () => void;
  msgs: Msg[];
  setMsgs: (f: (m: Msg[]) => Msg[]) => void;
  onJump: (file: string, line: number) => void;
  onClose: () => void;
  focusKey: number;
}

const STARTERS = ['Walk me through this stop in three sentences.', 'Why is it built this way and not simpler?', 'What else in the app depends on this code?'];

export function Ask({ stop, line, clearLine, msgs, setMsgs, onJump, onClose, focusKey }: Props) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);

  // not on first paint: the keys 1 to 4 and the arrows belong to the page until the reader opens the guide
  useEffect(() => {
    if (focusKey > 0) input.current?.focus();
  }, [focusKey]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [msgs]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    setQ('');
    setBusy(true);
    const history = msgs.map(({ role, text }) => ({ role, text }));
    const about = line ? `${line.file.split('/').pop()}:${line.line}` : undefined;
    setMsgs((m) => [...m, { role: 'user', text: question, about }, { role: 'model', text: '' }]);
    const put = (t: string) => setMsgs((m) => [...m.slice(0, -1), { role: 'model', text: t }]);
    try {
      const all = await askGuide({ q: question, stopId: stop?.id, line: line ?? undefined, history }, put);
      if (!all) put('The guide did not answer. Ask again.');
    } catch {
      put('The guide did not answer. Ask again.');
    } finally {
      setBusy(false);
      clearLine();
    }
  };

  return (
    <aside className="flex h-full w-full flex-col bg-panel">
      <header className="flex h-12 flex-none items-center gap-2 border-b border-line px-4">
        <Bot size={15} className="text-accent-hi" />
        <span className="text-[13px] font-[590]">Guide</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-fg4">{stop ? stop.title : 'the whole change'}</span>
        <button className="btn btn-ghost size-7! p-0!" onClick={onClose} title="Close (A)">
          <X size={14} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {msgs.length === 0 ? (
          <div className="flex h-full flex-col justify-end gap-1.5">
            <p className="mb-2 text-[13px] leading-[1.5] text-fg3">Ask anything about the code you are reading. The guide explains what it does and why. It will not tell you what is wrong: that part is yours.</p>
            {STARTERS.map((s) => (
              <button key={s} className="rounded-lg border border-line px-3 py-2 text-left text-[13px] text-fg2 transition-colors hover:border-line-strong hover:bg-hover hover:text-fg" onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {msgs.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} className="ml-6 rounded-lg bg-active px-3 py-2 text-[13.5px] leading-[1.5] text-fg">
                  {m.about && <span className="icode mr-1.5 text-[11px]! text-fg3!">{m.about}</span>}
                  {m.text}
                </div>
              ) : (
                <div key={i} className={`text-[13.5px] leading-[1.55] text-fg2 ${busy && i === msgs.length - 1 && m.text ? 'caret' : ''}`}>
                  {m.text ? <Rich text={m.text} onJump={onJump} /> : <span className="thinking text-fg4">Reading the code</span>}
                </div>
              ),
            )}
            <div ref={end} />
          </div>
        )}
      </div>
      <form
        className="flex-none border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(q);
        }}
      >
        <div className="rounded-lg border border-line-strong bg-raised transition-colors focus-within:border-accent">
          {line && (
            <div className="flex items-center gap-1.5 px-3 pt-2">
              <span className="icode text-[11px]!">
                {line.file.split('/').pop()}:{line.line}
              </span>
              <button type="button" className="text-fg4 hover:text-fg" onClick={clearLine} title="Ask about the whole stop instead">
                <X size={11} />
              </button>
            </div>
          )}
          <div className="flex items-end gap-2 p-2 pl-3">
            <textarea
              ref={input}
              rows={1}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(q);
                } else if (e.key === 'Escape') onClose();
              }}
              placeholder={line ? 'Ask about this line' : 'Ask about this code'}
              className="max-h-32 min-h-7 flex-1 resize-none py-1 text-[13.5px] leading-5 [field-sizing:content] placeholder:text-fg4"
            />
            <button className="btn btn-primary size-7! flex-none rounded-md! p-0!" disabled={!q.trim() || busy} title="Send">
              <ArrowUp size={14} />
            </button>
          </div>
        </div>
      </form>
    </aside>
  );
}
