import { appendHandoffHeartbeat } from '../../handoff.ts';
import { autosaveCommit } from '../../git-worktree.ts';
import { inFlightChildren } from '../../dispatch/engine.ts';
import { currentCheckExclusions } from './check-steps.ts';
import { isUnattended } from '../unattended.ts';
import { DEFAULT_IDLE_TIMEOUT_MINUTES } from '../../workspace/config.ts';
import type { AskRequest } from '../../core/ask.ts';
import type { MonitoringActiveRun, MonitoringContext, DispatchTurnResult } from './internal-types.ts';

/** Fallback monitoring window when the waiting-session idle timeout is disabled. */
export const MONITORING_LIVENESS_MS = 4 * DEFAULT_IDLE_TIMEOUT_MINUTES * 60_000;
/** Periodic "onni autosave" commit in the task worktree (spec 006). */
export const AUTOSAVE_INTERVAL_MS = 90_000;

/** The periodic autosave timer is opt-in (#471): off, a task branch carries only the
 *  agent's own commits plus the turn-end/pre-PR flushes — no mid-run "onni autosave"
 *  noise interleaving PR history. The flushes (`autosaveCommit` at turn end and before
 *  a draft PR) are NOT gated: the branch must still end holding the finished state. */
export function periodicAutosaveEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ONNI_AUTOSAVE === '1';
}

/** Safety cap on autonomous auto-continues per run — stops a stuck agent from nudging forever.
 *  Exported so the tests assert against the real cap instead of restating `40`. */
export const MAX_AUTO_CONTINUES = 40;
/**
 * How many CONSECUTIVE compaction-ended turns onni continues before it parks the run for the
 * user (#955). The anti-spin bound: a session that compacts, is continued, and compacts again
 * with nothing in between is not making progress, and the alternative to a bound is a run that
 * burns its budget in a loop. Reset to zero by any turn that ends for another reason — that is
 * the evidence the session recovered — and by a user message, which buys a fresh budget.
 */
export const MAX_COMPACTION_CONTINUES = 3;
/**
 * The follow-up onni sends when a turn ended on nothing but the backend compacting its own
 * context (#955). Not a user message: it never enters the transcript as one, and it is written
 * to be read by an agent that has just lost its working memory — so it points at the durable
 * state (the handoff file, the notes) rather than restating a task it can no longer see.
 *
 * Unlike `AUTONOMOUS_NUDGE` this is NOT exported for `scripts/mock-claude.mjs`: only a runner
 * that can report a compaction boundary ever provokes it, and the dry-run claude mock is not
 * one, so a `mock:` arm keyed on this text would be dead code.
 */
const COMPACTION_CONTINUE_NUDGE =
  'Your context was automatically compacted, which ended your turn before the work was finished. Nothing is being asked of you. Re-read your handoff file and notes for where you got to, then carry on — and end the turn with ONNI:DONE, ONNI:ASK or ONNI:MONITORING when you genuinely need to stop.';
/** The turn-end nudge text for `#autonomous`. Exported because `scripts/mock-claude.mjs`
 *  RECOGNISES this string to answer a nudge with `ONNI:DONE` (it matches the opening words, since
 *  the nudge carries no `mock:` marker of its own). Rewording it without updating that mock does
 *  not fail loudly at the seam — the nudge still fires and the mock simply never finishes, so the
 *  autonomous tests time out with an unhelpful "condition not met in time". `autonomous-nudge.test.ts`
 *  pins the coupling so the drift is caught here rather than there. */
export const AUTONOMOUS_NUDGE =
  'Continue working autonomously until the task is fully complete. Do not ask me for confirmation or clarification — make reasonable assumptions and proceed. When everything is done, end the session with your done signal.';
const MONITORING_WAKE_NUDGE =
  'Re-check the downstream work you were monitoring. Continue toward the task goal; emit ONNI:MONITORING again only if it is still pending.';

