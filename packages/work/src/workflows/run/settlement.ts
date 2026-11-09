import { mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { attachmentExtension, storedAttachmentExtension } from '@onni/contract';
import type { ContentBlock } from '../../core/agent-runner.ts';
import { completionReason } from '../completion-reason.ts';
import { generateCommitMessage } from '../commit-message.ts';
import { isLifecycleConfigTracked } from '../../worktree-lifecycle/config.ts';
import {
  attachmentLibraryDir,
  copyToAttachmentLibrary,
  highestImageSeq,
  imageLibraryNames,
} from './preparation.ts';
import type { PersistedAttachment, PastedContent } from './preparation.ts';
import { hasUnlanded, landInPlace } from '../landing.ts';
import type { LandResult } from '../landing.ts';
import { unregisterRunProcess } from '../../core/process-usage.ts';
import { autoNamingActive, liveTitleUpdatesEnabled, postValidateTitle } from '../../runs/auto-name.ts';
import { parseTaskMarkers } from '../../runs/task-markers.ts';
import { reviewGateEnabled } from '../../runs/review-gate.ts';
import { childrenOf } from '../../dispatch/engine.ts';
import { isUnattended } from '../unattended.ts';
import { loadConfig, type OnniConfig } from '../../config.ts';
import { worktreeDiff, worktreeShortstat } from '../../git-worktree.ts';
import { getRepoInfo } from '../../server/git.ts';
import { stepKind } from '../types.ts';
import type { RunRecord } from '../../runs/store.ts';
import type { SettlementActiveRun, SettlementContext } from './internal-types.ts';

export const MAX_LAND_ATTEMPTS = 3;

export interface LandAnswer {
  outcome: 'landed' | 'nothing' | 'failed' | 'busy' | 'unavailable';
  message: string;
  sha?: string;
  pushed?: boolean;
}

function landFailurePrompt(outcome: Extract<LandResult, { result: 'failed' }>): string {
  return `onni could not land your changes — ${outcome.stage} failed:\n\n${outcome.error}\n\nFix this, then end your turn with ONNI:DONE again.`;
}

function landAnswer(outcome: LandResult, base: string, withAgent: boolean): LandAnswer {
  if (outcome.result === 'landed') {
    return {
      outcome: 'landed',
      message: `landed ${outcome.sha.slice(0, 8)} on ${base}${outcome.pushed ? ' and pushed' : ' (committed locally — no upstream)'}`,
      sha: outcome.sha,
      pushed: outcome.pushed,
    };
  }
  if (outcome.result === 'nothing') return { outcome: 'nothing', message: 'nothing to commit' };
  return {
    outcome: 'failed',
    message: withAgent ? `${outcome.stage} failed — sent back to the agent to fix` : `${outcome.stage} failed`,
  };
}

export async function recordTurnEnd(
  ctx: SettlementContext,
  runId: string,
  turnText: string,
  owner?: SettlementActiveRun,
): Promise<void> {
  // The namer can finish after session cleanup removes its in-memory secrets.
  turnText = ctx.store.redactRunText(runId, turnText);
  try {
    const run = ctx.store.getRun(runId);
    if (!run) return;
    if (owner && ctx.active.get(runId) !== owner) return;
    ctx.applyTurnMarkers(runId, run, turnText);
    // Titles are the namer's job (task auto-naming spec) — turn text is
    // deliberately NEVER a title source; see maybeRefreshTitle below. The
    // one exception is an explicit ONNI:TITLE declaration (applied above).
    if (run.worktreePath && existsSync(run.worktreePath)) {
      // `taskBranch` + `runStartedAt` are what keep this number *this task's* (#751): a
      // review/QA run repoints the worktree onto the branch under review, and without the
      // branch to compare HEAD against and the moment it was checked out, the stat would
      // claim that whole branch's diff.
      const stat = await worktreeShortstat(run.worktreePath, run.baseBranch ?? 'HEAD', {
        taskBranch: run.branch,
        runStartedAt: run.startedAt,
      });
      if (!owner || ctx.active.get(runId) === owner) {
        if (stat) ctx.store.updateRun(runId, { diffStat: stat });
        else ctx.store.appendEvent(runId, { type: 'note', message: 'diff stat unavailable — git diff --shortstat failed in the worktree' });
      }
    }
    await ctx.maybeRefreshTitle(runId, turnText);
  } catch {
    // Bookkeeping only — nothing here may disturb the run.
  }
}

/**
 * In-band declarations from the finished turn (spec
 * 2026-07-18-task-ref-markers): the main thread's own `ONNI:PR=` /
 * `ONNI:ISSUE=` / `ONNI:TITLE=` lines, parsed from the accumulated turn text
 * like `ONNI:DONE` — never from tool output. Declared numbers overwrite the
 * regex/namer display tier (the store re-resolves the referenced-PR chip);
 * a declared title takes `titleOrigin: 'marker'`, which beats the namer but
 * never a user rename, and silences the live refresh below.
 */
export function applyTurnMarkers(ctx: SettlementContext, runId: string, run: RunRecord, turnText: string): void {
  const markers = parseTaskMarkers(turnText);
  if (markers.pr !== undefined || markers.issue !== undefined) {
    ctx.store.applyMarkerRefs(runId, { pr: markers.pr, issue: markers.issue });
  }
  if (markers.title && run.titleOrigin !== 'user') {
    const current = ctx.store.getRun(runId);
    const refNumber = current?.prNumber ?? current?.issueNumber;
    const validated = postValidateTitle(markers.title, refNumber);
    // Same junk guard as composeNameResult: a declaration that validates to
    // nothing (or to a bare number prefix) must not blank the title.
    if (validated && validated !== `${refNumber}:`) {
      ctx.store.updateRun(runId, { titleSummary: validated, titleOrigin: 'marker' });
    }
  }
}

/**
 * Live title refresh (task auto-naming spec, step 3): re-run the namer with
 * the turn's context. Skips: toggle off (`liveTitleUpdates` config over
 * `ONNI_TITLE_UPDATES` env, default ON), user-owned title, marker-owned title
 * (the agent declares via `ONNI:TITLE` — the token-saving fast path), dry-run
 * mocks (canned answers add nothing), empty turn text, unchanged namer inputs.
 */
export async function maybeRefreshTitle(ctx: SettlementContext, runId: string, turnText: string): Promise<void> {
  if (!autoNamingActive()) return;
  if (!turnText.trim()) return;
  const config = await loadConfig(ctx.repoRoot);
  if (!liveTitleUpdatesEnabled(config)) return;
  const run = ctx.store.getRun(runId);
  if (!run || run.titleOrigin === 'user' || run.titleOrigin === 'marker') return;
  const statText = run.diffStat ? `${run.diffStat.files} files, +${run.diffStat.adds} -${run.diffStat.dels}` : undefined;
  const key = `${turnText.slice(0, 200)}|${statText ?? ''}`;
  if (ctx.lastNamerKey.get(runId) === key) return;
  ctx.lastNamerKey.set(runId, key);
  const workflow = await ctx.reviveWorkflow(run);
  const skillName = workflow?.steps.find((s) => stepKind(s) === 'agent' && s.skill)?.skill?.trim();
  void ctx.autoNameRun(runId, skillName, run.task, { turnText, diffStat: statText });
}

/**
 * End-of-session telemetry (#348): stop sampling the run's process tree and
 * fold the session's peaks into the run record. `max` with existing values —
 * a run can hold several sessions (multiple agent steps, Continue) and the
 * record keeps the highest water mark across all of them.
 */
export function recordUsagePeaks(ctx: SettlementContext, runId: string, owner: SettlementActiveRun): void {
  // unregisterRunProcess is keyed by run id, so an old generation must not
  // remove telemetry belonging to a replacement owner.
  if (ctx.active.get(runId) !== owner) return;
  const peaks = unregisterRunProcess(runId);
  if (!peaks) return;
  const run = ctx.store.getRun(runId);
  ctx.store.updateRun(runId, {
    peakRssBytes: Math.max(run?.peakRssBytes ?? 0, peaks.peakRssBytes),
    peakProcCount: Math.max(run?.peakProcCount ?? 0, peaks.peakProcCount),
  });
}

/**
 * Settle a run whose session closed while it was parked for a reply that never came — a
 * mid-workflow `ONNI:ASK` (#917) or a monitor handed to the user. `settleSuccess` would put a
 * finished badge on work the agent said was still open; `failed` says what happened and keeps
 * the Continue button, which reopens the session so the reply can still be given.
 */
export function settleUnansweredPark(
  ctx: SettlementContext,
  runId: string,
  finishedAt: string,
  monitorHandoff: boolean,
): void {
  const run = ctx.store.getRun(runId);
  const stepsLeft = run?.steps.some((s) => s.status === 'pending') ?? false;
  for (const s of run?.steps ?? []) {
    if (s.status === 'running' || s.status === 'waiting') {
      ctx.store.updateStep(runId, s.id, { status: 'failed', finishedAt });
    }
  }
  // Continue reopens the session through `runContinuation`, a standalone continuation rather
  // than a re-entry into `execute`, so steps the park never reached stay `pending`.
  const expired = ctx.active.get(runId)?.waitExpired === true;
  const error = expired
    ? 'nobody answered in time — the unattended run ended; its worktree and session are kept, continue to answer'
    : monitorHandoff && !stepsLeft
      ? 'the session closed before you replied — continue to reply'
      : 'the session closed before the question was answered — continue to answer it' +
        (stepsLeft ? ', but the remaining workflow steps will not resume automatically' : '');
  ctx.store.updateRun(runId, {
    status: 'failed',
    error,
    finishedAt,
    currentStepId: undefined,
    askParked: undefined,
    // The question is still unanswered: the run stays under "needs you".
    awaitingAnswerSince: finishedAt,
    ...(expired ? { waitExpiredAt: finishedAt } : {}),
  });
  ctx.store.appendEvent(runId, { type: 'lifecycle', message: `run stopped — ${error}` });
}

/**
 * Diff-first review gate (spec 009), shared by `execute` and
 * `runContinuation`: a *successful* run whose worktree holds changes rests
 * at `review` instead of `done` — the user inspects the diff first, then
 * sends feedback back, opens a draft PR, or just finishes. Failed/cancelled
 * runs never enter review; no worktree or an empty diff means plain `done`.
 *
 * The gate is opt-in (#489): the review park happens only when it is enabled
 * (`reviewGateEnabled` — config toggle over the `ONNI_REVIEW_GATE` env, default
 * OFF) AND the run is not autonomous. Autonomous runs — and runs with the gate
 * off — settle straight to `done`, leaving the diff in the worktree untouched.
 */
export async function settleSuccess(
  ctx: SettlementContext,
  runId: string,
  owner?: SettlementActiveRun,
): Promise<boolean> {
  const run = ctx.store.getRun(runId);
  const status = run?.status;
  // Recovery has no active owner. Both recovery and execution must still own the
  // same lifecycle decision after Git yields: cancellation or a new continuation wins.
  const canSettle = () => !!run && ctx.store.getRun(runId) === run && run.status === status &&
    ctx.active.get(runId) === owner && !owner?.cancelled &&
    (status === 'running' || status === 'waiting');
  if (!canSettle()) return false;
  // A manager that finishes without having handed anything to a worker did the whole job
  // itself (or ignored its roster): say so once, where the transcript and the digest can see it.
  if (run?.roster && !run.managerDidNotDelegate && childrenOf(ctx.store.listRuns(), runId).length === 0) {
    ctx.store.updateRun(runId, { managerDidNotDelegate: true });
    ctx.store.appendEvent(runId, { type: 'note', message: 'manager did not delegate — it finished without giving any task to a worker' });
  }
  const landingError = await ctx.landBeforeSettle(runId);
  if (!canSettle()) return false;
  if (landingError === 'review') {
    ctx.store.updateRun(runId, {
      status: 'review',
      finishedAt: new Date().toISOString(),
      currentStepId: undefined,
      autoResumeAttempts: undefined,
      autoResumeReason: undefined,
    });
    ctx.store.appendEvent(runId, {
      type: 'lifecycle',
      message: 'changes ready for review — check Changes, Continue with corrections, or Commit (or Finish) to land them',
    });
    return true;
  }
  if (landingError) {
    ctx.store.updateRun(runId, {
      status: 'failed',
      error: landingError,
      finishedAt: new Date().toISOString(),
      currentStepId: undefined,
    });
    ctx.store.appendEvent(runId, { type: 'lifecycle', message: `run failed — ${landingError}` });
    return true;
  }
  const review = await ctx.reviewGateApplies(runId);
  if (!canSettle()) return false;
  const resolution = !review && ctx.store.hasLifecycleObserver ? await completionReason(run) : 'completed';
  if (!canSettle()) return false;
  ctx.store.updateRun(runId, {
    status: review ? 'review' : 'done',
    completionReason: review ? undefined : resolution,
    finishedAt: new Date().toISOString(),
    currentStepId: undefined,
    // A run that got all the way to a settled turn is not in a limit loop, so the resume
    // counter starts over — otherwise a task that legitimately met the limit once a week would
    // creep toward the cap forever and stop resuming for no reason anyone could see.
    autoResumeAttempts: undefined,
    autoResumeReason: undefined,
  });
  ctx.store.appendEvent(runId, {
    type: 'lifecycle',
    message: review
      ? 'changes ready for review — send feedback, open a draft PR, or finish'
      : 'run finished',
  });
  return true;
}

/**
 * The auto-land policy of an in-place run (spec 2026-10-20-trunk-based-projects), or
 * undefined. Like worktree scripts, a git-tracked config.json cannot grant it: pushing to the
 * base branch is the owner's permission, never the repository's.
 */
export async function landingPolicy(
  ctx: SettlementContext,
  run: RunRecord | undefined,
  config: OnniConfig,
  note?: (message: string) => void,
): Promise<SettlementActiveRun['autoLand']> {
  if (!run || run.worktree !== false || run.readOnly || run.inPlaceBranch || config.landing !== 'auto') return undefined;
  // Nothing unattended pushes to the base branch: no env, config or agent request can grant it.
  if (isUnattended(run)) {
    note?.('auto-land is off — an autonomous or dispatched run only commits in its own worktree');
    return undefined;
  }
  const repo = await getRepoInfo(ctx.repoRoot);
  if (!repo) return undefined;
  if (await isLifecycleConfigTracked(ctx.repoRoot).catch(() => true)) {
    note?.('auto-land is off — .ai/onni/config.json is tracked by git, and only local configuration can grant it');
    return undefined;
  }
  return { checks: config.requiredChecks ?? [], baseBranch: config.baseBranch, baseLabel: config.baseBranch ?? repo.branch, attempts: 0 };
}

/** The most recent thing the user asked this task for — context for a commit message. */
export function latestRequest(ctx: SettlementContext, runId: string): string | undefined {
  const events = ctx.store.readEvents(runId);
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i] as { type?: string; text?: unknown };
    if (event.type === 'user-message' && typeof event.text === 'string' && event.text.trim()) return event.text;
  }
  return ctx.store.getRun(runId)?.task;
}

