import { existsSync } from 'node:fs';
import { DEFAULT_AGENT_PERMISSION_LEVEL, REPORT_FILES_MAX, rosterWorkerKey, type AgentPermissionLevel, type DispatchInput, type DispatchReport } from '@onni/contract';
import { effectiveAntigravityLevel } from '../../core/antigravity-permissions.ts';
import { autosaveCommit, worktreeChangedFilesReadOnly, worktreeHeadShort } from '../../git-worktree.ts';
import { composeDispatchPrompt } from '../../dispatch/prompts.ts';
import { formatBudgetLine } from '../../dispatch/budget-format.ts';
import { requireRootManager } from '../../dispatch/access.ts';
import { appendLedger, notesSuggestions, readPlan, seedNotes, taskPaths, treeEnvelopeLines, writeBrief, writeInboxMessage, writeOrder, writeReport } from '../../dispatch/tree-fs.ts';
import { MAX_CHILDREN_IN_FLIGHT, childSettleReport, childTaskEnvelope, childrenOf, dispatchDepth, handoffSectionExcerpt, inFlightChildren, isTerminalStatus, IN_FLIGHT_STATUSES, remainingBudgetUsd, usd, withPendingReport } from '../../dispatch/engine.ts';
import { resolveWorker, workersInFlight } from '../manager-worker.ts';
import { carveChildLimits } from '../limits.ts';
import { readHandoff } from '../../handoff.ts';
import { loadWorkspaceConfig } from '../../workspace/config.ts';
import type { RunnerId } from '../../core/agent-runner.ts';
import type { WorkflowDef } from '../types.ts';
import type { RunRecord } from '../../runs/store.ts';
import type { DispatchContext, RedirectDispatchOrigin } from './internal-types.ts';
import type { PastedContent } from './preparation.ts';

/**
 * Where a queued run stands on its `--after` siblings: `ready` (none, or all finished well),
 * `waiting` (at least one still going) or `blocked` (one failed or was cancelled, or vanished).
 */
export function dependencyState(context: DispatchContext, run: RunRecord): 'ready' | 'waiting' | 'blocked' {
  const after = run.dispatch?.after;
  if (!after?.length) return 'ready';
  let waiting = false;
  for (const id of after) {
    const dep = context.store.getRun(id);
    if (!dep || dep.status === 'failed' || dep.status === 'cancelled') return 'blocked';
    if (dep.status !== 'done' && dep.status !== 'review') waiting = true;
  }
  return waiting ? 'waiting' : 'ready';
}

/**
 * Who fires a blocked dependent? Nothing else does: a run queued behind a failed sibling would
 * sit in the queue forever. Cancel it with the reason, which reaches the parent as a `blocked`
 * report (the cancel path of `cancelOne`), so the manager hears why instead of waiting.
 */
export function blockOrphanedDependents(context: DispatchContext): void {
  for (const id of [...context.queue]) {
    const run = context.store.getRun(id);
    if (run && (run.dispatch?.after ?? []).some((afterId) => context.redirecting.has(afterId))) continue;
    if (!run || dependencyState(context, run) !== 'blocked') continue;
    const failed = (run.dispatch?.after ?? [])
      .map((depId) => context.store.getRun(depId))
      .find((dep) => !dep || dep.status === 'failed' || dep.status === 'cancelled');
    context.store.updateRun(id, {
      error: `blocked: the order it was waiting for ("${failed?.title ?? 'a removed order'}") ${failed?.status ?? 'is gone'}, so it never started`,
    });
    context.cancelOne(id);
  }
}

/** Refresh the human-readable dependency line and fork point before a queued child starts. */
export function refreshQueuedDependencyEnvelope(context: DispatchContext, run: RunRecord): void {
  const dispatch = run.dispatch;
  if (run.status !== 'queued' || !dispatch?.after?.length) return;
  const afterRuns = dispatch.after.map((id) => context.store.getRun(id));
  const line = `- Starts after: ${dispatch.after.map((id, index) => {
    const dependency = afterRuns[index];
    return `${dependency?.title ?? id} (${id.slice(0, 8)}${dependency?.branch ? `, branch ${dependency.branch}` : ''})`;
  }).join(', ')} — onni holds you queued until they have finished successfully`;
  const taskLines = run.task.split('\n');
  const startsAfter = taskLines.findIndex((candidate) => candidate.startsWith('- Starts after: '));
  if (startsAfter >= 0) taskLines[startsAfter] = line;
  else {
    const orderedBy = taskLines.findIndex((candidate) => candidate.startsWith('- Ordered by: '));
    taskLines.splice(orderedBy >= 0 ? orderedBy : taskLines.length, 0, line);
  }
  const task = taskLines.join('\n');
  const parentBranch = context.store.getRun(dispatch.parentRunId ?? '')?.branch;
  const baseBranch = afterRuns[0]?.branch ?? parentBranch;
  if (task === run.task && baseBranch === run.baseBranch) return;
  context.store.updateRun(run.id, { task, baseBranch });
  const job = context.pendingJobs.get(run.id);
  if (job) job.input.task = task;
  try {
    writeOrder(context.dataDir, dispatch.rootRunId, run.id, {
      title: run.title,
      kind: dispatch.order?.kind ?? dispatch.kind ?? 'implement',
      parentRunId: dispatch.parentRunId ?? dispatch.rootRunId,
      text: task,
    });
  } catch {
    // Queued run state remains authoritative if the optional tree file channel is unavailable.
  }
}

