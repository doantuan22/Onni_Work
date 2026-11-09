import { accountStateHint, classifyAgentFailure, MAX_TRANSIENT_RETRIES, transientRetryDelayMs } from '../../core/agent-failure-class.ts';
import type { RunnerId } from '../../core/agent-runner.ts';
import { loadConfig, resolveWorktreeRetention } from '../../config.ts';
import { diskFullAgentErrorText } from '../../disk-space.ts';
import { isTerminalStatus } from '../../dispatch/engine.ts';
import { reclaimWorktrees } from '../../runs/retention.ts';
import type { RunRecord, StepState } from '../../runs/store.ts';
import { parseUsageLimit } from '../../core/usage-limit.ts';
import { followupsEnabled } from '../../handoff.ts';
import { describeHit, evaluateLimits, raiseLimits, subtreeOf } from '../limits.ts';
import { stepKind, type WorkflowDef } from '../types.ts';
import type { LimitHit } from '@onni/contract';
import type { StartRunInput } from '../run.ts';
import type { SchedulingActiveRun, SchedulingAutoResumeReason, SchedulingContext } from './internal-types.ts';
import type { AccountHolds } from '../../workspace/semaphore.ts';

export function scheduleAutoResumeIfLimited(context: SchedulingContext, runId: string): void {
  if (context.autoResumeTimers.has(runId)) return; // already promised
  const run = context.store.getRun(runId);
  if (!run || run.status !== 'failed') return;
  const failure = classifyAgentFailure(run.error);
  // The cause, on the record, so the cockpit (the morning digest) can say "needs a sign-in" without re-reading prose.
  if (failure !== 'other' && run.failureClass !== failure) context.store.updateRun(runId, { failureClass: failure });
  if (failure === 'transient') {
    scheduleTransientRetry(context, run);
    return;
  }
  armUsageLimitResume(context, run);
  // Account and conversation state is the user's to fix: say how, instead of a bare failure.
  const hint = failure === 'disk_full'
    ? diskFullAgentErrorText(run.error ?? '', run.worktreePath ?? context.repoRoot) ?? undefined
    : accountStateHint(failure, failedBackend(run), { resetKnown: parseUsageLimit(run.error) !== null });
  if (hint) context.store.appendEvent(runId, { type: 'lifecycle', message: hint });
}

export function failedBackend(run: RunRecord): string | undefined {
  return [...run.steps].reverse().find((step) => step.status === 'failed' && step.backend)?.backend ?? run.runner;
}

export function scheduleTransientRetry(context: SchedulingContext, run: RunRecord): void {
  // Same refusals as a usage-limit resume: an archived task, the switch off, no session.
  if (run.archived || !context.semaphore.autoResumeOnUsageLimit() || !run.steps.some((step) => step.sessionId)) {
    return;
  }
  const attempts = run.autoResumeAttempts ?? 0;
  if (attempts >= MAX_TRANSIENT_RETRIES) {
    context.store.appendEvent(run.id, {
      type: 'note',
      message: `the provider is still failing after ${MAX_TRANSIENT_RETRIES} automatic retries — continue this task manually`,
    });
    return;
  }
  const wakeAt = new Date(Date.now() + transientRetryDelayMs(attempts + 1, run.error));
  armAutoResume(context, run.id, wakeAt.getTime(), 'transient');
  context.store.appendEvent(run.id, {
    type: 'lifecycle',
    message: `temporary provider failure — retrying automatically at ${context.policy.formatWakeInstant(wakeAt)} (${attempts + 1}/${MAX_TRANSIENT_RETRIES})`,
  });
}

export function armUsageLimitResume(context: SchedulingContext, run: RunRecord): void {
  const runId = run.id;
  // Archiving IS resigning from a task. Reviving one because a window happened to reopen would
  // be the feature working against the clearest signal the user can give it.
  if (run.archived) return;
  const limit = parseUsageLimit(run.error);
  if (!limit) return;
  if (!context.semaphore.autoResumeOnUsageLimit()) return;
  // No session to resume = nothing this feature can do; `continueRun` would refuse anyway.
  if (!run.steps.some((step) => step.sessionId)) return;
  const attempts = run.autoResumeAttempts ?? 0;
  if (attempts >= context.policy.maxAutoResumes) {
    context.store.appendEvent(runId, {
      type: 'note',
      message: `automatic resume cap reached (${context.policy.maxAutoResumes}) — continue this task manually`,
    });
    return;
  }
  const wakeAt = new Date(limit.resetAt.getTime() + context.policy.autoResumeGraceMs);
  armAutoResume(context, runId, wakeAt.getTime(), 'usage_limit');
  context.store.appendEvent(runId, {
    type: 'lifecycle',
    message: `usage limit reached — resuming automatically at ${context.policy.formatWakeInstant(wakeAt)}`,
  });
}

