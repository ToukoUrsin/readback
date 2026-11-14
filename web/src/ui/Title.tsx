import type { ReactNode } from 'react';

/**
 * The headline of an outcome page. Some are a short verdict, some a whole sentence about what the bug does:
 * a long sentence steps down a size so it reads as a sentence, not a poster.
 */
export function Title({ children, text }: { children: ReactNode; text: string }) {
  const long = text.length > 64;
  return <h1 className={`mt-4 font-[590] text-fg ${long ? 'text-[23px] leading-[1.22] tracking-[-0.018em] sm:text-[27px]' : 'text-[26px] leading-[1.15] tracking-[-0.022em] sm:text-[32px]'}`}>{children}</h1>;
}
