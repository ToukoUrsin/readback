import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = ({ size = 14, ...p }: P) => ({ width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...p });

export const Logo = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
    <rect width="32" height="32" rx="8" fill="var(--accent)" />
    <path d="M9 11h14M9 16h9M9 21h5" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
    <circle cx="22.5" cy="20.5" r="3" fill="#fff" />
  </svg>
);
export const Flag = (p: P) => (
  <svg {...base(p)}>
    <path d="M3.5 14V2.5M3.5 3h8l-1.8 3 1.8 3h-8" />
  </svg>
);
export const FlagFill = (p: P) => (
  <svg {...base(p)}>
    <path d="M3.5 14V2.5" />
    <path d="M3.5 3h8l-1.8 3 1.8 3h-8z" fill="currentColor" />
  </svg>
);
export const Chat = (p: P) => (
  <svg {...base(p)}>
    <path d="M2.5 4.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H8l-3 2.5V11.5h-.5a2 2 0 0 1-2-2z" />
  </svg>
);
export const Check = (p: P) => (
  <svg {...base(p)}>
    <path d="m3.5 8.5 3 3 6-7" />
  </svg>
);
export const X = (p: P) => (
  <svg {...base(p)}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </svg>
);
export const ArrowRight = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 8h10M9 4l4 4-4 4" />
  </svg>
);
export const ArrowLeft = (p: P) => (
  <svg {...base(p)}>
    <path d="M13 8H3M7 4 3 8l4 4" />
  </svg>
);
export const ArrowUp = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 13V3M4 7l4-4 4 4" />
  </svg>
);
export const Menu = (p: P) => (
  <svg {...base(p)}>
    <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
  </svg>
);
export const Lock = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </svg>
);
export const Pull = (p: P) => (
  <svg {...base(p)}>
    <circle cx="4" cy="4" r="1.6" />
    <circle cx="4" cy="12" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <path d="M4 5.6v4.8M12 10.4V7a2.5 2.5 0 0 0-2.5-2.5H8m0 0 1.5-1.5M8 4.5 9.5 6" />
  </svg>
);
export const Bot = (p: P) => (
  <svg {...base(p)}>
    <rect x="2.5" y="5" width="11" height="8" rx="2.5" />
    <path d="M8 5V2.5M6 9v1M10 9v1" />
  </svg>
);
export const Minus = (p: P) => (
  <svg {...base(p)}>
    <path d="M3.5 8h9" />
  </svg>
);

/* Status marks, the way an issue tracker draws them */
export const StatusTodo = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden>
    <circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--fg4)" strokeWidth="1.5" />
  </svg>
);
export const StatusLocked = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden>
    <circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--fg4)" strokeWidth="1.5" strokeDasharray="1.6 2.2" opacity=".7" />
  </svg>
);
export const StatusNow = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden>
    <circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--warn)" strokeWidth="1.5" />
    <path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill="var(--warn)" />
  </svg>
);
export const StatusDone = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden>
    <circle cx="7" cy="7" r="6.25" fill="var(--accent)" />
    <path d="m4.3 7.2 1.9 1.9 3.6-4" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
