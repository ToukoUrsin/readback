/**
 * What a signature stands on, part by part: which acceptance criterion asked for the code, which tests fail when it breaks,
 * what was left to a person, and what the named reviewer decided there. Shown on the signed page, read from the same
 * tour and state as the rest of the review: nothing is written in.
 */
import type { PublicTour, Ruling } from '../../../shared/tour';

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/** "invoices.ts:372, 380 · share.ts:25": the dot stays with the file before it when the list wraps */
const where = (at: { file: string; line: number }[]) => {
  const by = new Map<string, number[]>();
  for (const x of at) by.set(x.file.split('/').pop()!, [...(by.get(x.file.split('/').pop()!) ?? []), x.line]);
  return [...by].map(([f, ls]) => `${f}:${[...new Set(ls)].sort((a, b) => a - b).join(', ')}`).join('\u00a0· ');
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
      <p className="mb-2 max-w-[660px] text-[12.5px] leading-[1.55] text-fg3">Each part of the change: who asked for it, which tests fail when it breaks, what was left to a person, and what {name} decided there.{ev.changes?.held ? ` During the read the stops counted ${ev.changes.held} fewer tried ${ev.changes.held === 1 ? 'bug' : 'bugs'}: one on a line that can be the planted one is shown only after the planted bug is caught.` : ''}</p>
      <div className="card divide-y divide-line">
        {tour.stops.map((st) => {
          const e = st.evidence;
          if (!e) return null;
          const points = ev.rulings.filter((r) => r.stopId === st.id);
          const right = st.questions.filter((q) => answers[q.id]?.right).length;
          return (
            <div key={st.id} className="px-4 py-3">
              <p className="text-[13px] leading-[1.45] font-[590] text-fg">{st.title}</p>
              {/* one label per question the trace answers, the same four under every part: the eye runs down a column, not through three paragraphs */}
              <dl className="mt-1.5 grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12.5px] leading-[1.5] sm:grid-cols-[116px_minmax(0,1fr)] sm:gap-x-4">
                <dt className="text-fg3">Asked for by</dt>
                <dd className="text-fg2">
                  {e.criteria.length ? (
                    <>
                      {e.criteria.length === 1 ? 'Criterion' : 'Criteria'}{' '}
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
                  {e.risk.length ? <span className="text-fg3"> · can harm {e.risk.join(', ')}</span> : null}
                </dd>
                <dt className="text-fg3">Tests</dt>
                <dd className="text-fg2">
                  {n(e.tests.length, 'test')} {e.tests.length === 1 ? 'fails' : 'fail'} when it breaks
                  {e.changes.tried ? `; ${e.changes.caught} of ${e.changes.tried} one-line bugs tried here were noticed` : ''}
                </dd>
                <dt className="text-fg3">Left to a person</dt>
                {st.required ? (
                  <dd className="text-fg2">
                    {n(st.closely, 'line')} to read closely
                    {e.changes.survived.length ? (
                      <>
                        , {e.changes.survived.length} of them where no test notices a bug <span className="font-mono text-[11.5px] text-fg3 [overflow-wrap:anywhere]">{where(e.changes.survived)}</span>
                      </>
                    ) : null}
                  </dd>
                ) : (
                  <dd className="text-fg3">{e.tests.length ? 'Carried by the tests: nothing here had to be read closely' : 'Nothing here had to be read closely'}</dd>
                )}
                <dt className="text-fg3">Decided</dt>
                {st.required ? (
                  <dd className="min-w-0 text-fg2">
                    {st.questions.length ? `${right} of ${n(st.questions.length, 'question')} answered right` : 'No question here'}
                    {!points.length && <span className="text-fg3"> · no open point</span>}
                    {points.map((p) => {
                      const r = rulings[p.id];
                      return (
                        <span key={p.id} className="mt-1 block [overflow-wrap:anywhere]">
                          <span className={`font-[510] ${r ? (r.decision === 'back' ? 'text-flag' : 'text-ok') : 'text-fg3'}`}>{r ? (r.decision === 'back' ? 'Sent back' : 'Accepted') : 'Not ruled on'}</span>{' '}
                          <span className="font-mono text-[11.5px] text-fg3">
                            {p.file.split('/').pop()}:{p.from}
                            {p.to > p.from ? `–${p.to}` : ''}
                          </span>
                          {r?.note ? <span className="block">{r.note}</span> : null}
                        </span>
                      );
                    })}
                  </dd>
                ) : (
                  <dd className="text-fg3">Shown, not signed for line by line</dd>
                )}
              </dl>
            </div>
          );
        })}
      </div>
    </div>
  );
}
