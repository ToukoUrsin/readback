/**
 * bun deploy/send-back.ts --row <file with one sign row of reads.jsonl> [--evidence data/live/evidence.json] [--tour data/live/tour.json] [--dry]
 *
 * A review that was sent back becomes an issue on the repository: its acceptance criteria are the reviewer's own words
 * for each point sent back, so the author's next commit is checked against them like any other change (gen/evidence.ts).
 * Prints the issue number. Nothing is written by a model here.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Evidence, Ruling, Tour } from '../shared/tour';

const argv = process.argv.slice(2);
const args: Record<string, string> = {};
for (let i = 0; i < argv.length; i++) if (argv[i]!.startsWith('--')) args[argv[i]!.slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? '1' : argv[++i]!;
if (!args.row) {
  console.error('usage: bun deploy/send-back.ts --row <sign row> [--evidence <file>] [--tour <file>] [--dry]');
  process.exit(2);
}
const ROOT = resolve(import.meta.dir, '..');
const row = JSON.parse(readFileSync(resolve(args.row), 'utf8')) as { at: string; who?: string; name?: string; headSha: string; outcome?: string; rulings?: Record<string, Ruling>; checks?: { ok: boolean; text: string }[] };
const evidence = JSON.parse(readFileSync(resolve(ROOT, args.evidence ?? 'data/live/evidence.json'), 'utf8')) as Evidence;
const tour = JSON.parse(readFileSync(resolve(ROOT, args.tour ?? 'data/live/tour.json'), 'utf8')) as Tour;
if (row.outcome !== 'sent-back') throw new Error(`this signature is "${row.outcome}", not sent back`);
if (row.headSha !== tour.pr.headSha) throw new Error('the signature is of another commit than the tour');

const back = evidence.rulings.filter((it) => row.rulings?.[it.id]?.decision === 'back');
const kept = evidence.rulings.filter((it) => row.rulings?.[it.id]?.decision === 'accept');
if (!back.length) throw new Error('no point was sent back');
const where = (it: { file: string; from: number; to: number }) => `\`${it.file}:${it.from}${it.to > it.from ? `-${it.to}` : ''}\``;
const one = (s: string) => s.replace(/\s+/g, ' ').trim();
const title = `Review of #${tour.pr.number} sent back: ${back.length} ${back.length === 1 ? 'point' : 'points'} for the author`;
const body = [
  `Readback wrote this issue from a review of #${tour.pr.number} that was sent back.`,
  '',
  `Reviewer: ${row.who ?? row.name}, ${row.at.slice(0, 16).replace('T', ' ')} UTC, commit ${row.headSha.slice(0, 7)}.`,
  ...(row.checks ?? []).filter((c) => c.ok).map((c) => `- ${c.text}`),
  '',
  '## Acceptance criteria',
  ...back.map((it, i) => `${i + 1}. ${where(it)}: ${one(row.rulings![it.id]!.note)}`),
  '',
  '## What the AI had left open at these lines',
  ...back.map((it, i) => `${i + 1}. ${one(it.found)}`),
  '',
  `## Accepted as they are (${kept.length})`,
  ...kept.map((it) => `- ${where(it)}: ${one(row.rulings![it.id]!.note)}`),
  '',
  'The same rulings are in Entire Brain and on the trail of the pull request, where the author agent reads them.',
].join('\n');

if (args.dry) {
  console.log(title + '\n\n' + body);
  process.exit(0);
}
const p = Bun.spawn(['gh', 'issue', 'create', '--repo', tour.pr.repo, '--title', title, '--body', body], { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
if (code !== 0) throw new Error(`gh issue create: ${err.trim().slice(0, 300)}`);
console.log(out.trim());
