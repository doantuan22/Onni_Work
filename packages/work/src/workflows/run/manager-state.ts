import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  MANAGER_ASK_RECORD_QUESTION_MAX_CHARS,
  PENDING_ASK_MAX_QUESTIONS,
  rosterWorkerKey,
  type ManagerAskInput,
  type ManagerAskResponse,
  type ManagerMemoryAdd,
  type ManagerMemoryPut,
  type ManagerMemoryRead,
  type TreePlan,
  type TreePlanPart,
  type TreePlanPatch,
  type TreePlanPut,
  type WebhookAttentionRequest,
} from '@onni/contract';
import type { AskRequest } from '../../core/ask.ts';
import { parseAskMarker } from '../../core/ask.ts';
import type { MergeInput } from '@onni/contract';
import { autosaveCommit, worktreeShortstat } from '../../git-worktree.ts';
import type { UiEventSink } from '../../runs/ui-event-sink.ts';
import type { RunRecord } from '../../runs/store.ts';
import { appendLedger, findPlanCycle, inboxDigest, inboxName, listInbox, patchPlanPart, readPlan, taskPaths, writeInboxMessage, writePlan } from '../../dispatch/tree-fs.ts';
import { requireRootManager, treeRootOf } from '../../dispatch/access.ts';
import { childrenOf, pendingReportsBlock, workerStatusBoard } from '../../dispatch/engine.ts';
import { appendManagerMemory, readManagerMemory as readMemory, sanitizeMemoryEntry, writeManagerMemory as writeMemory, type MemoryWriteResult } from '../../dispatch/memory.ts';
import { managerDoingComplexAlone, SOFT_ASK_EXPIRED_NUDGE } from '../manager-worker.ts';
import { runManagerMerge, type MergeOutcome } from '../manager-merge.ts';
import type { PastedContent } from './preparation.ts';
import type { DispatchTurnResult, ManagerStateActive, ManagerStateContext, ManagerStateTurnContext } from './internal-types.ts';

export function readManagerMemory(dataDir: string): Promise<ManagerMemoryRead> {
  return readMemory(dataDir);
}

export function writeManagerMemory(dataDir: string, input: ManagerMemoryPut): Promise<MemoryWriteResult> {
  return writeMemory(dataDir, input);
}

export async function addManagerMemory(
  context: ManagerStateContext,
  runId: string,
  input: ManagerMemoryAdd,
): Promise<ManagerMemoryRead | { denied: string; status: 400 | 403 | 404 | 409 }> {
  const run = context.store.getRun(runId);
  const access = requireRootManager(run, 'write project memory');
  if (!access.ok) return { denied: access.denied, status: access.status };
  if (!run) return { denied: `no such run: ${runId}`, status: 404 };
  const outcome = await appendManagerMemory(context.dataDir, input.entry, runId, (text) => context.store.redactRunText(runId, text));
  if (!outcome.ok) return { denied: outcome.error, status: outcome.status };
  appendLedger(context.dataDir, runId, {
    type: 'memory-add',
    runId,
    entry: outcome.entry,
    bytes: outcome.memory.bytes,
  });
  context.store.appendEvent(runId, {
    type: 'note',
    stepId: context.active.get(runId)?.currentStepId,
    message: `project memory: added one lesson (${outcome.memory.bytes}/${outcome.memory.maxBytes} bytes)`,
  });
  return outcome.memory;
}

export async function readTreePlan(
  context: ManagerStateContext,
  runId: string,
): Promise<TreePlan | { denied: string; status: 403 | 404 | 409 }> {
  const run = context.store.getRun(runId);
  const access = requireRootManager(run, 'read the tree plan');
  if (!access.ok) return { denied: access.denied, status: access.status };
  const read = await readPlan(context.dataDir, run!.id);
  if (read.corrupt) {
    context.store.appendEvent(runId, {
      type: 'note',
      stepId: context.active.get(runId)?.currentStepId,
      tone: 'danger',
      message: 'the tree plan could not be read and is being treated as empty — rewrite it with `onni task plan set`',
    });
  }
  return read.plan;
}

