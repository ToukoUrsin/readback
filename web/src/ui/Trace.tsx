/**
 * What a signature stands on, part by part: which acceptance criterion asked for the code, which tests fail when it breaks,
 * what was left to a person, and what the named reviewer decided there. Shown on the signed page, read from the same
 * tour and state as the rest of the review: nothing is written in.
 */
import type { PublicTour, Ruling } from '../../../shared/tour';
import { Check, X } from './icons';

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/** "invoices.ts:372, 380 · share.ts:25" */
const where = (at: { file: string; line: number }[]) => {
  const by = new Map<string, number[]>();
  for (const x of at) by.set(x.file.split('/').pop()!, [...(by.get(x.file.split('/').pop()!) ?? []), x.line]);
  return [...by].map(([f, ls]) => `${f}:${[...new Set(ls)].sort((a, b) => a - b).join(', ')}`).join(' · ');
};

export function Trace({ tour, name }: { tour: PublicTour; name: string }) {
  const ev = tour.evidence;
  if (!ev || !tour.stops.some((s) => s.evidence)) return null;
  const rulings: Record<string, Ruling> = tour.state.signature?.rulings ?? tour.state.rulings ?? {};
  const answers = tour.state.answers;
  const criterion = (k: number) => ev.criteria.find((c) => c.n === k)?.text ?? '';
  return (
    <div className="mt-5">
      <p className="mb-1 text-[13px] font-[590] text-fg">The trace this signature stands on</p>
      <p className="mb-2 max-w-[660px] text-[12.5px] leading-[1.55] text-fg3">Each part of the change: who asked for it, which tests fail when it breaks, what was left to a person, and what {name} decided there.</p>
      <div className="card divide-y divide-line">
        {tour.stops.map((st) => {
          const e = st.evidence;
          if (!e) return null;
          const points = ev.rulings.filter((r) => r.stopId === st.id);
          const right = st.questions.filter((q) => answers[q.id]?.right).length;
          return (
            <div key={st.id} className="px-4 py-3 text-[12.5px] leading-[1.55] lg:grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1.25fr)] lg:gap-x-5">
              <div className="min-w-0">
                <p className="text-[13px] font-[590] text-fg">{st.title}</p>
                <p className="mt-0.5 text-fg3">
                  {e.criteria.length ? (
                    <>
                      Asked for by {e.criteria.length === 1 ? 'criterion' : 'criteria'}{' '}
                      {e.criteria.map((k, i) => (
                        <span key={k}>
                          {i ? ', ' : ''}
                          <span title={criterion(k)} className="cursor-help underline decoration-line-strong decoration-dotted underline-offset-2">
                            {k}
                          </span>
                        </span>
                      ))}
                    </>
                  ) : (
                    <span className="text-warn">No criterion asks for it</span>
                  )}
                  {e.risk.length ? ` · can harm ${e.risk.join(', ')}` : ''}
                </p>
              </div>
              <div className="mt-1.5 min-w-0 text-fg2 lg:mt-0">
                <p>
                  {n(e.tests.length, 'test')} {e.tests.length === 1 ? 'fails' : 'fail'} when it breaks
                  {e.changes.tried ? `; ${e.changes.caught} of ${e.changes.tried} one-line bugs tried here were noticed` : ''}
                </p>
                <p className="text-fg3">
                  {st.required
                    ? `Left to a person: ${n(st.closely, 'line')} to read closely${e.changes.survived.length ? `, ${e.changes.survived.length} of them where no test notices a bug (${where(e.changes.survived)})` : ''}`
                    : 'Carried by the tests: nothing here had to be read closely'}
                </p>
              </div>
              <div className="mt-1.5 min-w-0 lg:mt-0">
                {st.required ? (
                  <p className="text-fg2">
                    {st.questions.length ? `${right} of ${n(st.questions.length, 'question')} answered right` : 'No question here'}
                    {!points.length && ' · no open point'}
                  </p>
                ) : (
                  <p className="text-fg3">Shown, not signed for line by line</p>
                )}
                {points.map((p) => {
                  const r = rulings[p.id];
                  return (
                    <p key={p.id} className="mt-0.5 flex items-start gap-1.5 text-fg2">
                      {r?.decision === 'back' ? <X size={11} className="mt-[4px] flex-none text-flag" /> : <Check size={12} className="mt-[3px] flex-none text-ok" />}
                      <span className="min-w-0 [overflow-wrap:anywhere]">
                        <span className="font-mono text-[11.5px] text-fg3">
                          {p.file.split('/').pop()}:{p.from}
                          {p.to > p.from ? `–${p.to}` : ''}
                        </span>{' '}
                        {r ? (r.decision === 'back' ? 'sent back' : 'accepted') : 'not ruled on'}
                        {r?.note ? `: ${r.note}` : ''}
                      </span>
                    </p>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