/**
 * Capture the lifecycle that requested a landing before any await. Continue appends a
 * step synchronously, even when deferred, so its step count is a durable generation
 * fence (including a newer turn that has already returned to the same status).
 * Owner identity alone cannot fence detached review/Commit operations.
 */
export function landingFence(ctx: SettlementContext, runId: string): () => boolean {
  const run = ctx.store.getRun(runId);
  const status = run?.status;
  const generation = run?.steps.length;
  const owner = ctx.active.get(runId);
  return () => !!run && ctx.store.getRun(runId) === run &&
    run.status === status && run.steps.length === generation &&
    ctx.active.get(runId) === owner && !owner?.cancelled &&
    (!!owner || !ctx.isActive(runId));
}

/** Land now and record the outcome on the run. A `nothing` never overwrites an earlier result. */
export async function landNow(
  ctx: SettlementContext,
  runId: string,
  policy: NonNullable<SettlementActiveRun['autoLand']>,
): Promise<LandResult> {
  const canLand = ctx.landingFence(runId);
  const run = ctx.store.getRun(runId);
  ctx.store.appendEvent(runId, {
    type: 'note',
    message: `auto-land — committing, rebasing${policy.checks.length ? ', running required checks' : ''} and pushing`,
  });
  const env = { ...process.env, ...ctx.agentEnv(runId) };
  const outcome = await landInPlace(ctx.repoRoot, {
    // From the staged change itself: the title names the first request and goes stale.
    describe: async (staged) => {
      const written = await generateCommitMessage(ctx.repoRoot, staged, ctx.latestRequest(runId));
      if (written.subject === undefined && staged.files.length > 0) {
        ctx.store.appendEvent(runId, {
          type: 'note',
          message: `commit message named from the files — ${ctx.store.redactRunText(runId, written.reason)}`,
        });
      }
      return written.subject;
    },
    baseBranch: policy.baseBranch,
    since: run?.baseBranch,
    checks: policy.checks,
    env,
  });
  if (!canLand()) return outcome;
  const at = new Date().toISOString();
  if (outcome.result === 'landed') {
    ctx.store.updateRun(runId, {
      landing: { status: 'landed', at, branch: outcome.branch, sha: outcome.sha, pushed: outcome.pushed, files: outcome.files },
    });
    ctx.store.appendEvent(runId, {
      type: 'note',
      message: `landed ${outcome.sha.slice(0, 8)} on ${outcome.branch}${outcome.pushed ? ' and pushed' : ' (no upstream — committed locally)'}: ${outcome.files.length} file${outcome.files.length === 1 ? '' : 's'}`,
    });
  } else if (outcome.result === 'nothing') {
    if (!run?.landing) ctx.store.updateRun(runId, { landing: { status: 'nothing', at } });
    ctx.store.appendEvent(runId, { type: 'note', message: 'auto-land — nothing to land' });
  } else {
    ctx.store.updateRun(runId, { landing: { status: 'failed', at, stage: outcome.stage, error: ctx.store.redactRunText(runId, outcome.error) } });
  }
  return outcome;
}

