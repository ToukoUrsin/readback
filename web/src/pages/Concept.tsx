/**
 * /concept: the recommendation on one page. What we advise, the principles, the rule, who decides, trade-offs, limits,
 * and what went wrong on the way. Every number is read from /api/numbers.
 */
import type { ReactNode } from 'react';
import { ArrowRight } from '../ui/icons';
import { Bar, LoadError, N, type Numbers, Pending, pct, ReviewLink, RuleCard, Section, type SectionRef, Shell, useNumbers } from '../ui/Page';

const SECTIONS: SectionRef[] = [
  { id: 'recommendation', label: 'Recommendation' },
  { id: 'line-by-line', label: 'Line-by-line review?' },
  { id: 'principles', label: 'Principles' },
  { id: 'rule', label: 'The rule' },
  { id: 'owner', label: 'Who owns the decision' },
  { id: 'distrust', label: 'When not to trust it' },
  { id: 'trade-offs', label: 'Trade-offs' },
  { id: 'limits', label: 'Limits' },
  { id: 'scale', label: 'How it scales' },
  { id: 'entire', label: 'What Entire holds' },
  { id: 'failures', label: 'Failure modes we saw' },
  { id: 'log', label: 'Decision log' },
];

const PROSE = 'max-w-[620px] text-[14.5px] leading-[1.65] text-fg2';

/** A number inside a sentence, set a step stronger than the words around it. */
const B = ({ v }: { v: number | string | null | undefined }) => (
  <strong className="font-[590] text-fg">
    <N v={v} />
  </strong>
);

const usd = (x: number | undefined) => (x === undefined ? undefined : `$${x.toFixed(2)}`);

interface Item {
  head: ReactNode;
  body?: ReactNode;
}

/** Statement on the left, what follows from it on the right; stacked on a phone. */
function Pairs({ items }: { items: Item[] }) {
  return (
    <ul className="mt-5 divide-y divide-line border-y border-line">
      {items.map((it, i) => (
        <li key={i} className="py-3.5 sm:grid sm:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] sm:gap-x-8">
          <p className="text-[14px] leading-[1.5] font-[590] text-fg">{it.head}</p>
          {it.body && <p className="mt-1 text-[14px] leading-[1.6] text-fg3 sm:mt-0">{it.body}</p>}
        </li>
      ))}
    </ul>
  );
}

