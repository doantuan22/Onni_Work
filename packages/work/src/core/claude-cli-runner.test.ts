import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent, AgentSession } from './agent-runner.ts';
import { isSignalTerminationExit, prependSystemPrompt } from './agent-runner.ts';
import {
  buildClaudeArgs,
  CLAUDE_HEADLESS_GUIDANCE,
  ClaudeCliRunner,
  appendClaudeSystemPrompt,
  claudeExitMessage,
  EOF_KILL_GRACE_MS,
  EOF_TERM_GRACE_MS,
  KILL_GRACE_MS,
  waitForExit,
} from './claude-cli-runner.ts';
import type { RunRecord } from '@onni/contract';
import { remainingBudgetUsd } from '../dispatch/engine.ts';
import type { UiEvent } from './ui-events.ts';

/** Only the escalation tests below swap the child out; every other test in this
 *  file keeps spawning its real stub binary through the untouched `spawn`. */
const spawnHook = vi.hoisted(() => ({ override: null as null | (() => unknown) }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) =>
      spawnHook.override ? spawnHook.override() : actual.spawn(...args),
  };
});

/**
 * The per-backend system-prompt delivery mechanism (spec §protocol v2
 * mapping table): claude gets `--append-system-prompt`, codex/opencode get
 * the prompt prepended to the opening user message (`prependSystemPrompt`,
 * shared by both runners).
 */
describe('buildClaudeArgs systemPrompt', () => {
  const spec = { userPrompt: 'do it', cwd: '/tmp' };

  it('emits --append-system-prompt with the exact text', () => {
    const args = buildClaudeArgs({ ...spec, systemPrompt: 'Extra rules.\n\n---\n\nContract.' });
    const idx = args.indexOf('--append-system-prompt');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe(appendClaudeSystemPrompt('Extra rules.\n\n---\n\nContract.'));
  });

  it('always appends Claude-local headless denial guidance', () => {
    const args = buildClaudeArgs(spec);
    const idx = args.indexOf('--append-system-prompt');
    expect(args[idx + 1]).toBe(CLAUDE_HEADLESS_GUIDANCE);
  });

  it('preserves caller instructions before the backend guidance', () => {
    expect(appendClaudeSystemPrompt('Caller rules.')).toBe(
      `Caller rules.\n\n---\n\n${CLAUDE_HEADLESS_GUIDANCE}`,
    );
  });

  it('uses the same guidance for a resumed call without changing resume args', () => {
    const initial = buildClaudeArgs({ ...spec, sessionId: 'session-1' });
    const resumed = buildClaudeArgs({ ...spec, sessionId: 'session-1', resume: true });
    expect(initial[initial.indexOf('--append-system-prompt') + 1]).toBe(CLAUDE_HEADLESS_GUIDANCE);
    expect(resumed[resumed.indexOf('--append-system-prompt') + 1]).toBe(CLAUDE_HEADLESS_GUIDANCE);
    expect(initial).toContain('--session-id');
    expect(resumed).toContain('--resume');
  });
});

describe('buildClaudeArgs output mode', () => {
  const spec = { userPrompt: 'do it', cwd: '/tmp' };

  it('runs in print mode, which both stream-json formats require', () => {
    expect(buildClaudeArgs(spec)).toContain('--print');
  });

  it('asks for partial messages so text streams as deltas', () => {
    expect(buildClaudeArgs(spec)).toContain('--include-partial-messages');
  });
});

describe('buildClaudeArgs approval gate', () => {
  const spec = { userPrompt: 'do it', cwd: '/tmp' };

  it('denies unapproved tools without prompting by default', () => {
    const args = buildClaudeArgs(spec, {});
    const idx = args.indexOf('--permission-mode');
    expect(args[idx + 1]).toBe('dontAsk');
  });

  it('enables Claude approval prompts only when explicitly requested', () => {
    const args = buildClaudeArgs(spec, { ONNI_APPROVAL_GATE: '1' });
    const idx = args.indexOf('--permission-mode');
    expect(args[idx + 1]).toBe('acceptEdits');
  });
});

