import {
  DEFAULT_AGENT_PERMISSION_LEVEL,
  CONFLICTS_FILES_MAX,
  CONFLICTS_MAX_PAIRS,
  CONFLICTS_TRIAL_MAX,
  MANAGER_CANCEL_REASON_MAX_CHARS,
  MANAGER_DELIVERIES_MAX_OUTSTANDING,
  MANAGER_DELIVERIES_MAX_RETAINED,
  MANAGER_MESSAGE_MAX_CHARS,
  MANAGER_REDIRECT_INSTRUCTION_MAX_CHARS,
  MANAGER_MEMORY_MAX_BYTES,
  PEEK_ALL_MAX_CHARS_TOTAL,
  PEEK_FILES_MAX,
  PEEK_MAX_ENTRIES,
  PEEK_TAIL_MAX_CHARS_PER_LINE,
  PEEK_TAIL_MAX_LINES,
  REPORT_FILES_MAX,
  rosterWorkerKey,
  type DispatchBudget,
  type DispatchConflicts,
  type DispatchConflictWorker,
  type DispatchInput,
  type DispatchManagerCancelInput,
  type DispatchManagerCancelResult,
  type DispatchManagerDeliveryReasonCode,
  type DispatchManagerDeliveryRecord,
  type DispatchManagerDeliveryState,
  type DispatchManagerMessageInput,
  type DispatchManagerMessageResult,
  type DispatchManagerRedirectFailure,
  type DispatchManagerRedirectInput,
  type DispatchManagerRedirectResult,
  type DispatchOrderSnapshot,
  type DispatchPeek,
  type DispatchPeekEntry,
  type DispatchTrialMerge,
  type RunDispatch,
} from '@onni/contract';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { effectiveAntigravityLevel } from '../../core/antigravity-permissions.ts';
import { resolveCapabilities } from '../../server/capabilities.ts';
import { composeDispatchPrompt } from '../../dispatch/prompts.ts';
import { formatBudgetLine, toDispatchBudget } from '../../dispatch/budget-format.ts';
import { orderPeekCandidates, peekTail, quietMinutesOf } from '../../dispatch/peek.ts';
import { capOverlaps, findOverlaps, outsideScope, parseScope, scopeOf } from '../../dispatch/conflicts.ts';
import { readManagerMemory, clampMemoryToTail } from '../../dispatch/memory.ts';
import { requireRootManager, requireSameTree, resolveRunRef } from '../../dispatch/access.ts';
import { buildWorkerScorecard, formatWorkerScorecard } from '../../dispatch/scorecard.ts';
import { MANAGER_SCORECARD_PROMPT_MAX_CHARS, PROMPT_MAX_CHARS } from '../../dispatch/prompt-budget.ts';
import { appendLedger, readPlan } from '../../dispatch/tree-fs.ts';
import { isTerminalStatus } from '../../dispatch/engine.ts';
import { subtreeUsage } from '../limits.ts';
import { diskFloorRefusal } from '../../disk-space.ts';
import {
  dropOnniDataPaths,
  localBranchAheadReadOnly,
  localBranchExists,
  trialMergeTree,
  worktreeChangedFilesReadOnly,
  worktreeHeadShort,
} from '../../git-worktree.ts';
import { loadWorkspaceConfig } from '../../workspace/config.ts';
import type { RunRecord } from '../../runs/store.ts';
import type { PastedContent } from './preparation.ts';
import {
  managerPrompt,
  workerPrompt,
  type ManagerSessionContext,
  type RemainingBudget,
} from '../manager-worker.ts';
import type {
  ManagerControlContext,
  ManagerControlSessionState,
  RedirectDispatchOrigin,
} from './internal-types.ts';
/** Is dispatch on at all? One read, so the gate cannot drift between the sites below. */
export function dispatchEnabled(ctx: ManagerControlContext): boolean {
    return resolveCapabilities(ctx.managerEnv()).dispatch;
  }

  /**
   * Can a task actually REACH the dispatch routes? The flag being on is not enough: `ONNI_API_URL`
   * and `ONNI_BIN` are set by `serveCommand`, so a headless `onni run` has neither — no cockpit to
   * call, and no entrypoint to call it with.
   *
   * The gate for everything an agent is TOLD about dispatch (the prompt), as opposed to what the
   * engine does with a `dispatch` record it already has. A headless run that was taught the CLI
   * would take `onni task create`'s refusal as its instruction — "stop and report that dispatch is
   * unavailable" — and abandon work it could have done itself. Same reason
   * `availablePromptTemplates` hides the dispatching template when the capability is off: a
   * capability an agent cannot use must not be described to it.
   */
export function dispatchReachable(ctx: ManagerControlContext): boolean {
    return dispatchEnabled(ctx) && Boolean(process.env.ONNI_API_URL);
  }

  /**
   * THE gate for everything that needs a `dispatch` record: answers `undefined` when the feature
   * is off (`ONNI_DISPATCH=0`) or when this run has neither dispatched nor been dispatched.
   * Re-read from the store on every call rather than cached: the stored object is written DURING
   * a turn (a report, a pending report from a settled child, the over-budget flag).
   */
export function dispatchOf(ctx: ManagerControlContext, runId: string): RunDispatch | undefined {
    if (!dispatchEnabled(ctx)) return undefined;
    return ctx.store.getRun(runId)?.dispatch;
  }

  /** Persist a patch onto the run's `dispatch`, off the CURRENT record. */
export function updateDispatch(ctx: ManagerControlContext, runId: string, patch: (dispatch: RunDispatch) => RunDispatch): void {
    const dispatch = ctx.store.getRun(runId)?.dispatch;
    if (!dispatch) return;
    ctx.store.updateRun(runId, { dispatch: patch(dispatch) });
  }

  /**
   * Everything the opening prompt needs that is read asynchronously (plan v2 §5 H7): the effective
   * Antigravity level, project memory, the tree plan, an expired manager question. Loaded ONCE per
   * session and awaited at both `ActiveRun` construction sites, so `prepareDispatchSession` stays
   * sync. Every source degrades on its own: a failure leaves its field `undefined` rather than
   * blocking the session.
   */