export function armAutoResume(context: SchedulingContext, runId: string, deadline: number, reason: SchedulingAutoResumeReason): void {
  context.store.updateRun(runId, { autoResumeAt: new Date(deadline).toISOString(), autoResumeReason: reason });
  const timer = setTimeout(() => fireAutoResume(context, runId), Math.max(0, deadline - Date.now()));
  timer.unref?.();
  context.autoResumeTimers.set(runId, timer);
}

export function fireAutoResume(context: SchedulingContext, runId: string): void {
  context.autoResumeTimers.delete(runId);
  const run = context.store.getRun(runId);
  if (!run || run.status !== 'failed' || !run.autoResumeAt) return;
  // Belt and braces against the one gap `reconcileAutoResumes` cannot close: the setting going
  // off in the window between the last pump and this tick.
  if (!context.semaphore.autoResumeOnUsageLimit()) {
    clearAutoResume(context, runId);
    return;
  }
  const attempts = (run.autoResumeAttempts ?? 0) + 1;
  const reason = run.autoResumeReason ?? 'usage_limit';
  // #1300: a workflow interruption must return to its executor after the resumed session.
  // The saved workflow and failed step/session already supply the recovery checkpoint,
  // including when the queued run is reconstructed after a restart.
  const workflowStep = interruptedWorkflowStep(context, run);
  let resumed: { ok: boolean; error?: string };
  if (workflowStep && run.workflowDef) {
    clearAutoResume(context, runId);
    context.pendingJobs.set(runId, {
      workflow: run.workflowDef,
      input: { ...workflowInput(context, run), usageLimitResume: true },
    });
    context.queue.push(runId);
    context.store.updateRun(runId, {
      status: 'queued', error: undefined, finishedAt: undefined, currentStepId: undefined,
    });
    resumed = { ok: true };
  } else {
    // Legacy records without a recoverable definition and standalone continuations retain
    // their existing session recovery. Manual Continue also keeps its existing semantics.
    resumed = context.continueRun(runId, { text: reason === 'transient' ? context.policy.transientRetryPrompt : context.policy.autoResumePrompt }, true);
  }
  if (!resumed.ok) {
    // Refusals happen before `continueRun` retires anything, so the deadline is still on the
    // record — and a deadline in the past is a promise the cockpit keeps displaying and the
    // engine will never keep. Retire it here instead, and say why.
    clearAutoResume(context, runId);
    context.store.appendEvent(runId, {
      type: 'note',
      message: `automatic resume could not start — ${resumed.error ?? 'unknown'}`,
    });
    return;
  }
  // `clearAutoResume` above retired the reason with the deadline; the resume in flight keeps it,
  // so `accountHolds` knows a transient retry holds no account.
  context.store.updateRun(runId, { autoResumeAttempts: attempts, autoResumeReason: reason });
  context.store.appendEvent(runId, {
    type: 'lifecycle',
    message: reason === 'transient'
      ? `retrying after a temporary provider failure (${attempts}/${MAX_TRANSIENT_RETRIES})`
      : `usage limit reset — resuming automatically (${attempts}/${context.policy.maxAutoResumes})`,
  });
  // A deferred continuation only ENQUEUES itself; the queue moves when something pumps it, and
  // `recover()` — the other deferring caller — pumps once after its whole bulk sweep. A timer
  // firing on its own has no such follow-up, so without this the resumed run sits at `queued`
  // until some unrelated run happens to finish. This is the pump for it.
  void context.pump();
}

