/**
 * bun gen/short.ts --plan <plan.json> --log <gen.log.jsonl> --candidates <steps/plants-1.json> --stops a,b --out <plan.json> [--edits <edits.json>]
 *
 * A short read: some stops of a finished plan, for someone with five minutes. No model here.
 * Its planted lines are the proven ones (from the generator's log) that sit in those stops and outside every reread range.
 * --edits is a list of { find, replace } for sentences that point at a stop the short read does not have.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Plan, Plant } from '../shared/tour';

const args = Object.fromEntries(process.argv.slice(2).reduce<[string, string][]>((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1] ?? '']] : a), []));
if (!args.plan || !args.log || !args.candidates || !args.stops || !args.out) {
  console.error('usage: bun gen/short.ts --plan <plan.json> --log <gen.log.jsonl> --candidates <plants-1.json> --stops a,b --out <plan.json> [--edits <edits.json>]');
  process.exit(2);
}
const plan = JSON.parse(readFileSync(resolve(args.plan), 'utf8')) as Plan;
const ids = args.stops.split(',');
let stops = ids.map((id) => {
  const s = plan.stops.find((x) => x.id === id);
  if (!s) throw new Error(`no stop ${id}`);
  return s;
});
if (args.edits) {
  let text = JSON.stringify(stops);
  for (const e of JSON.parse(readFileSync(resolve(args.edits), 'utf8')) as { find: string; replace: string }[]) {
    const find = JSON.stringify(e.find).slice(1, -1);
    if (!text.includes(find)) throw new Error(`edit not found: ${e.find}`);
    text = text.replace(find, JSON.stringify(e.replace).slice(1, -1));
  }
  stops = JSON.parse(text);
}

const log = readFileSync(resolve(args.log), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { step: string; proven?: { at: string; original: string; planted: string; failedTests: string[] }[] });
const proven = log.filter((l) => l.step === 'plants-verify').flatMap((l) => l.proven ?? []);
const found = (function walk(x: unknown): { file: string; line: number; original: string; planted: string; what: string }[] {
  if (Array.isArray(x)) return x.flatMap(walk);
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    if (typeof o.file === 'string' && typeof o.line === 'number' && typeof o.planted === 'string' && typeof o.what === 'string') return [o as never];
    return Object.values(o).flatMap(walk);
  }
  if (typeof x === 'string' && x.trimStart().startsWith('{')) {
    try {
      return walk(JSON.parse(x));
    } catch {
      return [];
    }
  }
  return [];
})(JSON.parse(readFileSync(resolve(args.candidates), 'utf8')));

const inStops = (file: string, line: number) => stops.some((s) => s.blocks.some((b) => b.type === 'code' && b.file === file && b.from <= line && line <= b.to));
const inReread = (file: string, line: number) => stops.some((s) => s.questions.some((q) => q.reread.file === file && q.reread.from <= line && line <= q.reread.to));
const plants: Plant[] = [];
for (const p of proven) {
  const [file, n] = [p.at.slice(0, p.at.lastIndexOf(':')), Number(p.at.slice(p.at.lastIndexOf(':') + 1))];
  if (!inStops(file!, n) || inReread(file!, n)) continue;
  const c = found.find((x) => x.file === file && x.line === n && x.planted === p.planted);
  if (!c) throw new Error(`no description for the proven plant at ${p.at}`);
  plants.push({ id: `plant-${plants.length + 1}`, file: file!, line: n, original: p.original, planted: p.planted, what: c.what, failedTests: p.failedTests });
}
if (!plants.length) throw new Error('no proven plant sits in these stops');

const out: Plan = { ...plan, stops, plants, short: { stops: stops.length, of: plan.stops.length } };
mkdirSync(dirname(resolve(args.out)), { recursive: true });
writeFileSync(resolve(args.out), JSON.stringify(out, null, 1));
console.log(`${args.out}: ${stops.length} of ${plan.stops.length} stops, ${stops.reduce((a, s) => a + s.questions.length, 0)} questions, ${plants.length} planted lines: ${plants.map((p) => `${p.file}:${p.line}`).join(', ')}`);