export async function loadManagerSessionContext(ctx: ManagerControlContext, runId: string, state: ManagerControlSessionState): Promise<ManagerSessionContext> {
    const context: ManagerSessionContext = {};
    // #3: the level an Antigravity WORKER actually gets — always unattended, so `bypass` is
    // lowered here, exactly as `agentPermissionSpec` will do when the child spawns. Read once per
    // session; the dispatch-time warning is the fresher source of truth if the user changes it.
    const config = await loadWorkspaceConfig().catch(() => null);
    if (config) {
      const configured = config.agentPermissions.antigravity ?? DEFAULT_AGENT_PERMISSION_LEVEL;
      context.antigravityLevel = effectiveAntigravityLevel(configured, true).level;
    }
    // #9: only the roster ROOT reads memory — the brief it lands in exists nowhere else. A file
    // hand-edited past its cap is read from its newest lines; the note says what happened rather
    // than silently shrinking the manager's context.
    const run = ctx.store.getRun(runId);
    if (run?.roster && !run.dispatch?.parentRunId) {
      const memory = await readManagerMemory(ctx.dataDir).catch(() => undefined);
      if (memory) {
        const content = memory.content.trim();
        if (content) {
          const clipped = memory.bytes > MANAGER_MEMORY_MAX_BYTES;
          context.memory = clipped ? clampMemoryToTail(memory.content).trim() : content;
          if (clipped) {
            ctx.store.appendEvent(runId, {
              type: 'note',
              stepId: state.currentStepId,
              tone: 'danger',
              message: `project memory is ${memory.bytes} bytes (cap ${MANAGER_MEMORY_MAX_BYTES}); this prompt carries only its newest lines — prune it in Settings → Manager memory.`,
            });
          }
        }
      }
      // #6A: the plan is restored from `plan.json`, so a session reopened after a restart still
      // knows what this manager intended. Display only — nothing here decides order.
      const planRead = await readPlan(ctx.dataDir, runId).catch(() => undefined);
      if (planRead) {
        if (planRead.corrupt) {
          ctx.store.appendEvent(runId, {
            type: 'note',
            stepId: state.currentStepId,
            tone: 'danger',
            message: 'the tree plan could not be read — this session starts with an empty plan; rewrite it with `onni task plan set`',
          });
        }
        if (planRead.plan.parts.length > 0) context.plan = planRead.plan;
      }
    }
    // #10: a manager question whose deadline passed while no session was open. The record kept it
    // on purpose (the timer had nowhere to deliver the nudge); this first brief is where the
    // manager hears it, and the question is retired in the same breath.
    const soft = ctx.store.getRun(runId)?.dispatch?.softAsk;
    if (soft?.expiresAt !== undefined && Date.parse(soft.expiresAt) <= Date.now()) {
      context.expiredAsk = { question: soft.question };
      ctx.clearSoftAsk(runId);
      ctx.store.appendEvent(runId, {
        type: 'note',
        stepId: state.currentStepId,
        message: `the question "${soft.question}" went unanswered — its deadline passed while the session was closed`,
      });
    }
    return context;
  }

  /**
   * Resolve what a session needs before it opens: the dispatch prompt (with the review addendum
   * for a review child). Called from BOTH `ActiveRun` construction sites.
   *
   * Gated on `dispatchReachable`, not on the flag alone — a headless run with no cockpit behind it
   * gets no dispatch prompt and behaves exactly as it did before this feature existed.
   */
export function prepareDispatchSession(ctx: ManagerControlContext, runId: string, state: ManagerControlSessionState, context: ManagerSessionContext = {}): void {
    if (!dispatchReachable(ctx)) return;
    const dispatch = ctx.store.getRun(runId)?.dispatch;
    // Manager–worker tree: the root gets the manager brief, a worker the report-only one — the
    // worker keeps ONNI_API_URL so `onni task report` works, but is never taught to dispatch.
    const runs = ctx.store.listRuns();
    const roster = dispatch ? runs.find((r) => r.id === dispatch.rootRunId)?.roster : undefined;
    if (roster && dispatch) {
      if (dispatch.parentRunId) {
        state.dispatchPrompt = workerPrompt(dispatch.kind);
      } else {
        const scorecard = buildWorkerScorecard(runs);
        const hasHistory = roster.workers.some((worker) => {
          const scores = scorecard.byWorker.get(rosterWorkerKey(worker));
          return scores !== undefined && Object.values(scores).some((score) => score !== undefined && score.settledRuns >= 3);
        });
        const formattedScorecard = hasHistory ? formatWorkerScorecard(roster.workers, scorecard) : '';
        const scorecardBlock = formattedScorecard
          ? `\n\n## Worker scorecard (settled work, last 30 days)\n${formattedScorecard}`
          : '';
        const managerBrief = managerPrompt(roster, remainingForManager(ctx, runs, dispatch.rootRunId), {
          complexityPolicy: ctx.semaphore.safety().managerComplexityPolicy !== false,
          fullAccess: runs.find((r) => r.id === dispatch.rootRunId)?.managerFullAccess === true,
          context,
        });
        state.dispatchPrompt = scorecardBlock.length <= MANAGER_SCORECARD_PROMPT_MAX_CHARS
          && managerBrief.length + scorecardBlock.length <= PROMPT_MAX_CHARS
          ? `${managerBrief}${scorecardBlock}`
          : managerBrief;
      }
      return;
    }
    // The intent block belongs to the ROOT the user started; a child reads its order instead.
    state.dispatchPrompt = composeDispatchPrompt(dispatch?.kind, dispatch?.parentRunId ? undefined : dispatch?.intent);
  }

  /** What is left of the root's ceilings and of the tree's structural caps, for the manager brief. */
export function remainingForManager(ctx: ManagerControlContext, runs: readonly RunRecord[], rootId: string): RemainingBudget {
    const root = runs.find((r) => r.id === rootId);
    const safety = ctx.semaphore.safety();
    const used = subtreeUsage(runs, rootId);
    const limits = root?.limits;
    const capped = limits?.mode === 'capped';
    const children = runs.filter((r) => r.dispatch?.rootRunId === rootId && r.id !== rootId).length;
    const ownCap = root?.dispatch?.intent?.maxSubtasks;
    const uncapped = ownCap === undefined && safety.dispatchUnlimitedSubtasks;
    const cap = ownCap ?? safety.dispatchMaxSubtasks;
    return {
      unlimited: !capped,
      ...(capped && limits.maxCostUsd !== undefined ? { costUsd: limits.maxCostUsd - used.cost } : {}),
      ...(capped && limits.maxTokens !== undefined ? { tokens: limits.maxTokens - used.tokens } : {}),
      ...(capped && limits.maxWallClockMinutes !== undefined ? { minutes: limits.maxWallClockMinutes - used.wallMs / 60_000 } : {}),
      ...(capped && limits.maxStepIterations !== undefined ? { steps: limits.maxStepIterations - used.iterations } : {}),
      subtasks: uncapped ? Number.POSITIVE_INFINITY : cap - children,
      subtaskCap: cap,
      maxDepth: safety.dispatchMaxDepth,
    };
  }

  /**
   * The tree's remaining ceilings for `onni task budget` (plan v2 §6.2). Any run in the tree may
   * ask: the answer is always the ROOT's arithmetic, because that is where the ceilings live.
   * Undefined only for an id the store does not know.
   */
export function dispatchBudgetFor(ctx: ManagerControlContext, runId: string): DispatchBudget | undefined {
    const run = ctx.store.getRun(runId);
    if (!run) return undefined;
    const rootId = run.dispatch?.rootRunId ?? run.id;
    return toDispatchBudget(remainingForManager(ctx, ctx.store.listRuns(), rootId));
  }

  /**
   * `GET /runs/:id/peek` — the root manager watching its workers (plan v2 §7). Read-only: no
   * ledger, no transcript note, and the files come from the read-only git helper (#7's, not
   * `worktreeChangedFiles`, which writes the index a running worker may be using).
   *
   * A missing `target` means the compact list: every worker, no tail. A `target` may be the root
   * itself or any member, and turns the tail on (30 lines unless `--tail` says fewer). Only the
   * ROOT may call: a worker looking at other workers is the short path back to a flat swarm.
   */
