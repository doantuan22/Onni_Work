import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describeReaped, reapTaskProcesses, taskProcessReapEnabled } from '../../core/task-processes.ts';
import { isTerminalStatus } from '../../dispatch/engine.ts';
import { continuePromptRefusal, messageText, queuedStackRefusal } from '../queued-bounds.ts';
import { compileV1 } from '../graph.ts';
import { removeAgentTmpDir, sweepAgentTmpDirs } from '../../runs/agent-tmpdir.ts';
import { RESTART_CONTINUATION_PROMPT, type PastedContent } from './preparation.ts';
import type { LifecycleActiveRun, LifecycleContext } from './internal-types.ts';

const CANCEL_GRACE_MS = 1_000;
const LEFTOVER_SETTLE_GRACE_MS = 5_000;
const DEFERRED_MARKER_SUFFIX = '.deferred-messages';

/** Reconcile durable state after a process restart, then resume scheduling. */
export async function recover(context: LifecycleContext): Promise<void> {
  await context.lifecycle.reconcile();
  // Repair durable manager redirects before ordinary recovery can settle their sources or pump
  // a dependent whose predecessor is cancelled.
  await context.recoverRedirectOperations();
  // Plan v2 §9: a manager question outlives the process. Rebuild its deadline from the record,
  // retire one that already passed, and never let either decision wait for the live-run sweep.
  context.recoverSoftAsks();
  noteDeferredLostInRestart(context);
  context.expireLostManagerDeliveriesAfterRestart();
  const live = context.store
    .listRuns()
    .filter((r) => ['queued', 'waiting', 'running'].includes(r.status))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  // A crash never reaches `dropActive`, so its temp directory (#785) outlived the run.
  // Startup is the one moment we know which runs are still live, so sweep every other
  // per-run directory here — bounded to `<dataDir>/tmp`, never a sibling.
  sweepAgentTmpDirs(context.dataDir, live.map((r) => r.id));
  // Same moment for processes (#1411): a run that settled while onni was down, or whose
  // session crashed, never reached `dropActive`'s reap.
  const liveIds = new Set(live.map((r) => r.id));
  reapLeftoverProcesses(
    context,
    context.store.listRuns().filter((r) => !liveIds.has(r.id)).map((r) => r.id),
    0,
    'left running by a settled task (found at startup)',
  );
  for (const run of live) {
    if (context.lifecycle.isBlocked(run.id)) {
      context.store.updateRun(run.id, { status: 'waiting', error: 'Worktree scripts need an explicit recovery action' });
      continue;
    }
    if (run.status === 'queued') {
      await context.reviveQueuedRun(run, 'onni restarted');
      continue;
    }
    // A graph walk that was mid-node — running, or parked at a gate/question — goes back to the
    // queue and resumes AT that node (spec 2026-09-30-workflow-node-editor): `executeGraph`
    // reads the persisted cursor, loop counters and node outputs. A live interactive tail
    // (`waiting` without `askParked`) keeps the settlement below, as it always had.
    //
    // NOT for an agent node: its interrupted session keeps the Continue path below (#1076's
    // guarantee — a parked agent resumes in its session and the graph does not walk past it on
    // a markerless restart turn). Resuming the walk is for nodes onni itself runs.
    const cursor = run.graphState?.cursor;
    const walkedGraph = run.workflowDef ? (run.workflowDef.graph ?? compileV1(run.workflowDef.steps)) : undefined;
    const cursorNode = walkedGraph?.nodes.find((n) => n.id === cursor);
    if (cursor && cursorNode && cursorNode.type !== 'agent' && (run.status === 'running' || (run.status === 'waiting' && run.askParked))) {
      for (const step of run.steps) {
        if (step.status === 'running' || step.status === 'waiting') {
          context.store.updateStep(run.id, step.id, { status: 'pending' });
        }
      }
      context.store.updateRun(run.id, {
        status: 'queued',
        startedAt: undefined,
        currentStepId: undefined,
        askParked: undefined,
        activity: undefined,
      });
      const requeued = context.store.getRun(run.id);
      if (requeued) await context.reviveQueuedRun(requeued, `onni restarted — resuming the workflow at "${cursor}"`);
      continue;
    }
    if (run.status === 'waiting') {
      // Two different parks wear this status. The final interactive step's
      // session was open for follow-ups and the workflow had already run to
      // its end, so settling it as a success is right. A mid-workflow park on
      // a `ONNI:ASK` (#917) or native backend question had NOT run to its end.
      // Later steps may still be `pending`, so the same settlement would report a workflow that
      // stopped at its first question as a finished one. It ends the way any
      // interrupted run ends instead: `failed`, with the Continue button that
      // reopens the session so the question can still be answered. No
      // automatic resume here, unlike the `running` branch below: the agent
      // asked for a decision, and nudging it onward would be onni making
      // that decision on the user's behalf. A monitor handed to the user
      // (`parkMonitorAsWaiting`) carries the same marker for the same reason:
      // the agent said its work was still pending.
      if (run.askParked || run.attentionRequest) {
        const interruptedAt = new Date().toISOString();
        for (const step of run.steps) {
          if (step.status === 'waiting' || step.status === 'running') {
            context.store.updateStep(run.id, step.id, { status: 'failed', finishedAt: interruptedAt });
          }
        }
        context.store.updateRun(run.id, {
          status: 'failed',
          error: 'interrupted — onni process exited while the task was waiting for an answer',
          finishedAt: interruptedAt,
          currentStepId: undefined,
          // A restart does not answer the question: the task stays under "needs you".
          awaitingAnswerSince: interruptedAt,
        });
        context.store.appendEvent(run.id, {
          type: 'lifecycle',
          message: 'onni restarted — the task was waiting for your answer; continue it to reply',
        });
        // Same as the settled branch below: this terminal transition never passes through
        // `dropActive`, so a handed-off child still owes its parent a report.
        await context.reportSettledChildToParent(run.id);
        continue;
      }
      for (const step of run.steps) {
        if (step.status === 'waiting' || step.status === 'running') {
          context.store.updateStep(run.id, step.id, { status: 'done', finishedAt: new Date().toISOString() });
        }
      }
      context.store.appendEvent(run.id, {
        type: 'lifecycle',
        message: 'onni restarted — the open session was settled',
      });
      await context.settleSuccess(run.id);
      // A terminal transition that never passes through `dropActive`: this run was live in the
      // PREVIOUS process and is in none of this one's registries. A settled child still owes
      // its parent a report (spec 2026-09-10-dispatch §Engine) — and a restart is precisely
      // the case the durable pending report exists for.
      await context.reportSettledChildToParent(run.id);
      continue;
    }
    // `running` with no agent session anywhere on the record: the process died while the run
    // was still on its way to one — queued behind the working-tree lease, or spawning. There
    // is nothing to resume, so it goes back to the queue whole rather than failing on
    // "no agent session to resume" with no way forward (the first live dispatch tree lost a
    // task exactly there).
    if (!run.steps.some((step) => step.sessionId)) {
      for (const step of run.steps) {
        if (step.status === 'running' || step.status === 'waiting') {
          context.store.updateStep(run.id, step.id, { status: 'pending' });
        }
      }
      context.store.updateRun(run.id, { status: 'queued', startedAt: undefined, currentStepId: undefined });
      const requeued = context.store.getRun(run.id);
      if (requeued) await context.reviveQueuedRun(requeued, 'onni restarted — the task had not reached its agent session');
      continue;
    }
    // `running`: the process died mid-turn. Mark it interrupted (the state
    // continueRun expects), then pick the work back up from the last session.
    const finishedAt = new Date().toISOString();
    for (const step of run.steps) {
      if (step.status === 'running' || step.status === 'waiting') {
        context.store.updateStep(run.id, step.id, { status: 'failed', finishedAt });
      }
    }
    context.store.updateRun(run.id, {
      status: 'failed',
      error: 'interrupted — onni process exited during the run',
      finishedAt,
      currentStepId: undefined,
    });
    const resumed = context.continueRun(
      run.id,
      {
        text: RESTART_CONTINUATION_PROMPT,
      },
      true,
    );
    context.store.appendEvent(run.id, {
      type: 'lifecycle',
      message: resumed.ok
        ? 'onni restarted — resuming the interrupted task from its last session'
        : `onni restarted — could not resume the interrupted task (${resumed.error ?? 'unknown'})`,
    });
  }
  // Re-arm usage-limit resumes (spec 2026-08-03-auto-resume-after-usage-limit): the wait is
  // routinely longer than a onni session, so the deadline is durable and the timer is rebuilt
  // from it. `pump()` reconciles again on every sweep, so this is the fast path, not the only
  // one — see `reconcileAutoResumes`.
  context.reconcileAutoResumes();
  void context.pump();
}