export async function writeTreePlan(
  context: ManagerStateContext,
  runId: string,
  input: TreePlanPut,
): Promise<TreePlan | { denied: string; status: 400 | 403 | 404 | 409 }> {
  const run = context.store.getRun(runId);
  const access = requireRootManager(run, 'write the tree plan');
  if (!access.ok) return { denied: access.denied, status: access.status };
  const normalized = normalizePlanParts(context, run!, input.parts);
  if ('denied' in normalized) return normalized;
  const outcome = await writePlan(context.dataDir, run!.id, { parts: normalized.parts, revision: input.revision });
  if (!outcome.ok) return { denied: outcome.error, status: 409 };
  appendLedger(context.dataDir, run!.id, {
    type: 'plan',
    action: 'put',
    parts: outcome.plan.parts.length,
    revision: outcome.plan.revision,
  });
  context.store.appendEvent(runId, {
    type: 'note',
    stepId: context.active.get(runId)?.currentStepId,
    message: `tree plan written: ${outcome.plan.parts.length} part${outcome.plan.parts.length === 1 ? '' : 's'}`,
  });
  return outcome.plan;
}

export async function patchTreePlanPart(
  context: ManagerStateContext,
  runId: string,
  partId: string,
  input: TreePlanPatch,
): Promise<TreePlan | { denied: string; status: 400 | 403 | 404 | 409 }> {
  const run = context.store.getRun(runId);
  const access = requireRootManager(run, 'update the tree plan');
  if (!access.ok) return { denied: access.denied, status: access.status };
  let runRef = input.runId;
  if (runRef !== undefined && runRef !== '') {
    const target = treeMember(context, run!, runRef);
    if (!target) return { denied: `run "${runRef}" is not part of this task tree`, status: 409 };
    runRef = target.id;
  }
  const outcome = await patchPlanPart(context.dataDir, run!.id, partId, {
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(runRef !== undefined ? { runId: runRef } : {}),
  });
  if (!outcome.ok) return { denied: outcome.error, status: outcome.status };
  appendLedger(context.dataDir, run!.id, {
    type: 'plan',
    action: 'patch',
    partId,
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(runRef !== undefined && runRef !== '' ? { runId: runRef } : {}),
  });
  context.store.appendEvent(runId, {
    type: 'note',
    stepId: context.active.get(runId)?.currentStepId,
    message: `plan part "${partId}"${input.status !== undefined ? ` → ${input.status}` : ''}${runRef ? ` (${runRef.slice(0, 8)})` : ''}`,
  });
  return outcome.plan;
}

/** A run of this manager's tree, by full id or by a 6+ character prefix. */
function treeMember(context: ManagerStateContext, root: RunRecord, ref: string): RunRecord | undefined {
  return context.store.listRuns().find((run) => treeRootOf(run) === root.id && (run.id === ref || (ref.length >= 6 && run.id.startsWith(ref))));
}

/** Server-side plan rules that the schema cannot express. */
function normalizePlanParts(
  context: ManagerStateContext,
  root: RunRecord,
  parts: TreePlanPart[],
): { parts: TreePlanPart[] } | { denied: string; status: 400 | 409 } {
  const workers = root.roster?.workers ?? [];
  const allowed = workers.map((worker) => rosterWorkerKey(worker)).join(', ') || 'none';
  const normalized: TreePlanPart[] = [];
  for (const part of parts) {
    if (part.worker !== undefined && !workers.some((worker) => rosterWorkerKey(worker) === part.worker || worker.runner === part.worker)) {
      return { denied: `worker "${part.worker}" is not in this task's roster — allowed workers: ${allowed}`, status: 400 };
    }
    let runId = part.runId;
    if (runId) {
      const target = treeMember(context, root, runId);
      if (!target) return { denied: `run "${runId}" is not part of this task tree`, status: 409 };
      runId = target.id;
    }
    const title = sanitizeMemoryEntry(part.title, (text) => context.store.redactRunText(root.id, text));
    if (!title) return { denied: `plan part "${part.id}" has an empty title after cleaning`, status: 400 };
    normalized.push({ ...part, title, ...(runId !== undefined ? { runId } : {}) });
  }
  const cycle = findPlanCycle(normalized);
  if (cycle) return { denied: `the plan has a cycle: ${cycle.join(' → ')}`, status: 400 };
  return { parts: normalized };
}