/**
 * Autonomous mode (#autonomous): a turn ended with the session still open. Instead of handing
 * the ball back to the user, nudge the agent to keep going. Returns `true` when the nudge was
 * actually sent — the caller must then NOT park the run (no `waiting` status, no idle timer,
 * the `maxParallel` slot stays held), because the session is working again.
 *
 * ONE helper for BOTH turn-end handlers — `runAgentStep` (the run's first session) and
 * `runContinuation` (a resumed one). They are near-identical by construction, and a lifecycle
 * change applied to only one of them ships half a fix (#811; AGENTS.md § "Changing a mechanism
 * that already works"). The nudge lived in `runContinuation` alone and was unreachable there
 * too, because that site's `ActiveRun` never carried `autonomous`.
 *
 * Every exit of a nudged run — the loop is bounded, it is not a new dead end:
 *  - the NEXT turn-end: `ONNI:DONE` closes the session and the run settles (`done`, or `review`
 *    for a non-autonomous run with changes); a plain turn nudges again; `ONNI:ASK` and
 *    `ONNI:MONITORING` are OVERRIDDEN while budget remains (the nudge deliberately wins over
 *    both) and take effect on the first turn after the cap;
 *  - the cap: at `MAX_AUTO_CONTINUES` this returns `false` and the turn parks exactly as a
 *    non-autonomous one does today — `waiting` (or `monitoring`), idle timer armed, slot freed;
 *  - `cancel` (`state.cancelled`) and the memory-limit pause (which clears `state.autonomous`,
 *    see `enforceMemoryLimit`) each stop it before the next nudge;
 *  - the session ending for any reason (agent exit, crash, `finish`, idle timeout) leaves
 *    through the normal exit path — `sendMessage` on a closed session returns false, so a dead
 *    session parks rather than silently looping;
 *  - a NATIVE `ask.requested` (Claude's AskUser, Codex's `requestUserInput` bridge — #473,
 *    #565) still parks the run at `waiting` MID-turn through `handleRunnerUiEvent`, which
 *    carries no autonomous guard. That is the one exit the nudge does not currently cover:
 *    the portable `ONNI:ASK` marker is a turn-end signal this helper can outrank, a native ask
 *    is not. Named here so the gap is recorded where someone reasoning about autonomous
 *    liveness will look for it.
 */
export function tryAutonomousNudge(
  context: MonitoringContext,
  runId: string,
  state: MonitoringActiveRun,
  stepId: string,
  ask: AskRequest | null,
  dispatchTurn: DispatchTurnResult,
): boolean {
  if (!state.autonomous) return false;
  // Three dispatch exceptions (spec 2026-09-10-dispatch), each closing a hole the nudge would
  // otherwise punch through the feature's guarantees — and living HERE, in the one helper both
  // turn-end handlers call, so neither site can drift from the other:
  //  - a turn that SPAWNED is waiting on its children; nudging it would keep the commander
  //    working while holding the slot its children need;
  //  - the Guard: an autonomous dispatched run must not answer its own `ONNI:ASK` — that is the
  //    whole point of asking before something irreversible. A NON-dispatch autonomous run keeps
  //    the override below, pinned by its own test;
  //  - the budget brake (Q6 ii): a run that has spent its ceiling stops spending.
  if (dispatchTurn.dispatched || dispatchTurn.overBudget) return false;
  if (dispatchTurn.hasDispatch && ask) return false;
  if ((state.autoContinues ?? 0) >= MAX_AUTO_CONTINUES) return false;
  if (state.cancelled) return false;
  // A question repeated verbatim after a nudge is not a preference the agent can settle on
  // its own — it is a blocker (the cockpit refused `onni task create`, a login is missing) that
  // the nudge would merely make it work around, at full cost, until the cap. Park the run on
  // the question instead, so the operator sees it now rather than after 40 more turns.
  const askKey = ask ? ask.questions.map((question) => question.question).join(' | ') : undefined;
  if (askKey !== undefined && askKey === state.lastOverriddenAsk) {
    context.store.appendEvent(runId, {
      type: 'note',
      stepId,
      message: `autonomous — the same question was asked again after a nudge, so the run parks on it instead of continuing: ${askKey}`,
    });
    return false;
  }
  if (!state.session?.sendMessage([{ type: 'text', text: AUTONOMOUS_NUDGE }])) return false;
  state.autoContinues = (state.autoContinues ?? 0) + 1;
  context.store.appendEvent(runId, {
    type: 'note',
    stepId,
    message: `autonomous — continuing without pausing (${state.autoContinues}/${MAX_AUTO_CONTINUES})`,
  });
  // The nudge deliberately outranks a valid `ONNI:ASK` while budget remains — but
  // `stripAskMarker` has already removed the question from the turn's visible text, and
  // `resolveAskTurn` only produces notes for a MALFORMED marker. Without this the question
  // an agent actually asked leaves no trace anywhere in the transcript, so whoever opens the
  // run after it parks at the cap cannot see that one was ever asked.
  if (ask) {
    state.lastOverriddenAsk = askKey;
    context.store.appendEvent(runId, {
      type: 'note',
      stepId,
      message: `autonomous — question overridden by the auto-continue nudge: ${askKey}`,
    });
  }
  return true;
}