/**
 * #703 — a session onni tore down itself must not settle as an agent
 * failure. Every agent CLI installs its own stop-signal handler and exits
 * `128 + signal`, so the runner sees a NON-ZERO code for a teardown it
 * asked for (goal achieved → `end()`, or a user cancel → `interrupt()`).
 */
describe('isSignalTerminationExit', () => {
  it('recognizes the 128+signal codes a signalled CLI reports', () => {
    expect(isSignalTerminationExit(130)).toBe(true); // SIGINT
    expect(isSignalTerminationExit(137)).toBe(true); // SIGKILL
    expect(isSignalTerminationExit(143)).toBe(true); // SIGTERM
  });

  it('leaves genuine failures and clean exits alone', () => {
    for (const code of [0, 1, 2, 127, null]) {
      expect(isSignalTerminationExit(code)).toBe(false);
    }
  });
});

describe('a teardown onni initiated', () => {
  const stubBin = fileURLToPath(
    new URL('./__fixtures__/claude/stub-ignores-eof-exits-143.mjs', import.meta.url),
  );

  it('settles the session instead of failing it when the CLI exits 143', async () => {
    const runner = new ClaudeCliRunner({ bin: stubBin, timeoutMs: 0 });
    const events: AgentEvent[] = [];
    const uiEvents: UiEvent[] = [];
    let sawText: () => void = () => {};
    const firstText = new Promise<void>((resolve) => {
      sawText = resolve;
    });
    const session = runner.startSession(
      { userPrompt: 'do it', cwd: process.cwd() },
      (event) => {
        events.push(event);
        if (event.type === 'text') sawText();
      },
      { onUiEvent: (event) => uiEvents.push(event) },
    );
    await firstText;

    // The cancel path; the EOF watchdog reaches the same `signalChild`.
    session.interrupt();
    const result = await session.result;

    expect(result.text).toBe('work done');
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(
      uiEvents.some((event) => event.type === 'turn.completed' && event.stopReason === 'error'),
    ).toBe(false);
    // Windows runs no handler on `kill` (TerminateProcess), so the CLI dies before
    // its normalised `result` frame: the runner closes the turn itself, as cancelled.
    const killedByOs = process.platform === 'win32';
    expect(uiEvents).toContainEqual({
      type: 'turn.completed',
      turnId: 'turn_1',
      stopReason: killedByOs ? 'cancelled' : 'end_turn',
    });
    expect(events.at(-1)).toEqual({ type: 'done' });
    expect(
      events.some(
        (e) =>
          e.type === 'note' &&
          e.message.includes(
            killedByOs ? 'terminated by onni (signal SIGTERM)' : 'terminated by onni (code 143)',
          ),
      ),
    ).toBe(true);
  }, 15_000);
});

/**
 * #844 — the watchdogs used to ask `!child.killed` before escalating, but Node
 * sets `killed` the moment a signal is *delivered*. claude installs its own
 * SIGTERM handler, so the flag went true while the process ran on and the
 * SIGKILL that exists for exactly that case was never sent — one leaked CLI per
 * teardown. The escalation now follows real termination instead.
 */
