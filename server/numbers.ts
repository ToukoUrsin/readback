/**
 * GET /api/numbers: what this copy has measured, for the page at /numbers. Counts only, no names.
 *
 * Three groups are counted the same way and kept apart: `people` are browsers that are not ours, `judges` came in with the
 * judge link (invited by the team; a judge can be a person or an AI, whatever browser it uses), `agents` are our own agents'
 * browsers, our test browsers and scripts. Only `people` may be quoted as results of people.
 */
import type { Evidence, Tour } from '../shared/tour';
import { closeLines } from './close';
import { RULE } from './gate';
import { type ColdCounts, type Counts, count, countCold, oursOf, type ReadEvent } from './store';

export interface Group {
  /** goes at a review or a cold test */
  goes: number;
  cold: ColdCounts;
  /** per review: 'full' approves, 'short' does not */
  reviews: Record<string, Counts>;
  /** rulings on the things the AI did not decide */
  rulings: { accepted: number; sentBack: number };
  /** questions put to the guide */
  asked: number;
  /** hand-ins of the review that approves, by how fast the lines to read closely went by: does a faster read miss more? */
  pace: Band[];
  /** cold tests by how long the decision took */
  coldPace: Band[];
  /** hand-ins of a review that approves, by the kind of planted bug: one the project's tests notice, or one no test notices */
  planted: { tested: { met: number; caught: number }; untested: { met: number; caught: number } };
  /** reasons for a ruling that were refused because they would fit any line */
  refused: number;
}

/** One band of time or pace: how many met the planted bug there, and how many caught it. */
export interface Band {
  band: string;
  met: number;
  caught: number;
  missed: number;
}

/** One reader in one area. A reader is a browser, or a GitHub login when signed in; shown by initials once they signed. */
export interface ReaderRow {
  reader: string;
  area: string;
  /** planted bugs of this area the reader met, in the cold test or a review */
  met: number;
  caught: number;
  missed: number;
  /** the last two in this area were both missed: their reviews in this area need a second reader */
  needsSecond: boolean;
}

export interface Numbers {
  at: string;
  people: Group;
  /** came in with the judge link */
  judges: Group;
  agents: Group;
  /** per reader and area, people only; empty until people have reviewed */
  readers: ReaderRow[];
  /** what the evidence routes to a person; null without evidence */
  route: {
    linesAll: number;
    linesToRead: number;
    stopsToRead: number;
    stops: { id: string; title: string; route: 'read' | 'evidence'; lines: number; closely: number; risk: string[]; criteria: number[]; tried: number; caught: number; unnoticed: number; why: string[] }[];
    tests: { passed: number; failed: number };
    tried: number;
    caught: number;
    unnoticed: number;
  } | null;
  /** each thing the AI did not decide, and what reviewers ruled */
  points: { id: string; kind: string; stopId: string; file: string; from: number; to: number; found: string; question: string; people: { accepted: number; sentBack: number }; judges: { accepted: number; sentBack: number }; agents: { accepted: number; sentBack: number } }[];
  planted: { total: number; byKind: Record<string, number>; untested: number };
  /** the rule a signature has to meet; `paceLimit` is in lines to read closely a minute */
  rule: { maxWrong: number; maxReads: number; fastLinesPerMinute: number; paceLimit: number; lockSeconds: number; maxFlags: number };
  /** the sample change and its requirement */
  pr: { repo: string; number: number; title: string; url: string; headSha: string; additions: number; deletions: number; files: number; issue?: { number: number; title: string } };
  /** the acceptance criteria of the issue, word for word */
  criteria: { n: number; text: string }[];
  /** what made the review material, and what it cost */
  madeBy: { plan: { model: string; plantModel?: string; costUsd: number }; evidence?: { model: string; costUsd: number } };
  stops: number;
  questions: number;
}

const initials = (name: string) => {
  const w = name.replace(/^@/, '').split(/[\s._-]+/).filter(Boolean);
  return (w.length > 1 ? w.map((x) => x[0]).join('') : (w[0] ?? '').slice(0, 2)).slice(0, 3).toUpperCase();
};

