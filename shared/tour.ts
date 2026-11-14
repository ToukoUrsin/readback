/**
 * Readback: the contract.
 *
 *   gen/plan.ts         a model reads the pull request and writes a Plan (stops, questions, planted bugs)
 *   gen/materialize.ts  Plan + the repository -> Tour (every code block as highlighted lines)
 *   server/             serves a Tour to one reader; answers and planted bugs never leave the server
 *
 * Line numbers are 1-based and always refer to the file at the head commit of the pull request.
 */

export interface PrInfo {
  repo: string; // "owner/name"
  number: number;
  title: string;
  url: string;
  author: string;
  authorIsAgent: boolean;
  baseSha: string;
  headSha: string;
  additions: number;
  deletions: number;
  files: number;
  issue?: { number: number; title: string; url: string; body: string };
}

/* ---------- Plan: what the model writes ---------- */

export interface Plan {
  schema: 1;
  pr: PrInfo;
  /** two or three plain sentences: what this change does and why it exists */
  intro: string;
  stops: PlanStop[];
  /** every one proven: the project's own tests pass without it and fail with it */
  plants: Plant[];
  madeBy: { model: string; costUsd: number; at: string; plantModel?: string };
  /** set on a short read: it shows only some stops of the full tour, and does not approve the change */
  short?: { stops: number; of: number };
  /** the cold test before a short read: some of the code as a plain diff, nothing said about a hidden bug */
  cold?: { blocks: { file: string; from: number; to: number }[]; plants: string[] };
}

export interface PlanStop {
  /** kebab-case, unique */
  id: string;
  /** a claim, not a file name: "Search runs in the database, not in memory" */
  title: string;
  /** one or two sentences: why this part exists and why it is built this way */
  why: string;
  blocks: PlanBlock[];
  /** one or two; answerable only by someone who read this stop's code */
  questions: Question[];
}

export type PlanBlock = ProseBlock | DiagramBlock | PlanCodeBlock;

/** `code` in backticks and **bold** are the only markup */
export interface ProseBlock {
  type: 'prose';
  text: string;
}

export interface DiagramBlock {
  type: 'diagram';
  title: string;
  /** 3 to 7, in the order the code runs */
  nodes: { id: string; label: string; sub?: string; role: 'new' | 'changed' | 'existing' | 'outside' }[];
  edges: { from: string; to: string; label?: string }[];
}

export interface PlanCodeBlock {
  type: 'code';
  file: string;
  from: number;
  to: number;
  /** notes pinned to single lines, shown beside the code */
  notes?: { line: number; text: string }[];
  /** lines a person must read closely, marked by the model from the real code (it does not know the planted lines) */
  focus?: Focus[];
}

/** why: at most 12 words, what can go wrong here, e.g. "Decides who may revoke a link" */
export interface Focus {
  from: number;
  to: number;
  why: string;
}

export interface Question {
  id: string;
  prompt: string;
  /** three or four */
  options: string[];
  /** index into options */
  answer: number;
  /** shown after a right answer: one or two sentences, names the lines that say so */
  explain: string;
  /** where to look again after a wrong answer */
  reread: { file: string; from: number; to: number };
}

/** One line of the change, altered for the reader only. Never written to the branch. */
export interface Plant {
  id: string;
  file: string;
  line: number;
  /** the full line as it is on the branch */
  original: string;
  /** the full line the reader is shown instead */
  planted: string;
  /** what goes wrong, in plain words */
  what: string;
  /** names of the project's tests that fail with the planted line */
  failedTests: string[];
  /** what kind of harm; a reader meets access and money bugs first, format bugs last */
  kind?: 'access' | 'money' | 'data' | 'logic' | 'format';
  /** one plain sentence that starts with "You would have approved": what the reader would have let through */
  headline?: string;
  /** the words of the stop (prose, note or code comment) that say what this line must do; a plant without them is not kept */
  stated?: string;
  /** the failing tests with what the test run printed for each, when it printed something short */
  failures?: { test: string; message?: string }[];
  /** no test notices this bug: the project's tests were run with this line and all of them passed (gen/untested-plants.ts). Only a reader stops it */
  untested?: boolean;
}

