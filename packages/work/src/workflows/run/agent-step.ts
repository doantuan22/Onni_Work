import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { AUTO_END_DELAY_MS, DEFAULT_RUN_TIMEOUT_MS, type AgentSession } from '../../core/claude-cli-runner.ts';
import { ModelIdentityError, formatModelIdentity, normalizeModelForBackend } from '../../core/model-identity.ts';
import type { AgentEvent, AgentRunResult, ContentBlock, RunnerId } from '../../core/agent-runner.ts';
import { stripAskMarker, type AskRequest } from '../../core/ask.ts';
import { agentModelsLocked } from '../../core/agent-model-policy.ts';
import { createRunner } from '../../core/runner-factory.ts';
import type { UiEvent } from '../../core/ui-events.ts';
import { interruptAfterGrace, MISSING_SESSION_NOTE, ResumeFallback } from '../resume-fallback.ts';
import { AgentTempDirError } from '../../runs/agent-tmpdir.ts';
import { registerRunProcess } from '../../core/process-usage.ts';
import { stripTaskMarkers } from '../../runs/task-markers.ts';
import { discoverSkills, type Skill } from '../../skills.ts';
import { loadConfig } from '../../config.ts';
import { isUnattended } from '../unattended.ts';
import { generateRunName, autoNamingActive } from '../../runs/auto-name.ts';
import { uniqueBranchName } from '../../git-worktree.ts';
import { HANDOFF_INSTRUCTIONS, HANDOFF_ONLY_INSTRUCTIONS, appendHandoffHeartbeat, followupsEnabled } from '../../handoff.ts';
import { TrackerAgentBindingError } from '../../server/tracker/agent-credentials.ts';
import { UNATTENDED_DENIED_TOOLS } from '../push-guard.ts';
import { READ_ONLY_TOOLS } from '../landing.ts';
import { DEFAULT_AGENT_ACCOUNT_ID } from '../../workspace/agent-accounts.ts';
import { DEFAULT_ALLOWED_TOOLS, stepKind, type WorkflowStepDef } from '../types.ts';
import { stripVerdictMarker } from '../graph.ts';
import { UiEventSink } from '../../runs/ui-event-sink.ts';
import { freshContinuationContext } from '../continuation-context.ts';
import { agentDirectories, ATTACHMENT_ONLY_TASK, composeSystemPrompt, dispatchPromptPart, pastedAttachmentsText } from './preparation.ts';
import { applyTemplate, expandRegistrySlashSkillText, leadingSlashSkillName, skillSystemPrompt } from './check-steps.ts';
import type { AgentStepActiveRun, AgentStepContext } from './internal-types.ts';
import type { PersistedAttachment } from './preparation.ts';
import type { StartRunInput } from '../run.ts';
import type { RunRecord, StepState } from '../../runs/store.ts';
import type { PrivateMcpServer } from '../../core/private-mcp.ts';

