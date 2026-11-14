import type { ReactNode } from 'react';
import type { PublicTour } from '../../../shared/tour';
import { ArrowRight, Bot, Check, Eye, FlagFill, Lock, Pull, Warn, X } from '../ui/icons';
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
  const { pr, state, short, other, evidence, rule, commit } = tour;
  const todo = tour.stops.filter((s) => s.required);
  const questions = todo.reduce((a, s) => a + s.questions.length, 0);
  const points = evidence?.rulings ?? [];
  const tried = tour.stops.reduce((a, s) => a + (s.evidence?.changes.tried ?? 0), 0);
  const caught = tour.stops.reduce((a, s) => a + (s.evidence?.changes.caught ?? 0), 0);
  const unnoticed = tour.stops.reduce((a, s) => a + (s.evidence?.changes.survived.length ?? 0), 0);
  const minutes = Math.max(3, Math.round(tour.lines.required / 10 + questions * 0.5 + points.length * 0.5));
  const kinds = (['unasked', 'open', 'untested'] as const).map((k) => points.filter((p) => p.kind === k).length);
  const num = (n: number | string) => <span className="text-[12px] font-[590] text-fg2">{n}</span>;
  const here = short ? 'on these stops' : 'in this change';

  const shows = evidence
    ? [
        { mark: num(evidence.criteria.length), title: `${evidence.criteria.length} acceptance criteria, from issue #${pr.issue?.number ?? ''}`, body: 'Every stop names the criteria its code serves. Code that serves none is listed as an open point.' },
        { mark: <Check size={13} className="text-ok" />, title: `${evidence.tests.passed} tests pass${evidence.tests.failed ? `, ${evidence.tests.failed} fail` : ''}`, body: 'The project’s own tests, run offline on this commit.' },
        ...(tried ? [{ mark: <Warn size={13} className="text-warn" />, title: `${tried} one-line bugs tried ${here}: the tests noticed ${caught}`, body: `${unnoticed} went unnoticed: every test still passed. Those lines are marked, with the change that was tried.` }] : []),
        ...(points.length ? [{ mark: <span className="text-[12px] font-[590] text-accent-hi">{points.length}</span>, title: `${points.length} ${points.length === 1 ? 'point' : 'points'} the AI does not decide`, body: [kinds[0] ? `${kinds[0]} nobody asked for` : '', kinds[1] ? `${kinds[1]} the issue leaves open` : '', kinds[2] ? `${kinds[2]} no test checks` : ''].filter(Boolean).join(', ') + '. A person rules on each.' }] : []),
      ]
    : [];

  const yours = [
    {
      mark: <Eye size={13} className="text-warn" />,
      title: evidence ? `Read ${tour.lines.required} of ${tour.lines.all} lines closely` : `Read ${tour.lines.all} lines`,
      body: evidence ? 'The lines that decide who sees what, move money or change stored data, the lines where a tried bug went unnoticed, and the open points. The rest is shown as context.' : 'This change has no evidence of its own, so every line has to be read.',
    },
    { mark: <Check size={13} className="text-ok" />, title: `Answer ${questions} questions`, body: `Each one can only be answered from the code of its stop. A wrong answer closes the question for ${rule.lockSeconds} seconds and stays on the record.` },
    ...(points.length ? [{ mark: <span className="text-[12px] font-[590] text-accent-hi">?</span>, title: `Rule on ${points.length} open ${points.length === 1 ? 'point' : 'points'}`, body: 'Accept it as it is, or send it back to the author with what has to change.' }] : []),
    { mark: <FlagFill size={13} className="text-flag" />, title: 'Catch the planted bug', body: 'One of the lines to read closely was changed for you only. It is a real bug: the project’s tests fail on it. Flag it and say what it does wrong. The reason is checked.' },
    { mark: <Bot size={13} className="text-accent-hi" />, title: 'Ask the guide', body: 'Click any line to ask about it. The guide explains the code as the agent wrote it. It will not tell you what is wrong.' },
  ];

  const gate = [
    'You are signed in with GitHub. A typed name is recorded and never approves.',
    `Every question is right, with at most ${rule.maxWrong} wrong tries.`,
    `You flagged the planted bug by read ${rule.maxReads} at the latest, with the reason.`,
    `You read under ${rule.fastLinesPerMinute} of the lines to read closely a minute, and opened every stop that has some.`,
    ...(points.length ? ['You ruled on every open point and sent none back. Send one back and the status turns red for the author.'] : []),
  ];

  return (
    <div className="rise mx-auto max-w-[720px] px-4 pt-10 pb-24 sm:px-6 sm:pt-16">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-fg3">
        <span className="inline-flex items-center gap-1.5">
          <Pull size={13} className="text-fg4" />
          {pr.repo} #{pr.number}
        </span>
        {pr.authorIsAgent && (
          <>
            <span className="text-fg4">·</span>
            <span className="inline-flex items-center gap-1.5 text-accent-hi">
              <Bot size={13} /> Written by an AI agent
            </span>
          </>
        )}
        <span className="text-fg4">·</span>
        <span className="tabular-nums">
          <span className="text-ok">+{pr.additions}</span> <span className="text-bad">−{pr.deletions}</span> <span className="text-fg4">in</span> {pr.files} files
        </span>
        {short && <span className="ml-1 rounded bg-flag/15 px-1.5 py-px text-[11.5px] font-[590] text-flag">Short review</span>}
      </div>
      <h1 className="mt-4 text-[28px] leading-[1.12] font-[590] tracking-[-0.024em] text-fg sm:text-[36px]">{pr.title}</h1>
      <p className="mt-5 text-[16px] leading-[1.6] text-fg2">{inline(tour.intro)}</p>

      {!short && commit && (
        <p className={`mt-6 flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-[13.5px] leading-[1.5] ${commit.approvedBy ? 'border-ok/30 bg-ok-soft text-fg' : commit.sentBackBy ? 'border-flag/35 bg-flag-soft text-fg' : 'border-line bg-panel text-fg2'}`}>
          {commit.approvedBy ? <Check size={14} className="mt-[3px] flex-none text-ok" /> : commit.sentBackBy ? <X size={13} className="mt-[3px] flex-none text-flag" /> : <Lock size={14} className="mt-[3px] flex-none text-fg3" />}
          <span>
            {commit.approvedBy ? (
              <>
                Commit <span className="font-mono text-[12.5px]">{pr.headSha.slice(0, 7)}</span> was approved by <b className="font-[590]">{commit.approvedBy.who}</b> on {when(commit.approvedBy.at)}. You can still review it; a second review is recorded too.
              </>
            ) : commit.sentBackBy ? (
              <>
                Commit <span className="font-mono text-[12.5px]">{pr.headSha.slice(0, 7)}</span> was sent back by <b className="font-[590]">{commit.sentBackBy.who}</b> on {when(commit.sentBackBy.at)}, with {commit.sentBackBy.points} {commit.sentBackBy.points === 1 ? 'point' : 'points'} for the author.
              </>
            ) : (
              <>
                Nobody has approved commit <span className="font-mono text-[12.5px]">{pr.headSha.slice(0, 7)}</span> yet. On GitHub it cannot be merged until the status <span className="font-mono text-[12.5px]">readback/read</span> is green.
              </>
            )}
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

      {shows.length > 0 && (
        <>
          <h2 className="mt-9 mb-2.5 text-[13px] font-[590] text-fg">What the change shows for itself</h2>
          <Rows rows={shows} />
        </>
      )}

      <h2 className="mt-8 mb-2.5 text-[13px] font-[590] text-fg">What is left for you</h2>
      <Rows rows={yours} />

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
        </>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-3">
        {!short && tour.signIn && !tour.me && !state.startedAt ? (
          <>
            <a className="btn btn-primary btn-lg" href="/auth/github?to=/full">
              Sign in with GitHub and start <ArrowRight size={15} />
            </a>
            <button className="btn btn-lg" onClick={onStart}>
              Start without signing in
            </button>
          </>
        ) : (
          <button className="btn btn-primary btn-lg" onClick={onStart} autoFocus>
            {state.startedAt ? 'Continue the review' : 'Start the review'} <ArrowRight size={15} />
          </button>
        )}
        <span className="text-[13px] text-fg3">
          About {minutes} minutes · {tour.lines.required} lines to read closely
        </span>
      </div>
      {!short && (
        <p className="mt-3 text-[13px] leading-[1.5] text-fg3">
          {tour.me ? (
            <>
              Signed in as <span className="font-[510] text-fg2">@{tour.me.login}</span>. You have one review of this commit, from whatever browser.{' '}
              <a className="text-accent-hi underline-offset-2 hover:underline" href="/auth/out?to=/full">
                Sign out
              </a>
            </>
          ) : tour.signIn ? (
            'Without signing in, your review is recorded and cannot approve. You can sign in later and keep it.'
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
        <a className="text-fg3 underline-offset-2 hover:text-fg hover:underline" href="/numbers">
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
