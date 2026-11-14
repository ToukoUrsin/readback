/**
 * The record of a review, written on the pull request itself: one comment, kept up to date by the watcher
 * (deploy/watch-github.ts). It says who read the commit and what the rule made of it, and lists each part of the
 * change with what asked for it, which tests fail when it breaks, what was left to a person and what that person
 * decided there. Everything in it is read from the tour, the evidence and the signature's own row.
 *
 * Left out on purpose: which lines no test notices (a later reviewer may hold one of them as a planted line) and
 * the planted line itself.
 */
import type { Evidence, Ruling, Tour } from '../shared/tour';
import { closeLines } from './close';

export const RECORD_MARK = '<!-- readback/record -->';

export interface Signed {
  who: string;
  at: string;
  outcome: 'approved' | 'sent-back';
  /** the text of the commit status */
  description: string;
  seconds?: number;
  rulings: Record<string, Ruling>;
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n+\s*/g, ' ').trim();
const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
const when = (at: string) => new Date(at).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const took = (s?: number) => (s ? ` · ${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : '');
const base = (f: string) => f.split('/').pop()!;

export function recordOf(x: { tour: Tour; evidence?: Evidence; signed: Signed; url: string; read: string }): string {
  const { tour, signed: g } = x;
  const ev = x.evidence && x.evidence.headSha === tour.pr.headSha ? x.evidence : undefined;
  const sha = tour.pr.headSha.slice(0, 7);
  const close = closeLines(tour, ev);
  const head = g.outcome === 'approved' ? `read and approved by ${g.who}` : `sent back by ${g.who}`;
  const out = [RECORD_MARK, `### Readback: ${head}`, '', `Commit \`${sha}\` · signed ${when(g.at)}${took(g.seconds)} · [the review](${x.url})`, '', `> ${cell(g.description)}`, ''];
  if (ev) {
    out.push('| Part of the change | Asked for by | Tests that fail when it breaks | One-line bugs tried | Left to a person | Decided by the reviewer |', '| --- | --- | --- | --- | --- | --- |');
    for (const st of tour.stops) {
      const e = ev.stops[st.id];
      if (!e) continue;
      const lines = close.get(st.id)?.size ?? 0;
      const points = ev.rulings.filter((r) => r.stopId === st.id);
      const decided = points.length
        ? points
            .map((p) => {
              const r = g.rulings[p.id];
              const at = `\`${base(p.file)}:${p.from}${p.to > p.from ? `–${p.to}` : ''}\``;
              return `${at} ${r ? (r.decision === 'back' ? '**sent back**' : 'accepted') : 'not ruled on'}${r?.note ? `: ${cell(r.note)}` : ''}`;
            })
            .join('<br>')
        : lines
          ? 'no open point'
          : 'shown, not signed for line by line';
      out.push(
        `| ${cell(st.title)} | ${e.criteria.length ? `${e.criteria.length === 1 ? 'criterion' : 'criteria'} ${e.criteria.join(', ')}` : 'no criterion'} | ${e.tests.length} | ${e.changes.tried ? `${e.changes.caught} of ${e.changes.tried} noticed` : 'none tried'} | ${lines ? `${n(lines, 'line')} read closely${e.changes.survived.length ? `, ${e.changes.survived.length} where no test notices a bug` : ''}` : 'nothing to read closely'} | ${decided} |`,
      );
    }
    out.push('', '<details><summary>The acceptance criteria of the issue</summary>', '', ...ev.criteria.map((c) => `${c.n}. ${c.text}`), '', '</details>', '');
  }
  out.push(`Written by Readback when the signature was made. The status \`readback/read\` on this commit follows the same record. A new commit needs ${x.read}.`);
  return out.join('\n');
}

/** the comment once nothing stands on the commit: the reasons of the last reviewer are not left for the next one */
export function recordGone(x: { tour: Tour; url: string; read: string; why: string; last?: { who: string; at: string; outcome?: string } }): string {
  const sha = x.tour.pr.headSha.slice(0, 7);
  const last = x.last ? `The last review that counted: ${x.last.who}, ${x.last.outcome === 'sent-back' ? 'sent back' : 'approved'}, signed ${when(x.last.at)}. ${x.why}` : x.why;
  return [RECORD_MARK, '### Readback: nobody has read this commit', '', `Commit \`${sha}\` needs ${x.read}: [start the review](${x.url}). Merging is blocked by \`readback/read\` until a named person has shown they read it.`, '', last].join('\n');
}