export async function peekFor(ctx: ManagerControlContext,
    callerId: string,
    query: { target?: string; all?: boolean; tail?: number },
  ): Promise<DispatchPeek | { denied: string; status: 403 | 404 | 409 }> {
    const caller = ctx.store.getRun(callerId);
    const callerAccess = requireRootManager(caller, 'peek at this task tree');
    if (!callerAccess.ok) return { denied: callerAccess.denied, status: callerAccess.status };
    if (!caller) return { denied: `no such run: ${callerId}`, status: 404 };

    const runs = ctx.store.listRuns();
    if (query.target !== undefined) {
      const target = runs.find((run) => run.id === query.target || (query.target!.length >= 6 && run.id.startsWith(query.target!)));
      if (!target) return { denied: `no such run: ${query.target}`, status: 404 };
      const sameTree = requireSameTree(caller, target);
      if (!sameTree.ok) return { denied: sameTree.denied, status: sameTree.status };
      const entry = await peekEntry(ctx, target, {
        filesMax: PEEK_FILES_MAX,
        tailLines: query.tail ?? PEEK_TAIL_MAX_LINES,
      });
      return { workers: [entry], workersOmitted: 0 };
    }

    const members = runs.filter((run) => run.dispatch?.rootRunId === caller.id && run.id !== caller.id);
    const { chosen, omitted } = orderPeekCandidates(members, PEEK_MAX_ENTRIES);
    // `--all --tail` splits ONE response budget evenly: twelve workers each getting the full
    // per-entry cap would be 48 000 characters of agent context in a single command.
    const tailMaxChars = query.tail !== undefined && chosen.length > 0
      ? Math.max(PEEK_TAIL_MAX_CHARS_PER_LINE, Math.floor(PEEK_ALL_MAX_CHARS_TOTAL / chosen.length))
      : undefined;
    const workers = await Promise.all(chosen.map((run) => peekEntry(ctx, run, {
      filesMax: REPORT_FILES_MAX,
      ...(query.tail !== undefined ? { tailLines: query.tail } : {}),
      ...(tailMaxChars !== undefined ? { tailMaxChars } : {}),
    })));
    return { workers, workersOmitted: omitted };
  }

  /** Read-only advisory overlap report for the root manager (wave A2). */
export async function conflictsFor(ctx: ManagerControlContext,
    callerId: string,
    query: { target?: string } = {},
  ): Promise<DispatchConflicts | { denied: string; status: 403 | 404 | 409 }> {
    const caller = ctx.store.getRun(callerId);
    const callerAccess = requireRootManager(caller, 'check this task tree for conflicts');
    if (!callerAccess.ok) return { denied: callerAccess.denied, status: callerAccess.status };
    if (!caller) return { denied: 'no such run: ' + callerId, status: 404 };

    const runs = ctx.store.listRuns();
    let targetId: string | undefined;
    if (query.target !== undefined) {
      const target = resolveRunRef(runs, query.target);
      if (target === 'none') return { denied: 'no such run: ' + query.target, status: 404 };
      if (target === 'ambiguous') return { denied: 'ambiguous id "' + query.target + '" — give more characters', status: 409 };
      const sameTree = requireSameTree(caller, target);
      if (!sameTree.ok) return { denied: sameTree.denied, status: sameTree.status };
      if (target.id === caller.id || target.dispatch?.rootRunId !== caller.id) {
        return { denied: 'conflicts target must be a worker of this task', status: 409 };
      }
      targetId = target.id;
    }

    const members = runs.filter((run) => run.dispatch?.rootRunId === caller.id && run.id !== caller.id);
    const { chosen, omitted: workersOmitted } = orderPeekCandidates(members, PEEK_MAX_ENTRIES);
    const startedAt = Date.now();
    const controller = new AbortController();
    const totalTimer = setTimeout(() => controller.abort('conflicts-total-timeout'), 20_000);
    const timeoutForRemaining = (): number => Math.max(1, Math.min(5_000, 20_000 - (Date.now() - startedAt)));
    const redact = (runId: string, text: string): string =>
      ctx.store.redactRunText(runId, text).replace(/\s+/g, ' ').trim().slice(0, 300);

    type WorkerScan = {
      run: RunRecord;
      files: string[];
      worker: DispatchConflictWorker;
    };
    const inspectWorker = async (run: RunRecord): Promise<WorkerScan> => {
      let changed: Awaited<ReturnType<typeof worktreeChangedFilesReadOnly>> = {
        files: [],
        omitted: 0,
        state: 'unavailable',
      };
      let headCommit: string | undefined;
      if (run.worktreePath) {
        try {
          [changed, headCommit] = await Promise.all([
            worktreeChangedFilesReadOnly(run.worktreePath, run.baseBranch ?? 'HEAD', {
              signal: controller.signal,
              timeoutMs: timeoutForRemaining(),
              max: 2_000,
            }),
            worktreeHeadShort(run.worktreePath, { signal: controller.signal, timeoutMs: timeoutForRemaining() }),
          ]);
        } catch {
          changed = { files: [], omitted: 0, state: controller.signal.aborted ? 'timeout' : 'unavailable' };
        }
      }
      const files = dropOnniDataPaths(changed.files);
      const parsedScope = parseScope(scopeOf(run));
      const outside = changed.state === 'ok' ? outsideScope(files, parsedScope, CONFLICTS_FILES_MAX) : { files: [], omitted: 0 };
      const worker: DispatchConflictWorker = {
        id: run.id,
        title: redact(run.id, run.title),
        status: run.status,
        ...(run.branch ? { branch: redact(run.id, run.branch).slice(0, 200) } : {}),
        ...(headCommit ? { headCommit: headCommit.slice(0, 40) } : {}),
        filesCount: changed.state === 'ok' ? files.length + changed.omitted : 0,
        filesTruncated: changed.state === 'ok' && changed.omitted > 0,
        filesState: changed.state,
        scopeState: parsedScope.state,
        outsideScope: outside.files.map((file) => redact(run.id, file)),
        outsideScopeOmitted: outside.omitted,
      };
      return { run, files, worker };
    };

    try {
      const managerWorktree = caller.worktreePath;
      const managerFilesPromise = managerWorktree
        ? worktreeChangedFilesReadOnly(managerWorktree, caller.baseBranch ?? 'HEAD', {
            signal: controller.signal,
            timeoutMs: timeoutForRemaining(),
            max: 2_000,
          }).catch(() => ({ files: [], omitted: 0, state: controller.signal.aborted ? 'timeout' as const : 'unavailable' as const }))
        : Promise.resolve({ files: [], omitted: 0, state: 'unavailable' as const });
      const managerHeadPromise = managerWorktree
        ? worktreeHeadShort(managerWorktree, { signal: controller.signal, timeoutMs: timeoutForRemaining() }).catch(() => undefined)
        : Promise.resolve(undefined);
      const [scans, managerFilesResult, managerHead] = await Promise.all([
        Promise.all(chosen.map(inspectWorker)),
        managerFilesPromise,
        managerHeadPromise,
      ]);
      const managerFiles = managerFilesResult.state === 'ok'
        ? dropOnniDataPaths(managerFilesResult.files)
        : [];
      const sources = scans.map((scan) => ({
        id: scan.run.id,
        files: scan.files,
        filesState: scan.worker.filesState,
      }));
      const allOverlaps = findOverlaps(sources, { ...(targetId ? { target: targetId } : {}) });
      const cappedOverlaps = capOverlaps(allOverlaps, CONFLICTS_MAX_PAIRS, CONFLICTS_FILES_MAX);
      const overlaps = cappedOverlaps.overlaps.map((overlap) => {
        const left = scans.find((scan) => scan.run.id === overlap.a);
        const right = scans.find((scan) => scan.run.id === overlap.b);
        const names = overlap.files.map((file) => {
          let safe = left ? redact(left.run.id, file) : file.slice(0, 300);
          if (right) safe = redact(right.run.id, safe);
          return safe;
        });
        return {
          a: overlap.a,
          b: overlap.b,
          files: names,
          filesOmitted: overlap.filesOmitted,
        };
      });

      const managerCandidateScans = scans.filter((scan) =>
        isTerminalStatus(scan.run.status) &&
        scan.run.branch &&
        caller.branch &&
        scan.worker.filesState === 'ok' &&
        managerFilesResult.state === 'ok' &&
        (!targetId || scan.run.id === targetId) &&
        findOverlaps([
          { id: caller.id, files: managerFiles, filesState: 'ok' },
          { id: scan.run.id, files: scan.files, filesState: scan.worker.filesState },
        ]).length > 0,
      );
      const ahead = await Promise.all(managerCandidateScans.map(async (scan) => {
        const remaining = 20_000 - (Date.now() - startedAt);
        if (remaining <= 0 || controller.signal.aborted) return false;
        return localBranchAheadReadOnly(ctx.repoRoot, caller.branch!, scan.run.branch!, {
          signal: controller.signal,
          timeoutMs: Math.min(3_000, remaining),
        });
      }));
      const intoManager = managerCandidateScans.filter((_scan, index) => ahead[index]);
      const candidates: Array<{
        kind: 'worker-worker' | 'into-manager';
        left: RunRecord;
        right: RunRecord;
        leftHead?: string;
        rightHead?: string;
      }> = [
        ...allOverlaps.map((overlap) => ({
          kind: 'worker-worker' as const,
          left: scans.find((scan) => scan.run.id === overlap.a)!.run,
          right: scans.find((scan) => scan.run.id === overlap.b)!.run,
          leftHead: scans.find((scan) => scan.run.id === overlap.a)?.worker.headCommit,
          rightHead: scans.find((scan) => scan.run.id === overlap.b)?.worker.headCommit,
        })),
        ...intoManager.map((scan) => ({
          kind: 'into-manager' as const,
          left: caller,
          right: scan.run,
          ...(managerHead ? { leftHead: managerHead } : {}),
          ...(scan.worker.headCommit ? { rightHead: scan.worker.headCommit } : {}),
        })),
      ];

      const trialMerges: DispatchTrialMerge[] = [];
      let trialState: DispatchConflicts['trialState'] = 'ran';
      let trialReason: string | undefined;
      for (const candidate of candidates.slice(0, CONFLICTS_TRIAL_MAX)) {
        const remaining = 20_000 - (Date.now() - startedAt);
        if (controller.signal.aborted || remaining <= 0) break;
        if (!candidate.left.branch || !candidate.right.branch) {
          trialMerges.push({
            kind: candidate.kind,
            left: candidate.left.id,
            right: candidate.right.id,
            ...(candidate.leftHead ? { leftHead: candidate.leftHead } : {}),
            ...(candidate.rightHead ? { rightHead: candidate.rightHead } : {}),
            state: 'unavailable',
            files: [],
            filesOmitted: 0,
            reason: 'a local branch is unavailable',
          });
          continue;
        }
        const [leftExists, rightExists] = await Promise.all([
          localBranchExists(ctx.repoRoot, candidate.left.branch, {
            signal: controller.signal,
            timeoutMs: Math.min(1_000, remaining),
          }),
          localBranchExists(ctx.repoRoot, candidate.right.branch, {
            signal: controller.signal,
            timeoutMs: Math.min(1_000, remaining),
          }),
        ]);
        if (!leftExists || !rightExists) {
          trialMerges.push({
            kind: candidate.kind,
            left: candidate.left.id,
            right: candidate.right.id,
            ...(candidate.leftHead ? { leftHead: candidate.leftHead } : {}),
            ...(candidate.rightHead ? { rightHead: candidate.rightHead } : {}),
            state: 'unavailable',
            files: [],
            filesOmitted: 0,
            reason: 'a local branch is unavailable',
          });
          continue;
        }
        const preview = await trialMergeTree(ctx.repoRoot, candidate.left.branch, candidate.right.branch, {
          signal: controller.signal,
          timeoutMs: Math.min(10_000, remaining),
          max: CONFLICTS_FILES_MAX,
        });
        const redactTrialFile = (file: string): string =>
          redact(candidate.kind === 'into-manager' ? candidate.right.id : candidate.left.id,
            redact(candidate.right.id, file));
        trialMerges.push({
          kind: candidate.kind,
          left: candidate.left.id,
          right: candidate.right.id,
          ...(candidate.leftHead ? { leftHead: candidate.leftHead.slice(0, 40) } : {}),
          ...(candidate.rightHead ? { rightHead: candidate.rightHead.slice(0, 40) } : {}),
          state: preview.state,
          files: preview.files.map(redactTrialFile),
          filesOmitted: preview.omitted,
          ...(preview.reason ? { reason: redact(candidate.right.id, preview.reason) } : {}),
        });
        if (preview.state === 'unavailable' && preview.reason?.includes('needs git 2.38 or newer')) {
          trialState = 'unavailable';
          trialReason = redact(candidate.right.id, preview.reason);
          break;
        }
      }
      if (controller.signal.aborted && trialMerges.length === 0) {
        trialState = 'unavailable';
        trialReason = 'conflict analysis exceeded its 20 second budget';
      }
      return {
        workers: scans.map(({ worker }) => worker),
        workersOmitted,
        overlaps,
        overlapsOmitted: cappedOverlaps.omitted,
        trialMerges,
        trialMergesSkipped: Math.max(0, candidates.length - trialMerges.length),
        trialState,
        ...(trialReason ? { trialReason: trialReason.slice(0, 300) } : {}),
        checkedAt: new Date().toISOString(),
      };
    } finally {
      clearTimeout(totalTimer);
    }
  }

  /** `POST /runs/:id/message` — send one bounded instruction to a live or queued direct worker. */
