# Readback

An AI agent wrote the pull request. A person still has to read it. Readback makes sure they did.

It turns a pull request into a guided read:

- **A tour, not a diff.** Stops in the order a reader can follow, each with a short explanation, a small diagram and the code.
- **Questions.** One or two per stop, answerable only from the code of that stop. The next stop opens when they are right.
- **One planted bug.** One line the reader sees is changed on purpose. It is a real bug: the project's own tests pass without it and fail with it. The reader flags it, or the read is not approved and they read again with a different one. The branch is never touched.
- **A guide to ask.** It explains any line. It does not say what is wrong.
- **A signature.** A named person, the commit, how many questions they got wrong first, how many reads it took. On GitHub it is the commit status `readback/read`.

## How it is made

| Step | What | Where |
| --- | --- | --- |
| Plan | A model reads the diff, the issue and the checkout and writes the stops and questions. Code checks that every changed source line is on the tour. A second model proposes planted bugs; each is kept only if the project's tests (in Docker, no network) fail with it. | `gen/plan.ts` |
| Tour | No model: highlights the code, marks what the pull request changed, counts coverage. | `gen/materialize.ts` |
| Read | Serves the tour to one reader. Answers and the planted line are checked on the server and never sent to the browser. | `server/` |
| Page | The reading page. | `web/` |

`shared/tour.ts` is the contract between them.

## Run it

```sh
bun install && (cd web && bun install && bun run build)
bun gen/plan.ts --repo <checkout> --base <ref> --head <ref> --pr <owner/name#n> --out data/<name>
bun gen/materialize.ts --repo <checkout> --plan data/<name>/plan.json
RB_TOUR=data/<name>/tour.json GEMINI_API_KEY=... bun server/index.ts   # http://localhost:4410
bun test server
```

`RB_GITHUB=1` also sets the commit status on a signature. `deploy/deploy.sh` puts the public copy on Fly.
