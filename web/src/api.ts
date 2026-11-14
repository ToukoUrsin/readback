import type { AnswerState, Flag, PublicTour, ReaderState } from '../../shared/tour';

export interface ColdStats {
  shown: number;
  approved: number;
  flaggedPlanted: number;
  flaggedOther: number;
  skipped: number;
}

/** "/" and "/short" are the short read, "/full" the read that approves: the same page with another server behind it */
export const BASE = /^\/(short|full)(\/|$)/.exec(location.pathname)?.[0].replace(/\/$/, '') ?? '';

// our own test reads carry a mark, so they stay out of the counts
try {
  if (new URLSearchParams(location.search).get('test') === '1') document.cookie = 'rb_test=1; path=/; max-age=2592000; samesite=lax';
} catch {
  /* no cookies: the read is counted */
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(BASE + path, body === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `The server answered ${r.status}.`);
  return j as T;
}

export const api = {
  tour: () => call<PublicTour>('/api/tour'),
  start: () => call<ReaderState>('/api/start', {}),
  answer: (id: string, choice: number) => call<{ answer: AnswerState; reread?: { file: string; from: number; to: number } }>('/api/answer', { id, choice }),
  flag: (f: Flag & { on?: boolean }) => call<{ flags: Flag[] }>('/api/flag', f),
  handin: () => call<{ ok: boolean; tour: PublicTour }>('/api/handin', {}),
  sign: (name: string) => call<ReaderState>('/api/sign', { name }),
  reset: () => call<PublicTour>('/api/reset', {}),
  unsign: () => call<ReaderState>('/api/unsign', {}),
  cold: (b: { action: 'approve' | 'flag' | 'skip'; file?: string; line?: number }) => call<PublicTour>('/api/cold', b),
  seen: (stop: string) => call<{ ok: boolean }>('/api/seen', { stop }).catch(() => undefined),
  stats: () => call<{ cold?: ColdStats }>('/api/stats'),
};

/** The guide's answer, piece by piece. */
export async function askGuide(body: { q: string; stopId?: string; line?: { file: string; line: number }; history: { role: 'user' | 'model'; text: string }[] }, onText: (all: string) => void, signal?: AbortSignal): Promise<string> {
  const r = await fetch(`${BASE}/api/ask`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!r.body) throw new Error('The guide did not answer.');
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let all = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    all += dec.decode(value, { stream: true });
    onText(all);
  }
  return all;
}
