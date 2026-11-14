import { type ReactNode, useEffect, useRef } from 'react';
import type { PublicTour } from '../../../shared/tour';
import { BASE } from '../api';
import { ArrowRight, Bot, Check, Eye, FlagFill, Lock, Pull, Warn, X } from '../ui/icons';
import { tokens } from '../ui/Entire';
import { inline } from '../ui/Prose';

const when = (at: string) => new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function Rows({ rows }: { rows: { mark: ReactNode; title: ReactNode; body: ReactNode }[] }) {
  return (
    <div className="card divide-y divide-line">
      {rows.map((r, i) => (
        <div key={i} className="flex gap-3.5 px-4 py-3.5">
          <span className="mt-px flex size-6 flex-none items-center justify-center rounded-md bg-active">{r.mark}</span>
          <div className="min-w-0">
            <p className="text-[13.5px] font-[590] text-fg">{r.title}</p>
            <p className="mt-0.5 text-[13px] leading-[1.5] text-fg3">{r.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Intro({ tour, onStart }: { tour: PublicTour; onStart: () => void }) {
  const { pr, state, short, other, evidence, rule, commit, entire, followup: fu, after } = tour;
  const todo = tour.stops.filter((s) => s.required);
  const questions = todo.reduce((a, s) => a + s.questions.length, 0);
  const points = evidence?.rulings ?? [];
  const tried = evidence?.changes?.tried ?? tour.stops.reduce((a, s) => a + (s.evidence?.changes.tried ?? 0), 0);
  const caught = evidence?.changes?.caught ?? tour.stops.reduce((a, s) => a + (s.evidence?.changes.caught ?? 0), 0);
  const unnoticed = tried - caught;
  const minutes = Math.max(3, Math.round(tour.lines.required / 10 + questions * 0.5 + points.length * 0.5));
  const kinds = (['unasked', 'open', 'untested'] as const).map((k) => points.filter((p) => p.kind === k).length);
  const answers = points.filter((p) => p.kind === 'answer').length;
  const num = (n: number | string) => <span className="text-[12px] font-[590] text-fg2">{n}</span>;
  const here = short ? 'on these stops' : 'in this change';
  /** 1,372, as every other page writes it */
  const all = tour.lines.all.toLocaleString('en-US');

  const shows = evidence
    ? [
        { mark: num(evidence.criteria.length), title: `${evidence.criteria.length} acceptance criteria, from issue #${pr.issue?.number ?? ''}`, body: 'Every stop names the criteria its code serves. Code that serves none is listed as an open point.' },
        { mark: <Check size={13} className="text-ok" />, title: `${evidence.tests.passed} tests pass${evidence.tests.failed ? `, ${evidence.tests.failed} fail` : ''}`, body: 'The project’s own tests, run offline on this commit.' },
        ...(tried
          ? [
              {
                mark: unnoticed ? <Warn size={13} className="text-warn" /> : <Check size={13} className="text-ok" />,
                title: `${tried} one-line ${tried === 1 ? 'bug' : 'bugs'} tried ${here}: the tests noticed ${tried === 1 && caught === 1 ? 'it' : caught}`,
                body: unnoticed ? `${unnoticed} went unnoticed: every test still passed. ${unnoticed === 1 ? 'That line is' : 'Those lines are'} marked, with the change that was tried.` : 'None went unnoticed, so no line is marked for it.',
              },
            ]
          : []),
        ...(points.length ? [{ mark: <span className="text-[12px] font-[590] text-accent-hi">{points.length}</span>, title: `${points.length} ${points.length === 1 ? 'point' : 'points'} the AI does not decide`, body: [kinds[0] ? `${kinds[0]} nobody asked for` : '', kinds[1] ? `${kinds[1]} the issue leaves open` : '', kinds[2] ? `${kinds[2]} no test checks` : '', answers ? `${answers} sent back by the first reviewer and answered by the author` : ''].filter(Boolean).join(', ') + '. A person rules on each.' }] : []),
        ...(entire && !fu
          ? [
              {
                mark: num(entire.sessions.length),
                title: `${entire.sessions.length} agent sessions wrote it, kept by Entire: ${tokens(entire.sessions.reduce((a, s) => a + s.tokens.total, 0))} tokens`,
                body: `Each stop says which session its lines come from and what that session was asked. Each line to read closely says what calls it, from Entire’s code graph of ${entire.graph.files} files, with no model in between.${entire.trail ? ` The open points are findings on the pull request’s trail on Entire: your rulings are written there.` : ''}`,
              },
            ]
          : []),
      ]
    : [];

  const yours = [
    {
      mark: <Eye size={13} className="text-warn" />,
      title: `Read the change in ${tour.stops.length} ${tour.stops.length === 1 ? 'stop' : 'stops'}`,
      body: evidence
        ? `Each stop says in plain words what its code does, with a diagram where the parts connect. ${tour.lines.required} of ${all} lines are marked “Read closely”: the lines that decide who sees what, move money or change stored data, the lines where a tried bug went unnoticed, and the open points.${tour.stops.some((s) => s.second) ? ' Under each mark you see whether a second model, reading without our marks, marked the line too.' : ''}`
        : 'Each stop says in plain words what its code does. This change has no evidence of its own, so every line has to be read closely.',
    },
    { mark: <Check size={13} className="text-ok" />, title: `Answer ${questions} questions`, body: `Each one can only be answered from the code of its stop. A wrong answer closes the question for ${rule.lockSeconds} seconds and stays on the record.` },
    ...(points.length ? [{ mark: <span className="text-[12px] font-[590] text-accent-hi">?</span>, title: `Rule on ${points.length} open ${points.length === 1 ? 'point' : 'points'}`, body: 'Accept it as it is, or send it back to the author with what has to change. Either way you give your reason, and a reason that would fit any line is refused.' }] : []),
    { mark: <FlagFill size={13} className="text-flag" />, title: 'Catch the planted bug', body: 'One of the lines to read closely was changed for you only, and never on the branch. It is a real bug, and it may be one that no test notices. Flag it and say what it does wrong. The reason is checked.' },
    ...(tour.ask ? [{ mark: <Bot size={13} className="text-accent-hi" />, title: 'Ask the guide', body: 'Click any line to ask about it. The guide explains the code as the agent wrote it. It will not tell you what is wrong.' }] : []),
  ];

  // Enter starts the review, but the page must open at its top: autoFocus would scroll down to the button.
  const start = useRef<HTMLButtonElement>(null);
  useEffect(() => start.current?.focus({ preventScroll: true }), []);

  const gate = [
    tour.via === 'invite' ? 'You came in with the judge link this repository’s team gave out, and you sign with your name. Without the link or a GitHub sign-in, a typed name is recorded and never approves.' : 'You are signed in with GitHub. A typed name is recorded and never approves.',
    `Every question is right, with at most ${rule.maxWrong} wrong tries.`,
    `You flagged the planted bug by read ${rule.maxReads} at the latest, with the reason.`,
    `You read under ${rule.fastLinesPerMinute} of the lines to read closely a minute, and no stop with lines to read closely was open for less time than it takes to scroll through it. The hand-in page shows both before you hand in.`,
    ...(points.length ? ['You ruled on every open point, each with a reason, and sent none back. Send one back and the status turns red for the author, and stays red until the author pushes: no other review approves over it.'] : []),
    ...(fu ? [`The rest of the change stands on the review of ${fu.earlier.headSha.slice(0, 7)} by ${fu.earlier.who}: ${fu.untouched.stops} of its ${fu.untouched.of} stops are untouched by this commit.`] : []),
  ];
  const noticed = fu?.retried?.filter((r) => r.now === 'noticed') ?? [];

  return (
    <div className="rise mx-auto max-w-[720px] px-4 pt-10 pb-24 sm:px-6 sm:pt-16">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-fg3">
        <span className="inline-flex items-center gap-1.5">
          <Pull size={13} className="text-fg4" />
          {pr.repo} #{pr.number}
        </span>
        {pr.authorIsAgent && (
          <>
            <span className="text-fg4 max-sm:hidden">·</span>
            <span className="inline-flex items-center gap-1.5 text-accent-hi">
              <Bot size={13} /> Written by an AI agent
            </span>
          </>
        )}
        <span className="text-fg4 max-sm:hidden">·</span>
        <span className="tabular-nums">
          <span className="text-ok">+{pr.additions}</span> <span className="text-bad">−{pr.deletions}</span> <span className="text-fg4">in</span> {pr.files} files
        </span>
        {short && <span className="ml-1 rounded bg-flag/15 px-1.5 py-px text-[11.5px] font-[590] text-flag">Short review</span>}
        {fu && <span className="ml-1 rounded bg-accent-soft px-1.5 py-px text-[11.5px] font-[590] text-accent-hi">Follow-up review</span>}
      </div>
      <h1 className="mt-4 text-[28px] leading-[1.12] font-[590] tracking-[-0.024em] text-fg sm:text-[36px]">{pr.title}</h1>
      <p className="mt-5 text-[16px] leading-[1.6] text-fg2">{inline(tour.intro)}</p>

      {fu && (
        <>
          <h2 className="mt-9 mb-2.5 text-[13px] font-[590] text-fg">What happened before this commit</h2>
          <Rows
            rows={[
              {
                mark: <X size={12} className="text-flag" />,
                title: (
                  <>
                    {fu.earlier.who} sent pull request #{fu.earlier.pr} back with {fu.points.length} {fu.points.length === 1 ? 'point' : 'points'}
                  </>
                ),
                body: (
                  <>
                    On {when(fu.earlier.at)}, after a review of all {fu.earlier.stops} stops of commit <span className="font-mono text-[12px]">{fu.earlier.headSha.slice(0, 7)}</span>: {fu.earlier.questions} questions right, the planted bug caught on read {fu.earlier.reads}, {Math.round(fu.earlier.seconds / 60)} minutes. {fu.accepted} open points were accepted as they are.
                    {fu.earlier.ours ? ' That first review was our own script, run at a person’s pace, so that this demo has a review to answer. ' : ' '}
                    <a className="text-accent-hi underline-offset-2 hover:underline" href={fu.earlier.href}>
                      Do that review yourself
                    </a>
                  </>
                ),
              },
              ...fu.points.map((p) => ({
                mark: num(p.n),
                title: <>“{p.note}”</>,
                body: (
                  <>
                    <span className="font-mono text-[12px] text-fg2">
                      {p.file}:{p.from}
                    </span>{' '}
                    · What the AI had left open there: {p.found}
                  </>
                ),
              })),
              {
                mark: <Bot size={13} className="text-accent-hi" />,
                title: (
                  <>
                    The author agent answered {fu.answer.minutesAfter < 10 ? fu.answer.minutesAfter.toFixed(1).replace(/\.0$/, '') : Math.round(fu.answer.minutesAfter)} minutes later: one commit, <span className="text-ok">+{fu.answer.added}</span> <span className="text-bad">−{fu.answer.removed}</span>
                  </>
                ),
                body: (
                  <>
                    {fu.answer.recalled > 0 ? `It was given the ${fu.answer.recalled} rulings of that review by Entire Brain, changed the code and ran the tests` : 'It changed the code and ran the tests'}: {fu.answer.tests.before} passed before, {fu.answer.tests.after} pass now. One session of {fu.answer.model}, {fu.answer.turns} steps, {tokens(fu.answer.tokens)} tokens, kept by Entire. Issue{' '}
                    <a className="text-accent-hi underline-offset-2 hover:underline" href={fu.issue.url} target="_blank" rel="noreferrer">
                      #{fu.issue.number}
                    </a>{' '}
                    holds the reviewer’s words as acceptance criteria.
                  </>
                ),
              },
              ...(fu.retried?.length
                ? [
                    {
                      mark: noticed.length === fu.retried.length ? <Check size={13} className="text-ok" /> : <Warn size={13} className="text-warn" />,
                      title: `${fu.retried.length === 1 ? 'The one-line bug' : `${fu.retried.length} one-line bugs`} the tests missed on these lines, tried again: ${noticed.length === fu.retried.length ? (fu.retried.length === 1 ? 'a test fails now' : 'tests fail on all of them now') : `${noticed.length} of ${fu.retried.length} fail a test now`}`,
                      body: (
                        <>
                          {fu.retried.map((r) => (
                            <span key={`${r.file}:${r.line}`} className="block">
                              <span className="font-mono text-[12px] text-fg2">
                                {r.file}:{r.line}
                              </span>{' '}
                              {r.now === 'noticed' ? `fails “${r.failed?.[0] ?? ''}”${(r.failed?.length ?? 0) > 1 ? ` and ${r.failed!.length - 1} more` : ''}.` : 'still passes every test.'}
                            </span>
                          ))}
                          Run offline on this commit, with the same changed line as before.
                        </>
                      ),
                    },
                  ]
                : []),
              {
                mark: <Lock size={13} className="text-fg3" />,
                title: `${fu.untouched.stops} of the ${fu.untouched.of} stops of the first review are untouched: ${fu.untouched.lines.toLocaleString('en-US')} lines stand on it`,
                body: `This commit changes lines of ${fu.touched.length} ${fu.touched.length === 1 ? 'stop' : 'stops'} of that review. You review what it changed: ${tour.lines.all} lines, ${tour.lines.required} of them closely.`,
              },
            ]}
          />
        </>
      )}

      {!short && commit && (
        <p className={`mt-6 flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-[13.5px] leading-[1.5] ${commit.sentBackBy ? 'border-flag/35 bg-flag-soft text-fg' : commit.approvedBy ? 'border-ok/30 bg-ok-soft text-fg' : 'border-line bg-panel text-fg2'}`}>
          {commit.sentBackBy ? <X size={13} className="mt-[3px] flex-none text-flag" /> : commit.approvedBy ? <Check size={14} className="mt-[3px] flex-none text-ok" /> : <Lock size={14} className="mt-[3px] flex-none text-fg3" />}
          <span>
            {commit.sentBackBy ? (
              <>
                Commit <span className="font-mono text-[12.5px]">{pr.headSha.slice(0, 7)}</span> was sent back by <b className="font-[590]">{commit.sentBackBy.who}</b> on {when(commit.sentBackBy.at)}, with {commit.sentBackBy.points} {commit.sentBackBy.points === 1 ? 'point' : 'points'} for the author. A send-back stands until the author pushes a new commit: a review you sign now is recorded, and it does not approve over it.
                {tour.demoMinutes && commit.sentBackBy.who.endsWith('(invited judge)') ? ` On this demo copy an invited judge’s send-back stands for ${tour.demoMinutes} minutes.` : ''}
              </>
            ) : commit.approvedBy ? (
              <>
                Commit <span className="font-mono text-[12.5px]">{pr.headSha.slice(0, 7)}</span> was approved by <b className="font-[590]">{commit.approvedBy.who}</b> on {when(commit.approvedBy.at)}. You can still review it; a second review is recorded too.
              </>
            ) : (
              <>
                Nobody has approved commit <span className="font-mono text-[12.5px]">{pr.headSha.slice(0, 7)}</span> yet. On GitHub it cannot be merged until the status <span className="font-mono text-[12.5px]">readback/read</span> is green.
              </>
            )}
          </span>
        </p>
      )}

      {!short && after && (
        <p className="mt-2 flex items-start gap-2.5 rounded-lg border border-line bg-panel px-3.5 py-2.5 text-[13.5px] leading-[1.5] text-fg2">
          <Pull size={14} className="mt-[3px] flex-none text-fg3" />
          <span>
          An earlier review of this commit was sent back by <b className="font-[590] text-fg">{after.who}</b> on {when(after.at)} with {after.points} {after.points === 1 ? 'point' : 'points'}. The author agent answered {after.minutesAfter} minutes later with one more commit. Reviewing that commit is {after.questions} questions on {after.closely} of {after.lines} lines, not this whole change again.{' '}
          <a className="whitespace-nowrap text-accent-hi underline-offset-2 hover:underline" href={after.href}>
            Open the follow-up review
          </a>
          </span>
        </p>
      )}

      {short && (
        <p className="mt-8 text-[15px] leading-[1.6] text-fg">
          This is the short review: {short.stops} of the {short.of} stops. It works like the full review, but it does not approve the change.{' '}
          {other && (
            <a className="text-accent-hi underline-offset-2 hover:underline" href={other.href}>
              The full review does
            </a>
          )}
        </p>
      )}

      <h2 className="mt-9 mb-2.5 text-[13px] font-[590] text-fg">How you read it</h2>
      <Rows rows={yours} />

      {shows.length > 0 && (
        <>
          <h2 className="mt-8 mb-2.5 text-[13px] font-[590] text-fg">What comes with the change</h2>
          <Rows rows={shows} />
        </>
      )}

      {!short && (
        <>
          <h2 className="mt-8 mb-2.5 text-[13px] font-[590] text-fg">When your signature approves</h2>
          <div className="card px-4 py-3.5">
            <ul className="space-y-1.5">
              {gate.map((g) => (
                <li key={g} className="flex gap-2.5 text-[13px] leading-[1.5] text-fg2">
                  <Check size={13} className="mt-[3px] flex-none text-fg4" />
                  {g}
                </li>
              ))}
            </ul>
            <p className="mt-2.5 border-t border-line pt-2.5 text-[12.5px] leading-[1.5] text-fg3">The commit status follows this rule and nothing else. A review that does not meet it is recorded and changes nothing on GitHub.</p>
          </div>
          <dl className="card mt-2 grid divide-y divide-line text-[12.5px] leading-[1.5] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {(
              [
                ['Who owns the decision?', 'You. Your name goes on the commit status with how you reviewed it. The AI that wrote the change has no way to sign.'],
                ['When not to trust it?', 'When the tests are weak, more lines come to you. Risk marks are a model’s reading: any line can be flagged.'],
                ['How does it scale?', `The closest read goes to ${tour.lines.required} of ${all} lines here. After a send-back only the answer is read again.`],
              ] as const
            ).map(([q, a]) => (
              <div key={q} className="px-4 py-3">
                <dt className="font-[590] text-fg2">{q}</dt>
                <dd className="mt-1 text-fg3">{a}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-3">
        {!short && tour.signIn && !tour.me && !state.startedAt ? (
          <>
            <a className="btn btn-primary btn-lg" href={`/auth/github?to=${BASE || '/full'}`}>
              Sign in with GitHub and start <ArrowRight size={15} />
            </a>
            <button className="btn btn-lg" onClick={onStart}>
              Start without signing in
            </button>
          </>
        ) : (
          <button ref={start} className="btn btn-primary btn-lg" onClick={onStart}>
            {state.startedAt ? 'Continue the review' : 'Start the review'} <ArrowRight size={15} />
          </button>
        )}
        <span className="text-[13px] text-fg3">
          About {minutes} minutes · {tour.lines.required} lines to read closely
        </span>
      </div>
      {!short && (
        <p className="mt-3 text-[13px] leading-[1.5] text-fg3">
          {tour.via === 'invite' ? (
            'You are an invited judge: you came in with the team’s judge link. You have one review of this commit, and you type your name when you sign.'
          ) : tour.me ? (
            <>
              Signed in as <span className="font-[510] text-fg2">@{tour.me.login}</span>. You have one review of this commit, from whatever browser.{' '}
              <a className="text-accent-hi underline-offset-2 hover:underline" href={`/auth/out?to=${BASE || '/full'}`}>
                Sign out
              </a>
            </>
          ) : tour.signIn ? (
            'Without signing in, your review is recorded and cannot approve. Signing in later starts the review again: one that counts begins when the reviewer is known.'
          ) : tour.test ? (
            'This is our own test browser.'
          ) : (
            'GitHub sign-in is not set up on this copy, so a review here is recorded and cannot approve.'
          )}
        </p>
      )}
      {!short && other?.kind === 'short' && (
        <p className="mt-2 text-[13px] text-fg3">
          Only a few minutes?{' '}
          <a className="text-accent-hi underline-offset-2 hover:underline" href={other.href}>
            Take the short review: {other.stops} stops
          </a>
          . It does not approve the change.
        </p>
      )}

      <p className="mt-10 border-t border-line pt-5 text-[12.5px] leading-[1.6] text-fg4">
        <a className="text-fg3 underline-offset-2 hover:text-fg hover:underline" href="/concept">
          The concept, its trade-offs and limits
        </a>{' '}
        ·{' '}
        <a className="whitespace-nowrap text-fg3 underline-offset-2 hover:text-fg hover:underline" href="/numbers">
          What this copy has measured
        </a>
        <br />
        Stops and questions written by {tour.madeBy.model}
        {tour.madeBy.plantModel ? `, bugs planted by ${tour.madeBy.plantModel}` : ''}
        {evidence ? `, evidence made by ${evidence.madeBy.model}` : ''}. Every planted bug and every tried bug was run against the project’s tests.
      </p>
    </div>
  );
}
