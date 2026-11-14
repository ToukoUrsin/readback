/**
 * What Readback does on Entire. The pull request is also a trail there (https://entire.com), and two gates block its merge:
 * every finding has to be resolved, and a reviewer has to approve. The findings are the open points of the review, and the
 * reviewer is Readback's own service account. So the trail can only merge when a person has ruled on every open point and
 * the rule in server/gate.ts approved their signature: the same record that sets the commit status on GitHub.
 *
 *   approved    the accepted points are resolved with the reviewer's reason, the trail is approved with the status text
 *   sent back   accepted points are resolved, the others get the reviewer's words as a reply, and changes are requested
 *   taken back  every finding is opened again and changes are requested: nobody has read this commit
 *
 * What a reviewer ruled is also kept in the repository's Brain (`entire brain remember`), where the next agent session
 * that works on this code is given it. A ruling of a signature that is taken back is retracted there.
 *
 * Runs next to the watcher on the team's machine, as the service account (its token never leaves the vault).
 */
import type { Entire, Ruling, RulingItem } from '../shared/tour';

const REPO = process.env.RB_ENTIRE_REPO ?? '/bulk3/runs/readback/entire/kuitti';
const PATH = `${process.env.HOME}/.local/bin:${process.env.PATH}`;

async function run(cmd: string[], timeoutMs = 60_000): Promise<{ code: number; out: string; err: string }> {
  const p = Bun.spawn(cmd, { cwd: REPO, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore', env: { ...process.env, PATH } });
  const timer = setTimeout(() => p.kill(), timeoutMs);
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  clearTimeout(timer);
  return { code, out, err };
}
/** `entire …` as the service account `readback`, a writer on the repository and not the author of the trail. The trail is the one of the clone's branch */
const asReadback = (args: string[]) => run(['hsec', 'exec', '--only', 'READBACK_ENTIRE_TOKEN', '--', 'bash', '-c', 'ENTIRE_TOKEN="$READBACK_ENTIRE_TOKEN" exec entire "$@"', '--', ...args]);
const must = async (args: string[]) => {
  const r = await asReadback(args);
  if (r.code !== 0) throw new Error(`entire ${args.slice(0, 3).join(' ')}: ${(r.err || r.out).trim().split('\n').at(-1)?.slice(0, 160)}`);
  return r.out;
};
const requestChanges = (trail: number, body: string) => must(['api', '--jurisdiction', 'us', '-X', 'POST', `/api/v1/repos/{repo_id}/trails/${trail}/approvals`, '-f', 'event=request_changes', '-f', `body=${body}`]);

/** a reply under a finding. The service account may resolve and reopen findings but not write under them, so the reply is posted with the team's own login */
const reply = async (finding: string, body: string) => {
  const r = await run(['entire', 'trail', 'finding', 'reply', finding, '-m', body]);
  if (r.code !== 0) throw new Error(`entire trail finding reply: ${(r.err || r.out).trim().split('\n').at(-1)?.slice(0, 160)}`);
};

export interface Carried {
  ok: boolean;
  note: string;
  /** ids of the memories written to the Brain for this signature */
  memories: string[];
}

export async function carry(x: { trail: NonNullable<Entire['trail']>; headSha: string; who: string; outcome: 'approved' | 'sent-back'; description: string; rulings: Record<string, Ruling>; items: RulingItem[]; remember: boolean }): Promise<Carried> {
  const { trail } = x;
  const memories: string[] = [];
  try {
    const mine = x.items.filter((i) => trail.findings[i.id] && x.rulings[i.id]);
    await Promise.all(
      mine.map((i) => {
        const r = x.rulings[i.id]!;
        return r.decision === 'accept'
          ? must(['trail', 'finding', 'resolve', trail.findings[i.id]!, '-m', `Accepted by ${x.who} in Readback${r.note ? `: ${r.note}` : ', no reason given'}`])
          : reply(trail.findings[i.id]!, `Sent back by ${x.who} in Readback: ${r.note}`);
      }),
    );
    if (x.outcome === 'approved') await must(['trail', 'approve', '-m', x.description]);
    else await requestChanges(trail.number, x.description);
    if (x.remember)
      for (const i of mine) {
        const r = x.rulings[i.id]!;
        if (!r.note) continue;
        const text = `Review ruling on ${i.file}:${i.from}${i.to > i.from ? `-${i.to}` : ''} at commit ${x.headSha.slice(0, 7)}. ${i.found} The reviewer (${x.who}) ${r.decision === 'accept' ? 'accepted it as it is' : 'sent it back'}: ${r.note}`;
        const m = await run(['entire', 'brain', 'remember', text, '--kind', 'decision', '--path', 'constraints.review.rulings', '--agent', 'none', '--json']);
        const id = m.code === 0 ? ((JSON.parse(m.out) as { id?: string; memory?: { id?: string } }).id ?? (JSON.parse(m.out) as { memory?: { id?: string } }).memory?.id) : undefined;
        if (id) memories.push(id);
      }
    const back = mine.filter((i) => x.rulings[i.id]!.decision === 'back').length;
    return { ok: true, memories, note: x.outcome === 'approved' ? `Trail #${trail.number} approved, ${mine.length - back} findings resolved: it can merge.` : `Trail #${trail.number}: changes requested, ${back} ${back === 1 ? 'finding' : 'findings'} answered and left open.` };
  } catch (e) {
    return { ok: false, memories, note: (e as Error).message.slice(0, 200) };
  }
}

/** Back to "nobody has read this commit": every finding open, changes requested, the rulings of that signature out of the Brain. */
export async function takeBack(x: { trail: NonNullable<Entire['trail']>; why: string; memories?: string[] }): Promise<Carried> {
  try {
    // opening a finding that is open already is an error of no interest
    await Promise.all(Object.values(x.trail.findings).map((id) => asReadback(['trail', 'finding', 'reopen', id, '-m', x.why])));
    await requestChanges(x.trail.number, x.why);
    for (const id of x.memories ?? []) await run(['entire', 'brain', 'memories', 'retract', id]);
    return { ok: true, memories: [], note: `Trail #${x.trail.number} is blocked again.` };
  } catch (e) {
    return { ok: false, memories: [], note: (e as Error).message.slice(0, 200) };
  }
}

/** The two gates of the trail as Entire reports them now. */
export async function gates(trail: number): Promise<{ key: string; status: string; why: string }[]> {
  const r = await asReadback(['api', '--jurisdiction', 'us', `/api/v1/repos/{repo_id}/trails/${trail}/gates`]);
  if (r.code !== 0) throw new Error((r.err || r.out).trim().slice(0, 160));
  return (JSON.parse(r.out) as { gates: { gate_key: string; status: string; rationale: string }[] }).gates.map((g) => ({ key: g.gate_key, status: g.status, why: g.rationale }));
}
