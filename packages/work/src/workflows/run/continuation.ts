import { completionReason } from '../completion-reason.ts';
import { TrackerAgentBindingError } from '../../server/tracker/agent-credentials.ts';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { stripAskMarker } from '../../core/ask.ts';
import type { AgentSession } from '../../core/claude-cli-runner.ts';
import { interruptAfterGrace, MISSING_SESSION_NOTE, ResumeFallback } from '../resume-fallback.ts';
import { processJobs } from '../../core/process-jobs.ts';
import { registerRunProcess } from '../../core/process-usage.ts';
import { createRunner } from '../../core/runner-factory.ts';
import type { AgentEvent, ContentBlock, RunnerId } from '../../core/agent-runner.ts';
import { modelConflictsWithRunner, modelNativeToRunner } from '../../core/model-presets.ts';
import { AGENT_MODELS_LOCKED_ERROR, agentModelsLocked } from '../../core/agent-model-policy.ts';
import { ModelIdentityError, formatModelIdentity, normalizeModelForBackend } from '../../core/model-identity.ts';
import { appendHandoffHeartbeat, followupsEnabled, HANDOFF_INSTRUCTIONS, HANDOFF_ONLY_INSTRUCTIONS, seedHandoffFile } from '../../handoff.ts';
import { discoverSkills, type Skill } from '../../skills.ts';
import { loadConfig } from '../../config.ts';
import { READ_ONLY_TOOLS } from '../landing.ts';
import { autosaveCommit } from '../../git-worktree.ts';
import { freshContinuationContext } from '../continuation-context.ts';
import { rematerializeReclaimedWorktree } from '../../runs/retention.ts';
import { AgentTempDirError } from '../../runs/agent-tmpdir.ts';
import { stripTaskMarkers } from '../../runs/task-markers.ts';
import { DEFAULT_AGENT_ACCOUNT_ID } from '../../workspace/agent-accounts.ts';
import { isUnattended } from '../unattended.ts';
import { UNATTENDED_DENIED_TOOLS } from '../push-guard.ts';
import { describeHit, raiseLimits } from '../limits.ts';
import { DEFAULT_ALLOWED_TOOLS, stepKind } from '../types.ts';
import { agentDirectories, composeSystemPrompt, contentBlocksOf, dispatchPromptPart, pastedAttachmentsText } from './preparation.ts';
import type { PersistedAttachment, PastedContent } from './preparation.ts';
import type { ContinuationActiveRun, ContinuationContext, ContinuationOptions } from './internal-types.ts';
export function finish(ctx: ContinuationContext, runId: string): boolean {
    const state = ctx.active.get(runId);
    if (state?.graphFinish && !state.session?.open) {
      ctx.store.appendEvent(runId, { type: 'lifecycle', message: 'finished by user at a workflow wait' });
      state.finishedAtWait = true;
      state.graphFinish();
      return true;
    }
    if (
      state?.session?.open &&
      state.autoLand &&
      !state.autonomous &&
      !state.repoRootParked &&
      ctx.store.getRun(runId)?.status === 'waiting'
    ) {
      // A trunk-based interactive run: Finish is the user's approval to land (spec
      // 2026-10-20-trunk-based-projects). A failure goes back to the agent; success closes. Mid-turn
      // or parked off the tree, the ordinary Finish below closes first and settle lands after.
      ctx.clearIdleTimer(state);
      state.idleClosed = undefined;
      if (state.askPark === 'waiting') state.askPark = 'abandoned';
      ctx.store.appendEvent(runId, { type: 'lifecycle', message: 'finished by user — landing the changes' });
      return ctx.landWithAgent(runId, state, state.currentStepId, () => {
        state.finishRequested = true;
        state.session?.end();
      }) !== undefined;
    }
    if (state?.session?.open) {
      ctx.clearIdleTimer(state);
      // Finish is explicit user intent, even if the watchdog callback already ran
      // and is racing the session-result settlement. Do not let stale inactivity
      // evidence turn an explicit Finish into the conservative failure fallback.
      state.idleClosed = undefined;
      // Finish on a run parked mid-workflow on `ONNI:ASK` or `ONNI:MONITORING`
      // (#917, #1076) is an explicit "stop here" — so it settles like every
      // other Finish (`done`, or `review` when the worktree holds changes)
      // instead of the `failed` an abandoned live park would settle as.
      if (state.askPark === 'waiting') state.askPark = 'abandoned';
      state.finishRequested = true;
      ctx.store.appendEvent(runId, { type: 'lifecycle', message: 'session closed by user' });
      state.session.end();
      return true;
    }
    const run = ctx.store.getRun(runId);
    // The session already closed (agent's DONE, idle watchdog, an earlier Finish) but the engine
    // has not settled yet, so the record still says `waiting`. Finish in that window is the same
    // explicit intent as above — honor it on the settlement instead of answering 409 (6a3cecee).
    if (state && !state.cancelled && state.sessionEverOpened && run?.status === 'waiting') {
      state.idleClosed = undefined;
      if (state.askPark === 'waiting') state.askPark = 'abandoned';
      if (!state.finishRequested) {
        state.finishRequested = true;
        ctx.store.appendEvent(runId, { type: 'lifecycle', message: 'finished by user while the session was closing' });
      }
      return true;
    }
    // Settled at `review`, but still unwinding (autosave, teardown): accept once it lets go. A
    // repeat of a Finish already pressed on this session is not an accept — it stays at review.
    if (state && !state.cancelled && run?.status === 'review') {
      if (!state.finishRequested) state.acceptReviewOnDrop = true;
      return true;
    }
    if (run?.status === 'review' && !ctx.isActive(runId) && run.worktree === false && !run.readOnly) {
      void ctx.finishReview(runId);
      return true;
    }
    if (run?.status === 'review' && !ctx.isActive(runId)) {
      ctx.store.updateRun(runId, { status: 'done', completionReason: 'accepted' });
      ctx.store.appendEvent(runId, { type: 'lifecycle', message: 'review accepted — finished without a PR' });
      return true;
    }
    return false;
  }

  /**
   * "Continue" (spec 003): reopen a finished run's claude session in-process
   * (`claude --resume <sessionId>`) as a new synthetic step. The session then
   * behaves exactly like an interactive step: `waiting` after each turn,
   * messages via sendMessage, closed by finish/idle/cancel.
   */
