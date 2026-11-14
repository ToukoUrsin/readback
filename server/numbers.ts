/**
 * GET /api/numbers: what this copy has measured, for the page at /numbers. Counts only, no names.
 *
 * People and agents are counted the same way and kept apart: `people` are browsers that are not ours,
 * `agents` are our own agents' browsers, our test browsers and scripts. Only `people` may be quoted as results.
 */
import type { Evidence, Tour } from '../shared/tour';
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
  agents: Group;
  /** per reader and area, people only; empty until people have reviewed */
  readers: ReaderRow[];
  /** what the evidence routes to a person; null without evidence */
  route: {
    linesAll: number;
    linesToRead: number;
    stops: { id: string; title: string; route: 'read' | 'evidence'; lines: number; criteria: number[]; tried: number; caught: number; unnoticed: number; why: string[] }[];
    tests: { passed: number; failed: number };
    tried: number;
    caught: number;
    unnoticed: number;
  } | null;
  /** each thing the AI did not decide, and what reviewers ruled */
  points: { id: string; kind: string; stopId: string; found: string; question: string; people: { accepted: number; sentBack: number }; agents: { accepted: number; sentBack: number } }[];
  planted: { total: number; byKind: Record<string, number> };
  rule: { maxWrong: number; maxReads: number; fastLinesPerMinute: number };
}

const initials = (name: string) => {
  const w = name.replace(/^@/, '').split(/[\s._-]+/).filter(Boolean);
  return (w.length > 1 ? w.map((x) => x[0]).join('') : (w[0] ?? '').slice(0, 2)).slice(0, 3).toUpperCase();
};

function group(events: ReadEvent[]): Group {
  const reviews: Record<string, Counts> = {};
  for (const t of new Set(events.map((e) => e.tour))) reviews[t] = count(events.filter((e) => e.tour === t));
  // the last ruling on a point in a go is the one that stands
  const last = new Map<string, string>();
  for (const e of events) if (e.type === 'rule') last.set(`${e.rid}:${e.point}`, String(e.decision));
  const decisions = [...last.values()];
  return { goes: new Set(events.map((e) => e.rid)).size, cold: countCold(events), reviews, rulings: { accepted: decisions.filter((x) => x === 'accept').length, sentBack: decisions.filter((x) => x === 'back').length }, asked: events.filter((e) => e.type === 'ask').length };
}

export function numbers(events: ReadEvent[], d: { tour: Tour; evidence?: Evidence }): Numbers {
  const ours = oursOf(events);
  const people = events.filter((e) => !ours.has(e.rid));
  const agents = events.filter((e) => ours.has(e.rid));

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
  const stops = ev
    ? d.tour.stops.flatMap((s) => {
        const e = ev.stops[s.id];
        return e ? [{ id: s.id, title: s.title, route: e.route, lines: linesOf(s), criteria: e.criteria, tried: e.changes.tried, caught: e.changes.caught, unnoticed: e.changes.survived.length, why: e.routeWhy }] : [];
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
    agents: group(agents),
    readers,
    route: ev
      ? {
          linesAll: stops.reduce((a, s) => a + s.lines, 0),
          linesToRead: stops.filter((s) => s.route === 'read').reduce((a, s) => a + s.lines, 0),
          stops,
          tests: { passed: ev.tests.passed, failed: ev.tests.failed },
          tried: stops.reduce((a, s) => a + s.tried, 0),
          caught: stops.reduce((a, s) => a + s.caught, 0),
          unnoticed: stops.reduce((a, s) => a + s.unnoticed, 0),
        }
      : null,
    points: (ev?.rulings ?? []).map((r) => ({ id: r.id, kind: r.kind, stopId: r.stopId, found: r.found, question: r.question, people: rulingCount(people, r.id), agents: rulingCount(agents, r.id) })),
    planted: { total: d.tour.plants.length, byKind },
    rule: { maxWrong: RULE.maxWrong, maxReads: RULE.maxReads, fastLinesPerMinute: RULE.fastLinesPerMinute },
  };
}