/** A run cancelled while still `starting`: settle like `dropActive` without a session. */
export function abandonCancelledStart(context: LifecycleContext, runId: string): boolean {
  if (!context.cancelledStarting.delete(runId)) return false;
  context.starting.delete(runId);
  redeliverDeferred(context, runId, 'the run was cancelled');
  void context.reportSettledChildToParent(runId);
  context.releaseSlot();
  return true;
}

/** Fence a continuation failure to the async owner that started it. */
export function failOwnedContinuation(context: LifecycleContext, runId: string, ownerToken: symbol, message: string): void {
  const state = context.active.get(runId);
  if (!state || state.ownerToken !== ownerToken || state.cancelled) return;
  context.store.updateRun(runId, {
    status: 'failed',
    error: `continue crashed: ${message}`,
    finishedAt: new Date().toISOString(),
  });
  dropActive(context, runId, state);
}

/** Remove a run from the live registries — keeps `waiting ⊆ active`. */
export function dropActive(context: LifecycleContext, runId: string, expectedState?: LifecycleActiveRun): void {
  const state = context.active.get(runId);
  // Cancellation can retire a state while its async startup/teardown is still unwinding. A
  // continuation (or another owner) may have claimed the same run id by the time that old
  // promise reaches finally; never let stale cleanup release the newer owner's slot.
  if (expectedState !== undefined && state !== expectedState) return;
  const queuedContinue = state && !state.cancelled ? state.continueOnDrop : undefined;
  // A Continue taken in the same teardown window sends the review back, so it supersedes an accept.
  const acceptReview = !queuedContinue && state?.acceptReviewOnDrop && !state.cancelled && context.store.getRun(runId)?.status === 'review';
  // An in-place run's accept lands its changes (spec 2026-10-20-trunk-based-projects) — once
  // the tree is released below, through the same path as Finish on a settled review.
  const landOnAccept = acceptReview && context.store.getRun(runId)?.worktree === false;
  // Read before the registries below forget it: why a message deferred in this window must not resume the run.
  const stoppedBy = deferredStopReason(context, runId, state, !!acceptReview, !!queuedContinue);
  if (acceptReview && !landOnAccept) {
    context.store.updateRun(runId, { status: 'done', completionReason: 'accepted' });
    context.store.appendEvent(runId, { type: 'lifecycle', message: 'review accepted — finished without a PR' });
  }
  state?.releaseWorktree?.();
  state?.releaseRepoRoot?.();
  if (state) state.releaseRepoRoot = undefined;
  if (state?.cancellationTimer) clearTimeout(state.cancellationTimer);
  if (state) state.cancellationTimer = undefined;
  context.waiting.delete(runId);
  context.leaveMonitoring(runId);
  if (state) context.clearMonitoringWakeTimer(state, runId);
  context.active.delete(runId);
  // Session result has settled and its sink has flushed before terminal cleanup.
  context.store.clearRunSecrets(runId);
  context.memoryPausing.delete(runId);
  context.lastNamerKey.delete(runId);
  context.pendingBranchNames.delete(runId);
  context.forceStarted.delete(runId);
  // The run's slot is gone from busySlots() as of the deletes above — hand it
  // to the workspace's oldest queued run, in ANY project. Every terminal path
  // funnels through here, so this one call covers them all.
  // Same reasoning as retention below — every terminal path funnels through here, so this one
  // call covers them all. The usage-limit question is asked once, from the record the failing
  // path has already written.
  //
  // BEFORE releasing the slot, and that order is the whole point: `releaseSlot` pumps every
  // manager, and a pump reads the hold off the records. Publishing the schedule afterwards
  // left a window — measured as exactly one extra task — where the queue saw a free slot and an
  // account that looked healthy, and started work that was already doomed.
  context.scheduleAutoResumeIfLimited(runId);
  // A settled CHILD owes its parent a report. Persist it before releasing the slot, so a parent
  // that has to be resumed through the queue is already queued when the pump sweeps.
  // Not awaited: the record is persisted synchronously before the report's one git read.
  void context.reportSettledChildToParent(runId);
  context.releaseSlot();
  if (landOnAccept) void context.finishReview(runId);
  // A run leaving the active registry is a terminal transition — enforce retention here so a
  // single hook covers every terminal path. Fire-and-forget: retention must never delay or throw.
  context.startRetentionPass();
  // The run's temp directory (#785) goes on the same terminal transition, and unconditionally.
  removeAgentTmpDir(context.dataDir, runId);
  reapLeftoverProcesses(context, [runId], LEFTOVER_SETTLE_GRACE_MS, 'still running after the task settled');
  // Last, so the Continue starts from exactly the state a Continue posted just after the drop would.
  if (queuedContinue) {
    const resumed = context.continueRun(runId, queuedContinue.opts, queuedContinue.deferForCapacity);
    if (!resumed.ok) {
      context.store.appendEvent(runId, { type: 'lifecycle', message: `continue could not start — ${resumed.error}` });
    }
  }
  // After `scheduleAutoResumeIfLimited`: a run parked for its usage window keeps that schedule.
  redeliverDeferred(context, runId, stoppedBy ?? (context.autoResumeTimers.has(runId) ? 'the task is waiting for its usage limit to reset' : undefined));
  context.expireUnacceptedManagerDeliveries(runId, 'target-settled');
}

