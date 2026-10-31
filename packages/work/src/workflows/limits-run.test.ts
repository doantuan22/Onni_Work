import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunLimitsRequest } from '@onni/contract';
import { RunStore, type RunRecord } from '../runs/store.ts';
import { WorkspaceSemaphore } from '../workspace/semaphore.ts';
import { RunManager } from './run.ts';
import type { WorkflowDef } from './types.ts';

const run = promisify(execFile);
const GIT_ID = ['-c', 'user.name=test', '-c', 'user.email=test@local'];
const STEP: WorkflowDef = { name: '(planned)', source: 'built-in', steps: [{ id: 'task', name: 'Task', prompt: '{{task}}' }] };

/** Run limits (docs/design/unattended-safety.md §2), end to end through the dry-run mock agent. */
describe('run limits', () => {
  let repoRoot: string;
  let store: RunStore;
  let manager: RunManager;
  const started: string[] = [];
  const saved: Record<string, string | undefined> = {};

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'onni-limits-'));
    for (const key of ['ONNI_DRY_RUN', 'ONNI_DISPATCH', 'ONNI_WEBHOOKS']) saved[key] = process.env[key];
    delete process.env.ONNI_WEBHOOKS;
    process.env.ONNI_DRY_RUN = '1';
    process.env.ONNI_DISPATCH = '1';
    await run('git', ['init', '-q', '-b', 'main'], { cwd: repoRoot });
    writeFileSync(join(repoRoot, 'a.txt'), 'one\n');
    await run('git', ['add', '-A'], { cwd: repoRoot });
    await run('git', [...GIT_ID, 'commit', '-q', '-m', 'base'], { cwd: repoRoot });
    store = RunStore.open(join(repoRoot, '.ai/onni'));
    manager = new RunManager(store, repoRoot, { semaphore: new WorkspaceSemaphore({ initial: { maxParallel: 2, maxMonitoringSessions: 0 } }) });
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
      if (Date.now() > deadline) throw new Error(`condition not met in time for ${id}: ${store.getRun(id)?.status}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const parkedRun = async (limits?: RunLimitsRequest): Promise<RunRecord> => {
    const record = manager.startRun(STEP, { task: 'mock:monitoring waiting', ...(limits ? { limits } : {}) });
    started.push(record.id);
    await waitFor(record.id, (r) => r?.activity === 'monitoring');
    return record;
  };
  const spend = (id: string, patch: { costUsd?: number; tokensUsed?: number; iterations?: number }) => {
    const step = store.getRun(id)!.steps[0]!;
    store.updateStep(id, step.id, {
      ...(patch.costUsd !== undefined ? { costUsd: patch.costUsd } : {}),
      ...(patch.tokensUsed !== undefined ? { tokensUsed: patch.tokensUsed } : {}),
      ...(patch.iterations !== undefined ? { iterations: patch.iterations } : {}),
    });
  };
  const stopped = (id: string) => waitFor(id, (r) => r?.status === 'cancelled');

  it('snapshots the workspace default (capped) unless the request says otherwise', async () => {
    const byDefault = manager.startRun(STEP, { task: 'mock:done a' });
    const unlimited = manager.startRun(STEP, { task: 'mock:done b', limits: { mode: 'none' } });
    const custom = manager.startRun(STEP, { task: 'mock:done c', limits: { mode: 'capped', maxCostUsd: 5 } });
    started.push(byDefault.id, unlimited.id, custom.id);
    expect(byDefault.limits).toEqual({ mode: 'capped', maxCostUsd: 10, maxTokens: 10_000_000, maxWallClockMinutes: 240, maxStepIterations: 30 });
    expect(unlimited.limits).toEqual({ mode: 'none' });
    expect(custom.limits).toEqual({ mode: 'capped', maxCostUsd: 5 });
  });

  it('ends a run that crosses its cost ceiling, keeps its worktree, and Continue needs the raise', async () => {
    const r = await parkedRun({ mode: 'capped', maxCostUsd: 1 });
    spend(r.id, { costUsd: 1.2 });
    manager.sweepLimits();
    await stopped(r.id);
    const ended = store.getRun(r.id)!;
    expect(ended.limitHit).toMatchObject({ kind: 'cost', limit: 1, scope: 'run' });
    expect(ended.error).toContain('maxCostUsd');
    expect(existsSync(ended.worktreePath!)).toBe(true);
    await waitFor(r.id, () => !manager.isActive(r.id));
    const refused = manager.continueRun(r.id, {});
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain('maxCostUsd');
    expect(manager.continueRun(r.id, { raiseLimits: true }).ok).toBe(true);
    expect(store.getRun(r.id)!.limits?.maxCostUsd).toBeCloseTo(2.2, 5);
    expect(store.getRun(r.id)!.limitHit).toBeUndefined();
  }, 40_000);

  it.each([
    ['tokens', { mode: 'capped', maxTokens: 1000 }, { tokensUsed: 2000 }],
    ['iterations', { mode: 'capped', maxStepIterations: 3 }, { iterations: 4 }],
  ] as const)('ends a run that crosses its %s ceiling', async (kind, limits, usage) => {
    const r = await parkedRun(limits);
    spend(r.id, usage);
    manager.sweepLimits();
    await stopped(r.id);
    expect(store.getRun(r.id)!.limitHit).toMatchObject({ kind });
  }, 40_000);

  it('accumulates active wall-clock durably and ends the run at its time ceiling', async () => {
    const r = await parkedRun({ mode: 'capped', maxWallClockMinutes: 1 });
    manager.sweepLimits(Date.now() + 30_000);
    expect(store.getRun(r.id)!.limitUsage?.wallMs).toBeGreaterThanOrEqual(29_000);
    expect(store.getRun(r.id)!.status).toBe('running');
    manager.sweepLimits(Date.now() + 90_000);
    await stopped(r.id);
    expect(store.getRun(r.id)!.limitHit).toMatchObject({ kind: 'time', limit: 1 });
  }, 40_000);

  it('applies no ceiling in unlimited mode', async () => {
    const r = await parkedRun({ mode: 'none' });
    spend(r.id, { costUsd: 1e6, tokensUsed: 1e12, iterations: 1e6 });
    manager.sweepLimits(Date.now() + 200 * 60_000);
    expect(store.getRun(r.id)!.status).toBe('running');
    expect(store.getRun(r.id)!.limitHit).toBeUndefined();
  }, 40_000);

  it('keeps the counters across a restart: usage lives on the record, not in memory', async () => {
    const r = await parkedRun({ mode: 'capped', maxWallClockMinutes: 100, maxCostUsd: 50 });
    spend(r.id, { costUsd: 7 });
    manager.sweepLimits(Date.now() + 60_000);
    const wall = store.getRun(r.id)!.limitUsage!.wallMs;
    store.flush();
    const reopened = RunStore.open(join(repoRoot, '.ai/onni'));
    const again = reopened.getRun(r.id)!;
    expect(again.limitUsage?.wallMs).toBe(wall);
    expect(again.costUsd).toBe(7);
    expect(again.limits).toEqual({ mode: 'capped', maxWallClockMinutes: 100, maxCostUsd: 50 });
  }, 40_000);

  it('gives a dispatched child the parent\'s mode and its share, and ends the whole tree on the shared ceiling', async () => {
    const parent = await parkedRun({ mode: 'capped', maxCostUsd: 10 });
    spend(parent.id, { costUsd: 4 });
    const created = manager.dispatch(parent.id, { objective: 'mock:monitoring child work', max_cost: 500 });
    if ('refused' in created) throw new Error(created.refused);
    started.push(created.id);
    const child = store.getRun(created.id)!;
    expect(child.limits?.mode).toBe('capped');
    expect(child.limits?.maxCostUsd).toBe(6);
    await waitFor(child.id, (r) => r?.activity === 'monitoring');
    spend(child.id, { costUsd: 6.5 });
    manager.sweepLimits();
    await stopped(parent.id);
    await stopped(child.id);
    expect(store.getRun(parent.id)!.limitHit?.kind).toBe('cost');
    expect(store.getRun(child.id)!.limitHit?.kind).toBe('cost');
  }, 60_000);

  it('a child of an unlimited parent is unlimited', async () => {
    const parent = await parkedRun({ mode: 'none' });
    const created = manager.dispatch(parent.id, { objective: 'mock:done child' });
    if ('refused' in created) throw new Error(created.refused);
    started.push(created.id);
    expect(store.getRun(created.id)!.limits).toEqual({ mode: 'none' });
  }, 40_000);
});
