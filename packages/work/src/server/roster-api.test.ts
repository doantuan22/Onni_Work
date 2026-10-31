import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PROVIDER_IDS, ProviderAuthService, type ProviderStatusResponse } from '../core/provider-auth.ts';
import { RunStore } from '../runs/store.ts';
import type { RunManager, StartRunInput } from '../workflows/run.ts';
import type { WorkflowDef } from '../workflows/types.ts';
import { connectedProviderAuth } from './provider-auth.testkit.ts';
import { createApp } from './server.ts';

/** `POST /runs` with a manager–worker roster (docs/design/manager-worker.md). */
describe('POST /runs with a roster', () => {
  let repoRoot: string;
  let store: RunStore;
  let started: StartRunInput[];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ['ONNI_DRY_RUN', 'ONNI_DISPATCH', 'ONNI_REMOTE']) saved[key] = process.env[key];
    delete process.env.ONNI_REMOTE;
    process.env.ONNI_DRY_RUN = '1';
    delete process.env.ONNI_DISPATCH;
    repoRoot = mkdtempSync(join(tmpdir(), 'onni-roster-api-'));
    started = [];
  });
  afterEach(() => {
    store?.flush();
    rmSync(repoRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const gitInit = () => {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repoRoot });
    writeFileSync(join(repoRoot, 'a.txt'), 'x\n');
    execFileSync('git', ['add', '-A'], { cwd: repoRoot });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@l', 'commit', '-qm', 'base'], { cwd: repoRoot });
  };
  const build = (providerAuth: ProviderAuthService = connectedProviderAuth()): Hono => {
    store = RunStore.open(join(repoRoot, '.ai/onni'));
    const manager = {
      startRun: (_workflow: WorkflowDef, input: StartRunInput) => {
        started.push(input);
        return store.createRun({ title: 't', workflow: '(planned)', task: input.task, steps: [] });
      },
    } as unknown as RunManager;
    return createApp({ repoRoot, store, manager, version: '0.0.0-test', providerAuth });
  };
  const roster = {
    manager: { runner: 'claude', model: 'opus' },
    workers: [{ runner: 'codex', model: 'gpt-5', role: 'tests' }, { runner: 'opencode', role: 'docs' }],
  };
  const post = (app: Hono, body: Record<string, unknown>) =>
    app.request('/api/v1/runs', {
      method: 'POST',
      headers: { host: '127.0.0.1:4321', 'content-type': 'application/json' },
      body: JSON.stringify({ task: 'ship it', steps: [{ id: 'work', prompt: '{{task}}' }], ...body }),
    });

  it('hands the roster to the engine when every chosen backend is connected', async () => {
    gitInit();
    const res = await post(build(), { roster });
    expect(res.status).toBe(201);
    expect(started[0]?.roster?.workers.map((w) => w.runner)).toEqual(['codex', 'opencode']);
    expect(started[0]?.roster?.workers[0]).toMatchObject({ model: 'gpt-5', maxConcurrent: 1 });
  });

  it('refuses a roster naming a backend that is not connected, with the reason', async () => {
    gitInit();
    class OneMissing extends ProviderAuthService {
      override status(): Promise<ProviderStatusResponse> {
        return Promise.resolve({ providers: PROVIDER_IDS.map((provider) => ({ provider, status: provider === 'codex' ? 'disconnected' : 'connected' })) });
      }
    }
    const res = await post(build(new OneMissing()), { roster });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error.toLowerCase()).toContain('codex');
    expect(started).toHaveLength(0);
  });

  it('refuses without dispatch, with variants, outside a git repository, and on an invalid roster', async () => {
    gitInit();
    const app = build();
    expect((await post(app, { roster, variants: 2 })).status).toBe(400);
    expect((await post(app, { roster: { ...roster, workers: [] } })).status).toBe(400);
    expect((await post(app, { roster: { manager: roster.manager, workers: [{ runner: 'claude', model: 'opus' }] } })).status).toBe(400);
    process.env.ONNI_DISPATCH = '0';
    const off = await post(app, { roster });
    expect(off.status).toBe(409);
    expect(((await off.json()) as { error: string }).error).toContain('dispatch');
    expect(started).toHaveLength(0);
  });

  it('needs a git repository', async () => {
    const res = await post(build(), { roster });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('git repository');
  });
});
