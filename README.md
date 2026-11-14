# Readback

An AI agent wrote the pull request. A person approves it. Readback checks that the person actually reviewed it.

Live: https://readback-demo.fly.dev

## What a reviewer meets

1. **The cold test** (`/`). A plain pull request view: "An AI agent wrote this pull request. You are the reviewer." Approve, or flag a line. Nothing says a bug is hidden. One line is a bug Readback put there, and the project's own tests fail on it. Approve it and the next screen says what you just approved.
2. **The review** (`/` after the cold test is the short review, `/full` is the whole pull request). The change is cut into stops, in any order:
   - **Read closely.** The lines the guide marked as the ones a person must read, with one sentence on why.
   - **Questions.** One or two per stop, answerable only from the code. A wrong answer points back at the lines.
   - **One planted bug.** One line is changed for this reviewer only (never on the branch). It is a real bug: the project's tests pass without it and fail with it. Flag it (at most 3 flags) and the review counts. Miss it: "Not approved", with the consequence and the failing tests, and a different line is planted.
   - **A guide to ask.** It explains any line. It does not say what is wrong.
3. **The signature.** A named person, the commit, wrong answers, how many reads it took, lines per minute. On GitHub it is the commit status `readback/read`, and the branch rule on `main` requires it.

Rules that keep it honest:

- A planted line a reviewer has been shown is never planted for them again, in the cold test, the short review or the full one. When none is left, the review fails and someone else has to read the commit.
- Access and money bugs are planted first; formatting last. A planted line is kept only if the stop's text or a code comment states what the line must do.
- 60 lines a minute or faster gets a "Fast read" mark on the signature and in the record. It does not block.
- Only the full review approves. The short one says so and never writes to GitHub.

## How it is made

| Step | What | Where |
| --- | --- | --- |
| Plan | A model reads the diff, the issue and the checkout and writes the stops and questions. Code checks every changed source line is on the tour. A second session marks the lines to read closely, without seeing the planted lines. A third proposes planted bugs; each is kept only if the project's tests (Docker, no network) fail with it and the stop states what the line must do. | `gen/plan.ts` |
| Tour | No model: highlights the code, marks what the pull request changed, counts coverage, builds the cold test. | `gen/materialize.ts` |
| Short review | No model: some stops of a finished plan, plus the cold test. | `gen/short.ts` |
| Review | Serves the tour to one reviewer. Answers and planted lines are checked on the server and never sent to the browser. | `server/` |
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
| `/` | cold test, then the short review (2 of 9 stops) |
| `/full` | the full review, the one that approves |
| `/?new=1` | start over as a new reviewer, back to the first screen |
| `/?test=1` | marks this browser as ours: left out of the counts, same planted lines every time, and the signature can be taken back |
| `/api/stats` | the counts, no names |

## What is kept

Every step is one line in `reads.jsonl` (`RB_DATA`; `/data` on Fly, a volume): cold test shown and decided (approve, flag which line, seconds), start, each stop opened, each answer, each flag, each hand-in (read number, caught or missed, which planted line and its kind, whether it sat on a read-closely line, lines per minute), failed reviews, signatures, questions to the guide, start-overs. `shown.json` keeps which planted lines each person has seen.

`GET /api/stats`: `all`, `tours.full`, `tours.short` (started, reads, caughtFirstRead, missedFirstRead, caughtLater, failed, signed, fastSignatures, medians) and `cold` (shown, approved, flaggedPlanted, flaggedOther, skipped, medianSeconds, thenGuided). Test browsers and scripts are left out.

## GitHub

`main` of the example repository requires the status `readback/read`, admins included.

- Self-hosted: `RB_GITHUB=1` sets the status when a full review is signed.
- The public copy has no GitHub token. `deploy/watch-github.ts` (a service on our machine) reads the Fly records every few seconds and sets the status for the live commit: green when a full review is signed, pending again when a test signature is taken back. A visitor's name is not written to GitHub.
- `bun deploy/watch-github.ts --reset` puts the commit back to "nobody has read this".
- `bun deploy/test-status.ts` runs the project's tests offline in Docker and writes the result as `readback/tests`. The example repository's own CI is off: GitHub Actions is locked on that account.

`deploy/deploy.sh` puts the public copy on Fly.
