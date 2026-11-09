import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ContentBlock, RunnerId } from '../../core/agent-runner.ts';
import { agentModelsLocked } from '../../core/agent-model-policy.ts';
import { formatModelIdentity, normalizeModelForBackend } from '../../core/model-identity.ts';
import { processJobs } from '../../core/process-jobs.ts';
import { loadConfig } from '../../config.ts';
import { autosaveCommit, branchFor, chooseForkBase } from '../../git-worktree.ts';
import { seedHandoffFile } from '../../handoff.ts';
import { rematerializeReclaimedWorktree } from '../../runs/retention.ts';
import { getHeadCommit, getRepoInfo } from '../../server/git.ts';
import { createOrSwitchBranch } from '../../server/git-changes.ts';
import { loadWorkspaceConfig } from '../../workspace/config.ts';
import { discoverSkills } from '../../skills.ts';
import { compileV1 } from '../graph.ts';
import { landingPromptPart, READ_ONLY_PROMPT } from '../landing.ts';
import {
  composeSystemPrompt,
  contentBlocksOf,
  resolveExtraSystemPrompt,
  type PersistedAttachment,
} from './preparation.ts';
import type { ExecuteActiveRun, ExecuteContext } from './internal-types.ts';
import type { StartRunInput } from '../run.ts';
import type { WorkflowDef } from '../types.ts';

