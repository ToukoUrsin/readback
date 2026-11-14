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
  questions: PublicQuestion[];
}

export interface Flag {
  file: string;
  line: number;
  note: string;
}

export interface AnswerState {
  /** wrong tries so far */
  misses: number;
  /** set once answered right */
  right?: { choice: number; explain: string };
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
}
