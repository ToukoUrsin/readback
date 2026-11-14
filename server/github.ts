/**
 * What Readback does on GitHub: a commit status that says a named person read the change (readback/read),
 * and one with the result of the project's own tests, run offline in Docker (readback/tests, deploy/test-status.ts).
 */

/** The only repository Readback may write a status to. */
const STATUS_REPOS = ['toukoursin/junction26-kuitti'];

export async function setStatus(s: { repo: string; sha: string; description: string; targetUrl: string; state?: 'success' | 'pending' | 'failure'; context?: 'readback/read' | 'readback/tests' }): Promise<void> {
  if (!STATUS_REPOS.includes(s.repo.toLowerCase())) throw new Error(`Readback may not write to ${s.repo}.`);
  if (!/^[0-9a-f]{40}$/.test(s.sha)) throw new Error('The commit is not a full commit id.');
  const p = Bun.spawn(['gh', 'api', '-X', 'POST', `repos/${s.repo}/statuses/${s.sha}`, '-f', `state=${s.state ?? 'success'}`, '-f', `context=${s.context ?? 'readback/read'}`, '-f', `description=${s.description.slice(0, 140)}`, '-f', `target_url=${s.targetUrl}`], { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
  const [err, code] = await Promise.all([new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(err.trim().split('\n')[0] || `gh exited with ${code}`);
}

/** One comment on the pull request holds the record of the review that stands; it is found by its first line and rewritten in place. */
export async function setRecord(x: { repo: string; pr: number; body: string; mark: string }): Promise<'written' | 'rewritten'> {
  if (!STATUS_REPOS.includes(x.repo.toLowerCase())) throw new Error(`Readback may not write to ${x.repo}.`);
  const gh = async (args: string[], input?: string) => {
    const p = Bun.spawn(['gh', 'api', ...args], { stdout: 'pipe', stderr: 'pipe', stdin: input === undefined ? 'ignore' : new Blob([input]) });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    if (code !== 0) throw new Error(err.trim().split('\n')[0] || `gh exited with ${code}`);
    return out;
  };
  const found = (await gh([`repos/${x.repo}/issues/${x.pr}/comments`, '--paginate', '-q', `.[] | select(.body | startswith(${JSON.stringify(x.mark)})) | .id`])).trim().split('\n').filter(Boolean);
  const body = JSON.stringify({ body: x.body.slice(0, 60_000) });
  if (found.length) {
    await gh(['-X', 'PATCH', `repos/${x.repo}/issues/comments/${found[found.length - 1]}`, '--input', '-'], body);
    return 'rewritten';
  }
  await gh(['-X', 'POST', `repos/${x.repo}/issues/${x.pr}/comments`, '--input', '-'], body);
  return 'written';
}