describe('SIGTERM→SIGKILL escalation for a CLI that survives SIGTERM', () => {
  function signallableChild(): {
    child: ChildProcessWithoutNullStreams;
    signals: NodeJS.Signals[];
    exit: (code: number) => void;
  } {
    const signals: NodeJS.Signals[] = [];
    const emitter = new EventEmitter();
    const child = Object.assign(emitter, {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      killed: false,
      pid: 4242,
      // Node's semantics: delivery flips `killed`; a CLI with its own handler
      // keeps running with `exitCode` still null.
      kill: (signal: NodeJS.Signals) => {
        signals.push(signal);
        Object.assign(child, { killed: true });
        return true;
      },
    }) as unknown as ChildProcessWithoutNullStreams;
    const exit = (code: number) => {
      Object.assign(child, { exitCode: code });
      emitter.emit('exit', code, null);
    };
    return { child, signals, exit };
  }

  function withFakeChild(run: (fake: ReturnType<typeof signallableChild>) => void): void {
    const fake = signallableChild();
    spawnHook.override = () => fake.child;
    vi.useFakeTimers();
    try {
      run(fake);
    } finally {
      vi.useRealTimers();
      spawnHook.override = null;
    }
  }

  it('escalates after end() even though Node already flagged the child as killed', () => {
    withFakeChild((fake) => {
      const session = new ClaudeCliRunner({ bin: 'claude', timeoutMs: 0 }).startSession({
        userPrompt: 'do it',
        cwd: process.cwd(),
      });
      session.end();

      vi.advanceTimersByTime(EOF_TERM_GRACE_MS);
      expect(fake.signals).toEqual(['SIGTERM']);
      // Delivered, not dead — the state that used to disable the escalation.
      expect(fake.child.killed).toBe(true);
      expect(fake.child.exitCode).toBeNull();

      vi.advanceTimersByTime(EOF_KILL_GRACE_MS);
      expect(fake.signals).toEqual(['SIGTERM', 'SIGKILL']);
    });
  });

  it('escalates on the wall-clock timeout path as well', () => {
    withFakeChild((fake) => {
      const session = new ClaudeCliRunner({ bin: 'claude', timeoutMs: 20 }).startSession({
        userPrompt: 'do it',
        cwd: process.cwd(),
      });
      void session.result.catch(() => undefined);

      vi.advanceTimersByTime(20);
      expect(fake.signals).toEqual(['SIGTERM']);

      vi.advanceTimersByTime(KILL_GRACE_MS);
      expect(fake.signals).toEqual(['SIGTERM', 'SIGKILL']);
    });
  });

  // cf2191f1: a 30-minute WALL clock killed steps that were still streaming work.
  it('never kills a session that keeps streaming, only one that went silent for the whole window', async () => {
    const fake = signallableChild();
    spawnHook.override = () => fake.child;
    vi.useFakeTimers();
    try {
      const events: AgentEvent[] = [];
      const session = new ClaudeCliRunner({ bin: 'claude', timeoutMs: 1_000 }).startSession(
        { userPrompt: 'do it', cwd: process.cwd() },
        (event) => events.push(event),
      );
      void session.result.catch(() => undefined);
      const frame = `${JSON.stringify({ type: 'system', subtype: 'status' })}\n`;
      for (let i = 0; i < 5; i += 1) {
        (fake.child.stdout as PassThrough).write(frame);
        await vi.advanceTimersByTimeAsync(800);
      }
      // 4 s of wall clock against a 1 s limit: still alive, because it never went quiet.
      expect(fake.signals).toEqual([]);

      await vi.advanceTimersByTimeAsync(200);
      expect(fake.signals).toEqual(['SIGTERM']);
      fake.exit(143);
      await session.result;
      const error = events.find((e) => e.type === 'error');
      expect(error).toEqual({
        type: 'error',
        message: 'claude CLI timed out after 1s without any output and was killed — Continue picks the task up again',
      });
    } finally {
      vi.useRealTimers();
      spawnHook.override = null;
    }
  });

  it('stops escalating once the CLI really exits after SIGTERM', () => {
    withFakeChild((fake) => {
      const session = new ClaudeCliRunner({ bin: 'claude', timeoutMs: 0 }).startSession({
        userPrompt: 'do it',
        cwd: process.cwd(),
      });
      session.end();

      vi.advanceTimersByTime(EOF_TERM_GRACE_MS);
      expect(fake.signals).toEqual(['SIGTERM']);
      fake.exit(143);

      vi.advanceTimersByTime(EOF_KILL_GRACE_MS);
      expect(fake.signals).toEqual(['SIGTERM']);
    });
  });

  it('stops accepting messages once the child has exited on its own', () => {
    withFakeChild((fake) => {
      const session = new ClaudeCliRunner({ bin: 'claude', timeoutMs: 0 }).startSession({
        userPrompt: 'do it',
        cwd: process.cwd(),
      });
      expect(session.open).toBe(true);
      fake.exit(1);

      expect(session.open).toBe(false);
      expect(session.sendMessage([{ type: 'text', text: 'are you there?' }])).toBe(false);
    });
  });
});