/**
 * A turn ended on nothing but the backend compacting its own context (#955). Keep the run
 * WORKING and continue once on the same thread, instead of parking it under "Needs you".
 *
 * Compaction is internal session maintenance. It is not the agent saying anything, so it is
 * not evidence that the user owns the next action — but by the time `turn/completed` reaches
 * here it looks exactly like a turn that DID hand over, which is why a long Codex task that
 * crossed its context window was parked mid-work with nobody to answer it.
 *
 * The precedence this sits UNDER, and why each one wins (`BACKWARD_COMPATIBILITY.md` §8 —
 * an emitted marker means what it meant when the session started):
 *  - `ONNI:DONE` — already returned before this is reached, at both sites;
 *  - `ONNI:ASK` — the agent has a question on the user's screen; continuing would answer it
 *    for them;
 *  - `ONNI:MONITORING` — the agent said it is still working on its OWN downstream work, which
 *    is a park it chose, not one compaction imposed;
 *  - a turn that DISPATCHED — it waits on its children and owes them its slot;
 *  - the budget brake, cancellation, a closed session;
 *  - the autonomous nudge, which the callers try first: an autonomous run continues anyway,
 *    and two nudges for one turn would be two messages into one session.
 * Everything left is a MARKERLESS turn — the ordinary case #955 describes — and an ordinary
 * markerless turn with no compaction boundary is untouched: it still parks at `waiting`.
 *
 * ONE helper for BOTH turn-end handlers, for the reason AGENTS.md gives: they are
 * hand-duplicated, and a lifecycle change applied to one of them ships half a fix — here
 * that would mean a fresh run recovering while every Continue and every restart recovery
 * kept the bug.
 *
 * The exits, so this is not another state with no way out: the continued turn either
 * finishes (`ONNI:DONE`), parks (any marker, or a markerless boundary-free turn), fails, or
 * compacts again — and `MAX_COMPACTION_CONTINUES` consecutive compactions park the run with
 * a note. `sendMessage` answering false (a session that closed under us) parks it too.
 */
export function tryCompactionContinue(
  context: MonitoringContext,
  runId: string,
  state: MonitoringActiveRun,
  stepId: string,
  opts: { markerless: boolean; dispatchTurn: DispatchTurnResult },
): boolean {
  if (!opts.markerless) return false;
  if (opts.dispatchTurn.dispatched || opts.dispatchTurn.overBudget) return false;
  if (state.cancelled || !state.session?.open) return false;
  const attempts = state.compactionContinues ?? 0;
  if (attempts >= MAX_COMPACTION_CONTINUES) {
    // Once, on the turn the bound is reached — the run parks on every later boundary too,
    // and repeating the note each time would bury the transcript it is meant to explain.
    if (attempts === MAX_COMPACTION_CONTINUES) {
      state.compactionContinues = attempts + 1;
      context.store.appendEvent(runId, {
        type: 'note',
        stepId,
        tone: 'danger',
        message: `context compaction ended ${MAX_COMPACTION_CONTINUES} turns in a row with no progress in between — the run parks for you instead of continuing again`,
      });
    }
    return false;
  }
  if (!state.session.sendMessage([{ type: 'text', text: COMPACTION_CONTINUE_NUDGE }])) return false;
  state.compactionContinues = attempts + 1;
  context.store.appendEvent(runId, {
    type: 'note',
    stepId,
    message: `context was compacted mid-task — continuing on the same thread (${state.compactionContinues}/${MAX_COMPACTION_CONTINUES})`,
  });
  return true;
}