const bands = (rows: { v: number; hit: boolean }[], cuts: [string, number][]): Band[] =>
  cuts.map(([band, below], i) => {
    const from = i ? cuts[i - 1]![1] : -Infinity;
    const r = rows.filter((x) => x.v >= from && x.v < below);
    return { band, met: r.length, caught: r.filter((x) => x.hit).length, missed: r.filter((x) => !x.hit).length };
  });

function group(events: ReadEvent[]): Group {
  const reviews: Record<string, Counts> = {};
  for (const t of new Set(events.map((e) => e.tour))) reviews[t] = count(events.filter((e) => e.tour === t));
  // the last ruling on a point in a go is the one that stands
  const last = new Map<string, string>();
  for (const e of events) if (e.type === 'rule') last.set(`${e.rid}:${e.point}`, String(e.decision));
  const decisions = [...last.values()];
  const hand = events.filter((e) => e.type === 'handin' && e.tour !== 'short');
  return {
    goes: new Set(events.map((e) => e.rid)).size, cold: countCold(events), reviews, rulings: { accepted: decisions.filter((x) => x === 'accept').length, sentBack: decisions.filter((x) => x === 'back').length }, asked: events.filter((e) => e.type === 'ask').length,
    pace: bands(
      events.filter((e) => e.type === 'handin' && e.tour === 'full' && typeof e.linesPerMinute === 'number').map((e) => ({ v: Number(e.linesPerMinute), hit: !!e.caught })),
      [['under 5 lines a minute', 5], ['5 to 14', 15], ['15 or more', Infinity]],
    ),
    coldPace: bands(
      events.filter((e) => e.type === 'cold' && e.action !== 'skip' && typeof e.seconds === 'number').map((e) => ({ v: Number(e.seconds), hit: !!e.caught })),
      [['under 30 seconds', 30], ['30 seconds to 2 minutes', 120], ['over 2 minutes', Infinity]],
    ),
    planted: {
      tested: { met: hand.filter((e) => !e.untested).length, caught: hand.filter((e) => !e.untested && e.caught).length },
      untested: { met: hand.filter((e) => e.untested).length, caught: hand.filter((e) => e.untested && e.caught).length },
    },
    refused: events.filter((e) => e.type === 'rule-refused').length,
  };
}

