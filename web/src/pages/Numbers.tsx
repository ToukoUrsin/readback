/**
 * /numbers: what this copy has measured, in the four measures the challenge names. People first, our own agents and
 * test browsers beside them, never added together. Every value is read from /api/numbers; nothing is written in.
 */
import { type ReactNode, useState } from 'react';
import { Bot, Warn } from '../ui/icons';
import { Bar, type Band, type Counts, fmtSeconds, type Group, LoadError, N, type Numbers as Data, Pending, pct, type Point, type RouteStop, RuleCard, Section, type SectionRef, Shell, useNumbers } from '../ui/Page';

const SECTIONS: SectionRef[] = [
  { id: 'share', label: 'Share routed to a person' },
  { id: 'findings', label: 'AI findings' },
  { id: 'loop', label: 'After a send-back' },
  { id: 'pace', label: 'Does faster miss more?' },
  { id: 'time', label: 'Time to a decision' },
  { id: 'readers', label: 'Readers' },
  { id: 'history', label: 'Tokens and checks' },
  { id: 'rule', label: 'The rule' },
];

type Who = 'people' | 'judges' | 'agents';
const WHO: Record<Who, string> = { people: 'People', judges: 'Invited judges', agents: 'Our agents and test browsers' };
/** what the server counts since the judge link, the planted bugs no test notices and the follow-up review */
type Kinds = { tested: { met: number; caught: number }; untested: { met: number; caught: number } };
type G = Group & { planted?: Kinds; refused?: number };
interface Loop {
  earlier: { who: string; at: string; headSha: string; seconds: number; ours: boolean };
  points: number;
  accepted: number;
  issue: { number: number; url: string };
  answer: { commit: string; at: string; model: string; turns: number; seconds: number; tokens: number; minutesAfter: number; recalled: number; tests: { before: number; after: number }; added: number; removed: number };
  pr: { number: number; url: string };
  untouched: { stops: number; of: number; lines: number };
  first: { stops: number; lines: number; closely: number; questions: number };
  again: { stops: number; lines: number; closely: number; questions: number };
  retried: { file: string; line: number; changed: string; now: 'noticed' | 'unnoticed'; failed?: string[] }[];
}
type More = Data & { judges?: G; loop?: Loop; planted: Data['planted'] & { untested?: number } };
/** the sentence that stands where a group has nothing to show yet */
const nobody = (who: Who, did: string) => (who === 'people' ? `No person has ${did} on this copy yet.` : who === 'judges' ? `No invited judge has ${did} yet.` : `No agent run has ${did} yet.`);

const ZERO: Counts = { started: 0, reads: 0, caughtFirstRead: 0, missedFirstRead: 0, caughtLater: 0, signed: 0, handIns: 0, medianSeconds: null, medianSecondsToSignature: null, medianWrongAnswers: null, failed: 0, fastSignatures: 0, approved: 0, sentBack: 0, notCounted: 0, noteFailed: 0 };
const review = (g: Group, k: 'full' | 'short') => g.reviews?.[k] ?? ZERO;

const STATEMENT = 'mt-3 max-w-[660px] text-[14.5px] leading-[1.6] text-fg2';
const SUB = 'mt-8 text-[14.5px] leading-[1.4] font-[590] text-fg';
const NOTE = 'mt-1 max-w-[660px] text-[13px] leading-[1.55] text-fg3';

