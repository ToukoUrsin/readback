/**
 * What readers did, kept on disk: one line per event in <dir>/reads.jsonl, and the open reads in <dir>/sessions-*.json
 * so a deploy does not throw a reader out. Without a directory everything stays in memory (tests).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ReadEvent {
  type: 'start' | 'answer' | 'handin' | 'sign' | 'ask' | 'reset' | 'cold-shown' | 'cold' | 'stop' | 'failed' | 'unsign' | 'prep' | 'mark' | 'rule' | 'rule-refused' | 'rule-unchecked' | 'handin-unchecked' | 'signin';
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
  /** signatures by what they did to the commit (the read that approves only) */
  approved: number;
  sentBack: number;
  notCounted: number;
  /** hand-ins where the planted line was flagged but the note did not say what it does wrong */
  noteFailed: number;
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
  /** every row, oldest first */
  events(): ReadEvent[];
  /** `all`, `tours`, `cold`: people. `agents`: our own agents, test browsers and scripts, counted the same way and kept apart */
  stats(): { at: string; first: string | null; all: Counts; tours: Record<string, Counts>; cold: ColdCounts; agents: { all: Counts; cold: ColdCounts }; /** goes that came in with the judge link: invited by the team, a person or an AI */ judges: { all: Counts; cold: ColdCounts }; testReadersLeftOut: number };
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

/**
 * Goes that are not a person's: our own test browsers, our agents' browsers (ours, or rb-agent in the client's name),
 * clients that are not a browser, and goes marked as ours afterwards (a "mark" row; nothing is deleted).
 */
/**
 * The goes of invited judges: every go that came in with the judge link, and what the same browser did before it opened
 * the link (the first screen, the short review), so a judge's cold test is counted with the judges and not with people.
 */
export function invitedOf(events: ReadEvent[]): Set<string> {
  const browsers = new Set(events.filter((e) => e.type === 'signin' && e.via === 'invite' && typeof e.browser === 'string').map((e) => e.browser as string));
  return new Set(events.filter((e) => e.via === 'invite' || (typeof e.by === 'string' && browsers.has(e.by))).map((e) => e.rid));
}

export function oursOf(events: ReadEvent[]): Set<string> {
  const out = new Set<string>();
  for (const e of events) if (e.test || e.ours === true || e.type === 'mark' || (typeof e.agent === 'string' && e.agent && (!e.agent.includes('Mozilla') || e.agent.includes('rb-agent')))) out.add(e.rid);
  return out;
}

export function count(events: ReadEvent[]): Counts {
  const by = new Map<string, ReadEvent[]>();
  for (const e of events) by.set(e.rid, [...(by.get(e.rid) ?? []), e]);
  const c: Counts = { started: 0, reads: 0, caughtFirstRead: 0, missedFirstRead: 0, caughtLater: 0, signed: 0, handIns: 0, medianSeconds: null, medianSecondsToSignature: null, medianWrongAnswers: null, failed: 0, fastSignatures: 0, approved: 0, sentBack: 0, notCounted: 0, noteFailed: 0 };
  const secs: number[] = [];
  const signSecs: number[] = [];
  const wrong: number[] = [];
  for (const es of by.values()) {
    if (es.some((e) => e.type === 'start')) c.started++;
    if (es.some((e) => e.type === 'failed')) c.failed++;
    if (es.some((e) => e.type === 'sign' && e.fast)) c.fastSignatures++;
    const hs = es.filter((e) => e.type === 'handin');
    c.handIns += hs.length;
    c.noteFailed += hs.filter((h) => h.noteOk === false).length;
    const out = es.find((e) => e.type === 'sign' && e.outcome)?.outcome;
    if (out === 'approved') c.approved++;
    else if (out === 'sent-back') c.sentBack++;
    else if (out === 'not-counted') c.notCounted++;
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

export function countCold(events: ReadEvent[]): ColdCounts {
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
    events: () => events,
    stats() {
      const ours = oursOf(events);
      const invited = invitedOf(events);
      const real = events.filter((e) => !ours.has(e.rid) && !invited.has(e.rid));
      const rest = events.filter((e) => ours.has(e.rid) && !invited.has(e.rid));
      const judges = events.filter((e) => invited.has(e.rid));
      const tours: Record<string, Counts> = {};
      for (const t of new Set(real.map((e) => e.tour))) tours[t] = count(real.filter((e) => e.tour === t));
      return { at: new Date().toISOString(), first: real[0]?.at ?? null, all: count(real), tours, cold: countCold(real), agents: { all: count(rest), cold: countCold(rest) }, judges: { all: count(judges), cold: countCold(judges) }, testReadersLeftOut: ours.size };
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