export default function Concept() {
  const { data: n, error, loading } = useNumbers();
  const r = n?.route ?? undefined;
  const rule = n?.rule;

  return (
    <Pending.Provider value={loading}>
      <Shell current="concept" sections={SECTIONS}>
        {error && !n && <LoadError error={error} />}
        <Hero n={n} />

        <Section id="line-by-line" title="Is line-by-line review still the right way?">
          <p className="mt-4 text-[17px] leading-[1.4] font-[590] text-fg">For critical code, yes. For the whole change, no.</p>
          <p className={`${PROSE} mt-2`}>
            A person has to read critical code. Reading every line with the same care is what produces the ten-second approve, so the policy says which lines are critical and holds the reviewer to those. In this pull request that is <B v={r?.linesToRead} /> of <B v={r?.linesAll} /> lines shown.
          </p>
          {r && <Tiers r={r} points={n?.points.length} />}
          <p className={`${PROSE} mt-4`}>
            Who sets the tier: the test runs decide “no test notices a bug here”, a model marks what a line can harm, and the reviewer can flag any line in any tier. A team’s own always-read paths (sign-in, payments, patient data) belong in a file in the repository that the tech lead owns. That file is not built yet: today the marks come from the model and the tests alone.
          </p>
        </Section>

        <Section id="principles" title="Principles">
          <Principles tests={r?.tests.passed} />
        </Section>

        <Section id="rule" title="The rule the commit status follows">
          <p className={`${PROSE} mt-4`}>
            One rule decides the status <code className="icode">readback/read</code>. It is the same list the reviewer sees before signing.
          </p>
          <RuleCard rule={rule} />
        </Section>

        <Section id="owner" title="Who owns the decision?">
          <p className="mt-4 text-[17px] leading-[1.4] font-[590] text-fg">The person who signs.</p>
          <p className={`${PROSE} mt-2`}>Their GitHub login is on the commit status with what they did.</p>
          <dl className="mt-4 divide-y divide-line border-y border-line">
            {[
              ['The AI', 'Wrote the code, made the evidence, the questions and the planted bug. Readback gives it no way to sign: a signature that counts needs a GitHub sign-in or, on this copy, the judge link. An AI that drives a browser under someone’s sign-in can pass the same checks a person can. The rule shows that the signer understood the lines, and the status carries the signer’s name, so a named person answers for it.'],
              ['The author', 'Gets the points that were sent back, each with the reviewer’s reason.'],
              ['A reviewer who misses the planted bug twice', 'Their review is recorded and does not approve; the change goes to another reviewer on the list. Nothing else follows from one failed review. Two misses in a row in the same area show on the numbers page, and that reviewer’s reviews there get a second reader until they catch one.'],
              ['Who may sign', (n?.demo?.reviewers ? `On this copy the ${n.demo.reviewers === 1 ? 'one account' : `${n.demo.reviewers} accounts`} on the repository’s list of reviewers, and GitHub says whose account it is:` : 'On this copy any GitHub account, and GitHub says whose it is:') + ' through its sign-in page, or through a gist only that account can make. A team gives the server its list of reviewers; an account that is not on it is recorded and never approves. A typed name never approves. For the jury only, this copy also has a judge link: who opens it is one invited judge with one review, signs with their own name, and the record and the status say “invited judge”.' + (n?.demo?.minutes ? ` That approval is taken back after ${n.demo.minutes} minutes, so the next judge finds the commit blocked.` : '')],
            ].map(([who, what]) => (
              <div key={who} className="py-3 sm:grid sm:grid-cols-[168px_minmax(0,1fr)] sm:gap-x-6">
                <dt className="text-[13.5px] font-[590] text-fg">{who}</dt>
                <dd className="mt-0.5 text-[14px] leading-[1.6] text-fg2 sm:mt-0">{what}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section id="distrust" title="What would make us not trust our own output?">
          <Pairs
            items={[
              { head: 'A planted bug the tests do not fail on.', body: 'Then we would mark a right reviewer wrong. So a planted line is kept only when the tests pass without it and fail with it, and when the stop states in words what the line must do.' },
              { head: 'Evidence made for another commit.', body: 'The evidence carries the commit it was made for; when it does not match, every line has to be read.' },
              {
                head: 'A question with a wrong answer key.',
                body: (
                  <>
                    A second model answers every question twice: with the stop’s code and without it. Of <N v={n?.questionCheck?.checked} /> questions, <N v={n?.questionCheck?.wrongKey} /> had a key it did not reach with the code, and <N v={n?.questionCheck?.withoutCode} /> it got right without the code. Those are dropped; <N v={n?.questionCheck?.kept} /> are kept. A key both models get wrong the same way would pass. <span className="text-warn">That part is open.</span>
                  </>
                ),
              },
              { head: 'Everybody catching the planted bug at once, or nobody.', body: 'Then it measures nothing. The numbers page shows caught and missed by kind of bug and by pace.' },
              { head: 'The reason check not answering.', body: 'Then the flag counts and the record says the reason was not checked.' },
            ]}
          />
        </Section>

        <Section id="trade-offs" title="Trade-offs">
          <Pairs
            items={[
              { head: 'Minutes for proof.', body: 'A review that counts takes real minutes, also for a reviewer who would have read carefully anyway.' },
              { head: 'During the review one line differs from the branch.', body: 'The real line is shown as soon as it is caught, and the approval covers the real code.' },
              { head: 'Which lines need a person rests on the tests plus a model’s reading of risk.', body: 'A risky line the model did not mark, in code the tests cover well, is shown as context only. Every changed line is in the review and can be flagged: what no stop explains is in the last stop, “The rest of the change”.' },
              { head: 'The guide cannot help with the lines that matter most.', body: 'It is never given a line the reviewer signs for, so it cannot say what such a line does. It answers from the code around it, from what calls it and from what the agent was asked.' },
              { head: 'A new commit needs a new review of the whole change today.', body: 'Reviewing only the stops whose lines changed is the next step, not built.' },
            ]}
          />
        </Section>

        <Section id="limits" title="Limits">
          <Pairs
            items={[
              { head: 'It shows that a person read and understood.', body: 'It does not show the code is right.' },
              {
                head: (
                  <>
                    One sample change in one repository (TypeScript, <N v={r?.tests.passed} /> tests).
                  </>
                ),
                body: (
                  <>
                    <N v={r?.tried} /> one-line bugs were tried, not every possible one.
                  </>
                ),
              },
              {
                head: 'A reviewer set on cheating can compare what they are shown with the raw diff to find the planted line.',
                body: (
                  <>
                    They still need the minutes, a reason that is true of that line only, and their verified name on a record that shows the pace. With a GitHub sign-in a reviewer has one review of a commit, whatever browser they use.{n?.demo?.judgeLink ? ' The judge link on this demo copy is weaker on purpose: every browser that opens it is a new judge with a new review.' : ''} Each reviewer is asked their own draw from <N v={n?.questionCheck?.kept} /> checked questions with the answers in their own order, and a signed review is planted from lines no unsigned visitor is ever shown. Skipping the read goes from one click with no trace to deliberate fraud with a trace.
                  </>
                ),
              },
              {
                head: 'Reverts and incidents take months of real use to count.',
                body: (
                  <>
                    What this copy counts instead is in{' '}
                    <a href="/numbers" className="text-accent-hi underline-offset-2 hover:underline">
                      Numbers
                    </a>
                    : how often a known bug gets past a reviewer, against how fast they read.
                  </>
                ),
              },
              { head: 'Our own recording browser can sign without a GitHub sign-in.', body: 'Opened with a key only the server has, it signs with a typed name as “(test read)” and sets the status. The status text says so. A real installation has no such key.' },
              { head: 'Every status is posted with the team’s GitHub token.', body: 'The reviewer’s name is in the status text, not in GitHub’s “creator” field. A GitHub App would fix that.' },
              { head: 'The numbers from people on this copy are small.', body: 'Runs by our own agents are shown apart and are not results.' },
            ]}
          />
        </Section>

        <Section id="scale" title="How it scales">
          <Pairs
            items={[
              {
                head: 'The scarce thing is the reviewer’s time.',
                body: (
                  <>
                    <N v={r?.linesToRead} /> of <N v={r?.linesAll} /> lines here.
                  </>
                ),
              },
              {
                head: 'Making the review material is machine work per pull request.',
                body: (
                  <>
                    Here <N v={usd(n?.madeBy.plan.costUsd)} /> for stops, questions and planted bugs, <N v={usd(n?.madeBy.evidence?.costUsd)} /> for the evidence, and one offline test run per tried bug.
                  </>
                ),
              },
              { head: 'Weak tests send more lines to people.', body: 'That is the right direction: the saving has to be earned by tests that notice bugs.' },
              { head: 'Per reviewer and area the record keeps caught and missed.', body: 'Two misses in a row in an area means that reviewer’s reviews there need a second reader.' },
              { head: 'It sits on what teams already have.', body: 'A required commit status on the protected branch.' },
            ]}
          />
        </Section>

        <Section id="entire" title="What Entire holds, and what it saves">
          <EntireSection n={n} />
        </Section>

        <Section id="failures" title="Failure modes we saw">
          <p className={`${PROSE} mt-4`}>These happened in this project.</p>
          <Failures rule={rule} q={n?.questionCheck} />
        </Section>

        <Section id="log" title="Decision log">
          <Log />
        </Section>

        <div className="mt-[52px] flex flex-wrap items-center gap-3 border-t border-line pt-8">
          <ReviewLink large />
          <a href="/numbers" className="btn btn-lg">
            See the numbers
          </a>
        </div>
      </Shell>
    </Pending.Provider>
  );
}

/* ---- first screen: the recommendation and the four steps ---- */

function Hero({ n }: { n: Numbers | null }) {
  const r = n?.route ?? undefined;
  const steps: { title: string; body?: ReactNode; live: ReactNode; bar?: boolean }[] = [
    {
      title: 'The change shows its evidence.',
      body: (
        <>
          Each part is tied to the acceptance criteria of issue #<N v={n?.pr.issue?.number} /> and to the tests that fail when it breaks.
        </>
      ),
      live: (
        <>
          <B v={r?.tests.passed} /> tests pass, <B v={r?.tried} /> one-line bugs tried, the tests noticed <B v={r?.caught} />
        </>
      ),
    },
    {
      title: 'The AI says what it does not decide.',
      live: (
        <>
          <B v={n?.points.length} /> open points
        </>
      ),
    },
    {
      title: 'A person reads closely what the evidence cannot carry.',
      live: (
        <>
          <B v={r?.linesToRead} /> of <B v={r?.linesAll} /> lines
        </>
      ),
      bar: true,
    },
    {
      title: 'Readback checks the read, and the commit status follows the record.',
      live: (
        <>
          <B v={n?.questions} /> questions, <B v={1} /> planted bug, pace under <B v={n?.rule.paceLimit} /> lines a minute
        </>
      ),
    },
  ];

  return (
    <section id="recommendation" className="rise scroll-mt-[104px] lg:scroll-mt-[64px]">
      <h1 className="text-[27px] leading-[1.14] font-[590] tracking-[-0.024em] text-fg sm:text-[36px] sm:leading-[1.1]">
        Review the lines that need a person. <br className="hidden sm:block" />
        Check that the person did.
      </h1>
      <p className="mt-4 max-w-[680px] text-[15px] leading-[1.6] text-fg2 sm:mt-5 sm:text-[16px]">
        Tieto told us that in hospitals and banks a person has to read critical code. We keep that rule and make it checkable. An AI-written change arrives with its own evidence and says what it does not decide. A named person reads closely the lines that are critical, and the merge gate follows the record of that read, not a click on Approve.
      </p>

      <ol className="card mt-6 divide-y divide-line sm:mt-7">
        {steps.map((s, i) => (
          <li key={s.title} className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-[14px] px-4 py-3 md:grid-cols-[24px_minmax(0,1fr)_232px] md:gap-x-5 md:py-3.5">
            <span className="mt-px flex size-[24px] items-center justify-center rounded-md bg-active text-[12px] font-[590] text-fg2" aria-hidden>
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-[14px] leading-[1.45] font-[590] text-fg">{s.title}</p>
              {s.body && <p className="mt-0.5 text-[13px] leading-[1.5] text-fg3">{s.body}</p>}
            </div>
            <div className="col-start-2 mt-1.5 min-w-0 text-[13px] leading-[1.5] text-fg3 md:col-start-3 md:mt-px">
              {s.live}
              {s.bar && r && <Bar part={r.linesToRead} whole={r.linesAll} className="mt-[7px] max-w-[232px]" />}
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <ReviewLink large />
        <a href="/numbers" className="btn btn-lg">
          See the numbers
        </a>
      </div>
      {n && (
        <p className="mt-5 text-[12.5px] leading-[1.6] text-fg3">
          The numbers on this page are read from this copy’s record of{' '}
          <a href={n.pr.url} className="text-fg2 underline decoration-line-strong underline-offset-2 hover:text-fg hover:decoration-fg3" target="_blank" rel="noreferrer">
            {n.pr.repo} #{n.pr.number}
          </a>
          , a pull request an AI agent wrote.
        </p>
      )}
    </section>
  );
}

/** The policy as three tiers, with this pull request's own line counts. */
function Tiers({ r, points }: { r: NonNullable<Numbers['route']>; points: number | undefined }) {
  const read = r.stops.filter((s) => s.closely > 0);
  const inRead = read.reduce((a, s) => a + s.lines, 0);
  const rows: [string, number, ReactNode, string][] = [
    [
      'A person reads closely, every time',
      r.linesToRead,
      <>
        Lines that decide who sees what, move money or change stored data. Lines where a bug went unnoticed by every test. The <N v={points} /> points the AI does not decide.
      </>,
      'Questions on these lines, one of them carries a planted bug, every open point needs a ruling with a reason. The signature names the person.',
    ],
    ['Shown with its evidence', inRead - r.linesToRead, 'The other lines of the same parts: each tied to an acceptance criterion and to tests that fail when it breaks.', 'A failing test and a criterion carry them. The reviewer sees them and can flag any of them.'],
    ['Shown, not signed for', r.linesAll - inRead, 'Test files, styles and the README.', 'Nothing here is planted and nothing is asked. They can still be flagged.'],
  ];
  return (
    <div className="card mt-5 divide-y divide-line">
      {rows.map(([name, lines, what, how], i) => (
        <div key={name} className="px-4 py-3 sm:grid sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)] sm:gap-x-6">
          <div>
            <p className="text-[14px] leading-[1.45] font-[590] text-fg">{name}</p>
            <p className="mt-0.5 text-[13px] text-fg3">
              <B v={lines} /> lines ({pct(lines, r.linesAll)})
            </p>
            <Bar part={lines} whole={r.linesAll} tone={i === 0 ? 'bg-warn' : 'bg-fg4'} className="mt-[7px] max-w-[160px]" />
          </div>
          <div className="mt-2 min-w-0 sm:mt-0">
            <p className="text-[13.5px] leading-[1.55] text-fg2">{what}</p>
            <p className="mt-1 text-[13px] leading-[1.55] text-fg3">{how}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---- Entire: sessions, graph, trail, brain ---- */

const big = (x: number | undefined) => (x === undefined ? undefined : x.toLocaleString('en-US'));

function EntireSection({ n }: { n: Numbers | null }) {
  const h = n?.history;
  const c = h?.callers;
  const all = h?.sessions.reduce((a, s) => a + s.tokens, 0);
  const kept = h?.sessions.filter((s) => s.steps).length;
  return (
    <>
      <p className={`${PROSE} mt-4`}>A reviewer rules better knowing why the code exists and what it reaches. Both are facts about the history of the change, and Entire already holds them. Readback reads them from there instead of asking a model to guess.</p>
      <Pairs
        items={[
          {
            head: 'Sessions: why the code exists.',
            body: (
              <>
                The <B v={h?.sessions.length} /> agent sessions that wrote this pull request are Entire checkpoints, each tied to the commit it wrote: <B v={big(all)} /> tokens in all. Every stop says which session its lines come from and what that session was asked, word for word. For <N v={kept} /> of them the whole session is kept; for the others only the prompt, the agent’s report and the token counts, and the page says so.
              </>
            ),
          },
          {
            head: 'Graph: what a line reaches, without a model.',
            body: (
              <>
                Under a line to read closely the page says what calls its function, for every function the change added or altered. It comes from Entire’s code graph of <N v={h?.graph.files} /> files, <N v={big(h?.graph.symbols)} /> symbols and <N v={big(h?.graph.relations)} /> relations, in about <N v={h?.graph.msPerQuery} /> ms a question and no tokens.
              </>
            ),
          },
          {
            head: 'Measured: the same question asked of a model.',
            body: c ? (
              <>
                We asked {c.model} “what calls this function?” for all <B v={c.functions} /> changed functions, with tools to read the repository: <B v={big(c.tokens)} /> tokens and <N v={c.seconds} /> seconds. In <B v={c.same} /> it named the callers the graph had. In <B v={c.modelFoundMore} /> the graph listed none and the model found some, in route handlers that have no name. So Readback takes the graph’s answer and asks a model only where the graph lists no caller: <B v={big(c.mixed.tokens)} /> tokens instead of <N v={big(c.tokens)} /> ({pct(c.tokens - c.mixed.tokens, c.tokens)} fewer){c.mixed.sameAsModel ? ', and the same callers as the model alone' : ''}. Those callers are marked as found by a model.
              </>
            ) : (
              'Not measured on this copy.'
            ),
          },
          {
            head: 'Trails: one decision in both places.',
            body: (
              <>
                The pull request is trail #<N v={h?.trail?.number} /> on Entire and its <N v={h?.trail?.findings} /> open points are findings there. A signature that counts resolves each accepted finding with the reviewer’s reason, answers each one sent back, and approves the trail or asks for changes. The trail’s gates then say what the commit status on GitHub says, by the same rule.
              </>
            ),
          },
          {
            head: 'Brain: the next agent knows what a person ruled.',
            body: (
              <>
                Each ruling that has a reason is written to Entire Brain as a decision of this repository, so an agent that works on it later can recall what a reviewer accepted or refused, and why, before it writes.{n?.demo?.minutes ? ' On this demo copy an invited judge’s rulings are taken out again when their approval lapses.' : ''}
              </>
            ),
          },
        ]}
      />
    </>
  );
}

/* ---- principles: what Readback does, and what it costs ---- */

function Principles({ tests }: { tests: number | undefined }) {
  const rows: { name: string; does: ReactNode; costs: string }[] = [
    { name: 'Risk', does: 'Lines that decide access, money or stored data go to a person whatever the tests say. The planted bug is taken from those kinds first.', costs: 'A person’s minutes on every change that touches them.' },
    {
      name: 'Hallucination',
      does: (
        <>
          Nothing the AI says counts until it was run. Every planted bug makes the project’s own tests fail. Every “the tests do not notice this” is a real one-line change with all <N v={tests} /> tests still passing. Where a model only gives an opinion (what a part can harm, the open points) the page says so and a person rules.
        </>
      ),
      costs: 'Machine time: the tests run once per tried change, offline in Docker.',
    },
    { name: 'Transparency', does: 'Every stop shows which criterion it serves, which tests cover it and how many tried bugs they noticed. Every step of a review is one line in the record. The status on GitHub says who read it and how.', costs: 'The reviewer’s wrong tries and pace are on the record under their name.' },
    { name: 'Confidence', does: 'A measured number, never the model’s feeling: “the tests noticed x of y bugs tried here”. Where it is low, a person reads those lines.', costs: 'It is only as good as the bugs that were tried.' },
    { name: 'Quality', does: 'One rule decides the status (below). The AI that wrote the change has no way to sign, and a person cannot approve by clicking.', costs: 'A careful reviewer who is slow at the questions can fail it and must review again.' },
  ];
  const cols = 'md:grid md:grid-cols-[116px_minmax(0,1fr)_minmax(0,216px)] md:gap-x-6';
  return (
    <div className="mt-5 border-y border-line" role="table" aria-label="Principles">
      <div className={`hidden border-b border-line py-2 text-[12px] font-[510] text-fg3 ${cols}`} role="row">
        <span role="columnheader">Principle</span>
        <span role="columnheader">What Readback does</span>
        <span role="columnheader">What it costs</span>
      </div>
      <div className="divide-y divide-line">
        {rows.map((p) => (
          <div key={p.name} className={`py-3.5 ${cols}`} role="row">
            <p className="text-[14px] leading-[1.6] font-[590] text-fg" role="cell">
              {p.name}
            </p>
            <p className="mt-1 text-[14px] leading-[1.6] text-fg2 md:mt-0" role="cell">
              {p.does}
            </p>
            <p className="mt-2 text-[13.5px] leading-[1.6] text-fg3 md:mt-0" role="cell">
              <span className="font-[510] text-fg2 md:hidden">Costs: </span>
              {p.costs}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- failure modes: what happened, and what holds now ---- */

function Failures({ rule, q }: { rule: Numbers['rule'] | undefined; q: Numbers['questionCheck'] }) {
  const rows: { was: string; more?: string; now: ReactNode }[] = [
    { was: 'The gate did not follow the record.', more: 'A reviewer with 25 wrong tries, 156 lines a minute and the typed name “Linus Torvalds” turned the pull request green.', now: 'Now one rule decides, and a typed name never approves.' },
    {
      was: 'The answers could be guessed through the API.',
      now: (
        <>
          Now a wrong try closes the question for <N v={rule?.lockSeconds} /> seconds and more than <N v={rule?.maxWrong} /> wrong tries fail the rule.
        </>
      ),
    },
    {
      was: 'The guide gave the planted line away. Twice.',
      more: 'First it described what the changed line did. Then, given the code as the agent wrote it, it described the real line, and a judge compared that with the screen.',
      now: 'Now the guide is never given a line the reviewer signs for, in either form. It answers from the rest of the code, from what calls the function (Entire’s code graph) and from what the agent was asked (its sessions).',
    },
    { was: 'One template sentence passed the reason check on three flags.', now: 'Now a reason has to say something true of that line only, and the same sentence on two flags is refused.' },
    { was: 'An unsigned browser could collect the planted lines with their explanations, and the questions were the same for everyone.', now: 'Now a signed review is planted from lines no unsigned visitor is shown, and each reviewer is asked their own draw of the questions.' },
    {
      was: 'Most of our first questions could be answered without the code.',
      more: 'A second model was given the questions without the stop’s code.',
      now: (
        <>
          It answered <N v={q?.first.withoutCode} /> of the first <N v={q?.first.checked} /> right. Those are gone; every question in the pool failed that test.
        </>
      ),
    },
    { was: 'A point no test checks could be accepted with one click.', now: 'Now accepting it needs the reviewer’s reason, and the reason goes on the record, to the author and onto the trail on Entire.' },
    { was: 'A third of the changed lines were in no stop.', more: '282 of 935: the README, a stylesheet and most of the tests.', now: 'Now the last stop shows them. Nothing there has to be read closely, and all of it can be flagged.' },
    { was: 'Flagging the right line by luck or by comparing with the raw diff was enough.', now: 'Now the flag needs a reason, and the reason is checked.' },
    { was: 'Our first split sent whole stops to a person.', more: 'Every stop qualified, so nothing was saved.', now: 'Now it is decided per line.' },
    { was: 'The agent built things nobody asked for.', more: 'A counter table, nine database triggers and an in-memory store of CSV files. Nothing flagged it until the evidence step compared the code with the acceptance criteria.', now: 'It is now an open point a person rules on.' },
    { was: 'All tests passed while one line of the CSV export, changed, let a user download another workspace’s file.', more: 'Found by trying one-line bugs.', now: 'It is now a line a person must read.' },
    { was: 'Our own agents’ test runs were mixed into the counts at first, then hidden, which made the public numbers read zero.', now: 'Now they are shown apart.' },
  ];
  return (
    <ol className="mt-4 divide-y divide-line border-y border-line">
      {rows.map((f, i) => (
        <li key={i} className="grid grid-cols-[22px_minmax(0,1fr)] gap-x-3 py-3.5 md:grid-cols-[22px_minmax(0,1fr)_minmax(0,1fr)] md:gap-x-6">
          <span className="text-[13.5px] leading-[1.55] font-[510] text-fg3 tabular-nums">{i + 1}.</span>
          <div className="min-w-0">
            <p className="text-[14px] leading-[1.5] font-[590] text-fg">{f.was}</p>
            {f.more && <p className="mt-1 text-[13.5px] leading-[1.6] text-fg3">{f.more}</p>}
          </div>
          <p className="col-start-2 mt-2 flex min-w-0 gap-[8px] text-[14px] leading-[1.55] text-fg2 md:col-start-3 md:mt-0">
            <ArrowRight size={13} className="mt-[4px] flex-none text-ok" />
            <span className="min-w-0">{f.now}</span>
          </p>
        </li>
      ))}
    </ol>
  );
}

/* ---- decision log ---- */

function Log() {
  const days: { day: string; iso: string; items: string[] }[] = [
    {
      day: 'Fri 13.11.2026',
      iso: '2026-11-13',
      items: ['A person keeps reading the code. The question we work on is how to know they did.', 'A planted bug must be proven by the project’s own tests, or it is not used.'],
    },
    {
      day: 'Sat 14.11.2026',
      iso: '2026-11-14',
      items: [
        'The first screen is the cold test: a plain pull request and an Approve button, nothing said about the hidden bug.',
        'Only the full review approves. The short one is for trying it.',
        'Tieto told us in person that reviewing only test results is not acceptable for critical software. We kept the close read and cut it to the lines that need it.',
        'After outside judges broke the first gate, the status follows one rule, and reviewers can send a change back.',
        'A typed name cannot approve. GitHub sign-in only.',
        'Agents’ runs are counted and shown apart from people.',
        'The history of the change comes from Entire: the agent’s sessions, the code graph and the trail. Our own model calls stay for what Entire cannot know.',
        'After the second round of outside judges: the guide no longer sees any line a reviewer signs for, questions are drawn per reviewer from a checked pool, and a judge can sign under their own name.',
      ],
    },
  ];
  return (
    <div className="mt-5 divide-y divide-line border-y border-line">
      {days.map((d) => (
        <div key={d.iso} className="py-3.5 sm:grid sm:grid-cols-[116px_minmax(0,1fr)] sm:gap-x-6">
          <time dateTime={d.iso} className="block text-[13px] leading-[1.7] font-[510] text-fg3 tabular-nums">
            {d.day}
          </time>
          <ul className="mt-1.5 space-y-2 sm:mt-0">
            {d.items.map((t) => (
              <li key={t} className="text-[14px] leading-[1.6] text-fg2">
                {t}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
