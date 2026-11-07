import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Runner } from '@onni/contract';
import { RunStore, type RunRecord } from '../runs/store.ts';
import { childSettleReport } from '../dispatch/engine.ts';
import type { WorkflowDef } from './types.ts';
import { RunManager, type StartRunInput } from './run.ts';

let root: string;
let store: RunStore;
let manager: RunManager;
let managerRunId: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'manager-controls-')));
  store = RunStore.open(join(root, 'state'));
  manager = new RunManager(store, root, { env: () => ({}) });
  const rootRun = store.createRun({ title: 'manager', task: 'manage workers', workflow: 'quick-task', runner: 'claude', steps: [] });
  managerRunId = rootRun.id;
  store.updateRun(rootRun.id, {
    dispatch: { rootRunId: rootRun.id },
    roster: { manager: { runner: 'claude' }, workers: [{ runner: 'codex', role: 'worker', maxConcurrent: 1 }] },
  });
});

afterEach(() => {
  manager.dispose();
  store.flush();
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function queuedWorker(runner: Runner = 'codex', extraDispatch: Record<string, unknown> = {}) {
  const run = store.createRun({ title: `worker ${runner}`, task: 'do work', workflow: 'quick-task', runner, steps: [] });
  store.updateRun(run.id, {
    dispatch: { rootRunId: managerRunId, parentRunId: managerRunId, ...extraDispatch } as NonNullable<RunRecord['dispatch']>,
  });
  const seam = manager as unknown as {
    queue: string[];
    pendingJobs: Map<string, { workflow: WorkflowDef; input: StartRunInput }>;
  };
  seam.queue.push(run.id);
  seam.pendingJobs.set(run.id, {
    workflow: { name: 'quick-task', source: 'built-in', steps: [] },
    input: {} as StartRunInput,
  });
  return run;
}

describe('manager message and cancellation controls', () => {
  it('persists only delivery metadata while queueing a manager message', () => {
    const worker = queuedWorker('codex');
    const result = manager.messageFor(managerRunId, { target: worker.id, text: 'please finish the parser' });

    expect(result).toMatchObject({ state: 'queued', capability: 'steer', targetId: worker.id });
    const saved = store.getRun(worker.id)!;
    expect(saved.queuedMessages?.[0]).toMatchObject({ text: 'please finish the parser' });
    expect(saved.dispatch?.managerDeliveries).toHaveLength(1);
    expect(saved.dispatch?.managerDeliveries?.[0]).not.toHaveProperty('text');
  });

  it.each([
    ['claude', 'steer'], ['codex', 'steer'], ['opencode', 'steer'], ['pi', 'steer'],
    ['junie', 'ordered-queue'], ['cline', 'ordered-queue'], ['copilot', 'ordered-queue'],
    ['cursor', 'unsupported'], ['antigravity', 'unsupported'],
  ] as const)('maps %s to %s capability', (backend, capability) => {
    const worker = queuedWorker(backend);
    const result = manager.messageFor(managerRunId, { target: worker.id, text: 'continue' });
    expect(result).toMatchObject({ capability, state: capability === 'unsupported' ? 'rejected' : 'queued' });
    if (capability === 'unsupported') expect(result).toMatchObject({ reasonCode: 'backend-unsupported' });
  });

  it('refuses a manager message while a Guard ask is open, but allows manager cancellation', async () => {
    const worker = queuedWorker('codex', {
      pendingAsk: { questions: ['May I edit the release file?'], askedAt: new Date().toISOString() },
    });
    store.updateRun(worker.id, { status: 'waiting', askParked: true });

    expect(manager.messageFor(managerRunId, { target: worker.id, text: 'go ahead' })).toMatchObject({ status: 409 });
    expect(store.readEvents(worker.id).some((event) => event.type === 'user-message')).toBe(false);
    const cancelled = manager.cancelFor(managerRunId, { target: worker.id, reason: 'scope withdrawn' });
    expect(cancelled).toMatchObject({ status: 'cancelled', reportStatus: 'blocked', reason: 'scope withdrawn' });
    expect(store.getRun(worker.id)?.dispatch?.managerCancellation?.reason).toBe('scope withdrawn');
    await vi.waitFor(() => expect(store.getRun(managerRunId)?.dispatch?.pendingReports?.[0]?.report).toMatchObject({ status: 'blocked' }));
    expect(store.getRun(managerRunId)?.dispatch?.pendingReports?.[0]?.report.result).toContain('cancelled by manager: scope withdrawn');
  });

  it('turns manager cancellation into a blocked report with salvage details, even over a worker success', () => {
    const worker = queuedWorker('codex');
    store.updateRun(worker.id, {
      status: 'cancelled',
      branch: 'onni/worker1',
      baseBranch: 'main',
      diffStat: { files: 2, adds: 9, dels: 1 },
      dispatch: {
        ...store.getRun(worker.id)!.dispatch!,
        managerCancellation: { byRunId: managerRunId, requestedAt: new Date().toISOString(), reason: 'deadline moved' },
        report: { status: 'done', result: 'finished', evidence: ['parser added'], side_effects: [], errors: [], checks: [], suggestions: [] },
      },
    });
    const settle = childSettleReport(store.getRun(worker.id)!, {
      headCommit: 'abc1234', changedFiles: ['src/parser.ts'], filesState: 'ok',
    });
    expect(settle.report.status).toBe('blocked');
    expect(settle.text).toContain('branch onni/worker1');
    expect(settle.text).toContain('base main');
    expect(settle.text).toContain('HEAD abc1234');
    expect(settle.text).toContain('src/parser.ts');
    expect(settle.text).toContain('2 files, +9 -1');
    expect(settle.text).toContain('partial/unverified');
    expect(settle.text).toContain('uncommitted edits may remain');
    expect(settle.report.evidence).toContain('parser added');
  });
});