function deferredStopReason(
  context: LifecycleContext,
  runId: string,
  state: LifecycleActiveRun | undefined,
  acceptReview: boolean,
  queuedContinue: boolean,
): string | undefined {
  if (state?.cancelled) return 'the run was cancelled';
  if (acceptReview) return 'the review was accepted';
  // A Continue taken in the same window supersedes a Finish, and its session flushes the buffer.
  if ((state?.finishRequested || state?.finishedAtWait) && !queuedContinue) return 'the task was finished';
  if (context.memoryPausing.has(runId)) return 'the task was paused for exceeding the memory limit';
  return undefined;
}

/** Redeliver messages accepted for a session that never opened again. */
function redeliverDeferred(context: LifecycleContext, runId: string, stoppedBy?: string): void {
  // A continuation already owns the run: its session's open flushes the buffer.
  if (context.active.has(runId) || context.starting.has(runId)) return;
  const pending = context.deferredMessages.get(runId);
  const deliveryIds = context.deferredManagerDeliveryIds.get(runId) ?? [];
  setDeferred(context, runId, undefined);
  if (!pending?.length) return;
  const undelivered = (reason: string, count = pending.length): void => {
    context.store.appendEvent(runId, {
      type: 'lifecycle',
      message: `${count === 1 ? 'a message' : `${count} messages`} sent while the session was closing could not be delivered — ${reason}`,
    });
  };
  if (stoppedBy) return undelivered(stoppedBy);
  if (context.isQueued(runId)) {
    for (let index = 0; index < pending.length; index += 1) {
      const content = pending[index]!;
      const run = context.store.getRun(runId);
      const refusal = run ? queuedStackRefusal(context.dataDir, run, content) : 'the task is gone';
      if (refusal || !context.enqueueMessage(runId, content, deliveryIds[index])) {
        undelivered(refusal ?? 'the task already started', 1);
        if (deliveryIds[index]) context.recordManagerDeliveryTransition(runId, deliveryIds[index]!, 'expired', 'target-settled');
      }
    }
    return;
  }
  const blocks = pending.flat();
  const text = pending.map(messageText).filter((t) => t.trim()).join('\n\n');
  const refusal = continuePromptRefusal(text, blocks);
  if (refusal) return undelivered(refusal);
  const resumedDeliveryIds = deliveryIds.filter((id): id is string => id !== undefined);
  if (resumedDeliveryIds.length) context.continuationManagerDeliveryIds.set(runId, resumedDeliveryIds);
  const resumed = context.continueRun(runId, { text, images: blocks.filter((b) => b.type !== 'text') });
  if (!resumed.ok) {
    context.continuationManagerDeliveryIds.delete(runId);
    for (const id of resumedDeliveryIds) context.recordManagerDeliveryTransition(runId, id, 'expired', 'target-settled');
    undelivered(resumed.error ?? 'continue could not start');
  }
}