export function interruptedWorkflowStep(context: SchedulingContext, run: RunRecord): StepState | undefined {
  // Later steps can retain old session ids when a check loops back to an earlier agent.
  // Only the failed agent is the interruption; a pending retry is not a newer session.
  const step = [...run.steps].reverse().find((candidate) => candidate.kind === 'agent' && candidate.status === 'failed');
  if (!step?.sessionId || !context.policy.autoResumeReasonFor(step.error)) return undefined;
  return run.workflowDef?.steps.some((definition) => definition.id === step.id && stepKind(definition) === 'agent')
    ? { ...step }
    : undefined;
}

export function queuedUsageLimitResume(context: SchedulingContext, run: RunRecord): boolean {
  const step = interruptedWorkflowStep(context, run);
  const cursor = run.graphState?.cursor;
  return step !== undefined && (cursor === undefined || cursor === step.id);
}

export function workflowInput(context: SchedulingContext, run: RunRecord): StartRunInput {
  return context.hydrateQueuedInput(run.id, {
    task: run.task,
    model: run.model,
    runner: run.runner,
    agentProfile: run.agentProfile,
    // No `systemPrompt`: the record keeps only the COMPOSED prompt, never the bare override, so
    // feeding it back would re-compose it; a usage-limit resume reuses it verbatim in `execute`.
    generateFollowups: followupsEnabled() ? run.generateFollowups : false,
    // Both lifecycle entry points must restore autonomy, dispatch, isolation and read-only
    // (#489, spec 2026-09-10-dispatch A11, #1597), as well as the task's account.
    autonomous: run.autonomous,
    dispatch: run.dispatch,
    worktree: run.worktree,
    ...(run.readOnly ? { readOnly: true } : {}),
  });
}

export function reconcileAutoResumes(context: SchedulingContext): void {
  if (!context.semaphore.autoResumeOnUsageLimit()) {
    // Sweep the RECORDS, not the timer map. A record promising a resume that no timer is
    // holding is the exact population this method exists for, and it is also the one the
    // setting can be switched off in front of: onni restarted while it was off, the config
    // was hand-edited, or the project context was disposed mid-wait. Retiring only the armed
    // timers leaves such a record with a live `autoResumeAt`, which `accountHolds()` reads as
    // a deadline hold — so nothing new starts on that account, `rescueStalledQueue` treats the
    // phantom appointment as a legitimate reason to sit still, and the cockpit shows a
    // `scheduled` row for a resume that will never come. `clearAutoResume` covers the armed
    // ones too, so this one loop is the whole cancellation.
    const pending = new Set([
      ...context.autoResumeTimers.keys(),
      ...context.store.listRuns().filter((run) => run.autoResumeAt !== undefined).map((run) => run.id),
    ]);
    for (const runId of pending) {
      clearAutoResume(context, runId);
      context.store.appendEvent(runId, {
        type: 'note',
        message: 'automatic resume cancelled — auto-resume is switched off',
      });
    }
    return;
  }
  for (const run of context.store.listRuns()) {
    if (run.status !== 'failed' || !run.autoResumeAt) continue;
    if (context.autoResumeTimers.has(run.id)) continue;
    const deadline = Date.parse(run.autoResumeAt);
    // A deadline that is unreadable, belongs to a run that has spent its cap, or belongs to a
    // task the user has archived is retired rather than re-armed: it can only mislead. One
    // that has just passed arms at zero — the window is open, which is the point.
    if (
      run.archived
      || !Number.isFinite(deadline)
      || (run.autoResumeAttempts ?? 0) >= context.policy.autoResumeCap(run.autoResumeReason)
    ) {
      context.store.updateRun(run.id, { autoResumeAt: undefined });
      continue;
    }
    // …and one missed by more than a day is retired loudly: reviving a task from another era
    // is a surprise, not a service, and this is what keeps a sweep from resurrecting every
    // limit-stopped task a user has long since walked away from.
    if (Date.now() - deadline > context.policy.autoResumeMissedWindowMs) {
      context.store.updateRun(run.id, { autoResumeAt: undefined });
      context.store.appendEvent(run.id, {
        type: 'note',
        message: 'automatic resume expired — its window reopened over a day ago; continue this task manually',
      });
      continue;
    }
    armAutoResume(context, run.id, deadline, run.autoResumeReason ?? 'usage_limit');
  }
}