export default function Numbers() {
  const { data: n, error, loading } = useNumbers(15000);

  return (
    <Pending.Provider value={loading}>
      <Shell current="numbers" sections={SECTIONS} wide>
        <h1 className="rise text-[27px] leading-[1.14] font-[590] tracking-[-0.024em] text-fg sm:text-[34px]">Numbers</h1>
        <p className="mt-3 max-w-[700px] text-[14.5px] leading-[1.6] text-fg2">
          Counted on this copy since it went live.{' '}
          {n && (
            <>
              Updated <time dateTime={n.at}>{new Date(n.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>.{' '}
            </>
          )}
          People are browsers that are not ours. Invited judges came in with the judge link the team gave out and typed their own name: a judge can be a person or an AI. Runs by our own agents and test browsers are counted the same way. The three are shown apart and never added, and only the people column is a result about people.
        </p>

        {error && <div className="mt-5">{<LoadError error={error} stale={!!n} />}</div>}
        {loading && (
          <div className="mt-8 space-y-3" role="status" aria-label="Loading the numbers">
            <div className="skeleton h-[14px] w-[220px] rounded" />
            <div className="skeleton h-[96px] rounded-[10px]" />
            <div className="skeleton h-[96px] rounded-[10px]" />
          </div>
        )}

        {n && (
          <>
            <p className="mt-3 text-[13px] leading-[1.6] text-fg3">
              Goes at the cold test or a review so far: <b className="font-[590] text-fg">{n.people.goes}</b> by people, <b className="font-[590] text-fg">{(n as More).judges?.goes ?? 0}</b> by invited judges, <b className="font-[590] text-fg2">{n.agents.goes}</b> by our agents and test browsers.
            </p>
            <Measures n={n} />
            <Share n={n} />
            <Findings n={n} />
            <AfterSendBack n={n} />
            <Pace n={n} />
            <Time n={n} />
            <Readers n={n} />
            <History n={n} />
            <Section id="rule" title="The rule">
              <p className={STATEMENT}>
                What a signature has to meet before the status <code className="icode">readback/read</code> turns green. The same list is on the concept page and in front of the reviewer before signing.
              </p>
              <div className="max-w-[760px]">
                <RuleCard rule={n.rule} />
              </div>
              <p className="mt-3 max-w-[660px] text-[13px] leading-[1.6] text-fg3">
                A wrong try closes the question for <N v={n.rule.lockSeconds} /> seconds.
              </p>
            </Section>
            <p className="mt-[52px] border-t border-line pt-5 text-[12.5px] leading-[1.6] text-fg3">
              Raw counts:{' '}
              <a href="/api/numbers" className="text-fg2 underline decoration-line-strong underline-offset-2 hover:text-fg">
                /api/numbers
              </a>{' '}
              and{' '}
              <a href="/api/stats" className="text-fg2 underline decoration-line-strong underline-offset-2 hover:text-fg">
                /api/stats
              </a>
            </p>
          </>
        )}
      </Shell>
    </Pending.Provider>
  );
}

/* ---- what the history of the change cost, and what was checked by a second model ---- */

const big = (x: number) => x.toLocaleString('en-US');

/** one look for every list of a label and its value on this page */
const row = 'flex items-baseline justify-between gap-5 py-[7px]';
const dt = 'min-w-0 text-[13px] leading-[1.45] text-fg3';
const dd = 'flex-none text-right text-[13.5px] font-[510] tabular-nums text-fg';

function History({ n }: { n: Data }) {
  const h = n.history;
  const q = n.questionCheck;
  if (!h && !q) return null;
  const c = h?.callers;
  return (
    <Section id="history" title="Tokens and checks">
      <p className={STATEMENT}>What the agent spent writing the change, what it costs to know what a line reaches, and how the questions were checked. None of this is counted from readers: it is measured once per pull request.</p>

      {h && (
        <>
          <h3 className={SUB}>The agent’s sessions, from Entire</h3>
          <p className={NOTE}>Each session is an Entire checkpoint tied to the commit it wrote. Tokens are all tokens of the session, cache reads included.</p>
          <dl className="mt-2 max-w-[760px] divide-y divide-line border-y border-line">
            {h.sessions.map((s) => (
              <div key={s.n} className={row}>
                <dt className={dt}>
                  <span className="font-[510] text-fg2">Session {s.n}</span> · <span className="font-mono text-[12px]">{s.commit}</span> · {s.asked}
                  {!s.steps && <span className="block text-[12px] text-fg4">Only the prompt, the report and the token counts were kept.</span>}
                </dt>
                <dd className={dd}>{big(s.tokens)}</dd>
              </div>
            ))}
            <div className={row}>
              <dt className={`${dt} font-[510] text-fg2`}>All sessions</dt>
              <dd className={dd}>{big(h.sessions.reduce((a, s) => a + s.tokens, 0))}</dd>
            </div>
          </dl>
        </>
      )}

      {h && c && (
        <>
          <h3 className={SUB}>“What calls this function?”, asked two ways</h3>
          <p className={NOTE}>
            Asked for all {c.functions} functions the change added or altered. Entire’s code graph ({h.versions.graph}: {h.graph.files} files, {big(h.graph.symbols)} symbols, {big(h.graph.relations)} relations) against {c.model} with tools to read the repository, one fresh session per function.
          </p>
          <dl className="mt-2 max-w-[760px] divide-y divide-line border-y border-line">
            {(
              [
                ['Entire’s graph: tokens', '0'],
                ['Entire’s graph: time per question', `${h.graph.msPerQuery} ms`],
                [`${c.model}: tokens for all ${c.functions}`, big(c.tokens)],
                [`${c.model}: time per question, median`, `${c.medianSeconds} s`],
                ['Functions where both named the same callers', `${c.same} of ${c.functions}`],
                ['Functions where the model found a caller the graph did not list', c.modelFoundMore],
                ['Functions where the graph found a caller the model missed', c.graphFoundMore],
                [`What Readback does: the graph first, the model only for the ${c.mixed.asked} functions where the graph lists no caller`, `${big(c.mixed.tokens)} tokens`],
                ['Saved against asking the model every time', `${big(c.tokens - c.mixed.tokens)} tokens, ${pct(c.tokens - c.mixed.tokens, c.tokens)}`],
              ] as [string, ReactNode][]
            ).map(([k, v], i, all) => (
              // the last two rows are the answer: what Readback does and what that saves
              <div key={k} className={`${row} ${i >= all.length - 2 ? 'flex-wrap gap-y-0.5' : ''}`}>
                <dt className={`${dt} ${i >= all.length - 2 ? 'font-[510] text-fg' : ''}`}>{k}</dt>
                <dd className={`${dd} ${i === all.length - 1 ? 'text-ok' : ''} ml-auto`}>{v}</dd>
              </div>
            ))}
          </dl>
          <p className={`${NOTE} mt-2.5`}>The callers the graph missed are calls from route handlers that have no name. One repository, one question: it is a measurement of this change, not a benchmark.</p>
        </>
      )}

      {q && (
        <>
          <h3 className={SUB}>The questions, checked by a second model</h3>
          <p className={NOTE}>
            {q.writer} wrote the questions. {q.checker} answered each one twice: with the stop’s code, and with only the stop’s title and description. A question is kept when it reaches the key with the code and not without it.
          </p>
          <dl className="mt-2 max-w-[760px] divide-y divide-line border-y border-line">
            {(
              [
                ['Questions checked', q.checked],
                ['Key not reached with the code in front of it', q.wrongKey],
                ['Answered right without the code', q.withoutCode],
                [`Of our first ${q.first.checked} questions, answered right without the code`, q.first.withoutCode],
                ['Kept in the pool', q.kept],
                ...(q.heldBack ? ([['Kept but not asked: their lines hold a line that can be planted', q.heldBack]] as [string, ReactNode][]) : []),
                ['Fewest in use for one stop (a reviewer is asked 2 of them)', q.perStop],
              ] as [string, ReactNode][]
            ).map(([k, v]) => (
              <div key={k} className={row}>
                <dt className={dt}>{k}</dt>
                <dd className={dd}>{v}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </Section>
  );
}

/* ---- the four measures the challenge names: what is counted now, what a team watches, when to stop trusting it ---- */

function Measures({ n }: { n: Data }) {
  const route = n.route;
  if (!route) return null;
  const p = n.people;
  const full = review(p, 'full');
  const met = p.pace.reduce((k, b) => k + b.met, 0);
  const missed = p.pace.reduce((k, b) => k + b.missed, 0);
  const ruled = p.rulings.accepted + p.rulings.sentBack;
  const j = (n as More).judges;
  const jmet = j?.pace.reduce((k, b) => k + b.met, 0) ?? 0;
  const jmissed = j?.pace.reduce((k, b) => k + b.missed, 0) ?? 0;
  const none = <span className="text-fg3">no person yet</span>;
  const quiet = (text: string) => <span className="text-fg3">{text}</span>;
  const rows: { measure: string; now: ReactNode; live: string; alarm: string; to: string }[] = [
    {
      measure: 'Reverts and incidents do not rise as review time falls',
      now: (
        <>
          Stand-in: a known bug in every review.{' '}
          {met || p.cold.shown ? (
            <>
              Missed by people: {met ? <b className="font-[590] text-fg">{missed} of {met}</b> : none}. Before Readback, in the cold test: {p.cold.shown ? <b className="font-[590] text-fg">{p.cold.approved} of {p.cold.shown} approved the bug</b> : none}.
            </>
          ) : (
            quiet('No person has met one on this copy yet.')
          )}
          {jmet ? (
            <>
              {' '}
              Invited judges (a person or an AI): missed <b className="font-[590] text-fg">{jmissed} of {jmet}</b>.
            </>
          ) : null}
        </>
      ),
      live: 'Reverts and incident tickets of merged changes, set against the minutes and pace on the signature of each.',
      alarm: 'The miss rate is higher in a faster pace band than in a slower one: the pace limit goes down. A revert of a change that was approved under the rule: that review is read again line by line.',
      to: '#pace',
    },
    {
      measure: 'AI findings are real and accepted',
      now: (
        <>
          <b className="font-[590] text-fg">{route.unnoticed} of {route.unnoticed}</b> untested-line findings come from a run that can be repeated. <b className="font-[590] text-fg">{n.points.length}</b> open points
          {ruled ? (
            <>
              ; ruled on by people: <b className="font-[590] text-fg">{p.rulings.accepted} accepted, {p.rulings.sentBack} sent back</b>.
            </>
          ) : (
            <>. {quiet('No person has ruled on one yet.')}</>
          )}
        </>
      ),
      live: 'Per kind of point: how many were sent back and then changed by the author.',
      alarm: 'A finding that cannot be reproduced: none is tolerated. A kind of point accepted 9 times in 10 is noise and is asked less.',
      to: '#findings',
    },
    {
      measure: 'Time to merge',
      now: (
        <>
          {full.medianSecondsToSignature === null && p.cold.medianSeconds === null ? (
            <>Start of the full review to the signature, and the cold test decision, median. {quiet('No person has finished either yet.')}</>
          ) : (
            <>
              Start of the full review to the signature, median: {full.medianSecondsToSignature === null ? none : <b className="font-[590] text-fg">{fmtSeconds(full.medianSecondsToSignature)}</b>}. Cold test decision: {p.cold.medianSeconds === null ? none : <b className="font-[590] text-fg">{fmtSeconds(p.cold.medianSeconds)}</b>}.
            </>
          )}
        </>
      ),
      live: 'Pull request opened to merged, split into waiting for a reviewer and minutes in the review.',
      alarm: 'Review minutes go up while the share routed to a person stays the same: the questions or the stops are too heavy.',
      to: '#time',
    },
    {
      measure: 'Share routed to humans',
      now: (
        <>
          <b className="font-[590] text-fg">
            {route.linesToRead} of {route.linesAll.toLocaleString('en-US')} lines ({pct(route.linesToRead, route.linesAll)})
          </b>
          , {route.stopsToRead} of {n.stops} stops.
        </>
      ),
      live: 'The same share per pull request, and which reason sent each line: risk, no test, open point.',
      alarm: 'The share falls while the miss rate of the known bug rises: too little is routed. Most lines routed for “no test”: fix the tests first.',
      to: '#share',
    },
  ];
  return (
    <div className="mt-7 overflow-hidden rounded-[10px] border border-line bg-raised" role="table" aria-label="The four measures">
      <div className="hidden grid-cols-[minmax(0,0.8fr)_minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1.15fr)] gap-x-5 border-b border-line px-4 py-2.5 text-[12px] font-[510] text-fg3 lg:grid" role="row">
        <span role="columnheader">The challenge’s measure</span>
        <span role="columnheader">Counted on this copy now</span>
        <span role="columnheader">Counted in real use</span>
        <span role="columnheader">When we would stop trusting it</span>
      </div>
      <div className="divide-y divide-line">
        {rows.map((r) => (
          <div key={r.measure} className="px-4 py-3.5 lg:grid lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-x-5" role="row">
            <p className="text-[13.5px] leading-[1.45] font-[590] text-fg" role="cell">
              <a href={r.to} className="underline-offset-2 hover:underline">
                {r.measure}
              </a>
            </p>
            <p className="mt-1.5 text-[13.5px] leading-[1.55] text-fg2 lg:mt-0" role="cell">
              {r.now}
            </p>
            <p className="mt-1.5 text-[13px] leading-[1.55] text-fg3 lg:mt-0" role="cell">
              <span className="font-[510] text-fg2 lg:hidden">In real use: </span>
              {r.live}
            </p>
            <p className="mt-1.5 text-[13px] leading-[1.55] text-fg3 lg:mt-0" role="cell">
              <span className="font-[510] text-fg2 lg:hidden">Stop trusting it when: </span>
              {r.alarm}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- people and agents, side by side, never added ---- */

function Split({ n, children }: { n: Data; children: (g: G, who: Who) => ReactNode }) {
  return (
    <div className={`mt-3 grid items-start gap-3 md:grid-cols-2 ${(n as More).judges ? 'xl:grid-cols-[1fr_1fr_1.2fr]' : ''}`}>
      {(['people', 'judges', 'agents'] as const).map((who) => {
        const g = who === 'judges' ? (n as More).judges : n[who];
        if (!g) return null;
        return (
          <div key={who} className={who === 'agents' ? 'rounded-[10px] border border-dashed border-line-strong px-4 pt-3 pb-3.5' : 'card px-4 pt-3 pb-3.5'}>
            {/* one line in all three cards, so the rows under them start at the same height. The third column is a little wider because its name is the longest; if it still does not fit, the name gives way and the tag never breaks */}
            <p className={`mb-2 flex items-center gap-[6px] text-[12.5px] font-[590] ${who === 'agents' ? 'text-fg3' : 'text-fg'}`}>
              {who === 'agents' && <Bot size={13} className="flex-none" />}
              <span className="min-w-0 truncate" title={WHO[who]}>
                {WHO[who]}
              </span>
              {who === 'agents' && <span className="ml-auto flex-none pl-2 font-[450] whitespace-nowrap">not results</span>}
              {who === 'judges' && <span className="ml-auto flex-none pl-2 font-[450] whitespace-nowrap text-fg3">a person or an AI</span>}
            </p>
            {children(g, who)}
          </div>
        );
      })}
    </div>
  );
}

/** The plain sentence that stands where a group has nothing to show yet. */
const None = ({ children }: { children: ReactNode }) => <p className="py-1 text-[13.5px] leading-[1.55] text-fg3">{children}</p>;

/** `stack`: values that are phrases, not numbers, go under their label on a phone instead of squeezing it into a column three words wide */
function Stats({ who, rows, stack }: { who: Who; rows: [label: ReactNode, value: ReactNode][]; stack?: boolean }) {
  return (
    <dl className="divide-y divide-line">
      {rows.map(([label, value], i) => (
        <div key={i} className={stack ? 'flex flex-col gap-y-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-5 sm:py-[7px]' : 'flex items-baseline justify-between gap-5 py-[7px]'}>
          <dt className="min-w-0 text-[13px] leading-[1.45] text-fg3">{label}</dt>
          <dd className={`text-[13.5px] font-[510] tabular-nums ${stack ? 'sm:flex-none sm:text-right' : 'flex-none text-right'} ${who === 'people' ? 'text-fg' : 'text-fg2'}`}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Caught and missed by band of pace or time. */
function Bands({ bands, head, none }: { bands: Band[]; head: string; none: string }) {
  if (!bands.some((b) => b.met > 0)) return <None>{none}</None>;
  return (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr className="text-[12px] text-fg3">
          <th scope="col" className="py-1.5 pr-3 text-left font-[510]">
            {head}
          </th>
          {['Met', 'Caught', 'Missed'].map((h) => (
            <th key={h} scope="col" className="w-[56px] py-1.5 text-right font-[510]">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {bands.map((b) => (
          <tr key={b.band} className="border-t border-line">
            <th scope="row" className={`py-[7px] pr-3 text-left font-[450] ${b.met ? 'text-fg2' : 'text-fg3'}`}>
              {b.band}
            </th>
            <td className={`py-[7px] text-right tabular-nums ${b.met ? 'font-[510] text-fg' : 'text-fg3'}`}>{b.met}</td>
            <td className={`py-[7px] text-right tabular-nums ${b.caught ? 'font-[510] text-ok' : 'text-fg3'}`}>{b.caught}</td>
            <td className={`py-[7px] text-right tabular-nums ${b.missed ? 'font-[510] text-bad' : 'text-fg3'}`}>{b.missed}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---- 1. share routed to a person ---- */

const RISK: Record<string, string> = { access: 'access', money: 'money', data: 'stored data' };

function Share({ n }: { n: Data }) {
  const r = n.route;
  return (
    <Section id="share" title="Share routed to a person">
      <p className={STATEMENT}>How much of the change a person has to read closely, by line and by stop. The rest is shown with its evidence and can still be flagged.</p>
      {!r ? (
        <p className="mt-4 text-[14px] leading-[1.6] text-fg2">There is no evidence for the current commit on this copy, so nothing is routed: every line has to be read.</p>
      ) : (
        <>
          <p className="mt-5 text-[17px] leading-[1.45] font-[590] text-fg">
            <N v={r.linesToRead} /> of <N v={r.linesAll} /> lines ({pct(r.linesToRead, r.linesAll)}), <N v={r.stopsToRead} /> of <N v={n.stops} /> stops ask something
          </p>
          <div className="mt-3 flex h-[12px] gap-[2px]" role="img" aria-label={`${r.linesToRead} of ${r.linesAll} lines are to be read closely, drawn per stop`}>
            {r.stops.map((s) => (
              <div key={s.id} className="relative min-w-[3px] overflow-hidden rounded-[2px] bg-active" style={{ flex: `${s.lines} 0 0` }} title={`${s.title}: ${s.closely} of ${s.lines} lines to read closely`}>
                <div className="absolute inset-y-0 left-0 bg-warn" style={{ width: `${s.lines ? (s.closely / s.lines) * 100 : 0}%` }} />
              </div>
            ))}
          </div>
          <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-fg3">
            <span className="inline-flex items-center gap-[6px]">
              <span className="size-[8px] rounded-[2px] bg-warn" aria-hidden /> lines to read closely
            </span>
            <span className="inline-flex items-center gap-[6px]">
              <span className="size-[8px] rounded-[2px] border border-line-strong bg-active" aria-hidden /> other lines shown
            </span>
            <span>One block per stop, as wide as its lines.</span>
          </p>

          {n.second && (
            <>
              <h3 className={SUB}>A second reader for the marks</h3>
              <p className={NOTE}>
                {n.second.model} got the same <N v={n.second.shown} /> lines with no marks, no stop titles and no notes, only the issue, and marked on its own which lines a person has to read for access, money or data. Compared line by line with the marks of our model.
              </p>
              <dl className="mt-2 max-w-[760px] divide-y divide-line border-y border-line">
                {(
                  [
                    ['Lines our model marked for what they can harm', n.second.ours],
                    ['Lines the second reader marked', n.second.theirs],
                    ['Marked by both', n.second.both],
                    ['Only ours', n.second.oursOnly],
                    ['Only the second reader, and on no close-read list', n.second.theirsOnly, 'Shown in the review with a grey mark, not counted.'],
                  ] as [string, number, string?][]
                ).map(([k, v, more]) => (
                  <div key={k} className={row}>
                    <dt className={dt}>
                      {k}
                      {more && <span className="block text-[12px] text-fg4">{more}</span>}
                    </dt>
                    <dd className={dd}>{v}</dd>
                  </div>
                ))}
              </dl>
              <p className={`${NOTE} mt-2.5`}>
                The <N v={n.second.closely} /> lines to read closely also hold lines no test notices and the open points, which neither count above includes. One run, one change: {n.second.tokens.in.toLocaleString('en-US')} tokens in, {n.second.tokens.out.toLocaleString('en-US')} out.
              </p>
            </>
          )}

          <h3 className={SUB}>Per stop</h3>
          <p className={NOTE}>
            “Tests noticed” counts one-line bugs tried in that stop against the project’s <N v={r.tests.passed} /> tests: <N v={r.caught} /> of <N v={r.tried} /> noticed over the whole change, <span className="text-warn">{r.unnoticed} unnoticed</span>.
          </p>
          <div className="card mt-3 divide-y divide-line">
            <div className={`hidden px-4 py-2 text-[12px] font-[510] text-fg3 ${STOP_COLS}`}>
              <span>Stop and the criteria it serves</span>
              <span>Can harm</span>
              <span>Read closely</span>
              <span>Tests noticed</span>
            </div>
            {r.stops.map((s) => (
              <StopRow key={s.id} s={s} n={n} />
            ))}
          </div>
        </>
      )}
    </Section>
  );
}

const STOP_COLS = 'lg:grid lg:grid-cols-[minmax(0,1fr)_96px_136px_168px] lg:gap-x-6';

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-2.5 flex gap-3 lg:mt-0 lg:block">
      <span className="w-[88px] flex-none text-[12px] leading-[1.6] text-fg3 lg:hidden">{label}</span>
      <div className="min-w-0 flex-1 text-[13px] leading-[1.5]">{children}</div>
    </div>
  );
}

function StopRow({ s, n }: { s: RouteStop; n: Data }) {
  const [open, setOpen] = useState<number | null>(null);
  const issue = n.pr.issue?.number;
  const tag = (c: number) => (issue ? `#${issue}.${c}` : `#${c}`);
  const text = (c: number) => n.criteria.find((x) => x.n === c)?.text;
  // "x of y changes went unnoticed by the tests" is the bar on the right; the other reasons are why this stop is read
  const why = s.why.filter((w) => !/unnoticed by the tests$/.test(w));
  return (
    <div className={`px-4 py-3.5 ${STOP_COLS}`}>
      <div className="min-w-0">
        <p className="text-[13.5px] leading-[1.45] font-[590] text-fg">{s.title}</p>
        {why.length > 0 && <p className="mt-0.5 text-[12.5px] leading-[1.5] text-fg3">{why.join('. ')}</p>}
        {s.criteria.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-[5px]">
            {s.criteria.map((c) => (
              <button
                key={c}
                type="button"
                title={text(c)}
                aria-expanded={open === c}
                onClick={() => setOpen(open === c ? null : c)}
                className={`chip h-[22px]! px-[7px]! text-[11.5px]! tabular-nums transition-colors hover:text-fg ${open === c ? 'border-line-strong! bg-active! text-fg!' : ''}`}
              >
                {tag(c)}
              </button>
            ))}
          </div>
        )}
        {open !== null && (
          <p className="fade mt-2 text-[12.5px] leading-[1.55] text-fg2">
            <span className="text-fg3">{tag(open)} </span>
            {text(open) ?? 'The server gave no text for this criterion.'}
          </p>
        )}
      </div>
      <Cell label="Can harm">{s.risk.length ? <span className="text-fg2">{s.risk.map((k) => RISK[k] ?? k).join(', ')}</span> : <span className="text-fg3">none named</span>}</Cell>
      <Cell label="Read closely">
        {s.closely > 0 ? (
          <>
            <span className="text-fg2">
              <b className="font-[590] text-fg">{s.closely}</b> of {s.lines} lines
            </span>
            <Bar part={s.closely} whole={s.lines} className="mt-[6px] max-w-[136px]" />
          </>
        ) : (
          <span className="text-fg3">carried by its evidence: nothing to read closely</span>
        )}
      </Cell>
      <Cell label="Tests noticed">
        {s.tried > 0 ? (
          <>
            <span className="text-fg2">
              <b className="font-[590] text-fg">{s.caught}</b> of {s.tried}
              {s.unnoticed > 0 && <span className="text-warn"> · {s.unnoticed} unnoticed</span>}
            </span>
            <div className="mt-[6px] flex h-[6px] max-w-[168px] gap-[2px]" aria-hidden>
              {s.caught > 0 && <div className="rounded-full bg-ok" style={{ flex: `${s.caught} 0 0` }} />}
              {s.unnoticed > 0 && <div className="rounded-full bg-warn" style={{ flex: `${s.unnoticed} 0 0` }} />}
            </div>
          </>
        ) : (
          <span className="text-fg3">no one-line bugs tried here</span>
        )}
      </Cell>
    </div>
  );
}

/* ---- 2. AI findings ---- */

const KIND: Record<string, [label: string, tone: string]> = {
  unasked: ['Nobody asked for this', 'text-flag'],
  open: ['The issue leaves this open', 'text-accent-hi'],
  untested: ['No test checks this', 'text-warn'],
};

function Findings({ n }: { n: Data }) {
  const ruled = (g: Group) => g.rulings.accepted + g.rulings.sentBack;
  return (
    <Section id="findings" title="AI findings: real, and what reviewers ruled">
      <p className={STATEMENT}>
        <N v={n.route?.unnoticed} /> lines where a tried bug passed all <N v={n.route?.tests.passed} /> tests, and <N v={n.points.length} /> points the AI does not decide. Each was produced by a run or is quoted from the code; a person rules on each point.
      </p>
      <Split n={n}>
        {(g, who) =>
          ruled(g) ? (
            <Stats
              who={who}
              rows={[
                ['Points accepted', g.rulings.accepted],
                ['Points sent back to the author', g.rulings.sentBack],
                ['Reasons refused because they would fit any line', g.refused ?? 0],
              ]}
            />
          ) : (
            <None>{nobody(who, 'ruled on a point')}</None>
          )
        }
      </Split>
      {n.points.length > 0 && (
        <div className="card mt-3 divide-y divide-line">
          {n.points.map((p) => (
            <PointRow key={p.id} p={p} />
          ))}
        </div>
      )}
    </Section>
  );
}

function PointRow({ p }: { p: Point }) {
  const [label, tone] = KIND[p.kind] ?? [p.kind, 'text-fg2'];
  const ruling = (who: Who) => {
    const c = (p as Point & { judges?: { accepted: number; sentBack: number } })[who];
    if (!c) return null;
    return (
      <p className={`flex gap-x-[6px] ${who === 'agents' ? 'text-fg3' : 'text-fg2'}`}>
        <span className="w-[76px] flex-none text-fg3">{who === 'people' ? 'People' : who === 'judges' ? 'Judges' : 'Our agents'}</span>
        <span className="whitespace-nowrap">
          accepted <b className={`font-[590] ${who === 'agents' ? 'text-fg2' : 'text-fg'}`}>{c.accepted}</b> · sent back <b className={`font-[590] ${who === 'agents' ? 'text-fg2' : 'text-fg'}`}>{c.sentBack}</b>
        </span>
      </p>
    );
  };
  return (
    <div className="px-4 py-3.5 lg:grid lg:grid-cols-[196px_minmax(0,1fr)_236px] lg:gap-x-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 lg:block">
        <p className={`text-[12.5px] leading-[1.5] font-[590] ${tone}`}>{label}</p>
        <p className="font-mono text-[11.5px] leading-[1.6] [overflow-wrap:anywhere] text-fg3 lg:mt-0.5">
          {p.file}:{p.from}
          {p.to !== p.from && `–${p.to}`}
        </p>
      </div>
      <div className="mt-2 min-w-0 lg:mt-0">
        <p className="text-[13.5px] leading-[1.55] text-fg2">{p.found}</p>
        <p className="mt-1.5 text-[13.5px] leading-[1.5] font-[510] text-fg">{p.question}</p>
      </div>
      <div className="mt-2.5 space-y-0.5 text-[12.5px] leading-[1.5] tabular-nums lg:mt-0">
        {ruling('people')}
        {ruling('judges')}
        {ruling('agents')}
      </div>
    </div>
  );
}

/* ---- 3. does a faster review miss more? ---- */

function Pace({ n }: { n: Data }) {
  const kinds = Object.entries(n.planted.byKind).sort((a, b) => b[1] - a[1]);
  const reviewStats = (g: Group, who: Who, k: 'full' | 'short') => {
    const c = review(g, k);
    if (!c.reads) return <None>{nobody(who, `handed in a ${k} review`)}</None>;
    return (
      <Stats
        who={who}
        rows={[
          ['Handed in at least once', c.reads],
          ['Caught the planted bug on the first read', `${c.caughtFirstRead} of ${c.reads}`],
          ['Missed it first, caught one on a later read', `${c.caughtLater} of ${c.missedFirstRead}`],
          ['Flagged the right line without a right reason', c.noteFailed],
          ['Wrong answers before the first hand-in, median', c.medianWrongAnswers ?? 'none yet'],
        ]}
      />
    );
  };
  return (
    <Section id="pace" title="Does a faster review miss more?">
      <p className={STATEMENT}>Reverts and incidents need months of real use before they can be counted. So every review carries one known bug, and the record keeps whether it was caught and how fast the reviewer read.</p>

      <h3 className={SUB}>Full review, by reading pace</h3>
      <p className={NOTE}>Hand-ins of the review that approves, by lines to read closely a minute. Met is how many met the planted bug at that pace. Our agents read faster than a person can and still catch the bug: their column shows no link between pace and misses, and says nothing about the pace limit for people. The limit is a first guess until the people column has numbers.</p>
      <Split n={n}>
        {(g, who) => (
          <>
            <Bands bands={g.pace} head="Pace" none={nobody(who, 'handed in a full review')} />
            {review(g, 'full').reads > 0 && <div className="mt-2 border-t border-line pt-1">{reviewStats(g, who, 'full')}</div>}
          </>
        )}
      </Split>

      <h3 className={SUB}>Cold test, by seconds to decide</h3>
      <p className={NOTE}>A plain pull request view with one planted bug and an Approve button, nothing said about the bug. It is the first thing a visitor meets.</p>
      <Split n={n}>
        {(g, who) =>
          g.cold.shown ? (
            <>
              <Stats
                who={who}
                rows={[
                  ['Shown the cold test', g.cold.shown],
                  ['Approved with the bug in front of them', g.cold.approved],
                  ['Flagged the planted line', g.cold.flaggedPlanted],
                  ['Flagged another line', g.cold.flaggedOther],
                  ['Skipped it', g.cold.skipped],
                  ['Then caught the bug on the first read of a guided review', `${g.cold.thenGuided.caughtFirstRead} of ${g.cold.thenGuided.reads}`],
                ]}
              />
              <div className="mt-2 border-t border-line pt-2">
                <Bands bands={g.coldPace} head="Time to decide" none={who === 'people' ? 'No person has decided a timed cold test yet.' : who === 'judges' ? 'No invited judge has decided a timed cold test yet.' : 'No agent run has decided a timed cold test yet.'} />
              </div>
            </>
          ) : (
            <None>{nobody(who, 'been shown the cold test')}</None>
          )
        }
      </Split>

      <h3 className={SUB}>Short review</h3>
      <p className={NOTE}>A few stops, for trying it. It works like the full review and does not approve.</p>
      <Split n={n}>{(g, who) => reviewStats(g, who, 'short')}</Split>

      <h3 className={SUB}>The bugs that are planted</h3>
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-2 text-[13.5px] leading-[1.5] text-fg2">
        <span>
<b className="font-[590] text-fg">{n.planted.total}</b> prepared for this change. <b className="font-[590] text-fg">{n.planted.total - ((n as More).planted.untested ?? 0)}</b> are proven by a failing test.{' '}
          {(n as More).planted.untested ? (
            <>
              <b className="font-[590] text-fg">{(n as More).planted.untested}</b> are bugs no test notices: the project’s tests were run with each and all passed, so only a reader stops them. Those are planted for signed-in reviewers and invited judges only.{' '}
            </>
          ) : null}
          One is shown per read.
        </span>
        {kinds.map(([k, c]) => (
          <span key={k} className="chip">
            {RISK[k] ?? k} <b className="font-[590] text-fg2">{c}</b>
          </span>
        ))}
      </p>
      <p className={NOTE}>Hand-ins of a review that approves, by which kind of planted bug the reviewer had. A bug no test notices is the case the review exists for.</p>
      <Split n={n}>
        {(g, who) =>
          g.planted && g.planted.tested.met + g.planted.untested.met > 0 ? (
            <Stats
              who={who}
              rows={[
                ['Had a bug the tests notice: caught', `${g.planted.tested.caught} of ${g.planted.tested.met}`],
                ['Had a bug no test notices: caught', g.planted.untested.met ? `${g.planted.untested.caught} of ${g.planted.untested.met}` : 'none met yet'],
              ]}
            />
          ) : (
            <None>{nobody(who, 'handed in a review that approves')}</None>
          )
        }
      </Split>
    </Section>
  );
}

/* ---- after a send-back ---- */

function AfterSendBack({ n }: { n: Data }) {
  const l = (n as More).loop;
  if (!l) return null;
  const day = new Date(l.earlier.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  const fixed = l.retried.filter((r) => r.now === 'noticed');
  const next = (g: G) => g.reviews?.next;
  const rows: [ReactNode, ReactNode][] = [
    [`Review of ${l.earlier.headSha} sent back, ${day} UTC`, `${l.points} points sent back, ${l.accepted} accepted`],
    [
      <>
        The points became{' '}
        <a href={l.issue.url} className="underline decoration-line-strong underline-offset-2 hover:text-fg">
          issue #{l.issue.number}
        </a>
        , in the reviewer’s words
      </>,
      `${l.points} acceptance criteria`,
    ],
    ['Rulings the author agent read back from Entire Brain before it wrote anything', l.answer.recalled],
    [
      <>
        The agent’s answer:{' '}
        <a href={l.pr.url} className="underline decoration-line-strong underline-offset-2 hover:text-fg">
          pull request #{l.pr.number}
        </a>
        , commit {l.answer.commit}
      </>,
      `+${l.answer.added} −${l.answer.removed} lines`,
    ],
    ['From the signature to the commit', `${l.answer.minutesAfter} minutes`],
    ['What the answer cost', `${l.answer.turns} steps, ${big(l.answer.tokens)} tokens`],
    ['Tests that pass', `${l.answer.tests.before} before, ${l.answer.tests.after} after`],
    ...(fixed.length ? ([[`A one-line bug on a line that was sent back, which no test noticed before, tried again`, `${fixed.length} of ${l.retried.length} now ${fixed.length === 1 ? 'fails' : 'fail'} a test`]] as [ReactNode, ReactNode][]) : []),
    [`Stops of the first review the answer does not touch`, `${l.untouched.stops} of ${l.untouched.of} (${big(l.untouched.lines)} lines)`],
    ['The first review', `${l.first.questions} questions, ${l.first.closely} of ${big(l.first.lines)} lines closely`],
    ['The follow-up review', `${l.again.questions} questions, ${l.again.closely} of ${big(l.again.lines)} lines closely`],
  ];
  return (
    <Section id="loop" title="After a send-back: the author answers, and only the answer is read again">
      <p className={STATEMENT}>
        A review that sends points back does not end in a comment. The points become an issue, the author agent answers with one more commit, and the reviewer reads that commit only. The rest of the change stands on the first review. This ran once on this copy, and every value below is read from that run.
      </p>
      <div className="card mt-3 max-w-[760px] px-4 pt-1.5 pb-2">
        <Stats who="people" rows={rows} stack />
      </div>
      <p className={`${NOTE} mt-2.5!`}>
        {l.earlier.ours ? 'The review that was sent back was signed by our own script through the judge link, so that a sent-back review existed to answer. ' : ''}
        The author’s session, its commit and the test runs are real runs, kept by Entire with the commit. One run is one data point, not a rate.
      </p>
      <h3 className={SUB}>Follow-up reviews signed</h3>
      <Split n={n}>
        {(g, who) =>
          next(g)?.signed ? (
            <Stats
              who={who}
              rows={[
                ['Signed', next(g)!.signed],
                ['Approved the answer', next(g)!.approved],
                ['Sent it back again', next(g)!.sentBack],
                ['Start to signature, median', next(g)!.medianSecondsToSignature === null ? 'none yet' : fmtSeconds(next(g)!.medianSecondsToSignature!)],
              ]}
            />
          ) : (
            <None>{nobody(who, 'signed a follow-up review')}</None>
          )
        }
      </Split>
    </Section>
  );
}

/* ---- 4. time to a decision ---- */

function Time({ n }: { n: Data }) {
  return (
    <Section id="time" title="Time to a decision">
      <p className={STATEMENT}>Median time from opening the first stop to the signature that sets the commit status, and to a decision in the cold test. Then what the signatures did.</p>
      <Split n={n}>
        {(g, who) => {
          const f = review(g, 'full');
          const s = review(g, 'short');
          const nothing = !f.started && !s.started && !g.cold.shown;
          if (nothing) return <None>{nobody(who, 'started a review')}</None>;
          return (
            <>
              <Stats
                who={who}
                rows={[
                  ['Full review, start to signature', fmtSeconds(f.medianSecondsToSignature)],
                  ['Short review, start to signature', fmtSeconds(s.medianSecondsToSignature)],
                  ['Cold test, seeing the change to deciding', fmtSeconds(g.cold.medianSeconds)],
                ]}
              />
              <p className="mt-3 mb-1 text-[12px] font-[510] text-fg3">Full review, outcomes</p>
              <Stats
                who={who}
                rows={[
                  ['Started', f.started],
                  ['Approved, status green', f.approved],
                  ['Sent back, status red', f.sentBack],
                  ['Signed but not counted', f.notCounted],
                  ['Failed: shown every planted line without catching one', f.failed],
                  ['Questions put to the guide, all reviews', g.asked],
                ]}
              />
            </>
          );
        }}
      </Split>
    </Section>
  );
}

/* ---- readers: people only ---- */

function Readers({ n }: { n: Data }) {
  return (
    <Section id="readers" title="Readers">
      <p className={STATEMENT}>Per reader and area: planted bugs met, caught and missed. People only. Two misses in a row in an area means that reader’s reviews there need a second reader.</p>
      {n.readers.length === 0 ? (
        <p className="card mt-4 px-4 py-3.5 text-[13.5px] leading-[1.55] text-fg3">No person has met a planted bug on this copy yet. A row appears here with the first one.</p>
      ) : (
        <div className="card mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="text-[12px] text-fg3">
                {['Reader', 'Area', 'Met', 'Caught', 'Missed'].map((h, i) => (
                  <th key={h} scope="col" className={`py-2 font-[510] ${i >= 2 ? 'w-[60px] pr-4 text-right sm:w-[84px]' : 'pl-4 text-left'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {n.readers.map((r, i) => (
                <tr key={i} className="border-t border-line align-top">
                  <th scope="row" className="py-2.5 pl-4 text-left font-[590] text-fg">
                    {r.reader}
                    {r.needsSecond && (
                      <span className="mt-0.5 flex items-start gap-[6px] text-[12.5px] leading-[1.4] font-[510] text-warn">
                        <Warn size={13} className="mt-[2px] flex-none" /> needs a second reader
                      </span>
                    )}
                  </th>
                  <td className="py-2.5 pl-4 text-fg2">{RISK[r.area] ?? r.area}</td>
                  <td className="py-2.5 pr-4 text-right font-[510] text-fg tabular-nums">{r.met}</td>
                  <td className={`py-2.5 pr-4 text-right tabular-nums ${r.caught ? 'font-[510] text-ok' : 'text-fg3'}`}>{r.caught}</td>
                  <td className={`py-2.5 pr-4 text-right tabular-nums ${r.missed ? 'font-[510] text-bad' : 'text-fg3'}`}>{r.missed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