/** Run one workflow agent step. Returns an error message, or null on success. */
export async function runAgentStep(
  ctx: AgentStepContext,
  runId: string,
  state: AgentStepActiveRun,
  step: WorkflowStepDef,
  input: StartRunInput,
  skills: Skill[],
  checkFailure: string | null,
  interactive: boolean,
  emit: (event: { type: string; stepId?: string; [k: string]: unknown }) => void,
  images: ContentBlock[] | undefined,
  taskBackend: RunnerId,
  extraSystemPrompt: string | undefined,
  /** The chain-boundary note for this step (#410), or undefined when the
   *  workflow has a single agent step and there is no boundary to explain. */
  chainNote: string | undefined,
  /** Pasted attachments already materialized to disk (#357) — their absolute
   *  paths are appended to `userPrompt` so the agent can operate on the
   *  real files, not just view the inline image blocks. */
  attachments: PersistedAttachment[] = [],
  /** Graph-workflow hooks (spec 2026-09-30-workflow-node-editor): reopen an earlier session
   *  instead of minting one, and hand back the last turn's text for verdict parsing.
   *  `usageLimitResume` reopens a step a usage limit interrupted (#1300). */
  graphHooks?: { resumeSessionId?: string; lastTurn?: { text: string }; usageLimitResume?: StepState },
): Promise<string | null> {
  const resumeStep = graphHooks?.usageLimitResume;
  let systemPrompt: string | undefined;
  // An attachment-only task (telemetry 18c930de) — the note stands in for the missing text, so a
  // step template (`Review: {{task}}`) still reads as a sentence.
  const taskText = input.task.trim() === '' && attachments.length ? ATTACHMENT_ONLY_TASK : input.task;
  const rawPrompt = applyTemplate(step.prompt ?? '{{task}}', taskText);
  // Install the selected skill and its companions where the agent's own skill lookup looks.
  const installed = await ctx.provisionTaskSkills(state, { stepSkill: step.skill, slash: leadingSlashSkillName(rawPrompt) });
  if (installed.length) {
    emit({ type: 'note', stepId: step.id, message: `skills installed in the task's workspace: ${installed.join(', ')}` });
  }
  if (step.skill) {
    const skill = (state.skills ?? skills).find((s) => s.name === step.skill);
    if (skill) {
      // The body alone often does not identify the selected skill. Keep its
      // name and catalog description in the normalized runner payload so a
      // numeric task such as "432" still gives the model enough context to
      // describe the work — and therefore derive a useful title (#432).
      systemPrompt = skillSystemPrompt(skill);
    } else {
      emit({
        type: 'note',
        stepId: step.id,
        message: `skill "${step.skill}" not found in .ai/onni/skills, .ai/skills or the team skills repo — running with the plain prompt`,
      });
    }
  }

  let userPrompt = rawPrompt;
  // A fresh run's OPENING prompt is delivered straight to `startSession`, never through
  // `deliverMessage`, so — like the continuation seam above (#811) — it needs the same
  // delivery-only `/skill` rewrite. Without it a task STARTED with `/om-...` as its first
  // message leaks the raw slash to the backend, which answers "Unknown command" even though
  // Onni lists the skill (#278). `state.skills` was populated by `discoverSkills` earlier in
  // `execute`. Expand before the chain/check/attachment prefixes so the leading slash still
  // matches; a leading `/name` that is not a known skill passes through byte-for-byte.
    userPrompt = expandRegistrySlashSkillText(userPrompt, state.skills ?? []);
  if (resumeStep) {
    const resumePrompt = ctx.autoResumeReasonFor(resumeStep.error) === 'transient' ? ctx.transientRetryPrompt : ctx.autoResumePrompt;
    userPrompt = `${resumePrompt}\n\nCurrent task and queued updates:\n\n${userPrompt}`;
  }
  if (chainNote) userPrompt = `${chainNote}\n\n---\n\n${userPrompt}`;
  // A commander recovered after a restart opens its first session holding whatever its children
  // reported while it was gone (spec Q7). Prepended and cleared here, after the slash expansion
  // so a leading `/skill` still matched, and before the failure/attachment suffixes.
  const treeReports = ctx.flushPendingReports(runId);
  const treeInbox = ctx.flushInbox(runId);
  const treeBlocks = [treeReports, treeInbox].filter((block): block is string => Boolean(block));
  if (treeBlocks.length) userPrompt = `${treeBlocks.join('\n\n')}\n\n---\n\n${userPrompt}`;
  if (checkFailure) {
    userPrompt += `\n\nA verification command failed after the previous attempt. Fix the cause. Failing output:\n\n${checkFailure}`;
  }
  if (images?.length) {
    emit({
      type: 'note',
      stepId: step.id,
      message: `${images.length} screenshot${images.length > 1 ? 's' : ''} attached to the task`,
    });
  }
  // Point the agent at the on-disk files (#357) — for an image the base64 block above already
  // let it *view* the file and this is what lets it *use* it (save, attach to an issue/PR, copy
  // into the repo); for a non-image attachment (#950) it is the only reference the agent gets
  // at all. Deliberately NOT nested in the branch above: gating the paths on an image block
  // existing is what would leave an agent holding a task about a `.pdf` it was never told the
  // location of.
  state.grantedAttachmentLibrary = ctx.prepareAttachmentLibrary();
  if (attachments.length) {
    userPrompt += `\n\n${pastedAttachmentsText(attachments, ctx.attachmentLibraryHint(attachments, state.grantedAttachmentLibrary))}`;
  }

  const sessionId = graphHooks?.resumeSessionId ?? randomUUID();
  const backend = step.runner ?? taskBackend;
  ctx.store.updateStep(runId, step.id, { sessionId, backend });

  const stepRecord = ctx.store.getRun(runId)?.steps.find((s) => s.id === step.id);
  const startTokens = stepRecord?.tokensUsed ?? 0;
  let stepCost = stepRecord?.costUsd ?? 0;
  let turnText = '';
  let sessionError: string | undefined;
  const sink = ctx.makeUiSink(runId, step.id);
  const resumeGuard = new ResumeFallback(
    graphHooks?.resumeSessionId !== undefined,
    (event) => emit({ ...event, stepId: step.id }),
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
      if (saved) emit({ type: 'image', stepId: step.id, ...saved });
      return;
    }
    if (event.type === 'text') {
      turnText = ctx.appendTurnText(turnText, event.text);
      // `stripTaskMarkers` runs INNERMOST (#933): it deletes whole `ONNI:PR=`/`ONNI:ISSUE=`/
      // `ONNI:TITLE=` lines, so running it first lets the two trailing-marker strippers see a
      // `ONNI:MONITORING` / `ONNI:DONE` that an agent put ABOVE its task references. Outside-in
      // they saw those references and left the protocol marker in the transcript.
      const text = stripVerdictMarker(
          stripAskMarker(ctx.stripMonitoringMarker(ctx.stripDoneMarker(stripTaskMarkers(event.text)))),
      );
      if (text) emit({ type: 'text', text, stepId: step.id });
      return;
    }
    emit({ ...event, stepId: step.id });
    if (event.type === 'note') ctx.recordNoteMeta(runId, event);
    if (event.type === 'error') {
      sessionError ??= event.message;
      state.session?.interrupt();
      return;
    }
    if (sessionError) return;
    if (event.type === 'session') {
      // Codex/OpenCode mint their own session id — persist it so resume works.
      ctx.store.updateStep(runId, step.id, { sessionId: event.sessionId, backend });
    }
    if (event.type === 'token-usage') {
      ctx.store.updateStep(runId, step.id, { tokensUsed: startTokens + event.tokensUsed });
    }
    if (event.type === 'cost') {
      stepCost += event.usd;
      ctx.store.updateStep(runId, step.id, { costUsd: stepCost });
    }
    if (event.type === 'turn-end') {
      // v2 `turn.completed` already flushed the coalescers; the v1 turn
      // boundary flushes again (idempotent) as a backstop.
      sink.flushAll();
      turnText = ctx.store.redactRunText(runId, turnText);
      void ctx.recordTurnEnd(runId, turnText, state); // titleSummary + diffStat (#389)
      const sessionOpen = !state.cancelled && state.session?.open;
      // The twin of `runContinuation`'s read — see there for why the field is absent on
      // every runner and every recording that predates it (#955).
      const compacted = event.reason === 'context-compaction';
        const markerless = compacted && ctx.markerlessTurn(turnText);
      if (!compacted) state.compactionContinues = 0;
        const done = interactive && sessionOpen && ctx.endsWithDoneMarker(turnText);
      // The dispatch facts, through the same ONE helper `runContinuation` calls (spec
      // 2026-09-10-dispatch A5). Not gated on `interactive`: a report and a dispatch
      // are the agent telling onni what it did, and a chained workflow's non-final step that
      // reported would otherwise be heard by nobody. The PARK below is no longer
      // interactive-only either (#1076): a non-final step that dispatched, or that emitted
      // `ONNI:MONITORING`, is waiting on work it started, so it holds the workflow at that step
      // exactly as a non-final `ONNI:ASK` does (#917) instead of closing and running the next check.
      const dispatchTurn = ctx.handleDispatchTurn(runId, turnText, {
        state,
        stepId: step.id,
        done: Boolean(done),
      });
      // `ONNI:ASK` → the user is blocked; wins over `ONNI:MONITORING`, loses to
      // `ONNI:DONE` (#473) and to a turn that dispatched.
      //
      // No longer gated on `interactive` (#917). `interactive` is only true for
      // the final step, so a `ONNI:ASK` from an implementation or review step was
      // ignored outright and the workflow advanced into its next check — which
      // then failed, marking the whole run failed while the question was still on
      // the user's screen. Every agent step may need user input. The
      // `!dispatchTurn.dispatched` half of the gate is unchanged and still right
      // for every step: a turn that spawned children is waiting on them, not on
      // the user.
        const { ask, notes: askNotes } = ctx.resolveAskTurn(
        turnText,
        Boolean(sessionOpen) && !done && !dispatchTurn.dispatched,
      );
      // Does this turn park the WORKFLOW — hold a non-final step open instead
      // of letting `execute` mark it done and run the next check (#917, #1076)?
      //
      // Only a parsed ASK or valid monitoring marker can: a malformed ASK produces no ask card,
      // so parking on it would halt an otherwise autonomous workflow on a question the user
      // cannot even see, for as long as the session lives.
      // It degrades to the `resolveAskTurn` note plus the raw marker left in
      // the transcript, and the workflow carries on. The final interactive step
      // is untouched by this: it parks at `waiting` whatever the marker looked
      // like, where the prose fallback is still answerable and nothing
      // downstream is being blocked (#473).
      // A spawn parks the commander like `ONNI:MONITORING` does — it waits on its children and
      // gives them its slot. The budget brake (Q6 ii) overrides both and parks `waiting`.
      const monitoring =
        sessionOpen &&
        !done &&
        !ask &&
        !dispatchTurn.overBudget &&
          (dispatchTurn.dispatched || ctx.endsWithMonitoringMarker(turnText));
      const parksWorkflow = !interactive && (ask !== null || monitoring);
      // A turn that does not park retires a park an earlier turn left standing. The park is
      // otherwise cleared only by `sendMessage`, and a parked session can wake without one:
      // Claude Code re-invokes the model itself when a background command or sub-agent it
      // started finishes. Left in place, a later `ONNI:DONE` settled the step as a question
      // nobody answered and the workflow never reached its next step (live run 2c2d2e34).
      // `abandoned` is Finish's and stays — it must still stop the workflow here.
      if (!parksWorkflow && state.askPark === 'waiting') {
        state.askPark = undefined;
        if (ctx.store.getRun(runId)?.askParked) ctx.store.updateRun(runId, { askParked: undefined });
      }
      if (graphHooks?.lastTurn) graphHooks.lastTurn.text = turnText;
      turnText = '';
      for (const note of askNotes) emit({ type: 'note', stepId: step.id, ...note });
      if (done) {
        // Goal achieved (agent contract, #347): close the session instead
        // of parking at `waiting` — the run completes and frees its slot.
        const close = () => {
          emit({ type: 'lifecycle', message: 'goal achieved — session closed' });
          appendHandoffHeartbeat(ctx.dataDir, runId, 'turn complete — goal achieved, session closed');
          state.session?.end();
        };
        if (!ctx.landOnDone(runId, state, step.id, close)) close();
        return;
      }
      // `waiting` now also covers a NON-final step parking on an ask or monitor (#917, #1076),
      // which is what holds the workflow at that step instead of running its next check.
      const waiting = (interactive || parksWorkflow) && sessionOpen;
      // Autonomous (#autonomous): never hand the ball back to the user. Nudge the agent to keep
      // going (bounded by MAX_AUTO_CONTINUES) instead of parking at `waiting`. The SAME helper
      // `runContinuation`'s twin turn-end calls — this branch was missing here entirely, so an
      // autonomous run's FIRST session parked like any other (the nudge only ever existed on
      // the continuation path).
      //
      // Widening `waiting` (#917) deliberately brings the intermediate park under the nudge
      // too, and the ordering matters: #967's promise is that an autonomous run never stops for
      // a human, and an intermediate ask is exactly as unanswerable as a final one when nobody
      // is watching. Parking it would strand the run on a question with no one to read it —
      // strictly worse than the pre-#917 behaviour, which at least kept going. So the nudge
      // wins, and the backstop it already carries covers the genuinely blocked case: an agent
      // that repeats the SAME question after being nudged sets `lastOverriddenAsk` and parks on
      // the second ask. For every non-autonomous run `tryAutonomousNudge` returns at its first
      // line, so the park below behaves exactly as #917 designed it.
      const autoContinued =
        dispatchTurn.rePrompted ||
        (!monitoring && (waiting ? ctx.tryAutonomousNudge(runId, state, step.id, ask, dispatchTurn) : false));
      // The compaction continuation (#955), through the same helper `runContinuation` calls.
      // Deliberately NOT gated on `waiting`: that flag is about who the turn hands control
      // to, and an ordinary intermediate step never hands control to anyone — it is closed
      // by the one-shot timer below. A step whose turn ended at a compaction boundary would
      // therefore be closed with its work half done, which is the same defect wearing a
      // different status. `sessionOpen` is the only precondition that actually matters here.
      const compactionContinued =
        !autoContinued && compacted && Boolean(sessionOpen)
          ? ctx.tryCompactionContinue(runId, state, step.id, { markerless, dispatchTurn })
          : false;
      const continued = autoContinued || compactionContinued;
      if (waiting && !continued) {
        // Turn over, session open. Either the ball is in the user's court
        // (`waiting`) — optionally with a structured `ONNI:ASK` question the
        // cockpit renders as an ask card (#473) — or the agent declared it is
        // still working on its own downstream work with `ONNI:MONITORING`, which
        // parks as `running`/`activity:'monitoring'`, a non-attention state,
        // instead of raising "needs you" (#490). Lifecycle is identical: the
        // run frees its slot; only plain waiting keeps the idle timer. The autonomous nudge
        // above still wins over either.
        const attentionRequest = ask ? ctx.recordAsk(runId, sink, ask) : undefined;
        // The final interactive step already parks at `waiting` by its own
        // lifecycle; only a non-final step needs the workflow held back, so
        // `execute` does not mark it done and run the next check (#917).
        // Inside the `!autoContinued` branch on purpose: a nudged autonomous
        // turn did not park, so it must not leave a park behind for `execute`
        // to settle.
        if (ask) {
          state.askPark = 'waiting';
          state.monitorHandoff = false;
        }
        if (monitoring) {
          ctx.store.updateRun(runId, { status: 'running', activity: 'monitoring' });
          ctx.store.updateStep(runId, step.id, { status: 'running' });
          // The twin of `runContinuation`'s park: a spawn-caused park is slot-exempt outright
          // (`enterMonitoring` / `busySlots`), a plain `ONNI:MONITORING` one is capped.
          ctx.enterMonitoring(runId, dispatchTurn.dispatched);
          ctx.clearIdleTimer(state);
          ctx.armMonitoringWakeTimer(runId, state);
        } else {
          ctx.store.updateRun(runId, {
            status: 'waiting',
            activity: undefined,
            // The durable half of the park, and the only thing a restart can
            // read: without it `recover()` cannot tell this `waiting` from a
            // finished interactive session and settles it as a success.
            askParked: ask ? true : undefined,
            attentionRequest,
          });
          ctx.store.updateStep(runId, step.id, { status: 'waiting' });
          ctx.leaveMonitoring(runId);
          ctx.clearMonitoringWakeTimer(state, runId);
        }
        ctx.parkRepoRoot(runId, state);
        ctx.waiting.add(runId);
        if (!monitoring) ctx.armIdleTimer(runId, state);
        ctx.releaseSlot(); // the freed slot can start a queued run right away — in any project
      }
      // One-shot close for an ordinary intermediate step — the behavior the
      // runners' `autoEndAfterFirstTurn` used to provide, moved here so a step
      // that parks on a `ONNI:ASK` can keep its session open for the answer
      // instead of having the runner close it first (#917).
      //
      // The delay reproduces the runners' own `AUTO_END_DELAY_MS`, which they
      // all apply for the same two reasons: `end()` stays out of the event
      // dispatch that is announcing the turn, and frames trailing the turn's
      // final `result` message still land before stdin closes. The session is
      // captured rather than re-read so a later step's session can never be
      // the one this timer closes.
      //
      // `!autoContinued` is the one condition the runners' own flag could not
      // express: a turn that was nudged or re-prompted has just had a message
      // written into its session, and closing it 250 ms later would throw that
      // turn away. Cancellation is deliberately NOT handled here — `sessionOpen`
      // is false once `state.cancelled` is set, and `cancel()` tears the session
      // down through `state.interrupt()` instead.
      const closing = state.session;
      if (!interactive && sessionOpen && !parksWorkflow && !continued && closing) {
        const autoEnd = setTimeout(() => {
          if (closing.open) closing.end();
        }, AUTO_END_DELAY_MS);
        autoEnd.unref?.();
      }
      // The window is proven open — see the twin in `runContinuation`.
      if (ctx.store.getRun(runId)?.autoResumeAttempts !== undefined) {
        ctx.store.updateRun(runId, { autoResumeAttempts: undefined, autoResumeReason: undefined });
      }
      // Onni's own heartbeat — the handoff stays current even when the
      // agent forgets to write (spec 007).
      // A nudged turn did NOT park — see the twin in `runContinuation` for why the handoff
      // file must not claim otherwise.
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
                : waiting
                  ? 'waiting'
                  : 'running'
        }`,
      );
    }
  };

  const stepBackend = step.runner ?? taskBackend;
  // Normalise the selected model to canonical `provider/model` and back to the
  // backend's own wire form via the ONE shared mapper (#405). Fail-loud: an
  // unresolvable model (e.g. a bare id on opencode) returns the step error
  // instead of letting the backend silently substitute its default.
  let backendModel: string | undefined;
  try {
    const normalized = normalizeModelForBackend(
      stepBackend,
      // The task's model was picked for the task's runner; a step on another runner gets its own default.
      agentModelsLocked(ctx.repoRoot) ? undefined : step.model ?? (stepBackend === taskBackend ? input.model : undefined),
      { configuredProvider: await ctx.configuredModelProvider(stepBackend, state.cwd) },
    );
    backendModel = normalized?.backendModel;
    // Persist the identity of what ACTUALLY runs (#405, review M1). The run-start echo
    // (line ~993) is best-effort from `taskBackend`/`input.model`; a per-step `runner`/`model`
    // override makes it assert a model that never ran. Re-write it here, from the resolved
    // step identity, so the record — the product of this PR — is always one that ran.
    ctx.store.updateRun(runId, {
      modelIdentity: normalized ? formatModelIdentity(normalized.identity) : undefined,
    });
    if (normalized) {
      ctx.store.updateStep(runId, step.id, { modelIdentity: formatModelIdentity(normalized.identity) });
    }
  } catch (err) {
    if (err instanceof ModelIdentityError) return err.message;
    throw err;
  }
  // Which agent account this step spawns under, and — recorded on the step before the spawn —
  // which one its session belongs to. `sessionId` and `profileId` are a pair: a resume that
  // reads the wrong account's config dir finds no session and silently starts a fresh one.
  // Resolved together with the temp-directory preflight (#785): the step fails with a named,
  // actionable error instead of spawning a backend whose shell would return empty output.
  let stepProfile: Awaited<ReturnType<AgentStepContext['agentEnvForStep']>>;
  try {
    stepProfile = await ctx.agentEnvForStep(runId, stepBackend, {
      generateFollowups: followupsEnabled() && input.generateFollowups !== false,
      ...(resumeStep ? { recordedProfileId: resumeStep.profileId ?? DEFAULT_AGENT_ACCOUNT_ID } : {}),
    });
  } catch (err) {
    if (err instanceof AgentTempDirError || err instanceof TrackerAgentBindingError) return err.message;
    throw err;
  }
  ctx.store.updateStep(runId, step.id, { profileId: stepProfile.profileId });

  const runner = createRunner(stepBackend);
  const stepMcp = await ctx.privateMcpForLaunch(stepBackend, onEvent);
  let session: AgentSession;
  state.currentStepId = step.id;
  ctx.beginUsageInvocation(runId, state, step.id);
  if (state.cancelled) return 'cancelled';
  const permissionSpec = await ctx.agentPermissionSpec(runId, stepBackend, onEvent);
  const launch = (launchSessionId: string, resume: boolean, prompt: string): AgentSession =>
    runner.startSession(
      {
        // Skill body, then the dispatch prompt (spec 2026-09-10-dispatch — how a task dispatches,
        // reports and asks), then the automations prompt (spec 2026-09-13-automations-from-prompt
        // — how a task creates a GitHub automation), then the run's extra
        // prompt (POST override or config default, which may amend any of them), then the
        // handoff/todos contract — every agent step.
        systemPrompt: composeSystemPrompt(
          systemPrompt,
          dispatchPromptPart(state.dispatchPrompt, extraSystemPrompt),
          state.automationsPrompt,
          extraSystemPrompt,
          followupsEnabled() && input.generateFollowups !== false
            ? HANDOFF_INSTRUCTIONS
            : HANDOFF_ONLY_INSTRUCTIONS,
        ),
        userPrompt: prompt,
        images,
        cwd: state.cwd,
        allowedTools: state.readOnly ? READ_ONLY_TOOLS : step.allowedTools ?? DEFAULT_ALLOWED_TOOLS,
        bashAllowlist: state.readOnly ? undefined : step.bashAllowlist,
        ...(isUnattended(ctx.store.getRun(runId)) ? { deniedTools: [...UNATTENDED_DENIED_TOOLS] } : {}),
        ...permissionSpec,
        // The handoff file lives outside the worktree — grant access.
        additionalDirectories: agentDirectories(
          join(ctx.dataDir, 'runs'),
          state.grantedAttachmentLibrary,
          stepProfile.env,
        ),
        env: stepProfile.env,
        onUsageWindows: stepProfile.onUsageWindows,
        mcpServers: stepMcp,
        model: backendModel,
        sessionId: launchSessionId,
        resume,
        ...(resume ? { costBaselineUsd: ctx.sessionCostUsd(runId, launchSessionId) } : {}),
        // Interactive sessions have no runner timeout — the idle timer rules.
        //
        // A non-final step keeps the runner's timeout (`DEFAULT_RUN_TIMEOUT_MS`
        // of silence, with a hard ceiling behind it — cf2191f1) even though it
        // may now park on a `ONNI:ASK` and sit open waiting for an answer (#917).
        // Dropping it for every intermediate step is the
        // wrong trade: it would leave a runaway step with nothing to stop it,
        // to buy a park that is bounded by the 15-minute idle timer first in
        // all but the longest steps. What matters is that neither expiry can
        // strand the run — both close the session, and a park whose session
        // closed unanswered settles as `failed` with a Continue button (see
        // the `askPark` branch in `execute`), never as a run stuck `waiting`.
        timeoutMs: interactive ? 0 : undefined,
      },
      onEvent,
      {
        // Ordinary intermediate sessions are closed explicitly at turn-end
        // instead (with the same delay the runners apply). That is what lets
        // the turn-end handler hold an intermediate `ONNI:ASK` session open for
        // the user's answer rather than have the runner close it first (#917).
        autoEndAfterFirstTurn: false,
        onUiEvent: (event) => {
          if (!resumeGuard.holdUi(event)) ctx.handleRunnerUiEvent(runId, state, sink, event);
        },
      },
    );
  const attach = (started: AgentSession, resume: boolean): AgentSession => {
    state.session = resume ? resumeGuard.track(started) : started;
    state.sessionEverOpened = true;
    ctx.markQueuedManagerDeliveriesDelivered(runId);
    // A Finish pressed on an earlier step's session is not a repeat of one on this session.
    state.finishRequested = undefined;
    state.acceptReviewOnDrop = undefined;
    ctx.flushDeferred(runId);
    state.currentStepId = step.id;
    state.interrupt = () => started.interrupt();
    if (started.pid !== undefined) registerRunProcess(runId, started.pid);
    return started;
  };
  try {
    session = attach(launch(sessionId, graphHooks?.resumeSessionId !== undefined, userPrompt), graphHooks?.resumeSessionId !== undefined);
  } catch (err) {
    state.currentStepId = undefined;
    return err instanceof Error ? err.message : String(err);
  }

  try {
    let result: AgentRunResult;
    try {
      result = await session.result;
      if (sessionError) throw new Error(sessionError);
    } catch (err) {
      // The node's own session was pruned by Claude (cleanupPeriodDays): rerun the node in a
      // fresh session seeded with the task's persisted state, as `runContinuation` does.
      const resumedId = graphHooks?.resumeSessionId;
      const replay = state.cancelled || ctx.active.get(runId) !== state ? undefined : resumeGuard.takeFallback();
      const record = ctx.store.getRun(runId);
      if (!replay || resumedId === undefined || !record) throw err;
      sessionError = undefined;
      turnText = '';
      const freshId = randomUUID();
      ctx.store.updateStep(runId, step.id, { sessionId: freshId, backend });
      emit({ type: 'note', stepId: step.id, message: MISSING_SESSION_NOTE });
      const context = freshContinuationContext(record, ctx.store.readEvents(runId), ctx.attachmentsDir(runId));
      session = attach(launch(freshId, false, `${context}\n\n---\n\n## New user instruction\n${userPrompt}`), false);
      for (const content of replay) session.sendMessage(content);
      result = await session.result;
      if (sessionError) throw new Error(sessionError);
    }
    // v2 counterpart of v1's `done` (spec: the mappers leave session-close
    // events to the RunManager — only it knows how the session settled).
    sink.sessionEnded(state.cancelled ? 'cancelled' : 'end_turn');
    if (!state.cancelled && ctx.active.get(runId) === state) {
      ctx.store.updateStep(runId, step.id, { tokensUsed: startTokens + result.tokensUsed });
    }
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sink.sessionEnded('error', message); // alongside v1's fatal `error`
    return message;
  } finally {
    ctx.recordUsagePeaks(runId, state);
    ctx.clearIdleTimer(state);
    if (ctx.active.get(runId) === state) {
      ctx.leaveMonitoring(runId);
      ctx.waiting.delete(runId);
    }
    ctx.clearMonitoringWakeTimer(state, runId);
    state.session = undefined;
    state.currentStepId = undefined;
    state.interrupt = () => undefined;
  }
}