export function requeueWhileHeld(
  context: SchedulingContext,
  runId: string,
  workflow: WorkflowDef,
  input: StartRunInput,
  runner: RunnerId,
  state?: SchedulingActiveRun,
): boolean {
  const run = context.store.getRun(runId);
  if (!run || run.status === 'cancelled' || state?.cancelled) return false;
  // The watchdog sent this one through. Checked, never consumed: the spawn path asks this
  // question TWICE — here at the top of `execute`, and again after the exclusive repo-root
  // lease is granted — so a one-shot flag would clear at the first gate and let the second one
  // hand an in-place run straight back, re-wedging the queue the rescue had just freed.
  // `dropActive` retires the entry on every terminal path, so the set still cleans itself up.
  if (context.forceStarted.has(runId)) return false;
  if (!context.policy.accountHeldFor({ ...run, runner }, context.semaphore.accountHolds(), runner)) return false;
  state?.releaseRepoRoot?.();
  if (state) state.releaseRepoRoot = undefined;
  context.pendingJobs.set(runId, { workflow, input });
  context.queue.push(runId);
  context.store.updateRun(runId, {
    status: 'queued',
    startedAt: input.usageLimitResume ? run.startedAt : undefined,
    currentStepId: undefined,
  });
  context.store.appendEvent(runId, {
    type: 'note',
    message: 'held in the queue — this agent account is waiting out a usage limit',
  });
  context.dropActive(runId);
  return true;
}

export async function rescueStalledQueue(context: SchedulingContext, now = Date.now()): Promise<void> {
  // First, the worst shape: a record that says `queued` while the engine holds no job, no
  // continuation and no queue entry for it. `pump()` cannot see such a run — it iterates the
  // queue, and this one is not in it — so nothing will ever start it. Re-adopt it through the
  // same path boot recovery uses.
  for (const run of context.store.listRuns()) {
    if (run.status !== 'queued') continue;
    if (context.active.has(run.id) || context.starting.has(run.id)) continue;
    if (context.pendingJobs.has(run.id) || context.pendingContinuations.has(run.id)) continue;
    if (context.queue.includes(run.id)) continue;
    console.warn(`[onni] queue watchdog: re-adopting queued run ${run.id} the engine had lost`);
    await context.reviveQueuedRun(run, 'queue watchdog');
  }
  if (context.queue.length === 0) return;
  if (context.busySlots() > 0 || context.starting.size > 0) return;
  if (context.semaphore.busy() > 0) return;
  // A future deadline is a real reason to sit still: that timer will fire and pump.
  for (const run of context.store.listRuns()) {
    if (run.status !== 'failed' || !run.autoResumeAt) continue;
    const deadline = Date.parse(run.autoResumeAt);
    if (Number.isFinite(deadline) && deadline > now) return;
  }
  if (context.semaphore.accountHolds().inFlight.size === 0) {
    // Not the hold, then — some other wakeup went missing. An ordinary pump is the whole fix,
    // and it is idempotent, so this stays quiet.
    void context.pump();
    return;
  }
  console.warn(
    '[onni] queue watchdog: work is queued, nothing is running, and the usage-limit hold has no'
    + ' deadline behind it — starting the next task anyway',
  );
  context.forceNextPump.value = true;
  void context.pump();
}

export function refreshQueueReasons(context: SchedulingContext): void {
  const revision = ++context.queueReasonRevision.value;
  const holds = context.semaphore.accountHolds();
  if ((holds.deadline.size > 0 || holds.inFlight.size > 0)
    && context.store.listRuns().some((run) => run.status === 'queued' && !run.runner)) {
    // Match admission's effective account without persisting a runner override (#1340).
    void loadConfig(context.repoRoot).then((config) => {
      if (revision === context.queueReasonRevision.value) applyQueueReasons(context, config.defaultRunner);
    });
    return;
  }
  applyQueueReasons(context, 'claude');
}

