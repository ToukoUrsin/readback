/**
 * What readers did, kept on disk: one line per event in <dir>/reads.jsonl, and the open reads in <dir>/sessions-*.json
 * so a deploy does not throw a reader out. Without a directory everything stays in memory (tests).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ReadEvent {
  type: 'start' | 'answer' | 'handin' | 'sign' | 'ask' | 'reset' | 'cold-shown' | 'cold' | 'stop' | 'failed' | 'unsign' | 'prep' | 'mark';
  at: string;
  /** one reader's one go at a tour; a new one after "Start over" */
  rid: string;
  tour: string;
  headSha: string;
  /** our own test reads, left out of every count */
  test: boolean;
  [more: string]: unknown;
}

export interface Counts {
  /** readers who opened the first stop */
  started: number;
  /** readers who handed in at least once */
  reads: number;
  caughtFirstRead: number;
  missedFirstRead: number;
  /** of those who missed first: caught a planted bug on a later read */
  caughtLater: number;
  signed: number;
  handIns: number;
  /** from the first stop to the first hand-in */
  medianSeconds: number | null;
  /** from the first stop to the signature */
  medianSecondsToSignature: number | null;
  /** wrong answers before the first hand-in */
  medianWrongAnswers: number | null;
  /** readers who were shown every planted line without catching one: their read cannot count */
  failed: number;
  /** signatures on reads that went faster than a person reads code closely */
  fastSignatures: number;
}

/** The cold test: a plain diff with one planted line, before any guided read and with nothing said about a bug. */
export interface ColdCounts {
  shown: number;
  /** pressed Approve with the planted line in front of them */
  approved: number;
  /** asked for changes on the planted line */
  flaggedPlanted: number;
  /** asked for changes on another line */
  flaggedOther: number;
  skipped: number;
  /** from seeing the diff to deciding, skips left out */
  medianSeconds: number | null;
  /** of the people who decided the cold test and then handed in a guided read: how the first guided hand-in went */
  thenGuided: { reads: number; caughtFirstRead: number };
}

export interface Store {
  record(e: ReadEvent): void;
  stats(): { at: string; first: string | null; all: Counts; tours: Record<string, Counts>; cold: ColdCounts; testReadersLeftOut: number };
  load<T>(name: string): T | null;
  /** written a moment later, once per burst */
  save(name: string, value: () => unknown): void;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};

function count(events: ReadEvent[]): Counts {
  const by = new Map<string, ReadEvent[]>();
  for (const e of events) by.set(e.rid, [...(by.get(e.rid) ?? []), e]);
  const c: Counts = { started: 0, reads: 0, caughtFirstRead: 0, missedFirstRead: 0, caughtLater: 0, signed: 0, handIns: 0, medianSeconds: null, medianSecondsToSignature: null, medianWrongAnswers: null, failed: 0, fastSignatures: 0 };
  const secs: number[] = [];
  const signSecs: number[] = [];
  const wrong: number[] = [];
  for (const es of by.values()) {
    if (es.some((e) => e.type === 'start')) c.started++;
    if (es.some((e) => e.type === 'failed')) c.failed++;
    if (es.some((e) => e.type === 'sign' && e.fast)) c.fastSignatures++;
    const hs = es.filter((e) => e.type === 'handin');
    c.handIns += hs.length;
    const first = hs[0];
    if (!first) continue;
    c.reads++;
    if (first.caught) c.caughtFirstRead++;
    else {
      c.missedFirstRead++;
      if (hs.some((h) => h.caught)) c.caughtLater++;
    }
    if (typeof first.seconds === 'number') secs.push(first.seconds);
    if (typeof first.wrongAnswers === 'number') wrong.push(first.wrongAnswers);
    const sign = es.find((e) => e.type === 'sign');
    if (sign) {
      c.signed++;
      if (typeof sign.seconds === 'number') signSecs.push(sign.seconds);
    }
  }
  c.medianSeconds = median(secs);
  c.medianSecondsToSignature = median(signSecs);
  c.medianWrongAnswers = median(wrong);
  return c;
}

function countCold(events: ReadEvent[]): ColdCounts {
  const by = new Map<string, ReadEvent[]>();
  for (const e of events) by.set(e.rid, [...(by.get(e.rid) ?? []), e]);
  const c: ColdCounts = { shown: 0, approved: 0, flaggedPlanted: 0, flaggedOther: 0, skipped: 0, medianSeconds: null, thenGuided: { reads: 0, caughtFirstRead: 0 } };
  const secs: number[] = [];
  for (const es of by.values()) {
    const d = es.find((e) => e.type === 'cold');
    // a decision means it was shown, also in rows from before a start-over wrote its own "shown"
    if (d || es.some((e) => e.type === 'cold-shown')) c.shown++;
    if (!d) continue;
    if (d.action === 'skip') {
      c.skipped++;
      continue;
    }
    if (d.action === 'approve') c.approved++;
    else if (d.caught) c.flaggedPlanted++;
    else c.flaggedOther++;
    if (typeof d.seconds === 'number' && es.some((e) => e.type === 'cold-shown')) secs.push(d.seconds);
    const first = es.find((e) => e.type === 'handin');
    if (first) {
      c.thenGuided.reads++;
      if (first.caught) c.thenGuided.caughtFirstRead++;
    }
  }
  c.medianSeconds = median(secs);
  return c;
}

export function createStore(dir: string | null): Store {
  const events: ReadEvent[] = [];
  const file = dir ? resolve(dir, 'reads.jsonl') : null;
  if (dir) mkdirSync(dir, { recursive: true });
  if (file && existsSync(file))
    for (const l of readFileSync(file, 'utf8').split('\n'))
      if (l.trim())
        try {
          events.push(JSON.parse(l) as ReadEvent);
        } catch {
          /* a torn last line */
        }
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  return {
    record(e) {
      events.push(e);
      if (file)
        try {
          appendFileSync(file, JSON.stringify(e) + '\n');
        } catch (err) {
          console.error('store:', (err as Error).message);
        }
    },
    stats() {
      // rows written before non-browser clients were marked: a go that named a client that is not a browser is not a person
      // also left out: our own agents' browsers (ours, or rb-agent in the client's name), and goes marked as ours afterwards (a "mark" row; nothing is deleted)
      const scripts = new Set(events.filter((e) => e.ours === true || e.type === 'mark' || (typeof e.agent === 'string' && e.agent && (!e.agent.includes('Mozilla') || e.agent.includes('rb-agent')))).map((e) => e.rid));
      const real = events.filter((e) => !e.test && !scripts.has(e.rid));
      const tours: Record<string, Counts> = {};
      for (const t of new Set(real.map((e) => e.tour))) tours[t] = count(real.filter((e) => e.tour === t));
      return { at: new Date().toISOString(), first: real[0]?.at ?? null, all: count(real), tours, cold: countCold(real), testReadersLeftOut: new Set(events.filter((e) => e.test || scripts.has(e.rid)).map((e) => e.rid)).size };
    },
    load<T>(name: string): T | null {
      if (!dir) return null;
      try {
        return JSON.parse(readFileSync(resolve(dir, `${name}.json`), 'utf8')) as T;
      } catch {
        return null;
      }
    },
    save(name, value) {
      if (!dir || timers.has(name)) return;
      timers.set(
        name,
        setTimeout(() => {
          timers.delete(name);
          try {
            const to = resolve(dir, `${name}.json`);
            writeFileSync(`${to}.tmp`, JSON.stringify(value()));
            renameSync(`${to}.tmp`, to);
          } catch (err) {
            console.error('store:', (err as Error).message);
          }
        }, 500),
      );
    },
  };
}