export function messageFor(ctx: ManagerControlContext,
    callerId: string,
    input: DispatchManagerMessageInput,
  ): DispatchManagerMessageResult | { denied: string; status: 400 | 403 | 404 | 409 } {
    if (!dispatchEnabled(ctx)) return { denied: 'dispatch is disabled on this cockpit (ONNI_DISPATCH=0)', status: 409 };
    const caller = ctx.store.getRun(callerId);
    const access = requireRootManager(caller, 'message a worker');
    if (!access.ok) return { denied: access.denied, status: access.status };
    if (!caller) return { denied: `no such run: ${callerId}`, status: 404 };

    const target = resolveRunRef(ctx.store.listRuns(), input.target);
    if (target === 'none') return { denied: `no such run: ${input.target}`, status: 404 };
    if (target === 'ambiguous') return { denied: `ambiguous id "${input.target}" — give more characters`, status: 409 };
    const sameTree = requireSameTree(caller, target);
    if (!sameTree.ok) return { denied: sameTree.denied, status: sameTree.status };
    if (target.id === caller.id || target.dispatch?.rootRunId !== caller.id) {
      return { denied: 'message target must be a worker of this task', status: 409 };
    }
    if (!['queued', 'running', 'waiting'].includes(target.status)) {
      return { denied: `worker ${target.id.slice(0, 8)} is settled (${target.status})`, status: 409 };
    }
    if (target.status === 'waiting' && (target.dispatch?.pendingAsk !== undefined || target.askParked === true)) {
      return { denied: 'worker is waiting for the user to answer its Guard/ask; a manager message cannot answer it', status: 409 };
    }
    const live = ctx.active.get(target.id);
    if (!live?.session?.open && live?.graphAnswer) {
      return { denied: 'worker is waiting for a workflow answer; a manager message cannot answer it', status: 409 };
    }

    const rawText = input.text.trim();
    if (!rawText || rawText.length > MANAGER_MESSAGE_MAX_CHARS) {
      return { denied: `message text must be 1-${MANAGER_MESSAGE_MAX_CHARS} characters`, status: 400 };
    }
    const text = ctx.store.redactRunText(target.id, rawText).trim();
    if (!text || text.length > MANAGER_MESSAGE_MAX_CHARS) {
      return { denied: `message text must be 1-${MANAGER_MESSAGE_MAX_CHARS} characters after redaction`, status: 400 };
    }
    const backend = target.runner ?? 'claude';
    const capability = backend === 'cursor' || backend === 'antigravity'
      ? 'unsupported'
      : backend === 'junie' || backend === 'cline' || backend === 'copilot'
        ? 'ordered-queue'
        : 'steer';
    const prior = target.dispatch.managerDeliveries ?? [];
    const canReceiveCorrelatedReceipts = typeof live?.session?.sendMessageWithReceipt === 'function';
    const outstanding = prior.filter((delivery) =>
      delivery.state === 'queued' || (canReceiveCorrelatedReceipts && delivery.state === 'delivered'),
    ).length;
    if (capability !== 'unsupported' && outstanding >= MANAGER_DELIVERIES_MAX_OUTSTANDING) {
      return { denied: `worker already has ${outstanding} outstanding manager deliveries (cap ${MANAGER_DELIVERIES_MAX_OUTSTANDING})`, status: 409 };
    }

    const now = new Date().toISOString();
    const deliveryId = randomUUID();
    const state: DispatchManagerDeliveryState = capability === 'unsupported' ? 'rejected' : 'queued';
    const reasonCode: DispatchManagerDeliveryReasonCode | undefined = capability === 'unsupported' ? 'backend-unsupported' : undefined;
    const record: DispatchManagerDeliveryRecord = {
      deliveryId,
      state,
      createdAt: now,
      updatedAt: now,
      capability,
      ...(reasonCode ? { reasonCode } : {}),
    };
    ctx.updateDispatch(target.id, (dispatch) => ({
      ...dispatch,
      managerDeliveries: [...(dispatch.managerDeliveries ?? []), record].slice(-MANAGER_DELIVERIES_MAX_RETAINED),
    }));
    const summary = text.replace(/\s+/g, ' ').slice(0, 240);
    const rootRunId = target.dispatch.rootRunId;
    appendLedger(ctx.dataDir, rootRunId, {
      type: 'message',
      runId: caller.id,
      targetRunId: target.id,
      deliveryId,
      state,
      capability,
      ...(reasonCode ? { reasonCode } : {}),
      text: summary,
    });

    if (capability !== 'unsupported') {
      const content: PastedContent[] = [{ type: 'text', text }];
      const liveAccepted = ctx.sendMessage(target.id, content, undefined, deliveryId);
      if (!liveAccepted) {
        if (ctx.enqueueMessage(target.id, content, deliveryId)) {
          recordManagerUserMessage(ctx, target.id, text);
        } else if (ctx.deferMessage(target.id, content, deliveryId)) {
          recordManagerUserMessage(ctx, target.id, text);
        } else {
          recordManagerDeliveryTransition(ctx, target.id, deliveryId, 'rejected', 'runner-rejected');
        }
      } else if (managerDeliveryFor(ctx, target.id, deliveryId)?.state === 'queued') {
        // A repo-root lease resume was accepted into its wait; the actual runner boundary is later.
        recordManagerUserMessage(ctx, target.id, text);
      }
    }

    const latest = managerDeliveryFor(ctx, target.id, deliveryId) ?? record;
    const title = ctx.store.redactRunText(target.id, target.title).replace(/\s+/g, ' ').slice(0, 120);
    ctx.store.appendEvent(caller.id, {
      type: 'note',
      stepId: ctx.active.get(caller.id)?.currentStepId,
      message: `manager message to "${title}" (${target.id.slice(0, 8)}) — ${latest.state} (${capability})${latest.reasonCode ? `: ${latest.reasonCode}` : ''}: ${summary}`,
    });
    ctx.store.appendEvent(target.id, {
      type: 'note',
      message: `manager delivery ${deliveryId.slice(0, 8)} state ${latest.state} (${capability})${latest.reasonCode ? ` — ${latest.reasonCode}` : ''}`,
    });
    return {
      deliveryId,
      targetId: target.id,
      state: latest.state,
      capability,
      ...(latest.reasonCode ? { reasonCode: latest.reasonCode } : {}),
    };
  }

  /** `POST /runs/:id/cancel` — preserve a manager's reason before reusing the shared cancel path. */