/* ---------- Tour: what the server holds ---------- */

/** [text, colour] ; colour is a hex string or '' for the default */
export type Token = [string, string];

export interface Line {
  /** line number at head; null for a removed line */
  n: number | null;
  kind: 'add' | 'ctx' | 'del';
  tokens: Token[];
}

export interface CodeBlock {
  type: 'code';
  file: string;
  from: number;
  to: number;
  lines: Line[];
  notes?: { line: number; text: string }[];
  focus?: Focus[];
}

export type Block = ProseBlock | DiagramBlock | CodeBlock;

export interface Stop {
  id: string;
  title: string;
  why: string;
  blocks: Block[];
  questions: Question[];
}

export interface TourPlant extends Plant {
  /** the planted line, highlighted in the context of its file */
  tokens: Token[];
  /** the original line, highlighted */
  originalTokens: Token[];
}

export interface Tour {
  schema: 1;
  pr: PrInfo;
  intro: string;
  stops: Stop[];
  plants: TourPlant[];
  /** changed lines of the pull request, and how many of them a reader passes on the tour */
  coverage: { changed: number; onTour: number; files: { file: string; changed: number; onTour: number }[] };
  madeBy: Plan['madeBy'];
  short?: Plan['short'];
  cold?: { blocks: CodeBlock[]; plants: string[] };
}

/* ---------- What a reader's browser gets ---------- */

export interface PublicQuestion {
  id: string;
  prompt: string;
  options: string[];
}

export interface PublicStop {
  id: string;
  title: string;
  why: string;
  blocks: Block[];
  /** empty on a stop the evidence carries: nothing has to be answered there */
  questions: PublicQuestion[];
  /** false when nothing here has to be read closely: the evidence carries the stop, it asks nothing and no line is planted there */
  required: boolean;
  /** how many of the stop's lines a person has to read closely: marked for what they can harm, unnoticed by the tests, or part of an open point */
  closely: number;
  evidence?: StopEvidence;
  /** what a second model marked in this stop, reading the same code without our marks */
  second?: StopSecond;
}

/** One stop as a second reader saw it. `agreed`: lines our marks and the second reader both send to a person. `also`: lines only the second reader would send, on no close-read list: shown with a lighter mark, never counted, never planted */
export interface StopSecond {
  model: string;
  agreed: { file: string; line: number }[];
  also: { file: string; from: number; to: number; harm: string; why: string }[];
}

/** gen/second.ts: a model of another vendor marks the lines a person has to read, with no marks of ours to lean on */
export interface SecondRead {
  schema: 1;
  headSha: string;
  at: string;
  madeBy: { model: string; tokens: { in: number; out: number } };
  counts: { shown: number; ours: number; theirs: number; both: number; oursOnly: number; theirsOnly: number; closely: number };
  stops: { id: string; title: string; shown: number; ours: number; both: number; oursOnly: number; theirs: number; agreed: { file: string; line: number }[]; theirsOnly: { file: string; line: number; harm: string; why: string }[] }[];
}

export interface Flag {
  file: string;
  line: number;
  /** what goes wrong on this line, in the reviewer's words. On the planted line it is checked: a flag without the reason does not count */
  note: string;
}

export interface AnswerState {
  /** wrong tries so far */
  misses: number;
  /** set once answered right */
  right?: { choice: number; explain: string };
  /** after a wrong try the question opens again at this time */
  lockedUntil?: string;
}

export interface Reveal {
  file: string;
  line: number;
  stopId: string;
  original: Token[];
  planted: Token[];
  what: string;
  failedTests: string[];
  kind?: Plant['kind'];
  headline?: string;
  /** what the stop's text or a comment said this line must do */
  stated?: string;
  failures?: Plant['failures'];
  /** the reviewer flagged this line, but their note did not say what it does wrong: the flag did not count */
  noteFailed?: string;
  /** no test notices this bug; `tests` is how many of the project's tests passed with it */
  untested?: boolean;
  tests?: number;
}

