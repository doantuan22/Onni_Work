import { DEFAULT_AGENT_ACCOUNT_ID } from '../../workspace/agent-accounts.ts';
import type { AccountHolds } from '../../workspace/semaphore.ts';
import { followupsEnabled } from '../../handoff.ts';
import { loadConfig } from '../../config.ts';
import { getRepoInfo } from '../../server/git.ts';
import type { RunRecord } from '../../runs/store.ts';
import { loadWorkflows } from '../load.ts';
import type { WorkflowDef } from '../types.ts';
import type { PendingContinuation, QueueContext } from './internal-types.ts';
import { RESTART_CONTINUATION_PROMPT } from './preparation.ts';

const NO_HOLDS: AccountHolds = { deadline: new Set(), inFlight: new Set() };

/** Slots held against the workspace cap, with ordinary and monitoring waits exempted. */
export function busySlots<Input, Workflow extends WorkflowDef>(context: QueueContext<Input, Workflow>): number {
  const ordinaryWaiting = context.waiting.size - context.monitoring.size;
  // Spawned parents are exempt outright; bounding them can make a tree wait on itself forever.
  let spawnParked = 0;
  for (const runId of context.unitParents) if (context.monitoring.has(runId)) spawnParked += 1;
  const watchers = context.monitoring.size - spawnParked;
  const exemptMonitoring = Math.min(watchers, context.semaphore.maxMonitoringSessions());
  return context.active.size + context.starting.size - ordinaryWaiting - exemptMonitoring - spawnParked;
}

/** Enter/leave monitoring are the only writers of the paired sets. */
export function enterMonitoring<Input, Workflow extends WorkflowDef>(
  context: QueueContext<Input, Workflow>,
  runId: string,
  spawnParked: boolean,
): void {
  context.monitoring.add(runId);
  if (spawnParked) context.unitParents.add(runId);
  else context.unitParents.delete(runId);
  context.armMonitoringLivenessTimer(runId);
}

export function leaveMonitoring<Input, Workflow extends WorkflowDef>(
  context: QueueContext<Input, Workflow>,
  runId: string,
): void {
  context.monitoring.delete(runId);
  context.unitParents.delete(runId);
  context.clearMonitoringLivenessTimer(runId);
}

/** FIFO head timestamp used by the workspace semaphore when it broadcasts a freed slot. */
export function oldestQueuedAt<Input, Workflow extends WorkflowDef>(context: QueueContext<Input, Workflow>): number | null {
  const head = context.queue[0];
  if (!head) return null;
  const createdAt = context.store.getRun(head)?.createdAt;
  const ms = createdAt ? Date.parse(createdAt) : Number.NaN;
  return Number.isNaN(ms) ? null : ms;
}

/** A slot release wakes the whole workspace; its oldest waiter may belong to another project. */
export function releaseSlot<Input, Workflow extends WorkflowDef>(context: QueueContext<Input, Workflow>): void {
  void context.semaphore.release();
}