export function cancelFor(ctx: ManagerControlContext,
    callerId: string,
    input: DispatchManagerCancelInput,
  ): DispatchManagerCancelResult | { denied: string; status: 400 | 403 | 404 | 409 } {
    if (!dispatchEnabled(ctx)) return { denied: 'dispatch is disabled on this cockpit (ONNI_DISPATCH=0)', status: 409 };
    const caller = ctx.store.getRun(callerId);
    const access = requireRootManager(caller, 'cancel a worker');
    if (!access.ok) return { denied: access.denied, status: access.status };
    if (!caller) return { denied: `no such run: ${callerId}`, status: 404 };

    const target = resolveRunRef(ctx.store.listRuns(), input.target);
    if (target === 'none') return { denied: `no such run: ${input.target}`, status: 404 };
    if (target === 'ambiguous') return { denied: `ambiguous id "${input.target}" — give more characters`, status: 409 };
    const sameTree = requireSameTree(caller, target);
    if (!sameTree.ok) return { denied: sameTree.denied, status: sameTree.status };
    if (target.id === caller.id || target.dispatch?.rootRunId !== caller.id) {
      return { denied: 'cancel target must be a worker of this task', status: 409 };
    }
    if (!['queued', 'running', 'waiting'].includes(target.status)) {
      return { denied: `worker ${target.id.slice(0, 8)} is settled (${target.status})`, status: 409 };
    }
    const rawReason = input.reason?.trim();
    if (rawReason !== undefined && (!rawReason || rawReason.length > MANAGER_CANCEL_REASON_MAX_CHARS)) {
      return { denied: `cancel reason must be 1-${MANAGER_CANCEL_REASON_MAX_CHARS} characters`, status: 400 };
    }
    const reason = rawReason === undefined ? undefined : ctx.store.redactRunText(target.id, rawReason).trim();
    if (reason !== undefined && (!reason || reason.length > MANAGER_CANCEL_REASON_MAX_CHARS)) {
      return { denied: `cancel reason must be 1-${MANAGER_CANCEL_REASON_MAX_CHARS} characters after redaction`, status: 400 };
    }
    const marker = { byRunId: caller.id, requestedAt: new Date().toISOString(), ...(reason ? { reason } : {}) };
    ctx.updateDispatch(target.id, (dispatch) => ({ ...dispatch, managerCancellation: marker }));
    const detail = reason ?? 'cancelled by manager';
    const safeDetail = ctx.store.redactRunText(target.id, detail).slice(0, MANAGER_CANCEL_REASON_MAX_CHARS);
    ctx.store.appendEvent(target.id, { type: 'lifecycle', message: `cancelled by manager ${caller.id.slice(0, 8)} — ${safeDetail}` });
    ctx.store.appendEvent(caller.id, {
      type: 'note',
      stepId: ctx.active.get(caller.id)?.currentStepId,
      message: `cancelling worker ${target.id.slice(0, 8)} — ${safeDetail}`,
    });
    appendLedger(ctx.dataDir, target.dispatch.rootRunId, {
      type: 'cancel',
      runId: caller.id,
      targetRunId: target.id,
      reason: safeDetail,
    });
    if (!ctx.cancel(target.id)) {
      ctx.updateDispatch(target.id, ({ managerCancellation: _marker, ...dispatch }) => dispatch);
      return { denied: `worker ${target.id.slice(0, 8)} could not be cancelled`, status: 409 };
    }
    return {
      targetId: target.id,
      status: 'cancelled' as const,
      reportStatus: 'blocked' as const,
      ...(reason ? { reason } : {}),
    };
  }

  /** Redirect one live direct worker by cancelling it and re-admitting its saved order. */