export function continueRun(ctx: ContinuationContext,
    runId: string,
    opts: ContinuationOptions = {},
    /** Restart recovery may discover several interrupted tasks at once. Those
     *  continuations are queued; an explicit user Continue remains immediate. */
    deferForCapacity = false,
  ): { ok: boolean; error?: string } {
    if (ctx.lifecycle.isBlocked(runId)) return {ok: false, error: 'Resolve the worktree lifecycle operation first'};
    if (agentModelsLocked(ctx.repoRoot) && opts.model?.trim()) {
      return { ok: false, error: AGENT_MODELS_LOCKED_ERROR };
    }
    const run = ctx.store.getRun(runId);
    if (ctx.active.has(runId) || ctx.starting.has(runId)) {
      // The record already reads settled, but the turn-end autosave is still unwinding: take the
      // Continue now and start it from `dropActive`, the way Finish does (telemetry 77117b95).
      const unwinding = ctx.active.get(runId);
      const settledTurn = unwinding?.turnSettled && !unwinding.cancelled && !unwinding.continueOnDrop
        && !ctx.starting.has(runId) && run !== undefined && ctx.helpers.continuableStatuses.includes(run.status)
        && run.steps.some((s) => s.sessionId);
      if (!settledTurn) return { ok: false, error: 'run is still active' };
      const runner = opts.runner ?? run.runner ?? 'claude';
      if (opts.model && modelConflictsWithRunner(opts.model, runner)) {
        return { ok: false, error: `model '${opts.model}' is not a ${runner} model` };
      }
      unwinding.continueOnDrop = { opts, deferForCapacity };
      return { ok: true };
    }
    if (!run) return { ok: false, error: 'not found' };
    if (run.limitHit) {
      if (!opts.raiseLimits) {
        return { ok: false, error: `${describeHit(run.limitHit)}. Continue with the ceiling raised (one more allowance) to proceed.` };
      }
      ctx.raiseAfterLimit(run);
    }
    // `review` is continuable too — that's the "Send back" path (spec 009).
    if (!ctx.helpers.continuableStatuses.includes(run.status)) {
      return { ok: false, error: `cannot continue a ${run.status} run` };
    }
    const sessionStep = [...run.steps].reverse().find((s) => s.sessionId);
    if (!sessionStep?.sessionId) {
      if (run.worktreeLifecycle?.phase === 'setup' && run.worktreeLifecycle.state === 'cancelled') {
        void ctx.lifecycle.reopenSetup(runId).catch(error => ctx.store.updateRun(runId, {error: String(error)}));
        return {ok: true};
      }
      return { ok: false, error: 'no agent session to resume' };
    }
    const targetRunner = opts.runner ?? run.runner ?? 'claude';
    // Session ids are provider-owned opaque values. New records carry explicit
    // affinity; for legacy records, the run's current runner is the conservative
    // owner until a continuation emits a new, attributed session id (#562).
    const sessionBackend = sessionStep.backend ?? run.runner ?? 'claude';
    // A session id only resolves inside the config dir that created it (spec
    // 2026-07-29-agent-profiles), so switching ACCOUNT ends the session exactly like switching
    // backend does: `claude --resume <id>` under another login finds nothing and would silently
    // open a fresh conversation while the thread claimed it had resumed. A step that recorded no
    // account predates the feature and therefore ran under the discovered one.
    const sessionAccount = sessionStep.profileId ?? DEFAULT_AGENT_ACCOUNT_ID;
    // The account this turn must run on: the composer's pick, else the one the run already
    // chose. The run's own choice counts too — a record whose newest session predates an
    // account switch (a fresh continuation that recorded no session id) must not be resumed
    // under the account the user switched away from.
    const targetAccount = opts.agentProfile
      ?? (targetRunner === (run.runner ?? 'claude') ? run.agentProfile : undefined);
    const accountSwitched = targetAccount !== undefined && targetAccount !== sessionAccount;
    const resume = sessionBackend === targetRunner && !accountSwitched;

    // Follow-up runner/model/account override (#401, spec 2026-07-29-agent-profiles): the composer
    // lets the user pick which backend, model and login handle this continuation — the same flat
    // pill the /new composer offers. Omitted → the run's current backend/model/account is kept
    // (backward compat). A provided choice is persisted BEFORE scheduling, so it becomes the
    // run's current backend — `runContinuation` reads it off the record, later continuations
    // default to it, and the header reflects the active engine. An empty model ('') clears the
    // pin, letting the runner pick the model (auto).
    if (opts.runner !== undefined || opts.model !== undefined || opts.agentProfile !== undefined) {
      // Guard the pairing before persisting anything: the model override applies to the runner
      // this continuation will actually use (`opts.runner ?? record.runner ?? 'claude'` — the
      // same resolution `runContinuation` reads off the record). A model that is recognizably
      // another runner's preset would corrupt the run; free-form/custom ids pass untouched.
      if (opts.model && modelConflictsWithRunner(opts.model, targetRunner)) {
        return { ok: false, error: `model '${opts.model}' is not a ${targetRunner} model` };
      }
      // A runner switch that carries NO explicit model must not leave the previous backend's pin
      // on the record: the guard above only sees `opts.model`, so without this an inherited
      // `opus` would survive a switch to codex and `runContinuation` would hand it to the codex
      // runner. Clearing (not rejecting) is right — the pin belonged to the old backend and is
      // meaningless for the new one, which is exactly what the composer already displays (auto).
      // On a real switch only a pin native to the target survives: Claude accepts gateway ids, so
      // the conflict guard alone let OpenCode's `openai/gpt-5.1` reach `claude --model` (8e1173b1).
      const runnerSwitched = targetRunner !== (run.runner ?? 'claude');
      const inheritedPinIsForeign =
        opts.model === undefined &&
        run.model !== undefined &&
        (runnerSwitched
          ? !modelNativeToRunner(run.model, targetRunner)
          : modelConflictsWithRunner(run.model, targetRunner));
      // An account belongs to ONE agent, so a runner switch that names no account must not leave
      // the previous backend's login on the record. It is inert immediately (resolution applies
      // the run's account only to steps on the run's own runner) and wrong later, when a further
      // continuation switches back and inherits a login the user picked for a different task.
      const inheritedAccountIsForeign =
        opts.agentProfile === undefined &&
        run.agentProfile !== undefined &&
        targetRunner !== (run.runner ?? 'claude');
      ctx.store.updateRun(runId, {
        ...(opts.runner !== undefined ? { runner: opts.runner } : {}),
        ...(opts.model !== undefined
          ? { model: opts.model === '' ? undefined : opts.model }
          : inheritedPinIsForeign
            ? { model: undefined }
            : {}),
        // Persisted BEFORE scheduling, like the runner/model pair: `runContinuation` resolves the
        // account off the record, and every later continuation then defaults to it.
        ...(opts.agentProfile !== undefined
          ? { agentProfile: opts.agentProfile }
          : inheritedAccountIsForeign
            ? { agentProfile: undefined }
            : {}),
      });
    }

    // Everything that could refuse this continuation has now passed, so a pending usage-limit
    // resume is superseded either way: this IS that resume (it re-stamps its own counter), or a
    // human got there first — and then the counter starts over, because the cap only exists to
    // bound UNATTENDED resumes.
    ctx.clearAutoResume(runId);

    const continuations = run.steps.filter((s) => s.id.startsWith('continue-')).length;
    const stepId = `continue-${continuations + 1}`;
    ctx.store.addStep(runId, { id: stepId, name: 'Continue', kind: 'agent' });
    // Plan v2 §9: a manager question may be answered after its session closed. The reminder names
    // the question so the reopened session knows what the answer belongs to; matching one retires it.
    const answering = ctx.softAskFor(runId, opts.replyTo);
    const base = opts.text?.trim() || 'Continue.';
    const prompt = answering
      ? `User answered your question "${answering.question}": ${base}`
      : base;
    if (answering) ctx.clearSoftAsk(runId);
    const images = opts.images ?? [];
    if (deferForCapacity) {
      ctx.pendingContinuations.set(runId, {
        stepId,
        sessionId: resume ? sessionStep.sessionId : undefined,
        backend: targetRunner,
        prompt,
        images,
      });
      ctx.queue.push(runId);
      ctx.store.updateRun(runId, {
        status: 'queued',
        error: undefined,
        finishedAt: undefined,
        currentStepId: undefined,
      });
      return { ok: true };
    }
    const ownerToken = Symbol('run-owner');
    // Same window as a dequeued continuation: live (and cancellable) before `runContinuation`
    // registers it in `active`.
    ctx.starting.add(runId);
    void ctx.runContinuation(
      runId,
      stepId,
      resume ? sessionStep.sessionId : undefined,
      targetRunner,
      prompt,
      images,
      undefined,
      undefined,
      ownerToken,
    ).catch(
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        ctx.failOwnedContinuation(runId, ownerToken, message);
        // A cancel that landed before the throw still owes the parent its report.
        if (!ctx.abandonCancelledStart(runId)) ctx.starting.delete(runId);
      },
    );
    return { ok: true };
  }