/** `--part` on a dispatch: the part becomes `assigned` with the child's id. */
export async function assignPlanPart(context: ManagerStateContext, rootRunId: string, partId: string, childRunId: string): Promise<void> {
  const outcome = await patchPlanPart(context.dataDir, rootRunId, partId, { status: 'assigned', runId: childRunId });
  const stepId = context.active.get(rootRunId)?.currentStepId;
  if (!outcome.ok) {
    context.store.appendEvent(rootRunId, {
      type: 'note',
      stepId,
      tone: 'danger',
      message: `dispatched ${childRunId.slice(0, 8)} but the tree plan could not be updated — ${outcome.error}`,
    });
    return;
  }
  appendLedger(context.dataDir, rootRunId, { type: 'plan', action: 'assign', partId, runId: childRunId });
  context.store.appendEvent(rootRunId, {
    type: 'note',
    stepId,
    message: `plan part "${partId}" → assigned (${childRunId.slice(0, 8)})`,
  });
}

export function askUser(
  context: ManagerStateContext,
  runId: string,
  input: ManagerAskInput,
): ManagerAskResponse | { denied: string; status: 403 | 404 | 409 } {
  const run = context.store.getRun(runId);
  const access = requireRootManager(run, 'ask the user');
  if (!access.ok) return { denied: access.denied, status: access.status };
  if (!run?.dispatch) return { denied: 'run is not part of a dispatch tree', status: 409 };
  if (run.status === 'done' || run.status === 'failed' || run.status === 'cancelled' || run.status === 'review') {
    return { denied: 'this task is not live — open it with Continue, then ask', status: 409 };
  }
  if (run.dispatch.pendingAsk || run.dispatch.softAsk) {
    return { denied: 'one open question per task — answer the current one first', status: 409 };
  }
  const requestId = randomUUID();
  const askedAt = new Date().toISOString();
  const expiresAt = input.timeoutMinutes !== undefined
    ? new Date(Date.now() + input.timeoutMinutes * 60_000).toISOString()
    : undefined;
  const options = input.options ?? [];
  context.makeUiSink(runId, context.active.get(runId)?.currentStepId ?? 'ask').handle({
    type: 'ask.requested',
    requestId,
    questions: [{
      header: 'Question from the manager',
      question: input.question,
      options: options.map((option) => ({
        label: option.label,
        ...(option.description !== undefined ? { description: option.description } : {}),
      })),
    }],
    source: 'manager',
  });
  context.updateDispatch(runId, (current) => ({
    ...current,
    softAsk: {
      requestId,
      askedAt,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      question: input.question.slice(0, MANAGER_ASK_RECORD_QUESTION_MAX_CHARS),
      optionCount: options.length,
    },
  }));
  armSoftAskTimer(context, runId, expiresAt);
  try {
    appendLedger(context.dataDir, run.dispatch.rootRunId, {
      type: 'manager-ask',
      runId,
      requestId,
      question: input.question.slice(0, MANAGER_ASK_RECORD_QUESTION_MAX_CHARS),
      optionCount: options.length,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    });
  } catch {
    // best effort — the record carries the question either way
  }
  context.store.appendEvent(runId, {
    type: 'note',
    stepId: context.active.get(runId)?.currentStepId,
    message: expiresAt !== undefined
      ? `asked you: "${input.question}" — the manager keeps working until you answer or ${expiresAt} passes`
      : `asked you: "${input.question}" — the manager keeps working until you answer`,
  });
  return { requestId };
}