export async function redirectFor(ctx: ManagerControlContext,
    callerId: string,
    input: DispatchManagerRedirectInput,
  ): Promise<DispatchManagerRedirectResult | DispatchManagerRedirectFailure | { denied: string; status: 400 | 403 | 404 | 409 }> {
    if (!dispatchEnabled(ctx)) return { denied: 'dispatch is disabled on this cockpit (ONNI_DISPATCH=0)', status: 409 };
    const caller = ctx.store.getRun(callerId);
    const access = requireRootManager(caller, 'redirect a worker');
    if (!access.ok) return { denied: access.denied, status: access.status };
    if (!caller) return { denied: `no such run: ${callerId}`, status: 404 };

    const target = resolveRunRef(ctx.store.listRuns(), input.target);
    if (target === 'none') return { denied: `no such run: ${input.target}`, status: 404 };
    if (target === 'ambiguous') return { denied: `ambiguous id "${input.target}" — give more characters`, status: 409 };
    const sameTree = requireSameTree(caller, target);
    if (!sameTree.ok) return { denied: sameTree.denied, status: sameTree.status };
    if (target.id === caller.id || target.dispatch?.rootRunId !== caller.id) {
      return { denied: 'redirect target must be a worker of this task', status: 409 };
    }
    if (!['queued', 'running', 'waiting'].includes(target.status)) {
      return { denied: `worker ${target.id.slice(0, 8)} is settled (${target.status})`, status: 409 };
    }
    if (target.status === 'waiting' && (target.dispatch?.pendingAsk !== undefined || target.askParked === true)) {
      return { denied: 'worker is waiting for the user to answer its Guard/ask; a manager redirect cannot answer it', status: 409 };
    }
    const priorOperation = target.dispatch.redirectOperation;
    if (priorOperation && ['cancelling', 'dispatching', 'repointing'].includes(priorOperation.state)) {
      return { denied: 'worker already has a redirect in progress', status: 409 };
    }
    const canonicalOrder = target.dispatch.order;
    if (!canonicalOrder) return { denied: 'worker has no saved dispatch order; redirect requires its original order snapshot', status: 409 };
    const rawInstruction = input.instruction.trim();
    if (!rawInstruction || rawInstruction.length > MANAGER_REDIRECT_INSTRUCTION_MAX_CHARS) {
      return { denied: `redirect instruction must be 1-${MANAGER_REDIRECT_INSTRUCTION_MAX_CHARS} characters`, status: 400 };
    }
    const instruction = ctx.store.redactRunText(target.id, rawInstruction).trim();
    if (!instruction || instruction.length > MANAGER_REDIRECT_INSTRUCTION_MAX_CHARS) {
      return { denied: `redirect instruction must be 1-${MANAGER_REDIRECT_INSTRUCTION_MAX_CHARS} characters after redaction`, status: 400 };
    }
    const redirectInput = redirectDispatchInput(canonicalOrder, instruction);
    if (redirectInput.objective.length > 4_000) {
      return { denied: 'canonical objective plus redirect instruction exceeds the 4,000 character order limit', status: 400 };
    }
    const redirectOrigin: RedirectDispatchOrigin = { sourceRunId: target.id, canonicalOrder, instruction };
    // Exercise the same admission gates before the cancellation becomes irreversible. Dispatch
    // repeats them after cancellation, when in-flight and budget accounting reflect the new state.
    const preflight = ctx.dispatch(caller.id, redirectInput, { redirectOrigin, preflightOnly: true });
    if ('refused' in preflight) {
      const refusal = ctx.store.redactRunText(target.id, preflight.refused).replace(/\s+/g, ' ').trim()
        .slice(0, MANAGER_CANCEL_REASON_MAX_CHARS) || 'replacement admission refused';
      ctx.store.appendEvent(caller.id, {
        type: 'note',
        stepId: ctx.active.get(caller.id)?.currentStepId,
        message: `redirect preflight refused — ${refusal}`.slice(0, MANAGER_CANCEL_REASON_MAX_CHARS),
      });
      return { denied: refusal, status: 409 };
    }

    const requestedAt = new Date().toISOString();
    const operationId = randomUUID();
    ctx.updateDispatch(target.id, (dispatch) => ({
      ...dispatch,
      redirectOperation: { operationId, managerRunId: caller.id, state: 'cancelling', instruction, requestedAt },
      managerCancellation: {
        byRunId: caller.id,
        requestedAt,
        reason: 'redirected by manager',
      },
    }));
    ctx.redirecting.add(target.id);
    const title = ctx.store.redactRunText(target.id, target.title).replace(/\s+/g, ' ').slice(0, 120);
    ctx.store.appendEvent(target.id, {
      type: 'lifecycle',
      message: `cancelled by manager ${caller.id.slice(0, 8)} — redirected by manager`,
    });
    ctx.store.appendEvent(caller.id, {
      type: 'note',
      stepId: ctx.active.get(caller.id)?.currentStepId,
      message: `redirecting worker "${title}" (${target.id.slice(0, 8)}) — ${instruction.slice(0, 240)}`,
    });
    appendLedger(ctx.dataDir, target.dispatch.rootRunId, {
      type: 'redirect',
      runId: caller.id,
      sourceRunId: target.id,
      state: 'cancelling',
      instruction,
    });

    const cancelled = await cancelRedirectSource(ctx, target.id);
    if (!cancelled) {
      const refusal = ctx.isActive(target.id)
        ? 'source did not stop within 10 s'
        : `worker ${target.id.slice(0, 8)} could not be cancelled`;
      const safe = failRedirectOperation(ctx, target.id, refusal);
      return { denied: safe, status: 409 };
    }
    ctx.updateDispatch(target.id, (dispatch) => ({
      ...dispatch,
      redirectOperation: {
        ...dispatch.redirectOperation!,
        state: 'dispatching',
      },
    }));

    let outcome: { id: string; branch?: string } | { refused: string };
    try {
      outcome = ctx.dispatch(caller.id, redirectInput, { redirectOrigin });
    } catch (error) {
      const refusal = error instanceof Error ? error.message : String(error);
      return redirectFailure(ctx, target.id, refusal);
    }
    if ('refused' in outcome) return redirectFailure(ctx, target.id, outcome.refused);
    return finishRedirectOperation(ctx, target.id, outcome.id);
  }

export function redirectDispatchInput(order: DispatchOrderSnapshot, instruction: string): DispatchInput {
    return {
      title: order.title,
      objective: `${order.objective}\n\nManager redirect instruction:\n${instruction}`,
      kind: order.kind,
      ...(order.reviewOf !== undefined ? { review_of: order.reviewOf } : {}),
      ...(order.scope !== undefined ? { scope: order.scope } : {}),
      ...(order.allowedTools !== undefined ? { allowed_tools: order.allowedTools } : {}),
      ...(order.maxCost !== undefined ? { max_cost: order.maxCost } : {}),
      ...(order.successCriteria !== undefined ? { success_criteria: order.successCriteria } : {}),
      ...(order.requiredEvidence !== undefined ? { required_evidence: order.requiredEvidence } : {}),
      retry_limit: order.retryLimit,
      after: order.after,
      backend: order.backend,
      ...(order.model !== undefined ? { model: order.model } : {}),
      ...(order.partId !== undefined ? { partId: order.partId } : {}),
    };
  }