/**
 * Protocol-v2 sink for one agent session (R2 step 2.1): the runner's
 * `onUiEvent` stream flows through here. Persisted snapshots ride the same
 * NDJSON file as v1 (the store stamps `seq`/`ts`, `appendEvent` fans them
 * out live too); coalesced `item.delta` flushes go out live-only via
 * `emitEphemeral` — raw deltas never hit disk (spec §performance
 * guardrails). One sink per session: cumulative usage dedup and the
 * item-shape cache are session-scoped, like the mapper state feeding them.
 */
export function makeUiSink(ctx: AgentStepContext, runId: string, stepId: string): UiEventSink {
  return new UiEventSink({
    persist: (event) => ctx.store.appendEvent(runId, { ...event, stepId }),
    emitLive: (event) => ctx.store.emitEphemeral(runId, { ...event, stepId }),
  });
}

/** Native backend asks arrive before turn-end. Persist and park immediately
 * so the cockpit shows attention and the run releases its workspace slot. */
export function handleRunnerUiEvent(
  ctx: AgentStepContext,
  runId: string,
  state: AgentStepActiveRun,
  sink: UiEventSink,
  event: UiEvent,
): void {
  if (state.cancelled || (ctx.active.has(runId) && ctx.active.get(runId) !== state)) return;
  ctx.recordUsageUiEvent(runId, state, event);
  sink.handle(event);
  if (event.type !== 'ask.requested' || state.cancelled) return;
  ctx.clearIdleTimer(state);
  ctx.leaveMonitoring(runId);
  ctx.clearMonitoringWakeTimer(state, runId);
  ctx.waiting.add(runId);
  ctx.store.updateRun(runId, { status: 'waiting', activity: undefined, attentionRequest: ctx.recordAttention(event.requestId, event.questions) });
  if (state.currentStepId) ctx.store.updateStep(runId, state.currentStepId, { status: 'waiting' });
  ctx.releaseSlot();
}

