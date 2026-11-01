/**
 * Windows Job Object ownership for everything the engine starts (C-05/C-06).
 *
 * A child of onni is not the problem — what it starts is. An agent CLI spawns a server, a shell,
 * a watcher; a terminal user starts `npm run dev`; each of those can detach and outlive the engine.
 * On POSIX `task-processes.ts` finds them by the `ONNI_TASK_ID` marker in their environment. Windows
 * has no such scan, and `taskkill /T` follows parent pids, so a re-parented grandchild is invisible
 * to it — measured: a detached grandchild survived both a terminal `kill()` and `closeAll()`.
 *
 * The mechanism is one resident `powershell.exe` (the keeper, `scripts/job-keeper.ps1`) that owns
 * Job Objects with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. Membership is inherited by descendants,
 * `detached: true` included, and a job dies with every handle to it — including the one the OS
 * drops when the engine's stdin pipe closes, which is what a hard kill (`taskkill /F`) does.
 * Nested jobs are legal on Windows 8+, so an engine already inside the desktop shell's job can own
 * jobs of its own (verified: terminating the inner job leaves the outer one intact).
 *
 * Lazy by design: nothing here starts until the first spawn or terminal session needs it, so a
 * cockpit that never runs a task pays nothing. A host where PowerShell is missing or blocked
 * degrades to the old behaviour (`pty.kill()`, no engine-wide ownership) — never a failed spawn.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const KEEPER_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/job-keeper.ps1');
/** Add-Type compiles the launcher in-process; ~0.4 s on a cold machine, once per engine. */
const READY_TIMEOUT_MS = 20_000;
const COMMAND_TIMEOUT_MS = 10_000;

/** One Job Object: everything assigned to it, and everything those processes start, dies together. */
export interface ProcessJob {
  /** Put `pid` under the job, creating the job on first use. False when the job is unavailable. */
  assign(pid: number): Promise<boolean>;
  /** `TerminateJobObject`. False when the job does not exist (or the keeper is gone). */
  terminate(): Promise<boolean>;
}

export interface ProcessJobs {
  /** False off Windows, and false once the keeper has failed — callers then keep their fallback. */
  readonly supported: boolean;
  /** Resolve when the keeper is serving, or false. Awaited once before the first spawn so the
   *  assignment can never lose a race with the child that is being created. */
  ready(): Promise<boolean>;
  job(key: string): ProcessJob;
}

const NO_JOB: ProcessJob = {
  assign: () => Promise.resolve(false),
  terminate: () => Promise.resolve(false),
};

interface Reply {
  ok: boolean;
  error?: string;
}

class Keeper {
  private child: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<boolean> | null = null;
  private dead = false;
  private seq = 0;
  private buffer = '';
  private readonly pending = new Map<number, (reply: Reply) => void>();

  constructor(private readonly script: string) {}

  start(): Promise<boolean> {
    if (this.dead) return Promise.resolve(false);
    this.starting ??= this.spawnKeeper();
    return this.starting;
  }

  private spawnKeeper(): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let child: ChildProcessWithoutNullStreams;
      const finish = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!ok) {
          this.die();
        } else {
          // Ref'd until `ready` on purpose: a caller awaiting readiness has nothing else holding
          // the loop open, and an unref'd keeper would let Node exit mid-await. Once it serves, it
          // must never be the reason the engine cannot exit — the pipe closing is what cleans up.
          child.unref();
          for (const stream of [child.stdin, child.stdout, child.stderr]) {
            (stream as { unref?: () => void }).unref?.();
          }
        }
        resolve(ok);
      };
      timer = setTimeout(() => finish(false), READY_TIMEOUT_MS);
      try {
        child = spawn(
          path.join(
            process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows',
            'System32',
            'WindowsPowerShell',
            'v1.0',
            'powershell.exe',
          ),
          ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.script],
          { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
        );
      } catch {
        finish(false);
        return;
      }
      this.child = child;
      process.once('exit', () => this.die());
      child.stdin.on('error', () => this.die());
      child.stderr.on('data', () => {
        // Drained so a chatty keeper cannot block on a full pipe; errors ride the protocol replies.
      });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        this.buffer += chunk;
        let index: number;
        while ((index = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, index).replace(/\r$/, '');
          this.buffer = this.buffer.slice(index + 1);
          if (line === 'ready') {
            finish(true);
            continue;
          }
          const match = /^(\d+) (ok|err)(?: (.*))?$/.exec(line);
          if (!match) continue;
          const reply = this.pending.get(Number(match[1]));
          this.pending.delete(Number(match[1]));
          reply?.({ ok: match[2] === 'ok', ...(match[3] ? { error: match[3] } : {}) });
        }
      });
      child.once('error', () => finish(false));
      child.once('exit', () => {
        finish(false);
        this.die();
      });
    });
  }

  send(command: string): Promise<boolean> {
    return this.start().then((ready) => {
      const child = this.child;
      if (!ready || !child || this.dead) return false;
      const seq = ++this.seq;
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          this.pending.delete(seq);
          resolve(false);
        }, COMMAND_TIMEOUT_MS);
        timer.unref?.();
        this.pending.set(seq, (reply) => {
          clearTimeout(timer);
          resolve(reply.ok);
        });
        try {
          child.stdin.write(`${seq} ${command}\n`);
        } catch {
          clearTimeout(timer);
          this.pending.delete(seq);
          resolve(false);
        }
      });
    });
  }

  /** The keeper is gone: every job it owned has closed (which is the cleanup), so never restart —
   *  a second keeper could not own what the first one's death already killed. */
  private die(): void {
    const child = this.child;
    this.dead = true;
    this.child = null;
    for (const resolve of [...this.pending.values()]) resolve({ ok: false });
    this.pending.clear();
    try {
      // A keeper that never became ready (a blocked PowerShell) is still running; a dead one is
      // not, and killing it again is harmless.
      child?.kill();
    } catch {
      // Already gone.
    }
  }
}

class KeeperJobs implements ProcessJobs {
  readonly supported = process.platform === 'win32';
  private readonly keeper = new Keeper(KEEPER_SCRIPT);

  ready(): Promise<boolean> {
    return this.supported ? this.keeper.start() : Promise.resolve(false);
  }

  job(key: string): ProcessJob {
    if (!this.supported || !/^[\w.:-]{1,200}$/.test(key)) return NO_JOB;
    return {
      assign: (pid) => this.keeper.send(`assign ${key} ${pid}`),
      terminate: () => this.keeper.send(`terminate ${key}`),
    };
  }
}

/** The engine's one keeper. Import this, not a new instance: a second keeper per spawn is exactly
 *  the resident cost the design avoids. */
export const processJobs: ProcessJobs = new KeeperJobs();

/** The job key for a spawned process: one job per run, so a run's turns share a tree. */
export function jobKeyForEnv(env: NodeJS.ProcessEnv): string {
  const runId = env.ONNI_TASK_ID ?? env.ONNI_RUN_ID;
  return runId ? `run-${runId}` : `spawn-${randomUUID()}`;
}