export async function cancelRedirectSource(ctx: ManagerControlContext, runId: string): Promise<boolean> {
    const current = ctx.store.getRun(runId);
    if (!current) return false;
    if (current.status === 'cancelled') return true;
    const wasActive = ctx.isActive(runId);
    // A restart loses the in-memory queue and active maps. Adopt the durable live record into the
    // shared cancel path so its lifecycle hooks, report and delivery expiry still run.
    if (!wasActive && !ctx.starting.has(runId) && !ctx.queue.includes(runId)) ctx.queue.push(runId);
    if (!ctx.cancel(runId)) return ctx.store.getRun(runId)?.status === 'cancelled';
    if ((wasActive || ctx.starting.has(runId)) && !await ctx.waitInactive(runId, 10_000)) return false;
    return ctx.store.getRun(runId)?.status === 'cancelled';
  }

export function redirectFailure(ctx: ManagerControlContext, sourceRunId: string, refusal: string): DispatchManagerRedirectFailure {
    const safe = failRedirectOperation(ctx, sourceRunId, refusal);
    return {
      error: `cancelled, replacement refused: ${safe}`.slice(0, 500),
      cancelledRunId: sourceRunId,
      retryAccounting: 'excluded',
    };
  }

  /** Persist the failed terminal state before releasing queued dependents to the normal blocker. */
export function failRedirectOperation(ctx: ManagerControlContext, sourceRunId: string, refusal: string): string {
    const source = ctx.store.getRun(sourceRunId);
    const safe = ctx.store.redactRunText(sourceRunId, refusal).trim().slice(0, MANAGER_CANCEL_REASON_MAX_CHARS) || 'replacement admission failed';
    const managerRunId = source?.dispatch?.redirectOperation?.managerRunId ?? source?.dispatch?.parentRunId;
    const rootRunId = source?.dispatch?.rootRunId;
    if (source?.dispatch?.redirectOperation && rootRunId) {
      ctx.updateDispatch(sourceRunId, (dispatch) => ({
        ...dispatch,
        redirectOperation: (() => {
          const { instruction: _instruction, ...operation } = dispatch.redirectOperation!;
          return { ...operation, state: 'failed' as const, refusal: safe };
        })(),
      }));
      ctx.store.appendEvent(sourceRunId, { type: 'note', message: `redirect failed — ${safe}` });
      if (managerRunId) ctx.store.appendEvent(managerRunId, { type: 'note', message: `redirect failed for worker ${sourceRunId.slice(0, 8)} — ${safe}` });
      appendLedger(ctx.dataDir, rootRunId, {
        type: 'redirect-failed',
        runId: managerRunId ?? rootRunId,
        sourceRunId,
        refusal: safe,
      });
    }
    ctx.redirecting.delete(sourceRunId);
    ctx.blockOrphanedDependents();
    void ctx.pump();
    return safe;
  }

  /** Complete the durable graph transaction; safe to rerun after a crash at any earlier write. */
export function finishRedirectOperation(ctx: ManagerControlContext, sourceRunId: string, replacementRunId: string): DispatchManagerRedirectResult {
    const source = ctx.store.getRun(sourceRunId);
    const replacement = ctx.store.getRun(replacementRunId);
    const operation = source?.dispatch?.redirectOperation;
    if (!source?.dispatch || !operation || !replacement?.dispatch) {
      throw new Error('redirect records disappeared before graph repair completed');
    }
    ctx.redirecting.add(sourceRunId);
    ctx.updateDispatch(sourceRunId, (dispatch) => ({
      ...dispatch,
      redirectedTo: replacementRunId,
      redirectOperation: { ...operation, state: 'repointing', replacementRunId },
    }));
    ctx.updateDispatch(replacementRunId, (dispatch) => ({ ...dispatch, redirectedFrom: sourceRunId }));
    const repointedDependents = repointQueuedDependents(ctx, source, replacement);
    ctx.updateDispatch(sourceRunId, (dispatch) => ({
      ...dispatch,
      redirectOperation: (() => {
        const { instruction: _instruction, ...operation } = dispatch.redirectOperation!;
        return { ...operation, state: 'complete' as const, replacementRunId };
      })(),
    }));
    appendLedger(ctx.dataDir, source.dispatch.rootRunId, {
      type: 'redirect-complete',
      runId: operation.managerRunId,
      sourceRunId,
      replacementRunId,
      repointedDependents,
    });
    ctx.store.appendEvent(operation.managerRunId, {
      type: 'note',
      message: `redirected worker ${sourceRunId.slice(0, 8)} to ${replacementRunId.slice(0, 8)}; repointed ${repointedDependents} queued dependents`,
    });
    ctx.redirecting.delete(sourceRunId);
    void ctx.pump();
    const savedReplacement = ctx.store.getRun(replacementRunId)!;
    return {
      cancelledRunId: sourceRunId,
      replacement: { id: replacementRunId, ...(savedReplacement.branch ? { branch: savedReplacement.branch } : {}) },
      repointedDependents,
      retryAccounting: 'excluded',
    };
  }

export function repointQueuedDependents(ctx: ManagerControlContext, source: RunRecord, replacement: RunRecord): number {
    const parentRunId = source.dispatch?.parentRunId;
    if (!parentRunId || !source.dispatch) return 0;
    let repointed = 0;
    for (const candidate of ctx.store.listRuns()) {
      const dispatch = candidate.dispatch;
      if (candidate.status !== 'queued' || dispatch?.parentRunId !== parentRunId || !dispatch.after?.includes(source.id)) continue;
      // A replacement takes the source's graph position as the new fork point; the other edges
      // keep their original order after it so dependents inherit the replacement's branch.
      const after = [replacement.id, ...dispatch.after.filter((id) => id !== source.id && id !== replacement.id)];
      ctx.updateDispatch(candidate.id, (current) => ({
        ...current,
        after,
        ...(current.order ? { order: { ...current.order, after } } : {}),
      }));
      const refreshed = ctx.store.getRun(candidate.id);
      if (refreshed) ctx.refreshQueuedDependencyEnvelope(refreshed);
      repointed += 1;
    }
    return repointed;
  }

export async function recoverRedirectOperations(ctx: ManagerControlContext): Promise<void> {
    const operations = ctx.store.listRuns().filter((run) =>
      run.dispatch?.redirectOperation
      && ['cancelling', 'dispatching', 'repointing'].includes(run.dispatch.redirectOperation.state),
    );
    for (const source of operations) ctx.redirecting.add(source.id);
    for (const snapshot of operations) {
      const source = ctx.store.getRun(snapshot.id);
      const operation = source?.dispatch?.redirectOperation;
      if (!source?.dispatch || !operation) continue;
      const linked = ctx.store.listRuns().find((run) =>
        run.dispatch?.rootRunId === source.dispatch?.rootRunId
        && (run.dispatch?.redirectedFrom === source.id || run.id === operation.replacementRunId),
      );
      if (linked) {
        finishRedirectOperation(ctx, source.id, linked.id);
        continue;
      }
      const order = source.dispatch.order;
      const instruction = operation.instruction;
      if (!order || !instruction) {
        failRedirectOperation(ctx, source.id, 'redirect could not recover its saved order or instruction');
        continue;
      }
      if (source.status !== 'cancelled') {
        const now = new Date().toISOString();
        if (!source.dispatch.managerCancellation) {
          ctx.updateDispatch(source.id, (dispatch) => ({
            ...dispatch,
            managerCancellation: { byRunId: operation.managerRunId, requestedAt: operation.requestedAt ?? now, reason: 'redirected by manager' },
          }));
        }
        if (!await cancelRedirectSource(ctx, source.id)) {
          failRedirectOperation(ctx, source.id, `worker ${source.id.slice(0, 8)} could not be cancelled during redirect recovery`);
          continue;
        }
      }
      ctx.updateDispatch(source.id, (dispatch) => ({
        ...dispatch,
        redirectOperation: { ...dispatch.redirectOperation!, state: 'dispatching' },
      }));
      const origin: RedirectDispatchOrigin = { sourceRunId: source.id, canonicalOrder: order, instruction };
      let outcome: { id: string; branch?: string } | { refused: string };
      try {
        outcome = ctx.dispatch(operation.managerRunId, redirectDispatchInput(order, instruction), { redirectOrigin: origin });
      } catch (error) {
        const refusal = error instanceof Error ? error.message : String(error);
        failRedirectOperation(ctx, source.id, refusal);
        continue;
      }
      if ('refused' in outcome) {
        failRedirectOperation(ctx, source.id, outcome.refused);
        continue;
      }
      finishRedirectOperation(ctx, source.id, outcome.id);
    }
  }