export function applyQueueReasons(context: SchedulingContext, defaultRunner: RunnerId): void {
  const holds = context.semaphore.accountHolds();
  for (const run of context.store.listRuns()) {
    const key = context.policy.runAccountKey(run, defaultRunner);
    const until = holds.deadlines?.get(key);
    const reason: RunRecord['queueWaitReason'] = run.status !== 'queued' ? undefined
      : until !== undefined ? { kind: 'usage-reset', until: new Date(until).toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
      : holds.inFlight.has(key) && !context.policy.resumeInFlight(run) ? { kind: 'account-resume' } : undefined;
    if (JSON.stringify(reason) !== JSON.stringify(run.queueWaitReason)) context.store.updateRun(run.id, { queueWaitReason: reason });
  }
}

export function accountHolds(context: SchedulingContext, now = Date.now()): AccountHolds {
  const deadlines = new Map<string, number>();
  const deadline = new Set<string>();
  const inFlight = new Set<string>();
  for (const run of context.store.listRuns()) {
    // A holding run always carries the runner it actually ran on, so the fallback is unused
    // here — it is spelled out rather than `!` so a future record shape degrades, not throws.
    const key = () => context.policy.runAccountKey(run, run.runner ?? 'claude');
    // A transient retry says nothing about the account's window, so it holds nothing.
    if (run.autoResumeReason === 'transient') continue;
    if (run.status === 'failed' && run.autoResumeAt) {
      const at = Date.parse(run.autoResumeAt);
      if (Number.isFinite(at) && at > now) { deadline.add(key()); deadlines.set(key(), Math.min(at, deadlines.get(key()) ?? Infinity)); }
    } else if (context.policy.resumeInFlight(run)) {
      inFlight.add(key());
    }
  }
  return { deadline, inFlight, deadlines };
}

export function cancelAutoResume(context: SchedulingContext, runId: string): boolean {
  const run = context.store.getRun(runId);
  if (!run) return false;
  const pending = run.autoResumeAt !== undefined || context.autoResumeTimers.has(runId);
  clearAutoResume(context, runId);
  if (pending) {
    context.store.appendEvent(runId, {
      type: 'note',
      message: 'automatic resume cancelled for this task',
    });
    // This run may have been the last thing holding its account's queue — nothing else will
    // notice, since the hold is derived and its release is not an event.
    void context.pump();
  }
  return true;
}

export function clearAutoResume(context: SchedulingContext, runId: string): void {
  const timer = context.autoResumeTimers.get(runId);
  if (timer) clearTimeout(timer);
  context.autoResumeTimers.delete(runId);
  const run = context.store.getRun(runId);
  if (!run) return;
  if (run.autoResumeAt !== undefined || run.autoResumeAttempts !== undefined || run.autoResumeReason !== undefined) {
    context.store.updateRun(runId, { autoResumeAt: undefined, autoResumeAttempts: undefined, autoResumeReason: undefined });
  }
}

export async function enforceRetention(context: SchedulingContext): Promise<void> {
  try {
    const keep = await resolveWorktreeRetention(context.repoRoot);
    await reclaimWorktrees(context.repoRoot, context.store, keep, {lifecycle: context.lifecycle});
  } catch {
    // retention is best-effort; swallow so terminal transitions never break.
  }
}

export function parkRepoRoot(context: SchedulingContext, runId: string, state: SchedulingActiveRun): void {
  if (!context.dispatchOf(runId)) return;
  if (state.cwd !== context.repoRoot || !state.releaseRepoRoot) return;
  state.releaseRepoRoot();
  state.releaseRepoRoot = undefined;
  state.repoRootParked = true;
  context.store.appendEvent(runId, {
    type: 'note',
    stepId: state.currentStepId,
    message: 'parked — released the repository working tree so other in-place tasks can run; it is taken back before this task resumes',
  });
}

export function claimFreeRepoRoot(context: SchedulingContext, state: SchedulingActiveRun): boolean {
  if (context.repoRootBusy.value > 0 || state.cancelled) return false;
  state.releaseRepoRoot = chainRepoRoot(context).release;
  state.repoRootParked = false;
  return true;
}

export function chainRepoRoot(context: SchedulingContext): { previous: Promise<void>; release: () => void } {
  const previous = context.repoRootTail.value;
  let resolve: () => void = () => undefined;
  context.repoRootTail.value = new Promise<void>((r) => {
    resolve = r;
  });
  context.repoRootBusy.value += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    context.repoRootBusy.value -= 1;
    resolve();
  };
  return { previous, release };
}

export async function resumeRepoRoot(context: SchedulingContext, runId: string, state: SchedulingActiveRun): Promise<boolean> {
  context.store.appendEvent(runId, {
    type: 'note',
    stepId: state.currentStepId,
    message: 'resuming — waiting for exclusive access to the repository working tree',
  });
  try {
    const acquired = await acquireRepoRoot(context, runId, state);
    if (acquired) state.repoRootParked = false;
    return acquired;
  } finally {
    state.repoRootResume = undefined;
  }
}

