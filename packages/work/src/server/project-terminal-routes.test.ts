import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RunStore } from '../runs/store.ts';
import { recordingProcessJobs } from '../test-fixtures/process-jobs.testkit.ts';
import type { RunManager } from '../workflows/run.ts';
import { createApp } from './server.ts';
import { apiRequest } from './loopback-request.testkit.ts';
import type { PtyBinding, PtyProcess, PtySpawnOptions } from './terminal/pty-module.ts';
import { TerminalSessions } from './terminal/sessions.ts';

/**
 * The project terminal: shells owned by the project, opened in its root, with an agent CLI typed
 * into them on request. A fake PTY again — what matters here is what gets typed, where the shell
 * opens, and that a task's terminal and the project's never reach each other.
 */

class FakePty implements PtyProcess {
  readonly pid = 888;
  written: string[] = [];
  private data?: (chunk: string) => void;
  onData(listener: (chunk: string) => void) { this.data = listener; return { dispose: () => {} }; }
  onExit() { return { dispose: () => {} }; }
  write(data: string) { this.written.push(data); }
  resize() {}
  kill() {}
  emit(chunk: string) { this.data?.(chunk); }
}

describe('the project terminal routes', () => {
  let repoRoot: string;
  let store: RunStore;
  let sessions: TerminalSessions;
  let ptys: FakePty[];
  let spawned: PtySpawnOptions[];
  const saved = {
    ONNI_REMOTE: process.env.ONNI_REMOTE,
    ONNI_TERMINAL: process.env.ONNI_TERMINAL,
    ONNI_DRY_RUN: process.env.ONNI_DRY_RUN,
  };

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'onni-project-terminal-'));
    mkdirSync(join(repoRoot, 'wt'), { recursive: true });
    store = RunStore.open(join(repoRoot, '.ai/onni'));
    delete process.env.ONNI_REMOTE;
    delete process.env.ONNI_TERMINAL;
    process.env.ONNI_DRY_RUN = '1';
    ptys = [];
    spawned = [];
    const binding = async (): Promise<PtyBinding> => ({
      available: true,
      module: {
        spawn: (_file: string, _args: string[], options: PtySpawnOptions) => {
          spawned.push(options);
          const pty = new FakePty();
          ptys.push(pty);
          return pty;
        },
      },
    });
    sessions = new TerminalSessions(binding, undefined, undefined, recordingProcessJobs());
  });

  afterEach(() => {
    sessions.dispose();
    store.flush();
    rmSync(repoRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const makeApp = () =>
    createApp({ repoRoot, store, manager: {} as RunManager, version: '0.0.0-test', terminalSessions: sessions });

  const post = (path: string, body: unknown) =>
    apiRequest(makeApp(), `/api/v1${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  type Session = { id: string; runId: string; cwd: string; label: string; agent?: string; topic: string };

  it('opens a plain shell in the project root and types nothing', async () => {
    const res = await post('/terminal', {});
    expect(res.status).toBe(201);
    const session = (await res.json()) as Session;
    expect(realpathSync(spawned[0]!.cwd as string)).toBe(realpathSync(repoRoot));
    expect(session.agent).toBeUndefined();
    expect(ptys[0]!.written).toEqual([]);
  });

  it('starts the agent CLI by typing its fixed command into the shell, and names the tab after it', async () => {
    const res = await post('/terminal', { agent: 'antigravity' });
    expect(res.status).toBe(201);
    const session = (await res.json()) as Session;
    // `agy`, not the runner id: the command comes from the server's table.
    expect(ptys[0]!.written).toEqual(['agy\r']);
    expect(session.agent).toBe('antigravity');
    expect(session.label).toBe('antigravity');
  });

  it('refuses an agent that is not a runner id instead of typing it', async () => {
    const res = await post('/terminal', { agent: 'rm -rf /' });
    expect(res.status).toBe(400);
    expect(ptys).toHaveLength(0);
  });

  it('runs several tabs side by side, each its own session', async () => {
    await post('/terminal', { agent: 'claude' });
    await post('/terminal', { agent: 'codex' });
    const list = await apiRequest(makeApp(), '/api/v1/terminal');
    const state = (await list.json()) as { available: boolean; sessions: Session[] };
    expect(state.available).toBe(true);
    expect(state.sessions.map((s) => s.agent)).toEqual(['claude', 'codex']);
    expect(ptys.map((p) => p.written)).toEqual([['claude\r'], ['codex\r']]);
  });

  it('serves output and input for its own session and deletes it', async () => {
    const session = (await (await post('/terminal', {})).json()) as Session;
    ptys[0]!.emit('hello');
    const out = await apiRequest(makeApp(), `/api/v1/terminal/${session.id}/output?cursor=0`);
    expect(((await out.json()) as { data: string }).data).toBe('hello');

    const input = await post(`/terminal/${session.id}/input`, { data: 'ls\r' });
    expect(((await input.json()) as { delivered: boolean }).delivered).toBe(true);
    expect(ptys[0]!.written).toContain('ls\r');

    const del = await apiRequest(makeApp(), `/api/v1/terminal/${session.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
  });

  it('never lets the project routes reach a task terminal, nor the reverse', async () => {
    const run = store.createRun({ title: 't', workflow: 'quick-task', task: 'x', steps: [] });
    store.updateRun(run.id, { worktreePath: join(repoRoot, 'wt') } as never);
    const taskRes = await post(`/runs/${run.id}/terminal`, {});
    const taskSession = (await taskRes.json()) as Session;

    const viaProject = await apiRequest(makeApp(), `/api/v1/terminal/${taskSession.id}/output`);
    expect(viaProject.status).toBe(404);

    const projectSession = (await (await post('/terminal', {})).json()) as Session;
    const viaTask = await apiRequest(makeApp(), `/api/v1/runs/${run.id}/terminal/${projectSession.id}/output`);
    expect(viaTask.status).toBe(404);

    const list = (await (await apiRequest(makeApp(), '/api/v1/terminal')).json()) as { sessions: Session[] };
    expect(list.sessions.map((s) => s.id)).toEqual([projectSession.id]);
  });

  it('does not let a task terminal use `agent` to type a command', async () => {
    const run = store.createRun({ title: 't', workflow: 'quick-task', task: 'x', steps: [] });
    store.updateRun(run.id, { worktreePath: join(repoRoot, 'wt') } as never);
    const res = await post(`/runs/${run.id}/terminal`, { agent: 'codex' });
    expect(res.status).toBe(201);
    expect(((await res.json()) as Session).agent).toBeUndefined();
    expect(ptys[0]!.written).toEqual([]);
  });

  it('answers 409 and spawns nothing where the terminal policy forbids a shell', async () => {
    process.env.ONNI_REMOTE = '1';
    const res = await post('/terminal', { agent: 'claude' });
    expect(res.status).toBe(409);
    expect(ptys).toHaveLength(0);
    const state = (await (await apiRequest(makeApp(), '/api/v1/terminal')).json()) as { available: boolean };
    expect(state.available).toBe(false);
  });
});