export function armIdleTimer(
  context: MonitoringContext,
  runId: string, state: MonitoringActiveRun): void {
  clearIdleTimer(context, state);
  // An unattended run never waits forever: the structural expiry replaces the (disable-able)
  // idle timeout, whatever the user set there.
  const unattended = isUnattended(context.store.getRun(runId));
  const timeoutMinutes = unattended ? context.semaphore.safety().waitExpiryMinutes : context.semaphore.idleTimeoutMinutes();
  if (timeoutMinutes === null || timeoutMinutes === 0) return;
  const timeoutMs = timeoutMinutes * 60_000;
  state.idleTimer = setTimeout(() => {
    if (state.session?.open && !state.cancelled) {
      state.idleClosed = true;
      if (unattended) state.waitExpired = true;
      context.store.appendEvent(runId, {
        type: 'lifecycle',
        message: unattended
          ? `no answer after ${Math.round((timeoutMs / 60_000) * 10) / 10}m — the unattended run is ending; its worktree and session are kept`
          : `session closed after ${Math.round(timeoutMs / 60_000)}m of inactivity`,
      });
      state.session.end();
    }
  }, timeoutMs);
  state.idleTimer.unref?.();
}

export function clearIdleTimer(
  context: MonitoringContext,
  state: MonitoringActiveRun): void {
  if (state.idleTimer) {
    clearTimeout(state.idleTimer);
    state.idleTimer = undefined;
  }
}

export function reconcileMonitoringWakeTimers(
  context: MonitoringContext): void {
  for (const runId of context.monitoring) {
    const state = context.active.get(runId);
    if (state) armMonitoringWakeTimer(context, runId, state);
  }
}

export function armMonitoringWakeTimer(
  context: MonitoringContext,
  runId: string, state: MonitoringActiveRun): void {
  const minutes = context.semaphore.monitoringWakeIntervalMinutes();
  if (minutes === null) {
    clearMonitoringWakeTimer(context, state, runId);
    // Reconcile can be reached on any pump, so arm only a park that has none — a pump must not
    // push the liveness deadline out from under an already-bounded park.
    if (!state.monitoringLivenessTimer) armMonitoringLivenessTimer(context, runId, state);
    return;
  }
  if ((state.monitoringWakeups ?? 0) >= MAX_AUTO_CONTINUES) {
    clearMonitoringWakeTimer(context, state, runId);
    monitoringWakeCapReached(context, runId, state);
    return;
  }
  // Below the cap an interval IS the exit, so a configured run must not also carry the liveness
  // bound; see `armMonitoringLivenessTimer` for why the two cannot coexist.
  clearMonitoringLivenessTimer(context, state);
  if (state.monitoringWakeTimer && state.monitoringWakeIntervalMinutes === minutes) return;
  clearMonitoringWakeTimer(context, state, runId);
  state.monitoringWakeIntervalMinutes = minutes;
  context.store.updateRun(runId, { monitoringWakeCapReached: undefined });
  const deadline = Date.now() + minutes * 60_000;
  context.store.updateRun(runId, { monitoringWakeAt: new Date(deadline).toISOString() });
  state.monitoringWakeTimer = setTimeout(() => {
    state.monitoringWakeTimer = undefined;
    context.store.updateRun(runId, { monitoringWakeAt: undefined });
    if (!context.monitoring.has(runId) || !state.session?.open || state.cancelled) return;
    // A dispatched child's settle report wakes this run on its own; a blind re-check while
    // one is still in flight is a model turn that can only re-park.
    if (hasInFlightChildren(context, runId)) {
      armMonitoringWakeTimer(context, runId, state);
      // The child's report is what wakes this run; the re-armed timer is a fallback, so the
      // cockpit must not promise a scheduled check that a report will pre-empt.
      context.store.updateRun(runId, { monitoringWakeAt: undefined });
      return;
    }
    const wakeups = state.monitoringWakeups ?? 0;
    if (wakeups >= MAX_AUTO_CONTINUES) {
      monitoringWakeCapReached(context, runId, state);
      return;
    }
    state.monitoringWakeups = wakeups + 1;
    context.store.appendEvent(runId, {
      type: 'note',
      message: `automatic monitoring wake-up (${state.monitoringWakeups}/${MAX_AUTO_CONTINUES})`,
    });
    context.deliverMessage(runId, [{ type: 'text', text: MONITORING_WAKE_NUDGE }], false);
  }, Math.max(0, deadline - Date.now()));
  state.monitoringWakeTimer.unref?.();
}

