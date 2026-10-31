import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunRecord } from '../runs/store.ts';
import { RunStore } from '../runs/store.ts';
import { WorkspaceSemaphore } from '../workspace/semaphore.ts';
import { RunManager } from '../workflows/run.ts';
import { connectedProviderAuth } from './provider-auth.testkit.ts';
import { createApp } from './server.ts';

/**
 * Manager–worker end to end THROUGH THE HTTP API, on the dry-run mock agent: start a manager with a
 * two-entry roster, let it dispatch one allowed task and one outside the roster, then read the tree,
 * the shared ceiling and the facts the morning digest is built from.
 */
describe('manager–worker through the API (dry-run)', () => {
  let repoRoot: string;
  let store: RunStore;
  let manager: RunManager;
  let app: Hono;
  const saved: Record<string, string | undefined> = {};
  const started: string[] = [];

  beforeEach(() => {
    for (const key of ['ONNI_DRY_RUN', 'ONNI_DISPATCH', 'ONNI_REMOTE', 'ONNI_WEBHOOKS']) saved[key] = process.env[key];
    delete process.env.ONNI_REMOTE;
    delete process.env.ONNI_WEBHOOKS;
    process.env.ONNI_DRY_RUN = '1';
    process.env.ONNI_DISPATCH = '1';
    repoRoot = mkdtempSync(join(tmpdir(), 'onni-mw-api-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repoRoot });
    git('init', '-q', '-b', 'main');
    writeFileSync(join(repoRoot, 'a.txt'), 'x\n');
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@l', 'commit', '-qm', 'base');
    store = RunStore.open(join(repoRoot, '.ai/onni'));
    manager = new RunManager(store, repoRoot, { semaphore: new WorkspaceSemaphore({ initial: { maxParallel: 3, maxMonitoringSessions: 0 } }) });
    app = createApp({ repoRoot, store, manager, version: '0.0.0-test', providerAuth: connectedProviderAuth() });
  });
  afterEach(async () => {
    for (const id of started) manager.cancel(id);
    const deadline = Date.now() + 10_000;
    while (store.listRuns().some(({ id }) => manager.isActive(id)) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    manager.dispose();
    store.flush();
    rmSync(repoRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const call = (path: string, body?: unknown) =>
    app.request(`/api/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { host: '127.0.0.1:4321', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const waitFor = async (id: string, pred: (r: RunRecord | undefined) => boolean, ms = 30_000) => {
    const deadline = Date.now() + ms;
    while (!pred(store.getRun(id))) {
      if (Date.now() > deadline) throw new Error(`condition not met for ${id}: ${store.getRun(id)?.status}`);
      await new Promise((r) => setTimeout(r, 40));
    }
  };
  const roster = {
    manager: { runner: 'claude', model: 'opus' },
    workers: [
      { runner: 'claude', model: 'haiku', role: 'quick edits', maxConcurrent: 2 },
      { runner: 'pi', role: 'docs', maxConcurrent: 1 },
    ],
  };
  const startManager = async (task: string, extra: Record<string, unknown> = {}) => {
    const res = await call('/runs', { task, steps: [{ id: 'work', prompt: '{{task}}' }], roster, ...extra });
    expect(res.status).toBe(201);
    const run = (await res.json()) as RunRecord;
    started.push(run.id);
    return run;
  };

  it('allows a listed worker, refuses one outside the roster with a 409 listing the allowed ones, and builds the tree under a shared ceiling', async () => {
    const root = await startManager('mock:monitoring manage the work', { limits: { mode: 'capped', maxCostUsd: 5 } });
    await waitFor(root.id, (r) => r?.activity === 'monitoring');

    const good = await call(`/runs/${root.id}/dispatch`, { objective: 'mock:monitoring fix the typo', backend: 'claude', model: 'haiku', title: 'typo' });
    expect(good.status).toBe(201);
    const child = (await good.json()) as { id: string; branch?: string };
    started.push(child.id);

    const bad = await call(`/runs/${root.id}/dispatch`, { objective: 'mock:done sneak in', backend: 'cursor', title: 'sneak' });
    expect(bad.status).toBe(409);
    const refusal = ((await bad.json()) as { error: string }).error;
    expect(refusal).toContain('cursor is not an allowed worker');
    expect(refusal).toContain('claude (haiku) — quick edits');
    expect(refusal).toContain('pi — docs');

    // The tree as the API reports it.
    const list = (await (await call('/runs')).json()) as RunRecord[];
    const rootRow = list.find((r) => r.id === root.id)!;
    const childRow = list.find((r) => r.id === child.id)!;
    expect(rootRow.roster?.workers.map((w) => w.runner)).toEqual(['claude', 'pi']);
    expect(rootRow.dispatch).toMatchObject({ rootRunId: root.id });
    expect(childRow).toMatchObject({ runner: 'claude', model: 'haiku', autonomous: true, dispatch: { rootRunId: root.id, parentRunId: root.id, workerKey: 'claude:haiku' } });
    expect(list.filter((r) => r.dispatch?.parentRunId === root.id)).toHaveLength(1); // the refused one created nothing

    // One ceiling for the tree: the worker holds a share of the root's, and together they stop at it.
    expect(childRow.limits?.mode).toBe('capped');
    expect(childRow.limits?.maxCostUsd).toBeLessThanOrEqual(5);
    await waitFor(child.id, (r) => r?.activity === 'monitoring');
    store.updateStep(child.id, store.getRun(child.id)!.steps[0]!.id, { costUsd: 6 });
    manager.sweepLimits();
    await waitFor(root.id, (r) => r?.status === 'cancelled');
    await waitFor(child.id, (r) => r?.status === 'cancelled');
    const ended = (await (await call(`/runs/${child.id}`)).json()) as RunRecord;
    expect(ended.limitHit?.kind).toBe('cost');
    expect(((await (await call(`/runs/${root.id}`)).json()) as RunRecord).error).toContain('maxCostUsd');
  }, 90_000);

  it('a manager that finishes without delegating is flagged on the record the morning digest reads', async () => {
    const solo = await startManager('mock:done I will do it myself', { autonomous: true, limits: { mode: 'none' } });
    await waitFor(solo.id, (r) => r?.status === 'done' || r?.status === 'review', 40_000);
    const record = (await (await call(`/runs/${solo.id}`)).json()) as RunRecord;
    expect(record.managerDidNotDelegate).toBe(true);
    expect(record.finishedAt).toBeTruthy();
    expect(record.roster?.manager.runner).toBe('claude');
    const notes = store.readEvents(solo.id).filter((e) => String((e as { message?: unknown }).message ?? '').includes('manager did not delegate'));
    expect(notes).toHaveLength(1);
  }, 60_000);

  it('refuses at the door a roster whose manager and worker are the same agent', async () => {
    const res = await call('/runs', { task: 't', steps: [{ id: 'work', prompt: '{{task}}' }], roster: { manager: { runner: 'claude', model: 'opus' }, workers: [{ runner: 'claude', model: 'opus' }] } });
    expect(res.status).toBe(400);
  });
});
