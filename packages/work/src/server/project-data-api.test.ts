import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClearProjectDataResult } from '@onni/contract';
import { RunStore } from '../runs/store.ts';
import type { RunManager } from '../workflows/run.ts';
import { apiRequest } from './loopback-request.testkit.ts';
import { createApp } from './server.ts';

/**
 * `POST /api/v1/project-data/clear` — wipe one project's tasks and chats, through the real app.
 * What is pinned: nothing happens without the project's name, a running task is never touched,
 * a worker of a live tree is never touched, and a deleted task takes its chat file with it.
 */
describe('POST /api/v1/project-data/clear', () => {
  let repoRoot: string;
  let store: RunStore;
  let app: Hono;
  const active = new Set<string>();

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'onni-clear-'));
    store = RunStore.open(join(repoRoot, '.ai/onni'));
    active.clear();
    app = createApp({
      repoRoot,
      store,
      manager: {
        isActive: (id: string) => active.has(id),
        sweepPrHeadRefs: async () => {},
        forgetSoftAsk: () => {},
      } as unknown as RunManager,
      version: '0.0.0-test',
    });
  });

  afterEach(() => {
    store.flush();
    rmSync(repoRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const clear = (confirm: string) =>
    apiRequest(app, '/api/v1/project-data/clear', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm }) });
  const make = (title: string, status: 'done' | 'failed' | 'running' | 'cancelled') => {
    const run = store.createRun({ title, workflow: 'quick-task', task: title, steps: [] });
    store.updateRun(run.id, { status });
    store.appendEvent(run.id, { type: 'note', message: `chat line of ${title}` });
    return run;
  };
  const eventsFile = (id: string) => join(repoRoot, '.ai/onni/runs', `${id}.ndjson`);

  it('does nothing without the project name, and with a wrong one', async () => {
    make('a', 'done');
    expect((await clear('nope')).status).toBe(400);
    expect(store.listRuns()).toHaveLength(1);
  });

  it('deletes every finished task with its chat, and keeps a running one', async () => {
    const done = make('finished', 'done');
    const failed = make('broken', 'failed');
    const cancelled = make('stopped', 'cancelled');
    const running = make('working', 'running');
    active.add(running.id);
    expect(store.readEvents(done.id).length).toBeGreaterThan(0);
    expect(existsSync(eventsFile(done.id))).toBe(true);

    const res = await clear(basename(repoRoot));
    expect(res.status).toBe(200);
    const body = (await res.json()) as ClearProjectDataResult;
    expect(body.deleted).toBe(3);
    expect(body.skipped).toEqual([{ id: running.id, title: 'working', reason: 'still running — stop it first' }]);
    expect(store.listRuns().map((r) => r.id)).toEqual([running.id]);
    for (const gone of [done, failed, cancelled]) {
      expect(store.getRun(gone.id)).toBeUndefined();
      expect(store.readEvents(gone.id)).toEqual([]);
      expect(existsSync(eventsFile(gone.id))).toBe(false);
    }
    // The running task keeps its chat.
    expect(store.readEvents(running.id).length).toBeGreaterThan(0);
  });

  it('accepts the project name in any case', async () => {
    make('a', 'done');
    expect((await clear(basename(repoRoot).toUpperCase())).status).toBe(200);
    expect(store.listRuns()).toHaveLength(0);
  });

  it('never deletes a worker of a tree that is still running, and deletes a finished tree whole', async () => {
    const root = make('manager', 'running');
    active.add(root.id);
    store.updateRun(root.id, { dispatch: { rootRunId: root.id } });
    const worker = make('worker', 'done');
    store.updateRun(worker.id, { dispatch: { rootRunId: root.id, parentRunId: root.id } });

    const first = (await (await clear(basename(repoRoot))).json()) as ClearProjectDataResult;
    expect(first.deleted).toBe(0);
    expect(first.skipped.map((s) => s.title).sort()).toEqual(['manager', 'worker']);

    active.delete(root.id);
    store.updateRun(root.id, { status: 'done' });
    const second = (await (await clear(basename(repoRoot))).json()) as ClearProjectDataResult;
    expect(second).toEqual({ deleted: 2, skipped: [] });
    expect(store.listRuns()).toHaveLength(0);
  });

  it('is a no-op on an empty project', async () => {
    expect(await (await clear(basename(repoRoot))).json()).toEqual({ deleted: 0, skipped: [] });
  });
});
