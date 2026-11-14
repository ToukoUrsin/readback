/**
 * The rule the commit status follows. A signature is a record; whether it approves is decided here, from the record,
 * and nowhere else. The page shows the same checks to the reviewer before they sign.
 */
import type { GateCheck, Signature } from '../shared/tour';

export const RULE = {
  /** wrong tries on the questions, over the whole review */
  maxWrong: 3,
  /** the planted bug has to be caught on the first or the second read */
  maxReads: 2,
  /** lines a minute from which a read of whole stops is too fast to be a read: a line a second */
  fastLinesPerMinute: 60,
  /** the same for lines picked out for a close read: a line in four seconds */
  closeLinesPerMinute: 15,
  /** a wrong answer closes its question for this long */
  lockSeconds: 20,
};

export interface GateInput {
  /** GitHub login, when signed in */
  login?: string;
  /** the login was proven with a gist that only that account can make, not with GitHub's sign-in page */
  via?: 'gist' | 'invite';
  /** false when this server has a list of reviewers (RB_REVIEWERS) and the login is not on it */
  listed?: boolean;
  /** our own recording browser, opened with the server's key: its name is typed, and the status says it is a test read */
  test: boolean;
  /** questions answered ahead for a recording (test browsers with the key only) */
  prepared: boolean;
  questions: number;
  wrong: number;
  reads: number;
  linesPerMinute: number;
  /** the pace from which this read is too fast */
  fastAt: number;
  /** stops to read that were open for less time than it takes to scroll them */
  skimmed: number;
  rulings: { total: number; open: number; back: number };
}

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

export function gate(x: GateInput): GateCheck[] {
  const checks: GateCheck[] = [];
  checks.push(
    x.login && x.via === 'invite'
      ? { id: 'who', ok: true, text: 'Invited with the judge link this repository\'s team gave out. The name is typed by the judge' }
      : x.login && x.listed === false
      ? { id: 'who', ok: false, text: `@${x.login} is not on this repository's list of reviewers` }
      : x.login
        ? { id: 'who', ok: true, text: x.via === 'gist' ? `GitHub account @${x.login}, proven with a gist only that account can make` : `Signed in with GitHub as @${x.login}` }
        : x.test
          ? { id: 'who', ok: true, text: 'Our own recording browser, opened with the server\'s key: the name is typed, and the status says test read' }
          : { id: 'who', ok: false, text: 'The name is typed, not verified. Only a GitHub sign-in can approve' },
  );
  checks.push({ id: 'questions', ok: x.wrong <= RULE.maxWrong, text: `${x.questions} of ${x.questions} questions right, ${n(x.wrong, 'wrong try', 'wrong tries')} (at most ${RULE.maxWrong})` });
  checks.push({ id: 'planted', ok: x.reads <= RULE.maxReads, text: x.reads === 1 ? 'Planted bug caught on the first read, with the reason' : `Planted bug caught on read ${x.reads} (at most read ${RULE.maxReads})` });
  checks.push(
    x.prepared
      ? { id: 'pace', ok: x.test, text: 'Questions answered ahead for a recording: no pace is claimed' }
      : x.skimmed > 0
        ? { id: 'pace', ok: false, text: `${n(x.skimmed, 'stop')} to read ${x.skimmed === 1 ? 'was' : 'were'} open for less time than it takes to scroll ${x.skimmed === 1 ? 'it' : 'them'}` }
        : { id: 'pace', ok: x.linesPerMinute < x.fastAt, text: `${x.linesPerMinute} of the lines to read closely a minute (under ${x.fastAt})` },
  );
  if (x.rulings.total)
    checks.push(
      x.rulings.open
        ? { id: 'rulings', ok: false, text: `${n(x.rulings.open, 'open point')} not ruled on` }
        : x.rulings.back
          ? { id: 'rulings', ok: false, text: `${n(x.rulings.back, 'open point')} sent back to the author` }
          : { id: 'rulings', ok: true, text: `${n(x.rulings.total, 'open point')} ruled on, none sent back` },
    );
  return checks;
}

/** approved: every check holds. sent-back: a review that counts, with points for the author. not-counted: the record does not carry an approval. */
export function outcomeOf(checks: GateCheck[], back: number): NonNullable<Signature['outcome']> {
  if (checks.every((c) => c.ok)) return 'approved';
  if (back > 0 && checks.every((c) => c.ok || c.id === 'rulings')) return 'sent-back';
  return 'not-counted';
}

/** What a signature writes to GitHub as the commit status readback/read. null: nothing; a read that does not count changes nothing there. */
export function statusFor(x: { outcome: NonNullable<Signature['outcome']>; who: string; questions: number; wrong: number; reads: number; linesPerMinute?: number; back: number }): { state: 'success' | 'failure'; description: string } | null {
  if (x.outcome === 'approved') return { state: 'success', description: `Read by ${x.who}: ${x.questions}/${x.questions} questions, ${n(x.wrong, 'wrong try', 'wrong tries')}, planted bug caught on read ${x.reads}${x.linesPerMinute ? `, ${x.linesPerMinute} lines/min` : ''}` };
  if (x.outcome === 'sent-back') return { state: 'failure', description: `Sent back by ${x.who} after a full read: ${n(x.back, 'point')} for the author` };
  return null;
}
