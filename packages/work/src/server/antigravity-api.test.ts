import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunRecord } from '../runs/store.ts';
import { RunStore } from '../runs/store.ts';
import { RunManager } from '../workflows/run.ts';
import { WorkspaceSemaphore } from '../workspace/semaphore.ts';
import { apiRequest } from './loopback-request.testkit.ts';
import { connectedProviderAuth } from './provider-auth.testkit.ts';
import { createApp } from './server.ts';

/**
 * Antigravity through the HTTP API on the dry-run mock `agy` — never the real CLI: the roster
 * allowlist with antigravity, the manager capability flag, the permission setting, and what a
 * worker's denied actions do to its run record (ADR 0007).
 */
describe('antigravity through the API (dry-run)', () => {
  let repoRoot: string;
  let home: string;
  let store: RunStore;
  let manager: RunManager;
  let app: Hono;
  const saved: Record<string, string | undefined> = {};
  const started: string[] = [];

  beforeEach(() => {
    for (const key of ['ONNI_DRY_RUN', 'ONNI_DISPATCH', 'ONNI_REMOTE', 'ONNI_WEBHOOKS', 'ONNI_HOME', 'ONNI_ANTIGRAVITY_BIN']) saved[key] = process.env[key];
    delete process.env.ONNI_REMOTE;
    delete process.env.ONNI_WEBHOOKS;
    delete process.env.ONNI_ANTIGRAVITY_BIN;
    process.env.ONNI_DRY_RUN = '1';
    process.env.ONNI_DISPATCH = '1';
    home = mkdtempSync(join(tmpdir(), 'onni-agy-home-'));
    process.env.ONNI_HOME = home;
    repoRoot = mkdtempSync(join(tmpdir(), 'onni-agy-api-'));
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
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const call = (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') =>
    apiRequest(app, `/api/v1${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
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
      { runner: 'antigravity', model: 'mock-fast', role: 'cheap file edits', maxConcurrent: 2 },
      { runner: 'pi', role: 'docs' },
    ],
  };
  const startManager = async (extra: Record<string, unknown> = {}) => {
    const res = await call('/runs', { task: 'mock:monitoring manage the work', steps: [{ id: 'work', prompt: '{{task}}' }], roster, ...extra });
    expect(res.status).toBe(201);
    const run = (await res.json()) as RunRecord;
    started.push(run.id);
    await waitFor(run.id, (r) => r?.activity === 'monitoring');
    return run;
  };
  const dispatch = async (rootId: string, objective: string, extra: Record<string, unknown> = {}) => {
    const res = await call(`/runs/${rootId}/dispatch`, { objective, backend: 'antigravity', model: 'mock-fast', title: 'agy task', ...extra });
    expect(res.status).toBe(201);
    const child = (await res.json()) as { id: string };
    started.push(child.id);
    return child.id;
  };

  it('runs an allowed antigravity worker on the mock, and records the CLI version that ran', async () => {
    const root = await startManager();
    const childId = await dispatch(root.id, 'fix the typo in a.txt');
    await waitFor(childId, (r) => r?.agentVersion !== undefined);
    const child = store.getRun(childId)!;
    expect(child).toMatchObject({ runner: 'antigravity', model: 'mock-fast', agentVersion: '1.4.12-mock', autonomous: true });
    expect(child.dispatch).toMatchObject({ workerKey: 'antigravity:mock-fast' });
    // The first event of the AGENT is the CLI version, ahead of anything it said or did.
    const events = store.readEvents(childId);
    const version = events.findIndex((e) => e.kind === 'agent-version');
    expect(version).toBeGreaterThanOrEqual(0);
    expect(events[version]).toMatchObject({ value: '1.4.12-mock' });
    const firstAgent = events.findIndex((e) => e.type === 'session' || e.type === 'text' || e.type === 'tool-call');
    expect(firstAgent === -1 || version < firstAgent).toBe(true);
  }, 90_000);

  it('a worker that answered but was denied something stays done, with the denial on its record (digest)', async () => {
    const root = await startManager();
    const childId = await dispatch(root.id, 'mock:denied-answer run the tests');
    await waitFor(childId, (r) => (r?.deniedActions?.length ?? 0) > 0);
    const child = store.getRun(childId)!;
    expect(child.deniedActions).toEqual([expect.stringContaining('run_command `npm test`')]);
    expect(child.status).not.toBe('failed');
    expect(store.readEvents(childId).filter((e) => e.kind === 'denied-action')).toHaveLength(1);
  }, 90_000);

  it('a worker that was blocked and answered nothing fails, naming what was denied', async () => {
    const root = await startManager();
    const childId = await dispatch(root.id, 'mock:denied run the tests');
    await waitFor(childId, (r) => r?.status === 'failed');
    expect(store.getRun(childId)!.error).toContain('npm test');
  }, 90_000);

  it('the allowlist is enforced on the server: antigravity is refused when the roster does not list it', async () => {
    const root = await startManager({ roster: { manager: { runner: 'claude', model: 'opus' }, workers: [{ runner: 'pi', role: 'docs' }] } });
    const res = await call(`/runs/${root.id}/dispatch`, { objective: 'sneak in', backend: 'antigravity', title: 'sneak' });
    expect(res.status).toBe(409);
    const refusal = ((await res.json()) as { error: string }).error;
    expect(refusal).toContain('antigravity is not an allowed worker');
    expect(refusal).toContain('pi — docs');
    expect(store.listRuns().filter((r) => r.dispatch?.parentRunId === root.id)).toHaveLength(0);
  }, 60_000);

  it('canManage=false: antigravity cannot be the manager, refused at the door with the reason', async () => {
    const res = await call('/runs', {
      task: 't',
      steps: [{ id: 'work', prompt: '{{task}}' }],
      roster: { manager: { runner: 'antigravity' }, workers: [{ runner: 'claude' }] },
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('cannot be a manager');
  });

  describe('Settings → permission level', () => {
    const level = async () => ((await (await call('/workspace/config')).json()) as { agentPermissions: { antigravity: string } }).agentPermissions.antigravity;

    it('defaults to files-only', async () => {
      expect(await level()).toBe('files-only');
    });

    it('takes allow-rules, but refuses bypass without the explicit confirmation', async () => {
      expect((await call('/workspace/config', { agentPermissions: { antigravity: 'allow-rules' } }, 'PUT')).status).toBe(200);
      expect(await level()).toBe('allow-rules');
      const refused = await call('/workspace/config', { agentPermissions: { antigravity: 'bypass' } }, 'PUT');
      expect(refused.status).toBe(400);
      expect(await level()).toBe('allow-rules');
      expect((await call('/workspace/config', { agentPermissions: { antigravity: 'bypass', confirmBypass: false } }, 'PUT')).status).toBe(400);
      expect((await call('/workspace/config', { agentPermissions: { antigravity: 'bypass', confirmBypass: true } }, 'PUT')).status).toBe(200);
      expect(await level()).toBe('bypass');
    });

    it('a preset cannot carry a permission level: the roster schema is closed', async () => {
      const preset = { id: 'p', name: 'x', roster: { manager: { runner: 'claude' }, workers: [{ runner: 'antigravity', permissionLevel: 'bypass' }] } };
      const res = await call('/workspace/config', { managerWorker: { presets: [preset], defaultPresetId: null } }, 'PUT');
      expect(res.status).toBe(400);
    });

    it('an unattended run never inherits bypass: the worker runs on the lowered level and says so', async () => {
      expect((await call('/workspace/config', { agentPermissions: { antigravity: 'bypass', confirmBypass: true } }, 'PUT')).status).toBe(200);
      const root = await startManager();
      const childId = await dispatch(root.id, 'fix the typo in a.txt');
      await waitFor(childId, (r) => r?.agentVersion !== undefined);
      const notes = store.readEvents(childId).map((e) => String((e as { message?: unknown }).message ?? ''));
      expect(notes.some((m) => m.includes('unattended runs never skip permission checks'))).toBe(true);
    }, 90_000);
  });
});