/** Whether the roster entry a queued worker occupies already runs its `maxConcurrent` tasks. */
export function workerEntryFull(context: DispatchContext, queued: RunRecord): boolean {
  const key = queued.dispatch?.workerKey;
  const rootId = queued.dispatch?.rootRunId;
  if (!key || !rootId) return false;
  const runs = context.store.listRuns();
  const entry = runs.find((r) => r.id === rootId)?.roster?.workers.find((w) => `${w.runner}:${w.model ?? ''}` === key);
  if (!entry) return false;
  const live = (id: string) => id !== queued.id && (context.active.has(id) || context.starting.has(id));
  return workersInFlight(runs, rootId, key, live) >= entry.maxConcurrent;
}

/**
 * The agent-facing entry to `dispatch()` (the route): first commit the parent's uncommitted work
 * so the child forks from it, independent of `ONNI_AUTOSAVE`. If that commit cannot be made the
 * dispatch is refused — a child must never fork silently from an older commit.
 */
export async function dispatchFromAgent(context: DispatchContext, parentId: string, input: DispatchInput): Promise<{ id: string; branch?: string } | { refused: string }> {
  const parent = context.store.getRun(parentId);
  // `--part` (plan v2 §10): validated BEFORE anything is created, so a typo cannot leave an
  // orphan worker whose part the plan never learned about. Marked assigned after the child id
  // exists; the assignment is a second write, never a reason to refuse a started worker.
  if (parent && input.partId !== undefined) {
    const access = requireRootManager(parent, 'assign a plan part');
    const read = access.ok ? await readPlan(context.dataDir, parent.id) : undefined;
    const part = read?.plan.parts.find((candidate) => candidate.id === input.partId);
    const refused = !access.ok
      ? access.denied
      : !read || read.corrupt
        ? 'the tree plan could not be read — rewrite it with `onni task plan set` before using --part'
        : !part
          ? `plan part "${input.partId}" does not exist — add it with \`onni task plan set\`, or dispatch without --part`
          : part.status === 'done' || part.status === 'dropped'
            ? `plan part "${input.partId}" is ${part.status} — add a new part instead of reusing it`
            : undefined;
    if (refused) {
      context.store.appendEvent(parentId, { type: 'note', stepId: context.active.get(parentId)?.currentStepId, message: `dispatch refused — ${refused}`, tone: 'danger' });
      return { refused };
    }
  }
  if (parent?.worktreePath && parent.branch && existsSync(parent.worktreePath) && context.dispatchEnabled()) {
    const saved = await autosaveCommit(parent.worktreePath, 'wip before dispatch');
    if (saved === 'refused' || saved === 'failed') {
      const refused = saved === 'refused'
        ? 'your worktree is mid-merge or still has conflict markers, so it could not be committed before forking — resolve the conflict (or git merge --abort), commit, then dispatch again'
        : 'your uncommitted work could not be committed before forking (git commit failed) — run `git add -A && git commit -m wip` yourself, then dispatch again';
      context.store.appendEvent(parentId, { type: 'note', stepId: context.active.get(parentId)?.currentStepId, message: `dispatch refused — ${refused}`, tone: 'danger' });
      return { refused };
    }
  }
  // Fresh config each call (plan v2 §6.3): a permission change made mid-task reaches the next order.
  // A child always runs unattended, so the level is the effective one, never raw `bypass`.
  const config = await loadWorkspaceConfig().catch(() => null);
  const configured = config?.agentPermissions.antigravity ?? DEFAULT_AGENT_PERMISSION_LEVEL;
  const outcome = dispatch(context, parentId, input, { antigravityLevel: effectiveAntigravityLevel(configured, true).level });
  if (!('refused' in outcome) && parent && input.partId !== undefined) {
    await context.assignPlanPart(parent.id, input.partId, outcome.id);
  }
  return outcome;
}

