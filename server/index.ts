/**
 * bun server/index.ts
 *   PORT            default 4410
 *   RB_TOUR         default data/live/tour.json
 *   RB_GITHUB=1     a signature also sets the commit status readback/read (through this box's gh)
 *   GEMINI_API_KEY  turns on the guide (RB_ASK_MODEL, default gemini-4-hydrogen)
 *   RB_PREP_KEY        with /full?test=1&prep=<key>&leave=<stop id> the questions are answered ahead, for a recording
 *   RB_GITHUB_WATCH=1  says on the page that a signed full read reaches GitHub within seconds (deploy/watch-github.ts does it)
 *   RB_PUBLIC_URL   address people reach this server at, used as the link on the GitHub status
 *   HOST            default 127.0.0.1
 *   RB_TOUR_SHORT   default data/live/short.json ; when the file exists it is served at / and /short, and the full read at /full
 *   RB_DATA         where reads are kept, default data/readers ; RB_KEEP=0 keeps nothing on disk
 *   RB_EVIDENCE     default data/live/evidence.json (gen/evidence.ts); without the file every stop has to be read
 *   RB_GITHUB_CLIENT_ID, RB_GITHUB_CLIENT_SECRET   a GitHub OAuth app: turns on "Sign in with GitHub" (callback <RB_PUBLIC_URL>/auth/callback)
 *   RB_REVIEWERS       comma list of GitHub logins whose review can approve. Unset: any GitHub account (the public demo)
 *   RB_AUTH_SECRET     signs the sign-in cookie. Alone (no OAuth app) a reviewer proves the GitHub account with a gist
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Evidence, Tour } from "../shared/tour";
import { createApp, createShown } from "./app";
import { createAuth } from "./auth";
import { createGrade } from "./grade";
import { numbers } from "./numbers";
import { setStatus } from "./github";
import { createStore } from "./store";

const ROOT = resolve(import.meta.dir, "..");
const read = (p: string) => JSON.parse(readFileSync(p, "utf8")) as Tour;
const tour = read(resolve(ROOT, process.env.RB_TOUR ?? "data/live/tour.json"));
const shortPath = resolve(
  ROOT,
  process.env.RB_TOUR_SHORT ?? "data/live/short.json",
);
const shortTour = existsSync(shortPath) ? read(shortPath) : null;
const github = process.env.RB_GITHUB === "1";
const key = process.env.GEMINI_API_KEY;
const port = Number(process.env.PORT ?? 4410);
const dataDir =
  process.env.RB_KEEP === "0"
    ? null
    : resolve(ROOT, process.env.RB_DATA ?? "data/readers");
const store = createStore(dataDir);
const distDir = resolve(ROOT, "web/dist");
// one budget for both reads
const ask = key
  ? {
      key,
      model: process.env.RB_ASK_MODEL || "gemini-4-hydrogen",
      budget: Number(process.env.RB_ASK_BUDGET || 2000),
    }
  : undefined;

const evidencePath = resolve(
  ROOT,
  process.env.RB_EVIDENCE ?? "data/live/evidence.json",
);
const evidence = existsSync(evidencePath)
  ? (JSON.parse(readFileSync(evidencePath, "utf8")) as Evidence)
  : undefined;
const grade = key
  ? createGrade({ key, model: process.env.RB_ASK_MODEL || "gemini-4-hydrogen" })
  : undefined;
const publicUrl = process.env.RB_PUBLIC_URL ?? `http://localhost:${port}`;
const authSecret =
  process.env.RB_AUTH_SECRET || process.env.RB_GITHUB_CLIENT_SECRET;
// with an OAuth app: GitHub's sign-in page. Without one: the reviewer proves the account with a gist. Either way GitHub says who it is
const auth = authSecret
  ? createAuth({
      clientId: process.env.RB_GITHUB_CLIENT_ID,
      clientSecret: process.env.RB_GITHUB_CLIENT_SECRET,
      secret: authSecret,
      publicUrl,
    })
  : null;

const reviewers = process.env.RB_REVIEWERS
  ? process.env.RB_REVIEWERS.toLowerCase()
      .split(",")
      .map((x) => x.trim().replace(/^@/, ""))
      .filter(Boolean)
  : undefined;

const shown = createShown(store);
const full = createApp({
  tour,
  key: "full",
  store,
  shown,
  distDir,
  ask,
  evidence,
  grade,
  me: auth?.me,
  signIn: !!auth,
  reviewers,
  githubSoon: process.env.RB_GITHUB_WATCH === "1",
  prepKey: process.env.RB_PREP_KEY || undefined,
  setStatus: github ? setStatus : undefined,
  publicUrl: process.env.RB_PUBLIC_URL,
  other: shortTour
    ? { kind: "short", href: "/", stops: shortTour.stops.length }
    : undefined,
});
// the short read never writes to GitHub: it does not approve anything
const short = shortTour
  ? createApp({
      tour: shortTour,
      key: "short",
      cookie: "rb_short",
      store,
      shown,
      distDir,
      ask,
      evidence,
      grade,
      other: { kind: "full", href: "/full", stops: tour.stops.length },
    })
  : null;

// "/" and "/short" are the short read (it opens with the cold test), "/full" is the read that approves
Bun.serve({
  port,
  hostname: process.env.HOST ?? "127.0.0.1",
  idleTimeout: 90,
  fetch(req) {
    const u = new URL(req.url);
    const under = (p: string) =>
      u.pathname === p || u.pathname.startsWith(`${p}/`);
    const strip = (
      p: string,
      app: { fetch: (r: Request) => Response | Promise<Response> },
    ) => {
      u.pathname = u.pathname.slice(p.length) || "/";
      return app.fetch(new Request(u, req));
    };
    if (auth && under("/auth")) return auth.app.fetch(req);
    // the numbers of this copy: what people did, what agents did, and what the evidence routes to a person
    if (u.pathname === "/api/numbers")
      return Response.json(numbers(store.events(), { tour, evidence }), {
        headers: { "cache-control": "no-store" },
      });
    if (under("/full")) return strip("/full", full);
    if (short && under("/short")) return strip("/short", short);
    return (short ?? full).fetch(req);
  },
});
console.log(
  `Readback on http://localhost:${port} · ${tour.pr.repo}#${tour.pr.number} · ${tour.stops.length} stops${shortTour ? ` · short read ${shortTour.stops.length} stops at / , full read at /full` : ""} · guide ${key ? "on" : "off"} · evidence ${evidence ? "on" : "off"} · sign-in ${auth ? "on" : "off"} · GitHub ${github ? "on" : "off"} · readers kept in ${dataDir ?? "memory only"}`,
);