/** What the reader did with the cold test: the plain diff before any guided read. */
export interface ColdResult {
  action: 'approve' | 'flag' | 'skip';
  /** the flagged line was the planted one */
  caught: boolean;
  flagged?: { file: string; line: number };
  /** null when skipped: the line was never shown as planted */
  reveal: Reveal | null;
}

export interface Signature {
  name: string;
  at: string;
  headSha: string;
  /** seconds from first stop to signature */
  seconds: number;
  reads: number;
  questions: number;
  misses: number;
  flagsForAuthor: Flag[];
  github?: { ok: boolean; note: string };
  /** lines of code on the tour, and how fast they went by up to the hand-in that caught the bug */
  lines?: number;
  linesPerMinute?: number;
  /** faster than a person reads code closely */
  fast?: boolean;
  /** the GitHub login, when the reviewer signed in: the only kind of name that can approve */
  login?: string;
  /** what this signature does to the commit. Absent on a short read, which decides nothing */
  outcome?: 'approved' | 'sent-back' | 'not-counted';
  /** the rule the commit status follows, check by check, as it stood at the signature */
  checks?: GateCheck[];
  /** how the name was vouched for when it is not GitHub's sign-in page: a gist, or the team's judge link */
  via?: 'gist' | 'invite';
  /** the rulings on the open points as they stood at the signature, with the reviewer's reasons */
  rulings?: Record<string, Ruling>;
  /** the same signature carried to the trail of the pull request on Entire: findings resolved or answered, the trail approved or not */
  entire?: { ok: boolean; note: string };
}

/** One line of the rule a signature has to meet before the commit status turns green. */
export interface GateCheck {
  id: 'who' | 'questions' | 'planted' | 'pace' | 'rulings' | 'earlier' | 'standing';
  ok: boolean;
  text: string;
}

/** The reviewer's ruling on one thing the AI did not decide. */
export interface Ruling {
  decision: 'accept' | 'back';
  /** the reviewer's reason: what the author has to do, or why the code is fine as it is */
  note: string;
  /** the reason was checked by a model to be about these lines (true), or only required (null: the model did not answer) */
  checked?: boolean | null;
}

/** What has been decided about this commit so far, by reviews that counted. */
export interface CommitState {
  approvedBy?: { who: string; at: string; rulings?: Record<string, Ruling> };
  sentBackBy?: { who: string; at: string; points: number; rulings?: Record<string, Ruling> };
}

export interface ReaderState {
  /** 1 on the first read; goes up each time a planted bug is missed */
  read: number;
  answers: Record<string, AnswerState>;
  flags: Flag[];
  /** stops whose questions are all answered right in this read */
  startedAt: string | null;
  /** planted bugs this reader missed on earlier reads */
  missed: Reveal[];
  /** set when the planted bug of this read was caught */
  caught: Reveal | null;
  signature: Signature | null;
  /** the cold test, once decided; null while it is open or when the tour has none */
  cold?: ColdResult | null;
  /** every planted line has been shown to this reader: their read of this commit cannot count any more */
  exhausted?: boolean;
  /** rulings on the things the AI did not decide, by RulingItem id */
  rulings?: Record<string, Ruling>;
  /** on the read that approves, once the planted bug is caught: the rule as it stands for this review */
  checks?: GateCheck[];
}

