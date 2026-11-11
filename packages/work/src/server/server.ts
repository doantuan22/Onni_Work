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

import { deleteRunLayouts } from '../runs/layouts.ts';
import { DetectedUrls } from './terminal/detected-urls.ts';
import { TerminalSessions } from './terminal/sessions.ts';
import { createHash, randomUUID } from 'node:crypto';
import { AutomationStore } from '../automations/store.ts';
import { AutomationCoordinator } from '../automations/coordinator.ts';
import { GithubPoller } from '../automations/github-poller.ts';
import { TrackerPoller } from '../automations/tracker-poller.ts';
import { ProjectAutomationScheduler, ProjectTrackerAutomationScheduler, WorkspaceAutomationScheduler, type ProjectAutomationHandle } from '../automations/scheduler.ts';
import { ScheduleRunner } from '../automations/schedule-runner.ts';
import { automationStats } from '../automations/stats.ts';
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
import { access, constants as fsConstants, lstat, mkdir, realpath, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono, type Context } from 'hono';
import { groupsRoutes } from './routes/groups.ts';
import { openTargetsRoutes } from './routes/open-targets.ts';
import { todosRoutes } from './routes/todos.ts';
import { worktreesRoutes } from './routes/worktrees.ts';
import { createTerminalRouteHelpers, terminalRoutes as createTerminalRoutes } from './routes/terminal.ts';
import { projectTerminalRoutes as createProjectTerminalRoutes } from './routes/project-terminal.ts';
import type { Next } from 'hono';
import { serve, type ServerType } from '@hono/node-server';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { streamSSE } from 'hono/streaming';
import { multipartZodValidator, queryZodValidator } from './validators.ts';
import { createModelsRoutes } from './routes/models.ts';
import { hostedProfileRefusal, providerParamSchema, providersRoutes as createProvidersRoutes } from './routes/providers.ts';
import { agentProfilesRoutes as createAgentProfilesRoutes } from './routes/agent-profiles.ts';
import { projectIdSchema, projectsRoutes as createProjectsRoutes } from './routes/projects.ts';
import { workspaceConfigRoutes as createWorkspaceConfigRoutes } from './routes/workspace-config.ts';
import { runsIndexRoutes as createRunsIndexRoutes } from './routes/runs-index.ts';
import { createWorkspaceSearchRoutes } from './routes/workspace-search.ts';
import { createWorkspaceThreadsRoutes } from './routes/workspace-threads.ts';
export { brandingLogoUploadSchema } from './routes/workspace-config.ts';
export type { ProjectsResponse, RegisterProjectResponse, RemoveProjectResponse, UpdateProjectResponse } from './routes/projects.ts';
import { createFsBrowseRoutes } from './routes/fs-browse.ts';
import { createWorkspaceSecretsRoutes } from './routes/workspace-secrets.ts';
import { createPreviewRoutes } from './routes/preview.ts';
import { createHealthRoutes } from './routes/health.ts';
import { createDraftsRoutes } from './routes/drafts.ts';
import { createLayoutsRoutes } from './routes/layouts.ts';
import { createWorkspacePanesRoutes } from './routes/workspace-panes.ts';
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
import { createMemoryRoutes } from './routes/memory.ts';
import { createRunsRoutes } from './routes/runs.ts';
import { createAutomationChecksRoutes, type ManualCheck } from './routes/automation-checks.ts';
import { createAutomationsRoutes } from './routes/automations.ts';
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
import { attachmentInputSchema, deleteUploadResponseSchema, isImageAttachmentName, MAX_ATTACHMENTS_PER_MESSAGE, MAX_ATTACHMENTS_TOTAL_BASE64, stagedUploadSchema, uploadIdParamSchema, openProjectInSchema, updateProjectInputSchema } from '@onni/contract';


import { agentUsageOverview } from '../workspace/usage-overview.ts';


import { detectEnvironment } from '../core/backend-detect.ts';
import { resolveCursorAgentBin } from '../core/cursor-bin.ts';
import { hostUsageSampler, type HostSampler } from '../core/host-usage.ts';



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


import { discoverSkills } from '../skills.ts';
import { DesignProxies } from './preview/design-proxy.ts';
import { getTeamSkillsCached, isSafeRef, refreshTeamSkills, safeRemoteFor, waitForTeamSkills } from '../skills-remote.ts';