export function managerDeliveryFor(ctx: ManagerControlContext, runId: string, deliveryId: string): DispatchManagerDeliveryRecord | undefined {
    return ctx.store.getRun(runId)?.dispatch?.managerDeliveries?.find((delivery) => delivery.deliveryId === deliveryId);
  }

export function recordManagerDeliveryTransition(ctx: ManagerControlContext,
    runId: string,
    deliveryId: string,
    state: DispatchManagerDeliveryState,
    reasonCode?: DispatchManagerDeliveryReasonCode,
  ): void {
    const run = ctx.store.getRun(runId);
    const previous = run?.dispatch?.managerDeliveries?.find((delivery) => delivery.deliveryId === deliveryId);
    if (!run?.dispatch || !previous || previous.state === state) return;
    const allowed = previous.state === 'queued'
      ? ['delivered', 'rejected', 'expired'].includes(state)
      : previous.state === 'delivered' && ['acknowledged', 'rejected'].includes(state);
    if (!allowed) return;
    const { reasonCode: _previousReason, ...withoutReason } = previous;
    const updated: DispatchManagerDeliveryRecord = {
      ...withoutReason,
      state,
      updatedAt: new Date().toISOString(),
      ...(reasonCode ? { reasonCode } : {}),
    };
    ctx.updateDispatch(runId, (dispatch) => ({
      ...dispatch,
      managerDeliveries: [
        ...(dispatch.managerDeliveries ?? []).filter((delivery) => delivery.deliveryId !== deliveryId),
        updated,
      ].slice(-MANAGER_DELIVERIES_MAX_RETAINED),
    }));
    appendLedger(ctx.dataDir, run.dispatch.rootRunId, {
      type: 'message-delivery',
      targetRunId: runId,
      deliveryId,
      state,
      capability: previous.capability,
      ...(reasonCode ? { reasonCode } : {}),
    });
  }

export function recordManagerUserMessage(ctx: ManagerControlContext, runId: string, text: string): void {
    ctx.store.appendEvent(runId, {
      type: 'user-message',
      stepId: ctx.active.get(runId)?.currentStepId,
      text,
      imageCount: 0,
      images: [],
    });
  }

export function markQueuedManagerDeliveriesDelivered(ctx: ManagerControlContext, runId: string): void {
    const run = ctx.store.getRun(runId);
    const ids = new Set([
      ...(run?.queuedMessages ?? []).flatMap((message) => message.managerDeliveryId ? [message.managerDeliveryId] : []),
      ...(ctx.continuationManagerDeliveryIds.get(runId) ?? []),
    ]);
    for (const id of ids) recordManagerDeliveryTransition(ctx, runId, id, 'delivered');
    ctx.continuationManagerDeliveryIds.delete(runId);
  }

export function expireUnacceptedManagerDeliveries(ctx: ManagerControlContext, runId: string, reasonCode: 'target-settled' | 'process-restarted'): void {
    const run = ctx.store.getRun(runId);
    if (!run?.dispatch) return;
    const persistedQueueIds = new Set((run.queuedMessages ?? []).flatMap((message) => message.managerDeliveryId ? [message.managerDeliveryId] : []));
    for (const delivery of run.dispatch.managerDeliveries ?? []) {
      if (delivery.state !== 'queued') continue;
      if (reasonCode === 'process-restarted' && persistedQueueIds.has(delivery.deliveryId) && !isTerminalStatus(run.status)) continue;
      if (reasonCode === 'target-settled' && !isTerminalStatus(run.status)) continue;
      recordManagerDeliveryTransition(ctx, runId, delivery.deliveryId, 'expired', reasonCode);
    }
  }

export function expireLostManagerDeliveriesAfterRestart(ctx: ManagerControlContext): void {
    for (const run of ctx.store.listRuns()) expireUnacceptedManagerDeliveries(ctx, run.id, 'process-restarted');
  }

export async function peekEntry(ctx: ManagerControlContext,
    run: RunRecord,
    opts: { filesMax: number; tailLines?: number; tailMaxChars?: number },
  ): Promise<DispatchPeekEntry> {
    // The tail read and the last-event read are the same read: one event answers the silence
    // question, and a tail needs a handful more to fill its lines.
    const events = ctx.store.readEventsTail(run.id, opts.tailLines === undefined ? 1 : Math.min(240, opts.tailLines * 4));
    const files = run.worktreePath
      ? await worktreeChangedFilesReadOnly(run.worktreePath, run.baseBranch ?? 'HEAD', { max: opts.filesMax })
      : { files: [] as string[], omitted: 0, state: 'unavailable' as const };
    const tail = opts.tailLines === undefined
      ? { lines: [] as string[], truncated: false }
      : peekTail(events, {
          maxLines: opts.tailLines,
          ...(opts.tailMaxChars !== undefined ? { maxChars: opts.tailMaxChars } : {}),
          redact: (line) => ctx.store.redactRunText(run.id, line),
        });
    const step = run.currentStepId ? run.steps.find((candidate) => candidate.id === run.currentStepId) : undefined;
    const lastManagerDelivery = run.dispatch?.managerDeliveries?.at(-1);
    return {
      id: run.id,
      title: run.title,
      ...(run.runner ? { runner: run.runner } : {}),
      ...(run.model ? { model: run.model } : {}),
      status: run.status,
      ...(run.activity ? { activity: run.activity } : {}),
      ...(run.branch ? { branch: run.branch } : {}),
      ...(run.baseBranch ? { baseBranch: run.baseBranch } : {}),
      ...(run.startedAt ? { startedAt: run.startedAt } : {}),
      ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
      ...(run.costUsd !== undefined ? { costUsd: run.costUsd } : {}),
      tokensUsed: run.tokensUsed,
      ...(step ? { currentStep: { name: step.name, status: step.status } } : {}),
      files: files.files,
      filesOmitted: files.omitted,
      filesState: files.state,
      quietMinutes: quietMinutesOf(events),
      ...(lastManagerDelivery
        ? {
            lastManagerDelivery: {
              deliveryId: lastManagerDelivery.deliveryId,
              state: lastManagerDelivery.state,
              capability: lastManagerDelivery.capability,
              ...(lastManagerDelivery.reasonCode ? { reasonCode: lastManagerDelivery.reasonCode } : {}),
            },
          }
        : {}),
      tail: tail.lines,
      tailTruncated: tail.truncated,
    };
  }

  /**
   * `POST /runs/:id/verify` — the root manager has onni run the repository's checks inside a SETTLED
   * worker's worktree (wave A1). `:id` is the caller; the worker travels in `input.target`. Every
   * refusal about WHO or WHICH STATE is a 4xx; "cannot run here" is a 200 `unavailable` value.
   * This is a barrier, not a sandbox: it runs repo-defined scripts from a tree the worker wrote.
   */
