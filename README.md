# Readback

An AI agent wrote the pull request. A person approves it. Readback checks that the person actually reviewed it.

Live: https://readback-demo.fly.dev

## The idea

Review the lines that need a person. Check that the person did.

1. **The change shows its evidence.** Each part is tied to the acceptance criteria of the issue and to the tests that fail when it breaks. 74 tests pass; 69 one-line bugs were tried against them, 44 were noticed, 25 were not.
2. **The change shows where it comes from.** Entire kept the three agent sessions that wrote it (3.28M tokens). Each stop shows which session wrote its lines and what it was asked; each line to read closely shows what calls its function, from Entire's code graph.
3. **The AI says what it does not decide.** 7 open points: code no criterion asks for, choices the issue leaves open, behaviour no test checks. A person accepts each one or sends it back; accepting a line no test checks takes a written reason.
4. **A person reads closely only what the evidence cannot carry**: lines marked for what they can harm (access, money, stored data), lines where a tried bug went unnoticed, and the open points. In the example that is 103 of 1,372 lines. All 935 changed lines are in the review (the last stop holds what no other stop shows) and can be flagged.
5. **Readback checks the read, and the commit status follows the record.** One rule (`server/gate.ts`) decides whether a signature approves, sends back or changes nothing. The same signature goes to the pull request's trail on Entire (`server/entire.ts`).

`/concept` has the recommendation, principles, trade-offs, limits, failure modes we saw and the decision log. `/numbers` has what this copy has counted, by Tieto's four measures.

## What a reviewer meets

1. **The cold test** (`/`). A plain pull request view: "An AI agent wrote this pull request. You are the reviewer." Approve, or flag a line. Nothing says a bug is hidden. One line is a bug Readback put there, and the project's own tests fail on it. Approve it and the next screen says what you just approved.
2. **The review** (`/` after the cold test is the short review, `/full` is the whole pull request). The change is cut into stops, in any order. Each stop shows:
   - **Its evidence.** The criteria it serves, how many tried bugs the tests noticed there, and how many lines are left for a person.
   - **Read closely.** The lines a person must read, each with the reason: what it can harm, or "No test notices this line. We changed `x` to `y` and all 74 tests still passed."
   - **Open points.** "The AI does not decide this": accept as it is, or send back to the author with what has to change.
   - **Questions.** Drawn for each reviewer from a pool a second model checked with the code and without it (70 written, 43 kept), options in the reviewer's own order. A wrong answer closes the question for 20 seconds, points back at the lines and stays on the record.
   - **One planted bug.** One of the lines to read closely is changed for this reviewer only (never on the branch). It is a real bug: the project's tests pass without it and fail with it. Flag it (at most 3 flags) and say what it does wrong; the reason is checked. Miss it: "Not approved", with the consequence and the failing tests, and a different line is planted.
   - **Where the code comes from.** The agent sessions behind the stop's lines, as Entire holds them: what each was asked, its report, its tokens.
   - **A guide to ask.** It is never given the lines a reviewer signs for; it has the rest of the stop, the callers and the sessions. It does not say what is wrong.
   A stop with nothing to read closely is "carried by its evidence": it asks nothing.
3. **The signature**, and what it does. The rule:
   - the reviewer is known: a GitHub account (sign-in, or a gist only that account can make) on the server's list of reviewers (`RB_REVIEWERS`), or invited with the team's judge link (`/auth/judge?k=…`, `RB_JUDGE_KEY`); a typed name alone is recorded and never approves;
   - every question right, at most 3 wrong tries;
   - the planted bug caught on the first or second read, with the reason;
   - under 15 of the lines to read closely a minute, and every stop that has some was open long enough to scroll;
   - every open point ruled on, with a reason where no test checks the line.
   All of it holds and none sent back: **approved**, `readback/read` green. A point sent back: **sent back**, `readback/read` red, with the points for the author. Anything else: **recorded, not approved**, and nothing changes on GitHub.

Rules that keep it honest:

- A planted line a reviewer has been shown is never planted for them again, in the cold test, the short review or the full one. When none is left, the review fails and someone else has to read the commit.
- A signed-in reviewer has one review of a commit, from whatever browser.
- A line whose real text the evidence quotes is never planted (the two would not match).
- Access and money bugs are planted first; formatting last. A planted line is kept only if the stop's text or a code comment states what the line must do.
- Only the full review approves. The short one says so and never writes to GitHub.

## How it is made

