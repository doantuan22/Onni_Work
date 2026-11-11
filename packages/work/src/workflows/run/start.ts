import { randomUUID } from 'node:crypto';
import { access, realpath } from 'node:fs/promises';
import { type AgentPermissionLevel, type UsageWindowsObservation } from '@onni/contract';
import { discoverTaskTestCommands, effectiveAntigravityLevel } from '../../core/antigravity-permissions.ts';
import { probeCodexIdentity } from '../../core/codex-usage-probe.ts';
import type { AgentEvent, RunnerId } from '../../core/agent-runner.ts';
import { loadPrivateMcp, PRIVATE_MCP_FILE, skippedServersNote, supportsPrivateMcp, type PrivateMcpServer } from '../../core/private-mcp.ts';
import type { ProcessUsage } from '../../core/process-usage.ts';
import { agentModelsLocked } from '../../core/agent-model-policy.ts';
import { saveUsageWindows } from '../../workspace/usage-windows.ts';
import { resolveProfileEnvForRoot } from '../../workspace/agent-profiles.ts';
import { DEFAULT_AGENT_ACCOUNT_ID } from '../../workspace/agent-accounts.ts';
import { loadWorkspaceConfig } from '../../workspace/config.ts';
import { todosPath } from '../../todos.ts';
import { followupsEnabled, handoffPath } from '../../handoff.ts';
import { agentTmpEnv } from '../../runs/agent-tmpdir.ts';
import { extractTaskRefs, refineTaskRefs, titleRefNumber } from '../../runs/task-refs.ts';
import { pushGuardEnv } from '../push-guard.ts';
import { treeDir } from '../../dispatch/tree-fs.ts';
import { resolveLimits } from '../limits.ts';
import { isUnattended } from '../unattended.ts';
import { graphRailSteps } from '../graph.ts';
import { stepKind, type WorkflowDef } from '../types.ts';
import { VARIANT_HINTS, VARIANT_LETTERS } from './preparation.ts';
import type { StartContext } from './internal-types.ts';
import type { RunRecord } from '../../runs/store.ts';
import type { StartRunInput } from '../run.ts';

/**
 * Pause any active run whose whole process tree exceeds the WORKSPACE
 * `resources.memoryLimitMb`, freeing its slot so the queue advances
 * (#memory-guard). "Pause" closes the session — freeing the tree's
 * memory — and leaves the run resumable via Continue; a loud warning explains why. No-op when
 * no limit is set or the sampler has no data (e.g. `ps`/PowerShell unavailable).
 */
export async function enforceMemoryLimit(ctx: StartContext, snapshot: Record<string, ProcessUsage>): Promise<void> {
  // The sampler is module-global (one `ps` for the whole process), so with
  // multiple projects a snapshot carries EVERY project's runs. Act only on
  // rows this manager owns (multi-project spec, step 2.4).
  const runIds = Object.keys(snapshot).filter((runId) => ctx.active.has(runId));
  if (runIds.length === 0) return;
  // Workspace limit from the shared semaphore's in-memory cache (step 2.5:
  // refreshed at boot and on PUT /api/workspace/config — never N per-tick
  // file reads across N projects). Legacy per-repo `memoryLimitMb` keys are
  // ignored post-migration.
  const limitMb = ctx.semaphore.memoryLimitMb();
  if (!limitMb || limitMb <= 0) return;
  const limitBytes = limitMb * 1024 * 1024;
  for (const runId of runIds) {
    const usage = snapshot[runId];
    if (!usage || usage.rssBytes <= limitBytes) continue;
    if (ctx.memoryPausing.has(runId)) continue;
    const state = ctx.active.get(runId);
    if (!state?.session?.open || state.cancelled) continue;
    ctx.memoryPausing.add(runId);
    const usedMb = Math.round(usage.rssBytes / (1024 * 1024));
    ctx.store.appendEvent(runId, {
      type: 'note',
      message: `⚠ memory limit exceeded — this task's process tree is using ${usedMb} MiB (limit ${limitMb} MiB). Pausing it and letting the next queued task run; resume it with Continue.`,
    });
    ctx.store.appendEvent(runId, {
      type: 'lifecycle',
      message: `paused — memory limit exceeded (${usedMb} MiB > ${limitMb} MiB)`,
    });
    // Closing the session frees the tree and lets the normal exit path settle the run and
    // pump the queue. Suppress autonomous auto-continue so the pause actually holds.
    state.autonomous = false;
    ctx.clearIdleTimer(runId);
    state.session.end();
  }
}