export async function executeRun(ctx: ExecuteContext, runId: string, workflow: WorkflowDef, input: StartRunInput, ownerToken?: symbol): Promise<void> {
    const original = ctx.store.getRun(runId);
    // Only a job queued as a usage-limit resume re-enters its interrupted agent (#1300); the
    // step/session checkpoint survives missing optional attempt accounting.
    const resumeStep = input.usageLimitResume && original ? ctx.interruptedWorkflowStep(original) : undefined;
    const state: ExecuteActiveRun = {
      ownerToken: ownerToken ?? Symbol('run-owner'),
      cancelled: false,
      interrupt: () => undefined,
      cwd: ctx.repoRoot,
      autonomous: input.autonomous === true,
      autoContinues: 0,
      autosaveExcludedPaths: ctx.checkArtifactSnapshots.get(runId) ?? new Map(),
      checkInProgress: false,
      autosaveCheckpointBlocked: ctx.autosaveCheckpointBlockedRuns.has(runId),
    };
    ctx.checkArtifactSnapshots.set(runId, state.autosaveExcludedPaths);
    ctx.active.set(runId, state);
    ctx.starting.delete(runId);
    const emit = (event: { type: string; stepId?: string; [k: string]: unknown }) => {
      if (ctx.active.get(runId) !== state || state.cancelled) return;
      ctx.store.appendEvent(runId, event);
    };

    // Warm the engine's job keeper before this run's first spawn (C-05). Windows-only, once per
    // engine; on POSIX it resolves at once. Without it the first assignment can arrive after the
    // agent CLI exists, and that process tree escapes ownership by the engine's death.
    await processJobs.ready();

    // Resolve the agent backend for this run: the task choice (GUI) wins over
    // the config default. Per-step `runner` can still override it below.
    const config = await loadConfig(ctx.repoRoot);
    const taskBackend: RunnerId = input.runner ?? config.defaultRunner;
    // The account may have gone into a usage-limit hold since this run was dequeued — the queue
    // gate cannot be the only one, because dequeue is not the moment of no return. Nothing has
    // happened yet here, so the run goes back to the queue untouched (spec
    // 2026-08-03-auto-resume-after-usage-limit).
    if (ctx.requeueWhileHeld(runId, workflow, input, taskBackend)) return;
    // The project's default workspace (spec 2026-10-20-trunk-based-projects), for every caller
    // that left it open — the composer, automations, the CLI. Never for variants, dispatch or a PR head.
    const defaultable = ctx.store.getRun(runId);
    if (
      input.worktree === undefined &&
      config.taskWorkspace === 'in-place' &&
      !defaultable?.groupId &&
      !defaultable?.dispatch &&
      !input.dispatchIntent &&
      !input.forkRef
    ) {
      input = { ...input, worktree: false };
      ctx.store.updateRun(runId, { worktree: false });
    }
    state.readOnly = input.readOnly === true && input.worktree === false;
    state.autoLand = await ctx.landingPolicy(ctx.store.getRun(runId), config, (message) =>
      ctx.store.appendEvent(runId, { type: 'note', message }),
    );
    // Extra system prompt (R2 2.3): POST override > config default; echoed on
    // the record so the UI/API can show what the run actually used. The landing permission or the
    // read-only rule rides along, so a Continue (which reads the record) keeps it.
    // A usage-limit resume reuses the recorded prompt verbatim, as Continue does: the record holds
    // only the composed form, and re-composing it would repeat its landing/read-only parts.
    const extraSystemPrompt = resumeStep && original?.systemPrompt !== undefined
      ? original.systemPrompt
      : composeSystemPrompt(
        resolveExtraSystemPrompt(input.systemPrompt, config.systemPrompt, (await loadWorkspaceConfig().catch(() => null))?.systemPrompt),
        state.autoLand ? landingPromptPart(state.autoLand.baseLabel, state.autoLand.checks) : undefined,
        state.readOnly ? READ_ONLY_PROMPT : undefined,
      ) || undefined;
    // Canonical provider/model identity (#405) — the normalised `provider/model`
    // the task ran with, persisted for cost attribution / reproducible replay
    // beside the free-text `model`. Best-effort here (a per-step `runner`/`model`
    // can still override below); the authoritative fail-loud gate is at spawn.
    let modelIdentity: string | undefined;
    try {
      const normalized = normalizeModelForBackend(
        taskBackend,
        agentModelsLocked(ctx.repoRoot) ? undefined : input.model,
        { configuredProvider: await ctx.configuredModelProvider(taskBackend, ctx.repoRoot) },
      );
      modelIdentity = normalized ? formatModelIdentity(normalized.identity) : undefined;
    } catch {
      // An unresolvable task-level model surfaces loudly at the step below; the
      // metadata echo stays absent rather than guessing.
    }
    ctx.store.updateRun(runId, {
      status: 'running',
      startedAt: resumeStep ? original?.startedAt : new Date().toISOString(),
      runner: taskBackend,
      systemPrompt: extraSystemPrompt,
      modelIdentity,
    });
    emit({ type: 'lifecycle', message: `run ${resumeStep ? 'resumed' : 'started'} — workflow "${workflow.name}" (runner: ${taskBackend})` });

    // Worktree per task (spec 006): the agent works on its own branch in
    // `.ai/onni/worktrees/<id>`, never in the user's working tree. A Git task
    // that requests isolation fails closed if the worktree cannot be
    // established; only explicit opt-out and non-Git modes run in place.
    const repo = await getRepoInfo(ctx.repoRoot);
    if (state.cancelled) {
      ctx.dropActive(runId, state);
      return;
    }
    let switchInPlaceTo: string | undefined;
    if (resumeStep) {
      await rematerializeReclaimedWorktree(ctx.repoRoot, ctx.store, runId);
      const worktreePath = ctx.store.getRun(runId)?.worktreePath;
      if (worktreePath && existsSync(worktreePath)) state.cwd = worktreePath;
    }
    if (resumeStep && state.cwd !== ctx.repoRoot) {
      // Reuse the tree as the agent left it, including a branch it checked out itself — under the
      // same agent lease the fresh path and `runContinuation` hold, so no reclaim races the agent.
      state.releaseWorktree = await ctx.lifecycle.acquireAgentLease(runId);
      ctx.armAutosave(runId, state);
      emit({ type: 'note', message: 'resuming in the existing task worktree' });
    } else if (repo && input.worktree === false) {
      // Composer opt-out: run in the repo working tree, no branch/worktree. The
      // repository-root lease serializes these runs by default; the explicit
      // ONNI_DISABLE_REPO_LOCK=1 escape hatch allows unsafe overlap.
      const recordedRun = ctx.store.getRun(runId);
      if (recordedRun?.inPlaceBranch) {
        // spec 2026-10-19-repo-git-sync: fork the checkout itself onto a task branch. A recorded
        // branch that already exists (restart, or the user's own name) is switched to instead.
        const branch =
          recordedRun.branch ??
          (await ctx.awaitGeneratedBranch(runId, config.branchNaming, (message) => emit({ type: 'note', message }))) ??
          branchFor(runId);
        if (state.cancelled) {
          ctx.dropActive(runId, state);
          return;
        }
        // Recorded now so a requeue keeps the name; switched once the repo-root lease is held.
        ctx.store.updateRun(runId, { branch });
        switchInPlaceTo = branch;
      } else {
        // In-place runs never fork, so nothing will ever read the namer's branch answer.
        ctx.pendingBranchNames.delete(runId);
        emit({ type: 'note', message: 'worktree off — running in the repo working tree' });
        // Pin the starting commit: the session's Changes and Commits views use it
        // as their stable lower bound while reading the current working copy.
        const startingCommit = resumeStep ? undefined : await getHeadCommit(repo.root);
        if (startingCommit) ctx.store.updateRun(runId, { baseBranch: startingCommit });
      }
    } else if (repo) {
      emit({
        type: 'note',
        message: `worktree on — using an isolated task worktree (${input.worktree === true ? 'explicit request' : 'default'})`,
      });
      // Fork from the configured base branch (config.json `baseBranch`, e.g.
      // `develop`) — also the target of the eventual draft PR. Unresolvable
      // (typo, not fetched) → note + the currently checked-out branch. Either
      // way the base goes through `resolveBaseRef` (`chooseForkBase`), which
      // fetches origin first so a new task forks from the newest tip, never a
      // stale local ref — while a checked-out branch that diverged from origin
      // keeps the user's local work.
      //
      // A task that already recorded a fork point keeps it: its worktree is
      // reused as-is, and re-resolving against a since-changed config would
      // silently re-anchor the `merge-base` every diff/shortstat is measured
      // from, shifting "what did this task change" under an existing task.
      const recordedRun = ctx.store.getRun(runId);
      const recorded = recordedRun?.baseBranch;
      const base =
        recorded ??
        (await chooseForkBase(ctx.repoRoot, repo.branch, config.baseBranch, (message) =>
          emit({ type: 'note', message }),
        ));
      try {
        // A recorded branch (restart, rematerialize) always wins — a named branch cannot be
        // recomputed from the id. A fresh run waits, bounded, for the namer's branch instead.
        const branch =
          recordedRun?.branch ??
          (await ctx.awaitGeneratedBranch(runId, config.branchNaming, (message) =>
            emit({ type: 'note', message }),
          ));
        // The wait can last the namer's whole timeout; a Cancel during it must not fork.
        if (state.cancelled) {
          ctx.dropActive(runId, state);
          return;
        }
        const preparationController = new AbortController();
        state.interrupt = () => preparationController.abort();
        // A generated name git still refuses (ref race, an exotic conflict) degrades to
        // `onni/<id8>`, never fails the task. A recorded branch is the run's own: no fallback.
        const wt = await ctx.lifecycle.prepare(runId, base, {kind: 'initial', runId}, preparationController.signal, {
          branch,
          generated: branch !== undefined && recordedRun?.branch === undefined,
          onFallback: (reason) => emit({
            type: 'note',
            message: `generated branch "${branch}" could not be created (${reason}) — using the default onni/ branch`,
          }),
        });
        if (state.cancelled) { ctx.dropActive(runId, state); return; }
        if (!wt.ready) { ctx.parkLifecycle(runId, state, wt.operationId); return; }
        state.cwd = wt.path;
        state.releaseWorktree = await ctx.lifecycle.acquireAgentLease(runId);
        ctx.store.updateRun(runId, {
          worktreePath: wt.path,
          branch: wt.branch,
          baseBranch: wt.baseBranch,
        });
        emit({ type: 'note', message: `worktree ready — branch ${wt.branch} (base ${wt.baseBranch})` });
        if (wt.seeded?.length) emit({ type: 'note', message: `seeded personal agent config: ${wt.seeded.join(', ')}` });
        // Seed from this manager's project root: each multi-project context has
        // its own manager/repoRoot and must never copy another project's layer.
        ctx.armAutosave(runId, state);
      } catch (err) {
        if (state.cancelled) {
          ctx.dropActive(runId, state);
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        const error = `worktree creation failed: ${message}`;
        emit({ type: 'note', message: `${error} — task stopped before workflow execution` });
        ctx.store.updateRun(runId, {
          status: 'failed',
          error,
          finishedAt: new Date().toISOString(),
          currentStepId: undefined,
        });
        emit({ type: 'lifecycle', message: `run failed — ${error}` });
        ctx.dropActive(runId, state);
        return;
      }
    } else {
      ctx.pendingBranchNames.delete(runId);
      emit({ type: 'note', message: 'not a git repository — running in place, one task at a time' });
    }

    if (state.cwd === ctx.repoRoot && state.readOnly) {
      emit({ type: 'note', message: 'read-only — answering from the repo working tree, alongside any running task' });
    } else if (state.cwd === ctx.repoRoot) {
      if (ctx.repositoryRootLockDisabled()) {
        emit({
          type: 'note',
          message: ctx.repositoryRootLockDisabledNote,
        });
      } else {
        emit({
          type: 'note',
          message: 'waiting for exclusive access to the repository working tree',
        });
        // A cancel during the wait leaves the lease ungranted; the step loop
        // below breaks on `cancelled` before touching the tree and settles the
        // run through the usual path.
        await ctx.acquireRepoRoot(runId, state);
      }
      // THE window that matters for an in-place run. Waiting for the exclusive tree can take
      // minutes, and a run parked on that lease holds no slot (#347) — so the queue keeps
      // advancing behind it and the dequeue-time gate is long past. Measured with five in-place
      // tasks and `maxParallel: 2`: four of them started. Re-ask here, where the very next thing
      // is a spawn, and hand the run back to the queue if the account closed meanwhile. This
      // check also covers the explicit lock-bypass path, where the account may close while the
      // run is preparing its first step.
      if (ctx.requeueWhileHeld(runId, workflow, input, taskBackend, state)) return;
    }
    if (repo && switchInPlaceTo && !state.cancelled) {
      // Re-read HEAD: the lease wait may have let another in-place run move the checkout.
      const current = (await getRepoInfo(ctx.repoRoot))?.branch ?? repo.branch;
      const base = await chooseForkBase(ctx.repoRoot, current, config.baseBranch, (message) =>
        emit({ type: 'note', message }),
      );
      const switched = await createOrSwitchBranch(repo.root, switchInPlaceTo, base);
      if (!switched.ok) {
        const error = `could not switch the checkout to ${switchInPlaceTo}: ${switched.error}`;
        ctx.store.updateRun(runId, { status: 'failed', error, finishedAt: new Date().toISOString(), currentStepId: undefined });
        emit({ type: 'lifecycle', message: `run failed — ${error}` });
        ctx.dropActive(runId, state);
        return;
      }
      emit({
        type: 'note',
        message: switched.created
          ? `worktree off — created ${switched.branch} from ${base} in the repo working tree`
          : `worktree off — switched the repo working tree to ${switched.branch}`,
      });
      const startingCommit = await getHeadCommit(repo.root);
      if (startingCommit) ctx.store.updateRun(runId, { baseBranch: startingCommit });
    }

    // Handoff journal (spec 007) — seeded after the worktree exists so the
    // header can name the branch. Idempotent: an existing file stays as-is.
    const seeded = ctx.store.getRun(runId);
    if (seeded) seedHandoffFile(ctx.dataDir, seeded);

    const skills = await discoverSkills(ctx.repoRoot);
    // Every ActiveRun construction site must carry the registry — `runContinuation` builds
    // its own, and the one that skipped this leaked raw `/skill` text to the backend (#811).
    state.skills = skills;
    // Same rule, same reason, for the dispatch session snapshot (the dispatch prompt; the child
    // role's prompt a spawn will need). This is the FIRST of the two construction sites; the
    // twin is in `runContinuation`.
    ctx.prepareDispatchSession(runId, state, await ctx.loadManagerSessionContext(runId, state));
    ctx.prepareAutomationsSession(state);
    let runError: string | null = null;
    let idleFailed = false;
    // `startRun` already persisted the task's attachments so a queued bubble can render them
    // (#612). Reuse those files for the agent-facing path note instead of minting
    // duplicate pasted files when execution finally begins.
    //
    // The STACK's attachments (#472) are listed here too: they were persisted when they were
    // enqueued, and their paths are the only thing an agent ever gets for a non-image one — a
    // note that covered the initial prompt alone would hand it a task about a file it was never
    // told the path of (#950).
    const startRecord = ctx.store.getRun(runId);
    let startAttachments: PersistedAttachment[] = [
      ...(startRecord?.taskImages ?? []),
      ...(startRecord?.queuedMessages ?? []).flatMap((m) => m.images ?? []),
    ]
      .map((url): PersistedAttachment | null => {
        const name = url.split('/').pop();
        if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) return null;
        const path = join(ctx.dataDir, 'runs', `${runId}-images`, name);
        return existsSync(path) ? { name, url, path } : null;
      })
      .filter((saved): saved is PersistedAttachment => saved !== null);
    // Task screenshots go with the FIRST agent step's opening message only —
    // later steps and retry loops run in fresh sessions without them. Stacked
    // attachments (#472) ride along too, but are NOT re-persisted above: they
    // already live on disk, and adding them to `taskImages` would both duplicate
    // the files and make the task bubble claim the stack's images as its own.
    // File blocks are dropped here — a session only ever sees viewable blocks (#950). An empty
    // result stays `undefined` rather than `[]`, so a task carrying only files hands the runner
    // seam exactly the shape a task carrying nothing always did.
    const startBlocks = contentBlocksOf([...(input.images ?? []), ...(input.stackedImages ?? [])]);
    let startImages: ContentBlock[] | undefined = startBlocks.length ? startBlocks : undefined;

    if (state.cancelled) {
      ctx.dropActive(runId, state);
      return;
    }

    // ONE engine (spec 2026-09-30-workflow-node-editor): a step-list workflow is compiled to its
    // graph (`compileV1`: `onFail {retry, max}` becomes `check.fail → loop(max) → retry`) and
    // walked like any `version: 2` one. The run's rail and record keep the v1 steps; only the
    // walk changed hands — the v1 run suites are what prove the two behave the same.
    runError = await ctx.executeGraph(runId, state, workflow, workflow.graph ?? compileV1(workflow.steps), {
      input,
      skills,
      emit,
      taskBackend,
      extraSystemPrompt,
      startImages,
      startAttachments,
      // #1300: a usage-limit resume re-enters the walk at its interrupted agent node.
      resume: resumeStep
        ? { loops: {}, taken: [], ...ctx.store.getRun(runId)?.graphState, cursor: resumeStep.id }
        : ctx.store.getRun(runId)?.graphState,
      usageLimitResume: resumeStep,
    });

    // How a mid-workflow ask park (#917) ended, read once before the settlement
    // below clears it. A LIVE park never reaches this line: the parked session
    // stays open, so `execute` is still awaiting `runAgentStep` and the answer
    // that resumes the workflow clears the flag first. Reaching here with the
    // park still set therefore means the session is gone — and every one of the
    // ways that can happen has to settle the run and reach `dropActive`, or the
    // run is stranded at `waiting` holding a `maxParallel` slot for the lifetime
    // of the process. Cancellation and step failures keep their own branches
    // below, ahead of the park, so they still land as `cancelled`/`failed`.
    const askPark = state.askPark;
    const monitorHandoff = state.monitorHandoff === true;
    state.askPark = undefined;

    // Final autosave: the branch always ends holding the finished state.
    ctx.clearAutosaveTimer(state);
    if (
      !state.cancelled &&
      !state.autosaveCheckpointBlocked &&
      ctx.active.get(runId) === state &&
      state.cwd !== ctx.repoRoot
    ) {
      await autosaveCommit(
        state.cwd,
        'run finalize',
        await ctx.currentCheckExclusions(state.cwd, state.autosaveExcludedPaths),
      );
    }

    // The cancellation grace timer may have retired this owner while the async
    // workflow was unwinding, and a same-id continuation may now own the record.
    // No settlement branch below may touch that newer owner.
    if (ctx.active.get(runId) !== state) return;

    // Same window as `runContinuation`'s: whatever settles below is final once teardown lets go.
    state.turnSettled = true;
    const finishedAt = new Date().toISOString();
    if (state.cancelled && ctx.active.get(runId) === state) {
      const run = ctx.store.getRun(runId);
      for (const s of run?.steps ?? []) {
        if (s.status === 'running' || s.status === 'waiting') {
          ctx.store.updateStep(runId, s.id, { status: 'cancelled' });
        }
      }
      ctx.store.updateRun(runId, { status: 'cancelled', finishedAt, currentStepId: undefined });
      emit({ type: 'lifecycle', message: 'run cancelled' });
    } else if (runError) {
      ctx.store.updateRun(runId, {
        status: 'failed',
        error: runError,
        finishedAt,
        currentStepId: undefined,
        // A crash or a runner timeout while parked on a question does not answer it either.
        ...(askPark === 'waiting' ? { awaitingAnswerSince: finishedAt } : {}),
      });
      emit({ type: 'lifecycle', message: `run failed — ${runError}` });
    } else if (askPark === 'waiting') {
      ctx.settleUnansweredPark(runId, finishedAt, monitorHandoff);
    } else if (idleFailed) {
      const error = ctx.inactivityFailureMessage(runId, state);
      const run = ctx.store.getRun(runId);
      for (const s of run?.steps ?? []) {
        if (s.status === 'running' || s.status === 'waiting') {
          ctx.store.updateStep(runId, s.id, { status: 'failed', error, finishedAt });
        }
      }
      ctx.store.updateRun(runId, { status: 'failed', error, finishedAt, currentStepId: undefined });
      emit({ type: 'lifecycle', message: `run stopped — ${error}` });
    } else {
      // Includes `askPark === 'abandoned'`: Finish on a parked run ends it the
      // way Finish always does, with the later steps left honestly at `pending`.
      await ctx.settleSuccess(runId, state);
    }
    ctx.clearIdleTimer(state);
    ctx.dropActive(runId, state);
  }