export function softAskFor(context: ManagerStateContext, runId: string, requestId: string | undefined): import('@onni/contract').RunDispatch['softAsk'] {
  if (requestId === undefined) return undefined;
  const soft = context.store.getRun(runId)?.dispatch?.softAsk;
  return soft?.requestId === requestId ? soft : undefined;
}

export function clearSoftAsk(context: ManagerStateContext, runId: string): void {
  const timer = context.softAskTimers.get(runId);
  if (timer) clearTimeout(timer);
  context.softAskTimers.delete(runId);
  if (!context.store.getRun(runId)?.dispatch?.softAsk) return;
  context.updateDispatch(runId, ({ softAsk: _answered, ...rest }) => rest);
}

export function armSoftAskTimer(context: ManagerStateContext, runId: string, expiresAt: string | undefined): void {
  const prior = context.softAskTimers.get(runId);
  if (prior) clearTimeout(prior);
  context.softAskTimers.delete(runId);
  if (expiresAt === undefined) return;
  const delay = Math.max(0, Date.parse(expiresAt) - Date.now());
  const timer = setTimeout(() => {
    context.softAskTimers.delete(runId);
    expireSoftAsk(context, runId);
  }, delay);
  timer.unref?.();
  context.softAskTimers.set(runId, timer);
}

export function expireSoftAsk(context: ManagerStateContext, runId: string): void {
  const soft = context.store.getRun(runId)?.dispatch?.softAsk;
  if (!soft) return;
  context.store.appendEvent(runId, {
    type: 'note',
    message: `no answer to "${soft.question}" by its deadline`,
  });
  const state = context.active.get(runId);
  // A delivery retires the Guard's `pendingAsk`, so nudging here while one is open would answer a question the user never saw answered.
  if (!state || state.cancelled || !state.session?.open || context.store.getRun(runId)?.dispatch?.pendingAsk) return;
  clearSoftAsk(context, runId);
  context.deliverMessage(runId, [{ type: 'text', text: SOFT_ASK_EXPIRED_NUDGE }], false);
}

export function recoverSoftAsks(context: ManagerStateContext): void {
  for (const run of context.store.listRuns()) {
    const soft = run.dispatch?.softAsk;
    if (!soft) continue;
    if (soft.expiresAt !== undefined && Date.parse(soft.expiresAt) <= Date.now()) expireSoftAsk(context, run.id);
    else armSoftAskTimer(context, run.id, soft.expiresAt);
  }
}

export function flushPendingReports(context: ManagerStateContext, runId: string): string | undefined {
  const dispatch = context.dispatchOf(runId);
  const pending = dispatch?.pendingReports;
  if (!dispatch || !pending?.length) return undefined;
  const { pendingReports: _flushed, ...rest } = dispatch;
  context.store.updateRun(runId, { dispatch: rest });
  const block = pendingReportsBlock(pending);
  const board = workerStatusBoard(context.store.listRuns(), dispatch.rootRunId);
  return board && block ? `${block}\n\n${board}` : block;
}

export function ackPendingReport(context: ManagerStateContext, runId: string, fromRunId: string, at: string): void {
  const dispatch = context.store.getRun(runId)?.dispatch;
  const pending = dispatch?.pendingReports;
  if (!dispatch || !pending?.length) return;
  const kept = pending.filter((entry) => entry.fromRunId !== fromRunId || entry.at !== at);
  if (kept.length === pending.length) return;
  const { pendingReports: _acked, ...rest } = dispatch;
  context.store.updateRun(runId, { dispatch: kept.length ? { ...rest, pendingReports: kept } : rest });
}