/**
 * `ONNI:DONE` on an auto-land run: it parks for review and the user's Finish lands it
 * (`finish`). Only attended runs have an `autoLand` (ADR 0005), so there is no autonomous
 * branch. True when it took the turn over. Both turn-end handlers call it.
 */
export function landOnDone(
  ctx: SettlementContext,
  runId: string,
  state: SettlementActiveRun,
  stepId: string | undefined,
  close: () => void,
): boolean {
  if (!state.autoLand || state.cancelled) return false;
  void hasUnlanded(ctx.repoRoot).then((pending) => {
    if (state.cancelled || ctx.active.get(runId) !== state) return;
    if (!pending) {
      close();
      return;
    }
    ctx.parkForReview(runId, state, stepId);
  });
  return true;
}

/** The waiting park of an interactive auto-land run with changes: the session and the
 *  working-tree lease stay, so the user can review, send corrections, or Finish to land. */
export function parkForReview(
  ctx: SettlementContext,
  runId: string,
  state: SettlementActiveRun,
  stepId: string | undefined,
): void {
  ctx.store.updateRun(runId, { status: 'waiting', activity: undefined });
  if (stepId) ctx.store.updateStep(runId, stepId, { status: 'waiting' });
  ctx.leaveMonitoring(runId);
  ctx.clearMonitoringWakeTimer(state, runId);
  ctx.store.appendEvent(runId, {
    type: 'note',
    stepId,
    message: `changes ready for review — check Changes, reply with corrections, or Commit to ${state.autoLand?.baseLabel ?? 'the base branch'} (or Finish) to land them`,
  });
  ctx.waiting.add(runId);
  ctx.armIdleTimer(runId, state);
  ctx.releaseSlot();
}