/** Env the spawned claude gets so the agent can find its handoff file and
 *  the global inbox (spec 007; the inbox only when the run opted in).
 *
 *  `ONNI_TODOS_FILE` is set to `''` rather than omitted when follow-ups are
 *  off: runners spawn with `{ ...process.env, ...spec.env }`, so omitting the
 *  key would let a value inherited from *this* process through — a nested
 *  onni (an agent running `onni serve`/`onni run`/the test suite) would then
 *  write follow-ups into the parent's inbox despite the opt-out. Empty is the
 *  established "absent" spelling — consumers guard with `if (todosFile)`.
 *
 *  `TMPDIR`/`TEMP`/`TMP` (#785) point at this run's own scratch directory
 *  instead of the machine-wide one every agent used to share. Created and
 *  write-probed here, on the last common path before a spawn, so an unusable
 *  temp directory throws `AgentTempDirError` at the caller rather than
 *  turning into empty command output inside a running agent. */
export function agentEnv(ctx: StartContext, runId: string, generateFollowups = true): Record<string, string> {
  const dispatch = ctx.dispatchOf(runId);
  // The same ONE gate the dispatch prompt uses, so an agent is never told about a CLI whose
  // address it was not given (and never given an address it was not told about).
  const apiUrl = ctx.dispatchReachable() ? process.env.ONNI_API_URL : undefined;
  return {
    ONNI_HANDOFF_FILE: handoffPath(ctx.dataDir, runId),
    ONNI_TASK_ID: runId,
    ONNI_TODOS_FILE: generateFollowups ? todosPath(ctx.dataDir) : '',
    ...agentTmpEnv(ctx.dataDir, runId),
    // Task dispatch (spec 2026-09-10-dispatch): where the `onni task` CLI reaches this server and
    // which project the run belongs to. Absent (not empty) while the feature is off, so the env
    // is byte-for-byte as before.
    ...(apiUrl ? { ONNI_API_URL: apiUrl } : {}),
    ...(apiUrl && ctx.projectId ? { ONNI_PROJECT_ID: ctx.projectId } : {}),
    // The cockpit's OWN entrypoint, so an agent runs `node "$ONNI_BIN" task …` and never an older
    // `onni` that happens to be on its PATH without the command (observed on the first live run).
    ...(apiUrl && process.env.ONNI_BIN ? { ONNI_BIN: process.env.ONNI_BIN } : {}),
    // The tree directory — brief, notes, inbox — for a run in a dispatch tree only.
    ...(dispatch ? { ONNI_TREE_DIR: treeDir(ctx.dataDir, dispatch.rootRunId) } : {}),
    // A fence for unattended agents' own `git push` (see push-guard.ts) — never for a person's run.
    ...(isUnattended(ctx.store.getRun(runId)) ? pushGuardEnv(ctx.dataDir, ctx.store.getRun(runId) ?? {}) : {}),
  };
}

/**
 * The project's private MCP servers for one agent session (spec
 * 2026-10-07-private-project-mcp), with a note naming what was attached — or why not. Read
 * fresh per launch, like `agentEnvForStep`, so an edit applies to the very next session.
 * Never throws: an unreadable or broken file means a run without them, plus a note.
 */
/**
 * Antigravity's permission level for this run (ADR 0007): the Settings choice, with `bypass`
 * lowered for an unattended run — autonomous or dispatched, which includes every manager–worker
 * child — unless the owner opted in with `ONNI_ANTIGRAVITY_UNATTENDED_BYPASS=1`. Other backends
 * have no level and get nothing. The helper's downgrade reason is also the run note.
 */
export async function agentPermissionSpec(ctx: StartContext,
  runId: string,
  backend: string,
  onEvent: (event: AgentEvent) => void,
  bashAllowlist?: readonly string[],
): Promise<{ permissionLevel?: AgentPermissionLevel; bashAllowlist?: string[] }> {
  if (backend !== 'antigravity') return {};
  const config = await loadWorkspaceConfig().catch(() => null);
  const run = ctx.store.getRun(runId);
  const savedLevel = config?.agentPermissions.antigravity;
  const dispatchedChild = Boolean(run?.dispatch?.parentRunId);
  // effectiveAntigravityLevel treats stored files-only as unchosen only for dispatched children.
  const { level, downgradedBecause } = effectiveAntigravityLevel(
    savedLevel,
    isUnattended(run),
    dispatchedChild,
  );
  if (downgradedBecause) onEvent({ type: 'note', message: `antigravity: ${downgradedBecause}` });
  if (dispatchedChild && level === 'allow-rules') {
    const taskCommands = discoverTaskTestCommands(run?.worktreePath ?? ctx.repoRoot, run?.task ?? '');
    const commands = [...new Set([...(bashAllowlist ?? []), ...taskCommands])];
    return { permissionLevel: level, ...(commands.length ? { bashAllowlist: commands } : {}) };
  }
  return { permissionLevel: level };
}