/** Persist the invocation checkpoint before launching a runner. A throw or
 * process exit before `turn.started` therefore leaves a durable mismatch. */
export function beginUsageInvocation(
  ctx: AgentStepContext,
  runId: string,
  state: AgentStepActiveRun,
  stepId: string,
): void {
  const step = ctx.store.getRun(runId)?.steps.find((candidate) => candidate.id === stepId);
  if (!step) return;
  const epoch = (step.usageInvocationEpoch ?? 0) + 1;
  ctx.persistUsageCheckpoint(runId, stepId, {
    usageInvocationEpoch: epoch,
    usageInvocationsStarted: (step.usageInvocationsStarted ?? 0) + 1,
  });
  state.usageInvocation = {
    stepId,
    epoch,
    observed: false,
    startedTurns: new Set(),
    recordedTurns: new Set(),
  };
}

/** Fold backend-neutral completed-turn usage into the current step exactly
 * once. Invocation/turn counters are written before the event reaches the
 * NDJSON sink so crashes cannot preserve a falsely complete subtotal. */
export function recordUsageUiEvent(
  ctx: AgentStepContext,
  runId: string,
  state: AgentStepActiveRun,
  event: UiEvent,
): void {
  const invocation = state.usageInvocation;
  if (!invocation) return;
  const step = ctx.store.getRun(runId)?.steps.find((candidate) => candidate.id === invocation.stepId);
  if (!step) return;

  if (event.type === 'turn.started') {
    if (invocation.startedTurns.has(event.turnId)) return;
    invocation.startedTurns.add(event.turnId);
    const firstObservedTurn = !invocation.observed;
    invocation.observed = true;
    ctx.persistUsageCheckpoint(runId, invocation.stepId, {
      usageTurnsStarted: (step.usageTurnsStarted ?? 0) + 1,
      ...(firstObservedTurn
        ? { usageInvocationsObserved: (step.usageInvocationsObserved ?? 0) + 1 }
        : {}),
    });
    return;
  }

  if (event.type !== 'turn.completed') return;
  if (!invocation.startedTurns.has(event.turnId) || invocation.recordedTurns.has(event.turnId)) return;
  const input = event.usage?.input;
  const output = event.usage?.output;
  if (
    typeof input !== 'number' ||
    !Number.isFinite(input) ||
    input < 0 ||
    typeof output !== 'number' ||
    !Number.isFinite(output) ||
    output < 0
  ) {
    return;
  }
  invocation.recordedTurns.add(event.turnId);
  ctx.persistUsageCheckpoint(runId, invocation.stepId, {
    inputTokens: (step.inputTokens ?? 0) + input,
    outputTokens: (step.outputTokens ?? 0) + output,
    usageTurnsRecorded: (step.usageTurnsRecorded ?? 0) + 1,
  });
}