/**
 * `POST /runs/:id/dispatch` — create ONE child of `parentId` (spec 2026-09-10-dispatch), usually
 * called by the parent's own agent through `onni task create`.
   *
 * Every refusal is a transcript note on the parent and NO state change — the caller gets the
 * reason back as the route's 409 body. A parent that had no `dispatch` record becomes a root the
 * first time it dispatches: its tree directory is created and its brief written from its own
 * task text. The child forks its worktree off the parent's branch, inherits runner and model
 * unless the order names others (a model only on the runner it was picked for), gets a budget
 * carved out of the parent's, and always runs autonomously — a child parked at `waiting` after
 * every turn would need a human per rung.
 */
export function dispatch(
  context: DispatchContext,
  parentId: string,
  input: DispatchInput,
  opts: {
    workflow?: WorkflowDef;
    antigravityLevel?: AgentPermissionLevel;
    redirectOrigin?: RedirectDispatchOrigin;
    preflightOnly?: boolean;
  } = {},
): { id: string; branch?: string } | { refused: string } {
  if (!context.dispatchEnabled()) return { refused: 'dispatch is disabled on this cockpit (ONNI_DISPATCH=0) — the operator turned it off. Do not substitute sub-agents or do the delegated work yourself: stop and report that dispatch is disabled.' };
  const parent = context.store.getRun(parentId);
  if (!parent) return { refused: `no such run: ${parentId}` };
  if (isTerminalStatus(parent.status)) return { refused: `run ${parentId} has already settled (${parent.status})` };
  const note = (message: string, tone?: 'danger') =>
    context.store.appendEvent(parentId, { type: 'note', stepId: context.active.get(parentId)?.currentStepId, message, ...(tone ? { tone } : {}) });

  const runs = context.store.listRuns();
  // Manager–worker (docs/design/manager-worker.md): the roster lives on the tree's ROOT and is
  // the only list of backends this tree may dispatch to. Checked here, the one place the route
  // and the graph node both pass through, so a prompt that is ignored changes nothing.
  const rootRunId0 = parent.dispatch?.rootRunId ?? parent.id;
  const roster = runs.find((r) => r.id === rootRunId0)?.roster;
  let worker: ReturnType<typeof resolveWorker> | undefined;
  const namedBackend = input.backend ?? input.runner;
  if (input.backend && input.runner && input.backend !== input.runner) {
    const refused = `--backend ${input.backend} and --runner ${input.runner} disagree; use --backend`;
    note(`dispatch refused — ${refused}`, 'danger');
    return { refused };
  }
  if (roster) {
    worker = resolveWorker(roster, { runner: namedBackend, model: input.model });
    if ('refused' in worker) {
      note(`dispatch refused — ${worker.refused}`, 'danger');
      return { refused: worker.refused };
    }
  }
  // The user's limits, when the root was started with the composer's Dispatch toggle: they may
  // only tighten the engine's own caps, and the child defaults they name fill an order's gaps.
  const intent = runs.find((r) => r.id === (parent.dispatch?.rootRunId ?? parent.id))?.dispatch?.intent;
  const inFlightCap = Math.min(MAX_CHILDREN_IN_FLIGHT, intent?.inFlight ?? MAX_CHILDREN_IN_FLIGHT);
  const inFlight = inFlightChildren(runs, parentId)
    .filter((run) => run.id !== opts.redirectOrigin?.sourceRunId)
    .length;
  if (inFlight + 1 > inFlightCap) {
    const refused = `${inFlight} child run${inFlight === 1 ? '' : 's'} already in flight; the cap is ${inFlightCap} per task${intent?.inFlight !== undefined && intent.inFlight < MAX_CHILDREN_IN_FLIGHT ? ' (set by the user)' : ''}. Wait for reports, then dispatch again.`;
    note(`dispatch refused — ${refused}`, 'danger');
    return { refused };
  }
  // Structural brakes (docs/design/unattended-safety.md §4): on in every limits mode.
  const safety = context.semaphore.safety();
  const depth = dispatchDepth(runs, parent);
  if (depth + 1 > safety.dispatchMaxDepth) {
    const refused = `dispatch depth is capped at ${safety.dispatchMaxDepth} — a task at depth ${depth} cannot dispatch further. Do the work yourself and report.`;
    note(`dispatch refused — ${refused}`, 'danger');
    return { refused };
  }
  // The user's cap when the root was started with one, else the workspace default: a tree
  // without an `intent` is still bounded.
  const subtaskCap = intent?.maxSubtasks ?? safety.dispatchMaxSubtasks;
  // The workspace switch lifts only the default counter; a cap the user set on this task stays.
  if (intent?.maxSubtasks !== undefined || !safety.dispatchUnlimitedSubtasks) {
    const rootId = parent.dispatch?.rootRunId ?? parent.id;
    const total = runs.filter((r) => r.dispatch?.rootRunId === rootId && r.id !== rootId).length;
    if (total + 1 > subtaskCap) {
      const refused = `this tree already has ${total} subtask${total === 1 ? '' : 's'}; ${intent?.maxSubtasks !== undefined ? `the user capped it at ${subtaskCap}` : `the cap is ${subtaskCap}`}. Finish with what exists and report. If complex work remains, do not do it yourself: tell the user the worker-call limit is spent and that "Unlimited worker calls" (Settings → Resources → Advanced) lifts it.`;
      note(`dispatch refused — ${refused}`, 'danger');
      return { refused };
    }
  }
  // `retry_limit`: how many times the SAME order (same title under this parent) may be tried
  // again after it failed or was cancelled. An order may only lower the workspace ceiling.
  const orderTitle = input.title ?? input.objective.split('\n')[0]?.slice(0, 120) ?? 'dispatched task';
  const retryLimit = Math.min(input.retry_limit ?? safety.dispatchRetryLimit, safety.dispatchRetryLimit);
  const failedTries = childrenOf(runs, parentId).filter((r) =>
    r.id !== opts.redirectOrigin?.sourceRunId
    && r.dispatch?.redirectOperation === undefined
    && r.title === orderTitle
    && (r.status === 'failed' || r.status === 'cancelled'),
  ).length;
  if (failedTries > retryLimit) {
    const refused = `"${orderTitle}" already failed ${failedTries} time${failedTries === 1 ? '' : 's'}; its retry limit is ${retryLimit}. Report the failure instead of dispatching it again.`;
    note(`dispatch refused — ${refused}`, 'danger');
    return { refused };
  }

  // Never run the same order twice at once: a manager that re-sends a title whose worker is still
  // queued or working would pay for the same part twice and give two branches one scope.
  // Only an order the agent NAMED (--title) and only from an agent: graph nodes legitimately fan out
  // identical, untitled children.
  const duplicate = input.title !== undefined && !opts.workflow
    ? childrenOf(runs, parentId).find((r) =>
        r.id !== opts.redirectOrigin?.sourceRunId
        && r.title === orderTitle
        && IN_FLIGHT_STATUSES.includes(r.status),
      )
    : undefined;
  if (duplicate) {
    const refused = `"${orderTitle}" is already ${duplicate.status === 'queued' ? 'queued' : 'running'} as ${duplicate.id.slice(0, 8)}. Wait for its report instead of dispatching it again.`;
    note(`dispatch refused — ${refused}`, 'danger');
    return { refused };
  }

  // `after`: resolve each named sibling now, so a typo is a refusal with the valid names rather
  // than a worker that waits forever. Only EXISTING siblings can be named, so no cycle can form.
  const afterIds: string[] = [];
  if (input.after?.length) {
    const siblings = childrenOf(runs, parentId);
    for (const ref of input.after) {
      const dep = siblings.find((r) => r.id === ref || r.id.startsWith(ref) && ref.length >= 6) ?? siblings.find((r) => r.title === ref);
      if (!dep) {
        const known = siblings.map((r) => `"${r.title}" (${r.id.slice(0, 8)})`).join(', ') || 'none yet';
        const refused = `--after "${ref}" names no order of yours. Orders so far: ${known}. Dispatch the earlier order first.`;
        note(`dispatch refused — ${refused}`, 'danger');
        return { refused };
      }
      if (dep.status === 'failed' || dep.status === 'cancelled') {
        const refused = `--after "${ref}": that order already ${dep.status}, so this one could never start. Fix or re-dispatch it first.`;
        note(`dispatch refused — ${refused}`, 'danger');
        return { refused };
      }
      if (!afterIds.includes(dep.id)) afterIds.push(dep.id);
    }
  }

  // The parent becomes a root on its first dispatch; a dispatched parent keeps its tree.
  const rootRunId = parent.dispatch?.rootRunId ?? parent.id;
  const startsRootTree = parent.id === rootRunId
    && !runs.some((run) => run.id !== rootRunId && run.dispatch?.rootRunId === rootRunId);
  if (!parent.dispatch) {
    context.store.updateRun(parentId, { dispatch: { rootRunId } });
  }

  const budgetRuns = opts.preflightOnly && opts.redirectOrigin
    ? runs.map((run) => run.id === opts.redirectOrigin!.sourceRunId ? { ...run, status: 'cancelled' as const } : run)
    : runs;
  const budget = carveChildBudget(context.store.getRun(parentId) ?? parent, budgetRuns, input.max_cost ?? intent?.budgetUsd);
  if ('refused' in budget) {
    note(`dispatch refused — ${budget.refused}`, 'danger');
    return { refused: budget.refused };
  }

  const title = input.title ?? input.objective.split('\n')[0]?.slice(0, 120) ?? 'dispatched task';
  const workflow: WorkflowDef = {
    name: '(planned)',
    source: 'built-in',
    steps: [
      {
        id: 'task',
        name: title,
        prompt: '{{task}}',
        // The order's own tool list when it names one (#430: `allowedTools` is the only tool
        // seam a step has), else the run-wide default.
        ...(input.allowed_tools?.length ? { allowedTools: input.allowed_tools } : {}),
      },
    ],
  };
  const childRunner = worker && 'ok' in worker ? worker.runner : namedBackend ?? intent?.runner ?? parent.runner;
  // An inherited model only follows its own runner: a codex parent's `gpt-*` handed to a
  // `--runner claude` child fails at spawn (telemetry 43bdda11). Otherwise the child's runner picks.
  const sameRunner = (runner: RunnerId | undefined) => (runner ?? 'claude') === (childRunner ?? 'claude');
  const childModel = (worker && 'ok' in worker ? worker.model : undefined) ?? input.model
    ?? (intent?.model && sameRunner(intent.runner ?? parent.runner) ? intent.model : undefined)
    ?? (parent.model && sameRunner(parent.runner) ? parent.model : undefined);
  // Soft warning (plan v2 §6.3): advisory only, never a refusal — the manager may still have a
  // reason, and the worker's own report is what settles it. Graph nodes pass no level, so a
  // workflow child never warns.
  if (
    !opts.preflightOnly
    &&
    opts.antigravityLevel === 'files-only'
    && childRunner === 'antigravity'
    && context.verificationAskMatches([input.objective, input.success_criteria, input.required_evidence].filter(Boolean).join('\n'))
  ) {
    note('warning — this worker cannot run shell commands (files-only); the order asks for verification it cannot perform. Give it to another worker or raise its permission level.');
  }
  if (opts.preflightOnly) return { id: '' };
  const record = context.startRun(opts.workflow ?? workflow, {
    // The tree directory lines are composed against the id the run is ABOUT to get: `startRun`
    // mints it, so the envelope is finished below once it exists.
    task: childTaskEnvelope(
      afterIds.length ? { ...input, after: afterIds.map((id) => { const dep = runs.find((r) => r.id === id); return `${dep?.title ?? id} (${id.slice(0, 8)}${dep?.branch ? `, branch ${dep.branch}` : ''})`; }) } : input,
      { id: parentId, branch: parent.branch },
      ['{{TREE_PATHS}}'],
    ),
    // In a roster tree the worker brief comes from `prepareDispatchSession` (report-only); the
    // general dispatch prompt would teach a worker to dispatch.
    systemPrompt: roster ? undefined : composeDispatchPrompt(input.kind),
    ...(context.deferredBindingActive(parent, runs) ? { deferredBinding: parent.deferredBinding } : {}),
    runner: childRunner,
    ...(childModel ? { model: childModel } : {}),
    autonomous: true,
    // The parent's mode, with each ceiling carved from what its subtree has left: a child is
    // never looser than its parent, whatever the agent's order asked for.
    limitsSnapshot: carveChildLimits(context.store.getRun(parentId) ?? parent, runs, input.max_cost !== undefined ? { maxCostUsd: input.max_cost } : undefined),
    dispatch: {
      rootRunId,
      parentRunId: parentId,
      ...(worker && 'ok' in worker ? { workerKey: worker.key } : {}),
      ...(input.kind && input.kind !== 'implement' ? { kind: input.kind } : {}),
      ...(input.review_of?.length ? { reviewOf: input.review_of } : {}),
      ...(input.scope ? { scope: input.scope } : {}),
      ...(afterIds.length ? { after: afterIds } : {}),
      ...(budget.budgetUsd !== undefined ? { budgetUsd: budget.budgetUsd } : {}),
      ...(opts.redirectOrigin ? { redirectedFrom: opts.redirectOrigin.sourceRunId } : {}),
      order: {
        objective: opts.redirectOrigin?.canonicalOrder.objective ?? input.objective,
        ...(opts.redirectOrigin ? { redirectInstruction: opts.redirectOrigin.instruction } : {}),
        title,
        kind: input.kind ?? 'implement',
        ...(input.scope !== undefined ? { scope: input.scope } : {}),
        ...(input.allowed_tools !== undefined ? { allowedTools: input.allowed_tools } : {}),
        ...(input.max_cost !== undefined ? { maxCost: input.max_cost } : {}),
        ...(input.success_criteria !== undefined ? { successCriteria: input.success_criteria } : {}),
        ...(input.required_evidence !== undefined ? { requiredEvidence: input.required_evidence } : {}),
        retryLimit,
        backend: childRunner ?? 'claude',
        ...(childModel !== undefined ? { model: childModel } : {}),
        ...(worker && 'ok' in worker ? { workerKey: worker.key } : {}),
        after: afterIds,
        ...(input.review_of !== undefined ? { reviewOf: input.review_of } : {}),
        ...(input.partId !== undefined ? { partId: input.partId } : {}),
      },
    },
  });
  // The task list shows the order's own title rather than the first line of the envelope, and
  // the child forks its worktree off the PARENT's branch: `execute()` prefers a recorded
  // `baseBranch` over the configured one, so seeding it is the whole of the change.
  // A run that waits for a sibling forks off THAT sibling's branch (which already contains the
  // parent's tip plus its work), so it starts on top of what it depended on. More than one
  // dependency: the first is the fork point and the order lists the rest to merge.
  const afterBranch = afterIds.length ? runs.find((r) => r.id === afterIds[0])?.branch : undefined;
  const forkPoint = afterBranch ?? parent.branch;
  context.store.updateRun(record.id, { title, ...(forkPoint ? { baseBranch: forkPoint } : {}) });
  const paths = taskPaths(context.dataDir, rootRunId, record.id);
  const task = (context.store.getRun(record.id)?.task ?? '').replace('{{TREE_PATHS}}', treeEnvelopeLines(paths).join('\n'));
  context.store.updateRun(record.id, { task });
  // `execute` reads the QUEUED job's input, not the record, so the finished envelope has to
  // reach both.
  const job = context.pendingJobs.get(record.id);
  if (job) job.input.task = task;
  try {
    writeBrief(context.dataDir, rootRunId, context.store.getRun(rootRunId)?.task ?? parent.task);
    writeOrder(context.dataDir, rootRunId, record.id, {
      title,
      kind: input.kind ?? 'implement',
      parentRunId: parentId,
      text: task,
    });
    seedNotes(context.dataDir, rootRunId, record.id, title);
  } catch {
    // written state, never required — a tree directory that cannot be written is a tree with no
    // file channel, not a refused dispatch
  }
  if (startsRootTree && roster) {
    appendLedger(context.dataDir, rootRunId, {
      type: 'roster',
      workers: roster.workers.map((entry) => ({
        key: rosterWorkerKey(entry),
        ...(entry.tier ? { tier: entry.tier } : {}),
        ...(entry.kinds?.length ? { kinds: entry.kinds } : {}),
        concurrency: entry.maxConcurrent,
      })),
    });
  }
  const selectedWorker = worker && 'ok' in worker ? worker.worker : undefined;
  appendLedger(context.dataDir, rootRunId, {
    type: 'dispatch',
    runId: record.id,
    parentRunId: parentId,
    kind: input.kind ?? 'implement',
    title,
    ...(selectedWorker ? { workerKey: rosterWorkerKey(selectedWorker) } : {}),
    ...(selectedWorker?.tier ? { workerTier: selectedWorker.tier } : {}),
    ...(selectedWorker?.kinds?.length ? { workerKinds: selectedWorker.kinds } : {}),
    ...(budget.budgetUsd !== undefined ? { budgetUsd: budget.budgetUsd } : {}),
  });
  const child = context.store.getRun(record.id) ?? record;
  note(`dispatched "${title}" (${input.kind ?? 'implement'}, ${record.id})${budget.budgetUsd !== undefined ? ` with ${usd(budget.budgetUsd)}` : ''}`);
  // This turn parks as a monitor for the child when it ends (see `handleDispatchTurn`).
  const state = context.active.get(parentId);
  if (state) state.dispatchedThisTurn = true;
  return { id: child.id, ...(child.branch ? { branch: child.branch } : {}) };
}

