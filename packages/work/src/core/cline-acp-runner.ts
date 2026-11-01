import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isSignalTerminationExit,
  prependSystemPrompt,
  trackChildExit,
  type AgentBackend,
  type AgentEvent,
  type AgentRunResult,
  type AgentRunSpec,
  type AgentRunner,
  type AgentSession,
  type AgentToolCallRecord,
  type ContentBlock,
  type SessionOptions,
} from './agent-runner.ts';
import { buildChildEnv } from './agent-env.ts';
import { AcpClient, type AcpContentBlock, type AcpMessage, type AcpRequestAnswer } from './acp-client.ts';
import { acpMcpCapabilities, skippedServersNote, toAcpMcpServers } from './private-mcp.ts';
import { abortAcpTurn, endAcpReplay, mapAcpFrame, type AcpUiMapperState } from './acp-ui-mapper.ts';
import { EOF_KILL_GRACE_MS, EOF_TERM_GRACE_MS } from './claude-cli-runner.ts';
import {
  CLINE_AUTH_FAILURE_MESSAGE,
  CLINE_EMPTY_TURN_MESSAGE,
  clineDialect,
  createClineUiState,
  isClineAuthFailure,
} from './cline-ui-mapper.ts';
import type { UiEvent } from './ui-events.ts';
import { spawnableCommand } from './windows-shim.ts';
import { spawnTaskProcess } from './task-process-spawn.ts';
import { armInactivityDeadline, inactivityTimeoutMessage, type InactivityDeadline } from './inactivity-deadline.ts';

const DEFAULT_TIMEOUT_MS = 30 * 60_000;
/** `initialize` / `session/new` / `session/load` are handshakes: bounded, unlike a prompt. */
const HANDSHAKE_TIMEOUT_MS = 90_000;
/**
 * How long to wait for the end of a `session/load` replay (`available_commands_update`) before
 * prompting anyway. Whether Cline replays a loaded session's history at all is **unverified**
 * (`session/load` was not exercised — see `__fixtures__/cline/README.md`), so this is a bound,
 * not an expectation: an agent that never sends the marker costs one 5s wait on resume.
 */
const REPLAY_WAIT_MS = 5_000;
const AUTO_END_DELAY_MS = 250;

export interface ClineAcpRunnerOptions {
  /** Override the binary; defaults to `cline` on PATH (`ONNI_CLINE_BIN`). */
  bin?: string;
  /** Inactivity timeout for a run (ms); per-spec `timeoutMs` still wins. */
  timeoutMs?: number;
}

/**
 * Cline CLI over the Agent Client Protocol: one long-lived `cline --acp` child and one ACP
 * session per onni session. Follow-ups are further `session/prompt` calls on the same process;
 * Continue resumes with `session/load`.
 *
 * The wire was read off `cline` 3.0.74 (`__fixtures__/cline/README.md` is the record). Cline has
 * no permission flag for ACP: it asks `session/request_permission` for edits and commands even
 * with its own auto-approve setting on, so every request is auto-approved with a note — otherwise
 * a run would park on a question nothing in the cockpit can answer. That makes this a full-shell
 * backend, like Codex and Copilot: it is not a sandbox, and a roster may use it as a worker only.
 */
export class ClineAcpRunner implements AgentRunner {
  readonly backend = 'cline' as const;
  private readonly bin: string;
  private readonly timeoutMs: number;
  private lastSession: AgentSession | null = null;