export interface PublicTour {
  pr: PrInfo;
  intro: string;
  stops: PublicStop[];
  coverage: Tour['coverage'];
  madeBy: Plan['madeBy'];
  /** at most this many lines may be flagged when the read is handed in */
  maxFlags: number;
  state: ReaderState;
  /** whether a signature is written to GitHub as a commit status */
  github: boolean;
  ask: boolean;
  short?: Plan['short'];
  /** a signature here reaches GitHub a few seconds later, through a watcher outside this server */
  githubSoon?: boolean;
  /** our own test read (cookie rb_test): left out of the counts, and its signature can be taken back */
  test?: boolean;
  /** present while the cold test is open; `stops` is empty until it is decided */
  cold?: { blocks: Block[] };
  /** the other read of the same change: the short one from the full tour, the full one from the short */
  other?: { kind: 'short' | 'full'; href: string; stops: number };
  /** on the review of a commit that was once sent back: where the author's answer is reviewed (the follow-up review of the next commit) */
  after?: { href: string; pr: number; url: string; who: string; at: string; points: number; minutesAfter: number; stops: number; questions: number; closely: number; lines: number };
  /** the change's own evidence; each stop carries its part */
  /** `changes`: one-line bugs tried on the stops of this review and how many the tests noticed, whole (a stop's own count leaves out the one a reviewer has as their planted line) */
  evidence?: Pick<Evidence, 'criteria' | 'tests' | 'rulings' | 'madeBy'> & { changes?: { tried: number; caught: number } };
  /** lines of code a person has to read closely, and all lines shown */
  lines: { required: number; all: number };
  /** the rule a signature has to meet (server/gate.ts) */
  rule: { maxWrong: number; maxReads: number; fastLinesPerMinute: number; lockSeconds: number };
  /** GitHub sign-in is set up on this server */
  signIn?: boolean;
  /** the signed-in reviewer */
  me?: { login: string; name?: string };
  /** on the read that approves: who has approved or sent back this commit so far */
  commit?: CommitState;
  /** what Entire holds about the change: the agent sessions behind its lines, what calls each changed function, its trail */
  entire?: Entire;
  /** how this reviewer's name is vouched for, when they are signed in */
  via?: 'gist' | 'invite';
  /** on a demo copy: minutes after which an invited judge's approval is taken back, so the next judge finds the commit blocked */
  demoMinutes?: number;
  /** set on a follow-up review: the review that was sent back, the author's answer, and what this commit leaves untouched */
  followup?: Followup;
}

/* ---------- Evidence: what the change can show for itself, made by gen/evidence.ts ---------- */

/**
 * The evidence of one pull request, stop by stop. Everything a number is said about was run: the project's tests,
 * offline in Docker. Where a model gave an opinion (risk, the questions it leaves to a person) the field says so.
 */
export interface Evidence {
  schema: 1;
  headSha: string;
  /** the acceptance criteria of the issue, word for word */
  criteria: { n: number; text: string }[];
  /** one offline run of the project's tests at the head commit */
  tests: { passed: number; failed: number; at: string };
  /** keyed by stop id; every stop of the tour has one */
  stops: Record<string, StopEvidence>;
  /** what the AI does not decide: a person rules on each one before signing */
  rulings: RulingItem[];
  madeBy: { model: string; costUsd: number; at: string };
}

export interface StopEvidence {
  /** numbers of the acceptance criteria this stop's code serves; empty when no criterion asks for it */
  criteria: number[];
  /** tests that fail when this stop's code is changed (seen in a run), by name */
  tests: string[];
  /** one-line changes tried on this stop's lines, each run against all tests */
  changes: {
    tried: number;
    /** tests failed: the tests notice a change here */
    caught: number;
    /** every test still passed: nothing checks this line */
    survived: { file: string; line: number; original: string; changed: string; effect: string }[];
  };
  /** a model's reading of what this stop can harm; empty = none of these */
  risk: ('access' | 'money' | 'data')[];
  /** one sentence for the risk, quoting the code it rests on; '' when risk is empty */
  riskWhy: string;
  /** 'read': a person has to read this stop. 'evidence': the tests carry it, a person may skim. Decided in code from the fields above */
  route: 'read' | 'evidence';
  /** why, as short reasons a reader can check: "decides who may see an invoice", "2 of 6 changes went unnoticed by the tests" */
  routeWhy: string[];
}

/** One thing the AI found and does not decide. `unasked`: code no acceptance criterion asks for. `open`: a choice the issue leaves open. `untested`: behaviour no test checks. `answer`: the author's answer to a point a reviewer sent back (a follow-up review). */
export interface RulingItem {
  id: string;
  kind: 'unasked' | 'open' | 'untested' | 'answer';
  stopId: string;
  file: string;
  from: number;
  to: number;
  /** what the AI found, one or two plain sentences */
  found: string;
  /** the question the person answers, one sentence ending in a question mark */
  question: string;
}

