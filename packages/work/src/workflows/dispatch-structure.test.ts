import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SafetySettings } from '@onni/contract';
import { dispatchDepth } from '../dispatch/engine.ts';
import { RunStore, type RunRecord } from '../runs/store.ts';
import { WorkspaceSemaphore } from '../workspace/semaphore.ts';
import { RunManager } from './run.ts';
import type { WorkflowDef } from './types.ts';

const run = promisify(execFile);
const GIT_ID = ['-c', 'user.name=test', '-c', 'user.email=test@local'];
const STEP: WorkflowDef = { name: '(planned)', source: 'built-in', steps: [{ id: 'task', name: 'Task', prompt: '{{task}}' }] };

/** Dispatch's structural brakes (docs/design/unattended-safety.md §4): depth, subtask total, retry limit. */
describe('dispatch structure', () => {
  let repoRoot: string;
  let store: RunStore;
  let manager: RunManager;
  const started: string[] = [];
  const saved: Record<string, string | undefined> = {};

  const boot = (safety: Partial<SafetySettings> = {}) => {
    manager?.dispose();
    manager = new RunManager(store, repoRoot, {
      semaphore: new WorkspaceSemaphore({
        initial: { maxParallel: 6, maxMonitoringSessions: 0, safety: { waitExpiryMinutes: 30, dispatchMaxDepth: 1, dispatchMaxSubtasks: 12, dispatchRetryLimit: 1, ...safety } },
      }),
    });
  };

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'onni-dispatch-structure-'));
    for (const key of ['ONNI_DRY_RUN', 'ONNI_DISPATCH', 'ONNI_WEBHOOKS']) saved[key] = process.env[key];
    delete process.env.ONNI_WEBHOOKS;
    process.env.ONNI_DRY_RUN = '1';
    process.env.ONNI_DISPATCH = '1';
    await run('git', ['init', '-q', '-b', 'main'], { cwd: repoRoot });
    writeFileSync(join(repoRoot, 'a.txt'), 'one\n');
    await run('git', ['add', '-A'], { cwd: repoRoot });
    await run('git', [...GIT_ID, 'commit', '-q', '-m', 'base'], { cwd: repoRoot });
    store = RunStore.open(join(repoRoot, '.ai/onni'));
    boot();
    started.length = 0;
  });

  afterEach(async () => {
    for (const id of started) manager.cancel(id);
    const deadline = Date.now() + 10_000;
    while (store.listRuns().some(({ id }) => manager.isActive(id)) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    manager.dispose();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    store.flush();
    rmSync(repoRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const waitFor = async (id: string, pred: (r: RunRecord | undefined) => boolean, ms = 20_000) => {
    const deadline = Date.now() + ms;
    while (!pred(store.getRun(id))) {
      if (Date.now() > deadline) throw new Error(`condition not met for ${id}: ${store.getRun(id)?.status}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const root = async (): Promise<RunRecord> => {
    const r = manager.startRun(STEP, { task: 'mock:monitoring root', limits: { mode: 'none' } });
    started.push(r.id);
    await waitFor(r.id, (x) => x?.activity === 'monitoring');
    return r;
  };
  const ok = (parentId: string, objective: string, extra: Record<string, unknown> = {}) => {
    const out = manager.dispatch(parentId, { objective, ...extra });
    if ('refused' in out) throw new Error(`refused: ${out.refused}`);
    started.push(out.id);
    return out;
  };
  const refused = (parentId: string, objective: string, extra: Record<string, unknown> = {}) => {
    const out = manager.dispatch(parentId, { objective, ...extra });
    if (!('refused' in out)) throw new Error('expected a refusal');
    return out.refused;
  };

  it('measures depth from the root', () => {
    const runs = [
      { id: 'r', dispatch: { rootRunId: 'r' } },
      { id: 'c', dispatch: { rootRunId: 'r', parentRunId: 'r' } },
      { id: 'g', dispatch: { rootRunId: 'r', parentRunId: 'c' } },
    ];
    expect(runs.map((x) => dispatchDepth(runs, x))).toEqual([0, 1, 2]);
  });

  it('a worker may not dispatch further at the default depth of 1', async () => {
    const r = await root();
    const child = ok(r.id, 'mock:monitoring worker');
    await waitFor(child.id, (x) => x?.activity === 'monitoring');
    expect(refused(child.id, 'mock:done grandchild')).toContain('depth is capped at 1');
  }, 40_000);

  it('depth is configurable', async () => {
    boot({ dispatchMaxDepth: 2 });
    const r = await root();
    const child = ok(r.id, 'mock:monitoring worker');
    await waitFor(child.id, (x) => x?.activity === 'monitoring');
    expect(() => ok(child.id, 'mock:done grandchild')).not.toThrow();
  }, 40_000);

  it('caps the whole tree even when the root has no intent', async () => {
    boot({ dispatchMaxSubtasks: 2 });
    const r = await root();
    ok(r.id, 'mock:done one', { title: 'one' });
    ok(r.id, 'mock:done two', { title: 'two' });
    expect(refused(r.id, 'mock:done three', { title: 'three' })).toContain('the cap is 2');
  }, 40_000);

  it("the user's maxSubtasks still wins over the default when it is set", async () => {
    const r = manager.startRun(STEP, { task: 'mock:monitoring root', limits: { mode: 'none' }, dispatchIntent: { maxSubtasks: 1 } });
    started.push(r.id);
    await waitFor(r.id, (x) => x?.activity === 'monitoring');
    ok(r.id, 'mock:done one', { title: 'one' });
    expect(refused(r.id, 'mock:done two', { title: 'two' })).toContain('the user capped it at 1');
  }, 40_000);

  it('enforces retry_limit: the same order may be tried again only that many times after it failed', async () => {
    const r = await root();
    const stopAndWait = async (id: string) => {
      manager.cancel(id);
      await waitFor(id, (x) => x?.status === 'cancelled');
    };
    // limit 1 → one retry after the first failure, none after the second.
    await stopAndWait(ok(r.id, 'mock:monitoring flaky', { title: 'flaky', retry_limit: 1 }).id);
    await stopAndWait(ok(r.id, 'mock:monitoring flaky', { title: 'flaky', retry_limit: 1 }).id);
    expect(refused(r.id, 'mock:monitoring flaky', { title: 'flaky', retry_limit: 1 })).toContain('retry limit is 1');
    // A different order is unaffected.
    expect(() => ok(r.id, 'mock:done other', { title: 'other' })).not.toThrow();
  }, 60_000);

  it('retry_limit 0 allows no retry, and an order cannot raise the workspace ceiling', async () => {
    const r = await root();
    const first = ok(r.id, 'mock:monitoring once', { title: 'once', retry_limit: 0 });
    manager.cancel(first.id);
    await waitFor(first.id, (x) => x?.status === 'cancelled');
    expect(refused(r.id, 'mock:monitoring once', { title: 'once', retry_limit: 0 })).toContain('retry limit is 0');
    const a = ok(r.id, 'mock:monitoring greedy', { title: 'greedy', retry_limit: 3 });
    manager.cancel(a.id);
    await waitFor(a.id, (x) => x?.status === 'cancelled');
    const b = ok(r.id, 'mock:monitoring greedy', { title: 'greedy', retry_limit: 3 });
    manager.cancel(b.id);
    await waitFor(b.id, (x) => x?.status === 'cancelled');
    expect(refused(r.id, 'mock:monitoring greedy', { title: 'greedy', retry_limit: 3 })).toContain('retry limit is 1');
  }, 60_000);
});
