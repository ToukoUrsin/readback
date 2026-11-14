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
