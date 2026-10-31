/**
 * Google Antigravity CLI runner (`agy`) — headless print mode over a pipe (ADR 0007).
 *
 * One `agy -p … --output-format stream-json` process per turn, like cursor: the process exits when
 * the turn is over, so `sendMessage` returns false and "Continue" resumes the SAME conversation
 * with `--conversation <id>` (the id agy minted, persisted from the `session` event).
 *
 * agy cannot ask for approval on a pipe, so what a run may do is decided up front by the permission
 * level (`antigravity-permissions.ts`), and a turn that was blocked is reported as a failure, not a
 * success (`evaluateAntigravityResult`). Upstream reported a hang when stdout is not a terminal; it
 * did not reproduce on 1.4.12, but two watchdogs remain so it can never wedge a run if it returns:
 * no output at all after the start, or silence mid-run. Every child is killed as a TREE (agy's
 * `run_command` children outlive it otherwise) when the run ends, is stopped, or onni exits.
 *
 * Emits v1 `AgentEvent`s and, when `opts.onUiEvent` is set, protocol v2 `UiEvent`s alongside.
 */
import { execFile, spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type {
  AgentEvent,
  AgentRunResult,
  AgentRunSpec,
  AgentRunner,
  AgentSession,
  AgentToolCallRecord,
  ContentBlock,
  SessionOptions,
} from './agent-runner.ts';
import { isSignalTerminationExit, prependSystemPrompt } from './agent-runner.ts';
import { buildChildEnv } from './agent-env.ts';
import { antigravityLaunch, resolveAntigravityExecutable } from './antigravity-bin.ts';
import { probeAntigravityVersion } from './antigravity-cli.ts';
import { antigravityPermissionArgs } from './antigravity-permissions.ts';
import { createAntigravityState, foldAntigravityFrame } from './antigravity-ui-mapper.ts';
import { armInactivityDeadline, inactivityTimeoutMessage } from './inactivity-deadline.ts';

/** Mid-run silence bound when the run sets none (`spec.timeoutMs` 0 = "interactive, no bound"). */
export const DEFAULT_ANTIGRAVITY_SILENCE_MS = 30 * 60_000;
/** No output at all after spawn: the signature of the upstream "hangs without a terminal" bug. */
export const DEFAULT_ANTIGRAVITY_STARTUP_MS = 120_000;
/** After the `result` frame agy should exit by itself; past this the tree is killed. */
export const ANTIGRAVITY_EXIT_GRACE_MS = 10_000;
export const ANTIGRAVITY_KILL_GRACE_MS = 5_000;
/** How long the first event waits for `agy --version` before going on without it. */
const VERSION_WAIT_MS = 2_000;
/** Windows caps a command line near 32 767 characters; the prompt is one argv entry. */
export const ANTIGRAVITY_MAX_PROMPT_CHARS = 24_000;

export interface AntigravityRunnerOptions {
  bin?: string;
  /** Mid-run silence bound; `spec.timeoutMs` (when > 0) wins. */
  silenceMs?: number;
  startupMs?: number;
  exitGraceMs?: number;
  killGraceMs?: number;
}

export interface BuildAntigravityArgsInput {
  userPrompt: string;
  systemPrompt?: string;
  model?: string;
  /** The conversation to continue; present only when resuming. */
  conversationId?: string;
  permissionLevel: NonNullable<AgentRunSpec['permissionLevel']>;
  bashAllowlist?: readonly string[];
  directories?: readonly string[];
}

/**
 * CLI argv for one headless turn. No `--add-dir`: with it agy wrote the task's file into the added
 * directory instead of the cwd (spike step 0, d), so the worktree is the cwd and nothing else.
 */
export function buildAntigravityArgs(input: BuildAntigravityArgsInput): string[] {
  const args = ['-p', prependSystemPrompt(input.systemPrompt, input.userPrompt), '--output-format', 'stream-json'];
  if (input.model?.trim()) args.push('--model', input.model.trim());
  if (input.conversationId) args.push('--conversation', input.conversationId);
  args.push(
    ...antigravityPermissionArgs(input.permissionLevel, {
      ...(input.bashAllowlist ? { bashAllowlist: input.bashAllowlist } : {}),
      ...(input.directories ? { directories: input.directories } : {}),
    }),
  );
  return args;
}

function wrapSpawnError(err: unknown, bin: string): Error {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') {
    return new Error(
      `\`${bin}\` not found — install the Antigravity CLI (agy) and sign in (or set ONNI_ANTIGRAVITY_BIN)`,
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Lines from a child's stdout, buffered from the moment this is called. Node discards a child's
 * unread stdout when the process exits (`flushStdio`), so a reader attached later — after the
 * version probe, say — loses every line of an agy that finishes or fails quickly. A 'data'
 * listener attached synchronously at spawn cannot lose anything.
 */
export function bufferedLines(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
  stream.setEncoding('utf8');
  const lines: string[] = [];
  let partial = '';
  let ended = false;
  let wake: (() => void) | undefined;
  const signal = () => {
    wake?.();
    wake = undefined;
  };
  stream.on('data', (chunk: string) => {
    partial += chunk;
    let newline: number;
    while ((newline = partial.indexOf('\n')) >= 0) {
      const line = partial.slice(0, newline).trim();
      partial = partial.slice(newline + 1);
      if (line) lines.push(line);
    }
    signal();
  });
  const finish = () => {
    const tail = partial.trim();
    partial = '';
    if (tail) lines.push(tail);
    ended = true;
    signal();
  };
  stream.on('end', finish);
  stream.on('close', finish);
  stream.on('error', finish);
  return (async function* () {
    for (;;) {
      const line = lines.shift();
      if (line !== undefined) {
        yield line;
        continue;
      }
      if (ended) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  })();
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  if (child.exitCode != null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => {
    const fin = (code: number | null) => resolve(code);
    child.once('close', fin);
    child.once('exit', fin);
    child.once('error', () => fin(child.exitCode ?? null));
  });
}

/** Every live child, so onni exiting (or an emergency stop) cannot leave an agy tree behind. */
const liveChildren = new Set<ChildProcessWithoutNullStreams>();
let exitHookInstalled = false;

/**
 * Kill a child and everything it started. Windows has no process groups: `taskkill /T`, which needs
 * the parent alive — so after the leader exited only POSIX can still sweep its group (`afterExit`);
 * on Windows a command agy left running past its own exit is a known gap (ADR 0007).
 */
export function killProcessTree(child: ChildProcessWithoutNullStreams, hard: boolean, afterExit = false): void {
  if (child.pid === undefined) return;
  const exited = child.exitCode != null || child.signalCode != null;
  if (exited && !afterExit) return;
  if (process.platform === 'win32') {
    if (exited) return;
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5_000 }, () => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    });
    return;
  }
  try {
    process.kill(-child.pid, hard ? 'SIGKILL' : 'SIGTERM');
  } catch {
    try {
      child.kill(hard ? 'SIGKILL' : 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

function trackChild(child: ChildProcessWithoutNullStreams): void {
  liveChildren.add(child);
  child.once('exit', () => liveChildren.delete(child));
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once('exit', () => {
    for (const live of liveChildren) {
      try {
        if (process.platform === 'win32') {
          // `exit` handlers are synchronous: no taskkill here; the best that can be done is the leader.
          live.kill();
        } else if (live.pid !== undefined) {
          process.kill(-live.pid, 'SIGKILL');
        }
      } catch {
        /* nothing left to do */
      }
    }
  });
}

/** Test seam: how many agy children onni still tracks. */
export function liveAntigravityChildren(): number {
  return liveChildren.size;
}

export class AntigravityRunner implements AgentRunner {
  readonly backend = 'antigravity' as const;

  private readonly bin: string;
  private readonly silenceMs: number;
  private readonly startupMs: number;
  private readonly exitGraceMs: number;
  private readonly killGraceMs: number;
  private lastSession: AgentSession | null = null;

  constructor(opts: AntigravityRunnerOptions = {}) {
    this.bin = resolveAntigravityExecutable(opts.bin);
    this.silenceMs = opts.silenceMs ?? DEFAULT_ANTIGRAVITY_SILENCE_MS;
    this.startupMs = opts.startupMs ?? DEFAULT_ANTIGRAVITY_STARTUP_MS;
    this.exitGraceMs = opts.exitGraceMs ?? ANTIGRAVITY_EXIT_GRACE_MS;
    this.killGraceMs = opts.killGraceMs ?? ANTIGRAVITY_KILL_GRACE_MS;
  }

  run(spec: AgentRunSpec, onEvent?: (event: AgentEvent) => void): Promise<AgentRunResult> {
    return this.startSession(spec, onEvent, { autoEndAfterFirstTurn: true }).result;
  }

  async interrupt(): Promise<void> {
    this.lastSession?.interrupt();
  }

  startSession(
    spec: AgentRunSpec,
    onEvent?: (event: AgentEvent) => void,
    opts: SessionOptions = {},
  ): AgentSession {
    const level = spec.permissionLevel ?? 'files-only';
    const args = buildAntigravityArgs({
      userPrompt: spec.userPrompt,
      ...(spec.systemPrompt ? { systemPrompt: spec.systemPrompt } : {}),
      ...(spec.model ? { model: spec.model } : {}),
      ...(spec.resume && spec.sessionId ? { conversationId: spec.sessionId } : {}),
      permissionLevel: level,
      ...(spec.bashAllowlist ? { bashAllowlist: spec.bashAllowlist } : {}),
      ...(spec.additionalDirectories ? { directories: spec.additionalDirectories } : {}),
    });
    const promptChars = (args[1] ?? '').length;
    if (promptChars > ANTIGRAVITY_MAX_PROMPT_CHARS) {
      throw new Error(
        `antigravity: the prompt is ${promptChars} characters, over the ${ANTIGRAVITY_MAX_PROMPT_CHARS} agy's command line can carry — shorten the task or its instructions`,
      );
    }

    let child: ChildProcessWithoutNullStreams;
    try {
      const [file, argv] = antigravityLaunch(this.bin, args);
      child = nodeSpawn(file, argv, {
        cwd: spec.cwd,
        env: buildChildEnv({ backend: this.backend, extraEnv: spec.env }),
        // A POSIX process group lets the whole tree be signalled; Windows uses taskkill /T.
        detached: process.platform !== 'win32',
        windowsHide: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`failed to spawn antigravity (${this.bin}): ${message}`);
    }
    trackChild(child);

    // `spawn` reports a missing binary asynchronously; the listener must be attached synchronously.
    let spawnFailed: Error | null = null;
    child.on('error', (err: NodeJS.ErrnoException) => {
      spawnFailed = wrapSpawnError(err, this.bin);
    });
    const stdoutLines = bufferedLines(child.stdout);
    // agy never reads our stdin in print mode; a write to a dead pipe must not become an unhandled error.
    child.stdin.on('error', () => {});

    const toolCalls: AgentToolCallRecord[] = [];
    const textChunks: string[] = [];
    let sessionId = spec.sessionId;
    let tokensUsed = 0;
    let open = true;
    let terminatedByOnni = false;
    let watchdogReason: string | undefined;
    let resultSeen = false;
    let resultError: string | undefined;
    const stderrChunks: string[] = [];
    let mapped = createAntigravityState({ ...(spec.model ? { model: spec.model } : {}), level });

    const emit = (event: AgentEvent) => {
      if (event.type === 'text') textChunks.push(event.text);
      if (event.type === 'tool-call') toolCalls.push({ id: event.id, name: event.tool, input: event.input });
      if (event.type === 'session') sessionId = event.sessionId;
      if (event.type === 'token-usage') tokensUsed = event.tokensUsed;
      if (event.type === 'error') resultError = event.message;
      onEvent?.(event);
    };

    let killTimer: NodeJS.Timeout | undefined;
    const stop = (): void => {
      killProcessTree(child, false);
      killTimer ??= setTimeout(() => killProcessTree(child, true), this.killGraceMs);
      killTimer.unref?.();
    };

    // The startup watchdog: nothing at all from agy after spawn. Cleared by the first stdout byte.
    const startup = setTimeout(() => {
      watchdogReason = `antigravity produced no output within ${Math.round(this.startupMs / 1000)}s of starting and was killed — agy is known to hang upstream when stdout is not a terminal; Continue tries again`;
      terminatedByOnni = true;
      stop();
    }, this.startupMs);
    startup.unref?.();

    // Silence mid-run. `spec.timeoutMs` 0 means "interactive: the run's own idle timer rules", but
    // that timer does not apply to a running turn, so agy keeps a bound of its own.
    const limitMs = spec.timeoutMs && spec.timeoutMs > 0 ? spec.timeoutMs : this.silenceMs;
    const deadline = armInactivityDeadline(limitMs, () => {
      watchdogReason = inactivityTimeoutMessage('antigravity', limitMs, deadline.expiredBy);
      terminatedByOnni = true;
      stop();
    });

    // The CLI version, as the run's first event: agy updates itself in the background, so the
    // version that actually ran is worth knowing when a later run behaves differently.
    const versionNote = Promise.race([
      probeAntigravityVersion({ bin: this.bin }),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), VERSION_WAIT_MS).unref?.()),
    ]).then((probed) => {
      if (probed?.ok) onEvent?.({ type: 'note', message: `antigravity CLI ${probed.value}`, kind: 'agent-version', value: probed.value });
    });

    if (spec.images?.length) {
      onEvent?.({ type: 'note', message: 'antigravity print mode takes text only — the pasted images were not sent' });
    }

    const result = (async (): Promise<AgentRunResult> => {
      let exitTimer: NodeJS.Timeout | undefined;
      try {
        await versionNote;
        for await (const line of stdoutLines) {
          clearTimeout(startup);
          deadline.touch();
          let parsed: unknown;
          try {
            parsed = JSON.parse(line);
          } catch {
            continue; // noise, or a cut-off line: skipped, never fatal
          }
          const folded = foldAntigravityFrame(parsed, mapped);
          mapped = folded.state;
          if (opts.onUiEvent) {
            for (const event of folded.ui) {
              try {
                opts.onUiEvent(event);
              } catch {
                /* v2 mapping is best-effort; v1 consumers stay unaffected */
              }
            }
          }
          for (const event of folded.agent) emit(event);
          if (!resultSeen && typeof parsed === 'object' && parsed !== null && (parsed as { event?: unknown }).event === 'result') {
            resultSeen = true;
            // agy should exit on its own now; if it lingers, take the tree down.
            exitTimer = setTimeout(stop, this.exitGraceMs);
            exitTimer.unref?.();
          }
        }
      } catch {
        /* premature close — handled with the exit below */
      } finally {
        clearTimeout(startup);
        deadline.clear();
        open = false;
      }

      const exitCode = await waitForExit(child);
      if (exitTimer) clearTimeout(exitTimer);
      if (killTimer) clearTimeout(killTimer);
      // Whatever the exit looked like, nothing of agy's may outlive the run.
      killProcessTree(child, true, true);
      const text = textChunks.join('').trim();

      if (spawnFailed) throw spawnFailed;

      if (watchdogReason) {
        onEvent?.({ type: 'error', message: watchdogReason });
        onEvent?.({ type: 'done' });
        return { text, toolCalls, tokensUsed, sessionId };
      }

      if (terminatedByOnni && !resultSeen && (isSignalTerminationExit(exitCode) || exitCode === null || exitCode === 1)) {
        onEvent?.({ type: 'note', message: `antigravity stopped by onni (code ${exitCode})` });
        onEvent?.({ type: 'done' });
        return { text, toolCalls, tokensUsed, sessionId };
      }

      if (exitCode !== 0 && exitCode !== null) {
        const stderr = stderrChunks.join('').trim();
        const detail = stderr ? ` — ${stderr.split('\n').slice(-3).join(' | ')}` : '';
        const message = `antigravity exited with code ${exitCode}${detail}`;
        onEvent?.({ type: 'error', message });
        throw new Error(message);
      }

      // The stream, not the exit code, says whether the turn worked: an error event already went out.
      if (resultError) throw new Error(resultError);

      if (!resultSeen) {
        const stderr = stderrChunks.join('').trim();
        const message = `antigravity exited without a result${stderr ? ` — ${stderr.split('\n').slice(-2).join(' | ')}` : ''}`;
        onEvent?.({ type: 'error', message });
        throw new Error(message);
      }

      onEvent?.({ type: 'done' });
      return { text, toolCalls, tokensUsed, sessionId };
    })();

    child.stderr.on('data', (buf: Buffer) => {
      // Bounded: a chatty stderr must not grow without limit.
      if (stderrChunks.join('').length < 16_000) stderrChunks.push(buf.toString('utf8'));
    });

    const interrupt = () => {
      terminatedByOnni = true;
      open = false;
      stop();
    };

    const session: AgentSession = {
      result,
      pid: child.pid,
      sendMessage(_content: ContentBlock[]): boolean {
        onEvent?.({
          type: 'note',
          message: 'antigravity print mode is one-shot — Continue resumes the same conversation in a new process.',
        });
        return false;
      },
      end() {
        interrupt();
      },
      interrupt,
      hardStop() {
        terminatedByOnni = true;
        open = false;
        killProcessTree(child, true);
      },
      get open() {
        return open;
      },
    };

    this.lastSession = session;
    return session;
  }
}
