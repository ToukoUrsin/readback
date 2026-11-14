/**
 * "/signin": a reviewer proves their GitHub account without GitHub's sign-in page. They put a one-time code in a gist
 * and GitHub says whose gist it is (server/auth.ts). Used when this copy has no GitHub OAuth app; Readback is granted nothing.
 */
import { type FormEvent, useEffect, useState } from "react";
import { ArrowRight, Check, Logo } from "../ui/icons";

const target = () => {
  const to = new URLSearchParams(location.search).get("to") ?? "/full";
  return /^\/[A-Za-z0-9/_#?=&.-]*$/.test(to) && !to.startsWith("//")
    ? to
    : "/full";
};

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3.5 border-t border-line px-4 py-4 first:border-t-0 sm:px-5">
      <span className="mt-px flex size-[22px] flex-none items-center justify-center rounded-md bg-active font-mono text-[12px] text-fg2">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-[590] text-fg">{title}</div>
        <div className="mt-1.5 text-[13.5px] leading-[1.55] text-fg2">
          {children}
        </div>
      </div>
    </li>
  );
}

export default function SignIn() {
  const [code, setCode] = useState<{
    code: string;
    minutes: number;
    me?: { login: string };
  } | null>(null);
  const [failed, setFailed] = useState("");
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [login, setLogin] = useState("");
  const to = target();

  useEffect(() => {
    document.title = "Sign in · Readback";
    fetch("/auth/code", { credentials: "same-origin" })
      .then(async (r) => {
        if (!r.ok)
          throw new Error(
            r.status === 404
              ? "Sign-in is not set up on this copy."
              : `The server answered ${r.status}.`,
          );
        setCode(await r.json());
      })
      .catch((e) => setFailed((e as Error).message));
  }, []);

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* no clipboard: the code is selectable */
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !url.trim()) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/auth/proof", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        login?: string;
        error?: string;
      };
      if (!r.ok || !j.login)
        throw new Error(j.error ?? `The server answered ${r.status}.`);
      setLogin(j.login);
      setTimeout(() => location.assign(to), 1400);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const who = login || code?.me?.login;

  return (
    <div className="h-full overflow-y-auto">
      <header className="border-b border-line">
        <div className="mx-auto flex h-12 max-w-[1160px] items-center px-4 sm:px-6">
          <a
            href="/"
            className="flex items-center gap-2 text-[14px] font-[590] tracking-[-0.01em] text-fg"
          >
            <Logo size={20} /> Readback
          </a>
          <a href={to} className="ml-auto text-[13px] text-fg3 hover:text-fg">
            Back to the review
          </a>
        </div>
      </header>
      <main className="rise mx-auto max-w-[620px] px-4 pt-10 pb-24 sm:px-6 sm:pt-16">
        <h1 className="text-[26px] leading-[1.15] font-[590] tracking-[-0.022em] text-fg sm:text-[32px]">
          Sign with a name GitHub vouches for
        </h1>
        <p className="mt-3 text-[15px] leading-[1.6] text-fg2">
          A review only approves under a GitHub account. This copy asks GitHub
          for nothing: you put a code in a gist, and GitHub says whose gist it
          is. Readback gets no access to your account.
        </p>

        {failed ? (
          <p className="mt-8 rounded-lg border border-bad/40 bg-raised px-4 py-3 text-[13.5px] text-fg">
            {failed}
          </p>
        ) : who ? (
          <div className="fade mt-8 rounded-xl border border-ok/40 bg-raised px-4 py-4 sm:px-5">
            <div className="flex items-center gap-2 text-[15px] font-[590] text-fg">
              <Check size={15} className="text-ok" /> GitHub says you are @{who}
              .
            </div>
            <p className="mt-1.5 text-[13.5px] leading-[1.55] text-fg2">
              Your review so far is kept and now carries this name. You can
              delete the gist.
            </p>
            <a className="btn btn-primary btn-lg mt-4" href={to}>
              Continue the review <ArrowRight size={15} />
            </a>
          </div>
        ) : (
          <form onSubmit={submit}>
            <ol className="mt-8 overflow-hidden rounded-xl border border-line bg-raised">
              <Step n={1} title="Copy this code">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="min-h-[34px] rounded-md border border-line-strong bg-bg px-3 py-1.5 font-mono text-[14px] text-fg select-all">
                    {code ? code.code : "one moment"}
                  </code>
                  <button
                    type="button"
                    className="btn"
                    onClick={copy}
                    disabled={!code}
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                {code && (
                  <p className="mt-2 text-[12.5px] text-fg3">
                    Made for this browser only. Good for {code.minutes} minutes.
                  </p>
                )}
              </Step>
              <Step n={2} title="Make a gist with it">
                Open{" "}
                <a
                  className="text-accent-hi underline-offset-2 hover:underline"
                  href="https://gist.github.com/"
                  target="_blank"
                  rel="noreferrer"
                >
                  gist.github.com
                </a>
                , paste the code as the text of the file and create the gist. A
                secret gist is enough.
              </Step>
              <Step n={3} title="Paste the address of the gist">
                <div className="flex flex-wrap gap-2">
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://gist.github.com/your-name/…"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={300}
                    aria-label="Address of the gist"
                    className="h-[38px] min-w-0 flex-1 basis-[240px] rounded-lg border border-line-strong bg-bg px-3 text-[14px] text-fg placeholder:text-fg4 focus:border-accent"
                  />
                  <button
                    className="btn btn-primary btn-lg"
                    disabled={busy || !url.trim() || !code}
                  >
                    {busy ? "Asking GitHub" : "Check with GitHub"}
                  </button>
                </div>
                {err && (
                  <p className="mt-2 text-[13px] text-bad" role="alert">
                    {err}
                  </p>
                )}
              </Step>
            </ol>
            <p className="mt-4 text-[12.5px] leading-[1.55] text-fg3">
              What is kept: your GitHub login, on the record of your review.
              Nothing else is read. A copy with a GitHub app set up shows
              GitHub’s own sign-in page here instead.
            </p>
          </form>
        )}
      </main>
    </div>
  );
}