/** Land with the session still open, so a failure goes back to the agent to fix. The promise
 *  of the landing, shared while one is in flight; undefined when the run has no landing policy. */
export function landWithAgent(
  ctx: SettlementContext,
  runId: string,
  state: SettlementActiveRun,
  stepId: string | undefined,
  close: () => void,
): Promise<LandResult> | undefined {
  const policy = state.autoLand;
  if (!policy || state.cancelled) return undefined;
  if (policy.inFlight) return policy.inFlight;
  policy.inFlight = ctx.landNow(runId, policy)
    .catch((err: unknown): LandResult => ({ result: 'failed', stage: 'commit', error: err instanceof Error ? err.message : String(err) }))
    .then((outcome) => {
      policy.inFlight = undefined;
      if (state.cancelled || ctx.active.get(runId) !== state) return outcome;
      if (outcome.result !== 'failed') {
        close();
        return outcome;
      }
      policy.attempts += 1;
      if (policy.attempts >= MAX_LAND_ATTEMPTS) {
        ctx.store.appendEvent(runId, {
          type: 'note',
          stepId,
          message: `auto-land failed ${policy.attempts} times (${outcome.stage}) — not landed; fix it and Commit again`,
        });
        close();
        return outcome;
      }
      if (!ctx.deliverMessage(runId, [{ type: 'text', text: ctx.store.redactRunText(runId, landFailurePrompt(outcome)) }], false)) {
        close();
        return outcome;
      }
      ctx.store.appendEvent(runId, {
        type: 'note',
        stepId,
        message: `auto-land failed at ${outcome.stage} — sent back to the agent (${policy.attempts}/${MAX_LAND_ATTEMPTS})`,
      });
      return outcome;
    });
  return policy.inFlight;
}