export function handleDispatchTurn(
  context: ManagerStateContext,
  runId: string,
  turnText: string,
  ctx: ManagerStateTurnContext,
): DispatchTurnResult {
  const idle: DispatchTurnResult = { hasDispatch: false, dispatched: false, overBudget: false, rePrompted: false };
  const dispatch = context.dispatchOf(runId);
  const dispatched = Boolean(ctx.state.dispatchedThisTurn);
  ctx.state.dispatchedThisTurn = false;
  // Before the no-dispatch early return: a manager that never dispatched is exactly the case.
  void checkManagerComplexity(context, runId, ctx);
  if (!dispatch) return idle;
  if (ctx.done) return { hasDispatch: true, dispatched: false, overBudget: false, rePrompted: false };
  const note = (message: string, tone?: 'danger') =>
    context.store.appendEvent(runId, { type: 'note', stepId: ctx.stepId, message, ...(tone ? { tone } : {}) });
  const overBudget = context.enforceDispatchBudget(runId, note);
  const rePrompted = !dispatched && !overBudget && deliverOwnInbox(context, runId, ctx.state, ctx.stepId, turnText);
  // The filesystem channel's SIGNAL: this turn may have written into a sibling's or the root's inbox.
  notifyTreeInboxes(context, dispatch.rootRunId, runId);
  return { hasDispatch: true, dispatched, overBudget, rePrompted };
}

export async function mergeFromAgent(
  context: ManagerStateContext,
  runId: string,
  input: MergeInput,
): Promise<MergeOutcome | { denied: string }> {
  const run = context.store.getRun(runId);
  if (!run) return { denied: `no such run: ${runId}` };
  const note = (message: string, tone?: 'danger') =>
    context.store.appendEvent(runId, { type: 'note', stepId: context.active.get(runId)?.currentStepId, message, ...(tone ? { tone } : {}) });
  const access = requireRootManager(run, 'merge');
  if (!access.ok) return { denied: access.denied };
  if (run.managerFullAccess !== true) {
    const denied = 'Manager chưa được cấp quyền merge. Hãy đề nghị người dùng merge thủ công, hoặc bật "Full quyền manager" trong Cài đặt nhiệm vụ.';
    note(`merge refused — ${denied}`, 'danger');
    return { denied };
  }
  if (!run.worktreePath || !run.branch || !existsSync(run.worktreePath)) return { denied: 'the manager has no worktree to merge in' };
  let sourceBranch: string | undefined;
  if (input.into === 'task' && !input.abort) {
    const ref = input.source ?? '';
    const members = context.store.listRuns().filter((r) => r.dispatch?.rootRunId === runId && r.id !== runId && r.branch);
    const hit = members.find((r) => r.id === ref || (ref.length >= 6 && r.id.startsWith(ref)) || r.branch === ref);
    if (!hit) {
      const known = members.map((r) => `${r.id.slice(0, 8)} (${r.branch})`).join(', ') || 'none yet';
      return { denied: `"${ref}" is not a worker of this task. Workers: ${known}` };
    }
    sourceBranch = hit.branch;
  }
  const saved = await autosaveCommit(run.worktreePath, 'wip before merge');
  if (saved === 'refused' || saved === 'failed') {
    // A half-resolved merge from an earlier conflict is fine: runManagerMerge reports it.
    if (saved === 'failed') return { denied: 'your uncommitted work could not be committed before merging' };
  }
  const result = await runManagerMerge({
    worktree: run.worktreePath,
    taskBranch: run.branch,
    baseBranch: run.baseBranch ?? '',
    repoRoot: context.repoRoot,
    into: input.into,
    ...(sourceBranch ? { sourceBranch } : {}),
    ...(input.abort ? { abort: true } : {}),
  });
  const target = input.into === 'base' ? run.baseBranch : run.branch;
  const detail = `merge (${input.into}) ${input.source ? `${input.source} → ` : ''}${target}: ${result.outcome} — ${result.message}${'before' in result && result.before ? ` [${result.before.slice(0, 8)} → ${result.after?.slice(0, 8) ?? '?'}]` : ''}`;
  note(detail, result.outcome === 'conflict' || result.outcome === 'refused' ? 'danger' : undefined);
  appendLedger(context.dataDir, runId, {
    type: 'merge',
    runId,
    into: input.into,
    source: sourceBranch ?? input.source ?? null,
    target: target ?? null,
    outcome: result.outcome,
    before: 'before' in result ? result.before ?? null : null,
    after: 'after' in result ? result.after ?? null : null,
  });
  if (result.outcome === 'refused') return { denied: result.message };
  return result;
}