/** Usage completeness is a crash boundary, unlike high-frequency token
 * snapshots: the checkpoint must reach `runs.json` before the runner starts
 * or the matching UI event is persisted and forwarded. */
export function persistUsageCheckpoint(
  ctx: AgentStepContext,
  runId: string,
  stepId: string,
  patch: Partial<Omit<StepState, 'id'>>,
): void {
  ctx.store.updateStep(runId, stepId, patch);
  ctx.store.flush();
}

/**
 * Turn-end bookkeeping (#389), shared by `runAgentStep` and
 * `runContinuation` — called (fire-and-forget) from every `turn-end` event:
 *
 *  - `titleSummary`: derived from the turn's text, set ONCE — only while the
 *    record has none. A user's inline edit also lands in `titleSummary`
 *    (see `PATCH /api/runs/:id`), so an edit is never overwritten either.
 *  - `diffStat`: cheap `git diff --shortstat` vs the base, refreshed every
 *    turn. Async and best-effort — a git failure becomes at most a `note`
 *    event, NEVER a run failure. `updateRun` fans the record out over SSE,
 *    so the list views pick both up with no extra wiring.
 *
 * Not `private` so the integration tests can drive a turn-end directly —
 * a real agent session is the only other way to reach this path.
 */
/**
 * The namer's apply path (task auto-naming spec). Fire-and-forget: called
 * without await from `startRun` (creation) and `recordTurnEnd` (live
 * refresh). A user-owned title (`titleOrigin: 'user'`) is never overwritten;
 * namer-owned titles may be replaced by fresher namer results.
 */
