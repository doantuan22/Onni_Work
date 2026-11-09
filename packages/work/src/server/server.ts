import { createWebhookRoutes } from './webhooks.ts';
import { WebhookCoordinator } from '../webhooks/coordinator.ts';
import { webhooksEnabled } from '../webhooks/service.ts';
import { listServerInstances } from '../server-install/state.ts';
import { resolveDeferredReset, deferredHoldUntil } from '../automations/deferred-reset.ts';
import { deferredStartOptions, previewDeferredStart, digest, validateDeferredBinding } from '../automations/deferred-start.ts';
import { deferredOptionsInputSchema, deferredPreviewInputSchema, deferredCreateInputSchema, deferredMutationQuerySchema } from '@onni/contract';
import { secretParamsSchema, secretValueInputSchema, type SecretsList, type SecretValueInput, type TrackerChangedEvent } from '@onni/contract';
import { SecretStore, SecretsError, type SecretScopeRef } from '../workspace/secrets.ts';
import { createTrackerService } from './tracker/index.ts';
import { TrackerWatches } from './tracker/watch.ts';
import { existsSync, readFileSync, statSync } from 'node:fs';
import {
  detectedUrlsSchema, discoveredCommandsSchema,
  startAppSetSchema, startAppStateSchema, terminalCreateSchema, terminalInputSchema, terminalOutputQuerySchema, terminalOutputSchema,
  terminalProjectSessionParamsSchema, terminalResizeSchema, terminalSessionParamsSchema, terminalSessionSchema, terminalStateSchema,
} from '@onni/contract';
import { runsListQuerySchema } from '@onni/contract';
import { deleteRunLayouts } from '../runs/layouts.ts';
import { discoverCommands, installCommand } from './terminal/commands.ts';
import { effectiveStartApp, readStartApp, writeStartApp } from '../start-app.ts';
import { DetectedUrls } from './terminal/detected-urls.ts';
import { processSnapshot } from './terminal/foreground.ts';
import { loadPty } from './terminal/pty-module.ts';
import { AGENT_COMMAND } from './terminal/agent-commands.ts';
import { discoverShells } from './terminal/shells.ts';
import { projectTerminalOwner, TerminalSessions, type TerminalSessionInfo } from './terminal/sessions.ts';
import { createHash, randomUUID } from 'node:crypto';
import { AutomationStore } from '../automations/store.ts';
import { AutomationCoordinator } from '../automations/coordinator.ts';
import { GithubPoller } from '../automations/github-poller.ts';
import { TrackerPoller } from '../automations/tracker-poller.ts';
import { ProjectAutomationScheduler, ProjectTrackerAutomationScheduler, WorkspaceAutomationScheduler, type ProjectAutomationHandle } from '../automations/scheduler.ts';
import { ScheduleRunner } from '../automations/schedule-runner.ts';
import { automationStats } from '../automations/stats.ts';
import { automationTemplatesOf } from '../automations/templates.ts';
import { AutomationLaunchOutcome, launchAutomationRun, launchScheduledRun, launchTrackerAutomationRun, rebaselineIdleAutomations, reconcileAutomationReceipts, validateAutomationPrompt } from '../automations/task-template.ts';
import {
  automationEventSchema,
  automationFiltersSchema,
  automationLogResultSchema,
  automationTaskSchema,
  isGithubAutomation,
  isTrackerAutomation,
  isScheduleAutomation,
  type AutomationDefinition,
} from '../automations/types.ts';
import { trackerTriggerSchema, automationScheduleSchema, localTimeZone, nextOccurrence, scheduleLabel, type AutomationSchedule } from '@onni/contract';
import type { IncomingMessage } from 'node:http';
import { access, constants as fsConstants, lstat, mkdir, readFile, realpath, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono, type Context } from 'hono';
import { groupsRoutes } from './routes/groups.ts';
import { openTargetsRoutes } from './routes/open-targets.ts';
import { todosRoutes } from './routes/todos.ts';
import { worktreesRoutes } from './routes/worktrees.ts';
import type { Next } from 'hono';
import { serve, type ServerType } from '@hono/node-server';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { streamSSE } from 'hono/streaming';
import { jsonZodValidator, multipartZodValidator, paramZodValidator, queryZodValidator } from './validators.ts';
import { createModelsRoutes } from './routes/models.ts';
import { hostedProfileRefusal, providerParamSchema, providersRoutes as createProvidersRoutes } from './routes/providers.ts';
import { agentProfilesRoutes as createAgentProfilesRoutes } from './routes/agent-profiles.ts';
import { projectIdSchema, projectsRoutes as createProjectsRoutes } from './routes/projects.ts';
import { workspaceConfigRoutes as createWorkspaceConfigRoutes } from './routes/workspace-config.ts';
import { runsIndexRoutes as createRunsIndexRoutes } from './routes/runs-index.ts';
export { brandingLogoUploadSchema } from './routes/workspace-config.ts';
export type { ProjectsResponse, RegisterProjectResponse, RemoveProjectResponse, UpdateProjectResponse } from './routes/projects.ts';
import { createFsBrowseRoutes } from './routes/fs-browse.ts';
import { createWorkspaceSecretsRoutes } from './routes/workspace-secrets.ts';
import { createPreviewRoutes } from './routes/preview.ts';
import { createHealthRoutes } from './routes/health.ts';
import { createDraftsRoutes } from './routes/drafts.ts';
import { createLayoutsRoutes } from './routes/layouts.ts';
import { createE2eRoutes } from './routes/e2e.ts';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { createWorkflowsRoutes } from './routes/workflows.ts';
import { createPlanRoutes } from './routes/plan.ts';
import { createConfigRoutes } from './routes/config.ts';
import { createAgentConfigRoutes } from './routes/agent-config.ts';
import { createSseRoutes } from './routes/sse.ts';
import { createWorkspaceEventsRoutes } from './routes/workspace-events.ts';
import { createRepoRoutes } from './routes/repo.ts';
import { createGithubRoutes } from './routes/github.ts';
import { createTrackerRoutes } from './routes/tracker.ts';
import { createDispatchRoutes } from './routes/dispatch.ts';
import { z } from 'zod';
import {
  PROMPT_TEMPLATE_TEXT_MAX,
  setWorkspaceUiStateInputSchema,
  setWorkspaceConfigInputSchema,
  type GroupResponse,
  type GroupVariant,
  type PickVariantResponse,
  type WorkspaceConfigResponse,
  workspaceBrandingLogoResponseSchema,
} from '@onni/contract';
// A contract VALUE, like `workspaceUiStateSchema` in workspace/migrations.ts — the request
// schema this route validates with is the same one the client compiles against.
import {
  ATTACHMENT_IMAGES_TOO_LARGE,
  ATTACHMENT_UPLOAD_MISSING,
  attachmentInputSchema,
  attachmentListSchema,
  type AttachmentEntry,
  continueInputSchema,
  type ContinueResponse,
  deleteUploadResponseSchema,
  isImageAttachmentName,
  isImageMediaType,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENTS_TOTAL_BASE64,
  stagedUploadSchema,
  uploadIdParamSchema,
  openProjectInSchema,
  updateProjectInputSchema,
} from '@onni/contract';
import type { ClearProjectDataResult } from '@onni/contract';
import { clearProjectDataInputSchema } from '@onni/contract';
import { agentUsageOverview } from '../workspace/usage-overview.ts';
import { dispatchIntentSchema, managerMemoryAddSchema, managerMemoryPutSchema, rosterSchema, runLimitsRequestSchema } from '@onni/contract';
import { hasTaskOrAttachments, TASK_OR_ATTACHMENTS_ISSUE } from '@onni/contract';
import { detectEnvironment } from '../core/backend-detect.ts';
import { resolveCursorAgentBin } from '../core/cursor-bin.ts';
import { hostUsageSampler, type HostSampler } from '../core/host-usage.ts';
import { RUNNER_IDS } from '../core/agent-runner.ts';
import type { ContentBlock } from '../core/agent-runner.ts';
import { AGENT_MODELS_LOCKED_ERROR, agentModelsLocked } from '../core/agent-model-policy.ts';
import { discoverClaudeModels } from '../core/claude-model-catalog.ts';
import { resolveClaudeExecutable } from '../core/claude-cli-runner.ts';
import { discoverCodexModels } from '../core/codex-model-catalog.ts';
import { resolveCodexExecutable } from '../core/codex-app-server-transport.ts';
import { resolveAntigravityBin, resolveAntigravityExecutable } from '../core/antigravity-bin.ts';
import { discoverAntigravityModels } from '../core/antigravity-cli.ts';
import { discoverCursorModels } from '../core/cursor-model-catalog.ts';
import { discoverOpencodeModels, resolveOpencodeExecutable } from '../core/opencode-model-catalog.ts';
import { discoverJunieModels } from '../core/junie-model-catalog.ts';
import { resolveJunieExecutable } from '../core/junie-acp-transport.ts';
import { discoverPiModels, resolvePiExecutable } from '../core/pi-model-catalog.ts';
import { programFingerprint } from '../core/cli-fingerprint.ts';
import {
  PROVIDER_IDS,
  ProviderAuthService,
  providerAuthChecksDisabled,
  type ProviderId,
  type ProviderStatusResponse,
} from '../core/provider-auth.ts';
import { applyProviderEnablement } from '../core/provider-availability.ts';
import { LOGIN_WATCH_OFFSETS_MS, watchLogin } from './provider-auth-runtime.ts';
import { RunnerModelCatalog } from '../core/runner-model-catalog.ts';
import { currentUsage } from '../core/process-usage.ts';
import { DashboardReader } from '../workspace/dashboard.ts';
import { dashboardRoutes } from './dashboard.ts';
import { loadWorkflows } from '../workflows/load.ts';
import { stepsIssue, workflowStepSchema, type WorkflowDef } from '../workflows/types.ts';
import { discoverSkills } from '../skills.ts';
import { DesignProxies } from './preview/design-proxy.ts';
import { getTeamSkillsCached, isSafeRef, refreshTeamSkills, safeRemoteFor, waitForTeamSkills } from '../skills-remote.ts';
import { readHandoff } from '../handoff.ts';
import { markStarted } from '../todos.ts';
import type { RunEvent, RunRecord, RunStatus, RunStore } from '../runs/store.ts';
import {
  HistoryCursorError,
  deriveRunContextEvents,
  readRunHistoryPage,
} from '../runs/event-history.ts';
import {
  runHistoryQuerySchema,
  runIdParamSchema,
} from '@onni/contract';
import { toPastedContent, type PastedContent, type RunManager } from '../workflows/run.ts';
import {
  foldedLength,
  imageChars,
  MAX_FOLDED_TASK_CHARS,
  MAX_QUEUED_ATTACHMENTS,
  QUEUED_IMAGES_TOO_LARGE,
  queuedImageChars,
  queuedStackRefusal,
} from '../workflows/queued-bounds.ts';
import { checkoutGitStatus } from '../workflows/landing.ts';
import { deleteUpload, readUpload, writeUpload } from '../uploads.ts';
import { diskHealth } from './disk-health.ts';
import { branchesCheckedOutElsewhere, removeWorktree, worktreeDiff } from '../git-worktree.ts';
import { protectedByLiveTree } from '../runs/retention.ts';
import { worktreeLifecycleRoutes, lifecycleError } from './worktree-lifecycle.ts';
import { readLifecycleConfigOrDefault } from '../worktree-lifecycle/config.ts';
import { getRepoInfo } from './git.ts';
import {
  collectChanges,
  collectCommitChanges,
  collectRunCommits,
  commitAll,
  createOrSwitchBranch,
  imageMimeType,
  isOsOpenableImage,
  listRepoPaths,
  isCommitSha,
  readImageAtRev,
  pushCurrentBranch,
  worktreeGitStatus,
  readWorktreePath,
  repoIndexContains,
} from './git-changes.ts';
import { gatedSkillsRepos, loadConfig, type OnniConfig } from '../config.ts';
import { statConfigPath } from '../agent-config/files.ts';
import { listConfigFiles, type AgentHomePaths } from '../agent-config/catalog.ts';
import { readAccountIdentity } from '../agent-config/account-identity.ts';
import {
  PROJECT_ID_RE,
  defaultWorkspaceConfig,
  loadWorkspaceConfig,
  mergeWriteWorkspaceConfig,
  effectiveComposerDefault,
  type WorkspaceConfig,
  type WorkspaceProject,
} from '../workspace/config.ts';
import {
  CONTROL_CHARS_RE,
  DEFAULT_AGENT_ACCOUNT_ID,
  defaultAgentAccountStore,
  isAbsoluteConfigDir,
  loadAgentAccounts,
  mergeWriteAgentAccounts,
  type AgentAccount,
  type AgentAccountStore,
} from '../workspace/agent-accounts.ts';
import {
  defaultAgentProfile,
  listAgentProfiles,
  profileDirState,
  resolveProfileEnvForRoot,
  resolveStoredProfile,
  sameProfileDir,
  type ResolvedAgentProfile,
} from '../workspace/agent-profiles.ts';
import { PROFILE_CAPABLE_PROVIDERS, profileEnv, supportsProfiles } from '../core/agent-profiles.ts';
import { withEnvPrefix } from '../core/shell-env.ts';
import {
  allocateProjectSlug,
  clearProjectProbeCache,
  listProjects,
  normalizeProjectTags,
  probeProjectStatus,
  registerProject,
  removeProject,
  shouldRegisterProject,
  type ProjectListEntry,
} from '../workspace/projects.ts';
import { WorkspaceSemaphore } from '../workspace/semaphore.ts';
import { mergeWriteWorkspaceUiState, readWorkspaceUiState } from '../workspace/ui-state.ts';
import { checkoutRepo, type CloneRunner } from './checkout.ts';
import { createProjectInputSchema } from '@onni/contract';
import { createProject, listGithubOwners, type CommandRunner } from './create-project.ts';
import { ProjectContextError, ProjectContexts, type ProjectContext } from './project-context.ts';
import { reviewGateEnabled } from '../runs/review-gate.ts';
import { agentHomePaths, onniHomeDir, expandTilde, isAbsolutePath } from '../paths.ts';
import { renameWithRetry } from '../fs-rename.ts';
import { agentAccountsEnabled, isLoopbackHostHeader, normalizeHostname, resolveCapabilities } from './capabilities.ts';
import { createSocketHub, type SocketHub, type WsUpgradeVerdict } from './ws.ts';
import { applyKeepAlive } from './keep-alive.ts';
import { browseDirectory, isInsideBrowseRoot, isLexicallyInsideBrowseRoot, resolveBrowseRoot } from './fs-browse.ts';
import { parseRemote, resolveForge, type ForgeAvailability } from './forge/index.ts';
import { isGithubHost } from '../github-hosts.ts';
import { forgetRefStatus, refNumberFromUrl } from './github.ts';
import { ensureLaunchKey } from './launch-key.ts';
import { launchKeyRoutes } from './routes/launch-key.ts';
import { skillsRoutes } from './routes/skills.ts';
import { uiStateRoutes } from './routes/ui-state.ts';
import { secretsRoutes } from './routes/secrets.ts';
import { openInTerminal } from './open-in-terminal.ts';
import {
  agentCliRunner,
  detectOpenTargets,
  openFileInDefaultApp,
  openInApp,
  withResolvedClaudeBin,
} from './open-in-app.ts';
import { createDraftPr, type DraftPrOutcome } from './pr.ts';
import { findBranchPr, resolvePrTarget } from './forge/github.ts';
import { ProviderRuntimeAuthObserver } from './provider-auth-runtime.ts';
import { MessageReceipts } from './message-receipts.ts';
import type { MessageResponse } from '@onni/contract';
import {
  providerForActiveRun,
  providerForExistingRun,
  providersRequiredByWorkflow,
  recordedProfileFor,
  unavailableProviderMessage,
  withSelectedAccounts,
  type ProviderAccountScope,
} from './provider-action-gate.ts';
import {
  ASSET_CACHE_CONTROL,
  SHELL_CACHE_CONTROL,
  BUILD_HINT_HTML,
  assetContentType,
  isSafeAssetFilename,
  resolveGetRequest,
} from './static-ui.ts';

export interface ServerDeps {
  /** Register app-owned cleanup for the hosting server lifecycle. */
  onDispose?: (cleanup: () => void) => void;
  repoRoot: string;
  store: RunStore;
  manager: RunManager;
  version: string;
  /** Environment snapshot for capability gates; tests inject values rather than mutating process.env. */
  env?: NodeJS.ProcessEnv;
  /** Host the HTTP server binds (default 127.0.0.1). A non-loopback host
   *  implies hosted mode — `capabilities.localHandoff:false`. */
  bindHost?: string;
  /** Workspace-registry id of the boot project (multi-project spec) — plumbed
   *  from `initWorkspace` in src/index.ts. Optional: legacy callers/tests get
   *  a lazy registry lookup by `repoRoot`, falling back to the repo's slug. */
  bootProjectId?: string;
  /** Per-project context map (multi-project spec, step 2.2). Non-boot
   *  `/api/p/:projectId/*` requests resolve their `{store, manager, …}` here,
   *  built lazily on first touch. Optional so legacy callers change nothing —
   *  the default is a registry-backed map; tests inject their own so they can
   *  `disposeAll()` after. The BOOT project never lives in this map: its
   *  context is seeded from `deps.{store,manager}` (which src/index.ts already
   *  recovered/pruned at startup) and the resolver short-circuits to it. */
  contexts?: ProjectContexts;
  webhooks?: WebhookCoordinator;
  webhookPort?: number;
  /** Boot project's shared automation store. `startServer` injects the
   *  coordinator-owned instance so HTTP routes and the scheduler never cache
   *  separate views of the same project files. */
  automationStore?: AutomationStore;
  /** Workspace-wide parallel-cap semaphore + cached resource config (spec
   *  2026-07-20, step 2.5): the ONE instance boot created, refreshed, and gave
   *  the boot manager — threaded into the default `ProjectContexts` so every
   *  project's RunManager shares it. Step 2.7's `PUT /api/workspace/config`
   *  calls `semaphore.refresh()` after a write. Optional so legacy
   *  callers/tests change nothing. */
  semaphore?: WorkspaceSemaphore;
  /** Workspace-level SSE bus (spec, step 2.8): `project-added` /
   *  `project-removed` / `checkout-progress` plus the host-wide unstamped
   *  `provider-status` event reach `/api/workspace/events` through this.
   *  Optional — createApp builds a private one; inject to emit from outside
   *  the app (tests, future CLI hooks). */
  workspaceEvents?: WorkspaceEventBus;
  /** How `POST /api/projects/checkout` (step 4.3) actually clones. Defaults to
   *  `gh repo clone` (or the `ONNI_DRY_RUN=1` fake) — injected by tests so the
   *  route's guards, cleanup and error surfacing are exercised for real
   *  against real temp dirs, without a network or a `gh` binary. */
  cloneRunner?: CloneRunner;
  /** How `POST /api/projects/create` and `GET /api/projects/github-owners`
   *  run `git`/`gh` (spec 2026-09-29-create-new-project). Defaults to real
   *  commands (or the `ONNI_DRY_RUN=1` fake); injected by tests. */
  projectCommandRunner?: CommandRunner;
  /** Host-wide model discovery service. Tests inject a deterministic adapter. */
  modelCatalog?: RunnerModelCatalog;
  /** Host-wide provider authentication discovery. Tests inject deterministic probes. */
  providerAuth?: ProviderAuthService;
  /** Global provider enablement preferences. Tests may inject an in-memory store. */
  workspaceConfig?: {
    load: typeof loadWorkspaceConfig;
    mergeWrite: typeof mergeWriteWorkspaceConfig;
  };
  /** Shared runtime rejection observer. The CLI injects the instance already
   *  watching the boot store before recovery; createApp builds one for legacy
   *  callers and tests. */
  providerRuntimeAuth?: ProviderRuntimeAuthObserver;
  /** Local terminal handoff for provider-owned login. */
  openTerminal?: typeof openInTerminal;
  /** When Connect re-checks the login it opened (`LOGIN_WATCH_OFFSETS_MS`); tests pass `[]`. */
  loginWatchOffsetsMs?: readonly number[];
  /** Hand a local FILE (or folder) to the OS default app. Injected so the account-file open route
   *  is testable without actually launching an editor. */
  openFile?: typeof openFileInDefaultApp;
  /** Hand a folder to a detected app by target id — editor, file manager, or `terminal`, which
   *  reaches `openInTerminal`. Injected for the same reason as the two above: a test that reaches
   *  this for real opens a window on the developer's machine (#820). */
  openApp?: typeof openInApp;
  /** The project/workspace secret store (spec 2026-10-10-project-secrets-vault-options). Tests
   *  inject one with a fake keychain; the default reads the OS keychain or a key file. */
  secrets?: SecretStore;
  /** The Design Mode proxies behind `POST /api/v1/preview/design-proxy` (src/server/preview/).
   *  Injected by tests that need to close the listeners they opened. */
  designProxies?: DesignProxies;
  /** WebSocket subscription hub (`/api/v1/ws`, src/server/ws.ts). `createApp`
   *  only registers topics on it — `startServer` builds one and attaches it
   *  to the HTTP server it binds. Optional so legacy callers/tests change
   *  nothing: no hub, no topics, and the HTTP surface is byte-identical. */
  socketHub?: SocketHub;
  /** The task terminal's session registry. Injectable so route tests drive a fake PTY. */
  terminalSessions?: TerminalSessions;
  /** The host-telemetry sampler behind the `host` topic and the `/workspace/host-usage` route.
   *  Defaults to the process-wide singleton; injectable so tests can drive a frame shape (a
   *  container object, for instance) that CI machines do not have. */
  hostSampler?: HostSampler;
  /** Re-arm the workspace automation timer after definition mutations. */
  automationsChanged?: () => void;
}

/** Legacy destructive callers must opt into the recoverable operation API before mutation. */
async function legacyLifecycleGate(project: ProjectContext, runId: string): Promise<boolean> {
  if (project.manager.lifecycle) return project.manager.lifecycle.requiresGate(runId);
  // Older embedded callers/test doubles have no coordinator; configured hooks still fail closed.
  const { config } = await readLifecycleConfigOrDefault(project.root);
  return config.afterCreate.length > 0 || config.beforeRemove.length > 0;
}
const LIFECYCLE_ENDPOINT_REQUIRED = 'Worktree scripts require a lifecycle operation; use /worktree-lifecycle/operations';

async function withWorktreeMutation<T>(project: ProjectContext, runId: string, mutate: () => Promise<T>): Promise<T> {
  return project.manager.lifecycle ? project.manager.lifecycle.withWorktreeMutation(runId, mutate) : mutate();
}

async function legacyWorktreeMutation<T>(project: ProjectContext, runId: string, mutate: () => Promise<T>): Promise<T> {
  if (await legacyLifecycleGate(project, runId)) throw new Error(LIFECYCLE_ENDPOINT_REQUIRED);
  // Unconfigured projects retain their original path without requiring writable lifecycle state.
  return withWorktreeMutation(project, runId, mutate);
}

// ---- project-scoped routing (multi-project spec, step 2.2) -----------------

/** Hono env for the mirrored project-route table: the scope resolver puts the
 *  request's `ProjectContext` on the context, handlers read `c.get('project')`. */
type ProjectApiEnv = { Variables: { project: ProjectContext } };

/** `projectId` gate at the route boundary (spec "Project identity"): the slug
 *  shape or the reserved `default` alias — validated BEFORE touching any map
 *  or path. (`default` matches the slug regex too; the literal keeps the
 *  contract explicit.) */



/** In-flight `POST /runs/:id/pr` publishes, keyed by data dir + run id. */
const prPublishes = new Map<string, Promise<{ outcome: DraftPrOutcome; branch: string }>>();


const automationEditableSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2_000).optional(),
    enabled: z.boolean().optional(),
    /** Omitted on create = `github`; omitted on update = the stored kind (spec 2026-09-14). */
    kind: z.enum(['github', 'schedule', 'tracker']).optional(),
    events: z.array(automationEventSchema).min(1).max(7).optional(),
    intervalSeconds: z.number().int().min(60).max(86_400).optional(),
    filters: automationFiltersSchema.optional(),
    trackerTrigger: trackerTriggerSchema.optional(),
    schedule: automationScheduleSchema.optional(),
    task: automationTaskSchema,
  })
  .strict();
type AutomationEditableBody = z.infer<typeof automationEditableSchema>;

/**
 * The kind rules the storage schema also enforces, answered as a 400 message rather than a zod
 * issue path (spec 2026-09-14 § Data Model): a poll needs its three keys; a schedule needs its
 * schedule and carries no GitHub filter.
 */
function automationKindIssue(body: AutomationEditableBody, kind: 'github' | 'schedule' | 'tracker'): string | null {
  // Tracker automations have no create/edit route yet (2026-09-19): hand-authored into
  // `automations.json` only. Refuse explicitly rather than misapplying the GitHub filter rules
  // below to one that reaches this far (e.g. a PUT that omits `kind` on an existing tracker row).
  if (kind === 'tracker') return body.trackerTrigger ? null : 'Choose an event to finish configuring this automation';
  if (kind === 'schedule') {
    if (!body.schedule) return 'a scheduled automation needs a schedule';
    if (body.schedule.type === 'once' && !body.schedule.date) return 'a one-time schedule needs a date';
    if (body.events || body.filters || body.intervalSeconds !== undefined) return 'a scheduled automation has no GitHub filter';
    return null;
  }
  if (!body.events?.length) return 'a GitHub automation needs at least one event';
  if (body.intervalSeconds === undefined) return 'a GitHub automation needs a poll interval';
  if (!body.filters) return 'a GitHub automation needs its bounded filter';
  if (body.schedule) return 'a GitHub automation has no schedule';
  return null;
}
/**
 * A one-time schedule can only be ENABLED while its instant is still ahead (#771): enabling one
 * that has passed would arm nothing and sit "enabled" forever. Saved paused, it is a draft and is
 * accepted; Run now still works on it.
 */