export async function checkManagerComplexity(
  context: ManagerStateContext,
  runId: string,
  ctx: ManagerStateTurnContext,
): Promise<boolean> {
  if (ctx.done || ctx.state.complexityWarned) return false;
  if (!context.managerComplexityPolicyEnabled()) return false;
  const run = context.store.getRun(runId);
  if (!run?.roster || run.dispatch?.parentRunId) return false;
  if (childrenOf(context.store.listRuns(), runId).length > 0) return false;
  let stat = run.diffStat;
  if (run.worktreePath && existsSync(run.worktreePath)) {
    const fresh = await worktreeShortstat(run.worktreePath, run.baseBranch ?? 'HEAD', {
      taskBranch: run.branch,
      runStartedAt: run.startedAt,
    }).catch(() => undefined);
    if (fresh) stat = fresh;
  }
  if (!stat || !managerDoingComplexAlone(stat, 0)) return false;
  if (ctx.state.complexityWarned) return false;
  ctx.state.complexityWarned = true;
  const message = `manager has changed ${stat.files} files (+${stat.adds} -${stat.dels}) and dispatched no worker — by the complexity policy this size of work should be handed to workers, or split with them.`;
  context.store.appendEvent(runId, { type: 'note', stepId: ctx.stepId, message, tone: 'danger' });
  if (!ctx.state.autonomous || ctx.state.cancelled || !ctx.state.session?.open) return false;
  if ((ctx.state.autoContinues ?? 0) >= context.maxAutoContinues) return false;
  const text = `Complexity policy reminder: you have changed ${stat.files} files (+${stat.adds} -${stat.dels}) and dispatched no worker. This is complex work. Hand the remaining independent parts to workers (or split: you take one part, workers the rest) before continuing, and say which parts go where.`;
  if (!ctx.state.session.sendMessage([{ type: 'text', text }])) return false;
  ctx.state.autoContinues = (ctx.state.autoContinues ?? 0) + 1;
  return true;
}

function deliverOwnInbox(context: ManagerStateContext, runId: string, state: ManagerStateActive, stepId: string, turnText: string): boolean {
  if (!state.autonomous || state.cancelled || !state.session?.open) return false;
  if (parseAskMarker(context.turnEndMarkerText(turnText)) !== null) return false;
  if ((state.autoContinues ?? 0) >= context.maxAutoContinues) return false;
  const digest = flushInbox(context, runId);
  if (!digest || !state.session.sendMessage([{ type: 'text', text: digest }])) return false;
  state.autoContinues = (state.autoContinues ?? 0) + 1;
  context.store.appendEvent(runId, {
    type: 'note',
    stepId,
    message: `tree inbox digest delivered into the session at turn end (${state.autoContinues}/${context.maxAutoContinues})`,
  });
  return true;
}

export function flushInbox(context: ManagerStateContext, runId: string): string | undefined {
  const dispatch = context.dispatchOf(runId);
  if (!dispatch) return undefined;
  const recipient = inboxName(runId, dispatch.rootRunId);
  const items = listInbox(context.dataDir, dispatch.rootRunId, recipient, dispatch.inboxSeenAt);
  if (items.length === 0) return undefined;
  context.updateDispatch(runId, (current) => ({ ...current, inboxSeenAt: new Date().toISOString() }));
  return inboxDigest(items, taskPaths(context.dataDir, dispatch.rootRunId, runId).inbox);
}