export function clearMonitoringWakeTimer(
  context: MonitoringContext,
  state: MonitoringActiveRun, runId?: string): void {
  if (state.monitoringWakeTimer) clearTimeout(state.monitoringWakeTimer);
  state.monitoringWakeTimer = undefined;
  state.monitoringWakeIntervalMinutes = undefined;
  if (runId) context.store.updateRun(runId, { monitoringWakeAt: undefined });
}

/**
 * The wake-up cap is a lifetime budget: only a user message (`sendMessage`) refills it. At the
 * cap a run with a dispatched child still in flight stays parked for that child's report;
 * any other run is handed to the user. That stay must still be bounded: a child that settles
 * without delivering (cancelled from the queue) would otherwise leave the run with no timer.
 */
export function monitoringWakeCapReached(
  context: MonitoringContext,
  runId: string, state: MonitoringActiveRun): void {
  const awaitsChildren = hasInFlightChildren(context, runId);
  if (!context.store.getRun(runId)?.monitoringWakeCapReached) {
    context.store.updateRun(runId, { monitoringWakeCapReached: true });
    if (awaitsChildren) {
      context.store.appendEvent(runId, {
        type: 'note',
        message: `automatic monitoring wake-up cap reached (${MAX_AUTO_CONTINUES}); session remains parked for its dispatched tasks' reports`,
      });
    }
  }
  if (!awaitsChildren) {
    context.parkMonitorAsWaiting(
      runId,
      state,
      `automatic monitoring wake-up cap reached (${MAX_AUTO_CONTINUES}); parked for your reply`,
    );
    return;
  }
  // The cap spends the interval's exit, so the liveness bound returns as the last-resort
  // hand-off. Arm only when none is set, so a routine pump cannot push the deadline out.
  if (!state.monitoringLivenessTimer) armMonitoringLivenessTimer(context, runId, state, true);
}

export function armMonitoringLivenessTimer(
  context: MonitoringContext,
  runId: string, state: MonitoringActiveRun, atCap = false): void {
  clearMonitoringLivenessTimer(context, state);
  state.monitoringLivenessAtCap = atCap;
  // With a wake interval configured, a wake-up turn re-parks and resets this timer, so at the
  // interval's maximum (60m) the two would fire together and the liveness hand-off would win —
  // disabling the configured re-checks. Liveness therefore bounds only a park-mode (null) run;
  // at the wake-up cap (`atCap`) those re-checks no longer fire, so it is an exit again.
  if (!atCap && context.semaphore.monitoringWakeIntervalMinutes() !== null) return;
  const timeoutMinutes = context.semaphore.idleTimeoutMinutes();
  const timeoutMs = timeoutMinutes === null || timeoutMinutes === 0
    ? MONITORING_LIVENESS_MS
    : 4 * timeoutMinutes * 60_000;
  state.monitoringLivenessTimer = setTimeout(() => {
    state.monitoringLivenessTimer = undefined;
    if (!context.monitoring.has(runId) || !state.session?.open || state.cancelled) return;
    if (hasInFlightChildren(context, runId)) {
      // A child still in flight outlives this window; carry the cap override into the re-arm, or
      // the interval guard above would leave the run with no timer at all.
      armMonitoringLivenessTimer(context, runId, state, state.monitoringLivenessAtCap === true);
      return;
    }
    context.parkMonitorAsWaiting(
      runId,
      state,
      `monitoring with no activity for ${Math.round(timeoutMs / 60_000)}m; parked for your reply`,
    );
  }, timeoutMs);
  state.monitoringLivenessTimer.unref?.();
}

