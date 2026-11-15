import type { AnswerState, Flag, PublicTour, ReaderState, Ruling } from '../../shared/tour';

export interface ColdStats {
  shown: number;
  approved: number;
  flaggedPlanted: number;
  flaggedOther: number;
  skipped: number;
}

/** "/" and "/short" are the short read, "/full" the read that approves, "/next" the follow-up review of the author's answer: the same page with another server behind it */
export const BASE = /^\/(short|full|next)(\/|$)/.exec(location.pathname)?.[0].replace(/\/$/, '') ?? '';

// our own test reads carry a mark, so they stay out of the counts
try {
  const t = new URLSearchParams(location.search).get('test');
  if (t === '1') document.cookie = 'rb_test=1; path=/; max-age=2592000; samesite=lax';
  // "?test=0" makes this browser count again, for a device that goes to visitors
  if (t === '0') document.cookie = 'rb_test=; path=/; max-age=0; samesite=lax';
} catch {
  /* no cookies: the read is counted */
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(BASE + path, body === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  // a refusal can carry the state it leaves behind (a closed question, the flags as they are)
  if (!r.ok) throw Object.assign(new Error((j as { error?: string }).error ?? `The server answered ${r.status}.`), { body: j, status: r.status });
  return j as T;
}

export const api = {
  tour: () => call<PublicTour>('/api/tour'),
  start: () => call<ReaderState>('/api/start', {}),
  answer: (id: string, choice: number) => call<{ answer: AnswerState; reread?: { file: string; from: number; to: number } }>('/api/answer', { id, choice }),
  flag: (f: Flag & { on?: boolean }) => call<{ flags: Flag[] }>('/api/flag', f),
  rule: (id: string, decision: Ruling['decision'], note: string) => call<{ rulings: Record<string, Ruling> }>('/api/rule', { id, decision, note }),
  pace: () => call<{ brief: { id: string; title: string; seconds: number; needs: number }[]; linesPerMinute: number; under: number; lines: number; prepared?: boolean }>('/api/pace'),
  handin: () => call<{ ok: boolean; tour: PublicTour }>('/api/handin', {}),
  sign: (name: string) => call<ReaderState>('/api/sign', { name }),
  reset: () => call<PublicTour>('/api/reset', {}),
  unsign: () => call<ReaderState>('/api/unsign', {}),
  prep: (key: string, leave: string, plant?: string) => call<PublicTour>('/api/prep', { key, leave, ...(plant ? { plant } : {}) }),
  cold: (b: { action: 'approve' | 'flag' | 'skip'; file?: string; line?: number }) => call<PublicTour>('/api/cold', b),
  /** the stop on screen; with beat: still on it (nothing is recorded, the time counts); 'away' with beat: the tab is hidden */
  seen: (stop: string, beat = false) => call<{ ok: boolean }>('/api/seen', { stop, ...(beat ? { beat } : {}) }).catch(() => undefined),
  stats: () => call<{ cold?: ColdStats }>('/api/stats'),
};

/** what a refused call left behind, when the server said */
export const bodyOf = <T,>(e: unknown): Partial<T> => ((e as { body?: Partial<T> }).body ?? {});

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