/**
 * Resolves to the namer's branch (spec 2026-10-11-branch-naming-instructions) on the
 * creation call — undefined whenever naming is off, unconfigured, or the answer was unusable.
 */
export async function autoNameRun(
  ctx: AgentStepContext,
  runId: string,
  skillName: string | undefined,
  task: string,
  live?: { turnText?: string; diffStat?: string },
): Promise<string | undefined> {
  // ONNI_AUTONAME=0 kills all LLM naming; dry-run skips it too unless
  // ONNI_AUTONAME=1 forces the mock path — see autoNamingActive.
  if (!autoNamingActive()) return undefined;
  task = ctx.store.redactRunText(runId, task);
  if (live?.turnText) live = { ...live, turnText: ctx.store.redactRunText(runId, live.turnText) };
  try {
    let skillDescription: string | undefined;
    if (skillName) {
      const skills = await discoverSkills(ctx.repoRoot).catch(() => [] as Skill[]);
      skillDescription = skills.find((s) => s.name === skillName)?.description;
    }
    // Only the creation call names the branch: the live refresh must never move it.
    const scheduled = ctx.store.getRun(runId);
    let execution: Parameters<typeof generateRunName>[2];
    // A scheduled launch names under its bound account with the ordinary namer model; a live
    // refresh is ordinary naming and must not re-probe the binding (#1340).
    if (!live && scheduled && ctx.deferredBindingActive(scheduled, ctx.store.listRuns())) {
      const first = scheduled.workflowDef?.graph
        ? Object.values(scheduled.workflowDef.graph.nodes).find(node => node.type === 'agent')
        : scheduled.workflowDef?.steps.find(s => stepKind(s) === 'agent');
      const runner = first?.runner ?? scheduled.runner ?? 'claude';
      const profile = await ctx.agentEnvForStep(runId, runner);
      const { namerModel } = await loadConfig(ctx.repoRoot);
      execution = { runner, model: runner === 'claude' ? namerModel : undefined, env: profile.env, onUsageWindows: profile.onUsageWindows };
    }
    const result = await generateRunName(ctx.repoRoot, { task, skillName, skillDescription, ...live, nameBranch: !live }, execution);
    if (!result) return undefined;
    const run = ctx.store.getRun(runId);
    // Marker-owned state outranks the namer (spec 2026-07-18-task-ref-markers):
    // a declared title blocks the whole apply (this call raced the marker),
    // and a declared pr/issue kind blocks that kind field-by-field.
    if (!run || run.titleOrigin === 'user' || run.titleOrigin === 'marker') return result.branch;
    ctx.store.updateRun(runId, {
      titleSummary: result.titleSummary,
      titleOrigin: 'auto',
      ...(result.prNumber !== undefined && run.markerRefs?.pr === undefined
        ? { prNumber: result.prNumber }
        : {}),
      ...(result.issueNumber !== undefined && run.markerRefs?.issue === undefined
        ? { issueNumber: result.issueNumber }
        : {}),
    });
    return result.branch;
  } catch {
    // Naming is best-effort — nothing here may disturb the run.
    return undefined;
  }
}