/**
 * The header's Commit step on an in-place task (spec 2026-10-20-trunk-based-projects), in any
 * state: with the session open it lands like Finish; with it closed it lands directly, and a
 * failure reopens the task with the error so the agent fixes it. Never throws.
 */
export async function land(ctx: SettlementContext, runId: string): Promise<LandAnswer> {
  const canLand = ctx.landingFence(runId);
  const superseded: LandAnswer = { outcome: 'busy', message: 'the task changed while landing — use its current state' };
  const run = ctx.store.getRun(runId);
  if (!run || run.worktree !== false || run.readOnly) {
    return { outcome: 'unavailable', message: 'only a task that works in the checkout can commit to the base branch' };
  }
  const policy = await ctx.landingPolicy(run, await loadConfig(ctx.repoRoot));
  if (!canLand()) return superseded;
  if (!policy) return { outcome: 'unavailable', message: 'auto-land is not enabled for this project' };
  const base = policy.baseBranch ?? (await getRepoInfo(ctx.repoRoot))?.branch ?? 'the base branch';
  if (!canLand()) return superseded;
  const state = ctx.active.get(runId);
  if (state?.session?.open && run.status === 'waiting') {
    if (state.repoRootParked) {
      return { outcome: 'busy', message: 'this task lent the checkout to another task while it waits — commit once it resumes' };
    }
    ctx.clearIdleTimer(state);
    state.idleClosed = undefined;
    if (state.askPark === 'waiting') state.askPark = 'abandoned';
    const landing = ctx.landWithAgent(runId, state, state.currentStepId, () => {
      state.finishRequested = true;
      state.session?.end();
    });
    if (!landing) return { outcome: 'busy', message: 'the task is stopping — try again in a moment' };
    return landAnswer(await landing, base, true);
  }
  if (state || ctx.isActive(runId)) {
    return { outcome: 'busy', message: 'the agent is still working — commit once its turn ends' };
  }
  if (ctx.repoRootBusy() > 0) {
    return { outcome: 'busy', message: 'another task is working in the checkout — commit once it is done' };
  }
  // Hold the tree while landing, so a task queued behind cannot edit the checkout mid-rebase.
  const lease = ctx.chainRepoRoot();
  let outcome: LandResult;
  try {
    const pending = await hasUnlanded(ctx.repoRoot);
    if (!canLand()) return superseded;
    if (!pending) return { outcome: 'nothing', message: 'nothing to commit' };
    outcome = await ctx.landNow(runId, policy);
  } finally {
    lease.release();
  }
  if (!canLand()) return superseded;
  if (outcome.result === 'failed') {
    // Help rather than refuse: the session is gone, so reopen the task with the error.
    const reopened = ctx.continueRun(runId, { text: landFailurePrompt(outcome) });
    return reopened.ok
      ? { outcome: 'failed', message: `${outcome.stage} failed — sent back to the agent to fix` }
      : { outcome: 'failed', message: `${outcome.stage} failed: ${ctx.store.redactRunText(runId, outcome.error).split('\n')[0]}` };
  }
  if (run.status !== 'done') {
    ctx.store.updateRun(runId, { status: 'done', completionReason: 'accepted', error: undefined });
    ctx.store.appendEvent(runId, { type: 'lifecycle', message: 'changes landed' });
  }
  return landAnswer(outcome, base, false);
}