  constructor(opts: ClineAcpRunnerOptions = {}) {
    this.bin =
      opts.bin ?? process.env.ONNI_CLINE_BIN ?? (process.env.ONNI_DRY_RUN === '1' ? mockClinePath() : 'cline');
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  run(spec: AgentRunSpec, onEvent?: (event: AgentEvent) => void): Promise<AgentRunResult> {
    return this.startSession(spec, onEvent, { autoEndAfterFirstTurn: true }).result;
  }

  async interrupt(): Promise<void> {
    this.lastSession?.interrupt();
  }

  startSession(spec: AgentRunSpec, onEvent?: (event: AgentEvent) => void, opts: SessionOptions = {}): AgentSession {
    const session = new ClineAcpSession(this.bin, this.backend, spec, spec.timeoutMs ?? this.timeoutMs, onEvent, opts);
    this.lastSession = session;
    return session;
  }
}

/**
 * The CLI flags for one run: only `--acp`, which starts the ACP server on stdio (`cline --help`,
 * 3.0.74). Everything else is deliberately left to Cline's own settings or to the ACP session:
 *
 * - the model goes through `session/set_model` after `session/new` (verified on the wire), not
 *   `-m`, which is only meaningful together with `-P <provider>` and would let a model id from
 *   the wrong provider silently select nothing;
 * - `--worktree` and `--zen` are NOT passed: onni owns the one worktree per task, and Cline's
 *   background hub would outlive the run;
 * - there is no flag for extra directories, so `spec.additionalDirectories` is not forwarded.
 *
 * `spec.allowedTools` / `spec.bashAllowlist` are not translated either: Cline has no deny list
 * onni could pass, and a partial mapping would look like a sandbox while behaving like none.
 */
export function buildClineArgs(): string[] {
  return ['--acp'];
}

/** The per-run environment: `buildChildEnv`'s least-privilege set for this backend — Cline's own
 *  `CLINE_` family plus the provider keys its model ids can name (`BACKEND_ALLOW_PREFIXES`). */
export function buildClineEnv(backend: AgentBackend, extraEnv?: Record<string, string>): NodeJS.ProcessEnv {
  return buildChildEnv({ backend, extraEnv });
}

/**
 * A onni-authored line for an exit outside a prompt.
 *
 * Cline's exit codes are **not documented and were not verified**, so this reports the code and
 * the tail of stderr rather than inventing meanings. The one case worth translating is an authentication failure, because that
 * wording is what raises `provider-auth-required`.
 */
export function clineExitMessage(exitCode: number | null, stderr: string, midTurn = false): string {
  if (isClineAuthFailure(stderr)) return CLINE_AUTH_FAILURE_MESSAGE;
  const detail = stderr.trim().split('\n').slice(-3).join(' | ');
  // Mid-turn, a bare "exited with code 0" reads as success; it is a dropped prompt (telemetry 2e3b122d).
  const head = midTurn
    ? `Cline CLI quit mid-turn without answering the prompt (exit code ${exitCode})`
    : `Cline CLI exited with code ${exitCode}`;
  return `${head}${detail ? ` — ${truncate(detail, 400)}` : ''}`;
}

class ClineAcpSession implements AgentSession {
  readonly result: Promise<AgentRunResult>;
  readonly pid?: number;

  private readonly child: ChildProcessWithoutNullStreams;
  private readonly client: AcpClient;
  private readonly hasExited: () => boolean;
  private ui: AcpUiMapperState = createClineUiState();
  private acpSessionId: string | undefined;
  private loadSupported = false;
  private imagesSupported = false;

  private isOpen = true;
  private turnInFlight = false;
  private turnsCompleted = 0;
  private readonly queue: AcpContentBlock[][] = [];
  private terminatedByOnni = false;
  /** `end()` closed stdin: a turn the CLI then drops on EOF was onni's call, not a failure. */
  private endedByOnni = false;
  private timedOut = false;
  private deadline: InactivityDeadline = armInactivityDeadline(0, () => {});
  private failed: string | null = null;
  private replayDone: (() => void) | null = null;