/**
 * `POST /runs/:id/report` — a dispatched task records its own report (the `onni task report`
 * CLI). Last one wins. Delivered to the parent when the run SETTLES, not now: the run is still
 * working, and its parent hears from it once, with the branch and the cost attached.
 */
export function recordReport(context: DispatchContext, runId: string, report: DispatchReport): boolean {
  if (!context.dispatchOf(runId)) return false;
  context.updateDispatch(runId, (current) => ({ ...current, report }));
  context.store.appendEvent(runId, {
    type: 'note',
    stepId: context.active.get(runId)?.currentStepId,
    message: `report recorded — status ${report.status}${report.verdict ? `, verdict ${report.verdict}` : ''}`,
  });
  return true;
}

/**
 * Carve one child's ceiling out of what the parent has left. A parent with no ceiling of its
 * own carves nothing: the child inherits whatever cap it named, or none. A child that names no
 * cost under a capped parent gets the whole remainder — one child at a time, there is nobody
 * to share it with.
 */
function carveChildBudget(parent: RunRecord, runs: readonly RunRecord[], maxCost: number | undefined): { budgetUsd: number | undefined } | { refused: string } {
  const remaining = remainingBudgetUsd(parent, childrenOf(runs, parent.id));
  if (remaining === undefined) return { budgetUsd: maxCost };
  if (remaining <= 0) {
    return {
      refused: `no budget left (${usd(parent.dispatch?.budgetUsd ?? 0)} allotted, ${usd(parent.costUsd ?? 0)} spent, the rest promised to children in flight). Report what has been achieved instead of shrinking the remaining work.`,
    };
  }
  if (maxCost !== undefined && maxCost > remaining) {
    return { refused: `the requested cap is ${usd(maxCost)} but only ${usd(remaining)} of the budget is left.` };
  }
  return { budgetUsd: maxCost ?? remaining };
}