/** Accept an in-place run resting at `review`: land it when the project auto-lands, else the
 *  ordinary accept. */
export async function finishReview(ctx: SettlementContext, runId: string): Promise<void> {
  const canLand = ctx.landingFence(runId);
  const run = ctx.store.getRun(runId);
  if (run?.status !== 'review' || !canLand()) return;
  const policy = await ctx.landingPolicy(run, await loadConfig(ctx.repoRoot));
  if (!canLand()) return;
  if (!policy) {
    ctx.store.updateRun(runId, { status: 'done', completionReason: 'accepted' });
    ctx.store.appendEvent(runId, { type: 'lifecycle', message: 'review accepted — finished without a PR' });
    return;
  }
  if (ctx.repoRootBusy() > 0) {
    ctx.store.appendEvent(runId, {
      type: 'note',
      message: 'not landed — another task is working in the checkout; Finish again once it is done',
    });
    return;
  }
  const lease = ctx.chainRepoRoot();
  let outcome: LandResult;
  try {
    outcome = await ctx.landNow(runId, policy);
  } finally {
    lease.release();
  }
  if (!canLand()) return;
  if (outcome.result === 'failed') {
    ctx.store.appendEvent(runId, {
      type: 'note',
      message: `not landed — ${outcome.stage} failed: ${ctx.store.redactRunText(runId, outcome.error).split('\n')[0]}. Continue the task to fix it, then Finish again.`,
    });
    return;
  }
  ctx.store.updateRun(runId, { status: 'done', completionReason: 'accepted' });
  ctx.store.appendEvent(runId, { type: 'lifecycle', message: 'review accepted — changes landed' });
}

/**
 * The settle-time half of auto-land: a run that ends without a `ONNI:DONE` landing (Finish, an
 * idle close) still lands what it left, and a landing that never succeeded fails the run rather
 * than wearing a success badge. Answers the failure message, or undefined.
 */
export async function landBeforeSettle(ctx: SettlementContext, runId: string): Promise<string | 'review' | undefined> {
  const canLand = ctx.landingFence(runId);
  const run = ctx.store.getRun(runId);
  if (!run || run.worktree !== false || run.readOnly) return undefined;
  const policy = await ctx.landingPolicy(run, await loadConfig(ctx.repoRoot));
  if (!canLand() || !policy || !(await hasUnlanded(ctx.repoRoot)) || !canLand()) return undefined;
  // Only the user's Finish may land (an autonomous run has no policy and returned above).
  const state = ctx.active.get(runId);
  if (state?.finishRequested !== true) return 'review';
  // Land only while holding the tree: this run's own lease, else a fresh one (restart recovery).
  const holdsTree = Boolean(state?.releaseRepoRoot) && !state?.repoRootParked;
  if (!holdsTree && ctx.repoRootBusy() > 0) return 'review';
  const lease = holdsTree ? undefined : ctx.chainRepoRoot();
  let outcome: LandResult;
  try {
    outcome = await ctx.landNow(runId, policy);
  } finally {
    lease?.release();
  }
  return outcome.result === 'failed'
    ? `auto-land failed (${outcome.stage}): ${ctx.store.redactRunText(runId, outcome.error).split('\n')[0]}`
    : undefined;
}