  private readonly textChunks: string[] = [];
  private readonly toolCalls: AgentToolCallRecord[] = [];
  private tokensUsed = 0;
  /** Items (text or tool calls) the current turn produced; zero at `end_turn` means it did nothing. */
  private turnOutputs = 0;
  private readonly stderr: string[] = [];
  private spawnError: Error | null = null;
  private autoEndTimer: NodeJS.Timeout | undefined;
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(
    bin: string,
    backend: AgentBackend,
    private readonly spec: AgentRunSpec,
    private readonly limitMs: number,
    private readonly onEvent: ((event: AgentEvent) => void) | undefined,
    private readonly opts: SessionOptions,
  ) {
    const [file, argv] = spawnableCommand(bin, buildClineArgs());
    this.child = spawnTaskProcess(file, argv, { cwd: spec.cwd, env: buildClineEnv(backend, spec.env) });
    this.pid = this.child.pid;
    this.hasExited = trackChildExit(this.child);
    // EPIPE from a write racing the child's exit arrives as an async 'error' (acfb01e4).
    this.child.stdin.on('error', () => {});
    this.child.on('error', (error: NodeJS.ErrnoException) => {
      this.spawnError =
        error.code === 'ENOENT'
          ? new Error(`\`${bin}\` not found on PATH — install Cline CLI (npm i -g cline) and run \`cline auth\``)
          : error;
    });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => this.stderr.push(chunk));
    this.client = new AcpClient(this.child.stdin, this.child.stdout, {
      onFrame: (dir, frame) => this.onFrame(dir, frame),
      onRequest: (request) => this.onRequest(request),
      onUnparseable: (line) => this.emit({ type: 'note', message: `cline: skipped unparseable ACP line: ${truncate(line, 200)}` }),
    });

    this.deadline = armInactivityDeadline(this.limitMs, () => {
      this.timedOut = true;
      this.interrupt();
    });
    this.result = this.lifecycle();
  }

  get open(): boolean {
    return this.isOpen;
  }

  sendMessage(content: ContentBlock[]): boolean {
    if (!this.isOpen || this.client.closed) return false;
    if (this.autoEndTimer) {
      clearTimeout(this.autoEndTimer);
      this.autoEndTimer = undefined;
    }
    // ACP has no steering: a message sent mid-turn waits for the turn to end, in order.
    this.queue.push(this.toAcp(content));
    this.pump();
    return true;
  }

  end(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.endedByOnni = true;
    this.terminate(false);
  }

  interrupt(): void {
    if (this.acpSessionId && this.turnInFlight) this.client.cancel(this.acpSessionId);
    this.isOpen = false;
    this.terminate(true);
  }

  // ---- lifecycle ------------------------------------------------------------------------

  private async lifecycle(): Promise<AgentRunResult> {
    const reading = this.client.run();
    const exited = waitForExit(this.child);
    try {
      await this.bootstrap();
    } catch (error) {
      // An agent that went away mid-handshake is explained by its exit, read below — not by the
      // transport's "closed" rejection.
      if (!this.spawnError && !this.client.closed) this.fail(error instanceof Error ? error.message : String(error));
      this.terminate(false);
    }

    await reading;
    const exitCode = await exited;
    this.deadline.clear();
    for (const timer of this.timers) clearTimeout(timer);
    if (this.autoEndTimer) clearTimeout(this.autoEndTimer);
    this.isOpen = false;

    if (this.spawnError) throw this.spawnError;
    if (this.turnInFlight) {
      // The agent died with a prompt unanswered: the transport rejected it, the wire never will.
      this.turnInFlight = false;
      if (this.timedOut) this.applyUi(abortAcpTurn(this.ui, clineDialect, 'timeout'));
      else if (this.terminatedByOnni || this.endedByOnni) this.applyUi(abortAcpTurn(this.ui, clineDialect, 'cancelled'));
      else {
        const reason = clineExitMessage(exitCode, this.stderrText(), true);
        this.applyUi(abortAcpTurn(this.ui, clineDialect, 'error', reason));
        this.fail(reason);
      }
    }
    const summary = (): AgentRunResult => ({
      text: this.textChunks.join('').trim(),
      toolCalls: this.toolCalls,
      tokensUsed: this.tokensUsed,
      ...(this.acpSessionId ? { sessionId: this.acpSessionId } : {}),
    });

    if (this.timedOut) {
      this.emit({ type: 'error', message: inactivityTimeoutMessage('Cline CLI', this.limitMs, this.deadline.expiredBy) });
      this.emit({ type: 'done' });
      return summary();
    }
    if (this.failed) {
      this.opts.onUiEvent?.({ type: 'session.ended', reason: 'error' });
      this.emit({ type: 'done' });
      return summary();
    }
    if (!this.acpSessionId && !this.terminatedByOnni && (exitCode === 0 || exitCode === null)) {
      this.fail('Cline CLI exited before it started a session');
      this.opts.onUiEvent?.({ type: 'session.ended', reason: 'error' });
      this.emit({ type: 'done' });
      return summary();
    }
    if (exitCode !== 0 && exitCode !== null) {
      if (this.terminatedByOnni && (isSignalTerminationExit(exitCode) || exitCode === 1)) {
        this.emit({ type: 'note', message: `Cline CLI exited ${exitCode} after onni stopped it` });
      } else if (!this.terminatedByOnni) {
        const message = clineExitMessage(exitCode, this.stderrText());
        this.emit({ type: 'error', message });
        throw new Error(message);
      }
    }
    if (this.tokensUsed === 0 && this.turnsCompleted > 0) {
      this.emit({ type: 'note', message: 'token usage not reported by Cline CLI' });
    }
    this.opts.onUiEvent?.({ type: 'session.ended', reason: this.terminatedByOnni && this.turnsCompleted === 0 ? 'cancelled' : 'end_turn' });
    this.emit({ type: 'done' });
    return summary();
  }

