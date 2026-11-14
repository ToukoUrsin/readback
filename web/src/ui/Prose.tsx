import type { ReactNode } from 'react';

const REF = /^([\w./-]+\.[a-z]{1,5}):(\d+)(?:[-–](\d+))?$/;

/** `code` and **bold**; a `file:line` in backticks becomes a jump when onJump is given. */
export function inline(text: string, onJump?: (file: string, line: number) => void): ReactNode[] {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      const body = part.slice(1, -1);
      const m = onJump ? REF.exec(body) : null;
      if (m)
        return (
          <button key={i} className="icode underline decoration-fg4 underline-offset-2 hover:decoration-fg" onClick={() => onJump!(m[1]!, Number(m[2]))}>
            {body}
          </button>
        );
      return (
        <code key={i} className="icode">
          {body}
        </code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
      return (
        <strong key={i} className="font-[590] text-fg">
          {part.slice(2, -2)}
        </strong>
      );
    return part;
  });
}

/** Paragraphs and "- " lists, for the guide's answers. */
export function Rich({ text, onJump }: { text: string; onJump?: (file: string, line: number) => void }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={blocks.length} className="my-1.5 list-disc space-y-1 pl-4 marker:text-fg4">
        {list.map((l, i) => (
          <li key={i}>{inline(l, onJump)}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (!l) {
      flush();
      continue;
    }
    const m = /^(?:[-*•]|\d+\.)\s+(.*)$/.exec(l);
    if (m) list.push(m[1]!);
    else {
      flush();
      blocks.push(
        <p key={blocks.length} className="my-1.5 first:mt-0 last:mb-0">
          {inline(l, onJump)}
        </p>,
      );
    }
  }
  flush();
  return <>{blocks}</>;
}
