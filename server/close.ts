/**
 * The lines of each stop a person has to read closely, as "file:line". With evidence these are the lines marked for
 * what they can harm, the lines where a tried bug went unnoticed by the tests, and the lines of an open point.
 * The rest of the stop is shown as context. Without evidence every line has to be read.
 */
import type { Evidence, Tour } from '../shared/tour';

export function closeLines(tour: Tour, ev: Evidence | undefined): Map<string, Set<string>> {
  const rulings = (ev?.rulings ?? []).filter((r) => tour.stops.some((s) => s.id === r.stopId));
  const of = (st: Tour['stops'][number]): Set<string> => {
    const out = new Set<string>();
    const add = (file: string, from: number, to: number) => {
      for (const b of st.blocks) if (b.type === 'code' && b.file === file) for (let n = Math.max(from, b.from); n <= Math.min(to, b.to); n++) out.add(`${file}:${n}`);
    };
    for (const b of st.blocks) {
      if (b.type !== 'code') continue;
      if (!ev) add(b.file, b.from, b.to);
      for (const f of b.focus ?? []) add(b.file, f.from, f.to);
    }
    for (const x of ev?.stops[st.id]?.changes.survived ?? []) add(x.file, x.line, x.line);
    for (const r of rulings) if (r.stopId === st.id) add(r.file, r.from, r.to);
    return out;
  };
  return new Map(tour.stops.map((s) => [s.id, of(s)] as const));
}