export function notifyTreeInboxes(context: ManagerStateContext, rootRunId: string, writerId: string): void {
  if (!context.dispatchEnabled()) return;
  for (const run of context.store.listRuns()) {
    if (run.id === writerId || run.dispatch?.rootRunId !== rootRunId) continue;
    if (run.status !== 'running' || run.activity !== 'monitoring') continue;
    const state = context.active.get(run.id);
    if (!state?.session?.open) continue;
    const recipient = inboxName(run.id, rootRunId);
    const items = listInbox(context.dataDir, rootRunId, recipient, run.dispatch.inboxSeenAt);
    if (items.length === 0) continue;
    const digest = inboxDigest(items, taskPaths(context.dataDir, rootRunId, run.id).inbox);
    if (!digest || !context.deliverMessage(run.id, [{ type: 'text', text: digest }], false)) continue;
    context.updateDispatch(run.id, (current) => ({ ...current, inboxSeenAt: new Date().toISOString() }));
    context.store.appendEvent(run.id, {
      type: 'note',
      message: `${items.length} new tree inbox message${items.length === 1 ? '' : 's'} — delivered into the session`,
    });
    appendLedger(context.dataDir, rootRunId, { type: 'inbox-notice', runId: run.id, files: items.map((item) => item.name) });
  }
}

export function recordAsk(context: ManagerStateContext, runId: string, sink: UiEventSink, ask: AskRequest): WebhookAttentionRequest {
  const requestId = context.emitAskRequested(sink, ask);
  const attention = recordAttention(requestId, ask.questions);
  const dispatch = context.dispatchOf(runId);
  if (!dispatch) return attention;
  const questions = ask.questions.map((question) => question.question.slice(0, 400));
  const recorded = questions.slice(0, PENDING_ASK_MAX_QUESTIONS);
  const omittedQuestions = questions.length - recorded.length;
  context.updateDispatch(runId, (current) => ({
    ...current,
    pendingAsk: {
      requestId,
      questions: recorded,
      ...(omittedQuestions > 0 ? { omittedQuestions } : {}),
      askedAt: attention.askedAt,
    },
  }));
  if (!dispatch.parentRunId) return attention;
  const run = context.store.getRun(runId);
  try {
    writeInboxMessage(context.dataDir, dispatch.rootRunId, inboxName(dispatch.parentRunId, dispatch.rootRunId), {
      from: runId,
      subject: `Blocked on a Guard question — ${run?.title ?? runId}`,
      body: [
        `Your task "${run?.title ?? runId}" (${runId}) has parked on a question only the human can answer:`,
        ...questions.map((question) => `- ${question}`),
        '',
        "It holds one of your children-in-flight slots until it is answered in the cockpit. You cannot answer on the human's behalf; you can re-plan around it, wait, or raise the decision yourself with ONNI:ASK if your own work depends on it.",
      ].join('\n'),
    });
    appendLedger(context.dataDir, dispatch.rootRunId, { type: 'guard-ask', runId, parentRunId: dispatch.parentRunId, questions });
    notifyTreeInboxes(context, dispatch.rootRunId, runId);
  } catch {
    // best effort
  }
  return attention;
}

export function recordAttention(
  requestId: string,
  input: readonly { question: string; options?: readonly { label: string; description?: string }[] }[],
): WebhookAttentionRequest {
  const attention: WebhookAttentionRequest = {
    requestId,
    askedAt: new Date().toISOString(),
    questions: input.slice(0, 20).map((q) => ({
      question: q.question.slice(0, 2000),
      ...(q.options ? { options: q.options.slice(0, 10).map((o) => ({ label: o.label.slice(0, 120), ...(o.description ? { description: o.description.slice(0, 500) } : {}) })) } : {}),
    })),
  };
  return attention;
}

export function clearPendingAsk(context: ManagerStateContext, runId: string): void {
  if (!context.dispatchOf(runId)?.pendingAsk) return;
  context.updateDispatch(runId, ({ pendingAsk: _answered, ...rest }) => rest);
}
