import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RunStore, type RunRecord } from '../runs/store.ts';
import { WorkspaceSemaphore } from '../workspace/semaphore.ts';
import { RunManager } from './run.ts';
import type { WorkflowDef } from './types.ts';

const run = promisify(execFile);
const GIT_ID = ['-c', 'user.name=test', '-c', 'user.email=test@local'];
const STEP: WorkflowDef = { name: '(planned)', source: 'built-in', steps: [{ id: 'task', name: 'Task', prompt: '{{task}}' }] };

/** Unattended wait expiry (docs/design/unattended-safety.md §3), driven through the dry-run mock agent. */
describe('unattended wait expiry', () => {
  let repoRoot: string;
  let store: RunStore;
  let manager: RunManager;
  const started: string[] = [];
  const saved: Record<string, string | undefined> = {};

  const boot = (waitExpiryMinutes: number): RunManager =>
    new RunManager(store, repoRoot, {
      // 0.03 min ≈ 1.8 s: the schema's floor is one minute, the semaphore takes any number.
      semaphore: new WorkspaceSemaphore({ initial: { maxParallel: 1, maxMonitoringSessions: 0, idleTimeoutMinutes: 0, safety: { waitExpiryMinutes, dispatchMaxDepth: 1, dispatchMaxSubtasks: 12, dispatchRetryLimit: 1 } } }),
    });

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'onni-wait-expiry-'));
    for (const key of ['ONNI_DRY_RUN', 'ONNI_WEBHOOKS']) saved[key] = process.env[key];
    delete process.env.ONNI_WEBHOOKS;
    process.env.ONNI_DRY_RUN = '1';
    await run('git', ['init', '-q', '-b', 'main'], { cwd: repoRoot });
    writeFileSync(join(repoRoot, 'a.txt'), 'one\n');
    await run('git', ['add', '-A'], { cwd: repoRoot });
    await run('git', [...GIT_ID, 'commit', '-q', '-m', 'base'], { cwd: repoRoot });
    store = RunStore.open(join(repoRoot, '.ai/onni'));
    manager = boot(0.03);
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
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  const busy = () => (manager as unknown as { busySlots(): number }).busySlots();

  it('ends an unanswered ASK of an autonomous run as failed, frees the slot while it waits, keeps worktree and session', async () => {
    const r = manager.startRun(STEP, { task: 'mock:ask which one?', autonomous: true, limits: { mode: 'none' } });
    started.push(r.id);
    await waitFor(r.id, (x) => x?.status === 'waiting');
    // A waiting run holds no semaphore slot while nobody answers.
    expect(busy()).toBe(0);
    await waitFor(r.id, (x) => x?.status === 'failed');
    const ended = store.getRun(r.id)!;
    expect(ended.waitExpiredAt).toBeTruthy();
    expect(ended.error).toContain('nobody answered in time');
    expect(existsSync(ended.worktreePath!)).toBe(true);
    await waitFor(r.id, () => !manager.isActive(r.id));
    expect(manager.continueRun(r.id, { text: 'use option A' }).ok).toBe(true);
  }, 40_000);

  it('an attended run with the idle timeout disabled keeps waiting', async () => {
    const r = manager.startRun(STEP, { task: 'mock:ask which one?', limits: { mode: 'none' } });
    started.push(r.id);
    await waitFor(r.id, (x) => x?.status === 'waiting');
    await new Promise((resolve) => setTimeout(resolve, 3500));
    expect(store.getRun(r.id)!.status).toBe('waiting');
    expect(store.getRun(r.id)!.waitExpiredAt).toBeUndefined();
  }, 40_000);

  it('a run resting at review holds no slot and never expires', async () => {
    const r = store.createRun({ title: 't', task: 'Task', workflow: 'quick-task', steps: [{ id: 'task', name: 'Task', kind: 'agent' }] });
    store.updateRun(r.id, { status: 'review', autonomous: true });
    expect(busy()).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(store.getRun(r.id)!.status).toBe('review');
  }, 20_000);
});