/** Start queued runs while both workspace and project limits allow them to proceed. */
export async function pump<Input, Workflow extends WorkflowDef>(context: QueueContext<Input, Workflow>): Promise<void> {
  context.reconcileMonitoringWakeTimers();
  context.reconcileAutoResumes();
  // A pump requested while one is in flight must replay after its awaited capacity read.
  if (context.pumping) {
    context.pumpAgain = true;
    return;
  }
  context.pumping = true;
  try {
    do {
      context.pumpAgain = false;
      const repo = await getRepoInfo(context.repoRoot);
      const maxParallel = context.semaphore.maxParallel();
      const projectMax = context.semaphore.projectMaxParallel(context.repoRoot);
      const capacity = () =>
        context.semaphore.busy() < maxParallel &&
        busySlots(context) < projectMax &&
        (repo !== null || busySlots(context) < 1);

      // A usage-limit hold closes only the account that produced it. Other accounts keep running.
      const forced = context.forceNextPump;
      context.forceNextPump = false;
      const holds = context.queue.length > 0 && !forced ? context.accountHolds() : NO_HOLDS;
      const anyHold = holds.deadline.size > 0 || holds.inFlight.size > 0;
      const defaultRunner = anyHold ? (await loadConfig(context.repoRoot)).defaultRunner : undefined;
      context.blockOrphanedDependents();
      const startable = (id: string): boolean => {
        const queued = context.store.getRun(id);
        // Redirect cancellation temporarily resembles an orphan; keep dependents parked until repoint.
        if (queued && (queued.dispatch?.after ?? []).some((afterId) => context.redirecting.has(afterId))) return false;
        if (queued && anyHold && context.isAccountHeld(queued, holds, defaultRunner ?? 'claude')) return false;
        if (queued && context.workerEntryFull(queued)) return false;
        if (queued && context.dependencyState(queued) !== 'ready') return false;
        if (queued) context.refreshQueuedDependencyEnvelope(queued);
        // Start now skips parallel caps, but a non-git root remains serialized.
        if (context.startNowRequested.has(id)) return repo !== null || busySlots(context) < 1;
        return capacity();
      };
      // Load the current catalog once per sweep, and only when a fresh workflow can start.
      const catalog = context.queue.some((id) => context.pendingJobs.has(id) && startable(id))
        ? await loadWorkflows(context.repoRoot).then((loaded) => loaded.workflows, () => undefined)
        : undefined;
      while (context.queue.length > 0) {
        // FIFO among startable runs; a held run keeps its place in the queue.
        const next = context.queue.findIndex(startable);
        if (next === -1) break;
        const runId = context.queue.splice(next, 1)[0];
        if (!runId) break;
        context.startNowRequested.delete(runId);
        if (forced) context.forceStarted.add(runId);
        const job = context.pendingJobs.get(runId);
        const continuation = context.pendingContinuations.get(runId);
        context.pendingJobs.delete(runId);
        context.pendingContinuations.delete(runId);
        if (!job && !continuation) continue;
        context.starting.add(runId);
        if (continuation) {
          const hydrated = context.hydrateQueuedContinuation(runId, continuation);
          const ownerToken = Symbol('run-owner');
          void context.runContinuation(
            runId,
            hydrated.stepId,
            hydrated.sessionId,
            hydrated.backend,
            hydrated.prompt,
            hydrated.images,
            hydrated.persistedImages,
            hydrated.persistedAttachments,
            ownerToken,
          ).catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            context.failOwnedContinuation(runId, ownerToken, message);
            // A cancel that landed before the throw still owes the parent its report.
            if (!context.abandonCancelledStart(runId)) context.starting.delete(runId);
          });
          continue;
        }
        if (!job) continue;
        // Read the latest prompt and workflow in the same synchronous dequeue tick.
        const input = context.hydrateQueuedInput(runId, job.input);
        const workflow = catalog ? context.refreshQueuedWorkflow(runId, job.workflow, catalog) : job.workflow;
        const ownerToken = Symbol('run-owner');
        void context.execute(runId, workflow, input, ownerToken).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          const state = context.active.get(runId);
          if (!state || state.ownerToken !== ownerToken || state.cancelled) return;
          context.store.updateRun(runId, {
            status: 'failed',
            error: `engine crashed: ${message}`,
            finishedAt: new Date().toISOString(),
          });
          context.clearIdleTimer(runId);
          context.clearAutosaveTimer(runId);
          context.starting.delete(runId);
          if (!state.cancelled) context.dropActive(runId, ownerToken);
        });
      }
    } while (context.pumpAgain);
  } finally {
    context.pumping = false;
  }
}

/** Reconstruct the non-persisted executable half of one queued run. */
export async function reviveQueuedRun<Input, Workflow extends WorkflowDef>(
  context: QueueContext<Input, Workflow>,
  run: RunRecord,
  reason: string,
): Promise<void> {
  const queuedContinuation = [...run.steps]
    .reverse()
    .find((step) => step.status === 'pending' && step.id.startsWith('continue-'));
  const sessionStep = queuedContinuation
    ? [...run.steps].reverse().find((step) => step.id !== queuedContinuation.id && step.sessionId)
    : undefined;
  if (queuedContinuation && sessionStep?.sessionId) {
    const backend = run.runner ?? 'claude';
    const sessionBackend = sessionStep.backend ?? backend;
    const sessionAccount = sessionStep.profileId ?? DEFAULT_AGENT_ACCOUNT_ID;
    const accountMatches = run.agentProfile === undefined || run.agentProfile === sessionAccount;
    const continuation: PendingContinuation = {
      stepId: queuedContinuation.id,
      sessionId: sessionBackend === backend && accountMatches ? sessionStep.sessionId : undefined,
      backend,
      prompt: RESTART_CONTINUATION_PROMPT,
      images: [],
    };
    context.pendingContinuations.set(run.id, continuation);
    context.queue.push(run.id);
    context.store.appendEvent(run.id, { type: 'lifecycle', message: `${reason} — interrupted continuation re-queued` });
    return;
  }
  const workflow = await context.reviveWorkflow(run);
  if (!workflow) {
    context.store.updateRun(run.id, {
      status: 'failed',
      error: 'interrupted — workflow definition not recoverable after a restart',
      finishedAt: new Date().toISOString(),
    });
    context.store.appendEvent(run.id, {
      type: 'lifecycle',
      message: `${reason} — workflow definition not recoverable, task failed`,
    });
    await context.reportSettledChildToParent(run.id);
    return;
  }
  const generateFollowups = followupsEnabled() ? run.generateFollowups : false;
  if (generateFollowups !== run.generateFollowups) context.store.updateRun(run.id, { generateFollowups });
  context.pendingJobs.set(run.id, {
    workflow,
    input: { ...context.workflowInput(run), ...(context.queuedUsageLimitResume(run) ? { usageLimitResume: true } : {}) },
  });
  context.queue.push(run.id);
  context.store.appendEvent(run.id, { type: 'lifecycle', message: `${reason} — task re-queued` });
}

