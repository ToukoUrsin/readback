import { useState } from 'react';
import type { Flag, PublicTour, Reveal } from '../../../shared/tour';
import { api } from '../api';
import { Tokens } from '../ui/Code';
import { ArrowRight, Check, FlagFill, Warn, X } from '../ui/icons';
import { RevealCard } from '../ui/Reveal';

interface Props {
  tour: PublicTour;
  /** the planted line the reader just missed, shown once */
  missedNow: Reveal | null;
  setTour: (t: PublicTour) => void;
  setMissedNow: (r: Reveal | null) => void;
  jump: (file: string, line: number) => void;
  unflag: (f: Flag) => void;
  readAgain: () => void;
  reset: () => void;
  go: (stopId: string) => void;
}

const fmtTime = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`);

export function HandIn({ tour, missedNow, setTour, setMissedNow, jump, unflag, readAgain, reset, go }: Props) {
  const { state, short, other } = tour;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const all = tour.stops.flatMap((s) => s.questions);
  const misses = Object.values(state.answers).reduce((a, x) => a + x.misses, 0);
  const titleOf = (id: string) => tour.stops.find((s) => s.id === id)?.title ?? '';
  const lineOf = (f: Flag) => tour.stops.flatMap((s) => s.blocks).flatMap((b) => (b.type === 'code' && b.file === f.file ? b.lines : [])).find((l) => l.n === f.line);

  const handin = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await api.handin();
      setTour(r.tour);
      setMissedNow(r.ok ? null : (r.tour.state.missed.at(-1) ?? null));
      window.scrollTo(0, 0);
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
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /* ---- just missed ---- */
  if (missedNow)
    return (
      <div className="rise mx-auto max-w-[720px] px-4 pt-10 pb-24 sm:px-6 sm:pt-14">
        <span className="chip border-bad/30! bg-bad-soft! text-bad!">
          <X size={12} /> Not approved
        </span>
        <h1 className="mt-4 text-[26px] leading-[1.15] font-[590] tracking-[-0.022em] sm:text-[32px]">{missedNow.headline ?? 'You read past a planted bug.'}</h1>
        <p className="mt-4 mb-6 text-[15.5px] leading-[1.6] text-fg2">Readback changed this line for your read only. It was not among the lines you flagged, so the read does not count and the change stays unapproved.</p>
        <RevealCard r={missedNow} where={titleOf(missedNow.stopId)} />
        {state.exhausted ? (
          <>
            <p className="mt-6 text-[15px] leading-[1.6] text-fg2">That was the last planted line this commit has for you: you have now been shown all of them. Your read of this commit cannot count any more. Someone else has to read it.</p>
            <button className="btn mt-5" onClick={reset}>
              Start over as a new reader
            </button>
          </>
        ) : (
          <>
            <p className="mt-6 text-[15px] leading-[1.6] text-fg2">A different line is changed now, and this one will not be used for you again. Your answers are kept.</p>
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
        <h1 className="mt-4 text-[26px] leading-[1.15] font-[590] tracking-[-0.022em] sm:text-[32px]">This commit needs another reader.</h1>
        <p className="mt-4 text-[15.5px] leading-[1.6] text-fg2">
          You were shown {state.missed.length} planted {state.missed.length === 1 ? 'line' : 'lines'} and flagged none of them. A line you have seen revealed is never planted for you again, so there is nothing left that could show you read this commit. Someone else has to.
        </p>
        <div className="card mt-6 divide-y divide-line">
          {state.missed.map((m) => (
            <div key={`${m.file}:${m.line}`} className="flex items-baseline gap-3 px-4 py-2.5">
              <span className="flex-none font-mono text-[12px] text-fg2">
                {m.file.split('/').pop()}:{m.line}
              </span>
              <span className="min-w-0 text-[13px] leading-[1.5] text-fg3">{m.what}</span>
            </div>
          ))}
        </div>
        <button className="btn mt-6" onClick={reset}>
          Start over as a new reader
        </button>
      </div>
    );

  /* ---- signed ---- */
  if (state.signature) {
    const s = state.signature;
    return (
      <div className="rise mx-auto max-w-[720px] px-4 pt-10 pb-24 sm:px-6 sm:pt-14">
        <span className="chip border-ok/30! bg-ok-soft! text-ok!">
          <Check size={12} /> {short ? 'Short read done' : 'Read and approved'}
        </span>
        <h1 className="mt-4 text-[32px] leading-[1.12] font-[590] tracking-[-0.022em]">{short ? `${s.name} read ${short.stops} of ${short.of} stops.` : `${s.name} read this change.`}</h1>
        <p className="mt-3 text-[15px] text-fg3">
          {new Date(s.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · commit <span className="font-mono text-[13px]">{s.headSha.slice(0, 7)}</span>
        </p>
        <div className="card mt-7 grid grid-cols-2 divide-x divide-y divide-line overflow-hidden sm:grid-cols-4 sm:divide-y-0">
          {[
            ['Stops read', `${tour.stops.length} of ${short ? short.of : tour.stops.length}`],
            ['Questions right', `${s.questions} of ${s.questions}`, s.misses ? `${s.misses} wrong ${s.misses === 1 ? 'try' : 'tries'} first` : 'no wrong tries'],
            ['Planted bug', s.reads === 1 ? 'Caught' : `Caught on read ${s.reads}`, s.reads === 1 ? 'first read' : `missed ${s.reads - 1} before`],
            ['Time', fmtTime(s.seconds), s.lines && s.linesPerMinute ? `${s.lines} lines, ${s.linesPerMinute} a minute` : undefined],
          ].map(([k, v, sub]) => (
            <div key={k} className="px-4 py-3.5">
              <p className="text-[12px] text-fg4">{k}</p>
              <p className="mt-1 text-[16px] font-[590] tracking-[-0.01em] text-fg">{v}</p>
              {sub && <p className="mt-0.5 text-[12px] text-fg4">{sub}</p>}
            </div>
          ))}
        </div>
        {s.fast && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-warn/25 bg-warn/[0.07] px-3.5 py-2.5 text-[13px] leading-[1.5] text-fg2">
            <Warn size={14} className="mt-[2px] flex-none text-warn" />
            <span>
              <span className="font-[590] text-warn">Fast read. </span>
              {s.linesPerMinute} lines a minute is a line a second or more, faster than a person reads code closely. The signature stands, and the record says how fast it was.
            </span>
          </p>
        )}
        {state.caught && (
          <div className="mt-5">
            <RevealCard r={state.caught} where={titleOf(state.caught.stopId)} shownAs="What you were shown, and flagged" />
          </div>
        )}
        {s.flagsForAuthor.length > 0 && (
          <div className="card mt-5 px-4 py-3.5">
            <p className="text-[13px] font-[590] text-fg">
              {s.flagsForAuthor.length} more {s.flagsForAuthor.length === 1 ? 'line' : 'lines'} flagged, sent back to the author as {s.flagsForAuthor.length === 1 ? 'a question' : 'questions'}
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
        <p className="mt-6 text-[13px] leading-[1.6] text-fg3">
          {short ? (
            <>
              A short read does not approve the change: {short.of - short.stops} stops are unread.{' '}
              {other && (
                <a className="text-accent-hi underline-offset-2 hover:underline" href={other.href}>
                  Take the full read
                </a>
              )}
            </>
          ) : tour.githubSoon ? (
            <>
              Within a few seconds the commit status readback/read on GitHub turns green for {s.headSha.slice(0, 7)}, and{' '}
              <a className="text-accent-hi underline-offset-2 hover:underline" href={tour.pr.url} target="_blank" rel="noreferrer">
                the pull request
              </a>{' '}
              is no longer blocked. A new commit needs a new read.{!tour.test && ' From this public copy the status says a visitor read it; your name stays in the record here.'}
            </>
          ) : s.github ? (s.github.ok ? `On GitHub, the commit status readback/read is now green for ${s.headSha.slice(0, 7)}. A new commit needs a new read.` : `GitHub did not take the status: ${s.github.note}`) : 'On this public copy nothing is written to GitHub. On a real repository the signature sets the commit status readback/read, and the merge stays locked without it.'}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button className="btn" onClick={reset}>
            Start over as a new reader
          </button>
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
    return (
      <div className="rise mx-auto max-w-[720px] px-4 pt-10 pb-24 sm:px-6 sm:pt-14">
        <span className="chip border-ok/30! bg-ok-soft! text-ok!">
          <Check size={12} /> Planted bug caught
        </span>
        <h1 className="mt-4 text-[32px] leading-[1.12] font-[590] tracking-[-0.022em]">You caught it{state.read > 1 ? `, on read ${state.read}` : ''}.</h1>
        <p className="mt-4 mb-6 text-[15.5px] leading-[1.6] text-fg2">Readback changed this line for your read only. The agent never wrote it, and the tour now shows the real code again.</p>
        <RevealCard r={state.caught} where={titleOf(state.caught.stopId)} shownAs="What you were shown, and flagged" />
        {others.length > 0 && (
          <p className="mt-5 text-[14px] leading-[1.6] text-fg2">
            You flagged {others.length} more {others.length === 1 ? 'line' : 'lines'}. {others.length === 1 ? 'It was' : 'They were'} not planted, so {others.length === 1 ? 'it goes' : 'they go'} back to the author as {others.length === 1 ? 'a question' : 'questions'}.
          </p>
        )}
        <form
          className="card mt-7 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void sign();
          }}
        >
          <label className="text-[13px] font-[590] text-fg" htmlFor="name">
            Sign the read
          </label>
          <p className="mt-0.5 text-[13px] text-fg3">{short ? `Your name goes on this short read. It does not approve the change.` : 'Your name goes on this commit: you read it and you understood it.'}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input id="name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={80} className="h-[38px] min-w-0 flex-1 rounded-lg border border-line-strong bg-raised px-3 text-[14px] placeholder:text-fg4 focus:border-accent" />
            <button className="btn btn-primary btn-lg" disabled={!name.trim() || busy}>
              {short ? 'Sign' : 'Sign and approve'}
            </button>
          </div>
          {err && <p className="mt-2 text-[13px] text-bad">{err}</p>}
        </form>
      </div>
    );
  }

  /* ---- ready to hand in ---- */
  const tooMany = state.flags.length > tour.maxFlags;
  const open = tour.stops.map((st) => ({ st, n: st.questions.filter((q) => !state.answers[q.id]?.right).length })).filter((x) => x.n > 0);
  const openCount = open.reduce((a, x) => a + x.n, 0);
  return (
    <div className="rise mx-auto max-w-[720px] px-4 pt-10 pb-24 sm:px-6 sm:pt-14">
      <p className="text-[12.5px] font-[510] text-accent-hi">{state.read > 1 ? `Read ${state.read}` : 'Last step'}</p>
      <h1 className="mt-3 text-[26px] leading-[1.15] font-[590] tracking-[-0.022em] sm:text-[32px]">Hand in your review</h1>
      <p className="mt-4 text-[15.5px] leading-[1.6] text-fg2">One of the lines you read was changed on purpose. If it is among the lines you flagged, the review counts. If it is not, you will see what you missed and review again.</p>

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
                  {f.note && <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg3">{f.note}</span>}
                  <button className="ml-auto text-fg4 hover:text-fg" onClick={() => unflag(f)} title="Remove the flag">
                    <X size={12} />
                  </button>
                </div>
                {l && (
                  <div className="code overflow-x-auto border-t border-line bg-bg px-3 py-1.5 whitespace-pre text-fg2">
                    <Tokens tokens={l.tokens} />
                  </div>
                )}
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
        <button className="btn btn-primary btn-lg" disabled={busy || openCount > 0 || state.flags.length === 0 || tooMany} onClick={handin}>
          Hand in <ArrowRight size={15} />
        </button>
        {err ? <span className="text-[13px] text-bad">{err}</span> : tooMany ? <span className="text-[13px] text-bad">Remove {state.flags.length - tour.maxFlags} to hand in.</span> : openCount ? <span className="text-[13px] text-fg3">Answer the open questions first.</span> : null}
      </div>
    </div>
  );
}