export function clearMonitoringLivenessTimer(
  context: MonitoringContext,
  state: MonitoringActiveRun): void {
  if (state.monitoringLivenessTimer) clearTimeout(state.monitoringLivenessTimer);
  state.monitoringLivenessTimer = undefined;
  state.monitoringLivenessAtCap = undefined;
}

function hasInFlightChildren(
  context: MonitoringContext,
  runId: string): boolean {
  return inFlightChildren(context.store.listRuns(), runId).length > 0;
}

/**
 * Turn a monitoring park into a `waiting` park: attention raised, idle timer armed if enabled,
 * session left open so a reply still lands in it. Parked like a `ONNI:ASK` (`askPark`), so a
 * hand-off nobody answers settles `failed` with Continue when the idle timer closes it.
 */
export function parkMonitorAsWaiting(
  context: MonitoringContext,
  runId: string, state: MonitoringActiveRun, message: string): void {
  if (!context.monitoring.has(runId) || !state.session?.open || state.cancelled) return;
  context.leaveMonitoring(runId);
  clearMonitoringWakeTimer(context, state, runId);
  state.askPark = 'waiting';
  state.monitorHandoff = true;
  context.store.updateRun(runId, { status: 'waiting', activity: undefined, askParked: true });
  if (state.currentStepId) context.store.updateStep(runId, state.currentStepId, { status: 'waiting' });
  context.store.appendEvent(runId, { type: 'note', message });
  // Deferred past a turn-end handler that re-parked straight into the cap, so this line follows
  // its `turn complete — status=monitoring` heartbeat instead of preceding it.
  queueMicrotask(() => appendHandoffHeartbeat(context.dataDir, runId, 'monitoring ended — status=waiting'));
  context.armIdleTimer(runId, state);
  context.releaseSlot();
}

/** Autosave-commit the worktree every 90 s while the run lives (spec 006).
 *  Opt-in via ONNI_AUTOSAVE=1 (#471) — see periodicAutosaveEnabled. */
export function armAutosave(
  context: MonitoringContext,
  runId: string, state: MonitoringActiveRun): void {
  if (!periodicAutosaveEnabled()) return;
  if (state.cwd === context.repoRoot || state.autosaveTimer) return;
  state.autosaveTimer = setInterval(() => {
    if (context.active.get(runId) !== state || state.cancelled || state.checkInProgress || state.autosaveCheckpointBlocked) return;
    void currentCheckExclusions(state.cwd, state.autosaveExcludedPaths).then((excluded) => {
      if (
        context.active.get(runId) !== state ||
        state.cancelled ||
        state.checkInProgress ||
        state.autosaveCheckpointBlocked
      ) {
        return 'nothing-to-do' as const;
      }
      return autosaveCommit(state.cwd, 'periodic', excluded);
    });
  }, AUTOSAVE_INTERVAL_MS);
  state.autosaveTimer.unref?.();
}

export function clearAutosaveTimer(
  context: MonitoringContext,
  state: MonitoringActiveRun): void {
  if (state.autosaveTimer) {
    clearInterval(state.autosaveTimer);
    state.autosaveTimer = undefined;
  }
}