  private async bootstrap(): Promise<void> {
    const init = await this.client.initialize(HANDSHAKE_TIMEOUT_MS);
    const caps = isRecord(init.agentCapabilities) ? init.agentCapabilities : {};
    this.loadSupported = caps.loadSession === true;
    this.imagesSupported = isRecord(caps.promptCapabilities) && caps.promptCapabilities.image === true;
    const { mcpServers, skipped } = toAcpMcpServers(this.spec.mcpServers ?? [], acpMcpCapabilities(init));
    if (skipped.length) {
      this.emit({ type: 'note', message: skippedServersNote('cline', skipped, 'the CLI did not advertise that MCP transport') });
    }

    let resumed = false;
    if (this.spec.resume && this.spec.sessionId) {
      if (this.loadSupported) {
        const replayEnded = new Promise<void>((resolve) => {
          this.replayDone = resolve;
        });
        try {
          await this.client.loadSession(this.spec.sessionId, this.spec.cwd, HANDSHAKE_TIMEOUT_MS, mcpServers);
          this.acpSessionId = this.spec.sessionId;
          resumed = true;
          await Promise.race([replayEnded, delay(REPLAY_WAIT_MS)]);
          this.ui = endAcpReplay(this.ui);
        } catch (error) {
          this.replayDone = null;
          this.ui = endAcpReplay(this.ui);
          this.emit({
            type: 'note',
            message: `Cline could not resume session ${this.spec.sessionId} (${error instanceof Error ? error.message : String(error)}) — starting a fresh session`,
          });
        }
      } else {
        this.emit({ type: 'note', message: 'Cline CLI does not advertise session/load — starting a fresh session' });
      }
    }
    if (!this.acpSessionId) {
      const created = await this.client.newSession(this.spec.cwd, HANDSHAKE_TIMEOUT_MS, mcpServers).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          isClineAuthFailure(`${message}\n${this.stderrText()}`)
            ? CLINE_AUTH_FAILURE_MESSAGE
            : `Cline CLI could not start a session: ${message}`,
        );
      });
      const id = typeof created.sessionId === 'string' ? created.sessionId : undefined;
      if (!id) throw new Error('Cline CLI answered session/new without a sessionId');
      this.acpSessionId = id;
      if (this.spec.model) {
        await this.client.setModel(id, this.spec.model, HANDSHAKE_TIMEOUT_MS).catch((error: unknown) => {
          throw new Error(
            `Cline CLI did not accept model ${this.spec.model}: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      }
    } else if (resumed && this.spec.model) {
      // A loaded session keeps the model it was saved with, so a run whose model changed between
      // turns (#954) has to say so. Cline's `session/load` result shape is unverified, so this asks
      // unconditionally rather than comparing against a field that may not be there.
      await this.client.setModel(this.acpSessionId, this.spec.model, HANDSHAKE_TIMEOUT_MS).catch((error: unknown) => {
        this.emit({
          type: 'note',
          message: `Cline kept its own model: session/set_model failed (${error instanceof Error ? error.message : String(error)})`,
        });
      });
    }
    this.emit({ type: 'session', sessionId: this.acpSessionId });

    const first: ContentBlock[] = [
      ...(this.spec.images ?? []),
      { type: 'text', text: prependSystemPrompt(this.spec.systemPrompt, this.spec.userPrompt) },
    ];
    this.queue.unshift(this.toAcp(first));
    this.pump();
  }

  /** Send the next queued prompt when no turn is running. */
  private pump(): void {
    if (this.turnInFlight || !this.acpSessionId || this.queue.length === 0 || this.client.closed) return;
    const prompt = this.queue.shift()!;
    this.turnInFlight = true;
    this.turnOutputs = 0;
    this.client.prompt(this.acpSessionId, prompt).then(
      () => this.turnEnded(),
      // An error ANSWER ends the turn (the mapper already settled it); a lost transport does not —
      // the lifecycle settles that one once it knows why the agent went away.
      () => {
        if (!this.client.closed) this.turnEnded();
      },
    );
  }

  private turnEnded(): void {
    if (!this.turnInFlight) return;
    this.turnInFlight = false;
    this.turnsCompleted += 1;
    // Cline can answer a prompt with `end_turn` and no frame at all — a model the login cannot use
    // did exactly that. Reported as success it would settle a run that changed nothing as done
    // (the same trap as antigravity, ADR 0007), so an empty turn fails.
    if (this.turnOutputs === 0 && !this.terminatedByOnni && !this.endedByOnni && !this.timedOut && !this.failed) {
      this.fail(CLINE_EMPTY_TURN_MESSAGE);
    }
    this.emit({ type: 'turn-end' });
    if (this.queue.length > 0) {
      this.pump();
      return;
    }
    if (this.opts.autoEndAfterFirstTurn && this.isOpen && !this.autoEndTimer) {
      this.autoEndTimer = setTimeout(() => this.end(), AUTO_END_DELAY_MS);
      this.autoEndTimer.unref?.();
    }
  }

  // ---- wire → events --------------------------------------------------------------------

  private onFrame(dir: 'in' | 'out', frame: AcpMessage): void {
    if (dir === 'in') this.deadline.touch();
    if (
      dir === 'in'
      && this.replayDone
      && isRecord(frame.params)
      && isRecord(frame.params.update)
      && frame.params.update.sessionUpdate === 'available_commands_update'
    ) {
      const done = this.replayDone;
      this.replayDone = null;
      // Let the mapper see the marker first, then release the prompt.
      queueMicrotask(done);
    }
    this.applyUi(mapAcpFrame({ dir, frame }, this.ui, clineDialect));
  }

  private applyUi(mapped: { events: UiEvent[]; state: AcpUiMapperState }): void {
    this.ui = mapped.state;
    for (const event of mapped.events) {
      this.opts.onUiEvent?.(event);
      this.v1FromUi(event);
    }
  }

  /** v1 derived from v2 (AGENT_PROTOCOL.md §2: every v1 event stays derivable from the v2 stream). */
  private v1FromUi(event: UiEvent): void {
    switch (event.type) {
      case 'item.delta':
        if (event.field === 'text') {
          this.turnOutputs += 1;
          this.textChunks.push(event.delta);
          this.emit({ type: 'text', text: event.delta });
        }
        return;
      case 'item.started':
        if (event.item.kind === 'tool') {
          this.turnOutputs += 1;
          const input = event.item.input ?? { title: event.item.title };
          this.toolCalls.push({ id: event.item.id, name: event.item.name, input });
          this.emit({ type: 'tool-call', id: event.item.id, tool: event.item.name, input });
        }
        return;
      case 'item.completed':
        if (event.item.kind === 'tool') {
          const failed = event.item.status === 'failed' || event.item.status === 'declined';
          this.emit({
            type: 'tool-result',
            toolCallId: event.item.id,
            result: (failed ? event.item.error : event.item.output) ?? '',
            isError: failed,
          });
        }
        return;
      case 'image':
        this.emit({ type: 'image', mediaType: event.mediaType, data: event.data });
        return;
      case 'usage.updated':
        this.tokensUsed = event.usage.total;
        this.emit({ type: 'token-usage', tokensUsed: this.tokensUsed });
        return;
      case 'session.error':
        // A failed prompt or session is the step's failure. A failed resume is not (the bootstrap
        // notes it and starts a fresh session).
        if (event.fatal || this.turnInFlight) this.fail(event.message);
        return;
      default:
        return;
    }
  }

  private onRequest(request: AcpMessage): AcpRequestAnswer {
    if (request.method !== 'session/request_permission' || !isRecord(request.params)) {
      return { error: { code: -32601, message: `Method not found: ${String(request.method)}` } };
    }
    const options = Array.isArray(request.params.options) ? request.params.options.filter(isRecord) : [];
    // `allow_once` first: `allow_always` would write a standing rule into the user's own Cline settings.
    const choice =
      options.find((o) => o.kind === 'allow_once') ?? options.find((o) => o.kind === 'allow_always') ?? options[0];
    const title =
      isRecord(request.params.toolCall) && typeof request.params.toolCall.title === 'string'
        ? request.params.toolCall.title
        : 'a tool call';
    if (!choice || typeof choice.optionId !== 'string') {
      this.emit({ type: 'note', message: `Cline asked permission for ${title} with no option onni could pick; cancelled` });
      return { result: { outcome: { outcome: 'cancelled' } } };
    }
    this.emit({
      type: 'note',
      message: `Cline asked permission for ${title}; auto-approved (${String(choice.kind ?? choice.optionId)}) — onni runs Cline in auto mode`,
    });
    return { result: { outcome: { outcome: 'selected', optionId: choice.optionId } } };
  }

  // ---- helpers --------------------------------------------------------------------------

  private toAcp(content: ContentBlock[]): AcpContentBlock[] {
    const blocks: AcpContentBlock[] = [];
    let droppedImages = 0;
    for (const block of content) {
      if (block.type === 'text') blocks.push({ type: 'text', text: block.text });
      else if (this.imagesSupported || !this.acpSessionId) {
        blocks.push({ type: 'image', data: block.source.data, mimeType: block.source.media_type });
      } else droppedImages += 1;
    }
    if (droppedImages > 0) this.emit({ type: 'note', message: `Cline CLI does not accept images; dropped ${droppedImages}` });
    return blocks;
  }

  private fail(message: string): void {
    if (this.failed) return;
    this.failed = message;
    this.emit({ type: 'error', message });
  }

  private emit(event: AgentEvent): void {
    this.onEvent?.(event);
  }

  private stderrText(): string {
    return this.stderr.join('');
  }

  /** Close stdin, then SIGTERM→SIGKILL for a CLI that ignores EOF (#703, #844). `hard` skips the
   *  EOF grace: cancel means now. */
  private terminate(hard: boolean): void {
    try {
      this.child.stdin.end();
    } catch {
      // already gone
    }
    const signal = (sig: NodeJS.Signals): void => {
      if (this.hasExited()) return;
      this.terminatedByOnni = true;
      this.child.kill(sig);
    };
    if (hard) {
      this.terminatedByOnni = true;
      signal('SIGTERM');
      const kill = setTimeout(() => signal('SIGKILL'), EOF_KILL_GRACE_MS);
      kill.unref?.();
      this.timers.push(kill);
      return;
    }
    const term = setTimeout(() => {
      signal('SIGTERM');
      const kill = setTimeout(() => signal('SIGKILL'), EOF_KILL_GRACE_MS);
      kill.unref?.();
      this.timers.push(kill);
    }, EOF_TERM_GRACE_MS);
    term.unref?.();
    this.timers.push(term);
  }
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => {
    child.once('close', (code) => resolve(code));
    child.once('error', () => resolve(child.exitCode ?? null));
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/** Path to the bundled mock (`scripts/mock-cline-acp.mjs`), for ONNI_DRY_RUN=1. */
function mockClinePath(): string {
  // Resolved like `mockPiPath`: `new URL().pathname` yields `/C:/…` on Windows, which spawn rejects.
  const here = dirname(fileURLToPath(import.meta.url));
  // here = <pkg>/dist/core (built) or <pkg>/src/core (tsx dev).
  return resolvePath(here, '..', '..', 'scripts', 'mock-cline-acp.mjs');
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
