/**
 * bun gen/untested-plants.ts --dir <folder with tour.json and evidence.json> --repo <checkout that holds the head commit> [--skip file:line,...]
 *
 * Adds planted lines that no test notices to a finished tour. gen/evidence.ts tried one-line bugs on the changed lines and ran
 * the project's tests with each; the ones the tests did not notice are kept there with what goes wrong for a user. Such a line
 * becomes a planted line here when a reader can be held to it:
 *
 *   - it sits in a range the tour marked "read closely", so the reader was told to look there and told what the line must do;
 *   - it is not a line of an open point (the reviewer rules on those, the real line has to be in front of them).
 *
 * The server plants these for signed-in reviewers only, and leaves the evidence's note about that one tried bug out for the
 * reviewer who has it (server/app.ts). No model is asked anything: the line, the changed line and what goes wrong are the
 * evidence's own, and the tests were already run with it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCssVariablesTheme, createHighlighter } from 'shiki';
import type { CodeBlock, Evidence, Token, Tour, TourPlant } from '../shared/tour';

const argv = process.argv.slice(2);
const args: Record<string, string> = {};
for (let i = 0; i < argv.length; i++) if (argv[i]!.startsWith('--')) args[argv[i]!.slice(2)] = argv[++i] ?? '';
if (!args.dir || !args.repo) {
  console.error('usage: bun gen/untested-plants.ts --dir <folder> --repo <checkout> [--skip file:line,...]');
  process.exit(2);
}
const tourPath = resolve(args.dir, 'tour.json');
const tour = JSON.parse(readFileSync(tourPath, 'utf8')) as Tour;
const evidence = JSON.parse(readFileSync(resolve(args.dir, 'evidence.json'), 'utf8')) as Evidence;
if (evidence.headSha !== tour.pr.headSha) throw new Error('the evidence is of another commit than the tour');
const skip = new Set((args.skip ?? '').split(',').filter(Boolean));

const theme = createCssVariablesTheme({ name: 'vars', variablePrefix: '--t-', variableDefaults: {}, fontStyle: false });
const LANGS: Record<string, string> = { ts: 'typescript', tsx: 'tsx', js: 'javascript', mjs: 'javascript', css: 'css', json: 'json', sql: 'sql', py: 'python', html: 'html' };
const hl = await createHighlighter({ themes: [theme], langs: [...new Set(Object.values(LANGS))] });
const short = (color: string | undefined) => /--t-token-([a-z-]+)/.exec(color ?? '')?.[1] ?? '';
function highlight(file: string, text: string): Token[][] {
  const lang = LANGS[file.split('.').pop() ?? ''];
  const rows = text.split('\n');
  if (!lang) return rows.map((r) => [[r, '']]);
  const { tokens } = hl.codeToTokens(text, { lang: lang as never, theme: 'vars' });
  return rows.map((r, i) => {
    const out: Token[] = [];
    for (const t of tokens[i] ?? []) {
      const c = short(t.color);
      const last = out[out.length - 1];
      if (last && last[1] === c) last[0] += t.content;
      else out.push([t.content, c]);
    }
    return out.length ? out : [[r, '']];
  });
}
const show = (file: string) => {
  const p = Bun.spawnSync(['git', '-C', resolve(args.repo!), 'show', `${tour.pr.headSha}:${file}`], { stdout: 'pipe', stderr: 'pipe' });
  if (p.exitCode !== 0) throw new Error(`git show ${file}: ${p.stderr.toString().slice(0, 200)}`);
  return p.stdout.toString();
};

const kindOf = (risk: string[]): TourPlant['kind'] => (risk.includes('access') ? 'access' : risk.includes('money') ? 'money' : risk.includes('data') ? 'data' : 'logic');
const kept: TourPlant[] = [];
for (const st of tour.stops) {
  const e = evidence.stops[st.id];
  for (const s of e?.changes.survived ?? []) {
    const at = `${s.file}:${s.line}`;
    const block = (st.blocks.filter((b) => b.type === 'code') as CodeBlock[]).find((b) => b.file === s.file && b.from <= s.line && s.line <= b.to);
    const focus = block?.focus?.find((f) => f.from <= s.line && s.line <= f.to);
    const point = evidence.rulings.some((r) => r.file === s.file && r.from <= s.line && s.line <= r.to);
    if (!focus || point || skip.has(at) || !s.effect) {
      console.log(`  not planted  ${at}  ${!focus ? 'not in a range marked to read closely' : point ? 'a line of an open point' : skip.has(at) ? 'skipped by hand' : 'no effect written'}`);
      continue;
    }
    const head = show(s.file).split('\n');
    if (head[s.line - 1] !== s.original) throw new Error(`${at} is not the line the evidence says it is`);
    const mutated = [...head];
    mutated[s.line - 1] = s.changed;
    kept.push({
      id: `untested-${s.file.split('/').pop()!.replace(/\W+/g, '-')}-${s.line}`,
      file: s.file,
      line: s.line,
      original: s.original,
      planted: s.changed,
      what: s.effect,
      failedTests: [],
      kind: /amount|price|total|pay/i.test(s.effect) ? 'money' : kindOf(e!.risk ?? []),
      stated: focus.why,
      untested: true,
      tokens: highlight(s.file, mutated.join('\n'))[s.line - 1]!,
      originalTokens: highlight(s.file, head.join('\n'))[s.line - 1]!,
    });
    console.log(`  planted      ${at}  ${s.original.trim().slice(0, 50)}  ->  ${s.changed.trim().slice(0, 50)}`);
  }
}
tour.plants = [...tour.plants.filter((p) => !p.untested), ...kept];
writeFileSync(tourPath, JSON.stringify(tour));
console.log(`${kept.length} planted lines no test notices, ${tour.plants.length} planted lines in all`);
