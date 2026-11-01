import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentEvent } from './agent-runner.ts';
import { createRunner } from './runner-factory.ts';
import { CLINE_AUTH_FAILURE_MESSAGE, CLINE_EMPTY_TURN_MESSAGE } from './cline-ui-mapper.ts';
import { ClineAcpRunner, buildClineArgs, clineExitMessage } from './cline-acp-runner.ts';
import type { UiEvent } from './ui-events.ts';

/**
 * The `cline` runner over the bundled `scripts/mock-cline-acp.mjs`, whose frames mirror the wire
 * recorded live from `cline --acp` 3.0.74 (`__fixtures__/cline/README.md`).
 */
const MOCK = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'mock-cline-acp.mjs');

let cwd: string;
beforeEach(() => {
  cwd = realpathSync(mkdtempSync(join(tmpdir(), 'onni-cline-run-')));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function collect() {
  const events: AgentEvent[] = [];
  const ui: UiEvent[] = [];
  return { events, ui, onEvent: (e: AgentEvent) => events.push(e), onUiEvent: (e: UiEvent) => ui.push(e) };
}

function waitFor(predicate: () => boolean, ms = 10_000): Promise<void> {
  return new Promise((resolveWait, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) return resolveWait();
      if (Date.now() - started > ms) return reject(new Error('timed out waiting'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe('buildClineArgs', () => {
  it('starts only the ACP server — model, worktree and hub are not the CLI flags onni uses', () => {
    expect(buildClineArgs()).toEqual(['--acp']);
  });

  it('never opts into `--worktree`, `--zen` or `--yolo`: onni owns the worktree and the fence', () => {
    for (const flag of ['--worktree', '--zen', '--yolo', '-y', '--auto-approve']) {
      expect(buildClineArgs()).not.toContain(flag);
    }
  });
});

describe('clineExitMessage', () => {
  it('translates an authentication failure into the line the server latches on', () => {
    expect(clineExitMessage(1, 'error: Authentication required')).toBe(CLINE_AUTH_FAILURE_MESSAGE);
  });

  it('otherwise reports the code and the tail of stderr, inventing no exit-code meanings', () => {
    expect(clineExitMessage(7, 'line one\nline two')).toBe('Cline CLI exited with code 7 — line one | line two');
    expect(clineExitMessage(null, '')).toBe('Cline CLI exited with code null');
  });

  it('says a mid-turn exit dropped the prompt, so a code 0 does not read as success', () => {
    expect(clineExitMessage(0, '', true)).toBe('Cline CLI quit mid-turn without answering the prompt (exit code 0)');
  });
});

describe('ClineAcpRunner — one turn over the mock', () => {
  const saved = process.env.ONNI_DRY_RUN;
  afterEach(() => {
    if (saved === undefined) delete process.env.ONNI_DRY_RUN;
    else process.env.ONNI_DRY_RUN = saved;
  });

  it('ONNI_DRY_RUN=1 swaps in the bundled mock and streams both protocols to one done', async () => {
    process.env.ONNI_DRY_RUN = '1';
    const argsFile = join(cwd, 'args.json');
    const c = collect();
    const session = new ClineAcpRunner().startSession(
      {
        userPrompt: 'fix the login redirect',
        systemPrompt: 'Be terse.',
        cwd,
        model: 'openai/gpt-6.1-sol',
        env: { ONNI_MOCK_CLINE_ARGS_FILE: argsFile },
      },
      c.onEvent,
      { autoEndAfterFirstTurn: true, onUiEvent: c.onUiEvent },
    );
    const result = await session.result;

    const types = c.events.map((e) => e.type);
    expect(types).toContain('session');
    expect(types).toContain('text');
    expect(types).toContain('tool-call');
    expect(types).toContain('tool-result');
    expect(types.filter((t) => t === 'turn-end')).toHaveLength(1);
    expect(types.filter((t) => t === 'done')).toHaveLength(1);
    expect(types).not.toContain('error');
    // Cline reports no usage anywhere on the wire, so none is invented — and the run says so.
    expect(types).not.toContain('token-usage');
    expect(result.tokensUsed).toBe(0);
    expect(c.events).toContainEqual({ type: 'note', message: 'token usage not reported by Cline CLI' });
    // The system prompt rides in the first message (ACP has no native channel), so the mock echoes it.
    expect(result.text).toContain('Be terse.');
    expect(result.text).toContain('fix the login redirect');
    expect(result.sessionId).toBe('1700000000000_mockCl_cli');

    const spawned = JSON.parse(readFileSync(argsFile, 'utf8')) as { argv: string[]; cwd: string };
    expect(spawned.argv).toEqual(['--acp']);
    // The session's working directory is the spawn cwd, so the agent's tools are rooted in it.
    expect(spawned.cwd).toBe(cwd);

    expect(c.ui.slice(0, 2).map((e) => e.type)).toEqual(['session.started', 'turn.started']);
    expect(c.ui).toContainEqual(expect.objectContaining({ type: 'session.started', backend: 'cline', cwd }));
    expect(c.ui).toContainEqual(expect.objectContaining({ type: 'turn.completed', stopReason: 'end_turn' }));
    expect(c.ui.at(-1)).toEqual({ type: 'session.ended', reason: 'end_turn' });
  });

  it('names a tool from its title prefix and follows pending → running → completed', async () => {
    process.env.ONNI_DRY_RUN = '1';
    const c = collect();
    await new ClineAcpRunner().startSession({ userPrompt: 'go', cwd }, c.onEvent, {
      autoEndAfterFirstTurn: true,
      onUiEvent: c.onUiEvent,
    }).result;

    const tools = c.ui.flatMap((e) => (e.type === 'item.started' && e.item.kind === 'tool' ? [e.item.name] : []));
    expect(tools).toEqual(['run_commands']);
    const statuses = c.ui.flatMap((e) =>
      (e.type === 'item.started' || e.type === 'item.updated' || e.type === 'item.completed') && e.item.kind === 'tool'
        ? [e.item.status]
        : []);
    expect(statuses[0]).toBe('pending');
    expect(statuses).toContain('running');
    expect(statuses.at(-1)).toBe('completed');
  });

  it('is what the factory builds for `cline` — never Claude by fallthrough', () => {
    expect(createRunner('cline')).toBeInstanceOf(ClineAcpRunner);
    expect(createRunner('cline').backend).toBe('cline');
  });
});

describe('ClineAcpRunner — permissions, failures and the empty turn', () => {
  it('auto-approves a permission request ONCE, never "always", and notes it', async () => {
    // Cline asks for every tool call even with its own auto-approve on, and nothing in the cockpit
    // can answer a permission card — a run parked on one is a dead end with no exit. `allow_always`
    // would also write a standing rule into the user's own Cline settings, so it is not picked.
    const c = collect();
    const session = new ClineAcpRunner({ bin: MOCK }).startSession({ userPrompt: 'go', cwd }, c.onEvent, {
      autoEndAfterFirstTurn: true,
      onUiEvent: c.onUiEvent,
    });
    const result = await session.result;

    expect(c.events).toContainEqual({
      type: 'note',
      message: 'Cline asked permission for run_commands: echo dry-run; auto-approved (allow_once) — onni runs Cline in auto mode',
    });
    // The choice really reached the agent, and the turn continued to a normal end.
    expect(result.text).toContain('[permission:allow_once]');
    expect(c.ui).toContainEqual(expect.objectContaining({ type: 'turn.completed', stopReason: 'end_turn' }));
  });

  it('fails a turn that ended with no text and no tool call, instead of settling it as done', async () => {
    // What a model this login cannot use did on the real CLI: `end_turn` after one
    // `session_info_update`, nothing changed. Reported as success it would mark the task done.
    const c = collect();
    const session = new ClineAcpRunner({ bin: MOCK }).startSession(
      { userPrompt: 'go', cwd, env: { ONNI_MOCK_CLINE_EMPTY_TURN: '1' } },
      c.onEvent,
      { autoEndAfterFirstTurn: true, onUiEvent: c.onUiEvent },
    );
    await session.result;

    expect(c.events).toContainEqual({ type: 'error', message: CLINE_EMPTY_TURN_MESSAGE });
    expect(c.ui.at(-1)).toEqual({ type: 'session.ended', reason: 'error' });
  });

  it('does not call a turn empty when onni itself ended the session', async () => {
    const c = collect();
    const session = new ClineAcpRunner({ bin: MOCK }).startSession(
      { userPrompt: 'go', cwd, env: { ONNI_MOCK_CLINE_PROMPT_HANGS: '1' } },
      c.onEvent,
      { onUiEvent: c.onUiEvent },
    );
    await waitFor(() => c.ui.some((e) => e.type === 'turn.started'));
    session.end();
    await session.result;

    expect(c.events.filter((e) => e.type === 'error')).toEqual([]);
    expect(c.ui.filter((e) => e.type === 'session.error')).toEqual([]);
  });

  it('surfaces an unauthenticated agent as a fatal, actionable session error', async () => {
    const c = collect();
    const session = new ClineAcpRunner({ bin: MOCK }).startSession(
      { userPrompt: 'go', cwd, env: { ONNI_MOCK_CLINE_UNAUTHENTICATED: '1' } },
      c.onEvent,
      { onUiEvent: c.onUiEvent },
    );
    await session.result;

    expect(c.events).toContainEqual({ type: 'error', message: CLINE_AUTH_FAILURE_MESSAGE });
    expect(c.ui).toContainEqual({ type: 'session.error', message: CLINE_AUTH_FAILURE_MESSAGE, fatal: true });
    expect(c.ui.at(-1)).toEqual({ type: 'session.ended', reason: 'error' });
  });

  it('a CLI that quits cleanly mid-turn on its own says the prompt went unanswered', async () => {
    const c = collect();
    const session = new ClineAcpRunner({ bin: MOCK }).startSession(
      { userPrompt: 'go', cwd, env: { ONNI_MOCK_CLINE_EXIT_MID_TURN: '1' } },
      c.onEvent,
      { onUiEvent: c.onUiEvent },
    );
    await session.result;
    expect(c.events).toContainEqual({ type: 'error', message: 'Cline CLI quit mid-turn without answering the prompt (exit code 0)' });
  });

  it('reports a missing binary as an install instruction, never as a silent no-op', async () => {
    const session = new ClineAcpRunner({ bin: join(cwd, 'definitely-not-cline') }).startSession(
      { userPrompt: 'go', cwd },
      () => {},
      { autoEndAfterFirstTurn: true },
    );
    await expect(session.result).rejects.toThrow(/not found on PATH.*npm i -g cline/s);
  });

  it('times out, kills the child, and says so', async () => {
    const c = collect();
    const session = new ClineAcpRunner({ bin: MOCK, timeoutMs: 1 }).startSession({ userPrompt: 'go', cwd }, c.onEvent, {
      onUiEvent: c.onUiEvent,
    });
    await session.result;
    expect(c.events.some((e) => e.type === 'error' && /timed out/.test(e.message))).toBe(true);
    expect(session.open).toBe(false);
  });
});

describe('ClineAcpRunner — session lifecycle', () => {
  it('keeps the same ACP session across a follow-up, in order', async () => {
    const c = collect();
    const session = new ClineAcpRunner({ bin: MOCK }).startSession({ userPrompt: 'first', cwd }, c.onEvent, {
      onUiEvent: c.onUiEvent,
    });
    await waitFor(() => c.events.filter((e) => e.type === 'turn-end').length === 1);
    expect(session.sendMessage([{ type: 'text', text: 'second' }])).toBe(true);
    await waitFor(() => c.events.filter((e) => e.type === 'turn-end').length === 2);
    session.end();
    const result = await session.result;

    expect(c.ui.filter((e) => e.type === 'session.started')).toHaveLength(1);
    expect(c.ui.filter((e) => e.type === 'turn.started').map((e) => e.type === 'turn.started' && e.turnId))
      .toEqual(['turn_1', 'turn_2']);
    expect(result.text).toContain('turn 2');
  });

  it('refuses a message once the session is closed', async () => {
    const c = collect();
    const session = new ClineAcpRunner({ bin: MOCK }).startSession({ userPrompt: 'hi', cwd }, c.onEvent, {
      autoEndAfterFirstTurn: true,
    });
    await session.result;
    expect(session.open).toBe(false);
    expect(session.sendMessage([{ type: 'text', text: 'too late' }])).toBe(false);
  });

  it('resumes an existing session with session/load instead of minting a new one', async () => {
    const c = collect();
    const session = new ClineAcpRunner({ bin: MOCK }).startSession(
      { userPrompt: 'continue', cwd, resume: true, sessionId: '1700000000001_resume_cli' },
      c.onEvent,
      { autoEndAfterFirstTurn: true, onUiEvent: c.onUiEvent },
    );
    const result = await session.result;

    expect(result.sessionId).toBe('1700000000001_resume_cli');
    expect(c.events).toContainEqual({ type: 'session', sessionId: '1700000000001_resume_cli' });
    expect(c.events.some((e) => e.type === 'note' && e.message.includes('could not resume'))).toBe(false);
  });

  it('cancel settles the turn as cancelled and leaves a usable result', async () => {
    const c = collect();
    const session = new ClineAcpRunner({ bin: MOCK }).startSession({ userPrompt: 'long job', cwd }, c.onEvent, {
      onUiEvent: c.onUiEvent,
    });
    await waitFor(() => c.ui.some((e) => e.type === 'item.started' && e.item.kind === 'tool'));
    session.interrupt();
    await session.result;

    const completed = c.ui.filter((e) => e.type === 'turn.completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ stopReason: 'cancelled' });
    // onni asked for the stop, so its own teardown signal is not reported as an agent failure —
    // and a cancelled turn is not the empty-turn failure either.
    expect(c.events.filter((e) => e.type === 'error')).toEqual([]);
  });
});