describe('claudeExitMessage', () => {
  it('names a hangup the CLI exited on, which onni never sends (telemetry 046a0525)', () => {
    expect(claudeExitMessage(129, '')).toBe(
      'claude CLI exited with code 129 (SIGHUP: the terminal or console it ran under went away — onni did not stop it)',
    );
  });

  it('names any other signal exit, and keeps the stderr tail', () => {
    expect(claudeExitMessage(137, 'a\nb')).toBe('claude CLI exited with code 137 (SIGKILL: a signal onni did not send) — a | b');
  });

  it('leaves an ordinary failure code alone', () => {
    expect(claudeExitMessage(1, 'boom\n')).toBe('claude CLI exited with code 1 — boom');
  });
});

describe('prependSystemPrompt (codex/opencode delivery)', () => {
  it('prepends the prompt as a leading block of the first user message', () => {
    expect(prependSystemPrompt('Extra rules.', 'do it')).toBe('Extra rules.\n\n---\n\ndo it');
  });

  it('leaves the user prompt untouched when no systemPrompt is set', () => {
    expect(prependSystemPrompt(undefined, 'do it')).toBe('do it');
  });
});

describe('ClaudeCliRunner token usage', () => {
  it('counts the aggregate result usage without re-adding assistant-frame snapshots', async () => {
    const mockBin = fileURLToPath(new URL('../../scripts/mock-claude.mjs', import.meta.url));
    const runner = new ClaudeCliRunner({ bin: mockBin, timeoutMs: 60_000 });
    const events: AgentEvent[] = [];
    const cwd = mkdtempSync(join(tmpdir(), 'onni-claude-token-usage-'));

    try {
      const result = await runner.run(
        {
          userPrompt: 'fix the login redirect',
          cwd,
          env: {
            ONNI_HANDOFF_FILE: '',
            ONNI_MOCK_ARGS_FILE: '',
            ONNI_TODOS_FILE: '',
          },
          sessionId: '5f701b42-382a-4a6e-b831-0ab9e56eff58',
        },
        (event) => events.push(event),
      );

      // The mock emits four assistant usage snapshots before its aggregate
      // result usage (1,270 input + 185 output). Only the result is authoritative.
      expect(result.tokensUsed).toBe(1_455);
      expect(events.filter((event) => event.type === 'token-usage')).toEqual([
        { type: 'token-usage', tokensUsed: 1_455 },
      ]);
    } finally {
      rmSync(cwd, { force: true, recursive: true });
    }
  });
});

describe('ClaudeCliRunner private MCP (spec 2026-10-07-private-project-mcp)', () => {
  it('spawns with --mcp-config pointing at a 0600 file that is gone once the session ends', async () => {
    const mockBin = fileURLToPath(new URL('../../scripts/mock-claude.mjs', import.meta.url));
    const runner = new ClaudeCliRunner({ bin: mockBin, timeoutMs: 60_000 });
    const cwd = mkdtempSync(join(tmpdir(), 'onni-claude-private-mcp-'));
    const argsFile = join(cwd, 'args.ndjson');
    try {
      await runner.run({
        userPrompt: 'do it',
        cwd,
        env: { ONNI_HANDOFF_FILE: '', ONNI_MOCK_ARGS_FILE: argsFile, ONNI_TODOS_FILE: '' },
        allowedTools: ['Read'],
        mcpServers: [{ name: 'tracker', transport: 'stdio', command: 'tracker-mcp', args: [], env: { TOKEN: 's3cret' }, headers: {} }],
      });
      const argv = JSON.parse(readFileSync(argsFile, 'utf8').trim().split('\n')[0]!) as string[];
      const configPath = argv[argv.indexOf('--mcp-config') + 1]!;
      expect(argv).toContain('--mcp-config');
      expect(argv[argv.indexOf('--allowedTools') + 1]).toBe('Read,mcp__tracker');
      expect(argv.join(' ')).not.toContain('s3cret');
      expect(existsSync(configPath)).toBe(false);
    } finally {
      rmSync(cwd, { force: true, recursive: true });
    }
  });
});