export function numbers(events: ReadEvent[], d: { tour: Tour; evidence?: Evidence }): Numbers {
  const ours = oursOf(events);
  // a go that came in with the judge link is a judge's, whatever browser it used
  const invited = new Set(events.filter((e) => e.via === 'invite').map((e) => e.rid));
  const people = events.filter((e) => !ours.has(e.rid) && !invited.has(e.rid));
  const judges = events.filter((e) => invited.has(e.rid));
  const agents = events.filter((e) => ours.has(e.rid) && !invited.has(e.rid));

  // readers: a person is the `by` of their rows (rows from before it was written fall back to the go)
  const person = (e: ReadEvent) => String(e.by ?? e.rid);
  const names = new Map<string, string>();
  for (const e of people) if (e.type === 'sign' && typeof e.name === 'string') names.set(person(e), initials(String(e.login ?? e.name)));
  const met = new Map<string, boolean[]>();
  for (const e of people) {
    const hit = e.type === 'cold' && e.action !== 'skip' ? !!e.caught : e.type === 'handin' ? !!e.caught : null;
    if (hit === null) continue;
    const k = `${person(e)}\t${String(e.kind || 'other')}`;
    met.set(k, [...(met.get(k) ?? []), hit]);
  }
  let anon = 0;
  const label = new Map<string, string>();
  const readers: ReaderRow[] = [...met].map(([k, hits]) => {
    const [who, area] = k.split('\t') as [string, string];
    if (!label.has(who)) label.set(who, names.get(who) ?? `Reader ${++anon}`);
    return { reader: label.get(who)!, area, met: hits.length, caught: hits.filter(Boolean).length, missed: hits.filter((h) => !h).length, needsSecond: hits.length >= 2 && !hits.at(-1) && !hits.at(-2) };
  });

  const ev = d.evidence && d.evidence.headSha === d.tour.pr.headSha ? d.evidence : undefined;
  const linesOf = (s: Tour['stops'][number]) => s.blocks.reduce((a, b) => a + (b.type === 'code' ? b.to - b.from + 1 : 0), 0);
  const close = closeLines(d.tour, ev);
  const stops = ev
    ? d.tour.stops.flatMap((s) => {
        const e = ev.stops[s.id];
        return e ? [{ id: s.id, title: s.title, route: e.route, lines: linesOf(s), closely: close.get(s.id)?.size ?? 0, risk: e.risk, criteria: e.criteria, tried: e.changes.tried, caught: e.changes.caught, unnoticed: e.changes.survived.length, why: e.routeWhy }] : [];
      })
    : [];
  const rulingCount = (es: ReadEvent[], id: string) => {
    const last = new Map<string, string>();
    for (const e of es) if (e.type === 'rule' && e.point === id) last.set(e.rid, String(e.decision));
    const v = [...last.values()];
    return { accepted: v.filter((x) => x === 'accept').length, sentBack: v.filter((x) => x === 'back').length };
  };
  const byKind: Record<string, number> = {};
  for (const p of d.tour.plants) byKind[p.kind ?? 'other'] = (byKind[p.kind ?? 'other'] ?? 0) + 1;

  return {
    at: new Date().toISOString(),
    people: group(people),
    judges: group(judges),
    agents: group(agents),
    readers,
    route: ev
      ? {
          linesAll: d.tour.stops.reduce((a, s) => a + linesOf(s), 0),
          linesToRead: stops.reduce((a, s) => a + s.closely, 0),
          stopsToRead: stops.filter((s) => s.closely > 0).length,
          stops,
          tests: { passed: ev.tests.passed, failed: ev.tests.failed },
          tried: stops.reduce((a, s) => a + s.tried, 0),
          caught: stops.reduce((a, s) => a + s.caught, 0),
          unnoticed: stops.reduce((a, s) => a + s.unnoticed, 0),
        }
      : null,
    points: (ev?.rulings ?? []).map((r) => ({ id: r.id, kind: r.kind, stopId: r.stopId, file: r.file, from: r.from, to: r.to, found: r.found, question: r.question, people: rulingCount(people, r.id), judges: rulingCount(judges, r.id), agents: rulingCount(agents, r.id) })),
    planted: { total: d.tour.plants.length, byKind, untested: d.tour.plants.filter((p) => p.untested).length },
    rule: { maxWrong: RULE.maxWrong, maxReads: RULE.maxReads, fastLinesPerMinute: RULE.fastLinesPerMinute, paceLimit: ev ? RULE.closeLinesPerMinute : RULE.fastLinesPerMinute, lockSeconds: RULE.lockSeconds, maxFlags: 3 },
    pr: { repo: d.tour.pr.repo, number: d.tour.pr.number, title: d.tour.pr.title, url: d.tour.pr.url, headSha: d.tour.pr.headSha, additions: d.tour.pr.additions, deletions: d.tour.pr.deletions, files: d.tour.pr.files, ...(d.tour.pr.issue ? { issue: { number: d.tour.pr.issue.number, title: d.tour.pr.issue.title } } : {}) },
    criteria: ev?.criteria ?? [],
    madeBy: { plan: { model: d.tour.madeBy.model, plantModel: d.tour.madeBy.plantModel, costUsd: d.tour.madeBy.costUsd }, ...(ev ? { evidence: { model: ev.madeBy.model, costUsd: ev.madeBy.costUsd } } : {}) },
    stops: d.tour.stops.length,
    questions: d.tour.stops.filter((s) => (close.get(s.id)?.size ?? 0) > 0).reduce((a, s) => a + s.questions.length, 0),
  };
}
