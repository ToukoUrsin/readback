import { useEffect, useState } from 'react';
import type { Flag, GateCheck, PublicTour, Reveal } from '../../../shared/tour';
import { api } from '../api';
import { hang, MIN_NOTE, POINT_KIND, Tokens } from '../ui/Code';
import { ArrowRight, Check, FlagFill, Warn, X } from '../ui/icons';
import { RevealCard } from '../ui/Reveal';
import { Title } from '../ui/Title';

interface Props {
  tour: PublicTour;
  /** the planted line the reader just missed, shown once */
  missedNow: Reveal | null;
  setTour: (t: PublicTour) => void;
  setMissedNow: (r: Reveal | null) => void;
  jump: (file: string, line: number) => void;
  unflag: (f: Flag) => void;
  /** set the reason of a flag */
  onFlag: (f: Flag) => void;
  readAgain: () => void;
  reset: () => void;
  go: (stopId: string) => void;
}

/** the page scrolls inside the app frame, not the window */
const toTop = () => {
  document.querySelector('[data-main]')?.scrollTo({ top: 0 });
  window.scrollTo(0, 0);
};

const fmtTime = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`);

/** The rule, check by check: what holds and what does not. */
function Checks({ checks }: { checks: GateCheck[] }) {
  return (
    <ul className="card divide-y divide-line">
      {checks.map((c) => (
        <li key={c.id} className="flex items-start gap-3 px-4 py-2.5 text-[13.5px] leading-[1.45]">
          {c.ok ? <Check size={14} className="mt-[3px] flex-none text-ok" /> : <X size={13} className="mt-[3px] flex-none text-bad" />}
          <span className={c.ok ? 'text-fg2' : 'text-fg'}>{c.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** what the record carries: an approval, a send-back, or neither */
const outcomeOf = (checks: GateCheck[], back: number) => (checks.every((c) => c.ok) ? 'approved' : back > 0 && checks.every((c) => c.ok || c.id === 'rulings') ? 'sent-back' : 'not-counted');

export function HandIn({ tour, missedNow, setTour, setMissedNow, jump, unflag, onFlag, readAgain, reset, go }: Props) {
  const { state, short, other } = tour;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const all = tour.stops.flatMap((s) => s.questions);
  const misses = Object.values(state.answers).reduce((a, x) => a + x.misses, 0);
  const points = tour.evidence?.rulings ?? [];
  const rulings = state.rulings ?? {};
  const sentBack = points.filter((p) => rulings[p.id]?.decision === 'back');
  const titleOf = (id: string) => tour.stops.find((s) => s.id === id)?.title ?? '';
  const lineOf = (f: Flag) => tour.stops.flatMap((s) => s.blocks).flatMap((b) => (b.type === 'code' && b.file === f.file ? b.lines : [])).find((l) => l.n === f.line);

  const handin = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await api.handin();
      setTour(r.tour);
      setMissedNow(r.ok ? null : (r.tour.state.missed.at(-1) ?? null));
      toTop();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const sign = async () => {
    setBusy(true);
    setErr('');
    try {
      setTour({ ...tour, state: await api.sign(name) });
      toTop();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // a signature that counts is carried to GitHub and to Entire by the watcher a few seconds later: show what it did there
  const sig = state.signature;
  const waiting = !!sig && !short && !!tour.githubSoon && !!sig.outcome && sig.outcome !== 'not-counted' && (!sig.github || (!!tour.entire?.trail && !sig.entire));
  useEffect(() => {
    if (!waiting) return;
    let left = 24;
    const t = setInterval(() => {
      if (--left < 0) return clearInterval(t);
      api.tour().then(setTour, () => undefined);
    }, 2500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);

  /* ---- just missed ---- */
  if (missedNow)
    return (
      <div className="rise mx-auto max-w-[720px] px-4 pt-10 pb-24 sm:px-6 sm:pt-14">
        <span className="chip border-bad/30! bg-bad-soft! text-bad!">
          <X size={12} /> Not approved
        </span>
        {missedNow.noteFailed !== undefined ? (
          <>
            <Title text="Right line, wrong reason.">Right line, wrong reason.</Title>
            <p className="mt-4 text-[15.5px] leading-[1.6] text-fg2">
              You flagged the line Readback had changed for this read,{' '}
              <span className="font-mono text-[13.5px]">
                {missedNow.file.split('/').pop()}:{missedNow.line}
              </span>
              , but your reason does not say what the line does wrong. A flag without the reason can be a guess, so this read does not count.
            </p>
            <p className="mt-3 mb-6 rounded-lg border border-line bg-panel px-3.5 py-2.5 text-[13.5px] leading-[1.5] text-fg2">
              <span className="text-fg4">Your reason: </span>
              {missedNow.noteFailed || 'none'}
            </p>
          </>
        ) : (
          <>
            <Title text={missedNow.headline ?? 'You read past a planted bug.'}>{missedNow.headline ?? 'You read past a planted bug.'}</Title>
            <p className="mt-4 mb-6 text-[15.5px] leading-[1.6] text-fg2">
              Before you opened this read, Readback changed one line of the code you were shown:{' '}
              <span className="font-mono text-[13.5px]">
                {missedNow.file.split('/').pop()}:{missedNow.line}
              </span>
              . The agent never wrote it that way. It was there the whole time you read, and it is not among the lines you flagged, so this read does not count and the change stays unapproved.
            </p>
          </>
        )}
        <RevealCard r={missedNow} where={titleOf(missedNow.stopId)} />
        {state.exhausted ? (
          <>
            <p className="mt-6 text-[15px] leading-[1.6] text-fg2">That was the last planted line this commit has for you: you have now been shown all of them. Your read of this commit cannot count any more. Someone else has to read it.</p>
            {!tour.me && (
              <button className="btn mt-5" onClick={reset}>
                Start over as a new reviewer
              </button>
            )}
          </>
        ) : (
          <>
            <p className="mt-6 text-[15px] leading-[1.6] text-fg2">
              The line above is back to what the agent wrote and is never changed for you again. For your next read one other line is changed, somewhere in the lines to read closely. Your answers and rulings are kept.{!short && ` A review can approve up to read ${tour.rule.maxReads}; after that it is recorded and does not approve.`}
            </p>
            <button
              className="btn btn-primary btn-lg mt-5"
              onClick={() => {
                setMissedNow(null);
                readAgain();
              }}
            >
              Review again <ArrowRight size={15} />
            </button>
          </>
        )}
      </div>
    );

  /* ---- every planted line shown, none caught ---- */
  if (state.exhausted)
    return (
      <div className="rise mx-auto max-w-[720px] px-4 pt-10 pb-24 sm:px-6 sm:pt-14">
        <span className="chip border-bad/30! bg-bad-soft! text-bad!">
          <X size={12} /> Read failed
        </span>
        <Title text="This commit needs another reader.">This commit needs another reader.</Title>
        <p className="mt-4 text-[15.5px] leading-[1.6] text-fg2">
          You were shown {state.missed.length} planted {state.missed.length === 1 ? 'line' : 'lines'} and flagged none of them. A line you have seen revealed is never planted for you again, so there is nothing left that could show you read this commit. Someone else has to.
        </p>
        <div className="card mt-6 divide-y divide-line">
          {state.missed.map((m) => (
            <div key={`${m.file}:${m.line}`} className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:items-baseline sm:gap-3">
              <span className="flex-none font-mono text-[12px] text-fg2">
                {m.file.split('/').pop()}:{m.line}
              </span>
              <span className="min-w-0 text-[13px] leading-[1.5] text-fg3">{m.what}</span>
            </div>
          ))}
        </div>
        {!tour.me && (
          <button className="btn mt-6" onClick={reset}>
            Start over as a new reviewer
          </button>
        )}
      </div>
    );

  /* ---- signed ---- */
  if (state.signature) {
    const s = state.signature;
    const o = s.outcome;
    const sha = s.headSha.slice(0, 7);
    const failed = (s.checks ?? []).filter((c) => !c.ok);
    const accepted = points.filter((p) => rulings[p.id]?.decision === 'accept').length;
    return (
      <div className="rise mx-auto max-w-[720px] px-4 pt-10 pb-24 sm:px-6 sm:pt-14">
        {o === 'sent-back' ? (
          <span className="chip border-flag/35! bg-flag-soft! text-flag!">
            <X size={12} /> Sent back to the author
          </span>
        ) : o === 'not-counted' ? (
          <span className="chip border-line-strong! text-fg2!">
            <Warn size={12} className="text-warn" /> Recorded, not approved
          </span>
        ) : (
          <span className="chip border-ok/30! bg-ok-soft! text-ok!">
            <Check size={12} /> {short ? 'Short review done' : 'Read and approved'}
          </span>
        )}
        <Title text={s.name}>
          {short ? `${s.name} reviewed ${short.stops} of ${short.of} stops.` : o === 'sent-back' ? `${s.name} sent this change back.` : o === 'not-counted' ? `${s.name} read this change. The signature does not approve it.` : `${s.name} approved this commit.`}
        </Title>
        <p className="mt-3 text-[15px] text-fg3">
          {new Date(s.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · commit <span className="font-mono text-[13px]">{sha}</span>
          {s.via === 'invite' ? ' · invited judge, name typed' : s.login ? <> · signed in with GitHub as @{s.login}</> : tour.test ? ' · our own test browser' : ' · typed name, not verified'}
        </p>
        <div className="card mt-7 grid grid-cols-2 divide-x divide-y divide-line overflow-hidden sm:grid-cols-4 sm:divide-y-0">
          {(
            [
              ['Questions right', `${s.questions} of ${s.questions}`, s.misses ? `${s.misses} wrong ${s.misses === 1 ? 'try' : 'tries'} first` : 'no wrong tries'],
              ['Planted bug', s.reads === 1 ? 'Caught' : `Caught on read ${s.reads}`, s.reads === 1 ? 'first read, with the reason' : `missed ${s.reads - 1} before`],
              points.length ? ['Open points', `${accepted} accepted`, sentBack.length ? `${sentBack.length} sent back` : 'none sent back'] : ['Stops', `${tour.stops.length} of ${short ? short.of : tour.stops.length}`, undefined],
              s.lines && s.linesPerMinute !== undefined ? ['Time', fmtTime(s.seconds), `${s.lines} lines closely, ${s.linesPerMinute} a minute`] : ['Pace', 'Not claimed', 'questions were answered ahead for a recording'],
            ] as [string, string, string | undefined][]
          ).map(([k, v, sub]) => (
            <div key={k} className="px-4 py-3.5">
              <p className="text-[12px] text-fg4">{k}</p>
              <p className="mt-1 text-[16px] font-[590] tracking-[-0.01em] text-fg">{v}</p>
              {sub && <p className="mt-0.5 text-[12px] leading-[1.4] text-balance text-fg4">{sub}</p>}
            </div>
          ))}
        </div>
        {s.checks && (
          <div className="mt-5">
            <p className="mb-2 text-[13px] font-[590] text-fg">{failed.length ? 'The rule, and where this review did not meet it' : 'The rule this review met'}</p>
            <Checks checks={s.checks} />
          </div>
        )}
        {!s.checks && s.fast && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-warn/25 bg-warn/[0.07] px-3.5 py-2.5 text-[13px] leading-[1.5] text-fg2">
            <Warn size={14} className="mt-[2px] flex-none text-warn" />
            <span>
              <span className="font-[590] text-warn">Fast read. </span>
              {s.linesPerMinute} lines a minute is faster than a person reads code closely. The record says how fast it was.
            </span>
          </p>
        )}
        {points.some((p) => rulings[p.id]) && (
          <div className="card mt-5 px-4 py-3.5">
            <p className="text-[13px] font-[590] text-fg">{sentBack.length ? `${sentBack.length} ${sentBack.length === 1 ? 'point' : 'points'} for the author, ${accepted} accepted` : `What ${s.name} ruled on the open points`}</p>
            {[...sentBack, ...points.filter((p) => rulings[p.id]?.decision === 'accept')].map((p) => (
              <p key={p.id} className="mt-2 text-[13px] leading-[1.5] text-fg3">
                <span className="font-mono text-[12px] text-fg2">
                  {p.file.split('/').pop()}:{p.from}
                  {p.to > p.from ? `–${p.to}` : ''}
                </span>{' '}
                <span className={`font-[590] ${rulings[p.id]!.decision === 'back' ? 'text-flag' : 'text-ok'}`}>{rulings[p.id]!.decision === 'back' ? 'Sent back.' : 'Accepted.'}</span> <span className="text-fg2">{rulings[p.id]!.note || 'No reason given.'}</span>
              </p>
            ))}
          </div>
        )}
        {state.caught && (
          <div className="mt-5">
            <RevealCard r={state.caught} where={titleOf(state.caught.stopId)} shownAs="What you were shown, and flagged" />
          </div>
        )}
        {s.flagsForAuthor.length > 0 && (
          <div className="card mt-5 px-4 py-3.5">
            <p className="text-[13px] font-[590] text-fg">
              {s.flagsForAuthor.length} more {s.flagsForAuthor.length === 1 ? 'line' : 'lines'} flagged, sent to the author as {s.flagsForAuthor.length === 1 ? 'a question' : 'questions'}
            </p>
            {s.flagsForAuthor.map((f) => (
              <p key={`${f.file}:${f.line}`} className="mt-1.5 text-[13px] text-fg3">
                <span className="font-mono text-[12px] text-fg2">
                  {f.file}:{f.line}
                </span>{' '}
                {f.note || 'no note'}
              </p>
            ))}
          </div>
        )}
        {!short && o && o !== 'not-counted' && tour.githubSoon && (
          <div className="card mt-5 divide-y divide-line">
            <p className="px-4 py-2 text-[11.5px] font-[510] text-fg4">Where this signature went</p>
            {(
              [
                ['GitHub', s.github, `Writing the commit status readback/read for ${sha}`],
                ...(tour.entire?.trail ? [['Entire', s.entire, `Writing your rulings to trail #${tour.entire.trail.number}, ${o === 'approved' ? 'and approving it' : 'and asking for changes'}`] as const] : []),
              ] as [string, { ok: boolean; note: string } | undefined, string][]
            ).map(([k, v, wait]) => (
              <div key={k} className="flex items-start gap-3 px-4 py-2.5 text-[13px] leading-[1.45]">
                {v ? v.ok ? <Check size={14} className="mt-[3px] flex-none text-ok" /> : <X size={13} className="mt-[3px] flex-none text-bad" /> : <span className="mt-[5px] size-[10px] flex-none animate-pulse rounded-full bg-fg4" />}
                <span className="w-[52px] flex-none font-[590] text-fg">{k}</span>
                <span className={`min-w-0 [overflow-wrap:anywhere] ${v ? 'text-fg2' : 'text-fg4'}`}>{v ? v.note : `${wait}…`}</span>
              </div>
            ))}
          </div>
        )}
        {!short && s.via === 'invite' && o === 'approved' && tour.demoMinutes ? (
          <p className="mt-3 text-[13px] leading-[1.6] text-fg3">
            This is a demo copy: {tour.demoMinutes} minutes after an invited judge approves, the status and the trail go back to blocked, so the next judge finds the commit unapproved. The record keeps your review.
          </p>
        ) : null}
        <p className="mt-6 text-[13px] leading-[1.6] text-fg3">
          {short ? (
            <>
              A short review does not approve the change: {short.of - short.stops} stops are not reviewed.{' '}
              {other && (
                <a className="text-accent-hi underline-offset-2 hover:underline" href={other.href}>
                  Take the full review
                </a>
              )}
            </>
          ) : o === 'not-counted' ? (
            <>
              Nothing is written to GitHub: the commit status <span className="font-mono text-[12px]">readback/read</span> stays as it was, and{' '}
              <a className="text-accent-hi underline-offset-2 hover:underline" href={tour.pr.url} target="_blank" rel="noreferrer">
                the pull request
              </a>{' '}
              stays blocked until a review meets the rule. This one is kept in the record with everything above.
            </>
          ) : tour.githubSoon ? (
            <>
              Within a few seconds the commit status <span className="font-mono text-[12px]">readback/read</span> on GitHub turns {o === 'sent-back' ? 'red' : 'green'} for {sha}, and{' '}
              <a className="text-accent-hi underline-offset-2 hover:underline" href={tour.pr.url} target="_blank" rel="noreferrer">
                the pull request
              </a>{' '}
              {o === 'sent-back' ? 'stays blocked, with your points for the author in the status.' : 'is no longer blocked.'} A new commit needs a new review.
            </>
          ) : s.github ? (
            s.github.ok ? (
              `On GitHub, the commit status readback/read is now ${o === 'sent-back' ? 'red' : 'green'} for ${sha}. A new commit needs a new review.`
            ) : (
              `GitHub did not take the status: ${s.github.note}`
            )
          ) : (
            'On this copy nothing is written to GitHub. On a real repository the signature sets the commit status readback/read, and the merge stays locked without it.'
          )}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {!tour.me && (
            <button className="btn" onClick={reset}>
              Start over as a new reviewer
            </button>
          )}
          <a className="btn btn-ghost" href="/numbers">
            What this copy has measured
          </a>
          {tour.test && (
            <button className="btn btn-ghost" onClick={async () => setTour({ ...tour, state: await api.unsign() })} title="Test reads only: back to the step before the signature">
              Take the signature back
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ---- caught, not signed yet ---- */
  if (state.caught) {
    const others = state.flags.filter((f) => !(f.file === state.caught!.file && f.line === state.caught!.line));
    const checks = short ? undefined : state.checks;
    const will = checks ? outcomeOf(checks, sentBack.length) : undefined;
    const needsWho = !!checks?.some((c) => c.id === 'who' && !c.ok);
    return (
      <div className="rise mx-auto max-w-[720px] px-4 pt-10 pb-24 sm:px-6 sm:pt-14">
        <span className="chip border-ok/30! bg-ok-soft! text-ok!">
          <Check size={12} /> Planted bug caught
        </span>
        <Title text="You caught it.">You caught it{state.read > 1 ? `, on read ${state.read}` : ''}.</Title>
        <p className="mt-4 mb-6 text-[15.5px] leading-[1.6] text-fg2">Readback changed this line for your review only, and your reason says what it does wrong. The agent never wrote it, and the stops now show the real code again.</p>
        <RevealCard r={state.caught} where={titleOf(state.caught.stopId)} shownAs="What you were shown, and flagged" />
        {others.length > 0 && (
          <p className="mt-5 text-[14px] leading-[1.6] text-fg2">
            You flagged {others.length} more {others.length === 1 ? 'line' : 'lines'}. {others.length === 1 ? 'It was' : 'They were'} not planted, so {others.length === 1 ? 'it goes' : 'they go'} back to the author as {others.length === 1 ? 'a question' : 'questions'}.
          </p>
        )}
        {checks && (
          <div className="mt-7">
            <p className="mb-2 text-[13px] font-[590] text-fg">The rule the commit status follows</p>
            <Checks checks={checks} />
            <p className="mt-2.5 text-[13px] leading-[1.5] text-fg3">
              {will === 'approved'
                ? 'Every check holds. Your signature approves this commit and turns the status green.'
                : will === 'sent-back'
                  ? `The review counts. You sent ${sentBack.length} ${sentBack.length === 1 ? 'point' : 'points'} back, so your signature turns the status red for the author.`
                  : needsWho && checks.filter((c) => !c.ok).length === 1
                    ? 'Everything holds except the name. Sign in with GitHub and this review approves the commit.'
                    : 'Not every check holds, so this signature is recorded and does not approve. Nothing is written to GitHub.'}
            </p>
          </div>
        )}
        <form
          className="card mt-5 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void sign();
          }}
        >
          <label className="text-[13px] font-[590] text-fg" htmlFor="name">
            Sign the review
          </label>
          <p className="mt-0.5 text-[13px] text-fg3">{short ? 'Your name goes on this short review. It does not approve the change.' : tour.via === 'invite' ? 'You came in with the judge link. Type your name: it goes on this commit, on GitHub and on the Entire trail, with the record of how you reviewed it.' : 'Your name goes on this commit, with the record of how you reviewed it.'}</p>
          {tour.me && tour.via !== 'invite' ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button className="btn btn-primary btn-lg" disabled={busy}>
                {will === 'approved' ? `Sign as @${tour.me.login} and approve` : will === 'sent-back' ? `Sign as @${tour.me.login} and send back` : `Sign as @${tour.me.login}`}
              </button>
            </div>
          ) : (
            <>
              {!short && tour.signIn && needsWho && (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <a className="btn btn-primary btn-lg" href={`/auth/github?to=${encodeURIComponent('/full#/handin')}`}>
                    Sign in with GitHub to sign
                  </a>
                  <span className="text-[13px] text-fg3">Your review is kept.</span>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <input id="name" autoFocus={!tour.signIn || !!short || !needsWho} value={name} onChange={(e) => setName(e.target.value)} placeholder={!short && tour.signIn && needsWho ? 'Or type a name: recorded, does not approve' : 'Your name'} maxLength={80} className="h-[38px] min-w-0 flex-1 rounded-lg border border-line-strong bg-raised px-3 text-[14px] placeholder:text-fg4 focus:border-accent" />
                <button className={`btn btn-lg ${!short && tour.signIn && needsWho ? '' : 'btn-primary'}`} disabled={!name.trim() || busy}>
                  {short ? 'Sign' : will === 'approved' ? 'Sign and approve' : will === 'sent-back' ? 'Sign and send back' : 'Sign, without approving'}
                </button>
              </div>
            </>
          )}
          {err && <p className="mt-2 text-[13px] text-bad">{err}</p>}
        </form>
      </div>
    );
  }

  /* ---- ready to hand in ---- */
  const tooMany = state.flags.length > tour.maxFlags;
  const open = tour.stops.map((st) => ({ st, n: st.questions.filter((q) => !state.answers[q.id]?.right).length })).filter((x) => x.n > 0);
  const openCount = open.reduce((a, x) => a + x.n, 0);
  const unruled = points.filter((p) => !rulings[p.id]);
  const bare = state.flags.filter((f) => f.note.trim().length < MIN_NOTE).length;
  return (
    <div className="rise mx-auto max-w-[720px] px-4 pt-10 pb-24 sm:px-6 sm:pt-14">
      <h1 className="text-[26px] leading-[1.15] font-[590] tracking-[-0.022em] sm:text-[32px]">Hand in your review</h1>
      <p className="mt-4 text-[15.5px] leading-[1.6] text-fg2">One of the lines to read closely was changed on purpose. If it is among the lines you flagged, and your reason says what it does wrong, the review counts. If not, you will see what you missed and review again.</p>

      <div className="card mt-7 divide-y divide-line">
        <div className="px-4 py-3">
          <div className="flex items-center gap-3">
            {openCount ? <span className="size-[14px] flex-none rounded-full border-[1.5px] border-fg4" /> : <Check size={14} className="flex-none text-ok" />}
            <span className="text-[13.5px] text-fg">
              {all.length - openCount} of {all.length} questions right
            </span>
            <span className="ml-auto text-[12.5px] text-fg4">{misses ? `${misses} wrong ${misses === 1 ? 'try' : 'tries'}` : 'no wrong tries'}</span>
          </div>
          {open.map(({ st, n }) => (
            <button key={st.id} className="mt-2 ml-[26px] flex items-center gap-2 text-left text-[13px] text-fg3 hover:text-fg" onClick={() => go(st.id)}>
              <ArrowRight size={12} className="flex-none" />
              <span>
                {st.title}: {n} open
              </span>
            </button>
          ))}
        </div>
        {points.length > 0 && (
          <div className="px-4 py-3">
            <div className="flex items-center gap-3">
              {unruled.length ? <span className="size-[14px] flex-none rounded-full border-[1.5px] border-fg4" /> : <Check size={14} className="flex-none text-ok" />}
              <span className="text-[13.5px] text-fg">
                {points.length - unruled.length} of {points.length} open points ruled on
              </span>
              <span className="ml-auto text-[12.5px] text-fg4">{sentBack.length ? `${sentBack.length} sent back` : 'none sent back'}</span>
            </div>
            {unruled.map((p) => (
              <button key={p.id} className="mt-2 ml-[26px] flex items-start gap-2 text-left text-[13px] leading-[1.45] text-fg3 hover:text-fg" onClick={() => jump(p.file, p.from)}>
                <ArrowRight size={12} className="mt-[3px] flex-none" />
                <span>
                  <span className="text-accent-hi">{POINT_KIND[p.kind]}: </span>
                  {p.question}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="px-4 py-3">
          <div className="flex items-center gap-3">
            <FlagFill size={14} className={`flex-none ${state.flags.length ? 'text-flag' : 'text-fg4'}`} />
            <span className="text-[13.5px] text-fg">{state.flags.length === 0 ? 'No line flagged yet' : `${state.flags.length} ${state.flags.length === 1 ? 'line' : 'lines'} flagged`}</span>
            <span className={`ml-auto text-[12.5px] ${tooMany ? 'text-bad' : 'text-fg4'}`}>at most {tour.maxFlags}</span>
          </div>
          {state.flags.length === 0 && <p className="mt-2 pl-[26px] text-[13px] leading-[1.5] text-fg3">Go back through the stops. Click the line that does not do what its stop says, and flag it.</p>}
          {state.flags.map((f) => {
            const l = lineOf(f);
            return (
              <div key={`${f.file}:${f.line}`} className="group mt-2.5 ml-[26px] overflow-hidden rounded-lg border border-line">
                <div className="flex items-center gap-2 px-3 py-1.5">
                  <button className="font-mono text-[12px] text-fg2 hover:text-fg hover:underline" onClick={() => jump(f.file, f.line)}>
                    {f.file}:{f.line}
                  </button>
                  <button className="ml-auto text-fg4 hover:text-fg" onClick={() => unflag(f)} title="Remove the flag">
                    <X size={12} />
                  </button>
                </div>
                {l && (
                  <div className="code border-t border-line bg-bg px-3 py-1.5 [overflow-wrap:anywhere] whitespace-pre-wrap text-fg2" style={hang(l.tokens)}>
                    <Tokens tokens={l.tokens} />
                  </div>
                )}
                <input
                  className={`h-8 w-full border-t px-3 text-[12.5px] text-fg placeholder:text-flag ${f.note.trim().length < MIN_NOTE ? 'border-flag/40 bg-flag-soft' : 'border-line'}`}
                  placeholder="What goes wrong on this line? Needed before you hand in."
                  defaultValue={f.note}
                  maxLength={400}
                  onBlur={(e) => e.target.value !== f.note && onFlag({ ...f, note: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
              </div>
            );
          })}
        </div>
      </div>

      {state.missed.length > 0 && (
        <p className="mt-4 text-[13px] text-fg3">
          Missed before: {state.missed.map((m) => `${m.file.split('/').pop()}:${m.line}`).join(', ')}. These are not planted again.
        </p>
      )}
      <div className="mt-7 flex flex-wrap items-center gap-4">
        <button className="btn btn-primary btn-lg" disabled={busy || openCount > 0 || unruled.length > 0 || state.flags.length === 0 || tooMany || bare > 0} onClick={handin}>
          {busy ? 'Checking your reason' : 'Hand in'} <ArrowRight size={15} />
        </button>
        {err ? (
          <span className="text-[13px] text-bad">{err}</span>
        ) : tooMany ? (
          <span className="text-[13px] text-bad">Remove {state.flags.length - tour.maxFlags} to hand in.</span>
        ) : openCount ? (
          <span className="text-[13px] text-fg3">Answer the open questions first.</span>
        ) : unruled.length ? (
          <span className="text-[13px] text-fg3">Rule on the open points first.</span>
        ) : bare ? (
          <span className="text-[13px] text-flag">Say what goes wrong on each flagged line.</span>
        ) : null}
      </div>
    </div>
  );
}