export async function acquireRepoRoot(context: SchedulingContext, runId: string, state: SchedulingActiveRun): Promise<boolean> {
  // `cancel()` can land between the run going `running` and reaching here,
  // while `interrupt` is still the default no-op — never enter the chain.
  if (state.cancelled) return false;
  const { previous, release } = chainRepoRoot(context);
  // Until `previous` resolves this run does not own the tree yet, so a drop
  // during the wait must not hand the tree to the next waiter — chain our
  // release behind `previous` instead of resolving the tail early.
  state.releaseRepoRoot = () => {
    void previous.then(release);
  };
  let abort: () => void = () => undefined;
  const cancelled = new Promise<void>((resolve) => {
    abort = resolve;
  });
  const parked = state.interrupt;
  state.interrupt = () => {
    parked();
    abort();
  };
  context.waiting.add(runId);
  context.releaseSlot();
  try {
    await Promise.race([previous, cancelled]);
  } finally {
    state.interrupt = parked;
    context.waiting.delete(runId);
  }
  if (state.cancelled) return false;
  state.releaseRepoRoot = release;
  return true;
}

export async function startNow(context: SchedulingContext, runId: string): Promise<'started' | 'not-queued' | 'held'> {
  if (!context.queue.includes(runId)) return 'not-queued';
  const holds = context.semaphore.accountHolds();
  const run = context.store.getRun(runId);
  if (run && (holds.deadline.size > 0 || holds.inFlight.size > 0)) {
    const { defaultRunner } = await loadConfig(context.repoRoot);
    if (context.policy.accountHeldFor(run, holds, defaultRunner ?? 'claude')) return 'held';
  }
  // The config read above awaited — the run may have started or been cancelled meanwhile.
  if (!context.queue.includes(runId)) return 'not-queued';
  context.startNowRequested.add(runId);
  void context.pump();
  return 'started';
}

export function sweepLimits(context: SchedulingContext, now: number = Date.now()): void {
  const elapsed = Math.max(0, Math.min(now - context.lastLimitTick.value, 5 * 60_000));
  context.lastLimitTick.value = now;
  if (elapsed > 0) {
    for (const run of context.store.listRuns()) {
      if (run.status === 'running') {
        context.store.updateRun(run.id, { limitUsage: { wallMs: (run.limitUsage?.wallMs ?? 0) + elapsed } });
      }
    }
  }
  const runs = context.store.listRuns();
  for (const run of runs) {
    if (isTerminalStatus(run.status)) continue;
    const hit = evaluateLimits(run, runs);
    if (hit) stopForLimit(context, run.id, hit);
  }
}

export function stopForLimit(context: SchedulingContext, runId: string, hit: LimitHit): void {
  const run = context.store.getRun(runId);
  if (!run || isTerminalStatus(run.status)) return;
  const targetId = hit.scope === 'tree' ? (run.dispatch?.rootRunId ?? runId) : runId;
  const message = `stopped — ${describeHit(hit)}. The worktree and session are kept; Continue to raise the ceiling.`;
  for (const member of subtreeOf(context.store.listRuns(), targetId)) {
    if (isTerminalStatus(member.status)) continue;
    context.store.updateRun(member.id, { limitHit: hit, error: describeHit(hit) });
    context.store.appendEvent(member.id, { type: 'lifecycle', message, tone: 'danger' });
  }
  context.cancel(targetId);
}

export function raiseAfterLimit(context: SchedulingContext, run: RunRecord): void {
  const hit = run.limitHit;
  if (!hit) return;
  context.store.updateRun(run.id, { limits: raiseLimits(run.limits, hit), limitHit: undefined, error: undefined });
  const rootId = run.dispatch?.rootRunId;
  const root = rootId && rootId !== run.id ? context.store.getRun(rootId) : undefined;
  if (root && hit.scope === 'tree') {
    context.store.updateRun(root.id, { limits: raiseLimits(root.limits, hit), limitHit: undefined, error: undefined });
  }
  context.store.appendEvent(run.id, { type: 'lifecycle', message: `ceiling raised after: ${describeHit(hit)}` });
}