/** The notes a backend marks for the run record: the CLI version, and what it refused (digest). */
export function recordNoteMeta(ctx: StartContext, runId: string, event: Extract<AgentEvent, { type: 'note' }>): void {
  if (event.kind === 'agent-version' && event.value) {
    ctx.store.updateRun(runId, { agentVersion: event.value });
  } else if (event.kind === 'denied-action') {
    const denied = [...(ctx.store.getRun(runId)?.deniedActions ?? []), event.message];
    ctx.store.updateRun(runId, { deniedActions: denied.slice(-50) });
  }
}

/**
 * The project's private MCP servers for one agent session (spec
 * 2026-10-07-private-project-mcp), with a note naming what was attached ? or why not. Read
 * fresh per launch, like `agentEnvForStep`, so an edit applies to the very next session.
 * Never throws: an unreadable or broken file means a run without them, plus a note.
 */

export async function privateMcpForLaunch(ctx: StartContext,
  backend: RunnerId,
  onEvent: (event: AgentEvent) => void,
): Promise<PrivateMcpServer[] | undefined> {
  const { servers, problems } = await loadPrivateMcp(ctx.repoRoot);
  for (const problem of problems) onEvent({ type: 'note', message: `private MCP: ${problem}` });
  if (servers.length === 0) return undefined;
  const names = servers.map((s) => s.name);
  if (!supportsPrivateMcp(backend)) {
    onEvent({ type: 'note', message: skippedServersNote(backend, names, `${backend} has no launch-time MCP channel`) });
    return undefined;
  }
  onEvent({ type: 'note', message: `private MCP servers from .ai/onni/${PRIVATE_MCP_FILE}: ${names.join(', ')}` });
  return servers;
}

/**
 * `agentEnv` plus the agent-account variable for the profile this STEP runs under (spec
 * 2026-07-29-agent-profiles), and the id it resolved to so the caller can record it.
 *
 * Resolved per step, not per run, because a workflow can mix backends: an override naming a
 * Claude account says nothing about which Codex account a codex step should use. Resolution
 * order, most specific first:
 *
 *   1. the step's ALREADY-RECORDED `profileId` — a resume or Continue must reattach to the
 *      account that created the session, whatever the project has since been switched to;
 *   2. the run's composer override, but only for steps on the run's own runner;
 *   3. the project's stored selection, and failing that the discovered default.
 *
 * Read fresh every time. `~/.onni/config.json` is shared by every onni process on this
 * machine, so a cached snapshot is a staleness bug, and one small JSON read is free next to
 * spawning a CLI. Never throws: an unreadable home degrades to the default profile, which is
 * exactly the behaviour that predates profiles.
 */