import { markStarted } from '../todos.ts';
import type { RunEvent, RunRecord, RunStatus, RunStore } from '../runs/store.ts';


import { type RunManager } from '../workflows/run.ts';


import { deleteUpload, writeUpload } from '../uploads.ts';
import { diskHealth } from './disk-health.ts';
import { branchesCheckedOutElsewhere, removeWorktree } from '../git-worktree.ts';
import { protectedByLiveTree } from '../runs/retention.ts';
import { worktreeLifecycleRoutes } from './worktree-lifecycle.ts';
import { readLifecycleConfigOrDefault } from '../worktree-lifecycle/config.ts';
import { getRepoInfo } from './git.ts';
import { createOrSwitchBranch, repoIndexContains } from './git-changes.ts';
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
import { defaultAgentProfile, listAgentProfiles, profileDirState, resolveStoredProfile, sameProfileDir, type ResolvedAgentProfile } from '../workspace/agent-profiles.ts';
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
import { refNumberFromUrl } from './github.ts';
import { ensureLaunchKey } from './launch-key.ts';
import { launchKeyRoutes } from './routes/launch-key.ts';
import { skillsRoutes } from './routes/skills.ts';
import { uiStateRoutes } from './routes/ui-state.ts';
import { secretsRoutes } from './routes/secrets.ts';
import { openInTerminal } from './open-in-terminal.ts';
import { agentCliRunner, detectOpenTargets, openFileInDefaultApp, openInApp } from './open-in-app.ts';


import { ProviderRuntimeAuthObserver } from './provider-auth-runtime.ts';


import { providersRequiredByWorkflow, unavailableProviderMessage, withSelectedAccounts, type ProviderAccountScope } from './provider-action-gate.ts';
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
export type RunsQueryValueSchema = typeof queryValue;

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

  const automationsRoutes = createAutomationsRoutes({
    requireAutomations,
    capabilities,
    automationsChanged,
    emitAutomationChange,
    automationCreateSchema,
    automationUpdateSchema,
    automationCheckRequestSchema,
    automationLogQuerySchema,
    automationKindIssue,
    oncePassedIssue,
    editableAutomation,
    launchFailedMessage,
    automationAccountIssue,
    trackerTriggerIssue,
    armAutomation,
    scheduleHandle,
    logRunsOf,
    manualChecks,
    trackers,
    AUTOMATIONS_OFF,
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

  const dispatchRoutes = createDispatchRoutes({ requireDispatch, providerActionError });

  const memoryRoutes = createMemoryRoutes({ requireDispatch });

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
  const terminalHelpers = createTerminalRouteHelpers({ capabilities, terminalSessions, socketHub: deps.socketHub });
  const terminalRoutes = createTerminalRoutes({
    capabilities, terminalSessions, detectedUrls, workingDirectoryOf, helpers: terminalHelpers,
  });

  const projectTerminalRoutes = createProjectTerminalRoutes({ capabilities, terminalSessions, helpers: terminalHelpers });

  const runsRoutes = createRunsRoutes({
    FILE_FORMATS,
    FILE_TYPES,
    IMAGE_TYPES,
    NO_WORKTREE,
    capabilities,
    deleteRunFully,
    handoffEnv,
    handoffFallbackCommand,
    legacyWorktreeMutation,
    negotiate,
    noteTodoStarted,
    openApp,
    openFile,
    openTerminal,
    providerActionError,
    queryValue,
    resolveWorkspaceProfile,
    resumeCommand,
    runPrNumbers,
    stopTaskProcesses,
    withUsage,
    withWorktreeMutation,
    workingDirectoryOf,
    worktreeOf,
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
    .route('/', createWorkspacePanesRoutes())
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
    .route('/', createAutomationChecksRoutes({ requireAutomations, listProjects, manualChecks }))
    .route('/', runsIndexRoutes)
    .route('/', createWorkspaceSearchRoutes({ listProjects, resolveBootProject, bootContext, bootRoot, contexts }))
    .route('/', createWorkspaceThreadsRoutes({ capabilities, resolveBootProject, listProjects, bootContext, contexts }))
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
