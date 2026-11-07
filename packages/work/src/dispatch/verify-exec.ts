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
  spawnErrorCode?: string;
}

export interface VerifyExecDeps {
  spawn: typeof spawn;
  now: () => number;
  killProcessTree: typeof killProcessTree;
  platform: NodeJS.Platform;
}

function utf8Tail(bytes: Buffer, maxBytes: number): Buffer {
  if (maxBytes <= 0) return Buffer.alloc(0);
  let start = Math.max(0, bytes.length - maxBytes);
  // The collector gives complete code points; the byte window can still start inside one.
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
  if (start < bytes.length) {
    const lead = bytes[start]!;
    const needed = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc2 ? 2 : 1;
    if (start + needed > bytes.length) start = bytes.length;
  }
  return bytes.subarray(start);
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
  const killTree = deps.killProcessTree ?? killProcessTree;
  const platform = deps.platform ?? process.platform;
  const cap = Math.max(0, opts.captureBytes ?? VERIFY_CAPTURE_BYTES);
  const startedAt = now();
  return new Promise((resolve) => {
    let captured: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let settled = false;
    let timedOut = false;
    let aborted = false;
    const finish = (exitCode: number | null, spawnError?: string, spawnErrorCode?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({
        exitCode,
        timedOut,
        aborted,
        output: captured.toString('utf8'),
        durationMs: Math.max(0, now() - startedAt),
        ...(spawnError ? { spawnError } : {}),
        ...(spawnErrorCode ? { spawnErrorCode } : {}),
      });
    };
    let child: ChildProcessWithoutNullStreams;
    try {
      // Keep bash alive for ordinary jobs so taskkill /T can see them; commands that exit the shell or disown/reparent children remain a gap.
      const shellCommand = platform === 'win32'
        ? `${opts.command}\n__onni_verify_exit=$?; wait; exit "$__onni_verify_exit"`
        : opts.command;
      child = spawnFn(opts.bashPath, ['-lc', shellCommand], {
        cwd: opts.cwd,
        env: withBashPath(opts.env, { path: opts.bashPath, pathDirs: opts.pathDirs }),
        // A group of its own on POSIX so the deadline can sweep what the check started.
        detached: platform !== 'win32',
        // stdin closed: a check must never wait on input. No console window on Windows.
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }) as unknown as ChildProcessWithoutNullStreams;
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      resolve({
        exitCode: null,
        timedOut: false,
        aborted: false,
        output: '',
        durationMs: Math.max(0, now() - startedAt),
        spawnError: error.message,
        ...(error.code ? { spawnErrorCode: error.code } : {}),
      });
      return;
    }
    const append = (text: string) => {
      if (cap === 0 || text.length === 0) return;
      const bytes = Buffer.from(text, 'utf8');
      captured = utf8Tail(Buffer.concat([captured, bytes]), cap);
    };
    const stdout = utf8Collector(append);
    const stderr = utf8Collector(append);
    // Kill the whole tree and answer NOW; destroying the pipes keeps a grandchild that holds
    // stdout from stretching the bound (the bug `runShellCheck` documents).
    const stop = () => {
      // POSIX can still signal the detached group after its shell leader exits.
      killTree(child, true, true);
      child.stdout?.destroy();
      child.stderr?.destroy();
      finish(null);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, Math.max(1, opts.timeoutMs));
    const onAbort = () => {
      if (opts.signal?.reason === 'verify-total-timeout') timedOut = true;
      else aborted = true;
      stop();
    };
    if (opts.signal?.aborted) {
      onAbort();
      return;
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', stdout.write);
    child.stderr?.on('data', stderr.write);
    child.on('error', (err) => {
      const error = err as NodeJS.ErrnoException;
      finish(null, error.message, error.code);
    });
    child.on('close', (code) => {
      stdout.end();
      stderr.end();
      finish(code);
    });
  });
}
