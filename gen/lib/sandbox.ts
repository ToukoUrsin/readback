/**
 * Runs the project's own tests on a copy of the head checkout, in Docker, with no network.
 * The pull request is untrusted code: it only ever runs inside the container, as an unprivileged user,
 * with memory, CPU and process limits, and the copy it can write to is thrown away afterwards.
 */
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ensureDir, exec, log } from './util';

export interface TestRun {
  /** exit code of the test command; 124 = timed out */
  code: number;
  passed: string[];
  failed: string[];
  ms: number;
  /** last part of the output, for the log */
  tail: string;
}

export interface Sandbox {
  image: string;
  testCmd: string[];
  /** folder with node_modules for the head commit, mounted read-only */
  modules: string | null;
  headDir: string;
  workDir: string;
  installed: 'copied' | 'bun install' | 'none';
}

const LOCKS = ['bun.lock', 'bun.lockb', 'package.json'];
const same = (a: string, b: string) => existsSync(a) === existsSync(b) && (!existsSync(a) || readFileSync(a).equals(readFileSync(b)));

export async function prepareSandbox(o: { repo: string; headDir: string; workDir: string; image: string; testCmd: string[] }): Promise<Sandbox> {
  ensureDir(o.workDir);
  const sb: Sandbox = { image: o.image, testCmd: o.testCmd, modules: null, headDir: o.headDir, workDir: o.workDir, installed: 'none' };
  if (!existsSync(join(o.headDir, 'package.json'))) return sb;
  const modules = join(o.workDir, 'node_modules');
  const marker = join(o.workDir, 'node_modules.ok');
  if (existsSync(marker) && existsSync(modules)) {
    sb.modules = modules;
    sb.installed = readFileSync(marker, 'utf8').trim() as Sandbox['installed'];
    return sb;
  }
  rmSync(modules, { recursive: true, force: true });
  const local = join(o.repo, 'node_modules');
  if (existsSync(local) && LOCKS.every((f) => same(join(o.repo, f), join(o.headDir, f)))) {
    // the repository's installed packages match the head commit: copy them, nothing is downloaded
    await exec('cp', ['-a', local, modules], { check: true });
    sb.installed = 'copied';
  } else {
    // one install with network in a throwaway container; lifecycle scripts stay off
    const dir = join(o.workDir, 'install');
    rmSync(dir, { recursive: true, force: true });
    cpSync(o.headDir, dir, { recursive: true });
    const r = await docker(o.image, dir, null, ['bun', 'install', '--ignore-scripts'], { network: true, timeoutMs: 5 * 60_000 });
    if (r.code !== 0) throw new Error(`bun install failed in the sandbox: ${(r.stderr || r.stdout).slice(-600)}`);
    await exec('mv', [join(dir, 'node_modules'), modules], { check: true });
    rmSync(dir, { recursive: true, force: true });
    sb.installed = 'bun install';
  }
  writeFileSync(marker, sb.installed);
  sb.modules = modules;
  log('sandbox', `node_modules: ${sb.installed}`);
  return sb;
}

let seq = 0;

async function docker(image: string, dir: string, modules: string | null, cmd: string[], o: { network: boolean; timeoutMs: number }) {
  const name = `readback-${process.pid}-${++seq}`;
  const args = [
    'run',
    '--rm',
    '--name',
    name,
    ...(o.network ? [] : ['--network', 'none']),
    '--user',
    `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--memory',
    '2g',
    '--cpus',
    '2',
    '--pids-limit',
    '512',
    '-e',
    'HOME=/tmp',
    '-e',
    'CI=1',
    '-v',
    `${dir}:/app`,
    ...(modules ? ['-v', `${modules}:/app/node_modules:ro`] : []),
    '-w',
    '/app',
    image,
    ...cmd,
  ];
  const r = await exec('docker', args, { timeoutMs: o.timeoutMs });
  if (r.code === 124) await exec('docker', ['kill', name]).catch(() => null);
  return r;
}

/** Names as `bun test` prints them: "(pass) group > test [1.23ms]" / "(fail) group > test". Also reads ✓ / ✗. */
export function parseTests(output: string): { passed: string[]; failed: string[] } {
  const passed = new Set<string>();
  const failed = new Set<string>();
  for (const raw of output.split('\n')) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, '').trim();
    const m = /^(\(pass\)|\(fail\)|✓|✗)\s+(.+?)(?:\s+\[[\d.]+\s*(?:ms|s|µs|us|ns)\])?$/.exec(line);
    if (!m) continue;
    (m[1] === '(pass)' || m[1] === '✓' ? passed : failed).add(m[2]!);
  }
  return { passed: [...passed], failed: [...failed] };
}

/**
 * Run the tests on a fresh copy of the head checkout. `edit` may change one line first:
 * `{ file, line, text }` replaces that line (1-based) in the copy only.
 */
export async function runTests(sb: Sandbox, label: string, edit?: { file: string; line: number; text: string }, timeoutMs = 3 * 60_000): Promise<TestRun> {
  const dir = resolve(sb.workDir, `run-${label}`);
  if (!dir.startsWith(resolve(sb.workDir) + '/')) throw new Error(`bad sandbox label ${label}`);
  rmSync(dir, { recursive: true, force: true });
  cpSync(sb.headDir, dir, { recursive: true });
  if (sb.modules) ensureDir(join(dir, 'node_modules'));
  try {
    if (edit) {
      const path = join(dir, edit.file);
      const lines = readFileSync(path, 'utf8').split('\n');
      lines[edit.line - 1] = edit.text;
      writeFileSync(path, lines.join('\n'));
    }
    const r = await docker(sb.image, dir, sb.modules, sb.testCmd, { network: false, timeoutMs });
    const out = `${r.stdout}\n${r.stderr}`;
    return { code: r.code, ...parseTests(out), ms: r.ms, tail: out.replace(/\x1b\[[0-9;]*m/g, '').trim().slice(-1500) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