/** The one writer of `deferredMessages`; a marker explains messages lost at process restart. */
export function setDeferred(
  context: LifecycleContext,
  runId: string,
  pending: PastedContent[][] | undefined,
  deliveryIds?: Array<string | undefined>,
): void {
  const marker = join(context.dataDir, 'runs', `${runId}${DEFERRED_MARKER_SUFFIX}`);
  if (pending?.length) {
    context.deferredMessages.set(runId, pending);
    if (deliveryIds !== undefined) context.deferredManagerDeliveryIds.set(runId, deliveryIds);
    else if (!context.deferredManagerDeliveryIds.has(runId)) context.deferredManagerDeliveryIds.set(runId, pending.map(() => undefined));
    try {
      mkdirSync(dirname(marker), { recursive: true });
      writeFileSync(marker, String(pending.length));
    } catch {
      // Best effort: the marker only explains a loss, it never decides a delivery.
    }
    return;
  }
  context.deferredMessages.delete(runId);
  context.deferredManagerDeliveryIds.delete(runId);
  try {
    rmSync(marker, { force: true });
  } catch {
    // Best effort, like the write: a stale marker costs one spurious note after a restart.
  }
}

/** Startup: messages a previous process held for a session that never reopened are gone. */
function noteDeferredLostInRestart(context: LifecycleContext): void {
  let names: string[];
  try {
    names = readdirSync(join(context.dataDir, 'runs')).filter((name) => name.endsWith(DEFERRED_MARKER_SUFFIX));
  } catch {
    return;
  }
  for (const name of names) {
    const runId = name.slice(0, -DEFERRED_MARKER_SUFFIX.length);
    const path = join(context.dataDir, 'runs', name);
    let count = 1;
    try {
      count = Math.max(1, Number.parseInt(readFileSync(path, 'utf8'), 10) || 1);
    } catch {
      // Unreadable: still one lost message at least.
    }
    if (context.store.getRun(runId)) {
      context.store.appendEvent(runId, {
        type: 'lifecycle',
        message: `${count === 1 ? 'a message' : `${count} messages`} sent while the session was closing could not be delivered — onni restarted; send it again`,
      });
    }
    try {
      rmSync(path, { force: true });
    } catch {
      // A read-only data dir must not fail recovery; the note repeats on the next boot at worst.
    }
  }
}