export async function agentEnvForStep(ctx: StartContext,
  runId: string,
  backend: RunnerId,
  options: { generateFollowups?: boolean; recordedProfileId?: string } = {},
): Promise<{ env: Record<string, string>; profileId: string; onUsageWindows?: (observation: UsageWindowsObservation) => void }> {
  const run = ctx.store.getRun(runId);
  const profileId = options.recordedProfileId
    ?? (backend === (run?.runner ?? 'claude') ? run?.agentProfile : undefined);
  const resolved = await resolveProfileEnvForRoot(ctx.repoRoot, backend, profileId);
  const bound = run?.deferredBinding?.accounts.find(a => a.runner === backend);
  if (run && ctx.deferredBindingActive(run, ctx.store.listRuns())) {
    const nativePi = backend === 'pi';
    if (!bound || bound.id !== resolved.profile.id
      || (nativePi ? bound.id !== DEFAULT_AGENT_ACCOUNT_ID || bound.path !== ''
        : bound.path !== await realpath(resolved.profile.path))) {
      throw new Error('Scheduled account binding changed; refusing to use another account.');
    }
    // Pi has no per-provider profile: its discovery-only Claude path is not a login.
    if (!nativePi) await access(bound.path);
    if (bound.identity && backend === 'codex') {
      const live = await probeCodexIdentity(resolved.profile);
      if ('unavailable' in live) throw new Error('Could not read the scheduled Codex account right now (timed out or busy). Retry the task.');
      if (live.identity !== bound.identity) throw new Error('The scheduled Codex identity changed or cannot be verified.');
    }
  }
  // Codex attribution needs an app-server probe, so only scheduled runs (whose bound
  // identity it can be checked against) pay for one; ordinary Codex runs spawn nothing (#1340).
  const profilePath = await realpath(resolved.profile.path).catch(() => resolved.profile.path);
  const boundIdentity = backend === 'codex' && bound?.id === resolved.profile.id && bound.path === profilePath ? bound.identity : undefined;
  let attributionDisabled = false;
  const association = run?.automationTracker?.association;
  const trackerEnv = association && ctx.resolveTrackerEnv && process.env.ONNI_DRY_RUN !== '1'
    ? await ctx.resolveTrackerEnv(ctx.repoRoot, association)
    : {};
  const secrets = [trackerEnv.JIRA_API_TOKEN, trackerEnv.LINEAR_API_KEY].filter((value): value is string => Boolean(value));
  if (trackerEnv.JIRA_EMAIL && trackerEnv.JIRA_API_TOKEN) {
    secrets.push(Buffer.from(`${trackerEnv.JIRA_EMAIL}:${trackerEnv.JIRA_API_TOKEN}`).toString('base64'));
  }
  ctx.store.registerRunSecrets(runId, secrets);
  const usageProvider = backend === 'claude' ? 'claude' : boundIdentity ? 'codex' : undefined;
  const onUsageWindows = usageProvider ? async (observation: UsageWindowsObservation) => {
    try {
      if (usageProvider === 'codex') {
        if (attributionDisabled) return;
        // A login can change during a long-running session. Once verification
        // fails, this stream cannot safely identify any later observation. The probe's
        // short cache bounds this to one app-server per window, however chatty the stream.
        const current = await probeCodexIdentity(resolved.profile, { force: false });
        if (attributionDisabled || 'unavailable' in current) return;
        if (current.identity !== boundIdentity) {
          attributionDisabled = true;
          return;
        }
      }
      await saveUsageWindows({ provider: usageProvider, accountId: resolved.profile.id, profilePath, ...(boundIdentity ? { identity: boundIdentity } : {}) }, observation);
    } catch {
      // Metadata must never fail the task or produce an unhandled rejection.
      attributionDisabled = true;
    }
  } : undefined;
  return {
    env: { ...agentEnv(ctx, runId, options.generateFollowups), ...trackerEnv, ...resolved.env },
    profileId: resolved.profile.id,
    ...(onUsageWindows ? { onUsageWindows } : {}),
  };
}