/** Whether settling this run now would park it at the review gate (#489). */
export async function reviewGateApplies(ctx: SettlementContext, runId: string): Promise<boolean> {
  const run = ctx.store.getRun(runId);
  if (!run?.worktreePath || !existsSync(run.worktreePath)) return false;
  const diff = await worktreeDiff(run.worktreePath, run.baseBranch ?? 'HEAD');
  const hasDiff = diff.trim().length > 0 && !diff.startsWith('(diff failed');
  const config = await loadConfig(ctx.repoRoot);
  return hasDiff && reviewGateEnabled(config) && run.autonomous !== true;
}

/**
 * Whether an idle-closed session settles through the inactivity fallback
 * below. Work that would park at the review gate keeps settling there:
 * `review` is already the needs-you state, never a success badge, and it is
 * the only place the diff and the draft-PR action live.
 */
export async function idleClosedFails(ctx: SettlementContext, runId: string, state: SettlementActiveRun): Promise<boolean> {
  if (state.idleClosed !== true) return false;
  const reviewGate = await ctx.reviewGateApplies(runId);
  // A Finish may land during that git await and clear the inactivity evidence (6a3cecee).
  return state.idleClosed === true && !reviewGate;
}

/**
 * Inactivity is bounded local evidence that the last turn did not explicitly
 * settle the task. DONE/ASK/MONITORING branches run first; this conservative
 * fallback keeps an ordinary unfinished wait from wearing a success badge
 * while preserving the existing Continue path.
 */
export function inactivityFailureMessage(ctx: SettlementContext, runId?: string, state?: SettlementActiveRun): string {
  if (runId && state?.waitExpired) {
    ctx.store.updateRun(runId, { waitExpiredAt: new Date().toISOString() });
    return 'nobody answered in time — the unattended run ended; its worktree and session are kept, continue to resume it';
  }
  return 'the session closed after inactivity before the task declared completion — continue to resume it';
}

/**
 * Persist every attachment a user message carries — images and files alike (#950) — into the
 * run's own attachment folder, in the order they were attached. The returned paths are what the
 * agent is told about; the caller decides which of them also ride along as viewable blocks.
 *
 * A named attachment is additionally filed in the per-project attachment library (#929). This is the
 * only caller that does so, which is what keeps the library to user uploads: `persistAttachment`
 * is also how the agent's own tool screenshots land, and a folder of those would be a log, not
 * a library.
 */
export function persistPastedAttachments(
  ctx: SettlementContext,
  runId: string,
  content: readonly PastedContent[],
  imageLibraryWrites?: Array<() => void>,
): PersistedAttachment[] {
  return content
    .map((b) =>
      b.type === 'image'
        ? ctx.fileInAttachmentLibrary(
            ctx.persistAttachment(runId, b.source.media_type, b.source.data, 'pasted'), imageLibraryNames.get(b), imageLibraryWrites,
          )
        : b.type === 'file'
          ? ctx.fileInAttachmentLibrary(
              ctx.persistAttachment(runId, b.mediaType, b.data, 'pasted', storedAttachmentExtension(b.mediaType, b.name)),
              b.name,
            )
          : null,
    )
    .filter((saved): saved is PersistedAttachment => saved !== null);
}

/**
 * Copy a just-persisted file into the per-project attachment library (#929), under the name the
 * user knows it by.
 *
 * The bytes are re-read from the run folder rather than decoded again from the message: the two
 * copies are then byte-identical by construction, which is what the library's content dedupe
 * compares on. A file that arrived without a usable name is left out — the library exists to be
 * browsable by name, and `pasted-3.md` is exactly what it is an answer to.
 */
export function fileInAttachmentLibrary(
  ctx: SettlementContext,
  saved: PersistedAttachment | null,
  name: string | undefined,
  deferredWrites?: Array<() => void>,
): PersistedAttachment | null {
  if (!saved || !name) return saved;
  if (deferredWrites) {
    deferredWrites.push(() => ctx.fileInAttachmentLibrary(saved, name));
    return saved;
  }
  try {
    copyToAttachmentLibrary(ctx.dataDir, name, readFileSync(saved.path));
  } catch {
    // Best-effort by contract: the run folder already holds the file the agent was promised.
  }
  return saved;
}

/**
 * This project's attachment library when it exists on disk, for the two questions that need it:
 * which directories a spawned agent may reach (`agentDirectories`) and whether a message's note
 * has a library to point at. `undefined` for a project where nothing has ever been filed — there
 * is no folder to grant and nothing to name.
 */