/** Is this run settled and not owned by a session again (a Continue inside the grace)? */
function runSettled(context: LifecycleContext, runId: string): boolean {
  const run = context.store.getRun(runId);
  return !!run && !context.active.has(runId) && isTerminalStatus(run.status);
}

/** Stop leftover task processes after a bounded grace period, without delaying the lifecycle. */
function reapLeftoverProcesses(context: LifecycleContext, runIds: string[], graceMs: number, reason: string): void {
  if (!taskProcessReapEnabled() || runIds.length === 0) return;
  const ids = new Set(runIds);
  const timer = setTimeout(() => {
    void reapTaskProcesses({ match: (id) => ids.has(id), stillSettled: (id) => runSettled(context, id) })
      .then((reaped) => {
        for (const runId of ids) {
          const mine = reaped.filter((p) => p.taskId === runId);
          if (mine.length === 0) continue;
          context.store.appendEvent(runId, {
            type: 'lifecycle',
            message: `stopped ${describeReaped(mine)} — ${reason}`,
          });
        }
      })
      .catch(() => undefined);
  }, graceMs);
  timer.unref?.();
}

/** Cancel a run, including its descendants, while keeping the run's own result authoritative. */
export function cancel(context: LifecycleContext, runId: string): boolean {
  context.abortVerification(runId);
  if (context.lifecycle.isBlocked(runId)) return false;
  context.cancelDescendants(runId, new Set([runId]));
  return cancelOne(context, runId);
}

/** Emergency stop: cancel every queued, live, or scheduled run, then reap leftover processes. */
export function cancelAll(context: LifecycleContext): number {
  let stopped = 0;
  const ids: string[] = [];
  for (const run of context.store.listRuns()) {
    if (isTerminalStatus(run.status) && !(run.status === 'failed' && run.autoResumeAt !== undefined)) continue;
    if (context.lifecycle.isBlocked(run.id)) continue;
    ids.push(run.id);
    if (cancelOne(context, run.id)) stopped++;
  }
  reapLeftoverProcesses(context, ids, LEFTOVER_SETTLE_GRACE_MS, 'stopped by stop-all');
  return stopped;
}

