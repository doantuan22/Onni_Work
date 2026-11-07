import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DispatchOrderSnapshot, Runner } from '@onni/contract';
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

function queuedWorker(runner: Runner = 'codex', extraDispatch: Record<string, unknown> = {}, title = `worker ${runner}`) {
  const run = store.createRun({ title, task: 'do work', workflow: 'quick-task', runner, steps: [] });
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

  it('does not redirect while a cancelled source session is still active', async () => {
    const order: DispatchOrderSnapshot = {
      objective: 'Implement the parser',
      title: 'parser worker',
      kind: 'implement',
      retryLimit: 1,
      backend: 'codex',
      after: [],
    };
    const source = queuedWorker('codex', { order }, 'parser worker');
    const dependent = queuedWorker('codex', { after: [source.id] }, 'dependent');
    const seam = manager as unknown as {
      queue: string[];
      pendingJobs: Map<string, unknown>;
      active: Map<string, unknown>;
      waitInactive: (runId: string, timeoutMs: number) => Promise<boolean>;
    };
    seam.queue = seam.queue.filter((id) => id !== source.id);
    seam.pendingJobs.delete(source.id);
    store.updateRun(source.id, { status: 'running' });
    const session = {
      result: new Promise(() => {}),
      open: true,
      sendMessage: vi.fn(() => true),
      end: vi.fn(),
      interrupt: vi.fn(),
    };
    seam.active.set(source.id, {
      ownerToken: Symbol('source'),
      cancelled: false,
      interrupt: vi.fn(),
      cwd: root,
      session,
      sessionEverOpened: true,
      autosaveExcludedPaths: new Map(),
      checkInProgress: false,
      autosaveCheckpointBlocked: false,
    });
    vi.spyOn(seam, 'waitInactive').mockResolvedValue(false);
    vi.spyOn(manager as unknown as { pump: () => Promise<void> }, 'pump').mockResolvedValue();

    const originalDispatch = manager.dispatch.bind(manager);
    const dispatch = vi.spyOn(manager, 'dispatch').mockImplementation((parentId, input, options) => {
      if (options?.preflightOnly) return originalDispatch(parentId, input, options);
      const replacement = store.createRun({ title: input.title!, task: input.objective, workflow: '(planned)', runner: 'codex', steps: [] });
      store.updateRun(replacement.id, {
        dispatch: { rootRunId: managerRunId, parentRunId: managerRunId, redirectedFrom: source.id, order },
      });
      return { id: replacement.id };
    });

    const result = await manager.redirectFor(managerRunId, { target: source.id, instruction: 'Use a safer parser' });
    expect(result).toEqual({ denied: 'source did not stop within 10 s', status: 409 });
    expect(store.getRun(source.id)?.status).toBe('cancelled');
    expect(store.getRun(source.id)?.dispatch?.redirectOperation).toMatchObject({ state: 'failed', refusal: 'source did not stop within 10 s' });
    expect(store.getRun(dependent.id)?.status).toBe('cancelled');
    expect(dispatch.mock.calls.filter(([, , options]) => !options?.preflightOnly)).toHaveLength(0);
    expect(seam.active.has(source.id)).toBe(true);
    await vi.waitFor(() => expect(store.getRun(managerRunId)?.dispatch?.pendingReports?.some((entry) => entry.fromRunId === dependent.id)).toBe(true));
  });

  it('redirects a saved order and repoints every queued dependent without losing other edges', async () => {
    const predecessorA = queuedWorker('codex', {}, 'predecessor A');
    const predecessorB = queuedWorker('codex', {}, 'predecessor B');
    for (const [run, branch] of [[predecessorA, 'onni/pred-a'], [predecessorB, 'onni/pred-b']] as const) {
      store.updateRun(run.id, { status: 'done', branch });
    }
    const afterIds = [predecessorA.id, predecessorB.id];
    const canonicalOrder: DispatchOrderSnapshot = {
      objective: 'Implement the parser',
      title: 'parser worker',
      kind: 'implement',
      scope: 'src/parser.ts',
      allowedTools: ['Read', 'Edit'],
      maxCost: 4,
      successCriteria: 'parser handles unicode',
      requiredEvidence: 'npm test output',
      retryLimit: 2,
      backend: 'codex',
      model: 'gpt-test',
      after: afterIds,
    };
    const source = queuedWorker('codex', { order: canonicalOrder, after: afterIds }, 'parser worker');
    const dependentA = queuedWorker('codex', {
      after: [predecessorA.id, source.id],
      order: { ...canonicalOrder, title: 'dependent A', objective: 'Use the parser', after: [predecessorA.id, source.id] },
    }, 'dependent A');
    const dependentB = queuedWorker('codex', {
      after: [source.id, predecessorB.id],
      order: { ...canonicalOrder, title: 'dependent B', objective: 'Audit parser integration', after: [source.id, predecessorB.id] },
    }, 'dependent B');
    vi.spyOn(manager as unknown as { pump: () => Promise<void> }, 'pump').mockResolvedValue();
    const originalDispatch = manager.dispatch.bind(manager);
    const dispatch = vi.spyOn(manager, 'dispatch');
    let replacementId = '';
    dispatch.mockImplementation((parentId, input, options) => {
      if (options?.preflightOnly) return originalDispatch(parentId, input, options);
      expect(store.getRun(source.id)?.status).toBe('cancelled');
      expect(input.objective).toBe('Implement the parser\n\nManager redirect instruction:\nFocus on streaming input');
      expect(options?.redirectOrigin?.sourceRunId).toBe(source.id);
      const replacement = store.createRun({ title: input.title!, task: input.objective, workflow: '(planned)', runner: 'codex', steps: [] });
      replacementId = replacement.id;
      store.updateRun(replacement.id, {
        branch: 'onni/replacement',
        dispatch: {
          rootRunId: managerRunId,
          parentRunId: managerRunId,
          redirectedFrom: source.id,
          order: {
            ...canonicalOrder,
            redirectInstruction: 'Focus on streaming input',
          },
        },
      });
      return { id: replacement.id, branch: 'onni/replacement' };
    });

    const result = await manager.redirectFor(managerRunId, { target: source.id, instruction: 'Focus on streaming input' });
    await vi.waitFor(() => expect(store.getRun(managerRunId)?.dispatch?.pendingReports?.some((entry) => entry.fromRunId === source.id)).toBe(true));

    expect(result).toEqual({
      cancelledRunId: source.id,
      replacement: { id: replacementId, branch: 'onni/replacement' },
      repointedDependents: 2,
      retryAccounting: 'excluded',
    });
    expect(store.getRun(source.id)?.dispatch?.redirectOperation).toMatchObject({
      managerRunId,
      state: 'complete',
      replacementRunId: replacementId,
    });
    expect(store.getRun(source.id)?.dispatch?.redirectOperation).not.toHaveProperty('instruction');
    expect(store.getRun(replacementId)?.dispatch?.order).toMatchObject({
      objective: canonicalOrder.objective,
      redirectInstruction: 'Focus on streaming input',
      title: canonicalOrder.title,
      scope: canonicalOrder.scope,
      allowedTools: canonicalOrder.allowedTools,
      maxCost: canonicalOrder.maxCost,
      successCriteria: canonicalOrder.successCriteria,
      requiredEvidence: canonicalOrder.requiredEvidence,
      retryLimit: canonicalOrder.retryLimit,
      backend: canonicalOrder.backend,
      model: canonicalOrder.model,
      after: afterIds,
    });
    expect(store.getRun(dependentA.id)?.dispatch?.after).toEqual([replacementId, predecessorA.id]);
    expect(store.getRun(dependentB.id)?.dispatch?.after).toEqual([replacementId, predecessorB.id]);
    expect(store.getRun(dependentA.id)?.task).toContain(`parser worker (${replacementId.slice(0, 8)}, branch onni/replacement)`);
    expect(store.getRun(dependentB.id)?.task).toContain(`parser worker (${replacementId.slice(0, 8)}, branch onni/replacement)`);
    expect(store.getRun(dependentA.id)?.baseBranch).toBe('onni/replacement');
    expect(store.getRun(dependentB.id)?.baseBranch).toBe('onni/replacement');
    expect(dispatch).toHaveBeenCalled();
  });

  it('keeps source retry accounting neutral and blocks dependents when replacement admission fails', async () => {
    const canonicalOrder: DispatchOrderSnapshot = {
      objective: 'Implement the parser',
      title: 'parser worker',
      kind: 'implement',
      retryLimit: 0,
      backend: 'codex',
      after: [],
    };
    const source = queuedWorker('codex', { order: canonicalOrder }, 'parser worker');
    const dependent = queuedWorker('codex', { after: [source.id] }, 'dependent');
    vi.spyOn(manager as unknown as { pump: () => Promise<void> }, 'pump').mockResolvedValue();
    const originalDispatch = manager.dispatch.bind(manager);
    const dispatch = vi.spyOn(manager, 'dispatch');
    dispatch.mockImplementation((parentId, input, options) => {
      if (options?.preflightOnly) return originalDispatch(parentId, input, options);
      expect(store.getRun(source.id)?.status).toBe('cancelled');
      return { refused: 'no remaining budget' };
    });

    const result = await manager.redirectFor(managerRunId, { target: source.id, instruction: 'Use a smaller parser' });
    await vi.waitFor(() => expect(store.getRun(managerRunId)?.dispatch?.pendingReports?.filter((entry) => [source.id, dependent.id].includes(entry.fromRunId)).length).toBe(2));

    expect(result).toMatchObject({
      error: 'cancelled, replacement refused: no remaining budget',
      cancelledRunId: source.id,
      retryAccounting: 'excluded',
    });
    expect(store.getRun(source.id)?.dispatch?.redirectOperation).toMatchObject({
      state: 'failed',
      refusal: 'no remaining budget',
    });
    expect(store.getRun(source.id)?.dispatch?.redirectOperation).not.toHaveProperty('instruction');
    expect(store.getRun(dependent.id)?.status).toBe('cancelled');
  });

  it('recovers a redirect persisted mid-cancel after a manager restart', async () => {
    const order: DispatchOrderSnapshot = {
      objective: 'Implement the parser',
      title: 'parser worker',
      kind: 'implement',
      retryLimit: 1,
      backend: 'codex',
      after: [],
    };
    const source = queuedWorker('codex', {
      order,
      redirectOperation: {
        operationId: 'redirect-op',
        managerRunId,
        state: 'dispatching',
        instruction: 'Use a smaller parser',
        requestedAt: new Date().toISOString(),
      },
      managerCancellation: { byRunId: managerRunId, requestedAt: new Date().toISOString(), reason: 'redirected by manager' },
    }, 'parser worker');
    manager.dispose();
    manager = new RunManager(store, root, { env: () => ({}) });
    vi.spyOn(manager as unknown as { pump: () => Promise<void> }, 'pump').mockResolvedValue();
    const dispatch = vi.spyOn(manager, 'dispatch').mockImplementation((_parentId, input, options) => {
      expect(options?.redirectOrigin?.sourceRunId).toBe(source.id);
      const replacement = store.createRun({ title: input.title!, task: input.objective, workflow: '(planned)', runner: 'codex', steps: [] });
      store.updateRun(replacement.id, {
        dispatch: { rootRunId: managerRunId, parentRunId: managerRunId, redirectedFrom: source.id, order: order },
      });
      return { id: replacement.id };
    });

    await (manager as unknown as { recoverRedirectOperations(): Promise<void> }).recoverRedirectOperations();
    await vi.waitFor(() => expect(store.getRun(managerRunId)?.dispatch?.pendingReports?.some((entry) => entry.fromRunId === source.id)).toBe(true));

    expect(store.getRun(source.id)?.status).toBe('cancelled');
    expect(store.getRun(source.id)?.dispatch?.redirectOperation).toMatchObject({ state: 'complete', replacementRunId: expect.any(String) });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