export async function runContinuation(ctx: ContinuationContext,
    runId: string,
    stepId: string,
    sessionId: string | undefined,
    backend: RunnerId,
    prompt: string,
    /** Attachments pasted into the follow-up composer — delivered with the
     *  reopened session's opening message, exactly like a live-session
     *  message's attachments. */
    images: PastedContent[] = [],
    /** Queued-message screenshots were persisted when they were enqueued and
     *  reconstructed at dequeue. Keep them separate from fresh `images` so
     *  opening a recovered continuation does not persist duplicate files. */
    persistedImages: ContentBlock[] = [],
    persistedAttachments: PersistedAttachment[] = [],
    ownerToken?: symbol,
  ): Promise<void> {
    const effectiveOwnerToken = ownerToken ?? Symbol('run-owner');
    // Continuation runs in the task's worktree when it still exists (spec
    // 006) — the resumed session sees exactly what the original run left.
    // Retention (#483) may have reclaimed this run's worktree directory while
    // keeping its branch and worktreePath. Re-materialize it on resume and clear
    // the stamp so the session regains its isolated tree and the run is eligible
    // for retention again — otherwise it keeps a dir on disk while staying
    // invisible to the enforcer forever. Best-effort; falls back to repoRoot.
    const beforePreparation = ctx.store.getRun(runId);
    const gatedContinuation = !!beforePreparation?.worktreePath && await ctx.lifecycle.requiresGate(runId).catch(() => true);
    if (ctx.abandonCancelledStart(runId)) return;
    if (beforePreparation?.worktreePath && gatedContinuation) {
      // Keep the original continuation intent durable before any script can start.
      const preparing: ContinuationActiveRun = {
        ownerToken: effectiveOwnerToken, cancelled: false, interrupt: () => undefined,
        cwd: beforePreparation.worktreePath, autonomous: beforePreparation.autonomous === true, autoContinues: 0,
        autosaveExcludedPaths: ctx.checkArtifactSnapshots.get(runId) ?? new Map(),
        checkInProgress: false, autosaveCheckpointBlocked: ctx.autosaveCheckpointBlockedRuns.has(runId),
      };
      ctx.active.set(runId, preparing); ctx.starting.delete(runId);
      const preparationController = new AbortController();
      preparing.interrupt = () => preparationController.abort();
      const gate = await ctx.lifecycle.prepare(runId, beforePreparation.baseBranch ?? 'HEAD', {
        kind: 'continuation', runId, stepId, sessionId, backend, prompt, images, persistedImages, persistedAttachments,
      }, preparationController.signal, {branch: beforePreparation.branch});
      if (preparing.cancelled) { ctx.dropActive(runId, preparing); return; }
      if (!gate.ready) { ctx.parkLifecycle(runId, preparing, gate.operationId); return; }
    } else {
      await rematerializeReclaimedWorktree(ctx.repoRoot, ctx.store, runId);
      if (ctx.abandonCancelledStart(runId)) return;
    }
    const record = ctx.store.getRun(runId);
    // A provider/account switch cannot resume the old provider-owned session. Reconstruct the
    // portable context from Onni's durable record + redacted event stream before this new turn's
    // user-message is appended. This works even when the interrupted agent never wrote HANDOFF.md.
    const portableContext = record && sessionId === undefined
      ? freshContinuationContext(record, ctx.store.readEvents(runId), ctx.attachmentsDir(runId))
      : undefined;
    // The record is mutated in place below; a missing-session fallback needs it as it was.
    const recordBeforeTurn = record && sessionId !== undefined
      ? { ...record, steps: record.steps.map((step) => ({ ...step })) }
      : undefined;
    // A fresh session is pinned and recorded up front, exactly like a workflow step's
    // (`runAgentStep`): Claude emits no `session` event of its own, so an unpinned fresh
    // continuation left its step without a session id, and the NEXT Continue resumed the last
    // step that had one — an older session under whatever account created it, silently undoing
    // the account switch this continuation was opened for. Runners that mint their own id still
    // overwrite it through the `session` event.
    const spawnSessionId = sessionId ?? randomUUID();
    // The env is a live ceiling: a run created while the inbox was on must not keep writing
    // follow-ups after it is switched off.
    const generateFollowups = followupsEnabled() && record?.generateFollowups !== false;
    const cwd =
      record?.worktreePath && (gatedContinuation || existsSync(record.worktreePath))
        ? record.worktreePath
        : ctx.repoRoot;
    // `autonomous` comes off the RECORD, not off an input: a continuation builds its OWN
    // ContinuationActiveRun (the second construction site of this shared shape — #811), and without these
    // two fields the turn-end nudge below read `undefined` and every autonomous continuation
    // parked at `waiting` like a normal one. The record is the durable copy `execute` wrote at
    // start and `recover` preserves. `autoContinues` restarts per session, which is the point:
    // the cap bounds ONE unattended stretch, and a human Continue is attention.
    const state: ContinuationActiveRun = {
      ownerToken: effectiveOwnerToken,
      cancelled: false,
      interrupt: () => undefined,
      cwd,
      autonomous: record?.autonomous === true,
      autoContinues: 0,
      autosaveExcludedPaths: ctx.checkArtifactSnapshots.get(runId) ?? new Map(),
      checkInProgress: false,
      autosaveCheckpointBlocked: ctx.autosaveCheckpointBlockedRuns.has(runId),
    };
    ctx.checkArtifactSnapshots.set(runId, state.autosaveExcludedPaths);
    ctx.active.set(runId, state);
    ctx.starting.delete(runId);
    // The same warm-up as `execute` (C-05): a continuation spawns its own CLI.
    await processJobs.ready();
    if (record?.worktreePath && state.cwd !== ctx.repoRoot) state.releaseWorktree = await ctx.lifecycle.acquireAgentLease(runId);
    state.readOnly = record?.readOnly === true && state.cwd === ctx.repoRoot;
    if (state.cwd === ctx.repoRoot) {
      state.autoLand = await ctx.landingPolicy(record, await loadConfig(ctx.repoRoot));
    }
    if (state.cwd === ctx.repoRoot && !state.readOnly) {
      if (ctx.helpers.repositoryRootLockDisabled()) {
        ctx.store.appendEvent(runId, {
          type: 'note',
          message: ctx.helpers.repositoryRootLockDisabledNote,
        });
      } else {
        ctx.store.appendEvent(runId, {
          type: 'note',
          message: 'waiting for exclusive access to the repository working tree',
        });
        if (!(await ctx.acquireRepoRoot(runId, state))) {
          ctx.store.updateRun(runId, {
            status: 'cancelled',
            finishedAt: new Date().toISOString(),
            currentStepId: undefined,
          });
          ctx.store.appendEvent(runId, { type: 'lifecycle', message: 'run cancelled' });
          ctx.dropActive(runId, state);
          return;
        }
      }
    }
    ctx.armAutosave(runId, state);
    if (record) seedHandoffFile(ctx.dataDir, record); // idempotent — normally already there
    // Registry snapshot for `/skill` expansion. `execute` loads this for the workflow's own
    // sessions; a continuation builds its OWN ContinuationActiveRun, and without this the resumed session
    // expanded against an empty registry and leaked `/om-...` verbatim to the backend, which
    // answered "Unknown skill" (#811). Best-effort — discovery must never break Continue.
    state.skills = await discoverSkills(ctx.repoRoot).catch(() => [] as Skill[]);
    // The dispatch session snapshot — the SECOND of the two `ContinuationActiveRun` construction
    // sites (spec 2026-09-10-dispatch; AGENTS.md § "every construction site"). A Continue
    // that skipped this would resume a task with no dispatch prompt and no way to dispatch:
    // a run that quietly degrades into an ordinary task.
    ctx.prepareDispatchSession(runId, state, await ctx.loadManagerSessionContext(runId, state));
    ctx.prepareAutomationsSession(state);

    // Cancellation may have retired this continuation while its async preparation was running.
    // Do not let the late promise make a durably cancelled run look active again.
    if (state.cancelled) {
      ctx.dropActive(runId, state);
      return;
    }

    ctx.store.updateRun(runId, {
      status: 'running',
      error: undefined,
      finishedAt: undefined,
      currentStepId: stepId,
      activity: undefined, // resuming a monitoring run — it's actively working again (#490)
    });
    ctx.store.updateStep(runId, stepId, {
      status: 'running',
      iterations: 1,
      startedAt: new Date().toISOString(),
      sessionId: spawnSessionId,
      backend,
    });
    ctx.store.appendEvent(runId, { type: 'step-start', stepId, name: 'Continue', kind: 'agent', iteration: 1 });
    // Attachments pasted into the follow-up composer, on the same terms as a live-session
    // message (#357): persisted to the run's own attachment store so the thread renders the
    // bubble's images rather than a bare count, and handed to the agent as absolute paths
    // appended to the prompt (so it can operate on them — and because codex/opencode drop image
    // blocks before they reach the model). An image ALSO rides along as a base64 block so the
    // model can view it; a file (#950) has nothing to view and travels as its path alone.
    const freshAttachments = ctx.persistPastedAttachments(runId, images);
    const openingImages = [...contentBlocksOf(images), ...persistedImages];
    const attachments = [...freshAttachments, ...persistedAttachments];
    ctx.store.appendEvent(runId, {
      type: 'user-message',
      stepId,
      text: prompt,
      imageCount: openingImages.filter((b) => b.type === 'image').length,
      ...(attachments.length ? { images: attachments.map((saved) => saved.url) } : {}),
    });

    let stepCost = 0;
    let turnText = '';
    let sessionError: string | undefined;
    const sink = ctx.makeUiSink(runId, stepId);
    const resumeGuard = new ResumeFallback(
      sessionId !== undefined,
      (event) => ctx.store.appendEvent(runId, { ...event, stepId }),
      (event) => ctx.handleRunnerUiEvent(runId, state, sink, event),
    );
    const onEvent = (event: AgentEvent) => {
      if (state.cancelled || ctx.active.get(runId) !== state) return;
      if (resumeGuard.hold(event)) {
        if (sessionError === undefined && event.type === 'error') {
          sessionError = event.message;
          interruptAfterGrace(state.session);
        }
        return;
      }
      if (event.type === 'image') {
        const saved = ctx.persistAttachment(runId, event.mediaType, event.data);
        if (saved) ctx.store.appendEvent(runId, { type: 'image', stepId, ...saved });
        return;
      }
      if (event.type === 'text') {
        turnText = ctx.helpers.appendTurnText(turnText, event.text);
        // `stripTaskMarkers` runs INNERMOST (#933): it deletes whole `ONNI:PR=`/`ONNI:ISSUE=`/
        // `ONNI:TITLE=` lines, so running it first lets the two trailing-marker strippers see a
        // `ONNI:MONITORING` / `ONNI:DONE` that an agent put ABOVE its task references. Outside-in
        // they saw those references and left the protocol marker in the transcript.
        const text = stripAskMarker(ctx.helpers.stripMonitoringMarker(ctx.helpers.stripDoneMarker(stripTaskMarkers(event.text))));
        if (text) ctx.store.appendEvent(runId, { type: 'text', text, stepId });
        return;
      }
      ctx.store.appendEvent(runId, { ...event, stepId });
      if (event.type === 'note') ctx.recordNoteMeta(runId, event);
      if (event.type === 'error') {
        sessionError ??= event.message;
        state.session?.interrupt();
        return;
      }
      if (sessionError) return;
      if (event.type === 'session') {
        ctx.store.updateStep(runId, stepId, { sessionId: event.sessionId, backend });
      }
      if (event.type === 'token-usage') {
        ctx.store.updateStep(runId, stepId, { tokensUsed: event.tokensUsed });
      }
      if (event.type === 'cost') {
        stepCost += event.usd;
        ctx.store.updateStep(runId, stepId, { costUsd: stepCost });
      }
      if (event.type === 'turn-end') {
        // Belt-and-braces: v2 `turn.completed` already flushed the delta
        // coalescers; the v1 turn boundary flushes again (idempotent) so no
        // buffered delta can outlive its turn.
        sink.flushAll();
        turnText = ctx.store.redactRunText(runId, turnText);
        void ctx.recordTurnEnd(runId, turnText, state); // titleSummary + diffStat (#389)
        const sessionOpen = !state.cancelled && state.session?.open;
        // Did the backend end this turn purely to compact its own context (#955)? Absent on
        // every runner that has no such signal, and on every recording written before the
        // field existed — which is exactly the pre-#955 behaviour.
        const compacted = event.reason === 'context-compaction';
        // Computed here because `turnText` is cleared further down, and only when the
        // boundary actually exists — on every ordinary turn the whole #955 path, this extra
        // marker scan included, stays inert.
        const markerless = compacted && ctx.helpers.markerlessTurn(turnText);
        // Any turn that did NOT end at a compaction boundary is the evidence the session is
        // working again, so the anti-spin budget is restored. Before the early returns below,
        // because a turn that finished or dispatched is progress too.
        if (!compacted) state.compactionContinues = 0;
        const done = sessionOpen && ctx.helpers.endsWithDoneMarker(turnText);
        // The dispatch facts of this turn (spec 2026-09-10-dispatch), through the ONE helper both
        // turn-end handlers call. Inert for a run with no `dispatch`.
        const dispatchTurn = ctx.handleDispatchTurn(runId, turnText, {
          state,
          stepId,
          done: Boolean(done),
        });
        // `ONNI:ASK` → the user is genuinely blocked; wins over `ONNI:MONITORING`
        // (a pending question is always attention), loses to `ONNI:DONE` (#473)
        // and to a turn that dispatched, which parks as a monitor.
        const { ask, notes: askNotes } = ctx.helpers.resolveAskTurn(
          turnText,
          Boolean(sessionOpen) && !done && !dispatchTurn.dispatched,
        );
        // A spawn parks the parent exactly as `ONNI:MONITORING` does — it is waiting on its
        // children, not on the user, and it has to surrender its slot to them. An over-budget run
        // parks `waiting` instead, whatever it asked for (Q6 ii).
        const monitoring =
          sessionOpen &&
          !done &&
          !ask &&
          !dispatchTurn.overBudget &&
          (dispatchTurn.dispatched || ctx.helpers.endsWithMonitoringMarker(turnText));
        turnText = '';
        for (const note of askNotes) ctx.store.appendEvent(runId, { type: 'note', ...note, stepId });
        // The twin of `runAgentStep`'s rule (#1282): a turn retires the question park an earlier
        // turn left standing, and the waiting branch below sets it again only when THIS turn asks
        // and parks. A stale park would settle an idle close as an unanswered question and keep
        // a task under "needs you" that is no longer asking anything.
        if (state.askPark === 'waiting') {
          state.askPark = undefined;
          if (ctx.store.getRun(runId)?.askParked) ctx.store.updateRun(runId, { askParked: undefined });
        }
        if (done) {
          // Goal achieved (agent contract, #347) — same as in runAgentStep.
          const close = () => {
            ctx.store.appendEvent(runId, { type: 'lifecycle', message: 'goal achieved — session closed' });
            appendHandoffHeartbeat(ctx.dataDir, runId, 'turn complete — goal achieved, session closed');
            state.session?.end();
          };
          if (!ctx.landOnDone(runId, state, stepId, close)) close();
          return;
        }
        // Autonomous (#autonomous): never hand the ball back to the user. Nudge the agent to
        // keep going (bounded by ctx.helpers.maxAutoContinues) instead of parking at `waiting`. Shared
        // with `runAgentStep`'s twin turn-end so the two cannot drift — including the shape:
        // hoisted out of the branch below because the heartbeat at the end of this handler
        // needs to know whether the turn parked.
        const nudged =
          dispatchTurn.rePrompted ||
          (!monitoring && (sessionOpen ? ctx.tryAutonomousNudge(runId, state, stepId, ask, dispatchTurn) : false));
        // Compaction alone never means the user owns the next action (#955). Tried LAST, so
        // every marker, the dispatch rules and the autonomous nudge keep their precedence —
        // the twin of `runAgentStep`'s call, through the one helper both sites share.
        const compactionContinued =
          !nudged && compacted && Boolean(sessionOpen)
            ? ctx.tryCompactionContinue(runId, state, stepId, { markerless, dispatchTurn })
            : false;
        const autoContinued = nudged || compactionContinued;
        if (sessionOpen) {
          if (!autoContinued) {
            // `ONNI:ASK` → park `waiting` (attention) AND surface the structured
            // question as an ask card (#473). `ONNI:MONITORING` → non-attention
            // `running`/`activity:'monitoring'` (#490). Both share the waiting
            // lifecycle (free the slot), while only plain waiting keeps the idle timer. Monitoring is
            // checked before the autonomous nudge, so it remains non-attention.
            const attentionRequest = ask ? ctx.recordAsk(runId, sink, ask) : undefined;
            if (ask) {
              state.askPark = 'waiting';
              state.monitorHandoff = false;
            }
            if (monitoring) {
              ctx.store.updateRun(runId, { status: 'running', activity: 'monitoring' });
              ctx.store.updateStep(runId, stepId, { status: 'running' });
              // A park caused by this turn's own dispatch is slot-exempt outright — see
              // `enterMonitoring` and `busySlots`.
              ctx.enterMonitoring(runId, dispatchTurn.dispatched);
              ctx.clearIdleTimer(state);
              ctx.armMonitoringWakeTimer(runId, state);
            } else {
              ctx.store.updateRun(runId, { status: 'waiting', activity: undefined, askParked: ask ? true : undefined, attentionRequest });
              ctx.store.updateStep(runId, stepId, { status: 'waiting' });
              ctx.leaveMonitoring(runId);
              ctx.clearMonitoringWakeTimer(state, runId);
            }
            ctx.parkRepoRoot(runId, state);
            ctx.waiting.add(runId);
            if (!monitoring) ctx.armIdleTimer(runId, state);
            ctx.releaseSlot();
          }
        }
        // A turn that completed is the ONLY evidence the provider's window actually reopened, so
        // it is what retires the consecutive-resume counter — which in turn releases the account
        // hold for every other task queued behind it (spec
        // 2026-08-03-auto-resume-after-usage-limit). `settleSuccess` does the same for a run that
        // finishes outright; this covers the far more common "parked for the user" ending.
        if (ctx.store.getRun(runId)?.autoResumeAttempts !== undefined) {
          ctx.store.updateRun(runId, { autoResumeAttempts: undefined, autoResumeReason: undefined });
        }
        // A nudged turn did NOT park, so it must not report that it did: the handoff file is
        // the rolling context the agent reads back on resume (spec 007), not a log, and an
        // autonomous run writing up to ctx.helpers.maxAutoContinues "status=waiting" lines would tell it
        // the exact opposite of what happened.
        appendHandoffHeartbeat(
          ctx.dataDir,
          runId,
          `turn complete — status=${
            compactionContinued
              ? 'running (context compacted, continuing)'
              : autoContinued
                ? 'running (autonomous nudge)'
                : monitoring
                  ? 'monitoring'
                  : sessionOpen
                    ? 'waiting'
                    : 'running'
          }`,
        );
      }
    };

    // Backend + model come off the record: the run's current backend by default, or the
    // follow-up override that `continueRun` persisted before scheduling (#401).
    const continueBackend = backend;
    /** Settle this turn as a failure before anything is spawned — the shape both
     *  pre-spawn gates below need (model identity, #405; temp directory, #785). */
    const failBeforeSpawn = (message: string): void => {
      if (state.cancelled || ctx.active.get(runId) !== state) {
        ctx.dropActive(runId, state);
        return;
      }
      const failedAt = new Date().toISOString();
      sink.sessionEnded('error', message);
      ctx.store.updateStep(runId, stepId, {
        status: 'failed',
        error: message,
        finishedAt: failedAt,
        // The fresh session pinned up front was never created: leaving its id on the step
        // would make the next Continue `--resume` a conversation that does not exist.
        ...(sessionId === undefined ? { sessionId: undefined } : {}),
      });
      ctx.store.updateRun(runId, {
        status: 'failed',
        error: `continue failed: ${message}`,
        finishedAt: failedAt,
        currentStepId: undefined,
      });
      ctx.store.appendEvent(runId, {
        type: 'lifecycle',
        message: `continue failed — ${message}`,
      });
      ctx.dropActive(runId, state);
    };
    // Apply the SAME canonical-identity gate the first spawn applies (#405, review M1).
    // A follow-up may switch both runner and model (#401), so without this the record keeps
    // asserting the identity the run STARTED with while a different model serves the turn —
    // the exact defect that PR existed to remove — and the raw record string reaches the CLI
    // in the un-normalised wire form the first step already converted away (`anthropic/opus`
    // instead of `opus`). Fail loud here too rather than let the backend pick a default.
    let continueModel: string | undefined;
    try {
      const normalized = normalizeModelForBackend(
        continueBackend,
        agentModelsLocked(ctx.repoRoot) ? undefined : record?.model,
        { configuredProvider: await ctx.helpers.configuredModelProvider(continueBackend, state.cwd) },
      );
      continueModel = normalized?.backendModel;
      ctx.store.updateRun(runId, {
        modelIdentity: normalized ? formatModelIdentity(normalized.identity) : undefined,
      });
      if (normalized) {
        ctx.store.updateStep(runId, stepId, { modelIdentity: formatModelIdentity(normalized.identity) });
      }
    } catch (err) {
      if (!(err instanceof ModelIdentityError)) throw err;
      failBeforeSpawn(err.message);
      return;
    }
    // Resuming reattaches to a session that lives inside ONE account's config dir, so the
    // continuation must run under the account that created it — not whatever the project has
    // been switched to since. The owning step is the one carrying this session id.
    const owningStep = sessionId === undefined
      ? undefined
      : record?.steps.find((s) => s.sessionId === sessionId);
    const resumedProfileId = owningStep?.profileId;
    // The owning step also names the session's tools: resolve `allowedTools`/`bashAllowlist`
    // from the persisted `workflowDef` exactly as the first spawn did (`runAgentStep`).
    // Rebuilding with the bare DEFAULT_ALLOWED_TOOLS silently revoked every per-step grant
    // (MCP servers, subagents) on Continue, restart recovery and the usage-limit auto-resume
    // — and dropping `bashAllowlist` WIDENED Bash from an allowlist to unrestricted
    // (`AgentRunSpec.allowedTools`, #430). Record steps share ids with `workflowDef.steps`;
    // a synthetic `continue-N` owner and a fresh-session continuation (backend switch — no
    // owning session) both extend the run's tail, so they resolve from the definition's last
    // agent step. A legacy record without `workflowDef` (#367), or a session no step owns,
    // keeps today's defaults.
    const defSteps = record?.workflowDef?.steps;
    const toolsStep =
      defSteps === undefined || (sessionId !== undefined && owningStep === undefined)
        ? undefined
        : defSteps.find((s) => s.id === owningStep?.id)
          ?? [...defSteps].reverse().find((s) => stepKind(s) === 'agent');
    // The temp-directory preflight (#785) rides along with the account resolution: a resumed
    // turn hits the same broken `/tmp` a fresh one would, and an agent whose shell silently
    // returns nothing is worse than a turn that refuses to start and says why.
    let continueProfile: Awaited<ReturnType<ContinuationContext['agentEnvForStep']>>;
    try {
      continueProfile = await ctx.agentEnvForStep(runId, continueBackend, {
        generateFollowups,
        recordedProfileId: resumedProfileId,
      });
    } catch (err) {
      if (!(err instanceof AgentTempDirError) && !(err instanceof TrackerAgentBindingError)) throw err;
      failBeforeSpawn(err.message);
      return;
    }
    ctx.store.updateStep(runId, stepId, { profileId: continueProfile.profileId });

    const runner = createRunner(continueBackend);
    const continueMcp = await ctx.privateMcpForLaunch(continueBackend, onEvent);
    if (state.cancelled) return;
    state.currentStepId = stepId;
    ctx.beginUsageInvocation(runId, state, stepId);
    // A continuation's opening message becomes the session's `userPrompt` and never passes
    // through `deliverMessage`, so it needs the SAME delivery-only `/skill` rewrite the
    // live path applies (#811). Delivery-only: the `user-message` event above already
    // persisted the user's original text, and the transcript must keep showing that.
    await ctx.provisionTaskSkills(state, { slash: ctx.helpers.leadingSlashSkillName(prompt) });
    const expandedPrompt = ctx.helpers.expandRegistrySlashSkillText(prompt, state.skills ?? []);
    // Reports that arrived while this run had no session (spec Q7) open the continuation, ahead
    // of whatever prompted it — a commander resumed by its own children's reports has to be told
    // what they said. Delivery-only, like the `/skill` rewrite above.
    const treeReports = ctx.flushPendingReports(runId);
    const treeInbox = ctx.flushInbox(runId);
    const treeBlocks = [treeReports, treeInbox].filter((block): block is string => Boolean(block));
    const openingPrompt = treeBlocks.length ? `${treeBlocks.join('\n\n')}\n\n---\n\n${expandedPrompt}` : expandedPrompt;
    // The previous runner's portable context (#954) opens the session first, then the tree
    // blocks above, then the instruction that prompted this continuation.
    const withContext = (context: string | undefined) => context
      ? `${context}\n\n---\n\n## New user instruction\n${openingPrompt}`
      : openingPrompt;
    state.grantedAttachmentLibrary = ctx.prepareAttachmentLibrary();
    const permissionSpec = await ctx.agentPermissionSpec(runId, continueBackend, onEvent, toolsStep?.bashAllowlist);
    const launch = (launchSessionId: string, resume: boolean, context: string | undefined): AgentSession => {
      const contextualOpeningPrompt = withContext(context);
      const started = runner.startSession(
        {
          // The Continue step is a fresh agent session on the same run — the
          // run's extra system prompt (already resolved at execute time and
          // echoed on the record) rides along with the handoff contract, and a
          // dispatch prompt rides along with both (spec 2026-09-10-dispatch).
          systemPrompt: composeSystemPrompt(
            dispatchPromptPart(state.dispatchPrompt, record?.systemPrompt),
            state.automationsPrompt,
            record?.systemPrompt,
            generateFollowups ? HANDOFF_INSTRUCTIONS : HANDOFF_ONLY_INSTRUCTIONS,
          ),
          userPrompt: attachments.length
            ? `${contextualOpeningPrompt}\n\n${pastedAttachmentsText(attachments, ctx.attachmentLibraryHint(attachments, state.grantedAttachmentLibrary))}`
            : contextualOpeningPrompt,
          ...(openingImages.length ? { images: openingImages } : {}),
          cwd: state.cwd,
          allowedTools: state.readOnly ? READ_ONLY_TOOLS : toolsStep?.allowedTools ?? DEFAULT_ALLOWED_TOOLS,
          bashAllowlist: state.readOnly ? undefined : toolsStep?.bashAllowlist,
          ...(isUnattended(ctx.store.getRun(runId)) ? { deniedTools: [...UNATTENDED_DENIED_TOOLS] } : {}),
          ...permissionSpec,
          additionalDirectories: agentDirectories(
            join(ctx.dataDir, 'runs'),
            state.grantedAttachmentLibrary,
            continueProfile.env,
          ),
          env: continueProfile.env,
          onUsageWindows: continueProfile.onUsageWindows,
          mcpServers: continueMcp,
          model: continueModel,
          sessionId: launchSessionId,
          resume,
          ...(resume ? { costBaselineUsd: ctx.sessionCostUsd(runId, launchSessionId) } : {}),
          timeoutMs: 0,
        },
        onEvent,
        {
          onUiEvent: (event) => {
            if (!resumeGuard.holdUi(event)) ctx.handleRunnerUiEvent(runId, state, sink, event);
          },
        },
      );
      state.session = resume ? resumeGuard.track(started) : started;
      state.sessionEverOpened = true;
      ctx.markQueuedManagerDeliveriesDelivered(runId);
      ctx.flushDeferred(runId);
      state.interrupt = () => started.interrupt();
      if (started.pid !== undefined) registerRunProcess(runId, started.pid);
      return started;
    };
    let session = launch(spawnSessionId, sessionId !== undefined, portableContext);

    const finishedAt = () => new Date().toISOString();
    try {
      try {
        await session.result;
        if (sessionError) throw new Error(sessionError);
      } catch (err) {
        // Claude pruned the transcript this task resumes (cleanupPeriodDays): continue in a fresh
        // session seeded with the task's persisted state instead of failing every Continue.
        const replay = state.cancelled || ctx.active.get(runId) !== state ? undefined : resumeGuard.takeFallback();
        if (!replay || !recordBeforeTurn || sessionId === undefined) throw err;
        sessionError = undefined;
        turnText = '';
        const freshId = randomUUID();
        ctx.store.updateStep(runId, stepId, { sessionId: freshId });
        ctx.store.appendEvent(runId, { type: 'note', stepId, message: MISSING_SESSION_NOTE });
        const context = freshContinuationContext(
          { ...recordBeforeTurn, steps: recordBeforeTurn.steps.filter((step) => step.id !== stepId) },
          ctx.store.readEvents(runId).filter((event) => event.stepId !== stepId),
          ctx.attachmentsDir(runId),
        );
        session = launch(freshId, false, context);
        for (const content of replay) session.sendMessage(content);
        await session.result;
        if (sessionError) throw new Error(sessionError);
      }
      // Before any branch below publishes a terminal status: the finally's autosave comes after it.
      state.turnSettled = true;
      sink.sessionEnded(state.cancelled ? 'cancelled' : 'end_turn');
      if (ctx.active.get(runId) !== state) return;
      if (state.cancelled) {
        ctx.store.updateStep(runId, stepId, { status: 'cancelled', finishedAt: finishedAt() });
        ctx.store.updateRun(runId, { status: 'cancelled', finishedAt: finishedAt(), currentStepId: undefined });
        ctx.store.appendEvent(runId, { type: 'lifecycle', message: 'run cancelled' });
        appendHandoffHeartbeat(ctx.dataDir, runId, `step "${stepId}" complete — status=cancelled`);
      } else if (state.askPark === 'waiting' && ctx.active.get(runId) === state) {
        state.askPark = undefined;
        ctx.settleUnansweredPark(runId, finishedAt(), state.monitorHandoff === true);
        appendHandoffHeartbeat(ctx.dataDir, runId, `step "${stepId}" complete — status=failed`);
      } else if (ctx.active.get(runId) === state && (await ctx.idleClosedFails(runId, state))) {
        // Review Git can outlive cancellation and retirement of this continuation.
        if (state.cancelled || ctx.active.get(runId) !== state) return;
        const message = ctx.inactivityFailureMessage(runId, state);
        const failedAt = finishedAt();
        ctx.store.updateStep(runId, stepId, { status: 'failed', error: message, finishedAt: failedAt });
        ctx.store.updateRun(runId, {
          status: 'failed',
          error: message,
          finishedAt: failedAt,
          currentStepId: undefined,
        });
        ctx.store.appendEvent(runId, { type: 'lifecycle', message: `run stopped — ${message}` });
      } else if (!state.cancelled && ctx.active.get(runId) === state) {
        ctx.store.updateStep(runId, stepId, { status: 'done', finishedAt: finishedAt() });
        ctx.store.appendEvent(runId, { type: 'step-end', stepId, status: 'done' });
        if (await ctx.settleSuccess(runId, state)) {
          appendHandoffHeartbeat(ctx.dataDir, runId, `step "${stepId}" complete — status=done`);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      state.turnSettled = true;
      sink.sessionEnded('error', message);
      if (!state.cancelled && ctx.active.get(runId) === state) {
        ctx.store.updateStep(runId, stepId, { status: 'failed', error: message, finishedAt: finishedAt() });
        appendHandoffHeartbeat(ctx.dataDir, runId, `step "${stepId}" complete — status=failed`);
        const failedAt = finishedAt();
        ctx.store.updateRun(runId, {
          status: 'failed',
          error: `continue failed: ${message}`,
          finishedAt: failedAt,
          currentStepId: undefined,
          // A session that crashed while parked on a question leaves that question unanswered.
          ...(state.askPark === 'waiting' ? { awaitingAnswerSince: failedAt } : {}),
        });
        ctx.store.appendEvent(runId, { type: 'lifecycle', message: `continue failed — ${message}` });
      }
    } finally {
      ctx.recordUsagePeaks(runId, state);
      ctx.clearIdleTimer(state);
      ctx.clearAutosaveTimer(state);
      if (
        !state.cancelled &&
        !state.autosaveCheckpointBlocked &&
        ctx.active.get(runId) === state &&
        state.cwd !== ctx.repoRoot
      ) {
        await autosaveCommit(state.cwd, 'turn end', await ctx.helpers.currentCheckExclusions(state.cwd, state.autosaveExcludedPaths));
      }
      ctx.dropActive(runId, state);
    }
  }

  // ---- execution -----------------------------------------------------------
