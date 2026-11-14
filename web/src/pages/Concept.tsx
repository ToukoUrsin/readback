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
          <p className="mt-4 text-[17px] leading-[1.4] font-[590] text-fg">Not for the whole change.</p>
          <p className={`${PROSE} mt-2`}>
            Of <B v={r?.linesAll} /> lines shown in this pull request, <B v={r?.linesToRead} /> need a person:
          </p>
          {r && (
            <div className="mt-4 max-w-[620px]">
              <Bar part={r.linesToRead} whole={r.linesAll} className="h-[8px]" />
              <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-fg3">
                <span className="inline-flex items-center gap-[6px]">
                  <span className="size-[8px] rounded-[2px] bg-warn" aria-hidden />
                  <span>
                    <N v={r.linesToRead} /> to read closely ({pct(r.linesToRead, r.linesAll)})
                  </span>
                </span>
                <span className="inline-flex items-center gap-[6px]">
                  <span className="size-[8px] rounded-[2px] border border-line-strong bg-active" aria-hidden />
                  <span>
                    <N v={r.linesAll} /> lines shown
                  </span>
                </span>
              </p>
            </div>
          )}
          <ul className={`${PROSE} mt-4 list-disc space-y-1 pl-[18px] marker:text-fg4`}>
            <li>lines that decide who sees what, move money or change stored data,</li>
            <li>lines where a bug went unnoticed by every test,</li>
            <li>the points the AI does not decide.</li>
          </ul>
          <p className={`${PROSE} mt-4`}>For those lines, yes: Tieto’s people told us on Saturday that for hospitals and banks a person has to read the code. Reading every line with the same care is what produces the ten-second approve.</p>
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
              ['The AI', 'Wrote the code, made the evidence, the questions and the planted bug. It never approves and cannot set the status green.'],
              ['The author', 'Gets the points that were sent back.'],
              ['Who may sign', 'On this copy any GitHub account, and GitHub says whose it is: through its sign-in page, or through a gist only that account can make. A team gives the server its list of reviewers; an account that is not on it is recorded and never approves. A typed name never approves.'],
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
                    The questions are written by a model. We have not seen one fail in our own reads, and we have no check for it beyond that. <span className="text-warn">This is open.</span>
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
              { head: 'Which lines need a person rests on the tests plus a model’s reading of risk.', body: 'A risky line the model did not mark, in code the tests cover well, is shown as context only. Every line stays visible and can be flagged.' },
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
                head: 'A reviewer set on cheating can prepare answers in a second browser and compare what they are shown with the raw diff to find the planted line.',
                body: 'They still need the minutes, a correct reason for the bug, and their verified name on a record that shows the pace. Skipping the read goes from one click with no trace to deliberate fraud with a trace.',
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

        <Section id="failures" title="Failure modes we saw">
          <p className={`${PROSE} mt-4`}>These happened in this project.</p>
          <Failures rule={rule} />
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
        An AI-written change should arrive with its own evidence, and the AI should say what it does not decide. A named person then reads closely only the lines the evidence cannot carry, and the merge gate follows the record of that read, not a click on Approve.
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
    { name: 'Quality', does: 'One rule decides the status (below). The AI cannot approve, and a person cannot approve by clicking.', costs: 'A careful reviewer who is slow at the questions can fail it and must review again.' },
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

function Failures({ rule }: { rule: Numbers['rule'] | undefined }) {
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
    { was: 'The guide gave the planted line away.', more: 'It described what the changed line did.', now: 'Now the guide is given the code as the agent wrote it and never sees the changed line.' },
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