export function grantableAttachmentLibrary(ctx: SettlementContext): string | undefined {
  const dir = attachmentLibraryDir(ctx.dataDir);
  return existsSync(dir) ? dir : undefined;
}

/**
 * A session's filesystem grants are fixed when it starts, but the first named follow-up may
 * create the library only after that session is already live (#987). Prepare the directory at
 * both session construction sites so a later message can use the grant. Best effort: a
 * read-only data directory simply leaves the library unavailable; the run-folder attachment
 * remains the source of truth.
 */
export function prepareAttachmentLibrary(ctx: SettlementContext): string | undefined {
  const dir = attachmentLibraryDir(ctx.dataDir);
  try {
    mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return undefined;
  }
}

/**
 * The attachment library to name in a message's note, or `undefined` when there is nothing to
 * point at yet — no attachment on this message, or a project where nothing has ever been filed.
 *
 * The name metadata is intentionally not serialized into PersistedAttachment. The
 * directory hint therefore depends on persisted attachments and library existence.
 */
export function attachmentLibraryHint(
  ctx: SettlementContext,
  attachments: PersistedAttachment[],
  grantedDir?: string,
): string | undefined {
  if (!attachments.length) return undefined;
  const dir = ctx.usableAttachmentLibrary(grantedDir);
  if (!dir) return undefined;
  try {
    return readdirSync(dir).length ? dir : undefined;
  } catch {
    return undefined;
  }
}

/** A library path that can be inspected, for truthful prompt hints only. */
export function usableAttachmentLibrary(ctx: SettlementContext, grantedDir: string | undefined): string | undefined {
  const dir = grantedDir;
  if (!dir) return undefined;
  try {
    readdirSync(dir);
    return dir;
  } catch {
    return undefined;
  }
}

/**
 * Agent screenshot (an image block inside a tool result) or a user attachment —
 * a pasted screenshot, or since #950 a PDF/TXT/MD file: the base64 data never
 * enters the NDJSON event log — it lands as a file under
 * `.ai/onni/runs/<id>-images/` and the transcript event carries only the name +
 * serving URL. `namePrefix` distinguishes the two origins on disk
 * (`screenshot-<n>.<ext>` for agent tool screenshots, `pasted-<n>.<ext>` for user
 * attachments, #357) and the absolute `path` lets the agent operate on the file
 * directly (save/attach/upload) — for a non-image attachment that path is the ONLY
 * way it ever reaches the agent.
 * Best effort: on failure the attachment is dropped, the transcript still
 * shows the tool result's `[screenshot]` placeholder (or the image count).
 */
export function persistAttachment(
  ctx: SettlementContext,
  runId: string,
  mediaType: string,
  data: string,
  namePrefix: string = 'screenshot',
  ext: string = attachmentExtension(mediaType),
): PersistedAttachment | null {
  try {
    // One mapping, shared with the wire (`packages/contract`): an image keeps the extension it
    // always had, a file gets `pdf`/`txt`/`md` (a binary one its own, `storedAttachmentExtension`),
    // and all share the `pasted-<n>` numbering space below so a `pasted-3.md` can never collide
    // with a `pasted-3.png`.
    const dir = join(ctx.dataDir, 'runs', `${runId}-images`);
    mkdirSync(dir, { recursive: true });
    // Seed from the highest numeric suffix already on disk, NOT the file count:
    // `screenshot-*` and `pasted-*` share one numbering space, so counting would
    // re-issue a live number after any deletion. Only matters on the first write
    // of a process (restart case) — afterwards the map is authoritative.
    let seq = ctx.queuedImageSeq.get(runId);
    if (seq === undefined) seq = highestImageSeq(dir);
    // `persistAttachment` is fully synchronous, so two pastes cannot interleave between
    // the read of the counter and the write. The exclusive-create flag is the
    // belt-and-braces guard for a stale seed: it degrades to a renamed file rather
    // than a silent overwrite.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      seq += 1;
      const name = `${namePrefix}-${seq}.${ext}`;
      const path = join(dir, name);
      try {
        writeFileSync(path, Buffer.from(data, 'base64'), { flag: 'wx' });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue;
        throw err;
      }
      ctx.queuedImageSeq.set(runId, seq);
      // Versioned, because that is the only surface served now. The cockpit still upgrades
      // the unversioned URLs sitting in OLD transcripts when it renders them
      // (`resolveApiUrl`), but a URL minted today must be fetchable as written.
      return { name, url: `/api/v1/runs/${runId}/images/${name}`, path };
    }
    return null;
  } catch {
    return null;
  }
}