function oncePassedIssue(schedule: AutomationSchedule | undefined, enabled: boolean, now = Date.now()): string | null {
  if (!enabled || schedule?.type !== 'once') return null;
  if (nextOccurrence(schedule, now, localTimeZone()) !== null) return null;
  return `the one-time schedule (${scheduleLabel(schedule)}, ${localTimeZone()}) is not in the future; pick a later time`;
}
const automationCreateSchema = automationEditableSchema.extend({ enable: z.boolean().optional() });
const automationUpdateSchema = automationEditableSchema.extend({ expectedRevision: z.number().int().positive() });
const automationCheckRequestSchema = z.object({ mode: z.enum(['preview', 'execute']) }).strict();
const automationLogQuerySchema = z.object({
  automationId: z.string().optional(),
  result: automationLogResultSchema.optional(),
  event: automationEventSchema.optional(),
  since: z.string().datetime().optional(),
  cursor: z.coerce.number().int().positive().optional(),
  // Optional, not `.default(100)`: `AutomationStore.logs` already clamps `limit ?? 100` into
  // 1..100, so the default here was a second copy of it — and a defaulted key is REQUIRED in the
  // request type `queryZodValidator` publishes (see validators.ts on why the request side falls
  // back to the schema's output), which would have made every caller send a `?limit=` this route
  // never needed.
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** A by-hand schedule launch that started no run, in words that say why (telemetry 411fac74:
 *  "see the execution log" alone sent the user elsewhere for the one line that mattered). */
function launchFailedMessage(outcome: { reason?: string }): string {
  return outcome.reason ? `the launch failed: ${outcome.reason}` : 'the launch failed — see the execution log';
}

function editableAutomation(definition: AutomationDefinition) {
  return {
    name: definition.name,
    description: definition.description,
    enabled: definition.enabled,
    kind: definition.kind,
    events: definition.events,
    intervalSeconds: definition.intervalSeconds,
    filters: definition.filters,
    trackerTrigger: definition.trackerTrigger,
    schedule: definition.schedule,
    task: definition.task,
  };
}

/** One row of the mirrored project-route table. */
export interface ProjectRouteInfo {
  method: string;
  /** Path relative to the mount — `/runs/:id`, not `/api/runs/:id`. */
  path: string;
}

/**
 * The public API surface (spec 2026-07-23-independent-server-web-packages).
 *
 * Every route lives under this one prefix. The unversioned `/api/*` spelling the cockpit used
 * to speak was removed once the whole API was reachable here — carrying two spellings meant two
 * surfaces to keep working, and only one of them could be the typed contract. Bumping to `v2`
 * means mounting a second table beside this one, not editing route paths.
 */
const V1_PREFIX = '/api/v1';

/** Project scoping inside the versioned surface. The version is the OUTER dimension, so a
 *  consumer picks its API version once and then addresses projects inside it. */
const V1_SCOPED_PREFIX = `${V1_PREFIX}/p/:projectId`;

/**
 * The project-scoped route table of a `createApp()` app, derived from its actual registrations
 * (so it can never drift from the code): every method+path mounted under
 * `/api/v1/p/:projectId/…`, minus the scope-resolver middleware (method ALL), deduped. The
 * alias-parity suite iterates this to assert `/api/v1/<path>` ≡ `/api/v1/p/<boot>/<path>` ≡
 * `/api/v1/p/default/<path>`.
 */
export function projectRouteManifest(app: Hono): ProjectRouteInfo[] {
  const seen = new Set<string>();
  const manifest: ProjectRouteInfo[] = [];
  for (const route of app.routes) {
    if (route.method === 'ALL' || !route.path.startsWith(`${V1_SCOPED_PREFIX}/`)) continue;
    const path = route.path.slice(V1_SCOPED_PREFIX.length);
    const key = `${route.method} ${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    manifest.push({ method: route.method, path });
  }
  return manifest;
}

/** 409 body for every automations route while GitHub automations are off (#801). */
const AUTOMATIONS_OFF = 'Automations are off — this cockpit was started with ONNI_AUTOMATIONS=0';

/** 409 body for every dispatch route while task dispatch is off (spec 2026-09-10-dispatch). */
const DISPATCH_OFF =
  'dispatch is disabled on this cockpit (ONNI_DISPATCH=0) — the operator turned it off. Do not substitute sub-agents or do the delegated work yourself: stop and report that dispatch is disabled.';

// ---- variant-compare response shapes (spec 010) ----------------------------
// Named and exported so `api-types.test.ts` can drift-guard the cockpit's
// hand-mirrored copies (`web/app/src/api/types.ts`) against the real thing.

/** One column of `GET /api/groups/:groupId`. NOTE: `diffStat` here is the raw
 *  `git diff --stat` text (worktreeDiffStat), NOT the numeric `RunRecord.diffStat`. */
// ---- workspace SSE (multi-project spec, step 2.8) --------------------------

/** Workspace-level event names carried ONLY on `GET /api/workspace/events`
 *  (never on the per-project streams): registry mutations, the GUI-clone
 *  progress feed (step 4.3), and host-wide unstamped provider status. */
export type WorkspaceEventName =
  | 'project-added'
  | 'project-removed'
  | 'checkout-progress'
  | 'provider-status'
  | 'automation-change'
  | 'tracker-changed'
  | 'worktree-lifecycle';

/**
 * The in-process bus for workspace-level SSE events. The registry-mutating
 * routes (`POST /api/projects` — step 4.2, emits `project-added` for a
 * genuinely new entry; `DELETE /api/projects/:projectId` — step 4.4) and the
 * checkout flow (step 4.3) call `emit()`; runtime provider auth observation
 * emits host-wide `provider-status`; every open `/api/workspace/events` stream
 * relays the event verbatim under its name. Injectable via
 * `ServerDeps.workspaceEvents` so tests (and any out-of-createApp emitter) can
 * drive the stream.
 */
export class WorkspaceEventBus {
  private readonly listeners = new Set<(event: WorkspaceEventName, data: unknown) => void>();

  emit(event: WorkspaceEventName, data: unknown): void {
    for (const listener of [...this.listeners]) listener(event, data);
  }

  /** Subscribe; returns an unsubscribe. */
  on(listener: (event: WorkspaceEventName, data: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** streamSSE with the anti-buffering contract (#424): hono's own header is a
 *  bare `no-cache`, which lets an intermediary (reverse proxy, compression
 *  middleware, corporate MITM) transform-buffer the stream — the client then
 *  sees a silently frozen transcript while the server keeps writing. Headers
 *  are set on the returned Response because hono's helper overwrites
 *  `Cache-Control` set via `c.header()` before it. */
const streamSSENoBuffer: typeof streamSSE = (c, cb, onError) => {
  const res = streamSSE(c, cb, onError);
  res.headers.set('Cache-Control', 'no-cache, no-transform');
  res.headers.set('X-Accel-Buffering', 'no');
  return res;
};

// A run starts from a named workflow OR an inline chain of steps (spec 008 —
// the approved plan is posted as-is, never written to a file).
const startRunSchema = z
  .object({
    workflow: z.string().min(1).optional(),
    steps: z.array(workflowStepSchema).min(1).max(8).optional(),
    // The primary agent prompt handed to the spawned runner. Bounded like the
    // other prompt fields (`systemPrompt` 20k, message `text` 100k) so an
    // unbounded body can't be piped into a spawned process (#429). 100k chars
    // (~25k tokens) is well past any hand-written task. May be empty when attachments carry the
    // task (telemetry 18c930de) — the refine below requires one or the other.
    task: z.string().max(100_000, 'must be at most 100000 characters'),
    model: z.string().optional(),
    // Agent backend for this task (falls back to config `defaultRunner`).
    runner: z.enum(RUNNER_IDS).optional(),
    // Agent account for this task (spec 2026-07-29-agent-profiles). Falls back to the project's
    // own selection, then the discovered default. Bounded like a profile id in the workspace
    // schema, so a value this route accepts can never be degraded away by the next load.
    agentProfile: z.string().max(64).optional(),
    // Parallel variants (spec 010): ×2/×3 runs the task as 2–3 competing
    // agents in separate worktrees; the user compares diffs and picks one.
    variants: z.number().int().min(1).max(3).optional(),
    // Composer worktree opt-out (#worktree-toggle): false runs in the repo
    // working tree. Ignored when variants > 1.
    worktree: z.boolean().optional(),
    // With worktree:false, switch the checkout to a branch forked from base first
    // (spec 2026-10-19-repo-git-sync); `branch` names it.
    newBranch: z.boolean().optional(),
    branch: z.string().trim().min(1).max(200).optional(),
    // A read-only Ask task (spec 2026-10-20-trunk-based-projects): in place, no lease, no writes.
    readOnly: z.boolean().optional(),
    // Autonomous mode (#autonomous): the run never parks at `waiting` — it
    // auto-continues until the agent signals done. No "needs you" is raised.
    autonomous: z.boolean().optional(),
    // Cost / token / time / iteration ceilings (docs/design/unattended-safety.md). Omitted =
    // the workspace default; refused when the request comes from inside an agent task.
    limits: runLimitsRequestSchema.optional(),
    // Manager–worker (docs/design/manager-worker.md): this task manages the listed workers.
    roster: rosterSchema.optional(),
    // "Full quyền manager": the manager may merge (needs a roster). Omitted = the workspace default (off).
    managerFullAccess: z.boolean().optional(),
    // Generate follow-up inbox entries (spec 007, #444). Honoured only while
    // the `followups` capability is on (#471) — off, the server pins it to
    // false whatever the client asked for. Omitted still means "enabled" for
    // old clients, but only within an already-enabled server. The handoff
    // journal is unaffected either way.
    generateFollowups: z.boolean().optional(),
    // Per-run system-prompt override (R2 2.3) — programmatic callers only
    // (bookmarklets, scripts); deliberately NOT a composer-UI control. Wins
    // over the config.json default; whitespace-only degrades to absent.
    systemPrompt: z
      .string()
      .trim()
      .max(20_000, 'must be at most 20000 characters')
      .optional()
      .transform((s) => (s ? s : undefined)),
    // Attachments pasted into the new-task form — same shape and limits as a
    // live-session message; delivered with the first agent step's opening.
    images: attachmentListSchema.optional(),
    // Inbox follow-up (#374): the todo the composer was prefilled from
    // (`/new?skill=&ref=&todo=t1`). On a successful start the entry is marked
    // started — the same bookkeeping POST /api/todos/:id/start does, so the
    // audit trail survives the composer detour. Bounded like every other
    // string here; a todo id is a short generated key.
    todoId: z.string().min(1).max(200, 'must be at most 200 characters').optional(),
    // The composer's Dispatch toggle (spec 2026-09-10-dispatch): this task is the root of a
    // dispatch tree, within the user's limits. Dropped — not refused — when the capability is
    // off: the task itself is still perfectly valid as an ordinary run.
    dispatch: dispatchIntentSchema.optional(),
  })
  .refine((b) => Boolean(b.workflow) !== Boolean(b.steps), {
    message: 'provide either "workflow" or "steps", not both',
  })
  .refine(hasTaskOrAttachments, TASK_OR_ATTACHMENTS_ISSUE);

const pickSchema = z.object({
  runId: z.string().min(1),
});

// Small GUI preferences persisted in `.ai/onni/ui-state.json` (files, not a
// DB): today just the last-used task source, so the form preselects what you
// actually run. Unknown keys pass through — future prefs won't need a schema
// dance.

/** Entry cap on the `skillUsage` map (#408). A real skill catalog is dozens of entries; this
 *  bounds the ui-state.json write without ever rejecting a legitimate one. */
const SKILL_USAGE_MAX_ENTRIES = 200;

// Belt-and-braces cap on the number of top-level ui-state keys so a
// `.passthrough()` schema can't accumulate an unbounded key set (#429). Very
// generous for GUI prefs; over-limit is a 400, never a silent strip. Shared by
// BOTH ui-state routes (per-repo and workspace) via `parseUiStateBody`.
const UI_STATE_MAX_KEYS = 200;

/** Settings → Appearance (redesign R6): accent + density + reading width. ONE
 *  schema for both ui-state files — per-repo (the legacy home, kept so an older
 *  onni in the same repo still honours it) and workspace
 *  (`~/.onni/ui-state.json`, its post-migration home — multi-project spec,
 *  Data Model).
 *
 *  Every key is `.optional()` so an older ui-state.json parses unchanged, but
 *  each one must be listed HERE: the enclosing `workspaceUiStateSchema` is
 *  `.passthrough()` at the top level only, so an unlisted key inside
 *  `appearance` is stripped by zod and then wiped from the file by the shallow
 *  merge-on-write. The cockpit adopts the PUT response as authoritative, so a
 *  stripped key does not merely fail to persist — it visibly reverts the
 *  control the user just touched. Adding an appearance preference means adding
 *  it here in the same change. */
const appearanceSchema = z.object({
  accent: z.enum(['lime', 'violet']).optional(),
  density: z.enum(['comfortable', 'compact', 'ultra']).optional(),
  width: z.enum(['narrow', 'wide']).optional(),
});

const uiStateSchema = z
  .object({
    // `null` clears the recorded choice — the composer's "no skill, no workflow" state,
    // which is a plain quick-task run. Written through to the file like any other value, so an
    // older cockpit reading it falls back to its own default instead of restoring a stale skill.
    lastTask: z
      .object({
        source: z.enum(['workflow', 'skill']),
        ref: z.string().min(1).max(200),
      })
      .nullable()
      .optional(),
    // Composer picker recency (newest first, capped) + the remembered worktree
    // choice for single-skill runs. Additive prefs, like the rest of ui-state.
    recentSources: z
      .array(
        z.object({
          source: z.enum(['workflow', 'skill']),
          ref: z.string().min(1).max(200),
        }),
      )
      .max(50)
      .optional(),
    lastWorktree: z.boolean().optional(),
    lastAutonomous: z.boolean().optional(),
    lastGenerateFollowups: z.boolean().optional(),
    // Default team-skill curation belongs to this repo's ui-state, never the workspace state.
    importedSkills: z.array(z.string().min(1).max(200)).max(UI_STATE_MAX_KEYS).optional(),
    // Skill selection frequency (#408): name → times chosen, incremented on a successful run
    // start from EITHER composer (`/new`'s SourcePill and the follow-up `SkillsPicker`). Drives
    // the shared `orderSkillsByUsage` sort (web/app/src/lib/skills.ts) so both pickers float the
    // skills a user actually reaches for above the rest, within the existing project-first
    // grouping. ADDITIVE, like the rest of ui-state — the client always PUTs the whole map
    // because the top-level merge below is shallow.
    //
    // Bounded on all three axes (key length, value, entry count) like every neighbour here: this
    // map is written straight to `ui-state.json`, which the cockpit GETs on every load and this
    // route re-reads on every PUT, so an unbounded map is an unbounded file write. Keys are skill
    // names (`.min(1).max(200)`, matching `lastTask.ref`); SKILL_USAGE_MAX_ENTRIES sits far above
    // any real catalog while capping the file at a few tens of KB.
    skillUsage: z
      .record(z.string().min(1).max(200), z.number().int().min(0).max(1_000_000))
      .refine((usage) => Object.keys(usage).length <= SKILL_USAGE_MAX_ENTRIES, {
        message: `skillUsage must have at most ${SKILL_USAGE_MAX_ENTRIES} entries`,
      })
      .optional(),
    // Runs area presentation (#348): the sidebar-list + detail pane, or the
    // full-width table ("task manager") view.
    runsView: z.enum(['list', 'table']).optional(),
    // The GitHub tab's last-selected sub-tab (#417): issues or PRs. ADDITIVE — an old
    // ui-state.json without the key behaves as the default (issues).
    githubView: z.enum(['issues', 'prs']).optional(),
    // The GitHub tab's list order: newest first (what `gh` returns) or oldest first, for working
    // the backlog from the long-waiting end. ADDITIVE, like `githubView` above — an old
    // ui-state.json without the key behaves as the default (newest), and the sort is applied
    // client-side, so this key changes presentation only, never what `GET /github` fetches.
    githubSort: z.enum(['newest', 'oldest']).optional(),
    // Settings → Appearance (redesign R6): accent + density. ADDITIVE — the theme itself
    // stays in the browser (`onni-theme` localStorage, pre-paint). The cockpit always PUTs
    // the whole object because the top-level merge below is shallow.
    appearance: appearanceSchema.optional(),
    // Follow-up prompt templates (#413): reusable snippets insertable into the GitHub hand-over
    // and Inbox follow-up composers. Absent → the client's built-in defaults; present (even `[]`)
    // is the user's own edited list, from Settings → Prompt templates. Additive, like the rest of
    // ui-state — the cockpit is the only writer, so validation stays generous but bounded.
    promptTemplates: z
      .array(
        z.object({
          id: z.string().min(1).max(64),
          label: z.string().trim().min(1).max(80),
          text: z.string().trim().min(1).max(PROMPT_TEMPLATE_TEXT_MAX),
          // Skill names this template auto-applies for. Optional and additive: templates
          // written before this key existed keep validating, and stay manual-only.
          skills: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
        }),
      )
      .max(50)
      .optional(),
    // Skills promo banner (#391): set once the cockpit banner is dismissed, never unset.
    // Server-persisted (not a cookie) so the "shown once" promise holds across browsers.
    // Retained for backward compatibility — the banner is gone; `.passthrough()` would preserve
    // the key regardless, but keep it typed.
    dismissedSkillsBanner: z.boolean().optional(),
  })
  .passthrough();

// Editable titles (#389), and the initial prompt while the run is still queued
// (#472 — rejected with 409 on any other status by the handler).
const patchRunSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  task: z.string().trim().min(1).max(100_000).optional(),
});

// `POST /runs/:id/pr`: `draft` defaults to true — a bodyless POST still opens the draft PR every
// caller got before the flag existed (the review gate's Draft PR); the run header's Create PR asks
// for a ready-for-review one with `draft: false`.
const createPrSchema = z.object({ draft: z.boolean().optional() });

// Session commit (redesign R5 — §"Git/session API additions").
const gitCommitSchema = z.object({
  message: z.string().trim().min(1, 'must not be empty').max(5_000),
});

// "Open in…" (#open-in / #365): `target` selects the app; `path` (optional, worktree-relative)
// narrows the target's own worktree/repo-root default to one file — used by the diff pane's
// "open in default app" action for images. Containment is re-checked server-side via
// `readWorktreePath`; this schema only shapes the request.
const openInSchema = z.object({
  // A short bound (#429): matched against a downstream allowlist, so an editor id is never long.
  target: z.string().trim().min(1, 'target required').max(200),
  path: z.string().max(1_000).optional(),
});

// Attachment-carrying bodies validate with the CONTRACT's `attachmentListSchema` (#950) —
// images plus the short PDF/TXT/MD allowlist, ~5 MB each once base64-decoded. Imported rather
// than mirrored here, so the wire cannot drift from what the cockpit compiles against.
const messageSchema = z
  .object({
    text: z.string().max(100_000).default(''),
    images: attachmentListSchema.default([]),
    idempotencyKey: z.string().uuid().optional(),
    /** The manager-ask `requestId` this message answers (plan v2 §9). Absent for a free message. */
    replyTo: z.string().min(1).max(120).optional(),
  })
  .refine((m) => m.text.trim().length > 0 || m.images.length > 0, {
    message: 'message needs text or at least one attachment',
  });

// Run ids are unique across projects, so one workspace-wide receipt book serves every mount.
const messageReceipts = new MessageReceipts<MessageResponse>();
const continueReceipts = new MessageReceipts<ContinueResponse>();

// PATCH semantics are load-bearing here: an omitted field keeps its current value.
// In particular, the cockpit edits text without re-uploading existing attachments.
const queuedMessagePatchSchema = z
  .object({
    text: z.string().max(100_000).optional(),
    images: attachmentListSchema.optional(),
  })
  .refine((m) => m.text !== undefined || m.images !== undefined, {
    message: 'message edit needs text or attachments',
  });

/** A message's attachments as engine content, staged uploads read back from the store
 *  (telemetry 7054e5f2). A string is the refusal: `ATTACHMENT_UPLOAD_MISSING` when a referenced
 *  upload is gone (the composer re-stages), or the image budget — images reach the provider
 *  inline in one turn, so references count toward it too. */
function resolveAttachments(entries: AttachmentEntry[]): PastedContent[] | string;
function resolveAttachments(entries: AttachmentEntry[] | undefined): PastedContent[] | undefined | string;
function resolveAttachments(entries: AttachmentEntry[] | undefined): PastedContent[] | undefined | string {
  if (entries === undefined) return undefined;
  const out: PastedContent[] = [];
  let imageChars = 0;
  for (const entry of entries) {
    const attachment = 'data' in entry ? entry : readUpload(entry.uploadId);
    if (!attachment) return ATTACHMENT_UPLOAD_MISSING;
    if (isImageMediaType(attachment.mediaType)) imageChars += attachment.data.length;
    out.push(toPastedContent('data' in entry || !entry.name ? attachment : { ...attachment, name: entry.name }));
  }
  if (imageChars > MAX_ATTACHMENTS_TOTAL_BASE64) return ATTACHMENT_IMAGES_TOO_LARGE;
  return out;
}

// "Continue"/"Send back" body: the contract's own schema, so the wire cannot drift from the client.
const continueSchema = continueInputSchema;

// `POST /api/runs/:id/archive` (#429) — no body archives; `{archived:false}`
// un-archives. A tiny schema so the route follows the safeParse convention.
const archiveSchema = z.object({
  archived: z.boolean().optional(),
});

// `POST /api/v1/runs/:id/pin` (#935) — no body pins; `{pinned:false}` unpins. The archive
// route's shape, deliberately: it is the same kind of per-task flag, and a second spelling for
// "absent means do the thing" would be one more rule for a client to remember.
const pinSchema = z.object({
  pinned: z.boolean().optional(),
});

// Request-body size guards (#429). A generous global cap keeps a single
// localhost request from being unbounded (the largest legit body is one message's
// attachments, ≤ MAX_ATTACHMENTS_TOTAL_BASE64 in total); the ui-state PUT gets a much tighter cap since
// it only ever carries small GUI prefs.
const GLOBAL_BODY_LIMIT = 32 * 1024 * 1024; // 32 MiB
const UI_STATE_BODY_LIMIT = 128 * 1024; // 128 KiB
/** The name half of a Host header — `localhost:4321` → `localhost`,
 *  `[::1]:4321` → `[::1]`. A bracketed IPv6 literal keeps its brackets
 *  (`isLoopbackHost` strips them itself); an unbracketed IPv6 spelling is
 *  nonstandard in a Host header and simply fails the loopback test closed. */
function stripHostPort(host: string): string {
  const bracketed = /^(\[[^\]]+\])(?::\d+)?$/.exec(host);
  if (bracketed?.[1]) return bracketed[1];
  return host.replace(/:\d+$/, '');
}

/** The shared write-side half of BOTH ui-state routes (per-repo `/api/v1/ui-state`
 *  and workspace `/api/v1/workspace/ui-state`) — the factored split the
 *  multi-project spec calls for instead of a copy: the route's own schema, plus a
 *  cap on the top-level key count so a `.passthrough()` schema can't accumulate an
 *  unbounded key set (#429). The cap rides as a refinement so the whole thing is one
 *  schema and can go through `jsonBody` like every other mutating route. The
 *  merge-on-write stays with each route (they write different files) but is shallow
 *  in both. */
function capUiStateKeys(data: unknown, ctx: z.RefinementCtx): void {
  if (Object.keys(data as Record<string, unknown>).length > UI_STATE_MAX_KEYS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `ui-state has too many keys (max ${UI_STATE_MAX_KEYS})` });
  }
}

// Derived once per route instead of by a generic `wrap(schema)` helper called at the route: a
// generic wrapper leaves the schema type unresolved where `jsonBody` needs it, and Hono answers
// that by dropping the whole PUT from the route schema rather than erroring — both ui-state PUTs
// silently vanished from `AppType`. Concrete consts keep them visible to `hc`.
const uiStateBody = uiStateSchema.superRefine(capUiStateKeys);

/**
 * Query schemas for the READ routes — deliberately permissive.
 *
 * These exist to make a query key VISIBLE to the route type (`hc` refuses a `query` argument for
 * a key no validator declares), NOT to narrow what the route accepts. Every one of these handlers
 * compares `=== '1'` and treats everything else as false, so `?refresh=0` is a successful request
 * today; a literal schema would silently turn it into a 400. The comparison stays in the handler
 * and the validator stays out of its way.
 *
 * The one route that really is strict on the wire — `GET /github/prs/:number/changes`, which 400s
 * on `?refresh=true` — keeps its own `z.enum(['1'])` schema next to the route.
 */
/**
 * One query value, matching what `c.req.query('k')` did before these routes were validated.
 *
 * Hono's query validator hands a REPEATED key as an array (`?wait=1&wait=1` → `['1','1']`), where
 * `c.req.query()` silently took the first. A plain `z.string()` therefore turns a request that
 * used to answer 200 into a 400 — a wire change no caller asked for. Collapsing to the first
 * value keeps the old behaviour, and the client still sees a plain `key?: string`.
 */
const queryValue = z.union([z.string(), z.array(z.string()).transform((v) => v[0] as string)]).optional();

const refreshQuery = z.object({ refresh: queryValue });
const waitQuery = z.object({ wait: queryValue });

/**
 * HTTP content negotiation for the two routes that serve more than one FORMAT on one path:
 * `GET /repo/commit/:sha` (a structured payload or the legacy text blob) and
 * `GET /runs/:id/files` (a JSON listing/metadata or an image file's BYTES).
 *
 * ## Precedence — flag, then Accept, then the route's own default
 *
 * 1. **The query flag wins whenever the request carries it.** `?structured=1` and `?raw=1` are the
 *    live wire and a protected surface (BACKWARD_COMPATIBILITY.md §2); `Accept` is ADDITIVE and
 *    may never override a caller that said what it wanted in the URL. The flag counts as "carried"
 *    when the key is PRESENT, so `?raw=0` is an explicit opt-out of the raw representation and not
 *    an invitation to re-decide from a header.
 * 2. **Otherwise the best `Accept` match** among the representations that route offers.
 * 3. **Otherwise the route's established default** — the text blob for `/repo/commit/:sha`, the
 *    JSON listing for `/runs/:id/files` — i.e. exactly what a pre-Accept client received.
 *
 * `*<slash>*` matches NOTHING here, deliberately: it is what `fetch`, `curl` and XHR send when
 * they have no preference at all, and treating "anything" as a preference would silently change
 * the default representation of both routes for every existing caller. A browser that navigates to
 * a worktree image DOES get the bytes, because its `Accept` really does ask for `image/*` at q=1 —
 * the same protections ride along (image extensions only, size cap, `nosniff`, sandbox CSP).
 *
 * Both routes answer `Vary: Accept`, since a cache that ignored the header would serve one
 * representation for the other.
 */
type MediaRange = { type: string; subtype: string; q: number };

function parseAccept(header: string): MediaRange[] {
  const ranges: MediaRange[] = [];
  for (const part of header.split(',')) {
    const [range = '', ...params] = part.split(';');
    const [type = '', subtype = ''] = range.trim().toLowerCase().split('/');
    if (type === '' || subtype === '') continue;
    const weight = params.map((p) => p.trim().toLowerCase()).find((p) => p.startsWith('q='));
    const parsed = weight === undefined ? 1 : Number.parseFloat(weight.slice(2));
    const q = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 1) : 0;
    if (q > 0) ranges.push({ type, subtype, q });
  }
  return ranges;
}

/**
 * The best of `offers` for this `Accept`, or `null` for "no preference expressed" — which is what
 * an absent header, a `*<slash>*`-only header and a header naming nothing on offer all mean, and
 * what leaves the caller on its route's default.
 *
 * `offers` is the server's own preference order: an offer may itself be a wildcard (`image/*`,
 * since the concrete image type is not known until the file is read), and equal q-values go to the
 * EARLIER offer, so each route lists its default representation first.
 */
function negotiate<O extends string>(accept: string | undefined, offers: readonly O[]): O | null {
  if (accept === undefined) return null;
  const ranges = parseAccept(accept);
  let best: { offer: O; q: number } | null = null;
  for (const offer of offers) {
    const [type = '', subtype = ''] = offer.split('/');
    let q = 0;
    for (const range of ranges) {
      if (range.type === '*' && range.subtype === '*') continue; // "anything" is not a preference
      const typeMatches = range.type === type || range.type === '*' || type === '*';
      const subtypeMatches = range.subtype === subtype || range.subtype === '*' || subtype === '*';
      if (typeMatches && subtypeMatches && range.q > q) q = range.q;
    }
    if (q > 0 && (best === null || q > best.q)) best = { offer, q };
  }
  return best?.offer ?? null;
}

/** What `GET /runs/:id/files` offers, DEFAULT FIRST. `image/*` rather than a concrete type: which
 *  image type the bytes are is only known once the path resolves, and the raw branch refuses
 *  everything that is not an image anyway. */
const FILE_FORMATS = ['application/json', 'image/*'] as const;

/** Workspace-root writability probe (multi-project spec, "API Contracts"):
 *  optional `mkdir -p`, `access W_OK`, then a real create/delete round-trip — W_OK alone
 *  can lie (e.g. a read-only mount still reports writable permission bits).
 *  Returns the failure message, or null when the directory is usable. */
async function probeWritableDir(dir: string, create: boolean): Promise<string | null> {
  const probe = join(dir, `.onni-write-probe-${process.pid}-${Date.now().toString(36)}`);
  try {
    if (create) await mkdir(dir, { recursive: true });
    const info = await stat(dir);
    if (!info.isDirectory()) return `${dir} is not a directory`;
    await access(dir, fsConstants.W_OK);
    await writeFile(probe, '', 'utf8');
    await unlink(probe);
    return null;
  } catch (err) {
    await unlink(probe).catch(() => {}); // best-effort if the round-trip half-succeeded
    return err instanceof Error ? err.message : String(err);
  }
}

// The return type is INFERRED on purpose: it is the chained app type built at the bottom of
// this function, and `AppType` (src/server/app-type.ts) is `ReturnType<typeof createApp>`.
// Annotating it `Hono` here would erase every route from the type and leave the typed client
// with nothing to offer. See the `routed` assembly at the end of the function.
export function createApp(deps: ServerDeps) {
  const { version, bindHost, bootProjectId } = deps;
  const env = deps.env ?? process.env;
  // Boot singletons keep DELIBERATELY distinct names (`boot*`): every
  // project-scoped handler must resolve its `{store, manager, root, dataDir,
  // launchKey}` from `c.get('project')` — a bare `store`/`repoRoot` in a
  // handler body would silently pin it to the boot project, which the rename
  // turns into a compile error instead.
  const bootRoot = deps.repoRoot;
  const bootDataDir = join(bootRoot, '.ai/onni');
  // Each adapter fingerprints the file its CLI runs, so a CLI update invalidates the cached
  // catalog at once instead of leaving the picker on the old model list until the TTL expires.
  const modelCatalog = deps.modelCatalog ?? new RunnerModelCatalog({
    adapters: {
      claude: {
        discover: () => discoverClaudeModels({ cwd: bootRoot }),
        fingerprint: () => programFingerprint(resolveClaudeExecutable()),
      },
      codex: {
        discover: () => discoverCodexModels({ cwd: bootRoot }),
        fingerprint: () => programFingerprint(resolveCodexExecutable()),
      },
      opencode: {
        discover: () => discoverOpencodeModels({ cwd: bootRoot }),
        fingerprint: () => programFingerprint(resolveOpencodeExecutable()),
      },
      junie: {
        discover: () => discoverJunieModels({ cwd: bootRoot }),
        fingerprint: () => programFingerprint(resolveJunieExecutable()),
      },
      cursor: {
        discover: () => discoverCursorModels(),
        fingerprint: () => programFingerprint(resolveCursorAgentBin()),
      },
      antigravity: {
        discover: () => discoverAntigravityModels(),
        fingerprint: () => programFingerprint(resolveAntigravityExecutable()),
      },
      pi: {
        discover: () => discoverPiModels({ cwd: bootRoot }),
        fingerprint: () => programFingerprint(resolvePiExecutable()),
      },
    },
  });
  const providerAuth = deps.providerAuth
    ?? new ProviderAuthService({ cwd: bootRoot });
  const workspaceConfig = deps.workspaceConfig ?? {
    load: loadWorkspaceConfig,
    mergeWrite: mergeWriteWorkspaceConfig,
  };
  const providerStatus = async (options?: { refresh?: boolean }): Promise<ProviderStatusResponse> => {
    if (providerAuthChecksDisabled()) {
      return applyProviderEnablement(
        await providerAuth.status(options?.refresh ? { refresh: true } : undefined),
        [],
      );
    }
    const [discovered, workspace] = await Promise.all([
      providerAuth.status(options?.refresh ? { refresh: true } : undefined),
      workspaceConfig.load(),
    ]);
    return applyProviderEnablement(discovered, workspace.disabledProviders);
  };
  /**
   * The gate: why a run cannot start against `required`, or null when it can.
   *
   * VERIFY BEFORE YOU REFUSE. Auth state is served stale-while-revalidate (see
   * `ProviderAuthService.status`), so a cached "disconnected" may predate a login onni could not
   * observe — someone running `claude auth login` in a terminal. Refusing on that would lock a user
   * out of their own cockpit with no way back but waiting. So a believed-unavailable provider is
   * re-probed, and only a refusal that survives the fresh answer is returned.
   *
   * The cost lands where it belongs: the common path (connected, warm) pays nothing at all, and the
   * probe is only spawned when onni is about to say no — a rare, interactive moment. This is also
   * what lets the cache hold a negative for a minute instead of five seconds, which is what made
   * every reader of `GET /providers/status` periodically pay for a CLI spawn.
   *
   * A runtime auth latch is deliberately NOT escaped by this: `withRuntimeFailures` keeps forcing
   * the row disconnected until the user acknowledges that exact incident, so the re-probe cannot
   * talk onni out of a rejection it actually observed.
   */
  const providerActionError = async (
    required: readonly ProviderId[],
    scope: ProviderAccountScope = {},
  ): Promise<string | null> => {
    // Judge the account the action runs on, not only the default login (telemetry ac53a6ef).
    const judged = async (refresh: boolean): Promise<ProviderStatusResponse> => {
      const rows = await providerStatus(refresh ? { refresh: true } : undefined);
      return providerAuthChecksDisabled()
        ? rows
        : withSelectedAccounts(rows, required, scope, providerAuth, { refresh });
    };
    const known = await judged(false);
    const message = unavailableProviderMessage(required, known);
    if (message === null) return null;
    // A DISABLED provider is a settings fact, not a probe result — re-probing it learns nothing and
    // would spawn a CLI to re-read something the user typed.
    const disabled = required.some((provider) =>
      known.providers.find((row) => row.provider === provider)?.enabled === false);
    if (disabled) return message;
    return unavailableProviderMessage(required, await judged(true));
  };
  const openTerminal = deps.openTerminal ?? openInTerminal;
  const openFile = deps.openFile ?? openFileInDefaultApp;
  const openApp = deps.openApp ?? openInApp;

  // ---- workspace boot-project identity (multi-project spec) ----------------
  // The boot flow (`initWorkspace` in src/index.ts) registers the boot repo
  // and plumbs its registry id in via `deps.bootProjectId`. Legacy callers and
  // tests construct the app without one — then it is derived lazily from the
  // registry by realpath and cached on a hit. A boot repo that is not in the
  // registry — a task worktree, `$HOME`, an unreadable workspace, or (since
  // boot registration became seed-once) any folder started in while the user
  // already has projects — falls back to its would-be slug, so `bootProject`
  // always names the repo this server was started in. Strictly non-fatal,
  // zero-config: every failure path degrades to the slug fallback, never an
  // error.
  //
  // BOTH answers are sticky for the process. The registry hit caches for the
  // obvious reason; the FALLBACK caches because it is a live URL the cockpit
  // is showing, and it is derived from a file the user edits while the server
  // runs — recomputing it per call let an unrelated `Add project` with the
  // same basename take the slug and silently move the boot project to
  // `<slug>-2` under an open tab. The registry lookup still runs first, so the
  // day the boot folder IS registered (its own "Add project"), its real id
  // takes over from the fallback rather than the two disagreeing; the reserved
  // slug below is what keeps those two the same string.
  //
  // Sticky, but never at the cost of correctness: a pinned fallback that some
  // OTHER root has since taken (an out-of-band `onni projects add ~/other/beta`
  // from a second process, where the reservation cannot reach) is dropped and
  // re-allocated. That gives back the visible `<slug>-2` move instead of
  // shadowing — the scope resolver binds `/p/<bootProject>/` to the boot
  // context before it consults the registry, so keeping the stolen slug would
  // quietly serve the boot folder under a sidebar row pointing somewhere else.
  let bootProjectCache = bootProjectId;
  let bootProjectFallback: string | undefined;
  const resolveBootProject = async (projects?: readonly WorkspaceProject[]): Promise<string> => {
    if (bootProjectCache) return bootProjectCache;
    let registry = projects ?? [];
    try {
      registry = projects ?? (await loadWorkspaceConfig()).projects;
      const real = await realpath(bootRoot).catch(() => bootRoot);
      const match = registry.find((p) => p.root === real || p.root === bootRoot);
      if (match) bootProjectCache = match.id;
      else if (bootProjectFallback !== undefined
        && registry.some((project) => project.id === bootProjectFallback)) {
        bootProjectFallback = undefined;
      }
    } catch {
      // unreadable workspace — fall through to the slug fallback below
    }
    if (bootProjectCache) return bootProjectCache;
    bootProjectFallback ??= allocateProjectSlug(bootRoot, registry.map((project) => project.id));
    return bootProjectFallback;
  };
  // Health's workspace garnish: id+name ONLY — never `root` (#431, see the
  // health route). Reads only the registry file; no per-root status probes,
  // so health stays cheap enough for the bookmarklet's 800 ms port sweep.
  const workspaceSummary = async (): Promise<{
    projects: { id: string; name: string }[];
    bootProject: string;
  }> => {
    try {
      const registry = (await loadWorkspaceConfig()).projects;
      const bootProject = await resolveBootProject(registry);
      const visible = capabilities().singleProject
        ? registry.filter((project) => project.id === bootProject)
        : registry;
      return {
        // Explicit picks, not a spread: the registry schema passes unknown
        // keys through, and `root` must never ride along onto health.
        projects: visible.map((p) => ({
          id: p.id,
          name: p.name || basename(p.root),
        })),
        bootProject,
      };
    } catch {
      return { projects: [], bootProject: await resolveBootProject([]) };
    }
  };
  // Hosted-mode gate (spec §"Deployment modes") — read per request so
  // ONNI_REMOTE flips take effect live (and tests can toggle it).
  const trackers = createTrackerService();
  const trackerWatches = new TrackerWatches(trackers, deps.socketHub);
  const capabilities = () => resolveCapabilities(env, bindHost);
  // The task terminal's registry (spec `2026-10-07-task-workspace` §6): one per server, because a
  // shell outlives the request that opened it and belongs to the host, not to a project context.
  const detectedUrls = new DetectedUrls();
  const terminalSessions = deps.terminalSessions ?? new TerminalSessions(undefined, detectedUrls);
  deps.onDispose?.(() => terminalSessions.closeAll());
  /** Stop a task's shells, their process trees and the addresses they printed (archive + delete). */
  const stopTaskProcesses = (runId: string) => {
    for (const session of terminalSessions.listFor(runId)) terminalSessions.kill(session.id);
    detectedUrls.forget(runId);
  };
  const singleProjectRefusal = (
    action: 'adding projects' | 'editing projects' | 'removing projects' | 'folder browsing',
  ) => ({ error: `single-project mode is enabled; ${action} is disabled` });
  // Inbox live updates (spec 007). Opt-in (#471): no capability, no watcher —
  // and since step 2.3 the per-dataDir watch is created lazily by the first
  // SSE subscription (and torn down with the last), nothing to start here.

  // ---- project contexts (multi-project spec, step 2.2) ---------------------
  // The boot project's context is SEEDED from the deps the caller already
  // built (src/index.ts `serveCommand` did the recover/prune/launch-key work
  // at startup — observable boot behavior unchanged); it never enters the
  // lazy map, so its `.ai/onni` state is never double-opened. `id` starts as
  // the reserved alias when registration was suppressed — handlers never read
  // it; API payloads name the boot project via `resolveBootProject` instead.
  const bootContext: ProjectContext = {
    id: bootProjectId ?? 'default',
    root: bootRoot,
    dataDir: bootDataDir,
    store: deps.store,
    manager: deps.manager,
    automationStore: deps.automationStore ?? AutomationStore.open(bootDataDir),
    launchKey: ensureLaunchKey(bootDataDir), // bookmarklet auto-start secret (spec 011)
  };
  // Non-boot projects build lazily on first scoped request; their managers
  // count against the same workspace semaphore as the boot manager (step 2.5).
  const contexts = deps.contexts ?? new ProjectContexts({
    listProjects: async () => {
      const selector = capabilities().singleProject
        ? { projectId: await resolveBootProject() }
        : undefined;
      return listProjects(selector);
    },
    semaphore: deps.semaphore,
  });
  const webhooks = deps.webhooks ?? (webhooksEnabled() ? new WebhookCoordinator({
    mode: () => capabilities().localHandoff ? 'local' : 'hosted',
    ports: () => [deps.webhookPort ?? 4321, ...listServerInstances().map(instance => instance.state.primaryPort)],
    projects: async () => listProjects(capabilities().singleProject ? { projectId: await resolveBootProject() } : undefined),
    dryRun: process.env.ONNI_DRY_RUN === '1',
  }) : undefined);
  const offWebhookPrepare = contexts.onBeforeRecover(async context => {
    await webhooks?.attach(context, context.id, false);
    return () => webhooks?.detach(context);
  });
  const offWebhookReady = contexts.onContextBuilt(context => webhooks?.ready(context.root, context));
  deps.onDispose?.(() => { offWebhookPrepare(); offWebhookReady(); void webhooks?.dispose(); });
  const webhookRoutes = createWebhookRoutes(async context => {
    if (!webhooks) throw new Error('Webhook service is unavailable');
    const id = context === bootContext ? await resolveBootProject() : context.id;
    await webhooks.attach(context, id, true, context === bootContext);
    return webhooks.get(id, context.root, context === bootContext);
  });
  // Production injects the observer before boot recovery; embedded callers attach before serving.
  if (webhooks) void resolveBootProject().then(id => webhooks.attach(bootContext, id, true, true)).then(() => { if (deps.webhookPort !== undefined) webhooks.start(); });
  // Workspace-level SSE bus (step 2.8) — the registry mutators and the
  // checkout flow (Phase 4) emit here; /api/workspace/events relays.
  const workspaceEvents = deps.workspaceEvents ?? new WorkspaceEventBus();
  const emitAutomationChange = (
    project: ProjectContext,
    automationId: string,
    revision: number,
    deleted = false,
  ) => workspaceEvents.emit('automation-change', {
    project: project.id,
    automationId,
    revision,
    ...(deleted ? { deleted: true } : {}),
  });
  const automationsChanged = () => deps.automationsChanged?.();

  const providerRuntimeAuth = deps.providerRuntimeAuth
    ?? new ProviderRuntimeAuthObserver(providerAuth, (status) => {
      workspaceEvents.emit('provider-status', status);
    });

  providerRuntimeAuth.watch(bootContext.store);
  for (const id of contexts.ids()) {
    const ctx = contexts.peek(id);
    if (ctx) providerRuntimeAuth.watch(ctx.store);
  }
  contexts.onStoreCreated((store) => providerRuntimeAuth.watch(store));
  contexts.onContextBuilt((ctx) => providerRuntimeAuth.watch(ctx.store));

  const app = new Hono();

  // Hono's default 500.
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    console.error(err);
    return c.text('Internal Server Error', 500);
  });

  // Reject oversized request bodies before they reach any handler (#429). GETs
  // and SSE carry no body, so this only ever gates the mutating routes.
  app.use('*', bodyLimit({ maxSize: GLOBAL_BODY_LIMIT }));

  // ---- request-origin guard (#426) -----------------------------------------
  // This server executes agents with shell access — "start a task" ≈ run code
  // as the user — so "bind 127.0.0.1 + same-origin" is not a perimeter on its
  // own: any page the user visits can still POST to us (CSRF), and DNS
  // rebinding can point a foreign domain at loopback and read our responses.
  // Two zero-config checks close both holes on every /api route EXCEPT
  // /api/v1/health (the intentional cross-origin discovery endpoint, spec 011 —
  // it exposes nothing sensitive, see #431):
  //   1. Host allowlist (loopback deployments only) — a request whose Host is
  //      not a loopback name did not really originate from this machine. A
  //      rebound `evil.com` still sends `Host: evil.com`, so this kills DNS
  //      rebinding for reads AND writes. Skipped in hosted mode (ONNI_REMOTE /
  //      non-loopback bind), where the reverse proxy forwards the real public
  //      Host and TLS+auth own the perimeter.
  //      The match runs through `isLoopbackHostHeader`, whose 127.0.0.0/8 test
  //      is *anchored* and whose missing-Host answer is "untrusted". Both are
  //      load-bearing: a `startsWith('127.')` prefix would accept the
  //      attacker-registrable `127.0.0.1.evil.com`, and such a page is really
  //      same-origin with us, so checks 2 and 3 would wave it through too.
  //   2. Same-origin write guard — a cross-origin write always carries an
  //      `Origin` header (browsers attach it to every non-GET), so its full
  //      authority (host AND port) must match the served Host. A blind CSRF
  //      POST from evil.tld is rejected; the cockpit's own same-origin fetch
  //      (Origin === Host, or no Origin at all for non-browser callers) passes
  //      untouched. Works in both local and hosted mode because it compares
  //      Origin to the actual Host.
  // Scope note: check 2 covers writes only. A cross-origin GET from any site
  // still reaches the read routes — but its Host is ours, so it is a *forced
  // request*, not a read: the same-origin policy stops the attacker seeing any
  // response body (we send CORS headers on /api/v1/health alone), and no GET
  // handler mutates state. Rebinding, which WOULD make those reads legible, is
  // what check 1 stops.
  const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  const isHostedMode = () => !resolveCapabilities(env, bindHost).localHandoff;
  app.use('/api/*', async (c, next) => {
    const hostName = hostnameOfHost(c.req.header('host'));
    // Strict twin of `isLoopbackHost`: a *missing* Host is untrusted here (an
    // absent header is not the "we defaulted to the loopback bind" case), and
    // the loopback match is anchored so `127.0.0.1.evil.com` does not pass.
    if (!isHostedMode() && !isLoopbackHostHeader(hostName)) {
      return c.json(
        {
          error: 'forbidden: unexpected Host header — this request did not originate from this machine (see #426)',
        },
        403,
      );
    }

    // /api/v1/health stays CORS-open for cross-origin discovery, but its Host is
    // still checked above: cross-origin is legitimate, DNS rebinding is not. The
    // path is spelled through V1_PREFIX rather than inline — an unversioned
    // literal here silently stopped matching when the API moved and left health
    // relying on the mutating-methods gate below to let its GETs through.
    if (c.req.path === `${V1_PREFIX}/health`) return next();

    if (MUTATING_METHODS.has(c.req.method)) {
      const origin = c.req.header('origin');
      if (origin !== undefined) {
        const originHost = hostnameOfOrigin(origin);
        // Compare the whole authority, not just the hostname: a different PORT
        // is a different web origin, and on a dev machine `http://localhost:3000`
        // is every bit as foreign as `https://evil.tld`. Matching on hostname
        // alone would let any page served from another loopback port (a local
        // dev server rendering attacker content, an XSS in a local app) start a
        // shell-capable agent here.
        const sameOrigin = !!originHost && authorityOfOrigin(origin) === authorityOfHost(c.req.header('host'));
        // The one legitimate cross-port case is the `npm run dev` Vite proxy:
        // the browser fetches same-origin from `localhost:5173`, Vite's
        // `changeOrigin` rewrites Host to `127.0.0.1:<api port>` but forwards
        // the original Origin, so the authorities no longer line up. The browser
        // already told us what it thinks: `Sec-Fetch-Site: same-origin` is a
        // forbidden header name that page JS cannot set, and a cross-port
        // attacker page gets `same-site`, never `same-origin`. Requiring it
        // (plus loopback on both ends) readmits the proxy without readmitting
        // the attack. Browsers too old to send Sec-Fetch metadata simply fail
        // closed here — they still work against a non-proxied cockpit.
        const isDevProxy =
          c.req.header('sec-fetch-site') === 'same-origin' &&
          isLoopbackHostHeader(originHost) &&
          isLoopbackHostHeader(hostName);
        if (!sameOrigin && !isDevProxy) {
          return c.json(
            {
              error: 'forbidden: cross-origin request rejected (same-origin only)',
            },
            403,
          );
        }
      }
      // Belt-and-suspenders for browsers that send Sec-Fetch metadata: an
      // explicit cross-site marker is rejected regardless of the Origin dance.
      if (c.req.header('sec-fetch-site') === 'cross-site') {
        return c.json(
          {
            error: 'forbidden: cross-site request rejected (same-origin only)',
          },
          403,
        );
      }
    }
    return next();
  });

  // The mirrored project-route table (spec "API Contracts → Project-scoped").
  // Every route below registers ONCE on this sub-app; `createApp` mounts it
  // twice — under `/api/v1/p/:projectId` (scoped) and under `/api/v1` (bound to
  // the boot project) — so both spellings share one handler and can never
  // drift. The resolver middleware binds `c.get('project')`:
  // no `projectId` param (unscoped mount) → the boot context, byte-identical to
  // the pre-workspace closures; `default` or the boot project's own id → the
  // boot context too; anything else → the lazy context map, with
  // `ProjectContextError` mapped to 404 (unknown) / 409 (missing root).
  // Named rather than inlined because both mounts share it — one function, so
  // the two spellings can never disagree about what `default` means.
  const resolveProjectScope = async (c: Context<ProjectApiEnv>, next: Next): Promise<Response | void> => {
    const raw = c.req.param('projectId');
    if (raw === undefined) {
      c.set('project', bootContext);
      return next();
    }
    if (!projectIdSchema.safeParse(raw).success) {
      return c.json({ error: `unknown project: ${raw}` }, 404);
    }
    if (raw === 'default' || raw === (await resolveBootProject())) {
      c.set('project', bootContext);
      return next();
    }
    // Enforce the scope before opening a context: production and embedded
    // callers can inject an unfiltered context provider. Hiding registry rows
    // alone must not allow a direct URL to recover or mutate another project.
    if (capabilities().singleProject) {
      return c.json({ error: `unknown project: ${raw}` }, 404);
    }
    try {
      c.set('project', await contexts.context(raw));
    } catch (err) {
      if (err instanceof ProjectContextError) {
        return err.reason === 'missing-root'
          ? c.json({ error: `project folder not found: ${err.projectId}` }, 409)
          : c.json({ error: err.message }, 404);
      }
      throw err;
    }
    return next();
  };

  // ---- static GUI ----------------------------------------------------------
  const webDir = resolveWebDir();
  const distDir = join(webDir, 'dist');
  const HTML_TYPE = 'text/html; charset=utf-8';
  const staticFile = (name: string, type: string) => (c: Context): Response => {
    // Read per request — the files are tiny and this keeps dev iteration live.
    //
    // Served out of the Vite build: the file is a `public/` asset of the web package, which the
    // build copies verbatim into `web/dist`. One home, one URL — the same bytes this route
    // hands out are what the bundle's own `<img src="/icon.svg">` asks for.
    // Without a build there is nothing to serve, which is a 404 rather than a crash (the shell
    // route answers the same dev-only state with its build hint).
    const path = join(distDir, name);
    if (!existsSync(path)) return c.json({ error: 'not found' }, 404);
    return new Response(readFileSync(path), { headers: { 'content-type': type } });
  };

  let hintLogged = false;
  const serveShell = (c: Context): Response | undefined => {
    const distIndex = join(distDir, 'index.html');
    // existsSync per request, like the reads below: `npm run build:web` in a
    // running cockpit takes effect on the next reload, no restart. That promise
    // only reaches a DEVICE if the shell says it may not be reused without
    // asking (SHELL_CACHE_CONTROL) — the assets it names are immutable, so one
    // cached shell pins an entire stale cockpit. Both responses carry it: the
    // hint page becomes the app the moment the build lands.
    const target = resolveGetRequest({
      path: c.req.path,
      distExists: existsSync(distIndex),
    });
    if (target === 'passthrough') return undefined;
    if (target === 'build-hint') {
      // Dev-only state (the tarball ships web/dist): serve the built-in hint
      // page instead of the app — the legacy fallback UI was deleted in R7.
      if (!hintLogged) {
        hintLogged = true;
        console.log('onni: web/dist is missing — run `npm run build:web` to build the cockpit');
      }
      return new Response(BUILD_HINT_HTML, {
        headers: { 'content-type': HTML_TYPE, 'cache-control': SHELL_CACHE_CONTROL },
      });
    }
    return new Response(readFileSync(distIndex), {
      headers: { 'content-type': HTML_TYPE, 'cache-control': SHELL_CACHE_CONTROL },
    });
  };

  // Hashed bundles/fonts of the built app. Vite fingerprints every name, so
  // the bytes behind a URL never change — cache them hard. Only plain
  // filenames are served: `basename('..')` is `'..'` (it resolves to the
  // assets dir itself and readFileSync would throw EISDIR), so dot-segments
  // and separator-bearing params get a 404, not a 500.
  app.get('/assets/:file', (c) => {
    const file = c.req.param('file');
    if (!isSafeAssetFilename(file)) return c.json({ error: 'not found' }, 404);
    const path = join(distDir, 'assets', file);
    if (!existsSync(path) || !statSync(path).isFile()) return c.json({ error: 'not found' }, 404);
    return new Response(readFileSync(path), {
      headers: {
        'content-type': assetContentType(file),
        'cache-control': ASSET_CACHE_CONTROL,
      },
    });
  });

  // The favicon packages/web/index.html points at (`/icon.svg`).
  app.get('/icon.svg', staticFile('icon.svg', 'image/svg+xml'));
  // Compatibility alias for the pre-rename public URL (BACKWARD_COMPATIBILITY.md §2).
  app.get('/onni.svg', staticFile('icon.svg', 'image/svg+xml'));

  // ---- meta ----------------------------------------------------------------
  // CORS — deliberately for /api/health ONLY (spec 011): the bookmarklets
  // fetch it cross-origin from github.com to discover which local ports run a
  // cockpit and which repo each serves. Health exposes no secrets beyond the
  // repo path/remote; every other endpoint stays same-origin.
  const healthCors = async (c: Context, next: Next): Promise<Response | void> => {
    c.header('access-control-allow-origin', '*');
    if (c.req.method === 'OPTIONS') {
      // Preflight (e.g. Chrome Private Network Access) — allow the plain GET.
      c.header('access-control-allow-methods', 'GET');
      c.header('access-control-allow-private-network', 'true');
      return c.body(null, 204);
    }
    await next();
  };
  app.use(`${V1_PREFIX}/health`, healthCors);
  // One builder for both transports: `GET /api/health` (the authoritative,
  // CORS-open discovery endpoint) and the `health` topic on `/api/v1/ws` below
  // push the byte-identical shape, so the two can never drift.
  // Deliberately UNANNOTATED: this literal is the source of the `/health` shape. Annotating it
  // with the api-client's `HealthResponse` made the contract circular — the DTO was declared by
  // hand, the handler was checked against it, and `AppType` then reported the hand-written type
  // back as if the server had proven it. Inferring here means the route says what it actually
  // sends, which is what lets the DTO be derived instead of maintained.
  const healthSnapshot = async () => {
    const [checks, repo, config, workspace] = await Promise.all([
      detectEnvironment(),
      getRepoInfo(bootRoot),
      loadConfig(bootRoot),
      workspaceSummary(),
    ]);
    // Additive fields only below — the pre-forge shape is the most
    // externally-depended-on JSON in the app (BACKWARD_COMPATIBILITY.md §2).
    const forge = resolveForge(repo);
    const caps = capabilities();
    return {
      version,
      // Health is CORS-open and, in hosted mode, reachable off the loopback —
      // so any site/host that reads it would learn the developer's absolute
      // checkout path and username (#431). Local mode keeps the full path (the
      // protected bookmarklet shape); hosted/remote mode trims it to a basename.
      // NB this narrows the VALUE of a field named in BACKWARD_COMPATIBILITY.md
      // §2: the field is always present and a string, but under ONNI_REMOTE it is
      // no longer an absolute path. Deliberate — a hosted cockpit's paths are on
      // a machine the reader does not have anyway. See §2's `repoRoot` note.
      repoRoot: caps.localHandoff ? bootRoot : basename(bootRoot),
      repo,
      checks,
      defaultRunner: config.defaultRunner,
      // Non-blocking: cached availability or null-until-warm — health must never pay a `gh`
      // shell-out (the bookmarklet aborts its port probe at 800 ms). See detectGithubCached.
      forge: forge ? { kind: forge.kind, ...(forge.detectCached() ?? {}) } : null,
      capabilities: caps,
      // Workspace enumeration (multi-project spec) — additive, id+name ONLY.
      // NEVER `projects[].root` here: health is the one CORS-open route, and
      // the repoRoot trim above exists precisely to keep absolute paths and
      // usernames away from cross-origin readers (#431) — per-project roots
      // would reintroduce that leak once per registered project. Absolute
      // roots live on the same-origin GET /api/projects instead. An
      // unreadable workspace degrades to `projects: []`.
      projects: workspace.projects,
      bootProject: workspace.bootProject,
      ...(process.env.ONNI_INSTANCE_ID ? { instanceId: process.env.ONNI_INSTANCE_ID } : {}),
      ...diskHealth(bootRoot),
    };
  };
  // ---- server-side health cache (stale-while-revalidate) -------------------
  // The snapshot is expensive: ~0.8 s of agent-CLI `--version` probes plus
  // ~0.4 s of git. Paying that on the browser's FIRST `GET /api/health` is
  // exactly the few-seconds-blank the cockpit showed at load. So on the live
  // server the snapshot is computed at the server's OWN pace: both the GET and
  // the WS `health` topic serve the cached value immediately and revalidate
  // behind the response, and the cache is pre-warmed at boot so that first
  // request lands on a warm value instead of the cold compute.
  const HEALTH_TTL_MS = 5_000;
  // The staleness CEILING, which is a different job from the TTL above. The TTL
  // decides how often a revalidation is kicked off; on its own it bounds nothing,
  // because the revalidation is fire-and-forget. While a cockpit holds the
  // `health` topic the publisher's interval keeps the cache warm and the two are
  // the same number — but the normal state of a background `onni serve` is NO
  // subscriber, and then nothing refreshes the cache at all: the next `GET
  // /api/health`, an hour later, would answer with the boot pre-warm's payload
  // and only the request AFTER it would see the truth. That endpoint is the
  // bookmarklet contract (BACKWARD_COMPATIBILITY.md §2, "the most
  // externally-depended-on JSON in the app") and `repo.branch` going stale is
  // literally #369, so past this age correctness beats the latency win and the
  // read waits for the compute. `refreshHealth` dedupes, so waiting costs one.
  const HEALTH_MAX_STALE_MS = 60_000;
  /** Whatever `healthSnapshot` actually returns — see the note there. */
  type HealthPayload = Awaited<ReturnType<typeof healthSnapshot>>;
  let healthCache: { at: number; payload: HealthPayload; body: string } | undefined;
  let healthInFlight: Promise<HealthPayload> | undefined;
  // Set while the topic has a subscriber; a change a refresh detects is pushed
  // here (a noop when nobody is listening).
  let publishHealth: (data: unknown) => void = () => {};

  const refreshHealth = (): Promise<HealthPayload> => {
    // Dedupe: a GET's background revalidation and the topic's interval tick
    // share ONE compute (and one set of CLI spawns) rather than racing two.
    if (healthInFlight) return healthInFlight;
    healthInFlight = (async () => {
      try {
        const payload = await healthSnapshot();
        const body = JSON.stringify(payload);
        const changed = body !== healthCache?.body;
        healthCache = { at: Date.now(), payload, body };
        if (changed) publishHealth(payload); // only a real change reaches the wire
        return payload;
      } finally {
        healthInFlight = undefined;
      }
    })();
    return healthInFlight;
  };

  // The read the GET and the topic snapshot share. On the live server (a hub is
  // injected) it answers from cache instantly and revalidates behind the
  // response; without a hub — a bare app in tests — there is no refresher
  // keeping a cache coherent, so it computes fresh, exactly as before.
  const readHealth = async (): Promise<HealthPayload> => {
    if (!deps.socketHub) return healthSnapshot();
    if (!healthCache) return refreshHealth(); // first ever: nothing to serve yet
    const age = Date.now() - healthCache.at;
    if (age > HEALTH_MAX_STALE_MS) return refreshHealth(); // too old to serve — wait for the truth
    if (age > HEALTH_TTL_MS) void refreshHealth(); // stale: refresh, don't wait on it
    return healthCache.payload;
  };

  const healthRoutes = createHealthRoutes({ readHealth });

  // The push twin of the poll it replaced (#369): while at least one cockpit
  // holds the `health` topic the server re-reads the snapshot on the old 5 s
  // cadence and broadcasts ONLY when it changed — a `git checkout` in a
  // terminal reaches every open tab within a tick — and an idle workspace (no
  // subscriber) runs no timer. Nothing server-side watches `.git/HEAD`, so the
  // interval stays the honest mechanism; it just lives behind the socket now
  // instead of N tabs × 5 s HTTP polls. Every tick and every subscriber read
  // goes through the cache above, so N subscribers still cost one compute.
  deps.socketHub?.registerTopic(
    'health',
    {
      snapshot: readHealth,
      start: (publish) => {
        publishHealth = publish;
        const timer = setInterval(() => void refreshHealth(), HEALTH_TTL_MS);
        timer.unref?.();
        return () => {
          clearInterval(timer);
          publishHealth = () => {};
        };
      },
    },
    // health IS the CORS-open discovery payload (#431), so it is the one topic
    // safe for any local page — including a cross-port page admitted by the
    // loopback fallback on a no-Sec-Fetch browser. Every other (future) topic
    // keeps the default: trusted connections only.
    { loopbackReadable: true },
  );
  // Pre-warm on the live-server path only (startServer injects the hub; a bare
  // app in tests does not, so tests never spawn the probes here): the cache
  // fills while the browser is still downloading the bundle, so its first
  // `GET /api/health` reads a warm value instead of the cold ~1 s compute.
  if (deps.socketHub) void refreshHealth();
  // The Machine card's live channel (spec `.ai/specs/2026-09-20-host-resource-telemetry.md`):
  // demand-driven like every topic — the sampler's timer starts on 0→1 and stops on 1→0, so an
  // idle workspace pays nothing — and trusted-only by the DEFAULT options, deliberately: unlike
  // health this is not a discovery payload, so a foreign local page admitted by the loopback
  // fallback must not be able to read which machine it is sitting on.
  const hostSampler = deps.hostSampler ?? hostUsageSampler;
  deps.socketHub?.registerTopic('host', {
    snapshot: async () => hostSampler.sampleHostUsage(),
    start: (publish) => hostSampler.onHostUsage(publish),
  });
  /**
   * Warm the whole of onni's agent knowledge — the three discovered defaults AND every extra
   * account — so no reader ever pays the first shell-out.
   *
   * Which login each agent is signed into is operating knowledge, not a settings-page detail: the
   * composer, the action gate, the accounts pane and every run resolution ask for it. So the server
   * learns it once, at boot, and keeps it (see the asymmetric cache lifetime in
   * `core/provider-auth.ts`); on-demand refresh rides on `?refresh=1` and on the explicit
   * invalidations — connect, repoint, remove, runtime rejection.
   *
   * Extra accounts are warmed ONE AT A TIME, after the defaults. Each is a CLI spawn, and a machine
   * with several accounts would otherwise fan out a spawn storm at exactly the moment the browser is
   * fetching the bundle; nothing is waiting on this, so sequential costs nothing that matters.
   *
   * Hosted mode warms only the defaults unless its operator explicitly enabled remote account
   * management; otherwise the agent-profiles family is refused there.
   */
  const warmAgentKnowledge = async (): Promise<void> => {
    await providerAuth.status().catch(() => {});
    if (!agentAccountsEnabled(process.env, bindHost)) return;
    const store = await loadAgentAccounts().catch(() => defaultAgentAccountStore());
    for (const account of listAgentProfiles(store, PROVIDER_IDS)) {
      if (account.isDefault) continue; // covered by `status()` above
      await providerAuth
        .profileStatus(account.provider, { id: account.id, configDir: account.path })
        .catch(() => {});
    }
  };
  // Same gate as `refreshHealth`, same reason (startServer injects the hub; a bare app in tests does
  // not, so tests never spawn probes here). Fire-and-forget: a probe that fails leaves that row
  // cold, which is exactly the state every reader already handles.
  if (deps.socketHub) void warmAgentKnowledge();

  const modelsRoutes = createModelsRoutes({ modelCatalog });

  /**
   * Resolve `profileId` (absent = the discovered default) into a concrete account for `provider`.
   *
   * A dangling id is an ERROR here rather than the silent fall-back to the default that run
   * resolution performs. The difference is who is asking: a run is replaying a stored reference
   * and the default is the only safe answer it can act on, whereas a route is answering a user
   * who just named an account — telling them "unknown account" is honest, and quietly connecting
   * or reporting on a different one is not.
   */
  const resolveWorkspaceProfile = async (
    provider: ProviderId,
    profileId?: string,
  ): Promise<{ profile: ResolvedAgentProfile } | { error: string }> => {
    if (profileId === undefined || profileId === DEFAULT_AGENT_ACCOUNT_ID) {
      return { profile: defaultAgentProfile(provider) };
    }
    let accounts: readonly AgentAccount[];
    try {
      accounts = (await loadAgentAccounts()).accounts;
    } catch {
      return { error: `unknown ${provider} account: ${profileId}` };
    }
    const stored = accounts.find((a) => a.id === profileId && a.provider === provider);
    if (!stored) return { error: `unknown ${provider} account: ${profileId}` };
    return { profile: resolveStoredProfile(stored) };
  };

  /**
   * The environment a terminal handoff must carry so the CLI lands on the right account.
   *
   * `profileId` is the one RECORDED on the step that owns the session, never the project's
   * current selection: `claude --resume <id>` reads `<configDir>/sessions`, so a handoff for a
   * run started on the work account and resumed after the project was switched back would find
   * nothing and silently open a fresh conversation.
   */
  const handoffEnv = async (
    provider: ProviderId,
    profileId: string | undefined,
  ): Promise<{ env: Record<string, string> } | { error: string }> => {
    const resolved = await resolveWorkspaceProfile(provider, profileId);
    if ('error' in resolved) {
      return { error: `this session belongs to an account that no longer exists (${profileId})` };
    }
    const { profile } = resolved;
    return { env: profile.isDefault ? {} : profileEnv(provider, profile.path) };
  };

  /** The copy-paste fallback shown when no terminal could be opened — same account, spelled for
   *  this platform's shell. `null` when the dir cannot be embedded safely, which is a refusal. */
  const handoffFallbackCommand = (cwd: string, command: string, env: Record<string, string>): string | null => {
    const prefixed = withEnvPrefix(command, env, process.platform);
    return prefixed === null ? null : `cd '${cwd}' && ${prefixed}`;
  };

  /** A project's realpath'd root, or null when the id is unknown. The boot project resolves to
   *  `bootRoot` even without a registry row — `resolveProjectScope` serves it the same way, and a
   *  repo booted into a non-empty registry is never registered (telemetry d81f8db7). */
  const projectRootFor = async (projectId: string): Promise<string | null> => {
    try {
      const registry = (await loadWorkspaceConfig()).projects;
      const registered = registry.find((p) => p.id === projectId)?.root;
      if (registered !== undefined) return registered;
      if (projectId !== 'default' && projectId !== (await resolveBootProject(registry))) return null;
      return await realpath(bootRoot).catch(() => bootRoot);
    } catch {
      return null;
    }
  };

  // ---- chained family: agent providers (workspace-level) ----
  // One watch per account: a second Connect restarts its schedule instead of doubling it.
  const loginWatches = new Map<string, () => void>();
  const watchOpenedLogin = (provider: ProviderId, profile: { id: string; isDefault: boolean; path: string | null }) => {
    const key = `${provider}\u0000${profile.id}`;
    loginWatches.get(key)?.();
    const check = async (): Promise<boolean> => {
      if (profile.isDefault) {
        const row = (await providerStatus({ refresh: true })).providers.find((candidate) => candidate.provider === provider);
        // The cockpit does not poll provider status, so the card learns about the login here.
        if (row?.status === 'connected') workspaceEvents.emit('provider-status', row);
        return row?.status === 'connected';
      }
      providerAuth.forgetProfileStatus(provider, profile.id);
      return (await providerAuth.profileStatus(provider, { id: profile.id, configDir: profile.path })).status === 'connected';
    };
    const cancel = watchLogin(check, () => {
      loginWatches.delete(key);
    }, deps.loginWatchOffsetsMs ?? LOGIN_WATCH_OFFSETS_MS);
    loginWatches.set(key, cancel);
  };

  const providersRoutes = createProvidersRoutes({
    providerAuth,
    providerStatus,
    workspaceConfig,
    workspaceEvents,
    agentAccountsEnabled,
    bindHost,
    capabilities,
    openTerminal,
    bootRoot,
    resolveWorkspaceProfile,
    watchOpenedLogin,
  });

  const workspaceBrowseRoot = async (): Promise<string> => {
    try {
      return (await loadWorkspaceConfig()).browseRoot;
    } catch {
      return defaultWorkspaceConfig().browseRoot;
    }
  };

  const agentProfilesRoutes = createAgentProfilesRoutes({
    providerAuth,
    providerStatus,
    capabilities,
    bindHost,
    workspaceBrowseRoot,
    bootRoot,
    resolveWorkspaceProfile,
    projectRootFor,
    openFile,
    openApp,
  });

  const projectsRoutes = createProjectsRoutes({
    capabilities,
    bootRoot,
    resolveBootProject,
    contexts,
    workspaceEvents,
    trackerWatches,
    stopTaskProcesses,
    webhooks,
    workspaceBrowseRoot,
    singleProjectRefusal,
    semaphore: deps.semaphore,
    cloneRunner: deps.cloneRunner,
    projectCommandRunner: deps.projectCommandRunner,
  });

  // ---- chained family: Design Mode (workspace-level) -----------------------
  // Spec `.ai/specs/2026-10-09-design-mode.md`. Single-mount: the proxy mirrors a loopback dev
  // server, which belongs to the machine, not to a project. The request's own `Host` is passed
  // as forbidden beside the body's cockpit origin (they differ under the Vite dev proxy), so
  // this server can never be mirrored.
  const designProxies = deps.designProxies ?? new DesignProxies();
  deps.onDispose?.(() => designProxies.closeAll());
  const previewRoutes = createPreviewRoutes({ capabilities, designProxies });

  const workspaceConfigRoutes = createWorkspaceConfigRoutes({
    manager: deps.manager,
    contexts,
    hostSampler,
    semaphore: deps.semaphore,
    probeWritableDir,
    uiStateBodyLimit: UI_STATE_BODY_LIMIT,
  });

  // Partial updates only — absent keys stay untouched. Bounds mirror the
  // workspace schema (src/workspace/config.ts, step 1.2) exactly, so a value
  // this route accepts can never be degraded away by the next load's `.catch`.
  const fsBrowseRoutes = createFsBrowseRoutes({
    browseDirectory,
    capabilities,
    queryValue,
    resolveBrowseRoot,
    singleProjectRefusal,
    workspaceBrowseRoot,
  });

  // ---- chained family: workflows (project-scoped) --------------------------
  // The factory returns one chain so Hono carries these routes into the typed client.
  const workflowsRoutes = createWorkflowsRoutes();

  // ---- chained family: plan (project-scoped) ----
  const planRoutes = createPlanRoutes({ providerActionError });

  // ---- GitHub automations --------------------------------------------------

  /**
   * One manual "test filter" check, in server memory only.
   *
   * Declared here rather than inferred from `contract/src/automations.ts`: the contract's
   * `automationCheckSchema` is checked against what this route ANSWERS
   * (`contract-parity.automations.test.ts`), and a schema that annotated the handler it is
   * compared with would be true by construction.
   */
  type ManualCheck = {
    id: string;
    automationId: string;
    mode: 'preview' | 'execute';
    status: 'queued' | 'running' | 'complete' | 'error';
    createdAt: string;
    completedAt?: string;
    matches?: number;
    truncated?: boolean;
    error?: string;
  };
  const manualChecks = new Map<string, ManualCheck>();

  /**
   * The automations gate (#801): with `ONNI_AUTOMATIONS` unset, every route of the feature
   * answers 409 before touching a store, a lease or GitHub.
   *
   * Written as MIDDLEWARE rather than a line in each handler so the family cannot drift: a route
   * added to either chain below inherits the gate from its path, where a per-handler check is one
   * omission away from an ungated endpoint.
   *
   * Registered against EXPLICIT paths, never `use('*')`. Both chains are mounted with
   * `.route('/', …)` alongside a dozen unrelated sub-apps, and `route()` re-registers a sub-app's
   * middleware under the mount prefix — so a `'*'` here would gate the entire `/api/v1` surface,
   * including `/health`. The two-line pairing (`/automations` and `/automations/*`) is what makes
   * a path match both the collection and everything under it.
   */
  /**
   * Enabling arms the kind (spec 2026-09-14): a poll establishes its current-time baseline
   * (existing records never launch); a schedule gets its next occurrence. Shared by create-with-
   * enable and the enable route.
   */
  const trackerTriggerIssue = async (project: ProjectContext, trigger: AutomationEditableBody['trackerTrigger']): Promise<string | null> => {
    if (!trigger) return 'Choose an event to finish configuring this automation';
    const driver = await trackers.driver(project.root, project.dataDir);
    if ('available' in driver) return driver.reason;
    if (JSON.stringify(driver.association) !== JSON.stringify(trigger.association)) return 'Tracker connection or scope changed; reload the event options';
    if (!driver.automationOptions) return 'This tracker does not support automation events';
    let options: Awaited<ReturnType<NonNullable<typeof driver.automationOptions>>>;
    try { options = await driver.automationOptions(); }
    catch { return 'Could not verify tracker event options. Check the connection and try again.'; }
    if (trigger.events.some(event => !options.events.includes(event))) return 'This tracker does not support the selected event';
    if (trigger.targetStatusIds?.some(id => !options.statuses.some(status => status.id === id))) return 'Unknown status in this tracker project';
    if (trigger.changedLabelIds?.some(id => !options.labels.some(label => label.id === id))) return 'Unknown label in this tracker project';
    return null;
  };

  const armAutomation = (store: AutomationStore, automation: AutomationDefinition): void => {
    const now = Date.now();
    if (isScheduleAutomation(automation)) {
      const next = nextOccurrence(automation.schedule, now, localTimeZone());
      store.setState(automation.id, (current) => ({
        ...current,
        revision: automation.revision,
        ...(next !== null ? { nextRunAt: new Date(next).toISOString() } : {}),
      }));
      return;
    }
    const baselineAt = new Date(now).toISOString();
    store.setState(automation.id, (current) => ({
      ...current,
      revision: automation.revision,
      baselineAt,
      checkpoint: undefined,
      cursor: { timestamp: baselineAt },
      nextCheckAt: new Date(now + (automation.intervalSeconds ?? 300) * 1_000).toISOString(),
    }));
    store.appendLog({ automationId: automation.id, revision: automation.revision, result: 'baseline', reason: 'Enabled from a current-time baseline; existing records were not launched.' });
  };

  /** The schedule runner's view of a project: the store, the zone, and a launcher onto its RunManager. */
  const scheduleHandle = (project: Parameters<typeof emitAutomationChange>[0]) => ({
    deferredHoldUntil,
    validateDeferred: (definition: Parameters<typeof validateDeferredBinding>[1]) => validateDeferredBinding(project.root, definition),
    deferredRunIds: async (id: string, ids: string[]) => project.store.listPersistedRuns().filter(r => ids.includes(r.id) && r.automationTrigger?.automationId === id).map(r => r.id),
    projectId: project.id,
    store: project.automationStore,
    timeZone: localTimeZone(),
    launch: (definition: Parameters<typeof launchScheduledRun>[0]['definition'], occurrence: Parameters<typeof launchScheduledRun>[0]['occurrence'], receiptId: string) =>
      launchScheduledRun({ root: project.root, manager: project.manager, store: project.store, definition, occurrence, receiptId, projectName: basename(project.root), timeZone: localTimeZone(), dispatchEnabled: capabilities().dispatch }),
    onChange: (automationId: string, revision: number) => emitAutomationChange(project, automationId, revision),
  });

  /** The runs the log rows name, with their dispatch children (spec 2026-09-14 § API). */
  const logRunsOf = (runStore: RunStore, records: ReadonlyArray<{ runId?: string }>) => {
    const runs: Record<string, { title: string; status: RunRecord['status']; costUsd?: number; children: Array<{ runId: string; kind?: NonNullable<RunRecord['dispatch']>['kind']; title: string; status: RunRecord['status']; costUsd?: number }> }> = {};
    const wanted = new Set(records.map((row) => row.runId).filter((id): id is string => typeof id === 'string'));
    if (!wanted.size) return runs;
    const all = runStore.listRuns();
    const showCost = capabilities().costMetrics;
    for (const run of all) {
      if (!wanted.has(run.id)) continue;
      const children = all
        .filter((child) => child.id !== run.id && child.dispatch?.rootRunId === run.id)
        .map((child) => ({
          runId: child.id,
          ...(child.dispatch?.kind ? { kind: child.dispatch.kind } : {}),
          title: child.title,
          status: child.status,
          ...(showCost && typeof child.costUsd === 'number' ? { costUsd: child.costUsd } : {}),
        }));
      runs[run.id] = {
        title: run.title,
        status: run.status,
        ...(showCost && typeof run.costUsd === 'number' ? { costUsd: run.costUsd } : {}),
        children,
      };
    }
    return runs;
  };

  /** An account named on save is checked like `POST /runs` checks one: the user just picked it, so
   *  a stale id is a 400. At launch a since-deleted id falls back to the default, as any stored
   *  reference does. */
  const automationAccountIssue = async (
    root: string,
    task: { runner?: ProviderId; agentProfile?: string },
  ): Promise<string | null> => {
    if (task.agentProfile === undefined) return null;
    const runner = task.runner ?? (await loadConfig(root)).defaultRunner;
    const account = await resolveWorkspaceProfile(runner, task.agentProfile);
    return 'error' in account ? account.error : null;
  };

  const requireAutomations = async (c: Context, next: Next) => {
    if (!capabilities().automations) return c.json({ error: AUTOMATIONS_OFF }, 409);
    await next();
  };

  // ---- chained family: GitHub automations (project-scoped) ----
  // Every handler below reads `c.get('project')` — the definitions, their runtime state and the
  // execution log are per-project files — so the family is project-scoped and mounted with the
  // rest of the mirrored table. The one exception is the manual-check read, which touches no
  // project at all; it is its own workspace-level family below.
  const automationsRoutes = new Hono<ProjectApiEnv>()
    .use('/automations', requireAutomations)
    .use('/automations/*', requireAutomations)
    .use('/automation-log', requireAutomations)
    .use('/automation-log/*', requireAutomations)
    .post('/deferred-start/options', jsonZodValidator(deferredOptionsInputSchema), async (c) => {
      return c.json(await deferredStartOptions(c.get('project').root, c.req.valid('json').task, capabilities().automations));
    })
    .post('/deferred-start/preview', requireAutomations, jsonZodValidator(deferredPreviewInputSchema), async (c) => {
      const result = await previewDeferredStart(c.get('project').root, c.req.valid('json'), capabilities().automations, resolveDeferredReset);
      return c.json(result.preview);
    })
    .post('/deferred-start', jsonZodValidator(deferredCreateInputSchema), async (c) => {
      const project = c.get('project');
      const input = c.req.valid('json');
      const requestDigest = digest({ task: input.task, start: input.start, previewRevision: input.previewRevision });
      const store = project.automationStore;
      const lease = store.acquireLease();
      if (!lease) return c.json({ error: 'Scheduling is busy. Retry with the same request.' }, 409);
      try {
        const previous = store.creation(input.idempotencyKey);
        if (previous) return previous.requestDigest === requestDigest
          ? c.json({ scheduled: previous }, 201)
          : c.json({ error: 'This creation key belongs to a different request.' }, 409);
        // A replay only acknowledges existing state; disabling scheduling must not
        // trap a client recovering a lost response. New creation remains disabled.
        if (!capabilities().automations) return c.json({ error: AUTOMATIONS_OFF }, 409);
        const resolved = await previewDeferredStart(project.root, input, capabilities().automations, resolveDeferredReset);
        if (!resolved.preview.available) return c.json({ error: resolved.preview.message }, 400);
        if (resolved.preview.previewRevision !== input.previewRevision || !lease.isValid()) return c.json({ error: 'Settings or reset time changed. Check the preview again.' }, 409);
        if ((input.task.variants ?? 1) > 1 && !await getRepoInfo(project.root)) return c.json({ error: 'Parallel variants need a git repository.' }, 400);
        const { task, images: _images, todoId: _todoId, variants, ...fields } = input.task;
        const automation = store.create({
          name: task.trim().replace(/\s+/g, ' ').slice(0, 100), kind: 'schedule', enabled: true,
          schedule: resolved.schedule!,
          task: { ...fields, prompt: task, variants: (variants ?? 1) as 1 | 2 | 3 },
          deferredStart: { origin: 'composer', reason: input.start.kind, notBefore: resolved.preview.notBefore,
            timeZone: resolved.preview.timeZone, binding: resolved.binding!, creationKey: input.idempotencyKey,
            requestDigest, status: 'pending', runIds: [] },
        });
        emitAutomationChange(project, automation.id, automation.revision);
        automationsChanged();
        return c.json({ scheduled: store.creation(input.idempotencyKey)! }, 201);
      } catch (error) { return c.json({ error: error instanceof Error ? error.message : String(error) }, 409); }
      finally { lease.release(); }
    })
    .get('/automations', async (c) => {
      const { root, automationStore } = c.get('project');
      const forge = resolveForge(await getRepoInfo(root));
      // Annotated, so the two branches are ONE shape rather than a union of two: the fallback
      // literal always carries `reason`, the cached answer only sometimes does, and the route
      // type is what `contract/src/automations.ts` has to describe.
      // A cold cache (first read after boot) waits for the probe instead of answering "still being
      // checked": nothing re-reads this page when the background probe lands, so that answer
      // would lock the editor's GitHub trigger off. Only `/api/health` has a latency budget.
      const availability: ForgeAvailability = forge
        ? forge.detectCached() ?? (await forge.detect())
        : { available: false, reason: 'No GitHub remote is configured' };
      const definitions = automationStore.list();
      const logsById = new Map(definitions.map((definition) => [definition.id, automationStore.logs({ automationId: definition.id, limit: 100 })] as const));
      const timeZone = localTimeZone();
      // Derived, never stored (spec 2026-09-14 § Proposed Solution 4).
      const stats = automationStats({
        definitions,
        logs: [...logsById.values()].flat(),
        runs: c.get('project').store.listRuns(),
        now: Date.now(),
        timeZone,
        costMetrics: capabilities().costMetrics,
      });
      const automations = definitions.map((automation) => {
        const logs = logsById.get(automation.id) ?? [];
        const state = automationStore.state(automation.id);
        const latestLog = logs[0];
        const row = stats.rows.get(automation.id);
        const nextRunAt = automation.enabled ? (automation.kind === 'schedule' ? state?.nextRunAt : state?.nextCheckAt) : undefined;
        return {
          ...automation,
          // Spread conditionally, never `state: maybeUndefined`: the latter types the key as
          // always-present while `JSON.stringify` drops it from the wire, so the contract would
          // have to describe a key consumers never receive.
          ...(state ? { state } : {}),
          ...(latestLog ? { latestLog } : {}),
          counts: {
            matches: logs.filter((row) => row.result === 'launched' || row.result === 'duplicate').length,
            launched: logs.filter((row) => row.result === 'launched' || row.result === 'manual' || row.result === 'catch-up').length,
            duplicates: logs.filter((row) => row.result === 'duplicate').length,
            errors: logs.filter((row) => row.result === 'error' || row.result === 'rate-limited' || row.result === 'failed').length,
          },
          ...(nextRunAt ? { nextRunAt } : {}),
          ...(row?.lastRun ? { lastRun: row.lastRun } : {}),
          runs7d: row?.runs7d ?? 0,
          ...(row?.costUsd7d !== undefined ? { costUsd7d: row.costUsd7d } : {}),
        };
      });
      const nextDue = automations.map((item) => item.nextRunAt).filter(Boolean).sort()[0];
      return c.json({
        ...availability,
        scheduler: {
          // `as const` on both arms: in an object literal a conditional of two string literals
          // widens to `string`, which would erase the two states this key can hold.
          state: automations.some((item) => item.enabled) ? ('scheduled' as const) : ('idle' as const),
          ...(nextDue ? { nextDue } : {}),
        },
        timeZone,
        stats: stats.week,
        automations,
      });
    })

    .post('/automations', jsonZodValidator(() => automationCreateSchema), async (c) => {
      const { automationStore } = c.get('project');
      const parsed = { data: c.req.valid('json') };
      const kind = parsed.data.kind ?? 'github';
      const kindIssue = automationKindIssue(parsed.data, kind);
      if (kindIssue) return c.json({ error: kindIssue }, 400);
      if (kind === 'tracker') {
        const issue = await trackerTriggerIssue(c.get('project'), parsed.data.trackerTrigger);
        if (issue) return c.json({ error: issue }, 400);
      }
      const passedIssue = oncePassedIssue(parsed.data.schedule, parsed.data.enable === true);
      if (passedIssue) return c.json({ error: passedIssue }, 400);
      const promptIssue = validateAutomationPrompt(parsed.data.task.prompt, kind);
      if (promptIssue) return c.json({ error: promptIssue }, 400);
      const accountIssue = await automationAccountIssue(c.get('project').root, parsed.data.task);
      if (accountIssue) return c.json({ error: accountIssue }, 400);
      const { enable, ...input } = parsed.data;
      try {
        const automation = automationStore.create(
          { ...input, kind, enabled: enable === true },
          undefined,
          enable ? definition => armAutomation(automationStore, definition) : undefined,
        );
        emitAutomationChange(c.get('project'), automation.id, automation.revision);
        automationsChanged();
        return c.json({ automation }, 201);
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
      }
    })

    .get('/automations/:id', (c) => {
      const { automationStore } = c.get('project');
      const automation = automationStore.get(c.req.param('id'));
      if (!automation) return c.json({ error: 'not found' }, 404);
      const state = automationStore.state(automation.id);
      const latestLog = automationStore.logs({ automationId: automation.id, limit: 1 })[0];
      return c.json({
        automation,
        ...(state ? { state } : {}),
        ...(latestLog ? { latestLog } : {}),
      });
    })

    .put('/automations/:id', jsonZodValidator(() => automationUpdateSchema), async (c) => {
      const { automationStore } = c.get('project');
      const parsed = { data: c.req.valid('json') };
      const current = automationStore.get(c.req.param('id'));
      if (!current) return c.json({ error: 'not found' }, 404);
      // The stored kind unless the body names one; a switch is refused — receipts and cursors
      // are kind-specific, and a silent swap would orphan them (spec 2026-09-14 § Edge cases).
      if (current.deferredStart) {
        const lease = automationStore.acquireLease();
        if (!lease) return c.json({ error: 'The scheduled task is being launched. Refresh its status.' }, 409);
        try {
          const fresh = automationStore.get(current.id);
          if (!fresh?.deferredStart || fresh.revision !== parsed.data.expectedRevision || fresh.deferredStart.runIds.length) return c.json({ error: 'The task changed or its launch was already claimed.' }, 409);
          if (digest(parsed.data.task) !== digest(fresh.task) || parsed.data.name !== fresh.name || parsed.data.kind !== 'schedule' || parsed.data.schedule?.type !== 'once') return c.json({ error: 'Cancel and submit a new task to change its prompt or settings.' }, 409);
          await validateDeferredBinding(c.get('project').root, fresh);
          const { prompt, ...fields } = fresh.task;
          const schedule = parsed.data.schedule;
          const resolved = await previewDeferredStart(c.get('project').root, { task: { ...fields, task: prompt }, start: { kind: 'at', date: schedule.date ?? '', hour: schedule.hour ?? 0, minute: schedule.minute ?? 0 } }, true);
          if (!resolved.preview.available) return c.json({ error: resolved.preview.message }, 400);
          const automation = automationStore.update(fresh.id, fresh.revision, { ...fresh, schedule: resolved.schedule!, enabled: true,
            deferredStart: { ...fresh.deferredStart, reason: 'at', notBefore: resolved.preview.notBefore, timeZone: resolved.preview.timeZone, status: 'pending', failureKind: undefined, error: undefined, holdUntil: undefined, manualRequested: undefined } });
          emitAutomationChange(c.get('project'), automation.id, automation.revision);
          automationsChanged();
          return c.json({ automation });
        } catch (error) { return c.json({ error: error instanceof Error ? error.message : String(error) }, 409); }
        finally { lease.release(); }
      }
      const kind = parsed.data.kind ?? current.kind;
      if (kind !== current.kind) return c.json({ error: 'change the kind by creating a new automation' }, 409);
      const kindIssue = automationKindIssue(parsed.data, kind);
      if (kindIssue) return c.json({ error: kindIssue }, 400);
      if (kind === 'tracker') {
        const issue = await trackerTriggerIssue(c.get('project'), parsed.data.trackerTrigger);
        if (issue) return c.json({ error: issue }, 400);
      }
      const passedIssue = oncePassedIssue(parsed.data.schedule, parsed.data.enabled === true);
      if (passedIssue) return c.json({ error: passedIssue }, 400);
      const promptIssue = validateAutomationPrompt(parsed.data.task.prompt, kind);
      if (promptIssue) return c.json({ error: promptIssue }, 400);
      const accountIssue = await automationAccountIssue(c.get('project').root, parsed.data.task);
      if (accountIssue) return c.json({ error: accountIssue }, 400);
      const { expectedRevision, ...input } = parsed.data;
      try {
        // Match the scanner's checkpoint identity: association and effective event selection.
        // Prompt and eligibility-filter edits keep progress so events since the last poll survive.
        const trackerScanIdentity = (trigger: AutomationEditableBody['trackerTrigger']) => JSON.stringify([
          trigger?.association,
          trigger?.events.length === 1 ? trigger.events[0] : undefined,
        ]);
        const trackerSourceChanged = kind === 'tracker'
          && trackerScanIdentity(current.trackerTrigger) !== trackerScanIdentity(input.trackerTrigger);
        const automation = automationStore.update(
          c.req.param('id'), expectedRevision,
          { ...input, kind, enabled: input.enabled ?? false },
          definition => {
            // Publish the new baseline and definition under the same mutation lease.
            if (kind === 'tracker' && definition.enabled && (!current.enabled || trackerSourceChanged)) armAutomation(automationStore, definition);
            else if (trackerSourceChanged) {
              // A paused definition still needs a compatible read-only preview. Clear source-bound
              // progress without arming a timer; Enable will establish its own current-time baseline.
              automationStore.setState(definition.id, state => ({
                ...state, revision: definition.revision, baselineAt: undefined, checkpoint: undefined,
                cursor: undefined, nextCheckAt: undefined, backoffUntil: undefined, consecutiveFailures: 0,
              }));
            }
          },
        );
        // An edited schedule recomputes its next occurrence; `store.update` carried the old
        // `nextRunAt` forward, so clear it and let the timer's `dueAt` persist the new one.
        if (kind === 'schedule' && JSON.stringify(current.schedule) !== JSON.stringify(automation.schedule)) {
          if (automationStore.state(automation.id)?.nextRunAt) {
            automationStore.setState(automation.id, (state) => ({ ...state, nextRunAt: undefined }));
          }
        }
        if (kind !== 'tracker' && automation.enabled && !current.enabled) armAutomation(automationStore, automation);
        if (automation.enabled !== current.enabled) {
        }
        emitAutomationChange(c.get('project'), automation.id, automation.revision);
        automationsChanged();
        return c.json({ automation });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ error: message }, message.includes('conflict') ? 409 : 400);
      }
    })

    .delete('/automations/:id', queryZodValidator(deferredMutationQuerySchema), (c) => {
      const conflict = (error: string, runIds?: string[]) => c.json({ error, ...(runIds ? { runIds } : {}) }, 409);
      const id = c.req.param('id');
      const store = c.get('project').automationStore;
      const current = store.get(id);
      if (current?.deferredStart) {
        const lease = store.acquireLease();
        if (!lease) return conflict('Launch is in progress. Refresh before cancelling.');
        try {
          const fresh = store.get(id);
          if (!fresh?.deferredStart) {
            const creation = store.creationFor(id);
            return creation?.outcome === 'launched'
              ? conflict('This scheduled task already started.', creation.runIds)
              : conflict('The task changed or its launch was already claimed.');
          }
          if (fresh.revision !== c.req.valid('query').expectedRevision) return conflict('The task changed or its launch was already claimed.');
          const claimed = fresh.deferredStart.runIds;
          // An uncertain launch may be dismissed; the ledger keeps whichever recorded runs exist.
          if (claimed.length && !(fresh.deferredStart.status === 'failed' && fresh.deferredStart.failureKind === 'ambiguous')) return conflict('The task changed or its launch was already claimed.');
          const existing = new Set(c.get('project').store.listPersistedRuns().filter(r => r.automationTrigger?.automationId === id).map(r => r.id));
          store.finishDeferred(id, 'cancelled', claimed.filter(runId => existing.has(runId)));
          emitAutomationChange(c.get('project'), id, fresh.revision, true);
          automationsChanged();
          return c.body(null, 204);
        } catch (error) { return conflict(error instanceof Error ? error.message : String(error)); }
        finally { lease.release(); }
      }
      const creation = !current ? store.creationFor(id) : undefined;
      if (creation?.outcome === 'launched') return conflict('This scheduled task already started.', creation.runIds);
      if (!current || !store.delete(id)) return c.json({ error: 'not found' }, 404);
      emitAutomationChange(c.get('project'), id, current.revision, true);
      automationsChanged();
      return c.body(null, 204);
    })

    .post('/automations/:id/enable', async (c) => {
      const store = c.get('project').automationStore;
      const current = store.get(c.req.param('id'));
      if (!current) return c.json({ error: 'not found' }, 404);
      if (current.deferredStart) return c.json({ error: 'Use the scheduled task actions in Tasks.' }, 409);
      if (current.kind === 'tracker') {
        const issue = await trackerTriggerIssue(c.get('project'), current.trackerTrigger);
        if (issue) return c.json({ error: issue }, 400);
      }
      const passedIssue = oncePassedIssue(current.schedule, true);
      if (passedIssue) return c.json({ error: passedIssue }, 409);
      let automation: AutomationDefinition;
      try {
        automation = store.update(
          current.id, current.revision,
          { ...editableAutomation(current), enabled: true },
          definition => armAutomation(store, definition),
        );
      }
      catch (error) { return c.json({ error: error instanceof Error ? error.message : String(error) }, 409); }
      emitAutomationChange(c.get('project'), automation.id, automation.revision);
      automationsChanged();
      return c.json({ automation });
    })

    .post('/automations/:id/pause', (c) => {
      const store = c.get('project').automationStore;
      const current = store.get(c.req.param('id'));
      if (!current) return c.json({ error: 'not found' }, 404);
      if (current.deferredStart) return c.json({ error: 'Use the scheduled task actions in Tasks.' }, 409);
      let automation: AutomationDefinition;
      try { automation = store.update(current.id, current.revision, { ...editableAutomation(current), enabled: false }); }
      catch (error) { return c.json({ error: error instanceof Error ? error.message : String(error) }, 409); }
      emitAutomationChange(c.get('project'), automation.id, automation.revision);
      automationsChanged();
      return c.json({ automation });
    })

    // The body is validated as MIDDLEWARE, which is what puts it in the route type — and moves
    // the 400 ahead of this route's 404: `POST /automations/<unknown>/check` with a malformed
    // body now answers 400 rather than 404. Nothing else about either answer changed.
    .post('/automations/:id/check', jsonZodValidator(() => automationCheckRequestSchema), async (c) => {
      const project = c.get('project');
      const store = project.automationStore;
      const automation = store.get(c.req.param('id'));
      if (!automation) return c.json({ error: 'not found' }, 404);
      if (!isGithubAutomation(automation) && !isTrackerAutomation(automation)) return c.json({ error: 'Choose an event to preview, or use run for a schedule' }, 409);
      const parsed = { data: c.req.valid('json') };
      // `string`, not `randomUUID`'s template-literal type: the wire carries an opaque id, and
      // leaking `${string}-${string}-…` into the route type would make the contract describe the
      // generator rather than the answer.
      const id: string = randomUUID();
      const check: ManualCheck = { id, automationId: automation.id, mode: parsed.data.mode, status: 'queued', createdAt: new Date().toISOString() };
      if (manualChecks.size >= 200) manualChecks.delete(manualChecks.keys().next().value!);
      manualChecks.set(id, check);
      void (async () => {
        check.status = 'running';
        try {
          if (isTrackerAutomation(automation)) {
            const scheduler = new ProjectTrackerAutomationScheduler({ projectId: project.id, store, timeZone: localTimeZone(),
              tracker: { getDriver: () => trackers.driver(project.root, project.dataDir), poller: new TrackerPoller() },
              launchTracker: (definition, candidate, receiptId) => launchTrackerAutomationRun({ root: project.root, manager: project.manager, store: project.store, definition, candidate, receiptId, dispatchEnabled: capabilities().dispatch }),
              onChange: (id, revision) => emitAutomationChange(project, id, revision),
            });
            const result = await scheduler.check(automation, parsed.data.mode);
            Object.assign(check, { status: 'complete', completedAt: new Date().toISOString(), matches: result.candidates.length, truncated: result.truncated });
            return;
          }
          const remote = parseRemote((await getRepoInfo(project.root))?.remote ?? '');
          if (!remote || !isGithubHost(remote.host)) throw new Error('No GitHub remote is configured');
          const scheduler = new ProjectAutomationScheduler({
            projectId: project.id,
            timeZone: localTimeZone(),
            store,
            github: { owner: remote.owner, repo: remote.repo, poller: new GithubPoller({ host: remote.host }) },
            launch: parsed.data.mode === 'execute'
              ? (definition, candidate, receiptId) => launchAutomationRun({ root: project.root, manager: project.manager, store: project.store, definition, candidate, receiptId, dispatchEnabled: capabilities().dispatch })
              : undefined,
            onChange: (automationId, revision) => emitAutomationChange(project, automationId, revision),
          });
          const result = await scheduler.check(automation, parsed.data.mode);
          Object.assign(check, { status: 'complete', completedAt: new Date().toISOString(), matches: result.candidates.length, truncated: result.truncated });
        } catch (error) {
          Object.assign(check, { status: 'error', completedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return c.json({ checkId: id }, 202);
    })

    // A scheduled automation fired NOW, by hand (spec 2026-09-14 Q10): paused or not, the
    // definition's `enabled` and `nextRunAt` are untouched — this is a launch, not an arm.
    .post('/automations/:id/run', queryZodValidator(deferredMutationQuerySchema), async (c) => {
      const project = c.get('project');
      const store = project.automationStore;
      const automation = store.get(c.req.param('id'));
      if (!automation) return c.json({ error: 'not found' }, 404);
      if (automation.deferredStart && automation.revision !== c.req.valid('query').expectedRevision) return c.json({ error: 'The task changed. Refresh before running it.' }, 409);
      if (!isScheduleAutomation(automation)) return c.json({ error: 'a GitHub automation is run through check with mode execute' }, 409);
      const runner = new ScheduleRunner(scheduleHandle(project));
      const outcome = await runner.runNow(automation);
      if (outcome.result === 'lease-held') return c.json({ error: 'automation polling lease is held by another process' }, 409);
      if (outcome.result === 'duplicate') return c.json({ error: 'this instant was already launched' }, 409);
      if (!('runId' in outcome)) {
        automationsChanged();
        return c.json({ error: automation.deferredStart
          ? store.get(automation.id)?.deferredStart?.error ?? 'The task could not start. Refresh its details in Tasks.'
          : launchFailedMessage(outcome) }, 409);
      }
      automationsChanged();
      return c.json({ runId: outcome.runId }, 202);
    })

    .get('/automation-log', queryZodValidator(automationLogQuerySchema), (c) => {
      const project = c.get('project');
      const records = project.automationStore.logs(c.req.valid('query'));
      return c.json({ records, runs: logRunsOf(project.store, records) });
    })

    .post('/automation-log/:receiptId/retry', async (c) => {
      const project = c.get('project');
      const store = project.automationStore;
      try { reconcileAutomationReceipts(store, project.store, { strict: true }); }
      catch { return c.json({ error: 'Cannot safely reconcile automation receipts; try again.' }, 409); }
      const receipt = [...store.latestReceipts().values()].find((row) => row.receiptId === c.req.param('receiptId'));
      if (!receipt) return c.json({ error: 'not found' }, 404);
      if (receipt.status !== 'launch-error' || receipt.runId) return c.json({ error: 'receipt is not retryable' }, 409);
      const definition = store.get(receipt.automationId);
      if (!definition) return c.json({ error: 'automation not found' }, 404);
      if (definition.deferredStart) return c.json({ error: 'Use Retry in Tasks with the current revision.' }, 409);
      // A schedule receipt retries as a by-hand launch of the same occurrence, under the same
      // receipt (spec 2026-09-14 § API).
      if (isScheduleAutomation(definition)) {
        const outcome = await new ScheduleRunner(scheduleHandle(project)).retry(definition, receipt);
        if (outcome.result === 'lease-held') return c.json({ error: 'automation polling lease is held by another process' }, 409);
        if (!('runId' in outcome)) return c.json({ error: launchFailedMessage(outcome) }, 409);
        return c.json({ receiptId: receipt.receiptId, runId: outcome.runId }, 202);
      }
      if (isTrackerAutomation(definition)) {
        const candidate = receipt.trackerCandidate;
        if (!candidate?.association || !candidate.event || !candidate.issueId || !candidate.change) return c.json({ error: 'Receipt predates event context and cannot be retried safely' }, 409);
        if (receipt.revision !== definition.revision) return c.json({ error: 'Automation changed since this event; retry is no longer safe' }, 409);
        const issue = await trackerTriggerIssue(project, definition.trackerTrigger);
        if (issue) return c.json({ error: issue }, 409);
        const lease = store.acquireLease();
        if (!lease) return c.json({ error: 'automation polling lease is held by another process' }, 409);
        const mutation = store.acquireMutationLease();
        if (!mutation) { lease.release(); return c.json({ error: 'automation mutation conflict' }, 409); }
        try {
          if (store.get(definition.id)?.revision !== definition.revision) return c.json({ error: 'automation revision conflict' }, 409);
          try { reconcileAutomationReceipts(store, project.store, { strict: true }); }
          catch { return c.json({ error: 'Cannot safely reconcile automation receipts; try again.' }, 409); }
          if (!store.reserveRetry(receipt.receiptId)) return c.json({ error: 'receipt is not retryable' }, 409);
          const launched = await launchTrackerAutomationRun({ root: project.root, manager: project.manager, store: project.store, definition,
            candidate: { ...candidate, association: candidate.association, event: candidate.event, issueId: candidate.issueId, change: candidate.change }, receiptId: receipt.receiptId, dispatchEnabled: capabilities().dispatch });
          store.appendReceipt({ ...receipt, status: 'launched', runId: launched.runId, updatedAt: new Date().toISOString() });
          return c.json({ receiptId: receipt.receiptId, runId: launched.runId }, 202);
        } catch (error) {
          store.appendReceipt({ ...receipt, status: 'launch-error', error: error instanceof Error ? error.message : String(error), updatedAt: new Date().toISOString() });
          return c.json({ error: 'Tracker launch failed; see the execution log' }, 409);
        } finally { mutation.release(); lease.release(); }
      }
      if (!isGithubAutomation(definition)) return c.json({ error: 'automation kind cannot be retried' }, 409);
      if (!receipt.candidate) return c.json({ error: 'receipt predates retry context and cannot be retried safely' }, 409);
      const lease = store.acquireLease();
      if (!lease) return c.json({ error: 'automation polling lease is held by another process' }, 409);
      const mutation = store.acquireMutationLease();
      if (!mutation) { lease.release(); return c.json({ error: 'automation mutation conflict' }, 409); }
      try { reconcileAutomationReceipts(store, project.store, { strict: true }); }
      catch {
        mutation.release();
        lease.release();
        return c.json({ error: 'Cannot safely reconcile automation receipts; try again.' }, 409);
      }
      const reserved = store.reserveRetry(receipt.receiptId);
      if (!reserved) { mutation.release(); lease.release(); return c.json({ error: 'receipt is not retryable' }, 409); }
      try {
        const launched = await launchAutomationRun({ root: project.root, manager: project.manager, store: project.store, definition, candidate: receipt.candidate, receiptId: receipt.receiptId, dispatchEnabled: capabilities().dispatch });
        store.appendReceipt({ ...reserved, status: 'launched', runId: launched.runId, updatedAt: new Date().toISOString() });
        emitAutomationChange(project, definition.id, definition.revision);
        return c.json({ receiptId: receipt.receiptId, runId: launched.runId }, 202);
      } catch (error) {
        // A `pr-head` retry whose PR has since closed (or turned out a fork) is handled, not
        // broken: a terminal `skipped` receipt, so Retry stops being offered for it.
        const skipped = error instanceof AutomationLaunchOutcome && error.result === 'skipped';
        store.appendReceipt({
          ...reserved,
          status: skipped ? 'skipped' : 'launch-error',
          ...(skipped ? {} : { error: (error instanceof Error ? error.message : String(error)).slice(0, 2_000) }),
          updatedAt: new Date().toISOString(),
        });
        return c.json({ error: error instanceof Error ? error.message : String(error) }, 409);
      } finally {
        mutation.release();
        lease.release();
      }
    });

  // ---- chained family: manual automation checks (workspace-level) ----
  // Workspace-level because the handler reads no project: a check lives in the server-memory map
  // above, keyed by an unguessable id that the project-scoped POST hands back. Mounting it under
  // `/api/v1/p/:projectId` too would be a second spelling of a lookup that consults no project.
  const automationChecksRoutes = new Hono()
    .use('/automation-checks/*', requireAutomations)
    .use('/workspace/automation-templates', requireAutomations)
    // The editor's "From your other projects" palette (spec 2026-09-14 Q7): every OTHER
    // registered project's definitions, read-only, from their own stores. Workspace-level
    // because it reads the registry, not the calling project.
    .get('/workspace/automation-templates', queryZodValidator(z.object({ exclude: z.string().optional() })), async (c) => {
      const exclude = c.req.valid('query').exclude;
      // The registry, not the calling project; an unreadable workspace answers an empty palette.
      const projects = await listProjects().catch(() => []);
      return c.json({ templates: automationTemplatesOf(projects, exclude) });
    })
    .get('/automation-checks/:checkId', (c) => {
      const check = manualChecks.get(c.req.param('checkId'));
      return check ? c.json(check) : c.json({ error: 'not found' }, 404);
    });

  /**
   * The dispatch gate (spec `.ai/specs/2026-09-10-dispatch.md`) — the automations gate, one flag
   * over: with `ONNI_DISPATCH=0`, both routes answer 409 before touching the manager.
   *
   * Middleware on EXPLICIT paths, never `use('*')`, for the reason `requireAutomations` spells
   * out above: this family is mounted with `.route('/', …)` alongside a dozen unrelated sub-apps,
   * and `route()` re-registers a sub-app's middleware under the mount prefix.
   */
  const requireDispatch = async (c: Context, next: Next) => {
    if (!capabilities().dispatch) return c.json({ error: DISPATCH_OFF }, 409);
    await next();
  };

  const dispatchRoutes = createDispatchRoutes({ requireDispatch });

  // ---- chained family: project memory (plan v2 §8) ----
  // `GET/PUT /manager-memory` are the Settings pair and work with dispatch off: they edit a file,
  // not a tree. `POST /runs/:id/memory` is the manager's own command and sits behind the gate.
  const memoryRoutes = new Hono<ProjectApiEnv>()
    .get('/manager-memory', async (c) => {
      const { manager } = c.get('project');
      return c.json(await manager.readManagerMemory());
    })

    /** Refuses rather than truncates: over the cap is 400, a stale revision is 409 with the
     *  current file so Settings can reload instead of dropping the other window's lesson. */
    .put('/manager-memory', jsonZodValidator(managerMemoryPutSchema), async (c) => {
      const { manager } = c.get('project');
      const outcome = await manager.writeManagerMemory(c.req.valid('json'));
      if (!outcome.ok) {
        return c.json({ error: outcome.error, ...(outcome.current ? { current: outcome.current } : {}) }, outcome.status);
      }
      return c.json(outcome.memory);
    })

    .use('/runs/:id/memory', requireDispatch)
    .post('/runs/:id/memory', jsonZodValidator(managerMemoryAddSchema), async (c) => {
      const { manager } = c.get('project');
      const outcome = await manager.addManagerMemory(c.req.param('id'), c.req.valid('json'));
      if ('denied' in outcome) return c.json({ error: outcome.denied }, outcome.status);
      return c.json(outcome);
    });

  // ---- runs ----------------------------------------------------------------

  // Additive `usage` field (#348): the latest CPU/RSS/proc-count sample of the
  // run's live process tree — absent for finished runs and when `ps` yields
  // nothing. The stored record itself is never touched.
  const withUsage = (run: RunRecord): RunRecord & { usage?: ReturnType<typeof currentUsage> } => {
    const usage = currentUsage(run.id);
    return usage ? { ...run, usage } : run;
  };

  // The inbox half of a composer launch (#374). Since the cockpit's "▶ Run"
  // prefills `/new` instead of calling POST /api/todos/:id/start (never launch
  // blind — #355), the todo id rides along on the composer's POST /api/runs and
  // lands here: `markStarted` writes `startedTaskId`, so the entry leaves the
  // inbox (`visibleTodos()`) and stays in todos.json as the audit trail, and a
  // second launch of the same entry no longer double-starts it.
  //
  // Deliberately best-effort: bookkeeping must never cost the user their task,
  // so an unknown, stale or already-started id (markStarted → false) and any I/O
  // failure only log. The run has already been created by the time we get here.
  const noteTodoStarted = async (dataDir: string, todoId: string, taskId: string): Promise<void> => {
    try {
      if (!(await markStarted(dataDir, todoId, taskId))) {
        console.warn(`[onni] inbox entry ${todoId} not marked started (unknown or already started)`);
      }
    } catch (err) {
      console.warn(`[onni] could not mark inbox entry ${todoId} started: ${String(err)}`);
    }
  };

  // ---- chained family: runs lifecycle + artifacts (project-scoped) ----
  /**
   * One task, gone with everything that belongs to it: worktree + branch (spec 006), terminals,
   * layouts, events (the chat), handoff, images and drafts (`store.deleteRun`). Shared by the
   * single-task delete and the per-project clear, so both clean up identically.
   */
  const deleteRunFully = async (
    project: ProjectContext,
    id: string,
  ): Promise<{ ok: true } | { ok: false; status: 404 | 409; error: string } | { ok: false; status: 'lifecycle'; error: unknown }> => {
    const { root: repoRoot, store, manager, dataDir } = project;
    if (manager.isActive(id)) return { ok: false, status: 409, error: 'run is active — cancel it first' };
    const run = store.getRun(id);
    if (!run) return { ok: false, status: 404, error: 'not found' };
    if (protectedByLiveTree(run, store.listRuns())) return { ok: false, status: 409, error: 'this worker belongs to a task tree that is still running — its manager may still be integrating the branch; try again when the tree has finished' };
    try {
      return await legacyWorktreeMutation(project, id, async () => {
        stopTaskProcesses(id);
        // The open manager question goes with the task (plan v2 §9) — its timer must not outlive it.
        manager.forgetSoftAsk(id);
        // Layouts go with the task, and only with it — archiving keeps them (spec §5.3).
        deleteRunLayouts(dataDir, id);
        if (run.worktreePath) await removeWorktree(repoRoot, run.worktreePath, run.branch);
        const deleted = store.deleteRun(id);
        // The run's `refs/onni/pr/<n>` goes with the last run that needed it (Phase 3).
        if (deleted && run.prHead) await manager.sweepPrHeadRefs();
        return deleted ? ({ ok: true } as const) : ({ ok: false, status: 404, error: 'not found' } as const);
      });
    } catch (error) {
      return { ok: false, status: 'lifecycle', error };
    }
  };

  const runsRoutes = new Hono<ProjectApiEnv>()
    // `workflowDef` is ~1.3 MB per run; the list leaves it out (`?full=1` opts back in, GET /runs/:id is always complete).
    .get('/runs', queryZodValidator(runsListQuerySchema), (c) => {
      const full = c.req.valid('query').full === '1';
      return c.json(
        c
          .get('project')
          .store.listRuns()
          .map((run) => withUsage(full || !run.workflowDef ? run : { ...run, workflowDef: undefined })),
      );
    })

    // Registered before the `/:id/...` routes so "archive-finished" and "read-all"
    // never match as a run id.
    .post('/runs/archive-finished', (c) => {
      const { store } = c.get('project');
      const open = store.listRuns().filter((run) => !run.archived).map((run) => run.id);
      const archived = store.archiveFinished();
      // The sweep is an archive like any other: each task it took loses its terminals (spec §6).
      if (archived > 0) for (const id of open) if (store.getRun(id)?.archived) stopTaskProcesses(id);
      return c.json({ archived });
    })

    // The read-receipt sweep (#unread-done-items) — the mark-read twin of the archive
    // sweep above, and under the same registration-order guard.
    .post('/runs/read-all', (c) => c.json({ read: c.get('project').store.markAllRead() }))

    .post('/runs/:id/archive', jsonZodValidator(archiveSchema, { absent: ({}) }), async (c) => {
      const { store, manager } = c.get('project');
      const id = c.req.param('id');
      // An empty/absent body archives (the common case); a malformed body degrades
      // to `{}` just as before, but a wrong-typed `archived` is now a 400 (#429).
      // Archiving also retires any pending usage-limit resume, but that rule belongs to
      // `setArchived` itself — the bulk sweep must obey it too (spec
      // 2026-08-03-auto-resume-after-usage-limit).
      const parsed = { data: c.req.valid('json') };
      const retiresQuestion = parsed.data.archived !== false && store.getRun(id)?.awaitingAnswerSince !== undefined;
      const run = store.setArchived(id, parsed.data.archived !== false);
      if (run && parsed.data.archived !== false) stopTaskProcesses(id);
      if (run && retiresQuestion) manager.notifyQuestionRetired?.(id);
      return run ? c.json(run) : c.json({ error: 'not found' }, 404);
    })

    // Pin one task to the top of this project's list, or unpin it (#935). The archive route's
    // twin in every respect: an absent body pins (the common case), the answer is the updated
    // record, and the change rides the existing `run` SSE because `setPinned` touches. No new
    // event and no new response shape.
    .post('/runs/:id/pin', jsonZodValidator(pinSchema, { absent: ({}) }), (c) => {
      const { store } = c.get('project');
      const { pinned: pin } = c.req.valid('json');
      const pinned = pin !== false;
      const run = store.setPinned(c.req.param('id'), pinned);
      return run ? c.json(run) : c.json({ error: 'not found' }, 404);
    })

    // The per-task off switch for that resume (the workspace setting is Settings → Resources).
    // Idempotent: a run with nothing pending answers 200 too, because "this task will not
    // resume itself" is equally true either way.
    .delete('/runs/:id/auto-resume', (c) => {
      const { store, manager } = c.get('project');
      const id = c.req.param('id');
      if (!store.getRun(id)) return c.json({ error: 'not found' }, 404);
      manager.cancelAutoResume(id);
      return c.json({ cancelled: true as const });
    })

    .post('/runs/:id/read', (c) => {
      // No body: opening a thread marks it read, full stop. Stamps `seenAt = now` and
      // returns the updated record (which also rides the `run` SSE via `touch`).
      const run = c.get('project').store.setRead(c.req.param('id'));
      return run ? c.json(run) : c.json({ error: 'not found' }, 404);
    })

    .post('/runs/:id/unread', (c) => {
      // The mark-unread twin (#775) — bodyless like its read counterpart: clearing the
      // receipt is the whole action, so there is nothing to say about it. Sits under
      // `/runs/:id/`, so the `read-all` registration-order caveat above does not apply.
      const run = c.get('project').store.setUnread(c.req.param('id'));
      return run ? c.json(run) : c.json({ error: 'not found' }, 404);
    })

    .post('/runs', jsonZodValidator(startRunSchema), async (c) => {
      const { root: repoRoot, dataDir, manager } = c.get('project');
      const parsed = { data: c.req.valid('json') };
      if (agentModelsLocked(repoRoot) && parsed.data.model?.trim()) {
        return c.json({ error: AGENT_MODELS_LOCKED_ERROR }, 409);
      }
      let workflow: WorkflowDef | undefined;
      if (parsed.data.steps) {
        // Inline chain (spec 008): an approved plan runs as an ad-hoc workflow.
        const issue = stepsIssue(parsed.data.steps);
        if (issue) return c.json({ error: issue }, 400);
        workflow = {
          name: '(planned)',
          source: 'built-in',
          steps: parsed.data.steps,
        };
      } else {
        const { workflows } = await loadWorkflows(repoRoot);
        workflow = workflows.find((w) => w.name === parsed.data.workflow);
        if (!workflow) return c.json({ error: `unknown workflow: ${parsed.data.workflow}` }, 404);
      }
      const roster = parsed.data.roster;
      if (roster) {
        if (!capabilities().dispatch) {
          return c.json({ error: 'manager–worker needs task dispatch, which this cockpit has turned off (ONNI_DISPATCH=0)' }, 409);
        }
        if ((parsed.data.variants ?? 1) > 1) return c.json({ error: 'a manager–worker task cannot also run as parallel variants' }, 400);
        if (!(await getRepoInfo(repoRoot))) {
          return c.json({ error: 'manager–worker needs a git repository: every worker runs in its own worktree' }, 400);
        }
        // Only backends that are connected and enabled right now may be chosen — the roster is a
        // list of agents the user picked from what this machine can actually run.
        const rosterBackends = [...new Set([roster.manager.runner, ...roster.workers.map((w) => w.runner)])];
        const unavailable = await providerActionError(rosterBackends, { repoRoot });
        if (unavailable) return c.json({ error: unavailable }, 409);
      }
      const fallback = roster ? roster.manager.runner : parsed.data.runner ?? (await loadConfig(repoRoot)).defaultRunner;
      const blocked = await providerActionError(providersRequiredByWorkflow(workflow, fallback), {
        repoRoot,
        profileFor: (provider) => (provider === fallback ? parsed.data.agentProfile : undefined),
      });
      if (blocked) return c.json({ error: blocked }, 409);
      // A composer override names an account the user just picked, so a stale id (deleted since
      // the page loaded) is answered honestly instead of quietly running on the default — the
      // opposite of how RESOLUTION treats a dangling reference, and deliberately so: a run
      // replaying a stored id has no better answer than the default, a user does.
      if (parsed.data.agentProfile !== undefined) {
        const account = await resolveWorkspaceProfile(fallback, parsed.data.agentProfile);
        if ('error' in account) return c.json({ error: account.error }, 400);
      }
      const variants = parsed.data.variants ?? 1;
      if (variants > 1) {
        // Variants require git worktrees to isolate their changes.
        const repo = await getRepoInfo(repoRoot);
        if (!repo) {
          return c.json(
            {
              error:
                'parallel variants need a git repository (each variant runs in its own worktree) — run ×1 here, or start onni inside a git repo',
            },
            400,
          );
        }
      }
      const images = resolveAttachments(parsed.data.images);
      if (typeof images === 'string') return c.json({ error: images }, 400);
      const input = {
        task: parsed.data.task,
        model: parsed.data.model,
        runner: parsed.data.runner,
        agentProfile: parsed.data.agentProfile,
        images,
        systemPrompt: parsed.data.systemPrompt,
        worktree: parsed.data.worktree,
        newBranch: parsed.data.newBranch,
        branch: parsed.data.branch,
        ...(parsed.data.readOnly ? { readOnly: true } : {}),
        autonomous: parsed.data.autonomous,
        ...(parsed.data.limits ? { limits: parsed.data.limits } : {}),
        ...(roster ? { roster } : {}),
        ...(roster && parsed.data.managerFullAccess !== undefined ? { managerFullAccess: parsed.data.managerFullAccess } : {}),
        // Opt-in inbox (#471): the capability is the ceiling, so a client asking
        // for follow-ups on a server that has them off gets a plain `false`
        // rather than an error — the run is still perfectly valid without them.
        // One decision here feeds the run record, the system prompt and
        // ONNI_TODOS_FILE alike (RunManager.agentEnv).
        generateFollowups: capabilities().followups ? parsed.data.generateFollowups : false,
        ...(parsed.data.dispatch && capabilities().dispatch ? { dispatchIntent: parsed.data.dispatch } : {}),
      };
      if (variants > 1) {
        const runs = manager.startVariants(workflow, input, variants);
        // The entry points at the first variant — the thread the composer navigates to.
        const first = runs[0];
        if (parsed.data.todoId && first) await noteTodoStarted(dataDir, parsed.data.todoId, first.id);
        return c.json({ runs }, 201);
      }
      const run = manager.startRun(workflow, input);
      if (parsed.data.todoId) await noteTodoStarted(dataDir, parsed.data.todoId, run.id);
      return c.json(run, 201);
    })

    .get('/runs/:id', (c) => {
      const { store } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      return run ? c.json(withUsage(run)) : c.json({ error: 'not found' }, 404);
    })

    .get(
      '/runs/:id/history',
      paramZodValidator(runIdParamSchema),
      queryZodValidator(runHistoryQuerySchema),
      async (c) => {
        const { store, dataDir } = c.get('project');
        const { id } = c.req.valid('param');
        if (!store.getRun(id)) return c.json({ error: 'not found' }, 404);
        try {
          return c.json(
            await readRunHistoryPage(join(dataDir, 'runs', `${id}.ndjson`), c.req.valid('query').cursor),
          );
        } catch (error) {
          if (error instanceof HistoryCursorError) return c.json({ error: error.message }, error.status);
          throw error;
        }
      },
    )

    .get(
      '/runs/:id/history-context',
      paramZodValidator(runIdParamSchema),
      async (c) => {
        const { store, dataDir } = c.get('project');
        const { id } = c.req.valid('param');
        if (!store.getRun(id)) return c.json({ error: 'not found' }, 404);
        return c.json(await deriveRunContextEvents(join(dataDir, 'runs', `${id}.ndjson`)));
      },
    )

    // Editable titles (#389). The UI displays `titleSummary ?? title`, so a
    // user edit sets BOTH: `title` (the record's own name — the raw task stops
    // being it the moment the user renames the run) and `titleSummary` (what
    // actually displays). The auto-summarizer only ever fills an *unset*
    // titleSummary (RunManager.recordTurnEnd), so an edit wins over any past or
    // future auto-summary. Answers the updated record.
    .patch('/runs/:id', jsonZodValidator(patchRunSchema), async (c) => {
      const { store, manager } = c.get('project');
      const id = c.req.param('id');
      if (!store.getRun(id)) return c.json({ error: 'not found' }, 404);
      const parsed = { data: c.req.valid('json') };
      // The prompt is editable only while the run is still queued (#472). Checked
      // BEFORE the title write so a rejected PATCH is a no-op rather than a partial
      // one. `title` itself keeps working on any status — no regression to #389.
      if (parsed.data.task !== undefined) {
        const foldedChars = foldedLength(parsed.data.task, store.getRun(id)?.queuedMessages ?? []);
        if (foldedChars > MAX_FOLDED_TASK_CHARS) {
          return c.json(
            {
              error: `prompt too long — ${MAX_FOLDED_TASK_CHARS} character limit across the task and its queued messages (would be ${foldedChars})`,
            },
            400,
          );
        }
        if (!manager.editTask(id, parsed.data.task)) {
          return c.json({ error: 'run already started' }, 409);
        }
      }
      if (parsed.data.title !== undefined) {
        // titleOrigin 'user' permanently stops the namer's live updates for this run
        // (spec 2026-07-17-task-auto-naming).
        store.updateRun(id, {
          title: parsed.data.title,
          titleSummary: parsed.data.title,
          titleOrigin: 'user',
        });
      }
      return c.json(store.getRun(id));
    })

    .post('/runs/:id/cancel', (c) => {
      const { store, manager } = c.get('project');
      const id = c.req.param('id');
      if (!store.getRun(id)) return c.json({ error: 'not found' }, 404);
      const cancelled = manager.cancel(id);
      return c.json({ cancelled });
    })

    // "Start now": jump a queued run past the `maxParallel` cap.
    .post('/runs/:id/start-now', async (c) => {
      const { store, manager } = c.get('project');
      const id = c.req.param('id');
      if (!store.getRun(id)) return c.json({ error: 'not found' }, 404);
      const outcome = await manager.startNow(id);
      if (outcome === 'not-queued') return c.json({ error: 'run is not queued' }, 409);
      if (outcome === 'held') return c.json({ error: 'the agent account is held by a usage limit' }, 409);
      return c.json({ started: true as const });
    })

    // Live-session participation (spec 002): deliver a user message (text +
    // pasted screenshots) into the run's open claude session.
    .post('/runs/:id/messages', jsonZodValidator(messageSchema), async (c) => {
      const { root: repoRoot, dataDir, store, manager } = c.get('project');
      const id = c.req.param('id');
      const run = store.getRun(id);
      if (!run) return c.json({ error: 'not found' }, 404);
      const parsed = { data: c.req.valid('json') };
      // A retried POST whose first attempt already landed answers as it did (message-receipts.ts).
      const receipt = parsed.data.idempotencyKey ? await messageReceipts.claim(`${id}:${parsed.data.idempotencyKey}`) : undefined;
      if (receipt && 'prior' in receipt) return c.json(receipt.prior);
      let answered: MessageResponse | undefined;
      try {
        // Stacking onto a queued prompt mutates an existing task and invokes no provider.
        // Provider availability still gates live delivery after the record leaves `queued`, but
        // must not strand prompt authoring just because an unrelated fallback provider is
        // disconnected (provider-auth spec: disabling never blocks existing-task mutations).
        // In the dequeue race, the ladder below safely turns this into a starting-state buffer.
        if (run.status !== 'queued') {
          const blocked = await providerActionError([providerForActiveRun(run)], {
            repoRoot,
            profileFor: (provider) => recordedProfileFor(run, provider),
          });
          if (blocked) return c.json({ error: blocked }, 409);
        }
        const attachments = resolveAttachments(parsed.data.images);
        if (typeof attachments === 'string') return c.json({ error: attachments }, 400);
        const content: PastedContent[] = [
          ...attachments,
          ...(parsed.data.text.trim() ? [{ type: 'text', text: parsed.data.text } satisfies ContentBlock] : []),
        ];
        // Three-rung delivery ladder (#472). Branch on the ENGINE's answer rather
        // than a status read here: the handler cannot observe the dequeue safely
        // (the record is written a tick later), the engine can.
        //   live session → delivered · still queued → folded into the prompt
        //   starting up or between sessions → buffered (1408d7cb) · anything else → 409
        if (manager.sendMessage(id, content, parsed.data.replyTo)) return c.json((answered = { delivered: true as const }));

        const currentRun = store.getRun(id);
        // Bounds apply only to a message that is actually about to be stacked. Without this
        // gate an over-long message posted to a *finished* run would answer `400 prompt too
        // long` when the truthful answer is `409 session closed`. The status read is safe
        // here because it only decides whether to reject EARLY — `enqueueMessage` still
        // re-checks against the engine's own queue before writing anything.
        if (currentRun?.status === 'queued') {
          const refusal = queuedStackRefusal(dataDir, currentRun, content, parsed.data.text);
          if (refusal) return c.json({ error: refusal }, 400);
        }

        const queued = manager.enqueueMessage(id, content);
        if (queued) return c.json((answered = { queued: true as const, message: queued }));
        if (manager.deferMessage(id, content)) return c.json((answered = { deferred: true as const }));
        return c.json({ error: 'session closed' }, 409);
      } finally {
        if (receipt && 'settle' in receipt) receipt.settle(answered);
      }
    })

    // Edit / remove a stacked message (#472). Registered before any conflicting
    // `/:id` route so `queued-messages` never matches as a run id.
    .patch('/runs/:id/queued-messages/:msgId', jsonZodValidator(queuedMessagePatchSchema), async (c) => {
      const { dataDir, store, manager } = c.get('project');
      const id = c.req.param('id');
      const run = store.getRun(id);
      if (!run) return c.json({ error: 'not found' }, 404);
      const parsed = { data: c.req.valid('json') };
      const msgId = c.req.param('msgId');
      const stack = run.queuedMessages ?? [];
      const existing = stack.find((m) => m.id === msgId);
      if (!existing) return c.json({ error: 'not found' }, 404);

      const effectiveText = parsed.data.text ?? existing.text;
      const effectiveImageCount = parsed.data.images?.length ?? existing.images?.length ?? 0;
      if (!effectiveText.trim() && effectiveImageCount === 0) {
        return c.json({ error: 'message needs text or at least one attachment' }, 400);
      }

      const others = stack.filter((m) => m.id !== msgId);
      const stackedImages = others.reduce((n, m) => n + (m.images?.length ?? 0), 0);
      if (stackedImages + effectiveImageCount > MAX_QUEUED_ATTACHMENTS) {
        return c.json({ error: `too many queued attachments — ${MAX_QUEUED_ATTACHMENTS} attachment limit across the stack` }, 400);
      }
      const prospective = foldedLength(run.task, [...others, { text: effectiveText }]);
      if (prospective > MAX_FOLDED_TASK_CHARS) {
        return c.json(
          {
            error: `prompt too long — ${MAX_FOLDED_TASK_CHARS} character limit across the task and its queued messages (would be ${prospective})`,
          },
          400,
        );
      }

      if (run.status !== 'queued') return c.json({ error: 'run already started' }, 409);
      const images = resolveAttachments(parsed.data.images);
      if (typeof images === 'string') return c.json({ error: images }, 400);
      if (images !== undefined) {
        const opening = [...(run.taskImages ?? []), ...others.flatMap((m) => m.images ?? [])];
        if (queuedImageChars(dataDir, id, opening) + imageChars(images) > MAX_ATTACHMENTS_TOTAL_BASE64) {
          return c.json({ error: QUEUED_IMAGES_TOO_LARGE }, 400);
        }
      }
      const message = manager.editQueuedMessage(id, msgId, {
        ...(parsed.data.text !== undefined ? { text: parsed.data.text } : {}),
        ...(images !== undefined ? { images } : {}),
      });
      if (!message) return c.json({ error: 'run already started' }, 409);
      return c.json({ message });
    })

    .delete('/runs/:id/queued-messages/:msgId', (c) => {
      const { store, manager } = c.get('project');
      const id = c.req.param('id');
      const run = store.getRun(id);
      if (!run) return c.json({ error: 'not found' }, 404);
      const msgId = c.req.param('msgId');
      if (!(run.queuedMessages ?? []).some((m) => m.id === msgId)) {
        return c.json({ error: 'not found' }, 404);
      }
      if (!manager.removeQueuedMessage(id, msgId)) return c.json({ error: 'run already started' }, 409);
      return c.json({ removed: true });
    })

    // "Finish": gracefully close a waiting session — the run completes as done.
    .post('/runs/:id/finish', (c) => {
      const { store, manager } = c.get('project');
      const id = c.req.param('id');
      const before = store.getRun(id);
      if (!before) return c.json({ error: 'not found' }, 404);
      const finished = manager.finish(id);
      if (!finished) return c.json({ error: 'no open session' }, 409);
      return c.json({ finished: true });
    })

    // An in-place task's Commit to the base branch (spec 2026-10-20-trunk-based-projects).
    .post('/runs/:id/land', async (c) => {
      const { store, manager } = c.get('project');
      const id = c.req.param('id');
      if (!store.getRun(id)) return c.json({ error: 'not found' }, 404);
      const answer = await manager.land(id);
      return c.json({
        outcome: answer.outcome,
        message: answer.message,
        ...(answer.sha !== undefined ? { sha: answer.sha } : {}),
        ...(answer.pushed !== undefined ? { pushed: answer.pushed } : {}),
      });
    })

    // "Continue" (spec 003): reopen a finished run's session in-process.
    .post('/runs/:id/continue', jsonZodValidator(continueSchema, { absent: ({}) }), async (c) => {
      const { root: repoRoot, store, manager } = c.get('project');
      const id = c.req.param('id');
      const run = store.getRun(id);
      if (!run) return c.json({ error: 'not found' }, 404);
      // Bounded resume text (#429); an empty/absent body still just re-runs on the
      // run's current backend, and a runner/model override reopens on that engine (#401).
      const parsed = { data: c.req.valid('json') };
      // A re-posted Continue whose first attempt landed — possibly as a Continue queued behind the
      // run's teardown, which adds no step yet — answers as it did instead of continuing twice.
      const receipt = parsed.data.idempotencyKey ? await continueReceipts.claim(`${id}:${parsed.data.idempotencyKey}`) : undefined;
      if (receipt && 'prior' in receipt) return c.json(receipt.prior);
      let answered: ContinueResponse | undefined;
      try {
        if (agentModelsLocked(repoRoot) && parsed.data.model?.trim()) {
          return c.json({ error: AGENT_MODELS_LOCKED_ERROR }, 409);
        }
        const blocked = await providerActionError([providerForExistingRun(run, parsed.data.runner)], {
          repoRoot,
          // A runner switch drops the run's account (`continueRun`), so only the same runner inherits it.
          profileFor: (provider) => parsed.data.agentProfile
            ?? (provider === (run.runner ?? 'claude') ? recordedProfileFor(run, provider) : undefined),
        });
        if (blocked) return c.json({ error: blocked }, 409);
        // The follow-up pill names an account the user just picked, so an id that has been deleted
        // since the thread loaded is answered honestly — the same asymmetry `POST /runs` keeps: a
        // USER can act on "unknown account", and reopening the session on another login silently
        // would cross the very billing boundary accounts exist to draw.
        if (parsed.data.agentProfile !== undefined) {
          const provider = providerForExistingRun(run, parsed.data.runner);
          const account = await resolveWorkspaceProfile(provider, parsed.data.agentProfile);
          if ('error' in account) return c.json({ error: account.error }, 400);
        }
        const images = resolveAttachments(parsed.data.images);
        if (typeof images === 'string') return c.json({ error: images }, 400);
        const result = manager.continueRun(id, {
          text: parsed.data.text,
          images,
          runner: parsed.data.runner,
          model: parsed.data.model,
          agentProfile: parsed.data.agentProfile,
          ...(parsed.data.raiseLimits ? { raiseLimits: true } : {}),
          ...(parsed.data.replyTo !== undefined ? { replyTo: parsed.data.replyTo } : {}),
        });
        if (!result.ok) return c.json({ error: result.error }, 409);
        return c.json((answered = { continued: true as const }));
      } finally {
        if (receipt && 'settle' in receipt) receipt.settle(answered);
      }
    })

    // "Open in terminal" (spec 003): hand the session off to a real terminal —
    // in the task's worktree when it still exists (spec 006).
    .post('/runs/:id/open-in-cli', async (c) => {
      const { root: repoRoot, store } = c.get('project');
      const id = c.req.param('id');
      const run = store.getRun(id);
      if (!run) return c.json({ error: 'not found' }, 404);
      if (c.get('project').manager.lifecycle?.isBlocked(id)) return c.json({ error: 'Resolve the pending worktree lifecycle operation before opening its environment' }, 409);
      // Hosted mode: there is no "my machine" to open a terminal on. The UI
      // hides the button when localHandoff is false — this is defense in depth.
      if (!capabilities().localHandoff) {
        return c.json(
          {
            error:
              'local handoff is disabled — this cockpit runs in hosted mode (ONNI_REMOTE); resume the session from a machine that has the checkout',
          },
          409,
        );
      }
      const sessionStep = [...run.steps].reverse().find((s) => s.sessionId);
      const sessionId = sessionStep?.sessionId;
      if (!sessionId) return c.json({ error: 'no agent session to resume' }, 409);
      // Gate the account `handoffEnv` launches on below: the session's own, default when it recorded none.
      const blocked = await providerActionError([providerForExistingRun(run)], {
        repoRoot,
        profileFor: () => sessionStep?.profileId ?? DEFAULT_AGENT_ACCOUNT_ID,
      });
      if (blocked) return c.json({ error: blocked }, 409);
      const cwd = run.worktreePath && existsSync(run.worktreePath) ? run.worktreePath : repoRoot;
      const command = resumeCommand(run.runner, sessionId);
      // Fails closed on an id we do not recognise — see resumeCommand (#431).
      if (!command) return c.json({ error: 'the recorded session id has an unexpected shape' }, 409);
      // The account that OWNS this session, not the project's current one (spec 2026-07-29).
      const account = await handoffEnv(run.runner ?? 'claude', sessionStep?.profileId);
      if ('error' in account) return c.json({ error: account.error }, 409);
      const fallback = handoffFallbackCommand(cwd, command, account.env);
      // Fail closed for the same reason as the session id: a terminal opened without the
      // account's config dir resumes nothing and says nothing about why.
      if (fallback === null) {
        return c.json({ error: 'this account\'s folder cannot be used in a terminal command' }, 409);
      }
      const opened = await openTerminal(cwd, command, account.env);
      if (!opened) {
        return c.json({ error: 'no terminal emulator found', command: fallback }, 409);
      }
      return c.json({ opened: true, command });
    })

    // Open a run's worktree (or the repo root) in the chosen local app.
    .post('/runs/:id/open-in', jsonZodValidator(openInSchema), async (c) => {
      const { root: repoRoot, store } = c.get('project');
      const id = c.req.param('id');
      const run = store.getRun(id);
      if (!run) return c.json({ error: 'not found' }, 404);
      if (c.get('project').manager.lifecycle?.isBlocked(id)) return c.json({ error: 'Resolve the pending worktree lifecycle operation before opening its environment' }, 409);
      if (!capabilities().localHandoff) {
        return c.json(
          {
            error: 'local handoff is disabled — this cockpit runs in hosted mode (ONNI_REMOTE)',
          },
          409,
        );
      }
      // Follows the safeParse convention (#429); the downstream allowlist match is the real
      // injection guard, this just validates the shape.
      const parsedBody = { data: c.req.valid('json') };
      const { target, path: relPath } = parsedBody.data;
      // Telemetry counts an `open_in` only once it opened: `target` is free client text until
      // `openApp`/`agentCliRunner` matched it, and labels must stay a closed set.
      const dir = run.worktreePath && existsSync(run.worktreePath) ? run.worktreePath : repoRoot;

      // Diff pane "open in OS default app" (#365): one worktree file, opened with the platform's
      // default handler for its type — not a directory in the file manager (that's `finder`
      // above) and not a session takeover (editors/CLIs above). `path` is re-validated against
      // the worktree here regardless of what the schema allowed, so a stale/forged path can never
      // escape it.
      if (target === 'default') {
        if (!run.worktreePath || !existsSync(run.worktreePath)) {
          return c.json({ error: NO_WORKTREE }, 409);
        }
        if (!relPath) return c.json({ error: 'path required for the default-app target' }, 400);
        const result = await readWorktreePath(run.worktreePath, relPath);
        if (result.kind !== 'file') {
          return c.json(
            {
              error: result.kind === 'dir' ? `not a file: ${relPath}` : result.error,
            },
            409,
          );
        }
        // This route's whole contract is "preview an image in its default app", and containment
        // alone does not enforce it. Without this gate any regular file in the worktree — a
        // `.command`/`.desktop` an agent just wrote, an `.exe` — would be handed to the OS
        // launcher, which EXECUTES it. Not remotely reachable (random run ids, same-origin, local
        // mode), so: defense in depth.
        //
        // Deliberately `isOsOpenableImage`, NOT the raw route's `imageMimeType`: that list allows
        // SVG on the strength of an `<img>` + no-script CSP the OS launcher never applies (the
        // default `.svg` handler is usually a browser, which would run the file's `<script>`).
        if (!isOsOpenableImage(result.path)) {
          // Say which rule refused, in the route's own words — "limited to images" would be a lie
          // to someone holding an SVG, which IS an image and DOES preview inline.
          return c.json(
            {
              error: imageMimeType(result.path)
                ? `SVG can carry scripts, so it previews inline but is never handed to the OS: ${result.path}`
                : `opening in the default app is limited to images: ${result.path}`,
            },
            409,
          );
        }
        const filePath = join(run.worktreePath, result.path);
        const opened = await openFile(filePath);
        if (!opened) return c.json({ error: `could not open ${result.path}`, path: filePath }, 409);
        return c.json({ opened: true, path: filePath });
      }

      // Coding-agent CLI handoff (#cli-handoff, #402): open a terminal in the worktree that resumes
      // THIS run's session when the chosen CLI is the run's own runner (and a session exists), or
      // starts a fresh CLI there otherwise. Same terminal launcher the Terminal button uses.
      // Records that predate the runner choice carry no `runner` at all — they default to Claude
      // everywhere else (resumeCommand, the client's resumeHint/cliTargetResumes), so the match
      // check defaults the same way here; without it, a legacy run's own Claude CLI would never
      // resume its own session, only ever launch fresh.
      // A run the engine still owns never resumes: `sessionId` is seeded when the agent step STARTS
      // (workflows/run.ts), so a running/queued/waiting run already carries one, and resuming it
      // would attach a SECOND CLI process to the transcript the engine is actively writing. Those
      // picks launch the CLI fresh in the worktree — the same degradation as a cross-runner pick,
      // and what the client's cliTargetResumes now labels. Resume-after-finish is untouched.
      const cliRunner = agentCliRunner(target);
      if (cliRunner) {
        const engineOwnsSession = run.status === 'running' || run.status === 'queued' || run.status === 'waiting';
        const sessionStep = engineOwnsSession ? undefined : [...run.steps].reverse().find((s) => s.sessionId);
        const sessionId = sessionStep?.sessionId;
        // An id resumeCommand refuses (#431) degrades to a fresh CLI in the worktree,
        // exactly like a run that never recorded a session.
        const resume = sessionId && cliRunner === (run.runner ?? 'claude') ? resumeCommand(cliRunner, sessionId) : null;
        // Gate the account the terminal opens on below: the session's for a resume, the project's otherwise.
        const blocked = await providerActionError([cliRunner], {
          repoRoot,
          profileFor: () => (resume ? sessionStep?.profileId ?? DEFAULT_AGENT_ACCOUNT_ID : undefined),
        });
        if (blocked) return c.json({ error: blocked }, 409);
        // The terminal this opens does not share our PATH (see `withResolvedClaudeBin`), so a
        // claude found off PATH by detection has to be named by absolute path here too —
        // otherwise the menu offers a handoff that opens on `command not found`.
        const command = withResolvedClaudeBin(resume ?? cliRunner, cliRunner);
        // BOTH branches carry the account (spec 2026-07-29-agent-profiles): a resume needs the
        // config dir that holds its session, and a FRESH CLI in this worktree should still open
        // on the account the project works under — otherwise "Open in → Claude CLI" quietly
        // hands the user a different subscription than every task in the same project uses.
        const account = resume
          ? await handoffEnv(cliRunner, sessionStep?.profileId)
          : { env: (await resolveProfileEnvForRoot(repoRoot, cliRunner)).env };
        if ('error' in account) return c.json({ error: account.error }, 409);
        const fallback = handoffFallbackCommand(dir, command, account.env);
        if (fallback === null) {
          return c.json({ error: 'this account\'s folder cannot be used in a terminal command' }, 409);
        }
        const opened = await openTerminal(dir, command, account.env);
        if (!opened) {
          return c.json({ error: 'no terminal emulator found', command: fallback }, 409);
        }
        return c.json({ opened: true, path: dir, command });
      }

      const opened = await openApp(target, dir);
      if (!opened) return c.json({ error: `could not open ${target}`, path: dir }, 409);
      return c.json({ opened: true, path: dir });
    })

    // Handoff journal (spec 007): the per-task handoff.md as markdown. 404 only
    // when the task is unknown; a task without a (yet) seeded file returns ''.
    .get('/runs/:id/handoff', (c) => {
      const { dataDir, store } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      return c.text(readHandoff(dataDir, run.id), 200, {
        'content-type': 'text/markdown; charset=utf-8',
      });
    })

    .get('/runs/:id/images/:file', (c) => {
      const { dataDir, store } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      const file = basename(c.req.param('file'));
      const path = join(dataDir, 'runs', `${run.id}-images`, file);
      if (!existsSync(path)) return c.json({ error: 'not found' }, 404);
      const ext = file.split('.').pop() ?? '';
      const image = IMAGE_TYPES[ext];
      // An image answers exactly as it always has — the cockpit renders it in an `<img>`.
      // Everything else is a user-supplied file (#950) and leaves under the download headers.
      const type = image ?? FILE_TYPES[ext] ?? 'application/octet-stream';
      return new Response(readFileSync(path), {
        headers: {
          'content-type': type,
          'cache-control': 'private, max-age=31536000, immutable',
          ...(image
            ? {}
            : {
                'x-content-type-options': 'nosniff',
                // Engine-generated names are `pasted-3.pdf`-shaped, but a header value is not the
                // place to find out otherwise: anything exotic degrades to an underscore rather
                // than to a quote that could split the header.
                'content-disposition': `attachment; filename="${file.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
              }),
        },
      });
    })

    // Task diff (spec 006): what this run changed — its worktree vs its base.
    .get('/runs/:id/diff', async (c) => {
      const { store } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      if (!run.worktreePath || !existsSync(run.worktreePath)) {
        return c.text('(no worktree — this task ran directly in the repo working tree)');
      }
      return c.text(await worktreeDiff(run.worktreePath, run.baseBranch ?? 'HEAD'));
    })

    .get('/runs/:id/changes', async (c) => {
      const { root: repoRoot, store } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      const workingDirectory = workingDirectoryOf(run, repoRoot);
      if (!workingDirectory) return c.json({ error: NO_WORKTREE }, 409);
      const result = await collectChanges(workingDirectory, run.baseBranch ?? 'HEAD', {
        taskBranch: run.branch,
        // Anchors a repointed worktree at the branch as this run found it (#751).
        runStartedAt: run.startedAt,
        // A read-only GET against the user's real checkout must never modify its index.
        intentToAdd: run.worktreePath ? undefined : false,
        excludeOnniData: !run.worktreePath,
      });
      if (!result.ok) return c.json({ error: result.error }, 409);
      return c.json(result.changes);
    })

    // The run's own commits (<base>..HEAD on the worktree branch) — the Commits tab.
    .get('/runs/:id/commits', async (c) => {
      const { root: repoRoot, store } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      const workingDirectory = workingDirectoryOf(run, repoRoot);
      if (!workingDirectory) return c.json({ error: NO_WORKTREE }, 409);
      const result = await collectRunCommits(workingDirectory, run.baseBranch ?? 'HEAD');
      if (!result.ok) return c.json({ error: result.error }, 409);
      return c.json({ commits: result.commits });
    })

    // One of the run's commits, structured like the Changes tab (reuses collectCommitChanges).
    .get('/runs/:id/commit/:sha', async (c) => {
      const { root: repoRoot, store } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      const workingDirectory = workingDirectoryOf(run, repoRoot);
      if (!workingDirectory) return c.json({ error: NO_WORKTREE }, 409);
      const result = await collectCommitChanges(workingDirectory, c.req.param('sha'));
      if (!result.ok) return c.json({ error: result.error }, 409);
      return c.json(result.commit);
    })

    // The run's whole path index — `/repo/tree` against the task's worktree. Backs the ⌘P
    // palette's `#` file search (spec 2026-10-17-task-palette); `/runs/:id/files` serves the file.
    .get('/runs/:id/tree', async (c) => {
      const { root: repoRoot, store } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      const workingDirectory = workingDirectoryOf(run, repoRoot);
      if (!workingDirectory) return c.json({ error: NO_WORKTREE }, 409);
      const result = await listRepoPaths(workingDirectory);
      if (!result.ok) return c.json({ error: result.error }, 409);
      return c.json({ paths: result.paths, truncated: result.truncated });
    })

    // Files tab: directory listing (path omitted or a dir) or file content
    // (size-capped, binary flagged). Traversal-safe — readWorktreePath rejects
    // anything escaping the worktree. `raw=1` (R5 Step 1.6) serves the BYTES of
    // image files only, for the preview's inline <img> — never HTML/JS/etc., so
    // no worktree file can become a same-origin document, and never past the
    // size cap. The no-script CSP neutralizes SVG opened as a top-level URL.
    //
    // An `Accept` that asks for images reaches the same raw branch without the flag — which is
    // what an `<img>` sends — while the flag still wins whenever it is present and `*<slash>*`
    // (every `fetch`) still gets the JSON listing. See `negotiate`.
    .get('/runs/:id/files', queryZodValidator(z.object({ path: queryValue, raw: queryValue, rev: queryValue.refine((v) => v === undefined || isCommitSha(v), 'rev must be a full commit sha') })), async (c) => {
      const { root: repoRoot, store } = c.get('project');
      const query = c.req.valid('query');
      c.header('vary', 'Accept');
      const wantsRaw =
        query.raw !== undefined
          ? query.raw === '1'
          : negotiate(c.req.header('accept'), FILE_FORMATS) === 'image/*';
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      const workingDirectory = workingDirectoryOf(run, repoRoot);
      if (!workingDirectory) return c.json({ error: NO_WORKTREE }, 409);
      // `rev` (a full sha, the changes payload's `baseSha`) serves an image's OLD side from git —
      // the before of a modified image, the only picture of a deleted one. Bytes only.
      if (query.rev !== undefined) {
        if (!wantsRaw) return c.json({ error: 'rev is only served as raw image bytes' }, 409);
        const old = await readImageAtRev(workingDirectory, query.rev, query.path ?? '');
        if (old.kind === 'refused') return c.json({ error: old.error }, 409);
        return c.body(new Uint8Array(old.bytes).buffer as ArrayBuffer, 200, {
          'content-type': old.mime,
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          // Addressed by content: the same sha and path are the same bytes forever.
          'cache-control': 'private, max-age=31536000, immutable',
        });
      }
      // A worktree-off run browses the REAL checkout: apply `/repo/files`' index guard so ignored
      // files (`.env`, `.ai/onni/` state and webhook keys) stay unreadable here too.
      let indexed: { files: Set<string>; dirs: Set<string> } | undefined;
      if (run.worktree === false) {
        const index = await listRepoPaths(workingDirectory, Number.MAX_SAFE_INTEGER);
        if (!index.ok) return c.json({ error: index.error }, 409);
        indexed = { files: new Set(index.paths), dirs: new Set(['']) };
        for (const path of index.paths) {
          for (let cut = path.indexOf('/'); cut !== -1; cut = path.indexOf('/', cut + 1)) indexed.dirs.add(path.slice(0, cut));
        }
        // Checked before touching the disk too, so a missing ignored path answers exactly like a present one.
        const requested = posix.normalize(query.path || '.').replace(/^\.\/?$/, '').replace(/\/+$/, '');
        if (!indexed.files.has(requested) && !indexed.dirs.has(requested)) {
          return c.json({ error: `path is not in the repository index: ${query.path}` }, 409);
        }
      }
      const result = await readWorktreePath(workingDirectory, query.path ?? '');
      if (result.kind === 'invalid' || result.kind === 'missing') {
        return c.json({ error: result.error }, 409);
      }
      // One message for ignored and absent alike, as in `/repo/files`: never disclose an ignored path.
      if (indexed && !(result.kind === 'dir' ? indexed.dirs : indexed.files).has(result.path)) {
        return c.json({ error: `path is not in the repository index: ${query.path}` }, 409);
      }
      if (result.kind === 'dir') {
        const visible = indexed;
        const prefix = result.path ? `${result.path}/` : '';
        const entries = visible
          ? result.entries.filter((entry) => (entry.type === 'file' ? visible.files : visible.dirs).has(prefix + entry.name))
          : result.entries;
        return c.json({
          // `as const` or the literal widens to `string` during Hono's route-type inference,
          // which erases the discriminant a consumer narrows on — `entry.type === 'dir'` then
          // leaves `never` and every field access on it fails. The wire was always 'dir'.
          type: 'dir' as const,
          path: result.path,
          entries,
        });
      }
      if (wantsRaw) {
        const mime = imageMimeType(result.path);
        if (mime === null || result.tooLarge) {
          // `?raw=1` ASKED for bytes, so it hears why it cannot have them — that 409 and its
          // wording are the protected surface (§2). An `Accept` is only a preference, so a
          // resource with no image representation falls THROUGH to the JSON answer below rather
          // than turning a browser's navigation to a text file into an error.
          if (query.raw !== undefined) {
            const error =
              mime === null
                ? `raw serving is limited to images: ${result.path}`
                : `file too large to serve raw (${result.size} bytes): ${result.path}`;
            return c.json({ error }, 409);
          }
        } else {
          const bytes = await readFile(join(workingDirectory, result.path));
          return c.body(new Uint8Array(bytes).buffer as ArrayBuffer, 200, {
            'content-type': mime,
            'x-content-type-options': 'nosniff',
            'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          });
        }
      }
      return c.json({
        type: 'file' as const,
        path: result.path,
        size: result.size,
        binary: result.binary,
        tooLarge: result.tooLarge,
        ...(result.content !== undefined ? { content: result.content } : {}),
      });
    })

    .post('/runs/:id/git/commit', jsonZodValidator(gitCommitSchema), async (c) => {
      const { store } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      const worktree = worktreeOf(run);
      if (!worktree) return c.json({ error: NO_WORKTREE }, 409);
      const parsed = { data: c.req.valid('json') };
      let result;
      try { result = await withWorktreeMutation(c.get('project'), run.id, () => commitAll(worktree, parsed.data.message)); }
      catch (error) { return lifecycleError(c, error); }
      if (!result.ok) return c.json({ error: result.error }, 409);
      return c.json({ committed: true, sha: result.sha });
    })

    .post('/runs/:id/git/push', async (c) => {
      const { root: repoRoot, store } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      const worktree = worktreeOf(run);
      if (!worktree) return c.json({ error: NO_WORKTREE }, 409);
      let result;
      try { result = await withWorktreeMutation(c.get('project'), run.id, () => pushCurrentBranch(worktree)); }
      catch (error) { return lifecycleError(c, error); }
      if (!result.ok) return c.json({ error: result.error }, 409);
      // A push is the event that changes what the chips say about this task's pull requests —
      // its checks start again, and its MERGEABILITY is recomputed from scratch. Both are cached
      // per number, so without this the cockpit would keep showing the pre-push answer (up to a
      // minute of "Ready to merge" for a branch that has just been rewritten) about a push the
      // user watched this server make.
      for (const number of runPrNumbers(run)) forgetRefStatus(repoRoot, number);
      return c.json({
        pushed: true,
        branch: result.branch,
        remote: result.remote,
        upstreamSet: result.upstreamSet,
      });
    })

    // What the worktree holds that has not left it, and what its base has that it lacks — drives
    // the header's one git button (Commit and push, Push, Update branch). Read-only.
    .get('/runs/:id/git/status', async (c) => {
      const { store } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      const worktree = worktreeOf(run);
      // An in-place write task answers for the checkout itself, against its upstream (spec
      // 2026-10-20-trunk-based-projects) — its git step is Commit to the base branch.
      const inPlace = !worktree && run.worktree === false && !run.readOnly;
      if (!worktree && !inPlace) return c.json({ error: NO_WORKTREE }, 409);
      const result = worktree
        ? await worktreeGitStatus(worktree, run.baseBranch)
        : await checkoutGitStatus(c.get('project').root);
      if (!result.ok) return c.json({ error: result.error }, 409);
      return c.json({ uncommitted: result.uncommitted, unpushed: result.unpushed, behind: result.behind, ahead: result.ahead });
    })

    // Draft PR from the review gate (spec 009): final autosave → push →
    // `gh pr create --draft`; on success the run completes as done with the PR
    // badge. Failures come back as 409 with a `manual` merge command the GUI
    // shows next to the toast. ONNI_DRY_RUN=1 fakes the URL (no push, no gh).
    .post('/runs/:id/pr', jsonZodValidator(createPrSchema, { absent: ({}) }), async (c) => {
      const { root: repoRoot, dataDir, store, manager } = c.get('project');
      const draft = c.req.valid('json').draft ?? true;
      const id = c.req.param('id');
      const run = store.getRun(id);
      if (!run) return c.json({ error: 'not found' }, 404);
      if (manager.isActive(id)) return c.json({ error: 'run is still active — wait for the review gate' }, 409);
      // A pull-request head run's branch holds the whole foreign PR under this run's changes: a
      // draft PR from it into the default base would re-propose that PR (spec
      // 2026-10-06-agentic-e2e-checks Phase 3). Refused until publishing back is designed.
      if (run.prHead) {
        return c.json(
          { error: `this run verified pull request #${run.prHead.number}; publishing its changes is not supported yet` },
          409,
        );
      }
      if (!run.worktreePath || !existsSync(run.worktreePath) || !run.branch) {
        return c.json(
          {
            error: 'no worktree/branch to publish — this task ran in the repo working tree',
          },
          400,
        );
      }
      // One publish per run at a time: a cockpit re-asking after its response was lost (telemetry
      // 9119d21a) joins the publish still running instead of racing its autosave commit and push.
      const key = `${dataDir}\0${id}`;
      let publish = prPublishes.get(key);
      if (!publish) {
        const branch = run.branch;
        publish = (async () => {
          const outcome = await withWorktreeMutation(c.get('project'), id, () =>
            createDraftPr({ repoRoot, run, handoffText: readHandoff(dataDir, id), draft }),
          );
          if (!outcome.ok) return outcome;
          // A number the cockpit asked about BEFORE the pull request existed is cached as "this
          // repository has no such number" — which is exactly what a `ONNI:PR=901` marker declared
          // ahead of the push looks like. It exists now.
          const createdNumber = refNumberFromUrl(outcome.url);
          if (createdNumber !== null) forgetRefStatus(repoRoot, createdNumber);
          store.updateRun(id, {
            pullRequestUrl: outcome.url,
            status: 'done',
            completionReason: 'pr_opened',
            finishedAt: run.finishedAt ?? new Date().toISOString(),
          });
          store.appendEvent(id, {
            type: 'note',
            message: `${draft ? 'draft PR' : 'PR'} created: ${outcome.url}${outcome.dryRun ? ' (dry run — no real PR)' : ''}`,
          });
          return outcome;
        })()
          .then((outcome) => ({ outcome, branch }))
          .finally(() => prPublishes.delete(key));
        prPublishes.set(key, publish);
      }
      let published: Awaited<typeof publish>;
      try {
        published = await publish;
      } catch (error) { return lifecycleError(c, error); }
      const { outcome, branch } = published;
      if (!outcome.ok) {
        return c.json({ error: outcome.error, manual: `git merge ${branch}` }, 409);
      }
      return c.json({ url: outcome.url, dryRun: outcome.dryRun }, 201);
    })

    // Create PR by the task's agent: once its turn ends, the PR it opened is found by branch and
    // recorded, even if the agent never declared `ONNI:PR`. Best-effort; the status stays.
    .post('/runs/:id/pr/adopt', async (c) => {
      const { root: repoRoot, store } = c.get('project');
      const id = c.req.param('id');
      const run = store.getRun(id);
      if (!run) return c.json({ error: 'not found' }, 404);
      if (run.pullRequestUrl) return c.json({ found: true as const, url: run.pullRequestUrl });
      const worktree = worktreeOf(run);
      const target = worktree ? await resolvePrTarget(run) : null;
      const pr = worktree && target ? await findBranchPr(worktree, target) : null;
      if (!pr) return c.json({ found: false as const });
      forgetRefStatus(repoRoot, pr.number);
      // Unlike `POST /pr`, the status stays: the agent's session, not the cockpit, owns the run.
      store.updateRun(id, { pullRequestUrl: pr.url });
      store.appendEvent(id, { type: 'note', message: `PR opened by the agent: ${pr.url}` });
      return c.json({ found: true as const, url: pr.url });
    })

    // Archived tasks keep their worktree for inspection; this is the explicit
    // "🧹 Remove worktree" cleanup (spec 006).
    .post('/runs/:id/remove-worktree', async (c) => {
      const { root: repoRoot, store, manager } = c.get('project');
      const id = c.req.param('id');
      const run = store.getRun(id);
      if (!run) return c.json({ error: 'not found' }, 404);
      if (manager.isActive(id)) return c.json({ error: 'run is active — cancel it first' }, 409);
      if (protectedByLiveTree(run, store.listRuns())) return c.json({ error: 'this worker belongs to a task tree that is still running — its manager may still be integrating the branch; try again when the tree has finished' }, 409);
      try {
        return await legacyWorktreeMutation(c.get('project'), id, async () => {
          // A shell must not outlive the directory it is standing in (spec §6).
          stopTaskProcesses(id);
          if (run.worktreePath) await removeWorktree(repoRoot, run.worktreePath, run.branch);
          store.updateRun(id, { worktreePath: undefined, branch: undefined });
          if (run.prHead) await manager.sweepPrHeadRefs();
          return c.json({ removed: true });
        });
      } catch (error) { return lifecycleError(c, error); }
    })

    .delete('/runs/:id', async (c) => {
      const outcome = await deleteRunFully(c.get('project'), c.req.param('id'));
      if (outcome.ok) return c.json({ deleted: true as const });
      if (outcome.status === 'lifecycle') return lifecycleError(c, outcome.error);
      return c.json({ error: outcome.error }, outcome.status);
    })

    /** Clear one project's tasks and chats (see `clearProjectDataInputSchema`). */
    .post('/project-data/clear', jsonZodValidator(clearProjectDataInputSchema), async (c) => {
      const project = c.get('project');
      const confirm = c.req.valid('json').confirm;
      const names = new Set([project.id, basename(project.root)].map((name) => name.toLowerCase()));
      if (!names.has(confirm.toLowerCase())) {
        return c.json({ error: 'type the project name to confirm' }, 400);
      }
      // Children before parents: a worker is gone before its manager, so no tree is half-orphaned.
      const runs = [...project.store.listRuns()].sort((a, b) => Number(b.dispatch?.parentRunId !== undefined) - Number(a.dispatch?.parentRunId !== undefined));
      let deleted = 0;
      const skipped: ClearProjectDataResult['skipped'] = [];
      for (const run of runs) {
        if (!project.store.getRun(run.id)) continue;
        if (project.manager.isActive(run.id) || run.status === 'running' || run.status === 'queued' || run.status === 'waiting') {
          skipped.push({ id: run.id, title: run.title, reason: 'still running — stop it first' });
          continue;
        }
        const outcome = await deleteRunFully(project, run.id);
        if (outcome.ok) deleted += 1;
        else skipped.push({ id: run.id, title: run.title, reason: outcome.status === 'lifecycle' ? String(outcome.error instanceof Error ? outcome.error.message : outcome.error) : outcome.error });
      }
      return c.json({ deleted, skipped } satisfies ClearProjectDataResult);
    });

  const draftRoutes = createDraftsRoutes();
  const layoutRoutes = createLayoutsRoutes();

  // ---- chained family: open-targets (project-scoped) ----
  // Agent screenshots and user attachments — what the run manager persisted out of tool
  // results and pasted messages (`persistAttachment`). `basename` pins reads inside the
  // run's own dir.
  const IMAGE_TYPES: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
  };
  /**
   * What a NON-image attachment is served as (#950). These are user-supplied bytes coming back
   * from the cockpit's own origin, so the content type is the narrowest true one and it never
   * travels alone: `nosniff` stops a browser from upgrading it to something executable, and an
   * attachment disposition stops it from being rendered as a document in the cockpit's origin at
   * all. Anything not named here keeps the pre-existing `application/octet-stream` default.
   */
  const FILE_TYPES: Record<string, string> = {
    pdf: 'application/pdf',
    txt: 'text/plain; charset=utf-8',
    md: 'text/plain; charset=utf-8',
  };
  // ---- session git view (redesign R5 Step 1.2 — §"Git/session API additions").
  // Structured sibling of the text-blob /diff above (which stays untouched —
  // protected surface). Isolated runs read their worktree; worktree-off runs
  // read the repo checkout they executed in. Every predictable git failure
  // degrades to 409 + human-readable reason, 404 only for unknown ids.
  const worktreeOf = (run: RunRecord): string | null =>
    run.worktreePath && existsSync(run.worktreePath) ? run.worktreePath : null;
  const workingDirectoryOf = (run: RunRecord, repoRoot: string): string | null =>
    run.worktree === false
      ? repoRoot
      : worktreeOf(run);
  const NO_WORKTREE = 'no worktree — this task ran directly in the repo working tree';

  /** Every pull request number this run points at — the one it created and the one it is about
   *  (#901), from whichever field carries it. Used to invalidate what the forge told us about
   *  them when this server does something that changes the answer. Deliberately tolerant: an
   *  unrecognized URL shape yields nothing rather than a guessed number. */
  const runPrNumbers = (run: RunRecord): number[] => {
    const numbers = [
      run.prNumber,
      ...[run.pullRequestUrl, run.referencedPullRequestUrl].map((url) =>
        url ? refNumberFromUrl(url) : null,
      ),
    ];
    return [...new Set(numbers.filter((n): n is number => typeof n === 'number'))];
  };

  // ---- chained family: SSE streams (project-scoped) ----
  const sseRoutes = createSseRoutes({ capabilities, streamSSENoBuffer });
  const workspaceEventsRoutes = createWorkspaceEventsRoutes({
    bootContext,
    capabilities,
    contexts,
    resolveBootProject,
    streamSSENoBuffer,
    workspaceEvents,
  });
  // Serialize validation and persistence per project: a slow Connect cannot resurrect a
  // connection after a subsequent Disconnect. Reads remain independent and demand-driven.
  const trackerMutations = new Map<string, Promise<unknown>>();
  const mutateTracker = <T,>(key: string, action: () => Promise<T>): Promise<T> => {
    const previous = trackerMutations.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(action);
    trackerMutations.set(key, current);
    void current.finally(() => {
      if (trackerMutations.get(key) === current) trackerMutations.delete(key);
    }).catch(() => {});
    return current;
  };
  const trackerChanged = async (project: ProjectContext) => {
    trackers.clearCache(project.root);
    trackerWatches.invalidateProject(project.root);
    clearProjectProbeCache();
    const payload: TrackerChangedEvent = {
      project: project === bootContext ? await resolveBootProject() : project.id,
    };
    workspaceEvents.emit('tracker-changed', payload);
  };
  // ---- chained family: project secrets ------------------------------------
  // Spec 2026-10-10-project-secrets-vault-options. Write-only values: GET answers names and
  // metadata and never a value, masked or not. The write gate is the one `/tracker/connection`
  // has — the global request-origin guard (#426), no per-route capability — and the file is
  // keyed by the same project id the run manager reads with, so the reserved boot alias of an
  // unregistered boot project is refused rather than written somewhere nothing reads. The
  // workspace scope has its own single-mount family below (`workspaceSecretsRoutes`), the same
  // three handlers over the `workspace` scope.
  const secretStore = deps.secrets ?? new SecretStore();
  const unregisteredSecrets = { error: 'this project is not registered; project secrets need a project id' };
  const secretsList = async (scope: SecretScopeRef): Promise<SecretsList> => {
    const [listed, keyBackend] = await Promise.all([secretStore.list(scope), secretStore.keyBackend()]);
    return { secrets: listed.secrets, keyBackend };
  };
  const putSecret = async (scope: SecretScopeRef, name: string, input: SecretValueInput) => {
    try {
      await secretStore.set(scope, name, input.value, input.audiences);
    } catch (error) {
      if (error instanceof SecretsError) return { status: 400 as const, error: error.message };
      return { status: 409 as const, error: 'Could not save the secret. Check local storage permissions.' };
    }
    return null;
  };
  const deleteSecret = async (scope: SecretScopeRef, name: string) => {
    let removed: boolean;
    try {
      removed = await secretStore.unset(scope, name);
    } catch {
      return { status: 409 as const, error: 'Could not remove the secret. Check local storage permissions.' };
    }
    return removed ? null : { status: 404 as const, error: 'no secret with that name' };
  };
  // ---- chained family: one-click e2e setup ----------------------------------
  // Spec 2026-10-10-e2e-one-click-setup. `GET /e2e` says what the project has; `POST /e2e/setup`
  // stores the model key (when given) as a `checks` secret and starts the setup as an ordinary
  // task — an ad-hoc workflow, never a catalog entry — whose branch the user merges.
  const checkSecretNames = async (project: ProjectContext): Promise<string[]> => {
    const scope = project.id === 'default' ? undefined : { projectId: project.id, root: project.root };
    try {
      return Object.keys((await secretStore.resolve(scope, 'checks')).values);
    } catch {
      return [];
    }
  };
  const e2eRoutes = createE2eRoutes({
    checkSecretNames,
    putSecret,
    unregisteredSecrets,
    hasGitRepo: async (repoRoot) => Boolean(await getRepoInfo(repoRoot)),
    providerActionErrorForWorkflow: async (workflow, repoRoot) =>
      providerActionError(providersRequiredByWorkflow(workflow, (await loadConfig(repoRoot)).defaultRunner), { repoRoot }),
  });
  const workspaceSecretsRoutes = createWorkspaceSecretsRoutes({ secretsList, putSecret, deleteSecret });




  const configRoutes = createConfigRoutes();
  const agentConfigRoutes = createAgentConfigRoutes({ capabilities });

  // ---- assemble the chained families --------------------------------------
  // Every chained family is registered ONCE and mounted into the versioned table. There is no
  // second, unversioned spelling: `/api/*` was removed once the whole API was reachable under
  // `/api/v1` (BACKWARD_COMPATIBILITY.md §2). One surface means one thing to keep working, and
  // it is the one the typed client describes.
  //
  // MOUNT ORDER IS REGISTRATION ORDER. Hono matches in the order routes were added, so each
  // family keeps its internal order and the families keep theirs relative to each other.
  //
  // Written as ONE chained expression because that is the only shape Hono can infer route types
  // from — it is what puts these routes in `AppType`, and so in the typed client.
  /** One refusal sentence for every terminal route, or null when a shell is allowed here. */
  const terminalPolicyRefusal = (caps: ReturnType<typeof capabilities>): string | null =>
    caps.terminal
      ? null
      : 'the terminal is disabled on this cockpit — it is off in hosted mode unless ONNI_TERMINAL=1';

  /** The topic a client subscribes to for "there is new output". Derived, never stored, so the
   *  session id stays the only identity. */
  const terminalTopic = (sessionId: string) => `terminal:${sessionId}`;
  const withTopic = (session: TerminalSessionInfo) => ({ ...session, topic: terminalTopic(session.id) });

  /**
   * Publish a cursor — and ONLY a cursor — whenever a session produces output or exits.
   *
   * The hub's topics are workspace-level and readable by anything the upgrade guard trusts, so
   * nothing that is terminal CONTENT may ride one. A monotonically growing number tells the
   * cockpit "there is more", and it then reads the bytes over the same authenticated HTTP as
   * everything else. The registration disposes itself when the session goes, the way a tracker
   * watch does.
   */
  const registerTerminalTopic = (sessionId: string) => {
    if (!deps.socketHub) return;
    const read = () => ({ cursor: terminalSessions.read(sessionId, Number.MAX_SAFE_INTEGER)?.cursor ?? 0 });
    const remove = deps.socketHub.registerTopic(terminalTopic(sessionId), {
      snapshot: async () => read(),
      start: (publish) => terminalSessions.subscribe(sessionId, () => publish(read())),
    });
    // The registry forgets an exited session a minute later; drop the topic with it rather than
    // leaving a name that answers forever.
    terminalSessions.subscribe(sessionId, () => {
      if (!terminalSessions.get(sessionId)) remove();
    });
  };

  /** The session named by this URL, but only if it really belongs to the run named by this URL. */
  const terminalFor = ({ id, sessionId }: { id: string; sessionId: string }): TerminalSessionInfo | null => {
    const session = terminalSessions.get(sessionId);
    return session && session.runId === id ? session : null;
  };

  /**
   * The workspace terminal (spec `.ai/specs/2026-10-07-task-workspace.md` §6, Milestone 2).
   *
   * Every route answers 409 unless `capabilities().terminal` allows a shell here — policy first,
   * before anything touches a PTY. A session is addressed by id but ALWAYS re-checked against the
   * run in the path, so one task's url can never drive another task's shell.
   *
   * Output is never pushed over the WebSocket. The topic carries a cursor and nothing else; the
   * bytes come back over the same authenticated HTTP the rest of the cockpit uses. That keeps
   * terminal content off a workspace-level bus entirely — the hub's topics are single-mount and
   * readable by anything the upgrade guard trusts, and a shell's output is the last thing that
   * should ride one.
   */
  const terminalRoutes = new Hono<ProjectApiEnv>()
    .get('/runs/:id/terminal', async (c) => {
      const { store } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      const refusal = terminalPolicyRefusal(capabilities());
      if (refusal) return c.json(terminalStateSchema.parse({ available: false, reason: refusal, sessions: [] }));
      const binding = await loadPty();
      // One `ps` reading names every tab and answers "is anything running" for all of them.
      terminalSessions.observe(await processSnapshot());
      return c.json(terminalStateSchema.parse({
        available: binding.available,
        ...(binding.available ? {} : { reason: binding.reason }),
        sessions: terminalSessions.listFor(run.id).map(withTopic),
        // What a new tab may be opened with (spec §6, "shell selection"). Sent only when the PTY
        // is actually available, because a cockpit that cannot open a terminal has no use for a
        // list of shells it cannot spawn.
        ...(binding.available ? { shells: discoverShells() } : {}),
      }));
    })
    .post('/runs/:id/terminal', jsonZodValidator(terminalCreateSchema), async (c) => {
      const { root: repoRoot, store } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      const refusal = terminalPolicyRefusal(capabilities());
      if (refusal) return c.json({ error: refusal }, 409);
      // The task's OWN tree or nothing. Falling back to the repo root the way open-in-cli
      // does would put the user in the boot checkout while the header says they are in a task —
      // exactly the "panels must not silently display the boot repo" rule (spec §3.3). A
      // worktree-off task is not that fallback: the repo checkout IS the tree it ran in.
      const cwd = workingDirectoryOf(run, repoRoot);
      if (!cwd) {
        return c.json({ error: 'this task has no worktree to open a terminal in' }, 409);
      }
      const { agent: _agent, ...body } = c.req.valid('json');
      const created = await terminalSessions.create({
        runId: run.id,
        cwd,
        ...body,
      });
      if (!created.ok) return c.json({ error: created.reason }, 409);
      registerTerminalTopic(created.session.id);
      return c.json(terminalSessionSchema.parse(withTopic(created.session)), 201);
    })
    .get(
      '/runs/:id/terminal/:sessionId/output',
      paramZodValidator(terminalSessionParamsSchema),
      queryZodValidator(terminalOutputQuerySchema),
      async (c) => {
        const session = terminalFor(c.req.valid('param'));
        if (!session) return c.json({ error: 'terminal session not found' }, 404);
        // Policy is re-checked on the READ too, not only on create and write: `ONNI_TERMINAL` is
        // read live, so turning it off must stop a session's output being served from under a
        // cockpit that is no longer allowed one — a shell's scrollback is the content this flag
        // exists to withhold.
        const outputRefusal = terminalPolicyRefusal(capabilities());
        if (outputRefusal) return c.json({ error: outputRefusal }, 409);
        const read = terminalSessions.read(session.id, c.req.valid('query').cursor ?? 0);
        if (!read) return c.json({ error: 'terminal session not found' }, 404);
        c.header('Cache-Control', 'no-store');
        return c.json(terminalOutputSchema.parse(read));
      },
    )
    .post(
      '/runs/:id/terminal/:sessionId/input',
      paramZodValidator(terminalSessionParamsSchema),
      jsonZodValidator(terminalInputSchema),
      async (c) => {
        const session = terminalFor(c.req.valid('param'));
        if (!session) return c.json({ error: 'terminal session not found' }, 404);
        const refusal = terminalPolicyRefusal(capabilities());
        if (refusal) return c.json({ error: refusal }, 409);
        // A write to a shell that has already exited is not an error: the client may not have
        // learned about the exit yet, and the exit code is in every output read anyway.
        return c.json({ delivered: terminalSessions.write(session.id, c.req.valid('json').data) });
      },
    )
    .post(
      '/runs/:id/terminal/:sessionId/resize',
      paramZodValidator(terminalSessionParamsSchema),
      jsonZodValidator(terminalResizeSchema),
      async (c) => {
        const session = terminalFor(c.req.valid('param'));
        if (!session) return c.json({ error: 'terminal session not found' }, 404);
        const resizeRefusal = terminalPolicyRefusal(capabilities());
        if (resizeRefusal) return c.json({ error: resizeRefusal }, 409);
        const { cols, rows } = c.req.valid('json');
        return c.json({ resized: terminalSessions.resize(session.id, cols, rows) });
      },
    )
    .get('/runs/:id/terminal/urls', async (c) => {
      const { store } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      // Probed on read rather than on a timer: the list is only looked at while the drawer is
      // open, and an idle cockpit should cost no connections at all.
      const urls = await detectedUrls.refresh(run.id);
      c.header('Cache-Control', 'no-store');
      return c.json(detectedUrlsSchema.parse({ urls }));
    })
    .get('/runs/:id/terminal/commands', async (c) => {
      const { root: repoRoot, store, dataDir } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      // The task's own tree or nothing: suggesting the boot repo's scripts for a task would
      // offer commands that run against the wrong tree (spec §3.3). Same tree the terminal opens.
      const worktree = workingDirectoryOf(run, repoRoot);
      // A project with its own setup scripts (#1495) prepares its worktrees itself; the automatic
      // install is only for the zero-config project that has none.
      const setupScripts = (await readLifecycleConfigOrDefault(repoRoot)).config.afterCreate.length;
      const [commands, install] = worktree
        ? await Promise.all([discoverCommands(worktree), setupScripts > 0 ? null : installCommand(worktree)])
        : [[], null];
      const recipe = effectiveStartApp(await readStartApp(dataDir, repoRoot));
      return c.json(
        discoveredCommandsSchema.parse({ commands, ...(install ? { install } : {}), ...(recipe ? { recipe } : {}) }),
      );
    })
    // The project's start recipe (spec `2026-10-09-design-mode` §7c): the team's in the repo
    // config, the user's own in their registry entry. Writing one stores a command a terminal will
    // later run, so it is refused wherever the terminal is.
    .get('/start-app', async (c) => {
      const { root, dataDir } = c.get('project');
      return c.json(startAppStateSchema.parse(await readStartApp(dataDir, root)));
    })
    .put('/start-app', jsonZodValidator(startAppSetSchema), async (c) => {
      const refusal = terminalPolicyRefusal(capabilities());
      if (refusal) return c.json({ error: refusal }, 409);
      const { root, dataDir } = c.get('project');
      const { scope, recipe } = c.req.valid('json');
      try {
        if (!(await writeStartApp(dataDir, root, scope, recipe))) {
          return c.json({ error: 'This project is not in your project list, so it cannot keep a recipe of your own.' }, 409);
        }
      } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'The start recipe could not be saved' }, 409); }
      return c.json(startAppStateSchema.parse(await readStartApp(dataDir, root)));
    })
    // Deliberately NOT policy-gated: stopping a shell is the one terminal action that reduces
    // exposure, and refusing it with the flag off would strand a running process tree with no
    // way to reach it.
    .delete('/runs/:id/terminal/:sessionId', paramZodValidator(terminalSessionParamsSchema), async (c) => {
      const session = terminalFor(c.req.valid('param'));
      if (!session) return c.json({ error: 'terminal session not found' }, 404);
      terminalSessions.kill(session.id);
      return c.json({ stopped: true });
    });

  /**
   * The project terminal: the same shells as a task's, owned by the PROJECT and opened in its
   * root — a plain terminal inside the cockpit for running agent CLIs by hand. Nothing here is a
   * run: no worktree, no record, and none of an unattended run's fences (push guard, deny rules,
   * limits). Same policy gate and same cursor-based output as the task terminal.
   */
  const projectTerminalFor = (owner: string, sessionId: string): TerminalSessionInfo | null => {
    const session = terminalSessions.get(sessionId);
    return session && session.runId === owner ? session : null;
  };
  const projectTerminalRoutes = new Hono<ProjectApiEnv>()
    .get('/terminal', async (c) => {
      const owner = projectTerminalOwner(c.get('project').id);
      const refusal = terminalPolicyRefusal(capabilities());
      if (refusal) return c.json(terminalStateSchema.parse({ available: false, reason: refusal, sessions: [] }));
      const binding = await loadPty();
      terminalSessions.observe(await processSnapshot());
      return c.json(terminalStateSchema.parse({
        available: binding.available,
        ...(binding.available ? {} : { reason: binding.reason }),
        sessions: terminalSessions.listFor(owner).map(withTopic),
        ...(binding.available ? { shells: discoverShells() } : {}),
      }));
    })
    .post('/terminal', jsonZodValidator(terminalCreateSchema), async (c) => {
      const project = c.get('project');
      const refusal = terminalPolicyRefusal(capabilities());
      if (refusal) return c.json({ error: refusal }, 409);
      const { agent, ...body } = c.req.valid('json');
      const created = await terminalSessions.create({
        runId: projectTerminalOwner(project.id),
        cwd: project.root,
        // A fixed tab name for an agent tab, so the process table does not rename it to the shell.
        ...(agent ? { agent, label: agent } : {}),
        ...body,
      });
      if (!created.ok) return c.json({ error: created.reason }, 409);
      registerTerminalTopic(created.session.id);
      // Typed into the shell rather than spawned in place of it: when the agent exits the tab keeps a prompt.
      if (agent) terminalSessions.write(created.session.id, `${AGENT_COMMAND[agent]}\r`);
      return c.json(terminalSessionSchema.parse(withTopic(created.session)), 201);
    })
    .get(
      '/terminal/:sessionId/output',
      paramZodValidator(terminalProjectSessionParamsSchema),
      queryZodValidator(terminalOutputQuerySchema),
      async (c) => {
        const session = projectTerminalFor(projectTerminalOwner(c.get('project').id), c.req.valid('param').sessionId);
        if (!session) return c.json({ error: 'terminal session not found' }, 404);
        const refusal = terminalPolicyRefusal(capabilities());
        if (refusal) return c.json({ error: refusal }, 409);
        const read = terminalSessions.read(session.id, c.req.valid('query').cursor ?? 0);
        if (!read) return c.json({ error: 'terminal session not found' }, 404);
        c.header('Cache-Control', 'no-store');
        return c.json(terminalOutputSchema.parse(read));
      },
    )
    .post(
      '/terminal/:sessionId/input',
      paramZodValidator(terminalProjectSessionParamsSchema),
      jsonZodValidator(terminalInputSchema),
      async (c) => {
        const session = projectTerminalFor(projectTerminalOwner(c.get('project').id), c.req.valid('param').sessionId);
        if (!session) return c.json({ error: 'terminal session not found' }, 404);
        const refusal = terminalPolicyRefusal(capabilities());
        if (refusal) return c.json({ error: refusal }, 409);
        return c.json({ delivered: terminalSessions.write(session.id, c.req.valid('json').data) });
      },
    )
    .post(
      '/terminal/:sessionId/resize',
      paramZodValidator(terminalProjectSessionParamsSchema),
      jsonZodValidator(terminalResizeSchema),
      async (c) => {
        const session = projectTerminalFor(projectTerminalOwner(c.get('project').id), c.req.valid('param').sessionId);
        if (!session) return c.json({ error: 'terminal session not found' }, 404);
        const refusal = terminalPolicyRefusal(capabilities());
        if (refusal) return c.json({ error: refusal }, 409);
        const { cols, rows } = c.req.valid('json');
        return c.json({ resized: terminalSessions.resize(session.id, cols, rows) });
      },
    )
    // Not policy-gated, for the reason the task terminal's delete is not.
    .delete('/terminal/:sessionId', paramZodValidator(terminalProjectSessionParamsSchema), async (c) => {
      const session = projectTerminalFor(projectTerminalOwner(c.get('project').id), c.req.valid('param').sessionId);
      if (!session) return c.json({ error: 'terminal session not found' }, 404);
      terminalSessions.kill(session.id);
      return c.json({ stopped: true });
    });

  const v1 = new Hono<ProjectApiEnv>()
    .use('*', resolveProjectScope)
    .route('/', launchKeyRoutes())
    .route('/', skillsRoutes({
      waitQuery,
      discoverSkills,
      gatedSkillsRepos,
      getTeamSkillsCached,
      refreshTeamSkills,
      waitForTeamSkills,
    }))
    .route('/', uiStateRoutes({ uiStateBody, maxBodySize: UI_STATE_BODY_LIMIT }))
    .route('/', workflowsRoutes)
    .route('/', planRoutes)
    .route('/', automationsRoutes)
    .route('/', webhookRoutes)
    .route('/', dispatchRoutes)
    .route('/', memoryRoutes)
    .route('/', runsRoutes)
    .route('/', draftRoutes)
    .route('/', layoutRoutes)
    .route('/', groupsRoutes({ pickSchema, stopTaskProcesses, legacyWorktreeMutation }))
    .route('/', openTargetsRoutes({ capabilities, detectOpenTargets, agentCliRunner, openApp }))
    .route('/', worktreesRoutes())
    .route('/', worktreeLifecycleRoutes({ stopTaskProcesses }))
    .route('/', todosRoutes({ capabilities, providerActionError }))
    .route('/', sseRoutes)
    .route('/', createGithubRoutes({ queryValue, refreshQuery }))
    .route('/', createTrackerRoutes({ trackers, trackerWatches, mutateTracker, trackerChanged }))
    .route('/', secretsRoutes({ secretsList, putSecret, deleteSecret, unregisteredSecrets }))
    .route('/', e2eRoutes)
    .route('/', createRepoRoutes({ queryValue, negotiate, fileFormats: FILE_FORMATS }))
    .route('/', configRoutes)
    .route('/', agentConfigRoutes)
    .route('/', terminalRoutes)
    .route('/', projectTerminalRoutes);

  // ---- chained family: the cross-project run index (workspace-level) -------
  const runsIndexRoutes = createRunsIndexRoutes({
    capabilities,
    resolveBootProject,
    listProjects,
    bootContext,
    bootRoot,
    contexts,
    currentUsage,
  });

  const dashboard = new DashboardReader({
    projects: async () => {
      const selector = capabilities().singleProject ? { projectId: await resolveBootProject() } : undefined;
      const projects = await listProjects(selector);
      const bootId = await resolveBootProject(projects);
      const summaries = projects.map((project) => {
        const owned = project.status === 'missing' ? undefined
          : project.id === bootId ? bootContext : contexts.peek(project.id);
        return { id: project.id, root: project.root, ...(owned ? { store: owned.store } : {}) };
      });
      // Dashboard observability includes the folder this server actually serves even
      // when the sidebar omits this unregistered launch folder (including task worktrees).
      // Its existing context is authoritative; a dashboard read never registers it.
      if (!summaries.some(project => project.id === bootId)) {
        summaries.unshift({ id: bootId, root: bootRoot, store: bootContext.store });
      }
      return summaries;
    },
    telemetryProjects: async () => {
      // Registry-only: no per-project probing, disk summaries, recovery, or new sampler.
      const registry = (await loadWorkspaceConfig()).projects;
      const bootId = await resolveBootProject(registry);
      const boot = { id: bootId, root: bootRoot, store: bootContext.store };
      if (capabilities().singleProject) return [boot];
      return [boot, ...registry.filter(p => p.id !== bootId).flatMap(p => {
        const owned = contexts.peek(p.id);
        return owned ? [{ id: p.id, root: p.root, store: owned.store }] : [];
      })];
    },
  });

  const offDashboardRegistry = workspaceEvents.on((event, data) => {
    if (event === 'project-removed') {
      const id = (data as { id?: unknown }).id;
      if (typeof id === 'string') dashboard.invalidateProject(id);
    }
  });
  deps.onDispose?.(() => { offDashboardRegistry(); dashboard.dispose(); });

  // Workspace-level families answer for the whole workspace, so they are single-mount: never a
  // project-scoped spelling, which would be a second surface to protect with no consumer.
  const workspaceV1 = new Hono()
    .route('/', healthRoutes)
    .route('/', modelsRoutes)
    .route('/', providersRoutes)
    .route('/', projectsRoutes)
    .route('/', agentProfilesRoutes)
    .route('/', previewRoutes)
    .route('/', workspaceConfigRoutes)
    .route('/', workspaceSecretsRoutes)
    .route('/', fsBrowseRoutes)
    .route('/', automationChecksRoutes)
    .route('/', runsIndexRoutes)
    .route('/', dashboardRoutes(dashboard, () => ({ tokens: capabilities().tokenUsageMetrics, cost: capabilities().costMetrics }), () => capabilities().automations))
    .route('/', workspaceEventsRoutes)

  // ---- mount ---------------------------------------------------------------
  // Scoped first, then the unscoped alias bound to the boot project. The paths are disjoint (no
  // route starts with `/p/`), so order between the two never decides a match — but the SPA
  // catch-all below must still come last. `route()` re-registers the sub-app's routes under
  // each prefix, handlers shared, internal order preserved.
  //
  // Workspace families mount LAST and that is load-bearing: mounting the project table also
  // mounts its `use('*')` scope resolver over the whole prefix, and Hono runs matched middleware
  // in registration order. `/health` in particular answers for the workspace, has no project to
  // resolve, and is the CORS-open discovery route — it must not sit behind the resolver.
  const routed = app

    .route(V1_SCOPED_PREFIX, v1)
    .route(V1_PREFIX, v1)
    .route(V1_PREFIX, workspaceV1);

  // ---- SPA catch-all -------------------------------------------------------
  // Last, so every route above still wins. Any other GET gets the cockpit shell:
  // react-router owns the route map, including the 404, so `/tasks/:id/changes`
  // cold-loads and survives a refresh instead of 404ing. `/api/*` and the static
  // files above resolve to `passthrough` and fall through to Hono's own 404 —
  // an unknown API path must never answer with HTML.
  // Without a web/dist build this serves the built-in build-hint page (dev-only
  // state — the published tarball ships web/dist), never a 404.
  routed.get('*', (c) => serveShell(c) ?? c.notFound());

  return routed;
}

export function startServer(deps: ServerDeps, port: number): ServerType & { shutdownLifecycle(): Promise<void> } {
  let shutdownPromise: Promise<void> | undefined;
  const workspaceEvents = deps.workspaceEvents ?? new WorkspaceEventBus();
  // The subscription hub rides the same HTTP server (one port, zero config):
  // createApp registers the topics, the `upgrade` hook below owns the socket.
  const socketHub = deps.socketHub ?? createSocketHub();
  const bootProjectId = deps.bootProjectId ?? 'default';
  // `pinned`: the boot project is served whether or not the registry holds it,
  // and since boot registration became seed-once it usually does NOT — then
  // `bootProjectId` is the `'default'` alias, which `listProjects()` can never
  // name, so the coordinator's own refresh sweep would evict the store opened
  // one line below and the boot folder's automations would silently stop being
  // scheduled while the cockpit kept showing them enabled. Registered or not,
  // pinning is the same statement: this process is serving that project.
  const automationCoordinator = new AutomationCoordinator({ listProjects, pinned: bootProjectId });
  const bootAutomationStore = automationCoordinator.store(bootProjectId, deps.repoRoot)!;
  const sharedContexts = deps.contexts ?? new ProjectContexts({
    listProjects,
    semaphore: deps.semaphore,
    automationStore: (projectId, root) => automationCoordinator.store(projectId, root)!,
  });
  // #801: GitHub automations are opt-in. Off, the flag must remove the BEHAVIOR and not merely
  // the UI — no scheduler, no GitHub polling, no launched runs — so every entry point into the
  // workspace scheduler below is gated on it. Read per call rather than captured, for the same
  // reason `capabilities()` is inside `createApp`: tests flip the variable between apps.
  const automationsEnabled = () => resolveCapabilities(deps.env ?? process.env, deps.bindHost).automations;
  let rescheduleAutomations = () => {};
  const appCleanups: Array<() => void> = [];
  const app = createApp({
    ...deps,
    onDispose: (cleanup) => { appCleanups.push(cleanup); deps.onDispose?.(cleanup); },
    contexts: sharedContexts,
    webhookPort: port,
    automationStore: bootAutomationStore,
    workspaceEvents,
    socketHub,
    automationsChanged: () => rescheduleAutomations(),
  });
  // SECURITY: default to loopback. This server executes agents locally and its endpoints are
  // same-origin-trusted (only /api/health is CORS-open); binding to a non-loopback host would
  // expose an agent-executing box to the network. `bindHost` exists only for a deliberate
  // hosted/VPS deployment (which also flips ONNI_REMOTE to gate the local-handoff endpoints) —
  // src/index.ts never passes it, so the loopback guarantee holds for the normal CLI.
  const server = serve({
    fetch: app.fetch,
    port,
    hostname: deps.bindHost ?? '127.0.0.1',
  });
  applyKeepAlive(server);
  // Every registered project gets a handle (spec 2026-09-14): `github` only when the remote is
  // on GitHub (github.com or Enterprise) — a project without one still fires its scheduled automations.
  const automationProjects = new Map<string, { root: string; github?: { owner: string; repo: string; host: string } }>();
  // A second instance from the one the HTTP routes use (out of scope here, built inside the app
  // function) — cheap: `createTrackerService` performs no I/O at construction, only a small
  // per-connection provider cache that duplicating costs nothing correctness-wise.
  const automationTrackers = createTrackerService();
  const registerAutomationProject = async (id: string, root: string): Promise<void> => {
    const parsed = parseRemote((await getRepoInfo(root))?.remote ?? '');
    automationProjects.set(id, { root, ...(parsed && isGithubHost(parsed.host) ? { github: { owner: parsed.owner, repo: parsed.repo, host: parsed.host } } : {}) });
  };
  const automationScheduler = new WorkspaceAutomationScheduler({
    coordinator: automationCoordinator,
    handle: (projectId, store): ProjectAutomationHandle | undefined => {
      const project = automationProjects.get(projectId);
      if (!project) return undefined;
      const contextOf = async () => {
        const bootId = deps.bootProjectId ?? 'default';
        return projectId === bootId
          ? { root: deps.repoRoot, manager: deps.manager, store: deps.store }
          : await sharedContexts.context(projectId);
      };
      const dispatchEnabled = resolveCapabilities(deps.env ?? process.env, deps.bindHost).dispatch;
      return {
        projectId,
        store,
        timeZone: localTimeZone(),
        ...(project.github ? { github: { ...project.github, poller: new GithubPoller({ host: project.github.host }) } } : {}),
        // Present unconditionally (unlike `github`, precomputed above from a sync remote parse):
        // whether the project actually has a tracker connection is resolved lazily, at poll time,
        // by `getDriver()` — a project with none simply fails that call and the scheduler backs off.
        tracker: {
          poller: new TrackerPoller(),
          getDriver: () => automationTrackers.driver(project.root, join(project.root, '.ai/onni')),
        },
        onChange: (automationId, revision) =>
          workspaceEvents.emit('automation-change', { project: projectId, automationId, revision }),
        launch: async (definition, candidate, receiptId) => {
          const context = await contextOf();
          return launchAutomationRun({ root: context.root, manager: context.manager, store: context.store, definition, candidate, receiptId, dispatchEnabled });
        },
        deferredHoldUntil,
        validateDeferred: async definition => validateDeferredBinding(project.root, definition),
        deferredRunIds: async (id, ids) => (await contextOf()).store.listPersistedRuns().filter(r => ids.includes(r.id) && r.automationTrigger?.automationId === id).map(r => r.id),
        launchSchedule: async (definition, occurrence, receiptId) => {
          const context = await contextOf();
          return launchScheduledRun({ root: context.root, manager: context.manager, store: context.store, definition, occurrence, receiptId, projectName: basename(context.root), timeZone: localTimeZone(), dispatchEnabled });
        },
        launchTracker: async (definition, candidate, receiptId) => {
          const context = await contextOf();
          return launchTrackerAutomationRun({ root: context.root, manager: context.manager, store: context.store, definition, candidate, receiptId, dispatchEnabled });
        },
      };
    },
  });
  // The scheduler is inert until `start()` anyway (it constructs `stopped`), but the gate is
  // stated here rather than inherited from that detail: a definition saved while the flag is off
  // must not even ask the coordinator to refresh.
  rescheduleAutomations = () => {
    if (!automationsEnabled()) return;
    void automationScheduler.reschedule();
  };
  const unsubscribe = workspaceEvents.on((event, data) => {
    if (event === 'project-added') {
      const project = (data as { project?: { id?: unknown; root?: unknown; status?: unknown } }).project;
      if (project && typeof project.id === 'string' && typeof project.root === 'string' && project.status !== 'missing') {
        void registerAutomationProject(project.id, project.root).then(() => rescheduleAutomations());
      }
    } else if (event === 'project-removed') {
      const id = (data as { id?: unknown }).id;
      if (typeof id === 'string') {
        automationCoordinator.remove(id);
        automationProjects.delete(id);
        rescheduleAutomations();
      }
    }
  });
  server.once('listening', () => {
    void listProjects().then((projects) => {
      if (shutdownPromise) return;
      const all = projects.some((project) => project.root === deps.repoRoot)
        ? projects : [{ id: deps.bootProjectId ?? 'default', root: deps.repoRoot, status: 'ok' as const }, ...projects];
      // #801: with automations off there is nothing to warm — no remote to resolve, no receipts
      // to reconcile, and above all no scheduler to start.
      if (!automationsEnabled()) return;
      void Promise.all(all.map(async (project) => {
        await registerAutomationProject(project.id, project.root);
        const automationStore = automationCoordinator.store(project.id, project.root);
        const runStore = project.id === (deps.bootProjectId ?? 'default')
          ? deps.store
          : sharedContexts.peek(project.id)?.store;
        if (automationStore && runStore) reconcileAutomationReceipts(automationStore, runStore);
        if (automationStore) rebaselineIdleAutomations(automationStore, (automationId, revision) => workspaceEvents.emit('automation-change', { project: project.id, automationId, revision }));
      })).then(() => { if (!shutdownPromise) automationScheduler.start(); }).catch(() => undefined);
    }).catch(() => undefined);
  });
  server.once('close', () => { for (const cleanup of appCleanups) cleanup(); unsubscribe(); automationScheduler.stop(); });
  socketHub.attach(server, (req) => verifyWsUpgrade(req, deps.bindHost));
  return Object.assign(server, {
    shutdownLifecycle(): Promise<void> {
      if (shutdownPromise) return shutdownPromise;
      // Stop HTTP admission and automatic task sources before draining detached scripts.
      server.close();
      automationScheduler.stop();
      shutdownPromise = (async () => {
        const results = await Promise.allSettled([deps.manager.lifecycle.shutdown(), sharedContexts.shutdownAll()]);
        deps.manager.dispose();
        deps.store.flush({throwOnError: true});
        const failure = results.find(result => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
      })();
      return shutdownPromise;
    },
  });
}

/**
 * The WebSocket twin of the `/api/*` request-origin guard (#426), applied
 * before the `/api/v1/ws` handshake. WebSocket is NOT subject to CORS — any web
 * page may open `ws://127.0.0.1:<port>/api/v1/ws` and, unlike a forced HTTP GET,
 * would get to READ what comes back — so this guard is load-bearing:
 *
 *   1. Host allowlist (local mode): a non-loopback Host is a DNS-rebound
 *      request; kill it before the handshake. Same anchored
 *      `isLoopbackHostHeader` rules as the HTTP guard.
 *   2. Origin check: browsers always attach `Origin` to a WS handshake. A
 *      same-authority Origin is the cockpit itself. A LOOPBACK origin with a
 *      loopback Host is also admitted — that is the `npm run dev` Vite proxy
 *      (`changeOrigin` rewrites Host, the browser's `localhost:5173` Origin
 *      survives). Unlike the HTTP write guard we cannot REQUIRE `Sec-Fetch-Site`
 *      here — Safari sends no `Sec-Fetch-*` at all and requiring it would lock
 *      the dev proxy out of it — but we do honor it when it is there: Chromium
 *      does send it on a WS handshake, and page JS cannot forge it (forbidden
 *      header name), so a cross-port attacker page announcing `same-site` is
 *      rejected on the browser that ships it while Safari/Firefox still fall
 *      back to the loopback rule. Best available, not fail-open.
 *      No Origin at all is a non-browser client — same stance as the HTTP guard.
 *
 * The loopback-origin fallback still admits, on a browser that sends no
 * `Sec-Fetch-Site`, a page served from ANOTHER loopback port. That is no longer
 * a caveat the caller must remember: the verdict carries a `trusted` flag, and
 * the hub only lets an UNtrusted connection subscribe to topics a publisher
 * marked `loopbackReadable`. `health` is flagged so (the CORS-open discovery
 * payload, #431); every other topic stays trusted-only by default, so a topic
 * carrying run or repo content is mechanically unreachable from a foreign local
 * page without any per-topic vigilance. A connection is `trusted` when it is
 * provably the cockpit itself: a same-authority Origin, a no-Origin native
 * client, or a dev proxy the browser vouches for via `Sec-Fetch-Site`.
 */
export function verifyWsUpgrade(req: IncomingMessage, bindHost?: string): WsUpgradeVerdict {
  const host = req.headers.host;
  const hostName = hostnameOfHost(host);
  const hosted = !resolveCapabilities(process.env, bindHost).localHandoff;
  if (!hosted && !isLoopbackHostHeader(hostName)) return false;
  const origin = req.headers.origin;
  if (origin === undefined) return { trusted: true }; // non-browser client — no Origin to spoof
  // Scheme-checked, like the HTTP guard's comparison: `authorityOfOrigin` is
  // null for anything that is not an http(s) URL, so the opaque `"null"` origin
  // of a sandboxed iframe AND a `ftp://127.0.0.1`-shaped one both stay out
  // rather than reaching the loopback test below on hostname alone.
  const originAuthority = authorityOfOrigin(origin);
  const originHost = hostnameOfOrigin(origin);
  if (originAuthority === null || !originHost) return false;
  if (originAuthority === authorityOfHost(host)) return { trusted: true }; // the cockpit itself
  // The dev-proxy fallback. An explicit `cross-site`/`same-site` is an attacker
  // page on another local port and is refused even though both ends are
  // loopback; anything else needs loopback on both ends to get in at all.
  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite !== undefined && fetchSite !== 'same-origin') return false;
  if (!isLoopbackHostHeader(originHost) || !isLoopbackHostHeader(hostName)) return false;
  // Loopback on both ends, admitted. If the browser vouches it is same-origin
  // (`Sec-Fetch-Site: same-origin`, unforgeable by page JS), this is the dev
  // proxy on Chromium → trust it. An ABSENT header is a browser that ships no
  // metadata (Safari/Firefox), where the dev proxy and a foreign local page are
  // indistinguishable: admit as UNTRUSTED so only `loopbackReadable` topics show.
  return { trusted: fetchSite === 'same-origin' };
}

/** The bare hostname of a `Host` header — see `normalizeHostname`. `''` when the
 *  header is absent, which no allowlist matches. */
function hostnameOfHost(host: string | undefined): string {
  return host ? normalizeHostname(host) : '';
}

/** The `hostname:port` authority of a `Host` header, e.g. `127.0.0.1:4321`.
 *
 *  The port is kept verbatim and is `''` when the header omits it — which is
 *  exactly when a browser also omits it from `Origin` (both drop the scheme's
 *  default port). That symmetry is what lets us compare the two without knowing
 *  our own scheme, which we cannot know behind a TLS-terminating proxy. */
function authorityOfHost(host: string | undefined): string {
  if (!host) return '';
  const port = host.match(/^\[[^\]]*\]:(\d+)$/)?.[1] ?? host.match(/^[^:]*:(\d+)$/)?.[1] ?? '';
  return `${normalizeHostname(host)}:${port}`;
}

/** The `hostname:port` authority of an `Origin` header, or `null` when it is not
 *  a parseable http(s) URL (the opaque `"null"` origin of a sandboxed iframe, a
 *  `file://` page). `URL.port` is `''` for a scheme's default port, matching
 *  `authorityOfHost`. */
function authorityOfOrigin(origin: string): string | null {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${normalizeHostname(u.hostname)}:${u.port}`;
  } catch {
    return null;
  }
}

/** The hostname of an `Origin` header, or `null` when it is not a parseable URL
 *  (e.g. the opaque `"null"` origin of a sandboxed iframe). Normalized through
 *  the same path as `hostnameOfHost` so the two compare equal for IPv6 and for
 *  trailing-dot FQDNs. */
function hostnameOfOrigin(origin: string): string | null {
  try {
    return normalizeHostname(new URL(origin).hostname);
  } catch {
    return null;
  }
}

function resolveWebDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // here = <pkg>/dist/server (built) or <pkg>/src/server (tsx dev).
  return join(here, '..', '..', 'web');
}

/**
 * The session id shape every backend actually mints: UUIDs (claude/codex) and
 * the CLIs' own slug-ish ids. No character here is special to bash, AppleScript
 * OR cmd.exe, and a leading `-` is refused so the id can never be read as an
 * option by the CLI it is passed to (same dash-guard as `isSafeGitRef`, #431).
 * Bounded, like every other input that reaches a spawned process.
 */
const SAFE_SESSION_ID = /^[A-Za-z0-9._][A-Za-z0-9._-]{0,199}$/;

/** True for session ids safe to splice into the take-over command (see above). */
export function isSafeSessionId(sessionId: string): boolean {
  return SAFE_SESSION_ID.test(sessionId);
}

/** Only plain executable paths can cross both bash and cmd.exe safely. Refuse shell
 * operators, expansions, controls and a trailing backslash (which can escape the closing
 * quote). Paths with spaces remain supported, including Windows install directories. */
export function quoteResumeBin(bin: string): string | null {
  if (!bin.trim() || !/^[a-zA-Z0-9_./:\\ -]+$/.test(bin) || bin.endsWith('\\')) return null;
  return /[\s\\]/.test(bin) ? `"${bin}"` : bin;
}

/**
 * The CLI command that reopens a run's session for interactive take-over, per
 * backend. Legacy/undefined records default to Claude. Returns null when the id
 * is not a shape we recognise, or when a runner's overridable binary cannot be
 * embedded safely (see {@link quoteResumeBin}) — callers degrade (no take-over)
 * rather than splice either one into a shell.
 *
 * Validate, don't quote (#431): the session id is the only variable spliced
 * into the command string, and `openInTerminal` runs that string through bash
 * on darwin/linux but through `cmd /K` on win32. cmd.exe does not treat `'` as
 * a quote character, so POSIX-quoting the id handed Windows users a literal
 * `claude --resume '9f8e…'` and Claude answered "no conversation found".
 * Constraining the charset to one with no metacharacter in ANY of those shells
 * needs no quoting at all and fails closed on an unexpected id — a stronger
 * guarantee than escaping, and platform-independent. Ids are UUID/CLI-minted
 * today; this keeps a future source safe.
 */
export function resumeCommand(runner: string | undefined, sessionId: string): string | null {
  if (!isSafeSessionId(sessionId)) return null;
  switch (runner) {
    case 'junie':
      // Verified live (`junie --help`, 26.9.22): `--resume` alone reopens the LAST session;
      // the target session is named by the separate `--session-id=<id>` flag, not a positional
      // argument (junie's positional slot is `[<task>]`) — `junie --resume ${sessionId}` would
      // silently resume the wrong session and read the id as a task prompt instead.
      return `junie --resume --session-id=${sessionId}`;
    case 'codex':
      return `codex resume ${sessionId}`;
    case 'opencode':
      return `opencode --session ${sessionId}`;
    case 'cursor': {
      const bin = quoteResumeBin(resolveCursorAgentBin());
      return bin === null ? null : `${bin} --resume ${sessionId}`;
    }
    case 'antigravity': {
      // `--conversation` reopens that conversation interactively (`agy --help`); the id is agy's own.
      const bin = quoteResumeBin(resolveAntigravityBin());
      return bin === null ? null : `${bin} --conversation ${sessionId}`;
    }
    case 'pi':
      return `pi --session ${sessionId}`;
    case 'copilot':
      // `--resume <id>` takes a session id, a task id or an id prefix (`copilot --help`, 1.0.88).
      return `copilot --resume ${sessionId}`;
    case 'cline':
      // `--id <session-id>` resumes a session; `--tui` makes it interactive (`cline --help`, 3.0.74).
      return `cline --tui --id ${sessionId}`;
    default:
      return `claude --resume ${sessionId}`;
  }
}
