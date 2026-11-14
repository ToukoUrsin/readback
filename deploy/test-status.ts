/**
 * Runs the project's own tests on the pull request's head commit, in Docker with no network (the same
 * sandbox the generator proves planted lines in), and writes the result to GitHub as the commit status
 * readback/tests. The example repository's own CI cannot run: GitHub Actions is locked on the account.
 *
 *   bun deploy/test-status.ts [--repo /bulk3/runs/readback/kuitti-live] [--tour data/live/tour.json]
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { prepareSandbox, runTests } from '../gen/lib/sandbox';
import { exec } from '../gen/lib/util';
import { setStatus } from '../server/github';
import type { Tour } from '../shared/tour';

const arg = (k: string, d: string) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1]! : d);
const repo = resolve(arg('repo', '/bulk3/runs/readback/kuitti-live'));
const tour = (await Bun.file(arg('tour', 'data/live/tour.json')).json()) as Tour;
const sha = tour.pr.headSha;
const work = arg('work', '/bulk3/runs/readback/test-status');
const headDir = mkdtempSync(join(tmpdir(), 'rb-head-'));
try {
  // the files of the head commit, without the .git folder
  await exec('sh', ['-c', `git -C "$1" archive "$2" | tar -x -C "$3"`, 'sh', repo, sha, headDir], { check: true });
  const sb = await prepareSandbox({ repo, headDir, workDir: work, image: 'oven/bun:1', testCmd: ['bun', 'test'] });
  const run = await runTests(sb, 'status');
  const ok = run.code === 0 && run.failed.length === 0 && run.passed.length > 0;
  const description = ok ? `bun test: ${run.passed.length} pass, 0 fail. Run offline in Docker by Readback.` : `bun test: ${run.passed.length} pass, ${run.failed.length} fail (exit ${run.code}). Run offline in Docker by Readback.`;
  console.log(description, `${run.ms} ms`, `packages: ${sb.installed}`);
  if (!ok) console.log(run.tail);
  await setStatus({ repo: tour.pr.repo, sha, description, targetUrl: tour.pr.url, state: ok ? 'success' : 'failure', context: 'readback/tests' });
  console.log(`readback/tests on ${sha.slice(0, 7)}: ${ok ? 'success' : 'failure'}`);
} finally {
  rmSync(headDir, { recursive: true, force: true });
}