/** Notify the parent after an explicit user action retires an unanswered child question. */
export function notifyQuestionRetired(context: DispatchContext, runId: string): void {
  void reportSettledChildToParent(context, runId);
}

/**
 * A child settled — tell its parent. Nothing else fires this: there is no process-exit callback
 * and no sub-agent-completion event, so a parent parked on `monitoring` waiting for children
 * would sit there until a human typed something. Hung off `dropActive` (and off the paths that
 * never reach it: the queued cancel, the restart settle).
   *
 * The report is PERSISTED first and always, then delivered down a ladder of four rungs — an
 * open session, a still-queued prompt stack, the starting-up buffer, and finally a fresh
 * continuation for a parent that has already finished.
 */
export async function reportSettledChildToParent(context: DispatchContext, runId: string): Promise<void> {
  try {
    const child = context.store.getRun(runId);
    const parentId = child?.dispatch?.parentRunId;
    if (!child || !parentId) return;
    if (!context.dispatchEnabled()) return;
    if (!isTerminalStatus(child.status)) return;
    const managerCancelled = child.dispatch?.managerCancellation !== undefined;
    // A closed session can leave an unanswered ONNI:ASK as terminal `failed` while the
    // question remains under the user's control (`awaitingAnswerSince`). That is a hold, not
    // an outcome: reporting it now would make the parent plan around work that may still be
    // resumed. The existing status transition that answers or explicitly retires the question
    // clears this field and reaches this hook again with the real outcome. A monitor handed
    // to the user carries the same marker but no pending question: its work is unfinished
    // and nobody is waiting on an answer the parent could pre-empt, so it reports.
    if (child.awaitingAnswerSince !== undefined && child.dispatch?.pendingAsk && !managerCancelled) return;
    const parent = context.store.getRun(parentId);
    if (!parent?.dispatch) return;

    const resumeNotes = handoffSectionExcerpt(readHandoff(context.dataDir, runId), '## Resume notes');
    const checks = child.dispatch?.report?.checks.map((check) => ({
      ...check,
      command: context.store.redactRunText(child.id, check.command),
    }));
    // In the TEXT, not composed at flush time, so a live delivery and a pending one agree (#8).
    const budget = context.dispatchBudgetFor(runId);
    const settleContext = {
      resumeNotes,
      ...(checks?.length ? { checks } : {}),
      ...(budget ? { budgetLine: `budget: ${formatBudgetLine(budget)}` } : {}),
    };
    const reportTitle = context.store.redactRunText(child.id, child.title).slice(0, 120);
    const redactReport = (report: DispatchReport): DispatchReport => ({
      ...report,
      result: context.store.redactRunText(child.id, report.result).slice(0, 4_000),
      evidence: report.evidence.map((item) => context.store.redactRunText(child.id, item).slice(0, 400)),
      side_effects: report.side_effects.map((item) => context.store.redactRunText(child.id, item).slice(0, 400)),
      errors: report.errors.map((item) => context.store.redactRunText(child.id, item).slice(0, 400)),
      checks: report.checks.map((check) => ({ ...check, command: context.store.redactRunText(child.id, check.command).slice(0, 300) })),
      suggestions: report.suggestions.map((item) => context.store.redactRunText(child.id, item).slice(0, 400)),
      ...(report.recommended_next_action !== undefined
        ? { recommended_next_action: context.store.redactRunText(child.id, report.recommended_next_action).slice(0, 1_000) }
        : {}),
    });
    const safeSettle = (settle: ReturnType<typeof childSettleReport>) => ({
      report: redactReport(settle.report),
      text: context.store.redactRunText(child.id, settle.text).slice(0, 6_000),
    });
    const base = safeSettle(childSettleReport(child, settleContext));
    // PERSISTED before any await below: `dropActive` calls this before `releaseSlot`, and the
    // pump reads the hold off the records (see the ordering comment there). The parent must
    // already see the outcome when a manager is woken, even if the git read is still running.
    const at = new Date().toISOString();
    context.updateDispatch(parentId, (dispatch) =>
      withPendingReport(dispatch, { fromRunId: child.id, title: reportTitle, report: base.report, at }),
    );
    const rootRunId = child.dispatch?.rootRunId ?? parent.dispatch.rootRunId;
    appendLedger(context.dataDir, rootRunId, {
      type: 'settle',
      runId: child.id,
      parentRunId: parentId,
      status: child.status,
      reportStatus: base.report.status,
      ...(child.costUsd !== undefined ? { costUsd: child.costUsd } : {}),
    });
    context.notifyTreeInboxes(rootRunId, child.id);
    // The delivery below is NOT user-authored, so it leaves no bubble in the parent's thread.
    context.store.appendEvent(parentId, {
      type: 'note',
      message: `report received from task "${reportTitle}" (${child.id}) — status ${base.report.status}`,
    });
    // Read-only and in parallel (#7), bounded by ONE timeout (H3): the worktree may be
    // reclaimed the moment this run leaves its active slot, so the file list and HEAD are
    // captured here. A slow or broken git call degrades to a line that says "not available" —
    // it never blocks or fails the report.
    const [files, headCommit] = child.worktreePath
      ? await Promise.all([
          worktreeChangedFilesReadOnly(child.worktreePath, child.baseBranch ?? 'HEAD', { max: REPORT_FILES_MAX }),
          worktreeHeadShort(child.worktreePath),
        ])
      : [undefined, undefined];
    const capturedFiles = managerCancelled && files
      ? {
          ...files,
          files: files.files.slice(0, 16),
          omitted: files.omitted + Math.max(0, files.files.length - 16),
        }
      : files;
    const settle = files || headCommit
      ? childSettleReport(child, {
          ...settleContext,
          ...(capturedFiles ? { changedFiles: capturedFiles.files, filesOmitted: capturedFiles.omitted, filesState: capturedFiles.state } : {}),
          ...(headCommit ? { headCommit } : {}),
        })
      : base;
    const safe = 'report' in settle && 'text' in settle ? safeSettle(settle) : base;
    const { text, report } = safe;
    context.updateDispatch(parentId, (dispatch) => ({
      ...dispatch,
      pendingReports: (dispatch.pendingReports ?? []).map((entry) =>
        entry.fromRunId === child.id && entry.at === at ? { ...entry, title: reportTitle, report } : entry,
      ),
    }));
    try {
      writeReport(context.dataDir, rootRunId, child.id, text, report);
      const suggestions = [...report.suggestions];
      const fromNotes = notesSuggestions(context.dataDir, rootRunId, child.id);
      if (fromNotes) suggestions.push(context.store.redactRunText(child.id, fromNotes).slice(0, 3_000));
      if (suggestions.length && child.id !== rootRunId) {
        writeInboxMessage(context.dataDir, rootRunId, 'root', {
          from: child.id,
          subject: `Suggestions from task "${reportTitle}"`,
          body: suggestions.map((line) => `- ${line}`).join('\n'),
        });
      }
    } catch {
      // written state, never required
    }

    // A graph `dispatch` node is awaiting exactly this child (1c): hand it the outcome directly —
    // cancelled included, so the node takes its `failed` port instead of waiting forever.
    const waiter = context.active.get(parentId)?.graphChildWaits?.get(child.id);
    if (waiter) {
      context.ackPendingReport(parentId, child.id, at);
      waiter({ status: child.status, summary: text });
      return;
    }

    // A CANCELLED child is persisted and nothing more: a cancel cascades children-first, so the
    // parent is already cancelled — or about to be — and every live rung below would fight that.
    if (child.status === 'cancelled' && !managerCancelled) return;

    const blocks: PastedContent[] = [{ type: 'text', text }];
    if (context.deliverMessage(parentId, blocks, false) || context.enqueueMessage(parentId, blocks)) {
      context.ackPendingReport(parentId, child.id, at);
      return;
    }
    if (context.deferMessage(parentId, blocks)) return;
    // `cancelled` is deliberately NOT continuable from a child's report: nothing a child says may
    // restart a task a human cancelled.
    if (['done', 'failed', 'review'].includes(parent.status)) {
      context.continueRun(parentId, { text }, true);
      // This now runs after `dropActive` released the slot and its pump swept, so the queue
      // entry above would otherwise sit until an unrelated event — the ordering the settle
      // hook used to guarantee by running before `releaseSlot`.
      void context.pump();
    }
  } catch {
    // A terminal transition must never fail over its bookkeeping. The pending report is already
    // on the record by the time anything below it can throw, so the parent still learns.
  }
}

/**
 * Cancel every descendant, deepest first: a cancelled parent whose children kept spending would
 * be a cost brake that does not brake. `seen` bounds the walk to each run once.
 */
export function cancelDescendants(context: DispatchContext, parentId: string, seen: Set<string>): void {
  if (!context.dispatchEnabled()) return;
  for (const child of childrenOf(context.store.listRuns(), parentId)) {
    if (seen.has(child.id)) continue;
    seen.add(child.id);
    cancelDescendants(context, child.id, seen);
    context.cancelOne(child.id);
  }
}
