/**
 * bun gen/short.ts --plan <plan.json> --stops a,b --out <plan.json>
 *   [--edits <edits.json>]                       sentences that point at a stop the short read does not have: [{ find, replace }]
 *   [--blocks "stop=2,3,0,1;other=0,1,2"]        which blocks of a stop to keep, in this order (indexes into the stop's blocks)
 *   [--cold "src/a.ts:254-301,src/b.ts:10-20"]   the cold test: these lines as a plain diff, before the read
 *   [--cold-plants id,id]                        planted lines the cold test may use (default: every plant inside those lines)
 *   [--no-plants id,id]                          proven plants the short read leaves out (say, one that is the same trick as the cold test's)
 *
 * A short read: some stops of a finished plan, for someone with five minutes. No model here.
 * Its planted lines are the plan's proven ones that sit in those stops and outside every reread range.
 * The planted lines of the cold test are kept apart: they are never used in the read.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Plan, PlanStop } from '../shared/tour';

const args = Object.fromEntries(process.argv.slice(2).reduce<[string, string][]>((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1] ?? '']] : a), []));
if (!args.plan || !args.stops || !args.out) {
  console.error('usage: bun gen/short.ts --plan <plan.json> --stops a,b --out <plan.json> [--edits <edits.json>] [--blocks "stop=2,3,0,1"] [--cold "file:from-to,..."] [--cold-plants id,id]');
  process.exit(2);
}
const plan = JSON.parse(readFileSync(resolve(args.plan), 'utf8')) as Plan;
const keep = new Map((args.blocks ?? '').split(';').filter(Boolean).map((x) => [x.split('=')[0]!, x.split('=')[1]!.split(',').map(Number)] as const));
let stops: PlanStop[] = args.stops.split(',').map((id) => {
  const s = plan.stops.find((x) => x.id === id);
  if (!s) throw new Error(`no stop ${id}`);
  const order = keep.get(id);
  if (!order) return s;
  return {
    ...s,
    blocks: order.map((i) => {
      const b = s.blocks[i];
      if (!b) throw new Error(`stop ${id} has no block ${i}`);
      return b;
    }),
  };
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

const inStops = (file: string, line: number) => stops.some((s) => s.blocks.some((b) => b.type === 'code' && b.file === file && b.from <= line && line <= b.to));
const inReread = (file: string, line: number) => stops.some((s) => s.questions.some((q) => q.reread.file === file && q.reread.from <= line && line <= q.reread.to));
for (const s of stops) for (const q of s.questions) if (!inStops(q.reread.file, q.reread.from) || !inStops(q.reread.file, q.reread.to)) throw new Error(`question ${q.id}: its lines ${q.reread.file}:${q.reread.from}-${q.reread.to} are not in the short read`);

const skip = (args['no-plants'] ?? '').split(',').filter(Boolean);
for (const id of skip) if (!plan.plants.some((p) => p.id === id)) throw new Error(`--no-plants: no plant ${id}`);
const read = plan.plants.filter((p) => inStops(p.file, p.line) && !inReread(p.file, p.line) && !skip.includes(p.id));
if (!read.length) throw new Error('no proven plant sits in these stops');

let cold: Plan['cold'];
if (args.cold) {
  const blocks = args.cold.split(',').map((x) => {
    const m = /^(.+):(\d+)-(\d+)$/.exec(x);
    if (!m) throw new Error(`--cold: ${x} is not file:from-to`);
    return { file: m[1]!, from: Number(m[2]), to: Number(m[3]) };
  });
  const inCold = (file: string, line: number) => blocks.some((b) => b.file === file && b.from <= line && line <= b.to);
  const want = args['cold-plants'] ? args['cold-plants'].split(',') : plan.plants.filter((p) => inCold(p.file, p.line)).map((p) => p.id);
  const plants = want.map((id) => {
    const p = plan.plants.find((x) => x.id === id);
    if (!p) throw new Error(`--cold-plants: no plant ${id}`);
    if (!inCold(p.file, p.line)) throw new Error(`--cold-plants: ${id} is not in the lines of the cold test`);
    if (read.includes(p)) throw new Error(`--cold-plants: ${id} is also a planted line of the read; the two sets must not overlap`);
    return p;
  });
  if (!plants.length) throw new Error('the cold test has no planted line');
  for (const p of read) if (inCold(p.file, p.line)) throw new Error(`the cold test shows ${p.file}:${p.line}, which the read may plant`);
  cold = { blocks, plants: plants.map((p) => p.id) };
}
const coldPlants = plan.plants.filter((p) => cold?.plants.includes(p.id));

const out: Plan = { ...plan, stops, plants: [...read, ...coldPlants], short: { stops: stops.length, of: plan.stops.length }, ...(cold ? { cold } : {}) };
mkdirSync(dirname(resolve(args.out)), { recursive: true });
writeFileSync(resolve(args.out), JSON.stringify(out, null, 1));
const at = (ps: typeof read) => ps.map((p) => `${p.file}:${p.line}${p.kind ? ` (${p.kind})` : ''}`).join(', ');
console.log(`${args.out}: ${stops.length} of ${plan.stops.length} stops, ${stops.reduce((a, s) => a + s.questions.length, 0)} questions, ${stops.reduce((a, s) => a + s.blocks.reduce((b, x) => b + (x.type === 'code' ? x.to - x.from + 1 : 0), 0), 0)} lines; planted in the read: ${at(read)}${cold ? `; cold test ${cold.blocks.map((b) => `${b.file}:${b.from}-${b.to}`).join(', ')} with ${at(coldPlants)}` : ''}`);