export function startRun(ctx: StartContext,
  workflow: WorkflowDef,
  input: StartRunInput,
  group?: { groupId: string; variant: string },
): RunRecord {
  if (input.readOnly && !group) {
    input = { ...input, worktree: false, newBranch: undefined, dispatchIntent: undefined, forkRef: undefined, roster: undefined };
  }
  // A manager runs the roster's manager backend/model and always in its own worktree: its
  // workers fork its commits, and an in-place run has no branch to fork.
  if (input.roster && (group || !ctx.dispatchEnabled())) input = { ...input, roster: undefined };
  if (input.roster) {
    input = { ...input, runner: input.roster.manager.runner, model: input.roster.manager.model, worktree: undefined, newBranch: undefined, forkRef: undefined };
  }
  // Sanitize at the manager boundary so CLI runs, workflows, variants, and
  // direct callers cannot bypass the HTTP policy.
  const effectiveInput = {
    ...(agentModelsLocked(ctx.repoRoot) ? { ...input, model: undefined } : input),
    // A root started with the composer's Dispatch toggle always gets a worktree: children fork
    // its commits, and an in-place run has no branch to fork. Overridden on the INPUT, which is
    // what `execute()` reads, not only on the record.
    ...(input.dispatchIntent && input.worktree === false ? { worktree: undefined } : {}),
    // A pull-request head is verified in its own worktree, never in the user's checkout.
    ...(input.forkRef && input.worktree === false ? { worktree: undefined } : {}),
  };
  const run = ctx.store.createRun({
    id: input.scheduledLaunch?.id,
    title: makeRunTitle(input.task, workflow, input.images?.length) + (group ? ` (${group.variant})` : ''),
    workflow: workflow.name,
    task: input.task,
    model: effectiveInput.model,
    runner: input.runner,
    // The composer's per-task account (spec 2026-07-29-agent-profiles). Persisted at creation
    // so a queued run picks it up at dequeue and every later resume reads the same answer.
    agentProfile: input.agentProfile,
    // The global inbox is the ceiling on the per-run flag (#471). Enforced here rather than
    // at the HTTP route because `onni run`, the inbox's own "▶ Run" and variants all reach
    // startRun directly — a route-level gate would leave those writing todos.json.
    generateFollowups: followupsEnabled() ? input.generateFollowups : false,
    // Persist autonomy on the record (#489) so the terminal review gate
    // (`settleSuccess`) and the group-pick winner-park can honor it — mid-run
    // auto-nudge reads `input.autonomous` (`execute`), but the record is the
    // only source those after-the-fact consumers have.
    autonomous: input.autonomous === true,
    // Persist the explicit opt-out so queued-run restart recovery and the
    // session Git routes can distinguish it from a removed isolated worktree.
    worktree: !group && !input.dispatchIntent && !input.forkRef && input.worktree === false ? false : undefined,
    groupId: group?.groupId,
    variant: group?.variant,
    steps: workflow.graph
      ? graphRailSteps(workflow.graph)
      : workflow.steps.map((s) => ({ id: s.id, name: s.name ?? s.id, kind: stepKind(s) })),
  });
  // Persist the full definition so a queued run survives a restart (#367) —
  // ad-hoc "(planned)" chains exist nowhere else to re-resolve from.
  ctx.store.updateRun(run.id, {
    workflowDef: workflow,
    // Snapshot, never re-read: a later settings change affects new runs only.
    limits: input.limitsSnapshot ?? resolveLimits(input.limits, ctx.semaphore.runLimitsDefault()),
  });
  // On the record, not only the input: restart recovery rebuilds the run from it.
  if (run.worktree === false && input.newBranch) {
    ctx.store.updateRun(run.id, { inPlaceBranch: true, ...(input.branch ? { branch: input.branch } : {}) });
  }
  if (run.worktree === false && input.readOnly) ctx.store.updateRun(run.id, { readOnly: true });
  // A pull-request head run (spec 2026-10-06-agentic-e2e-checks Phase 3): the fetched sha is
  // recorded as the fork point BEFORE the run is queued, so `execute` — and a restart that
  // revives the queued run — forks from it through the "recorded fork point wins" rule rather
  // than re-resolving the configured base. The PR becomes the run's referenced pull request.
  if (input.forkRef) {
    ctx.store.updateRun(run.id, {
      baseBranch: input.forkRef.sha,
      prHead: input.forkRef.pr,
      ...(input.forkRef.untrusted ? { untrustedHead: true } : {}),
    });
    ctx.store.recordPrRef(run.id, { number: input.forkRef.pr.number, url: input.forkRef.prUrl, origin: 'marker' });
  }
  // The run's place in a dispatch tree (spec 2026-09-10-dispatch), written the way
  // automation provenance is (`automations/task-template.ts`): an update straight after create,
  // rather than a tenth key on `createRun`'s parameter object. Persisting it here — not merely
  // holding it on the input — is what makes it survive: `execute()`, restart recovery and the
  // turn-end handlers all read the RECORD, and a tree whose root lost its `dispatch` on a
  // restart would be a tree with no root.
  if (input.dispatch) ctx.store.updateRun(run.id, { dispatch: input.dispatch });
  else if (input.dispatchIntent) ctx.store.updateRun(run.id, { dispatch: { rootRunId: run.id, intent: input.dispatchIntent } });
  if (input.roster) {
    // The roster is snapshotted here and never re-read: a worker cannot widen it, and a later
    // preset edit does not touch a tree that is already running.
    ctx.store.updateRun(run.id, { roster: input.roster, ...(input.managerFullAccess ?? ctx.semaphore.safety().managerFullAccess ? { managerFullAccess: true } : {}), dispatch: { ...(ctx.store.getRun(run.id)?.dispatch ?? { rootRunId: run.id }), rootRunId: run.id } });
  }
  // Initial pasted attachments must be visible while the run is still queued (#612),
  // and must survive a restart before a slot opens. Persist them before the job
  // enters `pendingJobs`; `hydrateQueuedInput` reconstructs their content blocks
  // from these URLs when a recovered run eventually starts — and for a file (#950)
  // this write is the ONLY copy, since it never had a block to be rebuilt from.
  if (input.images?.length) {
    const persisted = ctx.persistPastedAttachments(run.id, input.images);
    if (persisted.length) {
      ctx.store.updateRun(run.id, { taskImages: persisted.map((saved) => saved.url) });
    }
  }
  // Step-0 reference extraction (task auto-naming spec): the regex layer's
  // numbers persist immediately; the namer may add the kind it verified later.
  const skillHint = workflow.steps.find((s) => stepKind(s) === 'agent' && s.skill)?.skill?.trim();
  const refs = refineTaskRefs(extractTaskRefs(input.task), skillHint);
  if (refs.prNumber !== undefined || refs.issueNumber !== undefined) {
    ctx.store.updateRun(run.id, {
      ...(refs.prNumber !== undefined ? { prNumber: refs.prNumber } : {}),
      ...(refs.issueNumber !== undefined ? { issueNumber: refs.issueNumber } : {}),
    });
  }
  const binding = input.scheduledLaunch?.binding ?? input.deferredBinding;
  if (binding) {
    ctx.store.updateRun(run.id, {
      ...(input.scheduledLaunch ? { automationTrigger: input.scheduledLaunch.provenance } : {}),
      deferredBinding: binding,
    });
    // Children need the same durable guard before naming or queue admission, but retain
    // their own fresh id and never masquerade as the scheduler's idempotent launch.
    ctx.store.flushCreatedRun(run);
  }
  // Fire-and-forget LLM naming (task auto-naming spec): the heuristic title
  // above shows instantly; the namer's short title replaces it when (and if)
  // the model answers. Never awaited here, never fails the run. The same call
  // also answers the task branch when instructions are set; `execute` waits
  // for that part, bounded, before it forks.
  // An attachment-only task gives the namer nothing to read; the turn-end refresh names it instead
  // (under `branchNaming` its branch keeps the default `onni/<id8>`).
  ctx.pendingBranchNames.set(
    run.id,
    input.task.trim() ? ctx.autoNameRun(run.id, skillHint, input.task) : Promise.resolve(undefined),
  );
  ctx.pendingJobs.set(run.id, { workflow, input: effectiveInput });
  ctx.queue.push(run.id);
  void ctx.pump();
  return run;
}

