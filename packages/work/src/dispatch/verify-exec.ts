/**
 * `onni task verify` — the only impure half: run ONE check command under bash with a real kill
 * deadline. Sequencing, budgets and result shaping live in `RunManager.verifyFor` / `verify.ts`.
 *
 * Differences from `runShellCheck` (landing): stdin is closed, the env is the caller's (minimal)
 * env, output is a bounded rolling tail, the exit code and duration are reported, and an abort
 * signal kills the tree exactly like the timeout does.
 */
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { killProcessTree } from '../core/antigravity-runner.ts';
import { withBashPath } from '../core/bash-path.ts';
import { utf8Collector } from '../core/utf8-chunks.ts';

/** Memory bound for one command's output, however chatty it is. */
export const VERIFY_CAPTURE_BYTES = 262_144;

export interface VerifyExecResult {
  exitCode: number | null;
  timedOut: boolean;
  aborted: boolean;
  output: string;
  durationMs: number;
  spawnError?: string;
}

export interface VerifyExecDeps {
  spawn: typeof spawn;
  now: () => number;
}

export function runVerifyCommand(
  opts: {
    bashPath: string;
    pathDirs: string[];
    command: string;
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    signal?: AbortSignal;
    captureBytes?: number;
  },
  deps: Partial<VerifyExecDeps> = {},
): Promise<VerifyExecResult> {
  const spawnFn = deps.spawn ?? spawn;
  const now = deps.now ?? Date.now;
  const cap = opts.captureBytes ?? VERIFY_CAPTURE_BYTES;
  const startedAt = now();
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    let timedOut = false;
    let aborted = false;
    const finish = (exitCode: number | null, spawnError?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({
        exitCode,
        timedOut,
        aborted,
        output,
        durationMs: Math.max(0, now() - startedAt),
        ...(spawnError ? { spawnError } : {}),
      });
    };
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawnFn(opts.bashPath, ['-lc', opts.command], {
        cwd: opts.cwd,
        env: withBashPath(opts.env, { path: opts.bashPath, pathDirs: opts.pathDirs }),
        // A group of its own on POSIX so the deadline can sweep what the check started.
        detached: process.platform !== 'win32',
        // stdin closed: a check must never wait on input. No console window on Windows.
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }) as unknown as ChildProcessWithoutNullStreams;
    } catch (err) {
      resolve({ exitCode: null, timedOut: false, aborted: false, output: '', durationMs: 0, spawnError: (err as Error).message });
      return;
    }
    const append = (text: string) => {
      output = output.length + text.length > cap ? (output + text).slice(-cap) : output + text;
    };
    const stdout = utf8Collector(append);
    const stderr = utf8Collector(append);
    // Kill the whole tree and answer NOW; destroying the pipes keeps a grandchild that holds
    // stdout from stretching the bound (the bug `runShellCheck` documents).
    const stop = () => {
      killProcessTree(child, true);
      child.stdout?.destroy();
      child.stderr?.destroy();
      finish(null);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, Math.max(1, opts.timeoutMs));
    const onAbort = () => {
      aborted = true;
      stop();
    };
    if (opts.signal?.aborted) {
      onAbort();
      return;
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', stdout.write);
    child.stderr?.on('data', stderr.write);
    child.on('error', (err) => finish(null, err.message));
    child.on('close', (code) => {
      stdout.end();
      stderr.end();
      finish(code);
    });
  });
}