/** One run's cancellation, with no regard for a hierarchy — what `cancel` has always done. */
export function cancelOne(context: LifecycleContext, runId: string): boolean {
  // Still waiting in the queue: just drop it there.
  const queuedAt = context.queue.indexOf(runId);
  if (queuedAt >= 0) {
    context.queue.splice(queuedAt, 1);
    context.pendingJobs.delete(runId);
    context.pendingBranchNames.delete(runId);
    context.pendingContinuations.delete(runId);
    context.startNowRequested.delete(runId);
    context.store.updateRun(runId, { status: 'cancelled', finishedAt: new Date().toISOString() });
    context.store.appendEvent(runId, { type: 'lifecycle', message: 'cancelled while queued' });
    context.expireUnacceptedManagerDeliveries(runId, 'target-settled');
    // A queued run never entered `active`, so it never reaches `dropActive` — the one terminal
    // transition that misses the settle hook. Without this a parent waiting on a child the user
    // cancelled from the queue would wait for a report nobody would ever send.
    void context.reportSettledChildToParent(runId);
    context.clearSoftAsk(runId);
    return true;
  }
  const state = context.active.get(runId);
  if (!state) {
    // Dequeued but not yet registered: a continuation awaits its lifecycle gate first (#1495).
    // Refusing here let the run start right after the user cancelled it.
    if (!context.starting.has(runId)) {
      // A failed run with a resume booked is the one idle run Cancel still has work on: the
      // resume (a usage-limit wait or a transient retry), so it — and a cancelled parent — stops it.
      const run = context.store.getRun(runId);
      if (run?.status !== 'failed' || (run.autoResumeAt === undefined && !context.autoResumeTimers.has(runId))) return false;
      const cancelled = context.cancelAutoResume(runId);
      if (cancelled) context.clearSoftAsk(runId);
      return cancelled;
    }
    context.cancelledStarting.add(runId);
    context.store.updateRun(runId, { status: 'cancelled', finishedAt: new Date().toISOString(), currentStepId: undefined });
    context.store.appendEvent(runId, { type: 'lifecycle', message: 'run cancelled' });
    context.expireUnacceptedManagerDeliveries(runId, 'target-settled');
    context.clearSoftAsk(runId);
    return true;
  }
  state.cancelled = true;
  context.clearIdleTimer(state);
  try {
    state.interrupt();
  } catch {
    // Cancellation is terminal even if a provider's interrupt hook is already tearing down.
  }
  const finishedAt = new Date().toISOString();
  for (const step of context.store.getRun(runId)?.steps ?? []) {
    if (step.status === 'running' || step.status === 'waiting') {
      context.store.updateStep(runId, step.id, { status: 'cancelled', finishedAt });
    }
  }
  context.store.updateRun(runId, { status: 'cancelled', finishedAt, currentStepId: undefined });
  context.store.appendEvent(runId, { type: 'lifecycle', message: 'run cancelled' });
  context.expireUnacceptedManagerDeliveries(runId, 'target-settled');
  context.clearSoftAsk(runId);
  // A startup wedge has no provider session to reap, so release its slot immediately. Once a
  // session has opened, keep the slot until its interrupt/teardown settles; admitting a
  // replacement while a non-cooperative provider is still alive would violate maxParallel.
  if (!state.sessionEverOpened || !state.session) {
    dropActive(context, runId, state);
  } else {
    state.cancellationTimer = setTimeout(() => {
      if (context.active.get(runId) !== state || !state.cancelled) return;
      const session = state.session;
      if (!session) return;
      session.hardStop?.();
      const reapSettled = () => {
        if (context.active.get(runId) === state && state.cancelled) dropActive(context, runId, state);
      };
      // Handle both fulfillment and rejection: a bare finally() creates a new
      // rejected promise when a provider teardown fails, producing an orphaned
      // unhandled rejection during cancellation.
      void session.result.then(reapSettled, reapSettled);
    }, CANCEL_GRACE_MS);
    state.cancellationTimer.unref?.();
  }
  return true;
}

/** Process-local proof, not merely a deadline left in the run record. */
export function hasScheduledAutoResume(context: LifecycleContext, runId: string): boolean {
  return context.autoResumeTimers.has(runId);
}

/** Removal waits for the captured provider result, never merely the cancel flag. */
export async function cancelAndWait(context: LifecycleContext, runId: string): Promise<boolean> {
  const state = context.active.get(runId);
  const result = state?.session?.result;
  if (!isActive(context, runId)) return true;
  if (!context.cancel(runId)) return false;
  // A run cancelled while `starting` has no session yet: it leaves once its gate await returns.
  if (!result) return context.cancelledStarting.has(runId) ? waitInactive(context, runId, 10_000) : !isActive(context, runId);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = await Promise.race([
    result.then(() => true, () => true),
    new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 10_000); }),
  ]);
  if (timer) clearTimeout(timer);
  return settled && !isActive(context, runId);
}

export async function waitInactive(context: LifecycleContext, runId: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (isActive(context, runId) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  return !isActive(context, runId);
}

/** Whether a run still owns a live, starting, or queued slot. */
export function isActive(context: LifecycleContext, runId: string): boolean {
  return context.active.has(runId) || context.starting.has(runId) || context.queue.includes(runId);
}