/**
 * Parallel variants (spec 010): N runs of the same workflow on the same
 * task, sharing a groupId. Variant A gets the task verbatim; B and C get a
 * fixed one-line approach hint appended to the *task input* (not the step
 * template), so diversification works with any workflow. The normal queue
 * applies — with maxParallel=2 a third variant simply waits.
 */
export function startVariants(ctx: StartContext, workflow: WorkflowDef, input: StartRunInput, count: number): RunRecord[] {
  const groupId = randomUUID();
  const variants = Math.min(Math.max(count, 1), VARIANT_LETTERS.length);
  return VARIANT_LETTERS.slice(0, variants).map(
    (variant) => {
      const hint = VARIANT_HINTS[variant];
      const task = hint ? `${input.task}\n\n${hint}` : input.task;
      return startRun(ctx, workflow, { ...input, task, worktree: undefined }, { groupId, variant });
    },
  );
}


export function makeRunTitle(task: string, workflow: WorkflowDef, attachmentCount = 0): string {
  const firstLine = task.trim().split('\n')[0] ?? '';
  const skill = workflow.steps.find((step) => stepKind(step) === 'agent' && step.skill)?.skill?.trim();
  const contextual = skill && !firstLine.startsWith(`/${skill}`)
    ? `/${skill}${firstLine ? ` ${firstLine}` : ''}`
    : firstLine;
  const refNumber = titleRefNumber(refineTaskRefs(extractTaskRefs(task), skill));
  // `469` or `/om-auto-review-pr 469` reads as `469: /om-auto-review-pr` — the
  // number leads so it survives the tasks table's narrow truncation.
  const skillArg = skill && contextual.startsWith(`/${skill}`) ? contextual.slice(skill.length + 1).trim() : null;
  const body = refNumber !== undefined && skill && (skillArg === '' || /^#?\d+$/.test(skillArg ?? ''))
    ? `/${skill}`
    : contextual;
  const prefixed =
    refNumber !== undefined && !body.trimStart().replace(/^#/, '').startsWith(String(refNumber))
      ? `${refNumber}: ${body}`
      : body;
  // An attachment-only task has no first line; the namer replaces this once the model answers.
  const fallback = attachmentCount > 0
    ? `Task from ${attachmentCount} attachment${attachmentCount > 1 ? 's' : ''}`
    : '(untitled task)';
  const chars = [...(prefixed || fallback)];
  return chars.length > 80 ? `${chars.slice(0, 79).join('').trimEnd()}…` : chars.join('');
}