/* ---------- Follow-up: the author's answer to a review that was sent back, made by gen/followup.ts ---------- */

/**
 * A review was sent back, the author made one more commit, and only what that commit changed is reviewed again.
 * Every field is read from a record: the signature of the earlier review, git, the agent's session on Entire, a test run.
 */
export interface Followup {
  schema: 1;
  /** the commit under review now */
  headSha: string;
  /** the review that was sent back, as its signature recorded it */
  earlier: { pr: number; url: string; headSha: string; who: string; at: string; seconds: number; questions: number; reads: number; stops: number; lines: number; closely: number; ours: boolean; href: string };
  /** the issue Readback wrote from the points sent back: its acceptance criteria are the reviewer's words */
  issue: { number: number; url: string };
  /** the points sent back; `n` is the number of the acceptance criterion made from it */
  points: { id: string; n: number; file: string; from: number; to: number; note: string; found: string }[];
  /** open points the earlier reviewer accepted as they are */
  accepted: number;
  /** the author's answer: one agent session, kept by Entire, and the commit it made */
  answer: {
    commit: string;
    at: string;
    session: string;
    model: string;
    turns: number;
    seconds: number;
    tokens: number;
    /** minutes from the signature that sent the change back to the commit */
    minutesAfter: number;
    /** review rulings the agent was given by `entire brain recall` in that session */
    recalled: number;
    tests: { before: number; after: number };
    added: number;
    removed: number;
  };
  /** stops of the earlier review whose lines this commit does not change: they stand on that review */
  untouched: { stops: number; of: number; lines: number };
  /** stops of the earlier review whose lines this commit changes */
  touched: { id: string; title: string }[];
  /** one-line changes the tests did not notice at the earlier commit, on the lines sent back, tried again at this commit */
  retried?: { file: string; line: number; changed: string; before: 'unnoticed'; now: 'noticed' | 'unnoticed'; failed?: string[] }[];
}

/* ---------- Entire: what the history of the change shows, made by gen/entire.ts ---------- */

/** One agent session behind a commit of the pull request, as Entire holds it (a checkpoint linked to the commit). */
export interface EntireSession {
  id: string;
  agent: string;
  model: string;
  /** the commit this session wrote, and its first line */
  commit: string;
  subject: string;
  checkpoint: string;
  /** what the agent was asked: the first heading of its prompt, and the paragraph under it, word for word */
  asked: string;
  detail: string;
  /** the last thing the agent said: its own report of what it did */
  report: string;
  /** false when only the prompt, the report and the token counts of the session were kept, not its steps */
  transcript: boolean;
  tokens: { total: number; input: number; cacheRead: number; cacheWrite: number; output: number; apiCalls?: number };
}

/** One function the pull request added or changed, and what calls it, from Entire's code graph (no model). */
export interface Reach {
  name: string;
  file: string;
  from: number;
  to: number;
  change: 'added' | 'changed';
  /** code outside the tests that calls it, directly or through one other function (`via`) */
  /** `by: 'model'`: the graph listed no caller for this function, so a model was asked and found this one (gen/efficiency.ts) */
  callers: { name: string; file: string; line?: number; via?: string; by?: 'model' }[];
  /** how many of its callers are test files */
  testCallers: number;
}

export interface Entire {
  schema: 1;
  headSha: string;
  at: string;
  versions: { cli: string; graph: string };
  sessions: EntireSession[];
  /** which session wrote which lines (`entire blame`). `said`: what the agent wrote just before the edit that holds these lines */
  lines: { file: string; from: number; to: number; session: string; said?: string }[];
  reach: Reach[];
  graph: { files: number; symbols: number; relations: number; functions: number; msPerQuery: number };
  /** the pull request as a trail on Entire: its open points are findings there, by RulingItem id */
  trail?: { number: number; url: string; repo: string; findings: Record<string, string> };
}
