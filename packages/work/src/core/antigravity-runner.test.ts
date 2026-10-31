/**
 * The Antigravity runner against the bundled mock `agy` (scripts/mock-antigravity.mjs): no real
 * agent is ever started. Prompt markers pick the scenario; see the mock's header.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentEvent, AgentRunResult, AgentRunSpec } from './agent-runner.ts';
import { clearAntigravityProbeCache } from './antigravity-cli.ts';
import { mockAntigravityPath } from './antigravity-bin.ts';
import {
  ANTIGRAVITY_MAX_PROMPT_CHARS,
  AntigravityRunner,
  buildAntigravityArgs,
  liveAntigravityChildren,
} from './antigravity-runner.ts';
import { classifyAgentFailure } from './agent-failure-class.ts';
import type { UiEvent } from './ui-events.ts';

const FAST = { silenceMs: 600, startupMs: 600, exitGraceMs: 500, killGraceMs: 300 };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'onni-agy-'));
  clearAntigravityProbeCache();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function runner(extra: ConstructorParameters<typeof AntigravityRunner>[0] = {}): AntigravityRunner {
  return new AntigravityRunner({ bin: mockAntigravityPath(), ...FAST, ...extra });
}

async function runTurn(prompt: string, spec: Partial<AgentRunSpec> = {}, extra = {}) {
  const events: AgentEvent[] = [];
  const ui: UiEvent[] = [];
  const session = runner(extra).startSession({ userPrompt: prompt, cwd: dir, ...spec }, (e) => events.push(e), {
    onUiEvent: (e) => ui.push(e),
  });
  const outcome: { result?: AgentRunResult; error?: string } = await session.result.then(
    (result) => ({ result }),
    (error: Error) => ({ error: error.message }),
  );
  return { events, ui, session, ...outcome };
}

describe('AntigravityRunner (mock agy)', () => {
  it('runs a turn: version note first, session id, text, usage, turn end, done', async () => {
    const { events, ui, result } = await runTurn('do the thing');
    expect(events[0]).toMatchObject({ type: 'note', kind: 'agent-version', value: '1.4.12-mock' });
    expect(events.find((e) => e.type === 'session')).toEqual({ type: 'session', sessionId: 'mock-conversation' });
    expect(events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('')).toContain('dry-run completed');
    expect(events.some((e) => e.type === 'turn-end')).toBe(true);
    expect(events.at(-1)).toEqual({ type: 'done' });
    expect(result).toMatchObject({ tokensUsed: 120, sessionId: 'mock-conversation' });
    expect(ui[0]).toMatchObject({ type: 'session.started', backend: 'antigravity' });
    expect(ui.at(-1)).toMatchObject({ type: 'turn.completed', stopReason: 'end_turn' });
  }, 20_000);

  it('empty answer + a denied command → the run fails and says what was denied', async () => {
    const { events, error } = await runTurn('mock:denied');
    expect(error).toContain('npm test');
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(events.at(-1)?.type).not.toBe('done');
  }, 20_000);

  it('an answer + a denied command → resolves, with a denied-action note and no error', async () => {
    const { events, error, result } = await runTurn('mock:denied-answer');
    expect(error).toBeUndefined();
    expect(result).toBeDefined();
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(events.filter((e) => e.type === 'note' && e.kind === 'denied-action')).toHaveLength(1);
  }, 20_000);

  it('empty answer and nothing denied → fails', async () => {
    const { error } = await runTurn('mock:empty');
    expect(error).toContain('empty response');
  }, 20_000);

  it('survives noise and a cut-off line in the stream', async () => {
    const { error, events } = await runTurn('mock:badlines');
    expect(error).toBeUndefined();
    expect(events.some((e) => e.type === 'turn-end')).toBe(true);
  }, 20_000);

  it('watchdog: no output at all after spawn is killed and reported, not left hanging', async () => {
    const { events, error } = await runTurn('mock:nostart', {}, { startupMs: 300, silenceMs: 5_000 });
    expect(error).toBeUndefined();
    const failure = events.find((e) => e.type === 'error') as { message: string } | undefined;
    expect(failure?.message).toContain('no output');
    expect(events.at(-1)).toEqual({ type: 'done' });
    expect(liveAntigravityChildren()).toBe(0);
  }, 20_000);

  it('watchdog: silence after the start is killed and reported', async () => {
    const { events } = await runTurn('mock:silent', {}, { startupMs: 30_000, silenceMs: 500 });
    const failure = events.find((e) => e.type === 'error') as { message: string } | undefined;
    expect(failure?.message).toContain('timed out');
    expect(liveAntigravityChildren()).toBe(0);
  }, 20_000);

  it('an emergency stop kills the process and leaves no child behind', async () => {
    const events: AgentEvent[] = [];
    const session = runner({ startupMs: 30_000, silenceMs: 30_000 }).startSession(
      { userPrompt: 'mock:silent', cwd: dir },
      (e) => events.push(e),
    );
    await new Promise((r) => setTimeout(r, 400));
    expect(liveAntigravityChildren()).toBeGreaterThan(0);
    session.hardStop?.();
    await session.result;
    expect(session.open).toBe(false);
    expect(liveAntigravityChildren()).toBe(0);
  }, 20_000);

  it('resumes with --conversation <id>, and only when asked to', async () => {
    const argsFile = join(dir, 'args.jsonl');
    const env = { ONNI_MOCK_ARGS_FILE: argsFile };
    await runTurn('hello', { env, resume: true, sessionId: 'conv-123' });
    await runTurn('hello', { env, resume: false, sessionId: 'a-fresh-onni-uuid' });
    const turns = readFileSync(argsFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as string[])
      .filter((argv) => argv.includes('-p')); // the mock also logs the `--version` probe
    expect(turns).toHaveLength(2);
    expect(turns[0]).toContain('--conversation');
    expect(turns[0]![turns[0]!.indexOf('--conversation') + 1]).toBe('conv-123');
    expect(turns[1]).not.toContain('--conversation');
  }, 30_000);

  it('sendMessage is refused with a note: print mode is one turn per process', async () => {
    const { events, session } = await runTurn('hi');
    expect(session.sendMessage([{ type: 'text', text: 'more' }])).toBe(false);
    expect(events.some((e) => e.type === 'note' && e.message.includes('one-shot'))).toBe(true);
  }, 20_000);

  it('refuses a prompt that cannot fit on a command line, before spawning anything', () => {
    expect(() => runner().startSession({ userPrompt: 'x'.repeat(ANTIGRAVITY_MAX_PROMPT_CHARS + 1), cwd: dir })).toThrow(
      /command line/,
    );
    expect(liveAntigravityChildren()).toBe(0);
  });
});

/** True while a process with this pid exists (signal 0 only probes). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('not signed in (synthetic scenarios: the real wording was never captured)', () => {
  it('never waits on a login: stdin is closed at spawn, so a login read ends at once', async () => {
    const started = Date.now();
    const { error, events } = await runTurn('mock:login-eof', {}, { startupMs: 30_000, silenceMs: 30_000 });
    expect(Date.now() - started).toBeLessThan(15_000); // no watchdog was needed
    expect(error).toContain('not signed in');
    expect(error).toContain('run `agy` once');
    expect(events.filter((e) => e.type === 'error')).toHaveLength(1);
    expect(liveAntigravityChildren()).toBe(0);
  }, 30_000);

  it('the failure is classified as auth, so the run says "sign in, then Continue" and the digest can count it', async () => {
    const { error } = await runTurn('mock:login-eof', {}, { startupMs: 30_000, silenceMs: 30_000 });
    expect(classifyAgentFailure(error)).toBe('auth');
  }, 30_000);

  it('an agy that prints a login prompt and then ignores stdin is killed by the watchdog, and reported as a sign-in', async () => {
    const { events, error } = await runTurn('mock:login-hang', {}, { startupMs: 500, silenceMs: 30_000 });
    expect(error).toBeUndefined(); // a watchdog kill reports through an error event, like the other timeouts
    const failure = events.find((e) => e.type === 'error') as { message: string } | undefined;
    expect(failure?.message).toContain('not signed in');
    expect(classifyAgentFailure(failure?.message)).toBe('auth');
    expect(events.at(-1)).toEqual({ type: 'done' });
    expect(liveAntigravityChildren()).toBe(0);
  }, 30_000);
});

describe('process tree cleanup', () => {
  it('an interrupt kills the grandchild agy started, not only agy', async () => {
    const pidFile = join(dir, 'grandchild.pid');
    const session = runner({ startupMs: 30_000, silenceMs: 30_000 }).startSession(
      { userPrompt: 'mock:grandchild', cwd: dir, env: { ONNI_MOCK_PID_FILE: pidFile } },
      () => {},
    );
    const deadline = Date.now() + 10_000;
    while (!existsSync(pidFile) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    const grandchild = Number(readFileSync(pidFile, 'utf8'));
    expect(alive(grandchild)).toBe(true);
    session.interrupt();
    await session.result;
    const gone = Date.now() + 8_000;
    while (alive(grandchild) && Date.now() < gone) await new Promise((r) => setTimeout(r, 100));
    expect(alive(grandchild)).toBe(false);
    expect(liveAntigravityChildren()).toBe(0);
  }, 40_000);

  it('a watchdog kill takes the grandchild down too', async () => {
    const pidFile = join(dir, 'grandchild-wd.pid');
    const { events } = await runTurn('mock:grandchild', { env: { ONNI_MOCK_PID_FILE: pidFile } }, { startupMs: 30_000, silenceMs: 700 });
    expect(events.some((e) => e.type === 'error')).toBe(true);
    const grandchild = Number(readFileSync(pidFile, 'utf8'));
    const gone = Date.now() + 8_000;
    while (alive(grandchild) && Date.now() < gone) await new Promise((r) => setTimeout(r, 100));
    expect(alive(grandchild)).toBe(false);
  }, 40_000);
});

describe('buildAntigravityArgs', () => {
  const base = { userPrompt: 'task', permissionLevel: 'files-only' as const };

  it('files-only passes no permission flag at all', () => {
    expect(buildAntigravityArgs(base)).toEqual(['-p', 'task', '--output-format', 'stream-json']);
  });

  it('prepends the system prompt (agy has no channel for it) and selects the model', () => {
    const args = buildAntigravityArgs({ ...base, systemPrompt: 'be careful', model: ' claude-sonnet-4-6 ' });
    expect(args[1]).toBe('be careful\n\n---\n\ntask');
    expect(args.slice(-2)).toEqual(['--model', 'claude-sonnet-4-6']);
  });

  it('allow-rules passes one --settings JSON; bypass passes only the dangerous flag', () => {
    const rules = buildAntigravityArgs({ ...base, permissionLevel: 'allow-rules', bashAllowlist: ['npm test'] }); // one exact line
    const settings = JSON.parse(rules[rules.indexOf('--settings') + 1]!) as { permissions: { allow: string[] } };
    expect(settings.permissions.allow).toContain('command(npm test)');
    expect(rules).not.toContain('--dangerously-skip-permissions');
    const bypass = buildAntigravityArgs({ ...base, permissionLevel: 'bypass' });
    expect(bypass).toContain('--dangerously-skip-permissions');
    expect(bypass).not.toContain('--settings');
  });

  it('never passes --add-dir: with it agy wrote the task file into the added directory', () => {
    const args = buildAntigravityArgs({ ...base, permissionLevel: 'allow-rules', directories: ['C:\\runs\\handoff'] });
    expect(args).not.toContain('--add-dir');
    const settings = JSON.parse(args[args.indexOf('--settings') + 1]!) as { permissions: { allow: string[] } };
    expect(settings.permissions.allow).toContain('write_file(C:/runs/handoff)');
  });
});