describe('Claude same-session messages', () => {
  it('accepts a live follow-up on stdin without claiming a protocol receipt', async () => {
    const mockBin = fileURLToPath(new URL('../../scripts/mock-claude.mjs', import.meta.url));
    const events: AgentEvent[] = [];
    let session!: AgentSession;
    let followUpAccepted: boolean | undefined;
    let turnEnds = 0;
    let resolveTwoTurns!: () => void;
    const twoTurnsEnded = new Promise<void>((resolve) => {
      resolveTwoTurns = resolve;
    });

    session = new ClaudeCliRunner({ bin: mockBin, timeoutMs: 60_000 }).startSession(
      {
        userPrompt: 'mock:pause',
        cwd: process.cwd(),
        env: { ONNI_HANDOFF_FILE: '', ONNI_TODOS_FILE: '', ONNI_MOCK_PACE: '0' },
      },
      (event) => {
        events.push(event);
        if (event.type === 'tool-call' && followUpAccepted === undefined) {
          // Claude accepts the user frame on the current CLI session's stdin.
          followUpAccepted = session.sendMessage([{ type: 'text', text: 'manager direction' }]);
        }
        if (event.type === 'turn-end' && ++turnEnds === 2) resolveTwoTurns();
      },
    );

    try {
      expect(session.sendMessageWithReceipt).toBeUndefined();
      await twoTurnsEnded;
      expect(followUpAccepted).toBe(true);
      expect(events.some((event) => event.type === 'text' && event.text.includes('Follow-up #1 received: "manager direction"'))).toBe(true);
    } finally {
      session.end();
      await session.result;
    }
  }, 20_000);
});

describe('a CLI that dies before reading its prompt', () => {
  const stubBin = fileURLToPath(
    new URL('./__fixtures__/claude/stub-exits-before-reading.mjs', import.meta.url),
  );

  // A failed stdin write surfaces as an async 'error' event on the pipe, not a throw; unhandled,
  // it crashed the whole onni process (seen on a fleet hub when the CLI failed to start).
  it('fails the session instead of crashing the process on EPIPE', async () => {
    const runner = new ClaudeCliRunner({ bin: stubBin, timeoutMs: 0 });
    const session = runner.startSession(
      { userPrompt: 'x'.repeat(8 * 1024 * 1024), cwd: process.cwd() },
      () => {},
    );
    await expect(session.result).rejects.toThrow('claude CLI exited with code 1');
    // Give a late EPIPE time to surface as an unhandled error, which vitest reports as a failure.
    await new Promise((resolve) => setTimeout(resolve, 500));
  });
});

