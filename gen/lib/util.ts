import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  ms: number;
}

/** Run a command without a shell. Never throws on non-zero exit unless `check` is set. */
export function exec(
  cmd: string,
  args: string[],
  opts: { cwd?: string; input?: string; timeoutMs?: number; env?: Record<string, string | undefined>; check?: boolean } = {},
): Promise<ExecResult> {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const p = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env } as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let killed = false;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          killed = true;
          p.kill('SIGKILL');
        }, opts.timeoutMs)
      : null;
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', (e) => {
      if (timer) clearTimeout(timer);
      rej(e);
    });
    p.on('close', (code) => {
      if (timer) clearTimeout(timer);
      const r = { code: killed ? 124 : (code ?? 1), stdout, stderr, ms: Date.now() - t0 };
      if (opts.check && r.code !== 0) rej(new Error(`${cmd} ${args.slice(0, 4).join(' ')} exited ${r.code}: ${stderr.slice(-800) || stdout.slice(-800)}`));
      else res(r);
    });
    p.stdin.on('error', () => {});
    if (opts.input !== undefined) p.stdin.write(opts.input);
    p.stdin.end();
  });
}

export function ensureDir(p: string) {
  mkdirSync(p, { recursive: true });
  return p;
}

export function log(stage: string, msg: string) {
  const t = new Date().toISOString().slice(11, 19);
  console.error(`[${t}] ${stage.padEnd(9)} ${msg}`);
}

/** Run tasks with bounded concurrency, preserving order. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

/** [3,4,5,9] -> "3-5, 9" */
export function ranges(nums: Iterable<number>): string {
  const s = [...new Set(nums)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j]! + 1) j++;
    out.push(i === j ? String(s[i]) : `${s[i]}-${s[j]}`);
    i = j;
  }
  return out.join(', ');
}