| Step | What | Where |
| --- | --- | --- |
| Plan | A model reads the diff, the issue and the checkout and writes the stops and questions. Code checks every changed source line is on the tour. A second session marks the lines to read closely, without seeing the planted lines. A third proposes planted bugs; each is kept only if the project's tests (Docker, no network) fail with it and the stop states what the line must do. | `gen/plan.ts` |
| Evidence | For each stop: which criteria it serves (a model, quoted), which tests fail when it is changed, one-line bugs tried on its lines and whether any test noticed (all run offline in Docker), what it can harm (a model's reading, quoting the code), and the open points. Code decides from these which lines a person must read. | `gen/evidence.ts` |
| Tour | No model: highlights the code, marks what the pull request changed, counts coverage, builds the cold test. `--rest` adds a last stop with every changed line no other stop shows. | `gen/materialize.ts` |
| History | No model: the agent sessions Entire holds for each commit, which session wrote which lines (`entire blame`), what calls each changed function (`entire graph`), the trail. | `gen/entire.ts` |
| Callers, measured | Asks a model with file tools the same question as the graph, for every changed function; keeps what the model found where the graph listed none. | `gen/efficiency.ts` |
| Questions | One model writes a pool per stop; a second answers each with the code and without it; only questions that need the code are kept. | `gen/questions.ts` |
| Short review | No model: some stops of a finished plan, plus the cold test. | `gen/short.ts` |
| Review | Serves the tour to one reviewer. Answers, planted lines and the reason for a flag are checked on the server; the answer key never reaches the browser. `server/gate.ts` is the rule. | `server/` |
| Page | | `web/` |

`shared/tour.ts` is the contract between them.

## Run it

```sh
bun install && (cd web && bun install && bun run build)
bun gen/plan.ts --repo <checkout> --base <ref> --head <ref> --pr <owner/name#n> --out data/<name>
bun gen/materialize.ts --repo <checkout> --plan data/<name>/plan.json
RB_TOUR=data/<name>/tour.json GEMINI_API_KEY=... bun server/index.ts   # http://localhost:4410
bun test server
```

Without `RB_TOUR` the server serves `data/live/` (full review at `/full`, short review with the cold test at `/` and `/short`). `data/live/README` has the exact commands that made it.

## Links

| Link | What |
| --- | --- |
| `/` | cold test, then the short review (2 stops) |
| `/full` | the full review (10 stops), the one that approves |
| `/auth/judge?k=KEY&to=/full` | the full review as an invited judge: the typed name counts, and on a demo copy (`RB_DEMO_MINUTES`) the approval is taken back after that many minutes |
| `/?new=1` | start over as a new reviewer, back to the first screen |
| `/?test=1` | marks this browser as ours: left out of the counts, same planted lines every time, and the signature can be taken back |
| `/concept` | the recommendation, principles, trade-offs, limits, failure modes, decision log |
| `/numbers` | what this copy has counted, people and our own agents apart |
| `/signin` | prove a GitHub account with a gist (used when the server has no GitHub OAuth app) |
| `/api/numbers` | everything `/numbers` shows, as JSON |
| `/api/stats` | the counts, no names |

## What is kept

Every step is one line in `reads.jsonl` (`RB_DATA`; `/data` on Fly, a volume): cold test shown and decided (approve, flag which line, seconds), start, each stop opened and for how long, each answer, each flag with its reason, each ruling on an open point, each hand-in (read number, caught or missed, which planted line and its kind, whether the reason passed, lines per minute), failed reviews, sign-ins, signatures with the outcome and every check of the rule, questions to the guide, start-overs. `shown.json` keeps which planted lines each person has seen.

`GET /api/numbers`: `people` and `agents` apart (a browser of ours, a script or an agent is never counted as a person), each with the cold test, the reviews, rulings, and caught/missed by pace; `route` (lines and stops routed to a person, per stop); `points`; `readers` (per reader and area of the code: planted bugs met, caught, missed, "needs a second reader"); `rule`; what making the tour and the evidence cost. `GET /api/stats` is the older, smaller count.

## GitHub

`main` of the example repository requires the status `readback/read`, admins included.

- Self-hosted: `RB_GITHUB=1` sets the status when a full review is signed, by the same rule.
- The public copy has no GitHub token. `deploy/watch-github.ts` (a service on our machine) reads the Fly records every few seconds and sets the status for the live commit from the outcome of each signature: green for approved, red for sent back, no change for a review that does not count, pending again when a test signature is taken back.
- `bun deploy/watch-github.ts --reset` puts the commit back to "nobody has read this".
- `bun deploy/test-status.ts` runs the project's tests offline in Docker and writes the result as `readback/tests`. The example repository's own CI is off: GitHub Actions is locked on that account.

`deploy/deploy.sh` puts the public copy on Fly.