// Spec 2026-10-24 item 9 (eb4b12dc): a gateway's OpenAI-shaped envelope read as its type and message.
describe('claude result error with a JSON envelope', () => {
  it('shows the vendor error type and message, not the raw JSON', async () => {
    const root = mkdtempSync(join(tmpdir(), 'claude-envelope-'));
    const bin = join(root, 'claude.mjs');
    const result = 'API Error: 400 [400]: {"error":{"type":"invalid_request_error","message":"model gpt-5 is not available","param":null,"code":null}}';
    writeFileSync(bin, `#!/usr/bin/env node\nconsole.log(${JSON.stringify(JSON.stringify({ type: 'result', is_error: true, result }))});\nprocess.exit(1);\n`, { mode: 0o755 });
    try {
      const errors: string[] = [];
      await new ClaudeCliRunner({ bin, timeoutMs: 5000 })
        .run({ cwd: root, userPrompt: 'work' }, (event) => { if (event.type === 'error') errors.push(event.message); })
        .catch(() => undefined);
      expect(errors).toContain('API Error: 400 [400]: invalid_request_error: model gpt-5 is not available');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

// #844 family: Windows `kill()` is TerminateProcess, so a teardown leaves `exitCode` null and
// only `signalCode` set. Seeding the fast path from `exitCode` alone waited for a 'close' event
// that had already fired — every stopped turn then sat out the 27 s safety timer.
describe('waitForExit on a signal-only exit', () => {
  it('returns at once instead of waiting out the safety timer', async () => {
    const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: 'SIGTERM', pid: 1 }) as unknown as ChildProcessWithoutNullStreams;
    const started = Date.now();
    const outcome = await Promise.race([
      waitForExit(child),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 1_000)),
    ]);
    expect(outcome).toBeNull();
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe('a stream with JSON lines that are not objects', () => {
  const stubBin = fileURLToPath(new URL('./__fixtures__/claude/stub-prints-non-object-json.mjs', import.meta.url));

  // `null`, `42` and `true` parse as JSON, so they got past the unparseable-line guard and the next
  // property read threw — which fails the whole run instead of skipping one stray line.
  it('skips them like any unparseable line and still finishes the real turn', async () => {
    const runner = new ClaudeCliRunner({ bin: stubBin, timeoutMs: 20_000 });
    const events: AgentEvent[] = [];
    const result = await runner.run({ userPrompt: 'do it', cwd: process.cwd() }, (event) => events.push(event));
    expect(result.text).toContain('work done');
    expect(events.some((event) => event.type === 'text')).toBe(true);
    expect(events.filter((event) => event.type === 'note' && /skipped/.test(event.message)).length).toBeGreaterThan(0);
  }, 30_000);
});

/**
 * Q1 — `total_cost_usd` is cumulative for the SESSION, not per turn. Measured on the real CLI
 * (2.1.316, haiku, one process, two turns): 0.0077524 then 0.01018322; the CLI's own per-turn figure
 * for turn 2 (`model_usage_since_last_result`) was 0.00243082 = the difference. The v1 `cost` event is
 * an increment (RunManager does `stepCost += usd`), so the runner must emit the difference.
 */
describe('claude session-cumulative total_cost_usd (Q1)', () => {
  const fixtureBin = fileURLToPath(new URL('./__fixtures__/claude/stub-replays-two-turn-cost.mjs', import.meta.url));
  const totalsBin = fileURLToPath(new URL('./__fixtures__/claude/stub-replays-cumulative-totals.mjs', import.meta.url));

  const costs = async (bin: string, env: Record<string, string>, extra: Record<string, unknown> = {}): Promise<number[]> => {
    const runner = new ClaudeCliRunner({ bin, timeoutMs: 20_000 });
    const events: AgentEvent[] = [];
    await runner.run({ userPrompt: 'reply ok', cwd: process.cwd(), env, ...extra }, (event) => events.push(event));
    return events.flatMap((event) => (event.type === 'cost' ? [event.usd] : []));
  };
  const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

  it('charges a two-turn session its real total, not turn 1 twice', async () => {
    const emitted = await costs(fixtureBin, {});
    expect(emitted).toHaveLength(2);
    expect(emitted[0]).toBe(0.0077524000000000004);
    expect(sum(emitted)).toBe(0.01018322);
  }, 30_000);

  it('charges three turns their real total', async () => {
    // Binary fractions, so the sum is exact and `toBe` is meaningful.
    const emitted = await costs(totalsBin, { STUB_TOTALS: JSON.stringify([0.25, 0.5, 0.875]) });
    expect(emitted).toEqual([0.25, 0.25, 0.375]);
    expect(sum(emitted)).toBe(0.875);
  }, 30_000);

  it('a resumed process starts from the cost its session already had', async () => {
    // `--resume` replays the session: the first result of the new process already contains turn 1.
    const emitted = await costs(fixtureBin, { STUB_RESUMED: '1' }, { resume: true, costBaselineUsd: 0.0077524000000000004 });
    expect(sum([0.0077524000000000004, ...emitted])).toBe(0.01018322);
  }, 30_000);

  it('a fresh session starts from zero', async () => {
    const emitted = await costs(totalsBin, { STUB_TOTALS: JSON.stringify([0.5]) }, { costBaselineUsd: 0.25 });
    expect(emitted).toEqual([0.5]);
  }, 30_000);

  it('does not refuse a child that asks for the budget really left', async () => {
    const spent = sum(await costs(fixtureBin, {}));
    const parent = { id: 'p', dispatch: { rootRunId: 'm', budgetUsd: 0.02 }, steps: [] } as unknown as RunRecord;
    const child = { id: 'c', status: 'done', costUsd: spent, dispatch: { rootRunId: 'm', parentRunId: 'p', budgetUsd: 0.02 }, steps: [] } as unknown as RunRecord;
    // 0.02 − 0.01018322, rounded to 1e-6: a child may ask for 0.0098. Counting turn 1 twice left 0.002.
    expect(remainingBudgetUsd(parent, [child])).toBe(0.009817);
  }, 30_000);
});