/**
 * The branch a fresh fork should use (spec 2026-10-11-branch-naming-instructions): the
 * namer's answer, made unique against existing branches, awaited for at most
 * `BRANCH_NAME_WAIT_MS` and only when instructions are set — the zero-config fork stays
 * instant. Undefined means `onni/<id8>`; a late answer is dropped, never applied as a rename.
 */
export async function awaitGeneratedBranch(
  ctx: AgentStepContext,
  runId: string,
  branchNaming: string | undefined,
  note: (message: string) => void,
): Promise<string | undefined> {
  const pending = ctx.pendingBranchNames.get(runId);
  ctx.pendingBranchNames.delete(runId);
  if (!pending || !branchNaming) return undefined;
  const TIMED_OUT = Symbol('timed out');
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ctx.branchNameWaitMs);
  });
  const wanted = await Promise.race([pending, timeout]).finally(() => clearTimeout(timer));
  if (wanted === TIMED_OUT) {
    note('branch name not ready in time — using the default onni/ branch');
    return undefined;
  }
  if (!wanted) {
    note('the namer answered no branch name — using the default onni/ branch');
    return undefined;
  }
  const unique = await uniqueBranchName(ctx.repoRoot, wanted, runId);
  if (!unique) {
    note(`generated branch name "${wanted}" is not usable — using the default onni/ branch`);
    return undefined;
  }
  return unique;
}
