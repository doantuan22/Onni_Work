import {
  agentEnv as buildAgentEnv,
  agentEnvForStep as buildAgentEnvForStep,
  agentPermissionSpec as buildAgentPermissionSpec,
  enforceMemoryLimit as enforceMemoryLimitTask,
  makeRunTitle,
  privateMcpForLaunch as buildPrivateMcpForLaunch,
  recordNoteMeta as recordRunNoteMeta,
  startRun as createRun,
  startVariants as createVariants,
} from './run/start.ts';
import type { AgentStepActiveRun, AgentStepContext, CheckContext, ContinuationActiveRun, ContinuationContext, DispatchContext, DispatchTurnResult, ExecuteContext, ManagerControlContext, ManagerStateContext, MonitoringActiveRun, MonitoringContext, RedirectDispatchOrigin, StartContext, VerifyContext, VerifyDependencies } from './run/internal-types.ts';
import {
  AUTONOMOUS_NUDGE,
  AUTOSAVE_INTERVAL_MS,
  MAX_AUTO_CONTINUES,
  MAX_COMPACTION_CONTINUES,
  MONITORING_LIVENESS_MS,
  armAutosave as monitoringArmAutosave,
  armIdleTimer as monitoringArmIdleTimer,
  armMonitoringLivenessTimer as monitoringArmMonitoringLivenessTimer,
  armMonitoringWakeTimer as monitoringArmMonitoringWakeTimer,
  clearAutosaveTimer as monitoringClearAutosaveTimer,
  clearIdleTimer as monitoringClearIdleTimer,
  clearMonitoringLivenessTimer as monitoringClearMonitoringLivenessTimer,
  clearMonitoringWakeTimer as monitoringClearMonitoringWakeTimer,
  monitoringWakeCapReached as monitoringMonitoringWakeCapReached,
  parkMonitorAsWaiting as monitoringParkMonitorAsWaiting,
  periodicAutosaveEnabled,
  reconcileMonitoringWakeTimers as monitoringReconcileMonitoringWakeTimers,
  tryAutonomousNudge as monitoringTryAutonomousNudge,
  tryCompactionContinue as monitoringTryCompactionContinue,
} from './run/monitoring.ts';
export { AUTONOMOUS_NUDGE, AUTOSAVE_INTERVAL_MS, MAX_AUTO_CONTINUES, MONITORING_LIVENESS_MS, periodicAutosaveEnabled };
import { executeRun as runExecute } from './run/execute.ts';
import { retryBaselineCleanup as retryVerifyBaselineCleanup, verifyFor as verifyWorkerFor } from './run/verify.ts';
import {
  applyTemplate,
  captureCheckArtifacts,
  checkStepEnv as buildCheckStepEnv,
  CHECK_CONTEXT_VARS,
  currentCheckExclusions,
  expandRegistrySlashSkill,
  expandRegistrySlashSkillText,
  finishStep as finishCheckStep,
  leadingSlashSkillName,
  parseGithubItemUrl,
  runCheckStep as runCheckStepTask,
  skillSystemPrompt,
  sweepPrHeadRefs as sweepPrHeadRefsTask,
  TEAM_SKILLS_WAIT_MS,
} from './run/check-steps.ts';
export {
  CHECK_CONTEXT_VARS,
  expandRegistrySlashSkill,
  expandRegistrySlashSkillText,
  leadingSlashSkillName,
  parseGithubItemUrl,
  skillSystemPrompt,
};
import {
  abandonCancelledStart as lifecycleAbandonCancelledStart,
  cancel as lifecycleCancel,
  cancelAll as lifecycleCancelAll,
  cancelAndWait as lifecycleCancelAndWait,
  cancelOne as lifecycleCancelOne,
  dropActive as lifecycleDropActive,
  failOwnedContinuation as lifecycleFailOwnedContinuation,
  hasScheduledAutoResume as lifecycleHasScheduledAutoResume,
  isActive as lifecycleIsActive,
  recover as lifecycleRecover,
  setDeferred as lifecycleSetDeferred,
  waitInactive as lifecycleWaitInactive,
} from './run/lifecycle.ts';
import type { LifecycleActiveRun, LifecycleContext, MessageContext, SchedulingContext } from './run/internal-types.ts';
import {
  attachmentsDir as messageAttachmentsDir,
  deferMessage as messageDeferMessage,
  deliverMessage as messageDeliverMessage,
  dropOrphanImages as messageDropOrphanImages,
  editQueuedMessage as messageEditQueuedMessage,
  editTask as messageEditTask,
  enqueueMessage as messageEnqueueMessage,
  flushDeferred as messageFlushDeferred,
  hydrateQueuedContinuation as messageHydrateQueuedContinuation,
  hydrateQueuedInput as messageHydrateQueuedInput,
  isQueued as messageIsQueued,
  readPersistedAttachments as messageReadPersistedAttachments,
  removeQueuedMessage as messageRemoveQueuedMessage,
  sendMessage as messageSendMessage,
  toQueuedMessage as messageToQueuedMessage,
  withAnswerLead as messageWithAnswerLead,
} from './run/messages.ts';
import {
  continueRun as continueContinuation,
  finish as finishContinuation,
  runContinuation as runContinuationTask,
} from './run/continuation.ts';
import {
  applyTurnMarkers as applySettlementTurnMarkers,
  attachmentLibraryHint as settlementAttachmentLibraryHint,
  finishReview as finishSettlementReview,
  grantableAttachmentLibrary as settlementGrantableAttachmentLibrary,
  idleClosedFails as settlementIdleClosedFails,
  inactivityFailureMessage as settlementInactivityFailureMessage,
  land as landSettlement,
  landBeforeSettle as landSettlementBeforeSettle,
  landNow as landSettlementNow,
  landOnDone as landSettlementOnDone,
  landWithAgent as landSettlementWithAgent,
  landingFence as settlementLandingFence,
  landingPolicy as settlementLandingPolicy,
  latestRequest as settlementLatestRequest,
  maybeRefreshTitle as refreshSettlementTitle,
  parkForReview as parkSettlementForReview,
  persistAttachment as persistSettlementAttachment,
  persistPastedAttachments as persistSettlementPastedAttachments,
  prepareAttachmentLibrary as prepareSettlementAttachmentLibrary,
  recordTurnEnd as recordSettlementTurnEnd,
  recordUsagePeaks as recordSettlementUsagePeaks,
  reviewGateApplies as settlementReviewGateApplies,
  settleSuccess as settleRunSuccess,
  settleUnansweredPark as settleRunUnansweredPark,
  usableAttachmentLibrary as settlementUsableAttachmentLibrary,
  fileInAttachmentLibrary as settlementFileInAttachmentLibrary,
} from './run/settlement.ts';
import type { SettlementContext } from './run/internal-types.ts';
export { MAX_LAND_ATTEMPTS } from './run/settlement.ts';
export type { LandAnswer } from './run/settlement.ts';
import {
  scheduleAutoResumeIfLimited as schedulingScheduleAutoResumeIfLimited,
  failedBackend as schedulingFailedBackend,
  scheduleTransientRetry as schedulingScheduleTransientRetry,
  armUsageLimitResume as schedulingArmUsageLimitResume,
  armAutoResume as schedulingArmAutoResume,
  fireAutoResume as schedulingFireAutoResume,
  interruptedWorkflowStep as schedulingInterruptedWorkflowStep,
  queuedUsageLimitResume as schedulingQueuedUsageLimitResume,
  workflowInput as schedulingWorkflowInput,
  reconcileAutoResumes as schedulingReconcileAutoResumes,
  requeueWhileHeld as schedulingRequeueWhileHeld,
  rescueStalledQueue as schedulingRescueStalledQueue,
  refreshQueueReasons as schedulingRefreshQueueReasons,
  applyQueueReasons as schedulingApplyQueueReasons,
  accountHolds as schedulingAccountHolds,
  cancelAutoResume as schedulingCancelAutoResume,
  clearAutoResume as schedulingClearAutoResume,
  enforceRetention as schedulingEnforceRetention,
  parkRepoRoot as schedulingParkRepoRoot,
  claimFreeRepoRoot as schedulingClaimFreeRepoRoot,
  chainRepoRoot as schedulingChainRepoRoot,
  resumeRepoRoot as schedulingResumeRepoRoot,
  acquireRepoRoot as schedulingAcquireRepoRoot,
  startNow as schedulingStartNow,
  sweepLimits as schedulingSweepLimits,
  stopForLimit as schedulingStopForLimit,
  raiseAfterLimit as schedulingRaiseAfterLimit,
} from './run/scheduling.ts';
import {
  cancelFor as controlCancelFor,
  cancelRedirectSource as controlCancelRedirectSource,
  conflictsFor as controlConflictsFor,
  dispatchBudgetFor as controlDispatchBudgetFor,
  dispatchEnabled as controlDispatchEnabled,
  dispatchOf as controlDispatchOf,
  dispatchReachable as controlDispatchReachable,
  expireLostManagerDeliveriesAfterRestart as controlExpireLostManagerDeliveriesAfterRestart,
  expireUnacceptedManagerDeliveries as controlExpireUnacceptedManagerDeliveries,
  failRedirectOperation as controlFailRedirectOperation,
  finishRedirectOperation as controlFinishRedirectOperation,
  loadManagerSessionContext as controlLoadManagerSessionContext,
  managerDeliveryFor as controlManagerDeliveryFor,
  markQueuedManagerDeliveriesDelivered as controlMarkQueuedManagerDeliveriesDelivered,
  messageFor as controlMessageFor,
  peekEntry as controlPeekEntry,
  peekFor as controlPeekFor,
  prepareDispatchSession as controlPrepareDispatchSession,
  redirectDispatchInput as controlRedirectDispatchInput,
  redirectFailure as controlRedirectFailure,
  redirectFor as controlRedirectFor,
  recoverRedirectOperations as controlRecoverRedirectOperations,
  recordManagerDeliveryTransition as controlRecordManagerDeliveryTransition,
  recordManagerUserMessage as controlRecordManagerUserMessage,
  remainingForManager as controlRemainingForManager,
  repointQueuedDependents as controlRepointQueuedDependents,
  updateDispatch as controlUpdateDispatch,
} from './run/manager-controls.ts';


import {
  blockOrphanedDependents as dispatchBlockOrphanedDependents,
  cancelDescendants as cancelDispatchDescendants,
  dependencyState as dispatchDependencyState,
  dispatch as dispatchTask,
  dispatchFromAgent as dispatchFromAgentTask,
  notifyQuestionRetired as notifyQuestionRetiredTask,
  recordReport as recordDispatchReport,
  refreshQueuedDependencyEnvelope as refreshDispatchDependencyEnvelope,
  reportSettledChildToParent as reportDispatchSettledChildToParent,
  workerEntryFull as dispatchWorkerEntryFull,
} from './run/dispatch.ts';
import {
  ackPendingReport as ackManagerPendingReport,
  addManagerMemory as addManagerMemoryEntry,
  askUser as askManagerUser,
  assignPlanPart as assignManagerPlanPart,
  checkManagerComplexity as checkManagerTaskComplexity,
  clearPendingAsk as clearManagerPendingAsk,
  clearSoftAsk as clearManagerSoftAsk,
  flushInbox as flushManagerInbox,
  flushPendingReports as flushManagerPendingReports,
  handleDispatchTurn as handleManagerDispatchTurn,
  mergeFromAgent as mergeManagerFromAgent,
  notifyTreeInboxes as notifyManagerTreeInboxes,
  patchTreePlanPart as patchManagerTreePlanPart,
  readManagerMemory as readProjectManagerMemory,
  readTreePlan as readManagerTreePlan,
  recordAsk as recordManagerAsk,
  recordAttention as recordManagerAttention,
  recoverSoftAsks as recoverManagerSoftAsks,
  softAskFor as findManagerSoftAsk,
  writeManagerMemory as writeProjectManagerMemory,
  writeTreePlan as writeManagerTreePlan,
} from './run/manager-state.ts';
import {
  autoNameRun as autoNameRunTask,
  awaitGeneratedBranch as awaitGeneratedBranchTask,
  beginUsageInvocation as beginAgentStepUsageInvocation,
  handleRunnerUiEvent as handleAgentStepRunnerUiEvent,
  makeUiSink as makeAgentStepUiSink,
  persistUsageCheckpoint as persistAgentStepUsageCheckpoint,
  recordUsageUiEvent as recordAgentStepUsageUiEvent,
  runAgentStep as runAgentStepTask,
} from './run/agent-step.ts';
export { makeRunTitle };
import { WorktreeLifecycleCoordinator } from '../worktree-lifecycle/coordinator.ts';
import { DEFAULT_AGENT_PERMISSION_LEVEL, VERIFY_TOTAL_TIMEOUT_MS, CONFLICTS_FILES_MAX, CONFLICTS_MAX_PAIRS, CONFLICTS_TRIAL_MAX, type DispatchConflicts, type DispatchConflictWorker, type DispatchTrialMerge, type DispatchVerifyInput, type DispatchVerifyResult, MANAGER_MEMORY_MAX_BYTES, PEEK_ALL_MAX_CHARS_TOTAL, PEEK_FILES_MAX, PEEK_MAX_ENTRIES, PEEK_TAIL_MAX_CHARS_PER_LINE, PEEK_TAIL_MAX_LINES, REPORT_FILES_MAX, rosterWorkerKey, type AgentPermissionLevel, type DispatchPeek, type DispatchPeekEntry, type ManagerAskInput, type ManagerAskResponse, type ManagerMemoryAdd, type ManagerMemoryPut, type ManagerMemoryRead, type TreePlan, type TreePlanPatch, type TreePlanPut, type WebhookAttentionRequest, type TrackerAssociation, type UsageWindowsObservation } from '@onni/contract';
import { saveUsageWindows } from '../workspace/usage-windows.ts';
import { probeCodexIdentity, probeCodexUsageWindows } from '../core/codex-usage-probe.ts';
import { TrackerAgentBindingError } from '../server/tracker/agent-credentials.ts';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, realpath, access } from 'node:fs/promises';
import { assertOnniHomeWriteIsSandboxed, onniHomeDir } from '../paths.ts';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';
import {
  parseAskMarker,
  parseAskMarkerResult,
  stripAskMarker,
  type AskMarkerParseResult,
  type AskRequest,
} from '../core/ask.ts';
import { AUTO_END_DELAY_MS, type AgentSession } from '../core/claude-cli-runner.ts';
import { interruptAfterGrace, MISSING_SESSION_NOTE, ResumeFallback } from './resume-fallback.ts';
import {
  loadPrivateMcp,
  PRIVATE_MCP_FILE,
  skippedServersNote,
  supportsPrivateMcp,
  type PrivateMcpServer,
} from '../core/private-mcp.ts';
import { onUsage, registerRunProcess, unregisterRunProcess, type ProcessUsage } from '../core/process-usage.ts';
import { spawnTaskProcess } from '../core/task-process-spawn.ts';
import { processJobs } from '../core/process-jobs.ts';
import { BASH_MISSING_MESSAGE, resolveBash, withBashPath } from '../core/bash-path.ts';
import { utf8Collector } from '../core/utf8-chunks.ts';
import { parseUsageLimit } from '../core/usage-limit.ts';
import { diskFullAgentErrorText } from '../disk-space.ts';
import { accountStateHint, classifyAgentFailure, MAX_TRANSIENT_RETRIES, transientRetryDelayMs } from '../core/agent-failure-class.ts';
import { createRunner } from '../core/runner-factory.ts';
import type { RunnerId } from '../core/agent-runner.ts';
import { modelConflictsWithRunner, modelNativeToRunner } from '../core/model-presets.ts';
import { AGENT_MODELS_LOCKED_ERROR, agentModelsLocked } from '../core/agent-model-policy.ts';
import {
  ModelIdentityError,
  formatModelIdentity,
  normalizeModelForBackend,
} from '../core/model-identity.ts';
import {
  HANDOFF_ONLY_INSTRUCTIONS,
  HANDOFF_INSTRUCTIONS,
  appendHandoffHeartbeat,
  followupsEnabled,
  handoffPath,
  readHandoff,
  seedHandoffFile,
} from '../handoff.ts';
import { todosPath } from '../todos.ts';
import { continuePromptRefusal, messageText, queuedStackRefusal } from './queued-bounds.ts';
// Contract VALUES, like `workspaceUiStateSchema` in workspace/migrations.ts: the attachment
// vocabulary the routes validate with is the same one the engine stores and re-reads by, so the
// wire and the disk can never disagree about what counts as an image (#950).
import {
  attachmentExtension,
  isImageAttachmentName,
  storedAttachmentExtension,
  MANAGER_CANCEL_REASON_MAX_CHARS,
  MANAGER_DELIVERIES_MAX_OUTSTANDING,
  MANAGER_DELIVERIES_MAX_RETAINED,
  MANAGER_MESSAGE_MAX_CHARS,
  MANAGER_REDIRECT_INSTRUCTION_MAX_CHARS,
} from '@onni/contract';
import type { AgentEvent, AgentRunResult, ContentBlock } from '../core/agent-runner.ts';
import { discoverSkills, type Skill } from '../skills.ts';
import { automationsReachable } from '../automations/builtin-skill.ts';
import { AUTOMATIONS_PROMPT } from '../automations/prompts.ts';
import { getTeamSkillsCached, materializeSkillDir, waitForTeamSkills } from '../skills-remote.ts';
import { provisionSkills } from '../skills-provision.ts';
import { seedAgentConfigLocalLayer } from '../agent-config/seed.ts';
import { readAgentModelProvider } from '../agent-config/models.ts';
import { loadConfig, resolveWorktreeRetention, type OnniConfig } from '../config.ts';
import { isLifecycleConfigTracked } from '../worktree-lifecycle/config.ts';
import { generateCommitMessage } from './commit-message.ts';
import { hasUnlanded, landInPlace, landingPromptPart, READ_ONLY_PROMPT, READ_ONLY_TOOLS, type LandResult } from './landing.ts';
import { deleteRunLayouts } from '../runs/layouts.ts';
import {
  autosaveCommit,
  branchFor,
  chooseForkBase,
  commitAll,
  dropOnniDataPaths,
  localBranchAheadReadOnly,
  localBranchExists,
  pushBranch,
  resolveBaseRef,
  syncWithBase,
  uniqueBranchName,
  worktreeChangedFiles,
  worktreeChangedFilesReadOnly,
  worktreeDiff,
  worktreeHeadShort,
  worktreeShortstat,
  trialMergeTree,
} from '../git-worktree.ts';
import { commentOnIssue, commentOnPr, fetchGithubChecks, updatePr } from '../server/forge/github.ts';
import { createDraftPr } from '../server/pr.ts';
import { createOrSwitchBranch } from '../server/git-changes.ts';
import { getHeadCommit, getRepoInfo } from '../server/git.ts';
import { loadWorkflows, newerCatalogWorkflow } from './load.ts';
import type { QueuedMessage, RunRecord, RunStore, StepState } from '../runs/store.ts';
// Task dispatch (spec 2026-09-10-dispatch). Every import below is inert unless the feature is
// ON *and* the run carries a `dispatch`: `dispatchOf()` is the single gate, and a run without one
// takes byte-for-byte the path it took before this feature existed.
import type {
  DispatchBudget,
  DispatchInput,
  DispatchIntent,
  DispatchManagerCancelInput,
  DispatchManagerCancelResult,
  DispatchManagerDeliveryRecord,
  DispatchManagerDeliveryReasonCode,
  DispatchManagerDeliveryState,
  DispatchManagerMessageInput,
  DispatchManagerMessageResult,
  DispatchManagerRedirectFailure,
  DispatchManagerRedirectInput,
  DispatchManagerRedirectResult,
  DispatchOrderSnapshot,
  DispatchReport,
  RunDispatch,
} from '@onni/contract';
import { resolveCapabilities } from '../server/capabilities.ts';
import { composeDispatchPrompt } from '../dispatch/prompts.ts';
import { formatBudgetLine, toDispatchBudget } from '../dispatch/budget-format.ts';
import { orderPeekCandidates, peekTail, quietMinutesOf } from '../dispatch/peek.ts';
import { capOverlaps, findOverlaps, outsideScope, parseScope, scopeOf } from '../dispatch/conflicts.ts';
import { clampMemoryToTail, readManagerMemory, type MemoryWriteResult } from '../dispatch/memory.ts';
import { requireRootManager, requireSameTree, resolveRunRef, treeRootOf } from '../dispatch/access.ts';
import { runVerifyCommand } from '../dispatch/verify-exec.ts';
import { buildWorkerScorecard, formatWorkerScorecard } from '../dispatch/scorecard.ts';
import { MANAGER_SCORECARD_PROMPT_MAX_CHARS, PROMPT_MAX_CHARS } from '../dispatch/prompt-budget.ts';
import {
  appendLedger,
  notesSuggestions,
  readPlan,
  seedNotes,
  taskPaths,
  treeDir,
  treeEnvelopeLines,
  writeBrief,
  writeInboxMessage,
  writeOrder,
  writeReport,
} from '../dispatch/tree-fs.ts';
import {
  MAX_CHILDREN_IN_FLIGHT,
  childSettleReport,
  childTaskEnvelope,
  childrenOf,
  dispatchDepth,
  handoffSectionExcerpt,
  isTerminalStatus,
  IN_FLIGHT_STATUSES,
  remainingBudgetUsd,
  usd,
  withPendingReport,
} from '../dispatch/engine.ts';
import { reclaimWorktrees, rematerializeReclaimedWorktree } from '../runs/retention.ts';
import {
  AgentTempDirError,
  agentTmpEnv,
  removeAgentTmpDir,
  sweepAgentTmpDirs,
} from '../runs/agent-tmpdir.ts';
import { extractTaskRefs, refineTaskRefs, titleRefNumber } from '../runs/task-refs.ts';
import { parseTaskMarkers, stripTaskMarkers } from '../runs/task-markers.ts';
import { autoNamingActive, generateRunName, liveTitleUpdatesEnabled, NAMER_TIMEOUT_MS, postValidateTitle } from '../runs/auto-name.ts';
import { reviewGateEnabled } from '../runs/review-gate.ts';
import { resolveProfileEnvForRoot } from '../workspace/agent-profiles.ts';
import { DEFAULT_AGENT_ACCOUNT_ID } from '../workspace/agent-accounts.ts';
import { isUnattended } from './unattended.ts';
import type { MergeInput } from '@onni/contract';
import type { MergeOutcome } from './manager-merge.ts';
import {
  managerPrompt,
  resolveWorker,
  workerPrompt,
  workersInFlight,
  type ManagerSessionContext,
  type RemainingBudget,
} from './manager-worker.ts';
import { UNATTENDED_DENIED_TOOLS, pushGuardEnv, pushRefusal } from './push-guard.ts';
import { carveChildLimits, describeHit, evaluateLimits, raiseLimits, resolveLimits, subtreeOf, subtreeUsage } from './limits.ts';
import type { LimitHit, Roster, RunLimits, RunLimitsRequest } from '@onni/contract';
import { WorkspaceSemaphore, type AccountHolds } from '../workspace/semaphore.ts';
import { SecretStore } from '../workspace/secrets.ts';
import { loadWorkspaceConfig } from '../workspace/config.ts';
import { UiEventSink } from '../runs/ui-event-sink.ts';
import type { UiEvent } from '../core/ui-events.ts';
import {
  chainStepNote,
  DEFAULT_ALLOWED_TOOLS,
  retryableExit,
  stepKind,
  type WorkflowDef,
  type WorkflowStepDef,
} from './types.ts';
import { compileV1, stripVerdictMarker, type WorkflowGraph } from './graph.ts';

import {
  ATTACHMENT_ONLY_TASK,
  GLOBAL_INSTRUCTIONS_HEADING,
  PROJECT_INSTRUCTIONS_HEADING,
  VARIANT_HINTS,
  VARIANT_LETTERS,
  agentDirectories,
  attachmentLibraryDir,
  composeSystemPrompt,
  contentBlocksOf,
  copyToAttachmentLibrary,
  dispatchPromptPart,
  highestImageSeq,
  imageLibraryNames,
  mediaTypeFor,
  pastedAttachmentsNote,
  pastedAttachmentsText,
  resolveExtraSystemPrompt,
  toPastedContent,
  RESTART_CONTINUATION_PROMPT,
} from './run/preparation.ts';
import type { PersistedAttachment, PastedContent } from './run/preparation.ts';
import {
  awaitChildren as graphAwaitChildren,
  evaluateCondition as graphEvaluateCondition,
  executeGraph as executeGraphTask,
  findWorkflow as graphFindWorkflow,
  graphResumeSession as graphResumeGraphSession,
  parkForUser as graphParkForUser,
  parkGraphNode as graphParkGraphNode,
  provisionTaskSkills as graphProvisionTaskSkills,
  resumeInterruptedAgent as graphResumeInterruptedAgent,
  runFork as graphRunFork,
  runSystemNode as graphRunSystemNode,
  sessionCostUsd as graphSessionCostUsd,
} from './run/graph.ts';
import type { PendingContinuation, PersistedAttachments, PreparedUserMessage } from './run/internal-types.ts';
import type { GraphContext } from './run/internal-types.ts';
import type { QueueContext } from './run/internal-types.ts';
import {
  busySlots as queueBusySlots,
  enterMonitoring as queueEnterMonitoring,
  leaveMonitoring as queueLeaveMonitoring,
  oldestQueuedAt as queueOldestQueuedAt,
  pump as pumpQueue,
  releaseSlot as queueReleaseSlot,
  reviveQueuedRun as queueReviveQueuedRun,
} from './run/queue.ts';
export {
  ATTACHMENT_ONLY_TASK,
  GLOBAL_INSTRUCTIONS_HEADING,
  PROJECT_INSTRUCTIONS_HEADING,
  VARIANT_HINTS,
  VARIANT_LETTERS,
  agentDirectories,
  attachmentLibraryDir,
  composeSystemPrompt,
  contentBlocksOf,
  copyToAttachmentLibrary,
  dispatchPromptPart,
  highestImageSeq,
  mediaTypeFor,
  pastedAttachmentsNote,
  pastedAttachmentsText,
  resolveExtraSystemPrompt,
  toPastedContent,
};
export type { FileBlock, PersistedAttachment, PastedContent } from './run/preparation.ts';

/** Backends whose runner honors `resume` (AgentRunSpec) — graph `session.continue` and the
 *  verdict nudge need it. OpenCode always starts a new session; Cursor has no resume yet. */
const RESUMABLE_BACKENDS: ReadonlySet<RunnerId> = new Set<RunnerId>(['claude', 'codex', 'pi']);
/**
 * The reply to a one-question ask card without the card's own framing: a click on an option
 * sends `<header>: <label>` (`web/src/routes/task-thread/ask-card.tsx` `formatAnswer`), a typed
 * reply arrives as written. Gates and questions read the label, not the header.
 */
export function cardReply(text: string, header: string): string {
  const prefix = `${header}: `;
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

import { freshContinuationContext } from './continuation-context.ts';

const CHECK_OUTPUT_CAP = 20_000;

async function configuredModelProvider(
  backend: RunnerId,
  repoRoot: string,
): Promise<string | undefined> {
  return readAgentModelProvider(backend, repoRoot).catch(() => undefined);
}
/** Maximum time a live provider gets to honor cancellation before its slot is reaped. */
/** How long a settled task's agent CLI gets to exit on its own before its leftovers are reaped (#1411). */
/** `runs/<id><suffix>` holds how many messages `deferMessage` is holding for that run. */
/** How long a fork waits for the namer's branch (spec 2026-10-11-branch-naming-instructions).
 *  On an idle cockpit a task starts the instant it is created, so the wait begins together with
 *  the namer call — and a cold `claude -p` alone takes more than five seconds (run 269606ac
 *  forked on `onni/` with "not ready in time"). Sized to the namer's own timeout plus a margin. */
const BRANCH_NAME_WAIT_MS = NAMER_TIMEOUT_MS + 10_000;
/**
 * Task-completion marker from the agent contract (HANDOFF_INSTRUCTIONS): a
 * turn whose text ends with `ONNI:DONE` means "goal achieved, nothing to ask" —
 * the session is closed right away instead of parking at `waiting` (#347).
 * Detection runs on the accumulated turn text so delta-streaming backends
 * (codex, opencode) can't split the marker across text events.
 */
const DONE_MARKER_RE = /ONNI:DONE\s*$/;
/**
 * Still-working marker from the agent contract (spec
 * 2026-07-18-subagent-monitoring-status, #490): a turn whose text ends with
 * `ONNI:MONITORING` means "I ended this turn but I'm still working on my own
 * downstream work (a sub-agent / a command I'm monitoring), not waiting on the
 * user" — onni parks it as `running`/`activity:'monitoring'` instead of
 * `waiting`, so the cockpit shows a non-attention state. `ONNI:DONE` wins if both
 * appear. Detected on accumulated turn text (like `ONNI:DONE`) so delta-streaming
 * backends can't split the marker across text events.
 */
const MONITORING_MARKER_RE = /ONNI:MONITORING\s*$/;
/** An order that asks for verification — a files-only Antigravity worker cannot run any of it. */
const VERIFICATION_ASK_RE = /npm (run )?(test|build|lint|typecheck)|cargo (test|check)|pytest|go test|make test/i;
/**
 * Trailing task-reference marker lines — `ONNI:PR=` / `ONNI:ISSUE=` / `ONNI:TITLE=`
 * (spec 2026-07-18-task-ref-markers), whole lines, at the very end of the turn.
 *
 * #933: the handoff contract asks for those "as soon as you know which PR or issue
 * this task is ABOUT", and until now said nothing about where they sit relative to
 * the turn-end markers. An agent that declared its PR right AFTER `ONNI:MONITORING`
 * buried the marker behind them, the `$`-anchored test below failed, and a turn that
 * was only waiting on its own sub-agents parked as `waiting` — "needs you", the
 * "paused, waiting for your reply" footer, and a browser notification for work
 * nobody needs to look at. The contract now asks for the other order; this is the
 * engine half, so an agent that gets it wrong is still read correctly.
 *
 * Deliberately NOT `/m`: with the multiline flag `$` matches every line end, so the
 * pattern would also strip a task-reference line from the MIDDLE of a turn. `^|\n`
 * pins each line's start and the unanchored `$` pins the run of them to the end.
 *
 * Looser than `stripTaskMarkers`'s `MARKER_LINE` on the VALUE (`=[^\n]*`, not `=\d+`)
 * on purpose: a mistyped reference line is still the agent talking protocol, and the
 * failure it must not cause is burying the turn-end marker behind it.
 */
const TRAILING_TASK_MARKER_LINES_RE = /(?:(?:^|\n)[ \t]*ONNI:(?:PR|ISSUE|TITLE)=[^\n]*)+$/;
/**
 * The text a turn-end marker is matched against: the accumulated turn text with
 * trailing whitespace and trailing task-reference lines removed.
 *
 * ONE helper, because there are TWO near-identical turn-end handlers here
 * (`runContinuation` and `runAgentStep`) and AGENTS.md is explicit about them:
 * "a lifecycle change applied to one of them ships half a fix … route both sites
 * through one helper". Exported so the detection can be unit-tested directly
 * rather than only through a parked run.
 */
export function turnEndMarkerText(turnText: string): string {
  return turnText.trimEnd().replace(TRAILING_TASK_MARKER_LINES_RE, '').trimEnd();
}
/**
 * Did this turn end on the still-working marker? Strictly a SUPERSET of the old
 * `MONITORING_MARKER_RE.test(turnText.trimEnd())` — anything that parked as
 * `monitoring` before still does, which is what keeps #933 additive under
 * `BACKWARD_COMPATIBILITY.md` §8 (an already-emitted `ONNI:MONITORING` keeps
 * meaning exactly what it meant).
 */
export function endsWithMonitoringMarker(turnText: string): boolean {
  return MONITORING_MARKER_RE.test(turnEndMarkerText(turnText));
}
/** Strict superset of the historical DONE suffix check, accepting trailing task references. */
export function endsWithDoneMarker(turnText: string): boolean {
  return DONE_MARKER_RE.test(turnEndMarkerText(turnText));
}
/**
 * Preserve boundaries between complete assistant text blocks while a turn is
 * accumulated for marker parsing. The runners join these same v1 blocks with
 * newlines in `AgentRunResult`; matching that contract here prevents a
 * trailing `ONNI:TITLE=` block from absorbing later commentary (#623).
 */
export function appendTurnText(current: string, next: string): string {
  if (!current) return next;
  if (!next) return current;
  return `${current}\n${next}`;
}
/** Strip a trailing marker from one text event so transcripts stay free of
 *  protocol noise. Delta backends may split the marker across events — then
 *  it stays visible; detection above is unaffected. */
function stripDoneMarker(text: string): string {
  return text.replace(/\s*ONNI:DONE\s*$/, '');
}
/** Strip a trailing `ONNI:MONITORING` marker from one text event (see
 *  `stripDoneMarker`; same delta-backend caveat). */
function stripMonitoringMarker(text: string): string {
  return text.replace(/\s*ONNI:MONITORING\s*$/, '');
}
/**
 * What one finished turn decided about dispatch (spec 2026-09-10-dispatch) — the facts the park
 * decision and the autonomous nudge both need. `hasDispatch` is false for every ordinary run, and
 * then the others are false too.
 */
/** Emit the v2 `ask.requested` event for a parsed marker (the cockpit renders
 *  it as an ask card, #473). Returns the minted request id. */
function emitAskRequested(sink: UiEventSink, ask: AskRequest): string {
  const requestId = randomUUID();
  sink.handle({ type: 'ask.requested', requestId, questions: ask.questions });
  return requestId;
}
/** A persisted, non-fatal explanation for protocol-shaped text that could not
 * become an ask card. Never include the raw payload in this diagnostic. Carries
 * `tone: 'danger'` (#936): the agent's question was lost outright, which is not
 * a footnote — the cockpit renders an un-toned note as the dimmest line in the
 * thread. Older events carry no `tone` and keep rendering dim. */
function askMarkerRejection(result: AskMarkerParseResult): string | undefined {
  if (result.kind === 'invalid-json') {
    return 'structured question ignored — ONNI:ASK payload is not valid JSON';
  }
  if (result.kind !== 'invalid-structure') return undefined;
  const issue = result.issues[0];
  const location = issue?.path.length ? ` at ${issue.path.join('.')}` : '';
  return `structured question ignored — ONNI:ASK payload failed validation${location}${issue ? `: ${issue.message}` : ''}`;
}
/** A persisted, auditable trace for a card that only rendered because the
 * payload's missing closers were appended (#936) — a repair can only lose what
 * the truncation already removed, so the recovery must stay visible rather than
 * passing for a clean parse. Carries `tone: 'danger'` for the same reason the
 * rejection does: it is the ONLY signal that the card may be missing a trailing
 * option or a trailing `multiSelect` the cut took with it, and the raw payload
 * is stripped along with the card, so a dim footnote could not be acted on. */
function askMarkerRecovery(result: AskMarkerParseResult): string | undefined {
  return result.kind === 'valid' && result.repaired
    ? 'structured question recovered from an unbalanced ONNI:ASK payload — check the options, and how many you may pick, match what was asked'
    : undefined;
}
/** What a turn's trailing `ONNI:ASK` marker resolves to: the card to raise, and
 * the notes to persist alongside it. */
type AskTurnOutcome = {
  ask: AskRequest | null;
  /** Emitted in order by the caller, which owns how a note is persisted. */
  notes: Array<{ message: string; tone?: 'danger' }>;
};
/** Resolve the ask marker for one finished turn. Both turn-end handlers
 * (`runAgentStep` and `runContinuation`) route through this single function:
 * they are hand-duplicated, and `AGENTS.md` warns that a lifecycle change
 * applied to only one of them ships half a fix — the notes and their tones are
 * exactly that kind of change. `enabled` is the caller's own precondition (the
 * session is open, the turn is not a `ONNI:DONE`, and for an agent step, the run
 * is interactive); when false there is no marker to look for. */
function resolveAskTurn(turnText: string, enabled: boolean): AskTurnOutcome {
  if (!enabled) return { ask: null, notes: [] };
  const result = parseAskMarkerResult(turnEndMarkerText(turnText));
  const notes: AskTurnOutcome['notes'] = [];
  const rejection = askMarkerRejection(result);
  if (rejection) notes.push({ message: rejection, tone: 'danger' });
  const recovery = askMarkerRecovery(result);
  if (recovery) notes.push({ message: recovery, tone: 'danger' });
  return { ask: result.kind === 'valid' ? result.request : null, notes };
}
/**
 * Did this turn end WITHOUT any explicit onni marker (#955)? The precondition for the
 * compaction continuation, shared by both turn-end handlers so neither can drift on which
 * markers outrank it.
 *
 * Deliberately independent of the `done`/`ask`/`monitoring` decisions the callers compute:
 * those are gated on `interactive`, on the session still being open, and on whether the turn
 * dispatched, and every one of those gates can turn a marker the agent DID emit into a falsy
 * flag. "Did the agent say something" and "did onni act on it" are different questions, and
 * only the first one may authorize continuing a turn on the agent's behalf. A marker that
 * merely FAILED to parse still counts as spoken: `ONNI:ASK` with a malformed payload is a
 * question the user needs to see, not an invitation to keep going.
 */
function markerlessTurn(turnText: string): boolean {
  // Through `turnEndMarkerText` (#933), the same reading the monitoring decision uses: a turn
  // that ends `ONNI:MONITORING` followed by a `ONNI:PR=` line spoke, and must not be continued.
  const markerText = turnEndMarkerText(turnText);
  if (DONE_MARKER_RE.test(markerText) || MONITORING_MARKER_RE.test(markerText)) return false;
  // `parseAskMarkerResult`, not `ASK_MARKER_RE`: the strict regex only matches a marker whose
  // payload is a complete `{…}`, so `ONNI:ASK not-json` — a question the user still needs to
  // see — would read as ordinary prose and authorize a continuation. The parser's looser
  // `none` test is the right question here, and its known over-reach (an earlier PROSE mention
  // of the keyword also counts as spoken) errs towards parking, which is today's behavior.
  return parseAskMarkerResult(markerText).kind === 'none';
}
/**
 * Explicitly opt out of the repository-root lease for runs that execute in the
 * current checkout. This covers explicit worktree opt-out, non-Git degradation,
 * and continuations whose worktree cannot be restored (spec 006 hardening, #438).
 * This is intentionally unsafe: concurrent agents may overwrite each other's
 * files or Git state. Isolated worktree runs are unaffected.
 */
export function repositoryRootLockDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ONNI_DISABLE_REPO_LOCK === '1';
}

const REPOSITORY_ROOT_LOCK_DISABLED_NOTE =
  'repository-root lock disabled by ONNI_DISABLE_REPO_LOCK=1 (shared checkout is unsafe)';

const CONTINUABLE_STATUSES: readonly string[] = ['done', 'failed', 'cancelled', 'review'];

interface ContinueRunOptions {
  text?: string;
  images?: PastedContent[];
  runner?: RunnerId;
  model?: string;
  /** Agent account for the reopened session (spec 2026-07-29-agent-profiles). Omitted = the
   *  account the run is already on. */
  agentProfile?: string;
  /** Continue a run a ceiling stopped, extending the ceiling that was hit (user surfaces only). */
  raiseLimits?: boolean;
  /** The `requestId` of an open manager ask this continuation answers (plan v2 §9). Matching one
   *  clears it and names the question in the opening prompt. */
  replyTo?: string;
}

interface ActiveRun {
  /** Identity of this async owner; stale promises must not mutate a replacement owner. */
  ownerToken: symbol;
  cancelled: boolean;
  releaseWorktree?: () => void;
  interrupt: () => void;
  /** Where this run's steps execute: the task worktree, or the repo root. */
  cwd: string;
  /** Live claude session of the currently running agent step, if any. */
  session?: AgentSession;
  currentStepId?: string;
  /** Graph node parks with no agent session (spec 2026-09-30-workflow-node-editor, 1c):
   *  `deliverMessage` hands a user's reply to `graphAnswer`, `finish()` calls `graphFinish`,
   *  and a settling dispatch child resolves its entry in `graphChildWaits`. */
  graphAnswer?: (text: string) => void;
  graphFinish?: () => void;
  graphChildWaits?: Map<string, (child: { status: string; summary: string }) => void>;
  idleTimer?: NodeJS.Timeout;
  /** The inactivity watchdog closed this session; a plain final wait is not success evidence. */
  idleClosed?: boolean;
  /** The idle close was the unattended wait expiry (docs/design/unattended-safety.md §3). */
  waitExpired?: boolean;
  /** The user pressed Finish on this owner; a repeat while it settles is the same request (6a3cecee). */
  finishRequested?: boolean;
  /** Finish pressed at a graph wait — not `finishRequested`, which would also turn the settle into
   *  `done`; read only by `deferredStopReason` so a held message does not resume the run. */
  finishedAtWait?: boolean;
  /** Review accepted while the engine was still tearing down; `dropActive` applies it. */
  acceptReviewOnDrop?: boolean;
  /** The session is over and only teardown (the turn-end autosave) remains, so a record that
   *  reads settled really is — a Continue then waits in `continueOnDrop` (telemetry 77117b95). */
  turnSettled?: boolean;
  /** A Continue accepted during that teardown; `dropActive` starts it once the run lets go. */
  continueOnDrop?: { opts: ContinueRunOptions; deferForCapacity: boolean };
  monitoringWakeTimer?: NodeJS.Timeout;
  monitoringWakeIntervalMinutes?: number;
  monitoringWakeups?: number;
  monitoringLivenessTimer?: NodeJS.Timeout;
  /** Whether the current liveness timer was armed at the wake-up cap. A capped run may carry the
   *  liveness bound even with a wake interval configured, and every re-arm from the timer callback
   *  must keep that allowance — a one-shot option would drop it on the second window. */
  monitoringLivenessAtCap?: boolean;
  autosaveTimer?: NodeJS.Timeout;
  /** Check-owned path snapshots; changed content transfers ownership back to the agent. */
  autosaveExcludedPaths: Map<string, string>;
  /** Periodic autosave must not race a command before its ownership snapshot exists. */
  checkInProgress: boolean;
  /** A failed checkpoint cannot safely distinguish agent work from check residue. */
  autosaveCheckpointBlocked: boolean;
  cancellationTimer?: NodeJS.Timeout;
  /* The screenshot counter lives on `RunManager.queuedImageSeq` (#472), keyed by
   * run id — a queued run persists attachments with no `ActiveRun` at all. */
  /** Has a session EVER opened on this run (#472)? `session` alone cannot answer
   *  it — teardown sets it back to `undefined`, so a closed session and one that
   *  never opened look identical. This distinguishes "still starting up, buffer
   *  the message" from "genuinely closed, 409". */
  sessionEverOpened?: boolean;
  /** Autonomous mode (#autonomous): never park at `waiting` — auto-nudge the agent to keep
   *  going until it signals done or the safety cap is hit. */
  autonomous?: boolean;
  autoContinues?: number;
  /** Consecutive compaction-ended turns this session has been continued through (#955),
   *  bounded by `MAX_COMPACTION_CONTINUES`. Unlike `autoContinues` this is NOT a lifetime
   *  budget: any turn that ends for another reason resets it, because that turn is the proof
   *  the session is working again. See `tryCompactionContinue`. */
  compactionContinues?: number;
  /**
   * A NON-FINAL agent step emitted `ONNI:ASK` or `ONNI:MONITORING`, so the workflow
   * is parked on that step instead of advancing into its next check (#917, #1076).
   * Two values, because
   * the park has two endings and they settle differently:
   *
   *  - `'waiting'` — live: the session is open and an answer or monitored work is still expected.
   *    `execute` sits inside `runAgentStep` for as long as that holds, so seeing
   *    this value after the step loop means the session closed WITHOUT an answer
   *    (the idle timer, the runner timeout, a crash) and the run settles `failed`.
   *  - `'abandoned'` — the user pressed Finish instead of answering: "stop here",
   *    so the run settles like any other finished run.
   *
   * A delivered answer clears it (`deliverMessage`) and the workflow resumes.
   * ASK parks are mirrored durably onto the record as `RunRecord.askParked` for `recover()`;
   * monitoring parks are already durable as `status: 'running', activity: 'monitoring'`.
   * Never set on an autonomous run whose nudge outranked the ask — see
   * `tryAutonomousNudge` and the park in `runAgentStep`'s turn-end.
   */
  askPark?: 'waiting' | 'abandoned';
  /** The `waiting` park is a monitor handed to the user, not a `ONNI:ASK` question. */
  monitorHandoff?: boolean;
  /** The last `ONNI:ASK` the autonomous nudge overrode, as its joined question text. An agent
   *  that asks the SAME thing again right after being nudged is blocked on something the nudge
   *  cannot answer (a disabled capability, a missing credential), and parks instead of burning
   *  the remaining nudges — the live-session lesson behind `tryAutonomousNudge`. */
  lastOverriddenAsk?: string;
  /** Registry snapshot used to expand `/skill` follow-ups before a backend can
   *  mistake them for its own slash commands (#676). */
  skills?: Skill[];
  /** The attachment library actually granted to this session at spawn (#987). A library that
   *  appears later must not be advertised to a session whose fixed grant was absent. */
  grantedAttachmentLibrary?: string;
  /**
   * The dispatch prompt this session runs under (spec 2026-09-10-dispatch), resolved by
   * `prepareDispatchSession` — which BOTH construction sites call, because `ActiveRun` is built in
   * `execute` AND in `runContinuation` and a field only one of them populates is exactly the
   * half-fix AGENTS.md describes. Present ⇔ the feature is on. Anything that WRITES re-reads the
   * record instead, because the stored `dispatch` changes under us.
   */
  dispatchPrompt?: string;
  /**
   * The GitHub-automations prompt part this session runs under (spec
   * 2026-09-13-automations-from-prompt), resolved by `prepareAutomationsSession` at the SAME two
   * construction sites as `dispatchPrompt`, for the same reason. Present ⇔ automations are on and
   * the cockpit is reachable — a task that could not run `onni automation` is never told about it.
   */
  automationsPrompt?: string;
  /** Set by `dispatch()` during a turn, read and cleared at that turn's end: the run parks as a
   *  monitor for the children it just created. */
  dispatchedThisTurn?: boolean;
  /** The complexity-policy warning has fired for this run (once per run). */
  complexityWarned?: boolean;
  /** Release for exclusive execution in the user's repository working tree.
   *  Worktree-backed runs never need it; root runs ordinarily do unless the
   *  explicit unsafe bypass is active. */
  releaseRepoRoot?: () => void;
  /** Auto-land policy of an in-place run (spec 2026-10-20-trunk-based-projects). Set at BOTH
   *  construction sites (`execute`, `runContinuation`) through `landingPolicy`. */
  autoLand?: { checks: string[]; baseBranch?: string; baseLabel: string; attempts: number; inFlight?: Promise<LandResult> };
  /** A read-only Ask task: read-only tools, no repo-root lease. */
  readOnly?: boolean;
  /** An in-place run (`cwd === repoRoot`) that parked — on a question, or as a monitor waiting
   *  for its dispatched children — gives the exclusive working-tree lease back while it sits
   *  (`parkRepoRoot`), so other in-place tasks are not stuck behind a session that is not
   *  touching the tree. `deliverMessage` takes it back before the session resumes. */
  repoRootParked?: boolean;
  /** The one in-flight re-acquire, so several wake-ups arriving while it waits share it instead
   *  of each chaining a lease of its own behind the first (which would never be released). */
  repoRootResume?: Promise<boolean>;
  /** Durable directional-usage accounting state for the current runner
   * invocation. Provider-local turn ids are unique only within this epoch. */
  usageInvocation?: {
    stepId: string;
    epoch: number;
    observed: boolean;
    startedTurns: Set<string>;
    recordedTurns: Set<string>;
  };
}

/**
 * Handed to a dispatch-tree run that ran IN the repository working tree, parked, gave the
 * exclusive lease back (`parkRepoRoot`) and had to WAIT to get it again — meaning another in-place
 * task held it meanwhile and may have edited the tree (spec 2026-09-10-dispatch).
 *
 * Not sent on the fast path (`claimFreeRepoRoot`): a tree nobody else held cannot have changed, and
 * a warning on every wake-up is a warning nobody reads.
 */
const REPO_ROOT_RESUMED_NOTE =
  'While you were parked, another task held this repository working tree and may have changed files in it. Re-read anything you are about to edit or reason about before you act on it — your earlier view of the tree may be out of date.';

/**
 * Auto-resume after a provider usage limit (spec 2026-08-03-auto-resume-after-usage-limit).
 *
 * The wait is the provider's own reset instant plus this grace: resuming AT the boundary races the
 * provider's clock (and its rounding), and one failed resume costs the whole window over again.
 * Thirty seconds is cheap next to five hours and long enough to be past any sane skew.
 */
export const AUTO_RESUME_GRACE_MS = 30_000;
/**
 * Consecutive automatic resumes allowed without a human turn. A resume can only fire after a real
 * reset instant, so this is not a throttle — it is the backstop for the pathological case (a
 * provider that answers "limit reached, retry now" in a loop), and it is deliberately generous
 * enough to sit through a couple of days of five-hour windows.
 */
export const MAX_AUTO_RESUMES = 12;
/**
 * How long a missed deadline stays worth acting on. The promise is "we pick this up when the
 * window reopens" — kept across a restart or an overnight close, which is the case the feature
 * exists for. A day later it is no longer that promise: the user has moved on, and a task
 * springing back to life is a surprise rather than a service. Such a deadline is retired with a
 * note instead of fired, so the only tasks a sweep can revive are ones someone is still waiting on.
 */
export const AUTO_RESUME_MISSED_WINDOW_MS = 24 * 60 * 60_000;

/**
 * How often the queue checks that it is not wedged.
 *
 * A hold is the only thing in the engine that can make an idle queue CORRECT, so it is also the
 * only thing that can make a wedged one look correct. This tick is the way out: cheap (a few
 * in-memory checks), unref'd, and it only ever acts when idling has no justification left.
 */
export const QUEUE_WATCHDOG_MS = 60_000;

/** How often active wall-clock is accumulated and the run limits are checked. */
export const LIMIT_SWEEP_MS = 15_000;
/**
 * May this run start, given what its account is holding?
 *
 * The two kinds of hold bind different work, and getting that wrong has produced a bug in each
 * direction (spec 2026-08-03-auto-resume-after-usage-limit):
 *
 *  - a `deadline` hold means the window is KNOWN shut until an instant, so it blocks everything
 *    on that account — resumes included. Exempting them let four resumes fire at once and
 *    re-limit one after another, which is the stampede wearing a different hat.
 *  - an `inFlight` hold means a resume is testing the window right now and nothing is proven, so
 *    it blocks fresh work but not other resumes. Blocking those deadlocked a live workspace.
 */
function accountHeldFor(
  run: Pick<RunRecord, 'runner' | 'agentProfile' | 'status' | 'autoResumeAttempts'>,
  holds: AccountHolds,
  fallbackRunner: RunnerId,
): boolean {
  const key = runAccountKey(run, fallbackRunner);
  if (holds.deadline.has(key)) return true;
  return holds.inFlight.has(key) && !resumeInFlight(run);
}

/**
 * Which agent ACCOUNT a run's work runs on — the thing a provider usage limit actually closes
 * (spec 2026-08-03-auto-resume-after-usage-limit).
 *
 * Backend plus agent account, because those are the two axes a limit is scoped to: a Claude
 * limit must never stall a Codex task, and a second Claude login is a second budget. A record
 * that names no runner has not started yet and will take the configured default, which is what
 * `fallbackRunner` carries; a run that HAS started always carries its resolved runner (execute
 * persists it), and only started runs can be holding.
 */
export function runAccountKey(
  run: Pick<RunRecord, 'runner' | 'agentProfile'>,
  fallbackRunner: RunnerId,
): string {
  return `${run.runner ?? fallbackRunner}:${run.agentProfile ?? 'default'}`;
}

/**
 * Is this run an automatic resume that has not completed a turn yet?
 *
 * Such a run is the work the reopened window is FOR, so the hold must never apply to it — not
 * its own, and not another resume's. Two resumes that hold each other is a deadlock the queue
 * cannot recover from: both sit `queued` with a counter and no deadline, each waiting for the
 * other to prove a window neither will ever get to test. That is the shape a live run produced
 * — two scheduled tasks fired, both went `queued`, and nothing in the workspace moved again.
 *
 * The hold exists to stop NEW work walking into a closed window. A resume is not new work.
 */
function resumeInFlight(run: Pick<RunRecord, 'status' | 'autoResumeAttempts'>): boolean {
  return (
    run.autoResumeAttempts !== undefined && (run.status === 'queued' || run.status === 'running')
  );
}

/** A scheduled run's binding guards its launch only (spec 2026-10-07-deferred-task-start): once an
 *  agent step has recorded the account it spawned under, later steps, Continue and recovery resolve
 *  as for any run. The recorded `profileId` is durable, so the answer survives a restart. */
function deferredBindingActive(run: Pick<RunRecord, 'id' | 'deferredBinding' | 'steps'>, runs: readonly RunRecord[]): boolean {
  if (!run.deferredBinding || run.steps.some(step => step.profileId !== undefined)) return false;
  // A declarative child may own the first session. Its durable step attribution also releases
  // the parent's later steps, including after recovery; unrelated trees must not release it.
  const children = new Map<string, RunRecord[]>();
  for (const child of runs) {
    const parentId = child.dispatch?.parentRunId;
    if (parentId) children.set(parentId, [...(children.get(parentId) ?? []), child]);
  }
  const pending = [run.id];
  const visited = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const child of children.get(id) ?? []) {
      if (child.steps.some(step => step.profileId !== undefined)) return false;
      pending.push(child.id);
    }
  }
  return true;
}

const AUTO_RESUME_PROMPT =
  'The provider usage limit that interrupted this task has reset. Read the handoff file (ONNI_HANDOFF_FILE) to recover context, then continue the task from where you left off.';
type AutoResumeReason = NonNullable<RunRecord['autoResumeReason']>;
const TRANSIENT_RETRY_PROMPT =
  'Your previous turn stopped on a temporary provider error (overloaded, unreachable or a login refresh race), not on anything in the task. Read the handoff file (ONNI_HANDOFF_FILE) to recover context, then continue the task from where you left off.';

/** Which automatic resume a failure earns: a usage limit's reset window or a transient retry. */
function autoResumeReasonFor(error: string | undefined): AutoResumeReason | undefined {
  if (parseUsageLimit(error)) return 'usage_limit';
  return classifyAgentFailure(error) === 'transient' ? 'transient' : undefined;
}

function autoResumeCap(reason: AutoResumeReason | undefined): number {
  return reason === 'transient' ? MAX_TRANSIENT_RETRIES : MAX_AUTO_RESUMES;
}
/**
 * The wake instant as a human reads it — local, to the SECOND, with the zone named. The
 * transcript line is what someone scanning a stalled task actually reads, and "18:41" is not
 * enough to tell a wait that is nearly over from one that just started; the machine-readable ISO
 * copy lives on `RunRecord.autoResumeAt`. Server-side formatting is honest here because onni is
 * local-first: the process and the browser reading it are the same machine.
 */
function formatWakeInstant(at: Date): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'long' }).format(at);
}

export interface StartRunInput {
  /** Internal scheduled launch identity, persisted before any naming or execution side effect. */
  scheduledLaunch?: { id: string; provenance: NonNullable<RunRecord['automationTrigger']>; binding: NonNullable<RunRecord['deferredBinding']> };
  /** Internal child admission: inherit the launch guard without the scheduler's run identity. */
  deferredBinding?: RunRecord['deferredBinding'];
  task: string;
  model?: string;
  /** Agent backend chosen for this task (GUI). Unset = the config default. */
  runner?: RunnerId;
  /** Agent account for this task (spec 2026-07-29-agent-profiles), applying to steps that run
   *  on `runner`. Unset = the project's own selection. Persisted on the record so the choice
   *  survives into resume and Continue, and so the thread can say which account did the work. */
  agentProfile?: string;
  /** Attachments pasted into the new-task form — persisted when the run is created and
   *  delivered once, with the first agent step's opening message. Images ride along as blocks the
   *  model can view; a file (#950) only ever reaches the agent as the path it was written to. */
  images?: PastedContent[];
  /** Per-run system-prompt override (`POST /api/runs`, programmatic callers).
   *  Replaces the `config.json` default for this run — see
   *  `resolveExtraSystemPrompt` for the precedence contract. */
  systemPrompt?: string;
  /** Composer opt-out (#worktree-toggle): `false` runs the task in the repo
   *  working tree instead of an isolated worktree. Undefined/`true` keeps the
   *  default per-task worktree. Ignored for variants (they always isolate). */
  worktree?: boolean;
  /** With `worktree: false`: switch the repo checkout to a branch forked from the base first
   *  (spec 2026-10-19-repo-git-sync). `branch` names it; else the namer, else `onni/<id8>`. */
  newBranch?: boolean;
  branch?: string;
  /** A read-only Ask task (spec 2026-10-20-trunk-based-projects): in place, read-only tools,
   *  no repo-root lease, never lands. Wins over `worktree`, `newBranch` and dispatch. */
  readOnly?: boolean;
  /** Autonomous mode (#autonomous): the run never parks at `waiting` for the
   *  user — turn-ends auto-continue until the agent signals done or the safety
   *  cap is hit. No "needs you" is ever raised. */
  autonomous?: boolean;
  /** Follow-up inbox generation (spec 007, #444). Omitted means enabled for
   *  compatibility; the handoff journal runs either way. */
  generateFollowups?: boolean;
  /** This run's place in a dispatch tree (spec 2026-09-10-dispatch): root, parent, kind and
   *  budget. Persisted on the record at creation, because that is where every later consumer
   *  reads it — `execute()` runs from the RECORD, and so does restart recovery. */
  dispatch?: RunDispatch;
  /** The composer's Dispatch toggle (spec 2026-09-10-dispatch): start this run as the ROOT of a
   *  dispatch tree with the user's limits. Persisted as `dispatch.intent`; a worktree opt-out is
   *  overridden, because children fork the root's commits and an in-place run has no branch. */
  dispatchIntent?: DispatchIntent;
  /** Attachments from the queued prompt stack (#472), re-encoded from disk by
   *  `hydrateQueuedInput` at dequeue. Kept separate from `images` because those
   *  are persisted into `taskImages` by `startRun()` — folding
   *  the stack's (already-persisted) files in there would write duplicate files
   *  and make the task bubble render the stack's images as its own. In-memory
   *  only: rebuilt from the record on every hydration, never persisted. */
  stackedImages?: ContentBlock[];
  /**
   * Fork the worktree from this commit instead of the configured base (spec
   * 2026-10-06-agentic-e2e-checks Phase 3) — a pull request's fetched head. Internal: only
   * `checkout: 'pr-head'` automations set it; `POST /runs` has no such field. Recorded as the
   * run's `baseBranch`, so diffs measure only what this run changed on top of the PR, and it
   * forces a worktree — testing a PR in the user's own checkout would test the wrong tree.
   */
  forkRef?: { sha: string; label: string; pr: RunRecord['prHead'] & object; prUrl: string; untrusted: boolean };
  /** Internal (#1300): this job resumes the agent step a usage limit interrupted. Set only by
   *  `fireAutoResume` (and a restart that revives that queued job), never derived in `execute`. */
  usageLimitResume?: boolean;
  /** Cost / token / time / iteration ceilings requested for this run (user surfaces only). */
  limits?: RunLimitsRequest;
  /** Internal: an exact snapshot (a dispatched child's carved share). Wins over `limits`. */
  limitsSnapshot?: RunLimits;
  /** Start as the MANAGER of a worker roster (docs/design/manager-worker.md): takes the roster's
   *  manager backend/model, always gets a worktree, and may dispatch ONLY to the listed workers. */
  roster?: Roster;
  /** The manager may merge ("Full quyền manager"); snapshotted on the root. */
  managerFullAccess?: boolean;
}

/** Internal-only provenance passed from `redirectFor` into the ordinary dispatcher. */


/**
 * The mini workflow engine: executes a `WorkflowDef` against a repo, one step
 * at a time, persisting every event to the RunStore (which the SSE endpoints
 * relay live to the GUI). No GitHub choreography — agent steps and shell
 * checks with bounded retry loops, plus live sessions: the last agent step
 * stays open for follow-ups (`waiting`) until "finish", idle timeout, or
 * cancel. Runs queue behind the workspace-wide `maxParallel` slots (the shared
 * `WorkspaceSemaphore`, spec 2026-07-20 step 2.5) and each run executes in its
 * own git worktree on a `onni/<id8>` branch (spec 006), autosave-committed at
 * turn end and before a draft PR — plus every 90 s when opted in via
 * ONNI_AUTOSAVE=1 (#471). Each autosave records its trigger in the commit
 * subject, so the always-on flushes are not mistaken for the opt-in timer.
 * The user's working tree is never touched.
 */
export class RunManager {
  readonly lifecycle: WorktreeLifecycleCoordinator;

  private readonly active = new Map<string, ActiveRun>();
  /** One `onni task verify` per tree (checks share ports and caches); aborted by cancel/dispose. */
  private readonly verifying = new Map<string, AbortController>();
  /** Temp baseline worktrees a link prevented `withBaselineWorktree` from safely removing. */
  private readonly baselineTrees = new Set<string>();
  private disposed = false;
  private readonly verifyDeps: VerifyDependencies;
  /** Check ownership survives a parked continuation without persisting transient state. */
  private readonly checkArtifactSnapshots = new Map<string, Map<string, string>>();
  /** A failed checkpoint remains unsafe when a parked run is continued. */
  private readonly autosaveCheckpointBlockedRuns = new Set<string>();
  // Queue + `starting` set (spec 006, janitor's pump() pattern): `starting`
  // covers the window between shifting a run off the queue and the run
  // registering in `active`, so parallel-slot counting is never racy.
  private readonly queue: string[] = [];
  private readonly starting = new Set<string>();
  /** Sources whose durable redirect transaction temporarily holds their queued dependents. */
  private readonly redirecting = new Set<string>();
  // Runs cancelled inside that window: there is no `ActiveRun` to flag yet, so the starter checks
  // here once it has one to build (`abandonCancelledStart`).
  private readonly cancelledStarting = new Set<string>();
  // Runs parked at `waiting` (open session, ball in the user's court). They
  // don't consume a `maxParallel` slot (#347) — an idle claude process costs
  // memory but no tokens, queued work progressing matters more, and the idle
  // timeout already bounds how long a session can sit open. Invariant:
  // `waiting ⊆ active` — always cleared together via dropActive().
  private readonly waiting = new Set<string>();
  /** Durable monitoring subset. Only the configured number receives the waiting-slot exemption. */
  private readonly monitoring = new Set<string>();
  /**
   * The subset of `monitoring` parked because it SPAWNED children (spec
   * 2026-09-10-dispatch A5), rather than because an agent asked to watch its own
   * downstream work.
   *
   * These are exempt from the slot count OUTRIGHT — `maxMonitoringSessions` does not bound them
   * (see `busySlots`), and it must not: a commander parks precisely so that its children can
   * have its slot. Counting the third such parent as busy is what makes a tree whose tasks
   * each dispatch children queue itself forever (`busySlots === maxParallel`, no exit), and
   * starve every other project on the shared semaphore with it. A parked commander's process is
   * idle; the runs it waits for are the ones that need the capacity.
   *
   * Invariant `unitParents ⊆ monitoring`, held by routing every add/delete through
   * `enterMonitoring` / `leaveMonitoring` — nothing else writes either set.
   */
  private readonly unitParents = new Set<string>();
  private readonly pendingJobs = new Map<string, { workflow: WorkflowDef; input: StartRunInput }>();
  /** The creation-time namer's branch answer per queued run (spec
   *  2026-10-11-branch-naming-instructions) — `execute` awaits it, bounded, before the fork. */
  private readonly pendingBranchNames = new Map<string, Promise<string | undefined>>();
  private readonly branchNameWaitMs: number;
  /** Interrupted agent turns recovered after a process restart. Unlike an
   *  explicit user Continue, these are bulk scheduler work and must re-enter
   *  through `pump()` so both workspace and per-project caps are honored. */
  private readonly pendingContinuations = new Map<string, PendingContinuation>();
  /** Per-run image counter behind `pasted-<n>` / `screenshot-<n>` (#472). Lives on
   *  the manager rather than the `ActiveRun` so a *queued* run — which has no
   *  `ActiveRun` at all — can persist attachments. Seeded lazily from disk. */
  private readonly queuedImageSeq = new Map<string, number>();
  /** Messages that landed in the dequeue → session-open gap (#472), flushed as
   *  ordinary follow-up turns the moment the session opens. In-memory only. */
  private readonly deferredMessages = new Map<string, PastedContent[][]>();
  /** Manager receipt IDs aligned with `deferredMessages`; buffers without an ID are ordinary user messages. */
  private readonly deferredManagerDeliveryIds = new Map<string, Array<string | undefined>>();
  /** Deferred messages redelivered as a continuation keep their IDs only until a session opens. */
  private readonly continuationManagerDeliveryIds = new Map<string, string[]>();
  /** Armed usage-limit resumes, keyed by run id (spec
   *  2026-08-03-auto-resume-after-usage-limit). The DEADLINE itself lives on the record
   *  (`autoResumeAt`) — this map holds only the process-local timer, so a restart rebuilds it
   *  from the record rather than losing the wait. Runs here are `failed` and therefore NOT in
   *  `active`, which is why the timer cannot live on an `ActiveRun` like the monitoring one. */
  private readonly autoResumeTimers = new Map<string, NodeJS.Timeout>();
  /** Soft-ask deadlines (`dispatch.softAsk.expiresAt`, plan v2 §9), keyed by run id. Like
   *  `autoResumeTimers`, the deadline itself lives on the record, so boot rebuilds a timer rather
   *  than losing the wait — and a settled run can still carry one, which is why it cannot live on
   *  `ActiveRun`. */
  private readonly softAskTimers = new Map<string, NodeJS.Timeout>();
  private pumping = false;
  /** A pump that arrived while one was in flight — replayed by `pump()`'s own
   *  loop so a slot freed mid-sweep is never a lost wakeup. */
  private pumpAgain = false;
  /**
   * Runs normally isolate in worktrees and may execute in parallel. When that
   * isolation is unavailable (or explicitly disabled), access to `repoRoot` is
   * serialized by default so two agents cannot edit/revert the same files
   * (#438). `ONNI_DISABLE_REPO_LOCK=1` deliberately bypasses this safety lease.
   */
  private repoRootTail: Promise<void> = Promise.resolve();
  /** Leases chained onto `repoRootTail` and not yet released — holders and waiters alike. Zero
   *  means the tree is free right now, which is what lets a parked in-place run take it back
   *  synchronously (`claimFreeRepoRoot`) instead of round-tripping through a promise. */
  private repoRootBusy = 0;

  /** `.ai/onni` — where the per-task handoff files and todos.json live. */
  private readonly dataDir: string;

  /** Runs currently being paused by the memory guard — dedupes the ~2 s samples so one breach
   *  triggers one pause, not a burst. Cleared in dropActive when the run leaves the registry. */
  private readonly memoryPausing = new Set<string>();

  /** Unsubscribe handle for the constructor's `onUsage` subscription — released
   *  by dispose() so a torn-down manager stops receiving sampler ticks. */
  private readonly offUsage: () => void;

  /** The stalled-queue watchdog (see `rescueStalledQueue`). */
  private readonly queueWatchdog: ReturnType<typeof setInterval>;

  /** Accumulates active wall-clock and enforces run limits (see `sweepLimits`). */
  private readonly limitSweepTimer: ReturnType<typeof setInterval>;
  private lastLimitTick = Date.now();

  /** Set by the watchdog for exactly one sweep: ignore the usage-limit hold and make progress. */
  private forceNextPump = false;

  /** Runs the watchdog started despite the hold. The spawn-time gate (`requeueWhileHeld`) would
   *  otherwise hand them straight back and the rescue would undo itself in a millisecond. */
  private readonly forceStarted = new Set<string>();

  /** Queued runs the user asked to start now (`startNow`): they skip the parallel caps, never
   *  the usage-limit hold. Retired at dequeue and when the run leaves the queue any other way. */
  private readonly startNowRequested = new Set<string>();

  /** The workspace-wide parallel-cap semaphore + cached resource config
   *  (spec 2026-07-20, step 2.5). Boot constructs ONE and every manager shares
   *  it; the private fallback keeps single-manager callers and tests working. */
  private readonly semaphore: WorkspaceSemaphore;

  /** Unregister handle for this manager's semaphore membership — released by
   *  dispose() so a torn-down project stops counting against the cap. */
  private readonly offSemaphore: () => void;

  /** The workspace-registry id of this manager's project — what a dispatched agent's `onni task`
   *  CLI needs to address the right project over the API (spec 2026-09-10-dispatch). */
  private readonly projectId: string | undefined;

  /** See the constructor option of the same name. */
  private readonly secrets: SecretStore;
  private readonly managerEnv: () => NodeJS.ProcessEnv;

  /** See the constructor option of the same name. */
  private readonly resolveTrackerEnv: ((root: string, expected: TrackerAssociation | undefined) => Promise<Record<string, string>>) | undefined;

  constructor(
    private readonly store: RunStore,
    private readonly repoRoot: string,
    options: {
      semaphore?: WorkspaceSemaphore;
      projectId?: string;
      /**
       * Revalidate the tracker association captured by the run before every spawn,
       * including Continue and recovery. A mismatch fails the step before credentials
       * reach an agent. Secrets are registered with RunStore before any output arrives.
       */
      resolveTrackerEnv?: (root: string, expected: TrackerAssociation | undefined) => Promise<Record<string, string>>;
      /** The project/workspace secret store (spec 2026-10-10-project-secrets-vault-options);
       *  check steps read it with the `checks` audience. */
      secrets?: SecretStore;
      /** How long a fork waits for the namer's branch (spec 2026-10-11-branch-naming-instructions).
       *  Tests shorten it; the default is the slow-model budget. */
      branchNameWaitMs?: number;
      /** Environment snapshot seam for capability checks; tests inject values instead of mutating process.env. */
      env?: () => NodeJS.ProcessEnv;
      /** Test seam for `onni task verify`: runner, bash, clock, environment and baseline deadline. */
      verifyDeps?: Partial<VerifyDependencies>;
    } = {},
  ) {
    this.verifyDeps = {
      runCommand: options.verifyDeps?.runCommand ?? runVerifyCommand,
      resolveBash: options.verifyDeps?.resolveBash ?? resolveBash,
      now: options.verifyDeps?.now ?? Date.now,
      env: options.verifyDeps?.env ?? (() => process.env),
      baselineTimeoutMs: options.verifyDeps?.baselineTimeoutMs ?? VERIFY_TOTAL_TIMEOUT_MS / 2,
    };
    this.managerEnv = options.env ?? (() => process.env);
    this.dataDir = join(repoRoot, '.ai/onni');
    this.branchNameWaitMs = options.branchNameWaitMs ?? BRANCH_NAME_WAIT_MS;
    this.projectId = options.projectId;
    this.resolveTrackerEnv = options.resolveTrackerEnv;
    this.secrets = options.secrets ?? new SecretStore();
    this.semaphore = options.semaphore ?? new WorkspaceSemaphore();
    this.offSemaphore = this.semaphore.register({
      busySlots: () => this.busySlots(),
      pump: () => this.pump(),
      oldestQueuedAt: () => this.oldestQueuedAt(),
      accountHolds: () => this.accountHolds(),
      refreshQueueReasons: () => this.refreshQueueReasons(),
    });
    this.lifecycle = new WorktreeLifecycleCoordinator(repoRoot, store, {
      semaphore: this.semaphore,
      deferCleanup: true,
      busySlots: () => this.busySlots(),
      isActive: id => this.isActive(id),
      cancelAndWait: id => this.cancelAndWait(id),
      onWorktreeRemoved: () => this.sweepPrHeadRefs(),
      onTaskDeleted: id => deleteRunLayouts(this.dataDir, id),
      cancelPending: id => {
        const queued = this.queue.indexOf(id);
        if (queued >= 0) this.queue.splice(queued, 1);
        this.pendingJobs.delete(id); this.pendingContinuations.delete(id); this.startNowRequested.delete(id);
      },
      resume: async (id, launch) => {
        const run = this.store.getRun(id);
        if (!run) throw new Error('Task cannot be resumed because it is missing');
        if (this.queue.includes(id)) { void this.pump(); return; }
        if (this.isActive(id)) throw new Error('Task cannot be resumed while active');
        this.store.updateRun(id, {status: 'queued', error: undefined, finishedAt: undefined});
        if (launch?.kind === 'continuation' && typeof launch.stepId === 'string' && typeof launch.backend === 'string' && typeof launch.prompt === 'string') {
          this.pendingContinuations.set(id, launch as unknown as PendingContinuation);
          this.queue.push(id);
        } else await this.reviveQueuedRun(this.store.getRun(id)!, 'worktree setup recovery');
        void this.pump();
      },
    });
    this.store.on('run', this.onRunHoldInputs);
    this.store.on('deleted', this.onRunDeletedHolds);
    this.onQueueHoldChange();
    // Memory guard (#memory-guard): the shared process-tree sampler already ticks ~every 2 s for
    // the runs table; piggyback on it to enforce the per-task memory ceiling.
    this.offUsage = onUsage((snapshot) => void this.enforceMemoryLimit(snapshot));
    this.queueWatchdog = setInterval(() => void this.rescueStalledQueue(), QUEUE_WATCHDOG_MS);
    this.queueWatchdog.unref?.();
    this.limitSweepTimer = setInterval(() => this.sweepLimits(), LIMIT_SWEEP_MS);
    this.limitSweepTimer.unref?.();
  }

  /**
   * Release everything this manager owns without touching run records
   * (multi-project workspace, spec 2026-07-20: a removed project's context is
   * torn down while the process lives on). Unsubscribes the shared usage
   * sampler — before dispose() existed that subscription lived for the whole
   * process — clears every per-run idle/autosave timer, releases any held
   * repo-root locks, and empties the queued state so nothing fires later.
   * Live sessions are NOT ended here: run lifecycle stays the caller's policy;
   * dispose only guarantees the manager makes no further moves on its own.
   */
  dispose(): void {
    this.disposed = true;
    for (const controller of this.verifying.values()) controller.abort();
    for (const path of this.baselineTrees) this.retryBaselineCleanup(path);
    ++this.queueReasonRevision;
    this.store.off('run', this.onRunHoldInputs);
    this.store.off('deleted', this.onRunDeletedHolds);
    this.lifecycle.dispose();
    this.offUsage();
    this.offSemaphore();
    clearInterval(this.queueWatchdog);
    clearInterval(this.limitSweepTimer);
    for (const [runId, state] of this.active) {
      this.clearIdleTimer(state);
      this.clearMonitoringWakeTimer(state, runId);
      this.clearMonitoringLivenessTimer(state);
      this.clearAutosaveTimer(state);
      // Project disposal deliberately leaves providers alive. Their directory lease must
      // survive the manager too, until the actual provider result confirms its exit.
      const releaseWorktree = state.releaseWorktree;
      state.releaseWorktree = undefined;
      if (state.session && releaseWorktree) {
        void state.session.result.then(releaseWorktree, releaseWorktree);
      } else releaseWorktree?.();
      state.releaseRepoRoot?.();
      state.releaseRepoRoot = undefined;
    }
    for (const timer of this.autoResumeTimers.values()) clearTimeout(timer);
    this.autoResumeTimers.clear();
    for (const timer of this.softAskTimers.values()) clearTimeout(timer);
    this.softAskTimers.clear();
    this.active.clear();
    this.waiting.clear();
    // The monitoring subsets are cleared with `waiting`, whose subset they are: a disposed
    // manager holds no slots and must not keep claiming exemptions for runs it no longer owns.
    this.monitoring.clear();
    this.unitParents.clear();
    this.starting.clear();
    this.cancelledStarting.clear();
    this.queue.length = 0;
    this.pendingJobs.clear();
    this.pendingBranchNames.clear();
    this.pendingContinuations.clear();
    this.startNowRequested.clear();
    this.memoryPausing.clear();
    this.lastNamerKey.clear();
  }

  private startContext(): StartContext {
    return {
      store: this.store,
      repoRoot: this.repoRoot,
      dataDir: this.dataDir,
      active: this.active,
      starting: this.starting,
      queue: this.queue,
      pendingJobs: this.pendingJobs,
      pendingBranchNames: this.pendingBranchNames,
      queuedImageSeq: this.queuedImageSeq,
      memoryPausing: this.memoryPausing,
      semaphore: this.semaphore,
      managerEnv: this.managerEnv,
      secrets: this.secrets,
      projectId: this.projectId,
      resolveTrackerEnv: this.resolveTrackerEnv,
      pump: () => this.pump(),
      execute: (runId, workflow, input, ownerToken) => this.execute(runId, workflow, input, ownerToken),
      busySlots: () => this.busySlots(),
      dispatchEnabled: () => this.dispatchEnabled(),
      dispatchReachable: () => this.dispatchReachable(),
      dispatchOf: runId => this.dispatchOf(runId),
      deferredBindingActive: (run, runs) => deferredBindingActive(run, runs),
      clearIdleTimer: runId => {
        const state = this.active.get(runId);
        if (state) this.clearIdleTimer(state);
      },
      persistPastedAttachments: (runId, images) => this.persistPastedAttachments(runId, images),
      autoNameRun: (runId, skillName, task) => this.autoNameRun(runId, skillName, task),
    };
  }

  private enforceMemoryLimit(snapshot: Record<string, ProcessUsage>): Promise<void> {
    return enforceMemoryLimitTask(this.startContext(), snapshot);
  }

  private agentEnv(runId: string, generateFollowups = true): Record<string, string> {
    return buildAgentEnv(this.startContext(), runId, generateFollowups);
  }

  private agentPermissionSpec(
    runId: string,
    backend: string,
    onEvent: (event: AgentEvent) => void,
  ): Promise<{ permissionLevel?: AgentPermissionLevel }> {
    return buildAgentPermissionSpec(this.startContext(), runId, backend, onEvent);
  }

  private recordNoteMeta(runId: string, event: Extract<AgentEvent, { type: 'note' }>): void {
    recordRunNoteMeta(this.startContext(), runId, event);
  }

  private privateMcpForLaunch(
    backend: RunnerId,
    onEvent: (event: AgentEvent) => void,
  ): Promise<PrivateMcpServer[] | undefined> {
    return buildPrivateMcpForLaunch(this.startContext(), backend, onEvent);
  }

  private agentEnvForStep(
    runId: string,
    backend: RunnerId,
    options: { generateFollowups?: boolean; recordedProfileId?: string } = {},
  ): Promise<{ env: Record<string, string>; profileId: string; onUsageWindows?: (observation: UsageWindowsObservation) => void }> {
    return buildAgentEnvForStep(this.startContext(), runId, backend, options);
  }

  startRun(
    workflow: WorkflowDef,
    input: StartRunInput,
    group?: { groupId: string; variant: string },
  ): RunRecord {
    return createRun(this.startContext(), workflow, input, group);
  }

  startVariants(workflow: WorkflowDef, input: StartRunInput, count: number): RunRecord[] {
    return createVariants(this.startContext(), workflow, input, count);
  }

  /**
   * Slots this manager holds against the workspace-wide cap. `waiting` runs
   * don't hold a slot (#347): an idle claude process costs memory but no
   * tokens, queued work progressing matters more, and the idle timeout already
   * bounds how long a session can sit open. Because the exemption lives HERE —
   * in the count, not in any acquire path — a message into a `waiting` run
   * (sendMessage) resumes it immediately even when that momentarily exceeds
   * `maxParallel`, including when other projects saturate the cap.
   */
  private queueContext(): QueueContext<StartRunInput, WorkflowDef> {
    const manager = this;
    return {
      queue: this.queue,
      starting: this.starting,
      active: this.active,
      pendingJobs: this.pendingJobs,
      pendingContinuations: this.pendingContinuations,
      pendingBranchNames: this.pendingBranchNames,
      monitoring: this.monitoring,
      unitParents: this.unitParents,
      waiting: this.waiting,
      get pumping() { return manager.pumping; },
      set pumping(value: boolean) { manager.pumping = value; },
      get pumpAgain() { return manager.pumpAgain; },
      set pumpAgain(value: boolean) { manager.pumpAgain = value; },
      semaphore: this.semaphore,
      store: this.store,
      repoRoot: this.repoRoot,
      redirecting: this.redirecting,
      startNowRequested: this.startNowRequested,
      get forceNextPump() { return manager.forceNextPump; },
      set forceNextPump(value: boolean) { manager.forceNextPump = value; },
      forceStarted: this.forceStarted,
      accountHolds: () => this.semaphore.accountHolds(),
      isAccountHeld: accountHeldFor,
      reconcileMonitoringWakeTimers: () => this.reconcileMonitoringWakeTimers(),
      reconcileAutoResumes: () => this.reconcileAutoResumes(),
      blockOrphanedDependents: () => this.blockOrphanedDependents(),
      workerEntryFull: (run) => this.workerEntryFull(run),
      dependencyState: (run) => this.dependencyState(run),
      refreshQueuedDependencyEnvelope: (run) => this.refreshQueuedDependencyEnvelope(run),
      armMonitoringLivenessTimer: (runId) => {
        const state = this.active.get(runId);
        if (state) this.armMonitoringLivenessTimer(runId, state);
      },
      clearMonitoringLivenessTimer: (runId) => {
        const state = this.active.get(runId);
        if (state) this.clearMonitoringLivenessTimer(state);
      },
      hydrateQueuedInput: (runId, input) => this.hydrateQueuedInput(runId, input),
      hydrateQueuedContinuation: (runId, continuation) => this.hydrateQueuedContinuation(runId, continuation),
      refreshQueuedWorkflow: (runId, snapshot, catalog) => this.refreshQueuedWorkflow(runId, snapshot, catalog),
      execute: (runId, workflow, input, ownerToken) => this.execute(runId, workflow, input, ownerToken),
      runContinuation: (runId, stepId, sessionId, backend, prompt, images, persistedImages, persistedAttachments, ownerToken) =>
        this.runContinuation(runId, stepId, sessionId, backend, prompt, images, persistedImages, persistedAttachments, ownerToken),
      failOwnedContinuation: (runId, ownerToken, message) => this.failOwnedContinuation(runId, ownerToken, message),
      abandonCancelledStart: (runId) => this.abandonCancelledStart(runId),
      clearIdleTimer: (runId) => {
        const state = this.active.get(runId);
        if (state) this.clearIdleTimer(state);
      },
      clearAutosaveTimer: (runId) => {
        const state = this.active.get(runId);
        if (state) this.clearAutosaveTimer(state);
      },
      dropActive: (runId, ownerToken) => {
        const state = this.active.get(runId);
        if (state?.ownerToken === ownerToken) this.dropActive(runId, state);
      },
      reviveWorkflow: (run) => this.reviveWorkflow(run),
      workflowInput: (run) => this.workflowInput(run),
      queuedUsageLimitResume: (run) => this.queuedUsageLimitResume(run),
      reportSettledChildToParent: (runId) => this.reportSettledChildToParent(runId),
    };
  }

  private busySlots(): number {
    return queueBusySlots(this.queueContext());
  }

  /**
   * Park a run in the monitoring set — the ONE entry, so `unitParents ⊆ monitoring` cannot be
   * half-applied across the two near-identical turn-end handlers (AGENTS.md § "Find every
   * construction site of a shared in-memory object").
   *
   * `spawnParked` says WHY it parked: `true` only when this turn dispatched children.
   * A commander that parks again on a plain `ONNI:MONITORING` after its children reported is an
   * ordinary watcher again, which is why the flag is rewritten on every park, never OR-ed.
   */
  private enterMonitoring(runId: string, spawnParked: boolean): void {
    queueEnterMonitoring(this.queueContext(), runId, spawnParked);
  }

  /**
   * Leave the monitoring set — the ONE exit, and every transition out of the state goes through
   * it: a child's report or a user message (`deliverMessage`), the next turn ending in anything
   * but a park, a native `ask.requested`, the session's own teardown, `dropActive` (cancel,
   * settle, restart recovery), and `parkMonitorAsWaiting` (the wake-up cap and the liveness
   * timer). An ordinary wake-up is deliberately NOT one: its nudge is delivered into the same
   * parked session and the turn it starts ends back here.
   */
  private leaveMonitoring(runId: string): void {
    queueLeaveMonitoring(this.queueContext(), runId);
  }

  /** Epoch ms of this manager's oldest queued run (the semaphore's fairness
   *  key when a freed slot is broadcast), or null when nothing is queued.
   *  `queue` is FIFO — `startRun` pushes and `recover()` re-queues by
   *  `createdAt` — so the head is the oldest. */
  private oldestQueuedAt(): number | null {
    return queueOldestQueuedAt(this.queueContext());
  }

  /**
   * A slot this manager held just came free. Pump the whole WORKSPACE, not
   * just this manager: `maxParallel` is counted across every project, so the
   * run that should take the slot is the workspace's oldest queued one — which
   * usually sits in another project's queue. Pumping only `this` is what left
   * a queued run in project B stuck at `queued` while project A's runs came
   * and went. `release()` pumps this manager too, so it replaces the local
   * `pump()` at every slot-freeing transition.
   */
  private releaseSlot(): void {
    queueReleaseSlot(this.queueContext());
  }

  /**
   * Start queued runs while parallel slots are free. A run starts only under
   * BOTH ceilings: the WORKSPACE `resources.maxParallel` (default 2, counted
   * across every manager — spec 2026-07-20, step 2.5) AND this project's own
   * per-project `maxParallel` when the registry sets one (spec 2026-07-22,
   * inherits the workspace cap when unset). Legacy per-repo `maxParallel` keys
   * are ignored. A non-git directory degrades to 1 sequential run in the repo
   * root (spec 006 degradation rule), which is always the tighter bound.
   */
  // Moved tasks own their async boundaries; async pass-throughs add adoption ticks (64c044c).
  private pump(): Promise<void> {
    return pumpQueue(this.queueContext());
  }

  /**
   * Make one `queued` RECORD executable again — the engine half a queued run needs but does not
   * persist (`pendingJobs` / `pendingContinuations` are process-local, the record is not).
   *
   * Two callers, one path: boot recovery re-adopts everything the previous process was holding,
   * and the queue watchdog re-adopts anything the running process has somehow lost. A queued
   * record with no work item behind it is invisible to `pump()` and would sit there for good,
   * which is the worst failure this engine has — the task is neither running nor failed, just
   * silently never going to happen.
   *
   * A continuation is reconstructed first: its executable details are gone, but the pending
   * `continue-N` step and the session before it are durable, which is enough. Otherwise the
   * workflow is revived from the record. A run that can be neither is failed loudly rather than
   * left in the queue as a ghost.
   */
  private reviveQueuedRun(run: RunRecord, reason: string): Promise<void> {
    return queueReviveQueuedRun(this.queueContext(), run, reason);
  }

  private lifecycleContext(): LifecycleContext {
    return {
      store: this.store,
      dataDir: this.dataDir,
      active: this.active,
      queue: this.queue,
      starting: this.starting,
      cancelledStarting: this.cancelledStarting,
      waiting: this.waiting,
      monitoring: this.monitoring,
      unitParents: this.unitParents,
      pendingJobs: this.pendingJobs,
      pendingBranchNames: this.pendingBranchNames,
      pendingContinuations: this.pendingContinuations,
      startNowRequested: this.startNowRequested,
      deferredMessages: this.deferredMessages,
      deferredManagerDeliveryIds: this.deferredManagerDeliveryIds,
      continuationManagerDeliveryIds: this.continuationManagerDeliveryIds,
      autoResumeTimers: this.autoResumeTimers,
      memoryPausing: this.memoryPausing,
      lastNamerKey: this.lastNamerKey,
      forceStarted: this.forceStarted,
      lifecycle: this.lifecycle,
      abortVerification: (runId) => this.verifying.get(runId)?.abort(),
      recoverRedirectOperations: () => this.recoverRedirectOperations(),
      recoverSoftAsks: () => this.recoverSoftAsks(),
      expireLostManagerDeliveriesAfterRestart: () => this.expireLostManagerDeliveriesAfterRestart(),
      reconcileAutoResumes: () => this.reconcileAutoResumes(),
      reviveQueuedRun: (run, reason) => this.reviveQueuedRun(run, reason),
      settleSuccess: (runId) => this.settleSuccess(runId),
      continueRun: (runId, options, deferForCapacity) => this.continueRun(runId, options, deferForCapacity),
      reportSettledChildToParent: (runId) => this.reportSettledChildToParent(runId),
      pump: () => this.pump(),
      clearSoftAsk: (runId) => this.clearSoftAsk(runId),
      expireUnacceptedManagerDeliveries: (runId, reason) => this.expireUnacceptedManagerDeliveries(runId, reason),
      scheduleAutoResumeIfLimited: (runId) => this.scheduleAutoResumeIfLimited(runId),
      cancelAutoResume: (runId) => this.cancelAutoResume(runId),
      leaveMonitoring: (runId) => this.leaveMonitoring(runId),
      clearMonitoringWakeTimer: (state, runId) => this.clearMonitoringWakeTimer(state as ActiveRun, runId),
      clearIdleTimer: (state) => this.clearIdleTimer(state as ActiveRun),
      releaseSlot: () => this.releaseSlot(),
      finishReview: (runId) => this.finishReview(runId),
      startRetentionPass: () => { this.retentionPass = this.enforceRetention(); },
      cancelDescendants: (runId, seen) => this.cancelDescendants(runId, seen),
      cancel: (runId) => this.cancel(runId),
      isQueued: (runId) => this.isQueued(runId),
      enqueueMessage: (runId, content, deliveryId) => this.enqueueMessage(runId, content, deliveryId),
      recordManagerDeliveryTransition: (runId, deliveryId, state, reason) =>
        this.recordManagerDeliveryTransition(runId, deliveryId, state, reason),
    };
  }

  /**
   * Startup recovery (#367) — re-adopt runs that were live when the previous
   * onni process exited (requires the store opened with `keepLive`):
   *  - `queued`  → back into the queue (FIFO by createdAt), from the persisted
   *    workflowDef (or the catalog by name for older records);
   *  - `waiting` → the turn was over and the ball was in the user's court —
   *    settle exactly like a closed session (review/done, Continue still works),
   *    unless `askParked`, native `attentionRequest`, or an unfinished monitor
   *    records pending work, which settles `failed` instead so unrun steps are not
   *    reported as done, with `awaitingAnswerSince` so the task still reads as "needs you";
   *  - `running` → mark interrupted, then immediately resume the last agent
   *    session via the Continue path, pointing the agent at its handoff file.
   * Call once, before the server starts taking requests.
   */
  recover(): Promise<void> {
    return lifecycleRecover(this.lifecycleContext());
  }

  /**
   * Swap a dequeued run's snapshot for the catalog's current definition when it changed while the
   * run was queued (#1078; see `newerCatalogWorkflow` for which runs qualify). The record follows
   * — `workflowDef` and the step rail both — so the run shows the workflow it actually runs. A
   * run that already started a step (a re-queue from inside `execute`) keeps what it has.
   */
  private refreshQueuedWorkflow(runId: string, snapshot: WorkflowDef, catalog: readonly WorkflowDef[]): WorkflowDef {
    // Scheduled tasks were confirmed against this exact workflow and account binding.
    if (this.store.getRun(runId)?.deferredBinding) return snapshot;
    const current = newerCatalogWorkflow(snapshot, catalog);
    if (!current) return snapshot;
    const steps = current.steps.map((s) => ({ id: s.id, name: s.name ?? s.id, kind: stepKind(s) }));
    if (!this.store.replacePendingSteps(runId, steps)) return snapshot;
    this.store.updateRun(runId, { workflowDef: current });
    this.store.appendEvent(runId, {
      type: 'lifecycle',
      message: `workflow "${current.name}" changed while the task was queued — starting with the current version`,
    });
    return current;
  }

  /** The persisted definition when it looks sane, else the catalog by name. */
  private async reviveWorkflow(run: RunRecord): Promise<WorkflowDef | null> {
    // "Looks sane" is the STORE's job now: it parses `workflowDef` against the definition schema
    // and `.catch`es a def that no longer fits to `undefined`, so anything present here already
    // has the `steps` array the old inline `Array.isArray` check was asking for.
    const def = run.workflowDef;
    if (def) return def;
    const { workflows } = await loadWorkflows(this.repoRoot);
    return workflows.find((w) => w.name === run.workflow) ?? null;
  }

  /**
   * A run cancelled while still `starting` (see `cancelOne`): leave the window without a session,
   * settling the way `dropActive` does — report to a parent, free the slot.
   */
  private abandonCancelledStart(runId: string): boolean {
    return lifecycleAbandonCancelledStart(this.lifecycleContext(), runId);
  }

  /** Fence a continuation failure to the async owner that started it. */
  private failOwnedContinuation(runId: string, ownerToken: symbol, message: string): void {
    lifecycleFailOwnedContinuation(this.lifecycleContext(), runId, ownerToken, message);
  }

  /** Remove a run from the live registries — keeps `waiting ⊆ active`. */
  private dropActive(runId: string, expectedState?: ActiveRun): void {
    lifecycleDropActive(this.lifecycleContext(), runId, expectedState);
  }

  private setDeferred(runId: string, pending: PastedContent[][] | undefined, deliveryIds?: Array<string | undefined>): void {
    lifecycleSetDeferred(this.lifecycleContext(), runId, pending, deliveryIds);
  }

  // ---- task dispatch (spec 2026-09-10-dispatch) ----------------------------------------------

  private dispatchContext(): DispatchContext {
    return {
      store: this.store,
      dataDir: this.dataDir,
      active: this.active,
      queue: this.queue,
      pendingJobs: this.pendingJobs,
      starting: this.starting,
      redirecting: this.redirecting,
      semaphore: this.semaphore,
      dispatchEnabled: () => this.dispatchEnabled(),
      dispatchOf: (runId) => this.dispatchOf(runId),
      dispatchBudgetFor: (runId) => this.dispatchBudgetFor(runId),
      updateDispatch: (runId, patch) => this.updateDispatch(runId, patch),
      startRun: (workflow, input) => this.startRun(workflow, input),
      cancelOne: (runId) => this.cancelOne(runId),
      deferredBindingActive: (run, runs) => deferredBindingActive(run, runs),
      verificationAskMatches: (text) => VERIFICATION_ASK_RE.test(text),
      assignPlanPart: (rootRunId, partId, childRunId) => this.assignPlanPart(rootRunId, partId, childRunId),
      notifyTreeInboxes: (rootRunId, writerId) => this.notifyTreeInboxes(rootRunId, writerId),
      ackPendingReport: (runId, fromRunId, at) => this.ackPendingReport(runId, fromRunId, at),
      deliverMessage: (runId, content, userAuthored) => this.deliverMessage(runId, content, userAuthored),
      enqueueMessage: (runId, content) => this.enqueueMessage(runId, content),
      deferMessage: (runId, content) => this.deferMessage(runId, content),
      continueRun: (runId, options, deferForCapacity) => this.continueRun(runId, options, deferForCapacity),
      pump: () => this.pump(),
    };
  }

  private managerControlContext(): ManagerControlContext {
    return {
      store: this.store,
      repoRoot: this.repoRoot,
      dataDir: this.dataDir,
      active: this.active,
      redirecting: this.redirecting,
      queue: this.queue,
      starting: this.starting,
      continuationManagerDeliveryIds: this.continuationManagerDeliveryIds,
      managerEnv: () => this.managerEnv(),
      semaphore: this.semaphore,
      dispatch: (parentId, input, options) => this.dispatch(parentId, input, options),
      cancel: (runId) => this.cancel(runId),
      isActive: (runId) => this.isActive(runId),
      waitInactive: (runId, timeoutMs) => this.waitInactive(runId, timeoutMs),
      sendMessage: (runId, content, replyTo, deliveryId) => this.sendMessage(runId, content, replyTo, deliveryId),
      enqueueMessage: (runId, content, deliveryId) => this.enqueueMessage(runId, content, deliveryId),
      deferMessage: (runId, content, deliveryId) => this.deferMessage(runId, content, deliveryId),
      clearSoftAsk: (runId) => this.clearSoftAsk(runId),
      blockOrphanedDependents: () => this.blockOrphanedDependents(),
      refreshQueuedDependencyEnvelope: (run) => this.refreshQueuedDependencyEnvelope(run),
      pump: () => this.pump(),
      updateDispatch: (runId, patch) => {
        const dispatch = this.store.getRun(runId)?.dispatch;
        if (!dispatch) return;
        this.store.updateRun(runId, { dispatch: patch(dispatch) });
      },
    };
  }

  private dispatchEnabled(): boolean {
    return controlDispatchEnabled(this.managerControlContext());
  }

  private dispatchReachable(): boolean {
    return controlDispatchReachable(this.managerControlContext());
  }

  private dispatchOf(runId: string): RunDispatch | undefined {
    return controlDispatchOf(this.managerControlContext(), runId);
  }

  private updateDispatch(runId: string, patch: (dispatch: RunDispatch) => RunDispatch): void {
    controlUpdateDispatch(this.managerControlContext(), runId, patch);
  }

  private loadManagerSessionContext(runId: string, state: ActiveRun): Promise<ManagerSessionContext> {
    return controlLoadManagerSessionContext(this.managerControlContext(), runId, state);
  }

  private prepareDispatchSession(runId: string, state: ActiveRun, context: ManagerSessionContext = {}): void {
    controlPrepareDispatchSession(this.managerControlContext(), runId, state, context);
  }

  private remainingForManager(runs: readonly RunRecord[], rootId: string): RemainingBudget {
    return controlRemainingForManager(this.managerControlContext(), runs, rootId);
  }

  dispatchBudgetFor(runId: string): DispatchBudget | undefined {
    return controlDispatchBudgetFor(this.managerControlContext(), runId);
  }

  peekFor(
    callerId: string,
    query: { target?: string; all?: boolean; tail?: number },
  ): Promise<DispatchPeek | { denied: string; status: 403 | 404 | 409 }> {
    return controlPeekFor(this.managerControlContext(), callerId, query);
  }

  conflictsFor(
    callerId: string,
    query: { target?: string } = {},
  ): Promise<DispatchConflicts | { denied: string; status: 403 | 404 | 409 }> {
    return controlConflictsFor(this.managerControlContext(), callerId, query);
  }

  messageFor(
    callerId: string,
    input: DispatchManagerMessageInput,
  ): DispatchManagerMessageResult | { denied: string; status: 400 | 403 | 404 | 409 } {
    return controlMessageFor(this.managerControlContext(), callerId, input);
  }

  cancelFor(
    callerId: string,
    input: DispatchManagerCancelInput,
  ): DispatchManagerCancelResult | { denied: string; status: 400 | 403 | 404 | 409 } {
    return controlCancelFor(this.managerControlContext(), callerId, input);
  }

  redirectFor(
    callerId: string,
    input: DispatchManagerRedirectInput,
  ): Promise<DispatchManagerRedirectResult | DispatchManagerRedirectFailure | { denied: string; status: 400 | 403 | 404 | 409 }> {
    return controlRedirectFor(this.managerControlContext(), callerId, input);
  }

  private redirectDispatchInput(order: DispatchOrderSnapshot, instruction: string): DispatchInput {
    return controlRedirectDispatchInput(order, instruction);
  }

  private cancelRedirectSource(runId: string): Promise<boolean> {
    return controlCancelRedirectSource(this.managerControlContext(), runId);
  }

  private redirectFailure(sourceRunId: string, refusal: string): DispatchManagerRedirectFailure {
    return controlRedirectFailure(this.managerControlContext(), sourceRunId, refusal);
  }

  private failRedirectOperation(sourceRunId: string, refusal: string): string {
    return controlFailRedirectOperation(this.managerControlContext(), sourceRunId, refusal);
  }

  private finishRedirectOperation(sourceRunId: string, replacementRunId: string): DispatchManagerRedirectResult {
    return controlFinishRedirectOperation(this.managerControlContext(), sourceRunId, replacementRunId);
  }

  private repointQueuedDependents(source: RunRecord, replacement: RunRecord): number {
    return controlRepointQueuedDependents(this.managerControlContext(), source, replacement);
  }

  private recoverRedirectOperations(): Promise<void> {
    return controlRecoverRedirectOperations(this.managerControlContext());
  }

  private managerDeliveryFor(runId: string, deliveryId: string): DispatchManagerDeliveryRecord | undefined {
    return controlManagerDeliveryFor(this.managerControlContext(), runId, deliveryId);
  }

  private recordManagerDeliveryTransition(
    runId: string,
    deliveryId: string,
    state: DispatchManagerDeliveryState,
    reasonCode?: DispatchManagerDeliveryReasonCode,
  ): void {
    controlRecordManagerDeliveryTransition(this.managerControlContext(), runId, deliveryId, state, reasonCode);
  }

  private recordManagerUserMessage(runId: string, text: string): void {
    controlRecordManagerUserMessage(this.managerControlContext(), runId, text);
  }

  private markQueuedManagerDeliveriesDelivered(runId: string): void {
    controlMarkQueuedManagerDeliveriesDelivered(this.managerControlContext(), runId);
  }

  private expireUnacceptedManagerDeliveries(
    runId: string,
    reasonCode: 'target-settled' | 'process-restarted',
  ): void {
    controlExpireUnacceptedManagerDeliveries(this.managerControlContext(), runId, reasonCode);
  }

  private expireLostManagerDeliveriesAfterRestart(): void {
    controlExpireLostManagerDeliveriesAfterRestart(this.managerControlContext());
  }

  private peekEntry(
    run: RunRecord,
    opts: { filesMax: number; tailLines?: number; tailMaxChars?: number },
  ): Promise<DispatchPeekEntry> {
    return controlPeekEntry(this.managerControlContext(), run, opts);
  }

  private verifyContext(): VerifyContext {
    return {
      store: this.store,
      repoRoot: this.repoRoot,
      dataDir: this.dataDir,
      verifying: this.verifying,
      baselineTrees: this.baselineTrees,
      verifyDeps: this.verifyDeps,
      isActive: (runId) => this.isActive(runId),
      currentStepId: (runId) => this.active.get(runId)?.currentStepId,
      updateDispatch: (runId, patch) => this.updateDispatch(runId, patch),
      isDisposed: () => this.disposed,
    };
  }

  /**
   * `POST /runs/:id/verify` — the root manager has onni run the repository's checks inside a SETTLED
   * worker's worktree (wave A1). `:id` is the caller; the worker travels in `input.target`. Every
   * refusal about WHO or WHICH STATE is a 4xx; "cannot run here" is a 200 `unavailable` value.
   * This is a barrier, not a sandbox: it runs repo-defined scripts from a tree the worker wrote.
   */
  verifyFor(
    callerId: string,
    input: DispatchVerifyInput,
  ): Promise<DispatchVerifyResult | { denied: string; status: 400 | 403 | 404 | 409 }> {
    return verifyWorkerFor(this.verifyContext(), callerId, input);
  }

  private retryBaselineCleanup(path: string): void {
    retryVerifyBaselineCleanup(this.verifyContext(), path);
  }

  private managerStateContext(): ManagerStateContext {
    return {
      store: this.store,
      dataDir: this.dataDir,
      repoRoot: this.repoRoot,
      active: this.active,
      softAskTimers: this.softAskTimers,
      maxAutoContinues: MAX_AUTO_CONTINUES,
      dispatchEnabled: () => this.dispatchEnabled(),
      dispatchOf: (runId) => this.dispatchOf(runId),
      updateDispatch: (runId, patch) => this.updateDispatch(runId, patch),
      makeUiSink: (runId, stepId) => this.makeUiSink(runId, stepId),
      emitAskRequested,
      turnEndMarkerText,
      enforceDispatchBudget: (runId, note) => this.enforceDispatchBudget(runId, note),
      deliverMessage: (runId, content, userAuthored) => this.deliverMessage(runId, content, userAuthored),
      managerComplexityPolicyEnabled: () => this.semaphore.safety().managerComplexityPolicy !== false,
    };
  }

  /** Project memory (plan v2 §8). Reading is project-wide, so Settings works with dispatch off. */
  readManagerMemory(): Promise<ManagerMemoryRead> {
    return readProjectManagerMemory(this.dataDir);
  }

  writeManagerMemory(input: ManagerMemoryPut): Promise<MemoryWriteResult> {
    return writeProjectManagerMemory(this.dataDir, input);
  }

  addManagerMemory(
    runId: string,
    input: ManagerMemoryAdd,
  ): Promise<ManagerMemoryRead | { denied: string; status: 400 | 403 | 404 | 409 }> {
    return addManagerMemoryEntry(this.managerStateContext(), runId, input);
  }

  readTreePlan(runId: string): Promise<TreePlan | { denied: string; status: 403 | 404 | 409 }> {
    return readManagerTreePlan(this.managerStateContext(), runId);
  }

  writeTreePlan(runId: string, input: TreePlanPut): Promise<TreePlan | { denied: string; status: 400 | 403 | 404 | 409 }> {
    return writeManagerTreePlan(this.managerStateContext(), runId, input);
  }

  patchTreePlanPart(
    runId: string,
    partId: string,
    input: TreePlanPatch,
  ): Promise<TreePlan | { denied: string; status: 400 | 403 | 404 | 409 }> {
    return patchManagerTreePlanPart(this.managerStateContext(), runId, partId, input);
  }

  private assignPlanPart(rootRunId: string, partId: string, childRunId: string): Promise<void> {
    return assignManagerPlanPart(this.managerStateContext(), rootRunId, partId, childRunId);
  }

  askUser(runId: string, input: ManagerAskInput): ManagerAskResponse | { denied: string; status: 403 | 404 | 409 } {
    return askManagerUser(this.managerStateContext(), runId, input);
  }

  private softAskFor(runId: string, requestId: string | undefined): RunDispatch['softAsk'] {
    return findManagerSoftAsk(this.managerStateContext(), runId, requestId);
  }

  private clearSoftAsk(runId: string): void {
    clearManagerSoftAsk(this.managerStateContext(), runId);
  }

  forgetSoftAsk(runId: string): void {
    clearManagerSoftAsk(this.managerStateContext(), runId);
  }

  private recoverSoftAsks(): void {
    recoverManagerSoftAsks(this.managerStateContext());
  }

  private prepareAutomationsSession(state: ActiveRun): void {
    state.automationsPrompt = automationsReachable() ? AUTOMATIONS_PROMPT : undefined;
  }

  private flushInbox(runId: string): string | undefined {
    return flushManagerInbox(this.managerStateContext(), runId);
  }

  private flushPendingReports(runId: string): string | undefined {
    return flushManagerPendingReports(this.managerStateContext(), runId);
  }

  private ackPendingReport(runId: string, fromRunId: string, at: string): void {
    ackManagerPendingReport(this.managerStateContext(), runId, fromRunId, at);
  }

  private handleDispatchTurn(runId: string, turnText: string, ctx: { state: ActiveRun; stepId: string; done: boolean }): DispatchTurnResult {
    return handleManagerDispatchTurn(this.managerStateContext(), runId, turnText, ctx);
  }

  mergeFromAgent(runId: string, input: MergeInput): Promise<MergeOutcome | { denied: string }> {
    return mergeManagerFromAgent(this.managerStateContext(), runId, input);
  }

  checkManagerComplexity(runId: string, ctx: { state: ActiveRun; stepId: string; done: boolean }): Promise<boolean> {
    return checkManagerTaskComplexity(this.managerStateContext(), runId, ctx);
  }

  private notifyTreeInboxes(rootRunId: string, writerId: string): void {
    notifyManagerTreeInboxes(this.managerStateContext(), rootRunId, writerId);
  }

  private recordAsk(runId: string, sink: UiEventSink, ask: AskRequest): WebhookAttentionRequest {
    return recordManagerAsk(this.managerStateContext(), runId, sink, ask);
  }

  private recordAttention(
    requestId: string,
    input: readonly { question: string; options?: readonly { label: string; description?: string }[] }[],
  ): WebhookAttentionRequest {
    return recordManagerAttention(requestId, input);
  }

  private clearPendingAsk(runId: string): void {
    clearManagerPendingAsk(this.managerStateContext(), runId);
  }
  /**
   * The turn-end budget brake: a dispatched run that has spent its ceiling stops running itself.
   * The caller then skips the autonomous nudge, clears the monitoring wake timer and parks
   * `waiting`. The note fires ONCE (guarded by the persisted flag) while the brake keeps answering.
   */
  private enforceDispatchBudget(runId: string, note: (message: string, tone?: 'danger') => void): boolean {
    const run = this.store.getRun(runId);
    const dispatch = run?.dispatch;
    const budget = dispatch?.budgetUsd;
    if (!run || !dispatch || budget === undefined) return false;
    const spent = run.costUsd ?? 0;
    if (spent < budget) return false;
    if (!dispatch.overBudget) {
      this.updateDispatch(runId, (current) => ({ ...current, overBudget: true }));
      note(
        `budget spent — ${usd(spent)} of ${usd(budget)}. The run parks for you instead of continuing on its own; send a message to take it further.`,
        'danger',
      );
    }
    return true;
  }


  private dependencyState(run: RunRecord): 'ready' | 'waiting' | 'blocked' {
    return dispatchDependencyState(this.dispatchContext(), run);
  }

  private blockOrphanedDependents(): void {
    dispatchBlockOrphanedDependents(this.dispatchContext());
  }

  private refreshQueuedDependencyEnvelope(run: RunRecord): void {
    refreshDispatchDependencyEnvelope(this.dispatchContext(), run);
  }

  private workerEntryFull(queued: RunRecord): boolean {
    return dispatchWorkerEntryFull(this.dispatchContext(), queued);
  }

  dispatchFromAgent(parentId: string, input: DispatchInput): Promise<{ id: string; branch?: string } | { refused: string }> {
    return dispatchFromAgentTask(this.dispatchContext(), parentId, input);
  }

  dispatch(
    parentId: string,
    input: DispatchInput,
    opts: {
      workflow?: WorkflowDef;
      antigravityLevel?: AgentPermissionLevel;
      /** Internal redirect provenance and its canonical order; never accepted from an agent. */
      redirectOrigin?: RedirectDispatchOrigin;
      /** Run every admission check without creating a child or mutating the task tree. */
      preflightOnly?: boolean;
    } = {},
  ): { id: string; branch?: string } | { refused: string } {
    return dispatchTask(this.dispatchContext(), parentId, input, opts);
  }

  recordReport(runId: string, report: DispatchReport): boolean {
    return recordDispatchReport(this.dispatchContext(), runId, report);
  }

  notifyQuestionRetired(runId: string): void {
    notifyQuestionRetiredTask(this.dispatchContext(), runId);
  }

  private reportSettledChildToParent(runId: string): Promise<void> {
    return reportDispatchSettledChildToParent(this.dispatchContext(), runId);
  }

  private cancelDescendants(parentId: string, seen: Set<string>): void {
    cancelDispatchDescendants(this.dispatchContext(), parentId, seen);
  }

  private schedulingContext(): SchedulingContext {
    const manager = this;
    return {
      store: this.store,
      repoRoot: this.repoRoot,
      lifecycle: this.lifecycle,
      active: this.active,
      starting: this.starting,
      queue: this.queue,
      pendingJobs: this.pendingJobs,
      pendingContinuations: this.pendingContinuations,
      autoResumeTimers: this.autoResumeTimers,
      waiting: this.waiting,
      forceNextPump: {
        get value() { return manager.forceNextPump; },
        set value(value: boolean) { manager.forceNextPump = value; },
      },
      forceStarted: this.forceStarted,
      startNowRequested: this.startNowRequested,
      semaphore: this.semaphore,
      repoRootTail: {
        get value() { return manager.repoRootTail; },
        set value(value: Promise<void>) { manager.repoRootTail = value; },
      },
      repoRootBusy: {
        get value() { return manager.repoRootBusy; },
        set value(value: number) { manager.repoRootBusy = value; },
      },
      lastLimitTick: {
        get value() { return manager.lastLimitTick; },
        set value(value: number) { manager.lastLimitTick = value; },
      },
      queueReasonRevision: {
        get value() { return manager.queueReasonRevision; },
        set value(value: number) { manager.queueReasonRevision = value; },
      },
      policy: {
        accountHeldFor, runAccountKey, resumeInFlight, autoResumeReasonFor, autoResumeCap, formatWakeInstant,
        autoResumeGraceMs: AUTO_RESUME_GRACE_MS, maxAutoResumes: MAX_AUTO_RESUMES,
        autoResumeMissedWindowMs: AUTO_RESUME_MISSED_WINDOW_MS,
        autoResumePrompt: AUTO_RESUME_PROMPT, transientRetryPrompt: TRANSIENT_RETRY_PROMPT,
      },
      pump: () => this.pump(),
      dropActive: (runId) => this.dropActive(runId),
      continueRun: (runId, options, defer) => this.continueRun(runId, options, defer),
      hydrateQueuedInput: (runId, input) => this.hydrateQueuedInput(runId, input),
      cancel: (runId) => this.cancel(runId),
      releaseSlot: () => this.releaseSlot(),
      busySlots: () => this.busySlots(),
      reviveQueuedRun: (run, reason) => this.reviveQueuedRun(run, reason),
      dispatchOf: (runId) => this.dispatchOf(runId),
    };
  }

  // ---- usage-limit auto-resume (spec 2026-08-03-auto-resume-after-usage-limit) --------------

  /**
   * A run just failed: if the provider said "usage limit, back at T", promise to resume it at
   * `T + AUTO_RESUME_GRACE_MS` instead of leaving the task dead until someone notices.
   *
   * Every refusal below is silent-but-honest — the run stays `failed` with its Continue button,
   * which is exactly the pre-feature behavior — except the safety cap, which says so on the
   * transcript, because a run that stops resuming itself needs to explain why.
   */
  private scheduleAutoResumeIfLimited(runId: string): void {
    return schedulingScheduleAutoResumeIfLimited(this.schedulingContext(), runId);
  }

  /** The backend whose session failed — a per-step runner or a Continue override, else the run's. */
  private failedBackend(run: RunRecord): string | undefined {
    return schedulingFailedBackend(run);
  }

  /**
   * A transient provider failure (an overload, no response, the OAuth refresh race between two of
   * onni's own Claude processes): resume the same session after a short backoff, at most
   * `MAX_TRANSIENT_RETRIES` times per streak, through the usage-limit resume's timer and exits.
   */
  private scheduleTransientRetry(run: RunRecord): void {
    return schedulingScheduleTransientRetry(this.schedulingContext(), run);
  }

  private armUsageLimitResume(run: RunRecord): void {
    return schedulingArmUsageLimitResume(this.schedulingContext(), run);
  }

  /** Publish the deadline on the record (the cockpit's only source) and arm the timer for it. */
  private armAutoResume(runId: string, deadline: number, reason: AutoResumeReason): void {
    return schedulingArmAutoResume(this.schedulingContext(), runId, deadline, reason);
  }

  /**
   * The window has reopened. Re-check the record synchronously — hours may have passed, and the
   * user may have continued, deleted or cancelled the run in them — then hand the resume to the
   * ordinary scheduler so it obeys both concurrency caps like any other work.
   */
  private fireAutoResume(runId: string): void {
    return schedulingFireAutoResume(this.schedulingContext(), runId);
  }

  /** Recover the failed workflow agent from the existing durable step/session checkpoint. */
  private interruptedWorkflowStep(run: RunRecord): StepState | undefined {
    return schedulingInterruptedWorkflowStep(this.schedulingContext(), run);
  }

  /**
   * A queued run revived after a restart was an auto-resume `fireAutoResume` queued (#1300) when
   * its walk stopped on the interrupted agent. A walk parked at another node (a restart-resume
   * cursor) keeps that cursor — a failed agent behind a wired `failed` port must not hijack it.
   */
  private queuedUsageLimitResume(run: RunRecord): boolean {
    return schedulingQueuedUsageLimitResume(this.schedulingContext(), run);
  }

  /** Rebuild executable input from the durable record, for auto-resume and queued recovery. */
  private workflowInput(run: RunRecord): StartRunInput {
    return schedulingWorkflowInput(this.schedulingContext(), run);
  }

  /**
   * Make the armed timers agree with the records and the current setting. Runs on every `pump()`
   * — which is where a settings change lands (a config PUT refreshes the shared semaphore, which
   * pumps every manager) — and once from `recover()`.
   *
   * It is a RECONCILE rather than a one-shot restore because the deadline is durable state and
   * the timer is not: a restart, a rebuilt project context, a manager disposed mid-wait, or a
   * refusal all leave a record promising a resume that no timer is holding. Rebuilding from the
   * record covers every one of those at once — the alternative is a hint counting down to a time
   * that has already passed, which is exactly the failure this method exists to make impossible.
   *
   * Cheap: an in-memory scan, and arming is skipped for every run already held.
   */
  private reconcileAutoResumes(): void {
    return schedulingReconcileAutoResumes(this.schedulingContext());
  }

  /**
   * Hand a run that has not spawned anything back to the queue, when the account it would run on
   * went into a usage-limit hold (spec 2026-08-03-auto-resume-after-usage-limit).
   *
   * The dequeue-time gate in `pump()` cannot be the only one: a run can sit between dequeue and
   * spawn for a long time — an in-place run waiting for the exclusive repo-root lease is the
   * measured case — and the account can close in that gap. This is the last honest moment to
   * refuse, because everything after it costs a real agent turn.
   *
   * "Untouched" is the contract: the run has created no session and no worktree, so it goes back
   * as plain `queued` with its `startedAt` cleared, and `pump()` will pick it up when the window
   * reopens. Returns true when the caller must abandon the run.
   */
  private requeueWhileHeld(
    runId: string,
    workflow: WorkflowDef,
    input: StartRunInput,
    runner: RunnerId,
    state?: ActiveRun,
  ): boolean {
    return schedulingRequeueWhileHeld(this.schedulingContext(), runId, workflow, input, runner, state);
  }

  /**
   * The failsafe: a queue must never be able to wedge.
   *
   * Everything else in this file makes an idle queue CORRECT under some condition — a slot cap, a
   * repo-root lease, and now a usage-limit hold. That is also what makes a wedged queue look
   * correct, and the hold has already produced one in the field: two resumes fired together, each
   * holding the account the other was waiting on, and the whole workspace stopped with every task
   * `queued`. That specific bug is fixed and tested, but "the queue stopped and nothing will ever
   * restart it" is too expensive a failure mode to leave resting on any single fix being right.
   *
   * The test is deliberately about JUSTIFICATION rather than about any particular bug: idling is
   * legitimate while work is running (here or in another project), or while a real appointment is
   * still ahead — a scheduled resume that will fire and pump on its own. Anything else is a
   * queue with work in it, nothing running anywhere, and no event coming to wake it. That gets one
   * forced sweep, which starts work under the ordinary caps and lets the account's real state
   * re-assert itself: if the window truly is shut, that task meets the limit and re-establishes an
   * honest hold, with a real deadline behind it this time.
   *
   * Public so a test can drive the wedge directly instead of waiting out the interval.
   */
  rescueStalledQueue(now = Date.now()): Promise<void> {
    return schedulingRescueStalledQueue(this.schedulingContext(), now);
  }

  /**
   * The accounts this project is currently holding: one key per run parked on a usage-limit
   * resume that has not come due yet (spec 2026-08-03-auto-resume-after-usage-limit).
   *
   * Published to the shared semaphore so the hold spans PROJECTS — one Claude account can be
   * driving tasks in three repos, and a limit closes it for all of them. Derived from the
   * records on every ask rather than tracked as state: a deadline that passes, a resume that
   * fires, a cancel, an archive and a delete all lift the hold with no bookkeeping.
   *
   * Deliberately excludes a deadline that has already passed — that run is about to resume, and
   * holding the queue for it would only stall the very work the window reopened for.
   */
  private readonly onQueueHoldChange = () => this.semaphore.notifyAccountHoldsChanged();
  /** Last hold inputs seen per run. Token and title updates fire `run` constantly, and each
   *  notification re-derives every participant's queue reasons, so only hold inputs notify (#1340). */
  private readonly holdInputs = new Map<string, string>();
  private readonly onRunHoldInputs = (run: RunRecord) => {
    const inputs = JSON.stringify([run.status, run.autoResumeAt, run.autoResumeAttempts, run.autoResumeReason, run.runner, run.agentProfile]);
    if (this.holdInputs.get(run.id) === inputs) return;
    this.holdInputs.set(run.id, inputs);
    this.onQueueHoldChange();
  };
  private readonly onRunDeletedHolds = (id: string) => {
    this.holdInputs.delete(id);
    this.onQueueHoldChange();
  };

  private queueReasonRevision = 0;
  private refreshQueueReasons(): void {
    return schedulingRefreshQueueReasons(this.schedulingContext());
  }

  private applyQueueReasons(defaultRunner: RunnerId): void {
    return schedulingApplyQueueReasons(this.schedulingContext(), defaultRunner);
  }

  accountHolds(now = Date.now()): AccountHolds {
    return schedulingAccountHolds(this.schedulingContext(), now);
  }


  /**
   * The PER-TASK off switch (`DELETE /api/v1/runs/:id/auto-resume`, and the archive route):
   * stop resuming THIS task, without touching the workspace setting or any other task.
   *
   * Idempotent — a run with nothing pending answers the same way, because "this task will not
   * resume itself" is equally true either way. Returns false only when the run does not exist,
   * which is the route's 404.
   */
  cancelAutoResume(runId: string): boolean {
    return schedulingCancelAutoResume(this.schedulingContext(), runId);
  }

  /** Retire a pending resume — timer, deadline and counter. The counter goes too because every
   *  caller is a fresh epoch: a human Continue, or a resume that re-stamps its own count. */
  private clearAutoResume(runId: string): void {
    return schedulingClearAutoResume(this.schedulingContext(), runId);
  }

  /** Reclaim finished worktrees beyond the keep-limit (#483) — directory only,
   *  `onni/<id8>` branch kept. Best-effort; a failure never affects run
   *  lifecycle. `review`/live runs are excluded by the selector. */
  /** The latest terminal retention pass — tests await it before pinning refs it may sweep. */
  private retentionPass: Promise<void> = Promise.resolve();
  private enforceRetention(): Promise<void> {
    return schedulingEnforceRetention(this.schedulingContext());
  }

  /** Last live-refresh namer inputs per run — unchanged inputs skip the call. */
  private lastNamerKey = new Map<string, string>();

  /**
   * Acquire the one-at-a-time lease for runs executing in `repoRoot`.
   *
   * A lease waiter is idle, so it parks in `waiting` and gives its
   * `maxParallel` slot back (the #347 rule): isolated worktrees keep using
   * every configured slot while root runs line up. The store status stays
   * `running` — only the queue's busy count changes, so the GUI never shows a
   * lease-blocked run as awaiting user input.
   *
   * The lease is held for the run's whole lifetime, including the idle
   * `waiting` parks between agent turns. A parked session is still live and
   * writes to the working tree the moment it resumes, so handing the tree to
   * another run there would reintroduce the concurrent-edit bug (#438) this
   * lease exists to prevent.
   *
   * Returns false when the run was cancelled while waiting: the lease was
   * never granted and the caller must not touch the working tree.
   */
  /**
   * Give the exclusive working-tree lease back while an in-place run is parked. Only the run that
   * holds one has anything to give (a worktree run never acquired it; `ONNI_DISABLE_REPO_LOCK=1`
   * never granted it). The first live dispatch tree found the gap: a commander running in the
   * repo working tree parked as a monitor for the whole life of its children — slot-exempt, so
   * the queue looked free — while every other in-place task waited on a lease nobody was using.
   *
   * Scoped to runs in a DISPATCH TREE, deliberately. Handing the tree to another run mid-park is
   * a real weakening of #438: the parked session stays live, and its context still describes the
   * files as they were, so it can edit over work another task did while it sat. A dispatch tree
   * has no alternative — its commander parks for as long as its children take, and that is the
   * deadlock above — but an ordinary in-place run parking on `ONNI:ASK` does: keep the lease, as it
   * always has. That is also what makes "a run with no dispatch is untouched" true of this path.
   * `resumeRepoRoot` tells the resuming agent the tree may have moved.
   */
  private parkRepoRoot(runId: string, state: ActiveRun): void {
    return schedulingParkRepoRoot(this.schedulingContext(), runId, state);
  }

  /**
   * The fast counterpart of `resumeRepoRoot`: a tree nobody holds or waits for is taken back on
   * the spot, so the common wake-up (no other in-place task ran meanwhile) resumes the session
   * synchronously — the #347 guarantee that a parked run's resume never queues behind anything.
   */
  private claimFreeRepoRoot(state: ActiveRun): boolean {
    return schedulingClaimFreeRepoRoot(this.schedulingContext(), state);
  }

  /** Chain one more lease onto the tail. `previous` settles when every earlier lease is released;
   *  `release` hands the tree on (idempotent — a lease dropped mid-wait releases exactly once). */
  private chainRepoRoot(): { previous: Promise<void>; release: () => void } {
    return schedulingChainRepoRoot(this.schedulingContext());
  }

  /**
   * The counterpart of `parkRepoRoot`: wait for the tree before the parked session resumes.
   *
   * Reaching here at all means somebody else holds or wants the tree, so it may have been edited
   * while this run sat parked and this session's context predates that. Said twice — in the
   * transcript below, and to the agent itself (`REPO_ROOT_RESUMED_NOTE`, delivered by
   * `deliverMessage` ahead of the message the run woke for) — rather than left for it to discover
   * by clobbering the other task's work.
   */
  private resumeRepoRoot(runId: string, state: ActiveRun): Promise<boolean> {
    return schedulingResumeRepoRoot(this.schedulingContext(), runId, state);
  }

  private acquireRepoRoot(runId: string, state: ActiveRun): Promise<boolean> {
    return schedulingAcquireRepoRoot(this.schedulingContext(), runId, state);
  }

  /**
   * Start a queued run now, over the workspace and project `maxParallel` caps — the queued
   * placeholder's "Start now". The run still waits out a usage-limit hold on its account (starting
   * into a closed window only fails it), so a held run is refused rather than marked to jump the
   * cap later, when nobody is looking.
   */
  startNow(runId: string): Promise<'started' | 'not-queued' | 'held'> {
    return schedulingStartNow(this.schedulingContext(), runId);
  }

  /**
   * The unattended brake (docs/design/unattended-safety.md §2). Adds the elapsed time to every
   * `running` run's durable wall-clock (a restart loses at most one interval), then ends any live
   * run whose ceiling is crossed. A tree-scope breach ends the whole tree from its root. The
   * worktree and session stay, so Continue can pick the task up once the user raises the ceiling.
   */
  sweepLimits(now: number = Date.now()): void {
    return schedulingSweepLimits(this.schedulingContext(), now);
  }

  private stopForLimit(runId: string, hit: LimitHit): void {
    return schedulingStopForLimit(this.schedulingContext(), runId, hit);
  }

  /** "Continue anyway" after a ceiling: extend the ceiling that was hit on this run and its root. */
  private raiseAfterLimit(run: RunRecord): void {
    return schedulingRaiseAfterLimit(this.schedulingContext(), run);
  }

  /**
   * Cancel a run — and, when it commands any, its whole subtree first (spec
   * 2026-09-10-dispatch §Engine, `cancelDescendants` — the third budget brake).
   *
   * Depth-first and children-before-parent: a parent cancelled while its children kept working
   * would be a cost brake that stops the one run that was only supervising. The answer is still
   * this run's own — a cascade that cancelled nothing must not make `cancel` claim it did.
   */
  cancel(runId: string): boolean {
    return lifecycleCancel(this.lifecycleContext(), runId);
  }

  cancelAll(): number {
    return lifecycleCancelAll(this.lifecycleContext());
  }

  private cancelOne(runId: string): boolean {
    return lifecycleCancelOne(this.lifecycleContext(), runId);
  }

  hasScheduledAutoResume(runId: string): boolean {
    return lifecycleHasScheduledAutoResume(this.lifecycleContext(), runId);
  }

  cancelAndWait(runId: string): Promise<boolean> {
    return lifecycleCancelAndWait(this.lifecycleContext(), runId);
  }

  private waitInactive(runId: string, timeoutMs: number): Promise<boolean> {
    return lifecycleWaitInactive(this.lifecycleContext(), runId, timeoutMs);
  }

  private parkLifecycle(runId: string, state: ActiveRun, operationId?: string): void {
    this.clearIdleTimer(state); this.clearAutosaveTimer(state); this.clearMonitoringWakeTimer(state, runId); this.clearMonitoringLivenessTimer(state);
    state.releaseWorktree?.();
    state.releaseRepoRoot?.();
    this.active.delete(runId); this.starting.delete(runId); this.waiting.delete(runId);
    this.monitoring.delete(runId); this.unitParents.delete(runId);
    this.store.updateRun(runId, {status: 'waiting', error: `Worktree scripts need attention${operationId ? ` (${operationId})` : ''}`});
    this.store.appendEvent(runId, {type: 'note', message: `Worktree preparation paused${operationId ? ` — operation ${operationId}` : ''}; use Worktrees settings to Retry, Start task anyway, or Cancel task.`});
    this.releaseSlot();
  }

  isActive(runId: string): boolean {
    return lifecycleIsActive(this.lifecycleContext(), runId);
  }

  private messageContext(): MessageContext {
    return {
      store: this.store,
      dataDir: this.dataDir,
      active: this.active,
      starting: this.starting,
      cancelledStarting: this.cancelledStarting,
      waiting: this.waiting,
      pendingJobs: this.pendingJobs,
      pendingContinuations: this.pendingContinuations,
      deferredMessages: this.deferredMessages,
      deferredManagerDeliveryIds: this.deferredManagerDeliveryIds,
      lifecycle: this.lifecycle,
      repoRootResumedNote: REPO_ROOT_RESUMED_NOTE,
      setDeferred: (runId, pending, deliveryIds) => this.setDeferred(runId, pending, deliveryIds),
      persistPastedAttachments: (runId, content, writes) => this.persistPastedAttachments(runId, content, writes),
      claimFreeRepoRoot: (state) => this.claimFreeRepoRoot(state as ActiveRun),
      resumeRepoRoot: (runId, state) => this.resumeRepoRoot(runId, state as ActiveRun),
      recordManagerDeliveryTransition: (runId, deliveryId, state, reasonCode) =>
        this.recordManagerDeliveryTransition(runId, deliveryId, state, reasonCode),
      enqueueMessage: (runId, content, deliveryId) => this.enqueueMessage(runId, content, deliveryId),
      deferMessage: (runId, content, deliveryId) => this.deferMessage(runId, content, deliveryId),
      sendMessage: (runId, content, replyTo, deliveryId) => this.sendMessage(runId, content, replyTo, deliveryId),
      deliverMessage: (runId, content, userAuthored, prepared, replyTo, deliveryId) =>
        this.deliverMessage(runId, content, userAuthored, prepared, replyTo, deliveryId),
      softAskFor: (runId, requestId) => this.softAskFor(runId, requestId),
      clearPendingAsk: (runId) => this.clearPendingAsk(runId),
      clearSoftAsk: (runId) => this.clearSoftAsk(runId),
      attachmentLibraryHint: (attachments, grantedDir) => this.attachmentLibraryHint(attachments, grantedDir),
      usableAttachmentLibrary: (grantedDir) => this.usableAttachmentLibrary(grantedDir),
      provisionTaskSkills: (state, wantedSkills) => this.provisionTaskSkills(state as ActiveRun, wantedSkills),
      clearIdleTimer: (state) => this.clearIdleTimer(state as ActiveRun),
      clearMonitoringWakeTimer: (state, runId) => this.clearMonitoringWakeTimer(state as ActiveRun, runId),
      leaveMonitoring: (runId) => this.leaveMonitoring(runId),
      leadingSlashSkillName,
      expandRegistrySlashSkill,
    };
  }

  private hydrateQueuedInput(runId: string, input: StartRunInput): StartRunInput {
    return messageHydrateQueuedInput(this.messageContext(), runId, input);
  }

  private hydrateQueuedContinuation(
    runId: string,
    continuation: PendingContinuation,
  ): PendingContinuation & { persistedImages: ContentBlock[]; persistedAttachments: PersistedAttachment[] } {
    return messageHydrateQueuedContinuation(this.messageContext(), runId, continuation);
  }

  private attachmentsDir(runId: string): string {
    return messageAttachmentsDir(this.messageContext(), runId);
  }

  private readPersistedAttachments(
    runId: string,
    urls: string[],
    kind: 'task' | 'queued',
  ): PersistedAttachments {
    return messageReadPersistedAttachments(this.messageContext(), runId, urls, kind);
  }

  private isQueued(runId: string): boolean {
    return messageIsQueued(this.messageContext(), runId);
  }

  private toQueuedMessage(runId: string, content: PastedContent[], managerDeliveryId?: string): QueuedMessage {
    return messageToQueuedMessage(this.messageContext(), runId, content, managerDeliveryId);
  }

  enqueueMessage(runId: string, content: PastedContent[], managerDeliveryId?: string): QueuedMessage | null {
    return messageEnqueueMessage(this.messageContext(), runId, content, managerDeliveryId);
  }

  editQueuedMessage(
    runId: string,
    msgId: string,
    edit: { text?: string; images?: PastedContent[] },
  ): QueuedMessage | null {
    return messageEditQueuedMessage(this.messageContext(), runId, msgId, edit);
  }

  removeQueuedMessage(runId: string, msgId: string): boolean {
    return messageRemoveQueuedMessage(this.messageContext(), runId, msgId);
  }

  private dropOrphanImages(runId: string, candidates: string[], stack: QueuedMessage[]): void {
    messageDropOrphanImages(this.messageContext(), runId, candidates, stack);
  }

  editTask(runId: string, task: string): boolean {
    return messageEditTask(this.messageContext(), runId, task);
  }

  deferMessage(runId: string, content: PastedContent[], managerDeliveryId?: string): boolean {
    return messageDeferMessage(this.messageContext(), runId, content, managerDeliveryId);
  }

  private flushDeferred(runId: string): void {
    messageFlushDeferred(this.messageContext(), runId);
  }

  sendMessage(runId: string, content: PastedContent[], replyTo?: string, managerDeliveryId?: string): boolean {
    return messageSendMessage(this.messageContext(), runId, content, replyTo, managerDeliveryId);
  }

  private deliverMessage(
    runId: string,
    content: PastedContent[],
    userAuthored: boolean,
    preparedUserMessage?: PreparedUserMessage,
    replyTo?: string,
    managerDeliveryId?: string,
  ): boolean {
    return messageDeliverMessage(
      this.messageContext(), runId, content, userAuthored, preparedUserMessage, replyTo, managerDeliveryId,
    );
  }

  private withAnswerLead(question: string | undefined, answer: string | undefined, blocks: ContentBlock[]): ContentBlock[] {
    return messageWithAnswerLead(this.messageContext(), question, answer, blocks);
  }

  private continuationContext(): ContinuationContext {
    const state = (run: ContinuationActiveRun): ActiveRun => run as ActiveRun;
    return {
      store: this.store,
      repoRoot: this.repoRoot,
      dataDir: this.dataDir,
      lifecycle: this.lifecycle,
      active: this.active as unknown as ContinuationContext['active'],
      starting: this.starting,
      queue: this.queue,
      pendingContinuations: this.pendingContinuations,
      checkArtifactSnapshots: this.checkArtifactSnapshots,
      autosaveCheckpointBlockedRuns: this.autosaveCheckpointBlockedRuns,
      waiting: this.waiting,
      helpers: {
        configuredModelProvider: (backend, cwd) => configuredModelProvider(backend, cwd),
        endsWithMonitoringMarker,
        endsWithDoneMarker,
        appendTurnText,
        stripDoneMarker,
        stripMonitoringMarker,
        resolveAskTurn,
        markerlessTurn,
        repositoryRootLockDisabled,
        repositoryRootLockDisabledNote: REPOSITORY_ROOT_LOCK_DISABLED_NOTE,
        continuableStatuses: CONTINUABLE_STATUSES,
        maxAutoContinues: MAX_AUTO_CONTINUES,
        leadingSlashSkillName,
        expandRegistrySlashSkillText,
        currentCheckExclusions,
      },
      abandonCancelledStart: (runId) => this.abandonCancelledStart(runId),
      acquireRepoRoot: (runId, run) => this.acquireRepoRoot(runId, state(run)),
      agentEnvForStep: (runId, backend, options) => this.agentEnvForStep(runId, backend, options),
      agentPermissionSpec: (runId, backend, onEvent) => this.agentPermissionSpec(runId, backend, onEvent),
      armAutosave: (runId, run) => this.armAutosave(runId, state(run)),
      armIdleTimer: (runId, run) => this.armIdleTimer(runId, state(run)),
      armMonitoringWakeTimer: (runId, run) => this.armMonitoringWakeTimer(runId, state(run)),
      attachmentLibraryHint: (attachments, grantedDir) => this.attachmentLibraryHint(attachments, grantedDir),
      attachmentsDir: (runId) => this.attachmentsDir(runId),
      beginUsageInvocation: (runId, run, stepId) => this.beginUsageInvocation(runId, state(run), stepId),
      clearAutoResume: (runId) => this.clearAutoResume(runId),
      clearAutosaveTimer: (run) => this.clearAutosaveTimer(state(run)),
      clearIdleTimer: (run) => this.clearIdleTimer(state(run)),
      clearMonitoringWakeTimer: (run, runId) => this.clearMonitoringWakeTimer(state(run), runId),
      clearSoftAsk: (runId) => this.clearSoftAsk(runId),
      dropActive: (runId, run) => this.dropActive(runId, run ? state(run) : undefined),
      enterMonitoring: (runId, spawnParked) => this.enterMonitoring(runId, spawnParked),
      failOwnedContinuation: (runId, ownerToken, message) => this.failOwnedContinuation(runId, ownerToken, message),
      finishReview: (runId) => this.finishReview(runId),
      flushDeferred: (runId) => this.flushDeferred(runId),
      flushInbox: (runId) => this.flushInbox(runId),
      flushPendingReports: (runId) => this.flushPendingReports(runId),
      handleDispatchTurn: (runId, turnText, ctx) => this.handleDispatchTurn(runId, turnText, {
        ...ctx,
        state: state(ctx.state),
      }),
      handleRunnerUiEvent: (runId, run, sink, event) => this.handleRunnerUiEvent(runId, state(run), sink, event),
      idleClosedFails: (runId, run) => this.idleClosedFails(runId, state(run)),
      inactivityFailureMessage: (runId, run) => this.inactivityFailureMessage(runId, run ? state(run) : undefined),
      isActive: (runId) => this.isActive(runId),
      landingPolicy: (run, config) => this.landingPolicy(run, config),
      landOnDone: (runId, run, stepId, close) => this.landOnDone(runId, state(run), stepId, close),
      landWithAgent: (runId, run, stepId, close) => this.landWithAgent(runId, state(run), stepId, close),
      leaveMonitoring: (runId) => this.leaveMonitoring(runId),
      loadManagerSessionContext: (runId, run) => this.loadManagerSessionContext(runId, state(run)),
      makeUiSink: (runId, stepId) => this.makeUiSink(runId, stepId),
      markQueuedManagerDeliveriesDelivered: (runId) => this.markQueuedManagerDeliveriesDelivered(runId),
      parkLifecycle: (runId, run, operationId) => this.parkLifecycle(runId, state(run), operationId),
      parkRepoRoot: (runId, run) => this.parkRepoRoot(runId, state(run)),
      persistAttachment: (runId, mediaType, data, namePrefix, ext) => this.persistAttachment(runId, mediaType, data, namePrefix, ext),
      persistPastedAttachments: (runId, content) => this.persistPastedAttachments(runId, content),
      prepareAttachmentLibrary: () => this.prepareAttachmentLibrary(),
      prepareAutomationsSession: (run) => this.prepareAutomationsSession(state(run)),
      prepareDispatchSession: (runId, run, context) => this.prepareDispatchSession(runId, state(run), context),
      privateMcpForLaunch: (backend, onEvent) => this.privateMcpForLaunch(backend, onEvent),
      provisionTaskSkills: (run, wantedSkills) => this.provisionTaskSkills(state(run), wantedSkills),
      raiseAfterLimit: (run) => this.raiseAfterLimit(run),
      recordAsk: (runId, sink, ask) => this.recordAsk(runId, sink, ask),
      recordNoteMeta: (runId, event) => this.recordNoteMeta(runId, event),
      recordTurnEnd: (runId, turnText, run) => this.recordTurnEnd(runId, turnText, run ? state(run) : undefined),
      recordUsagePeaks: (runId, run) => this.recordUsagePeaks(runId, state(run)),
      releaseSlot: () => this.releaseSlot(),
      runContinuation: (runId, stepId, sessionId, backend, prompt, images, persistedImages, persistedAttachments, ownerToken) =>
        this.runContinuation(runId, stepId, sessionId, backend, prompt, images, persistedImages, persistedAttachments, ownerToken),
      sessionCostUsd: (runId, sessionId) => this.sessionCostUsd(runId, sessionId),
      settleSuccess: (runId, run) => this.settleSuccess(runId, run ? state(run) : undefined),
      settleUnansweredPark: (runId, finishedAt, monitorHandoff) => this.settleUnansweredPark(runId, finishedAt, monitorHandoff),
      softAskFor: (runId, requestId) => this.softAskFor(runId, requestId),
      tryAutonomousNudge: (runId, run, stepId, ask, dispatchTurn) => this.tryAutonomousNudge(runId, state(run), stepId, ask, dispatchTurn),
      tryCompactionContinue: (runId, run, stepId, opts) => this.tryCompactionContinue(runId, state(run), stepId, opts),
    };
  }

  /** Close the open session gracefully — the run then completes as `done`
   *  (or rests at `review` when the worktree holds changes, spec 009).
   *  On a run already resting at `review` (no session — the engine loop is
   *  over), "Finish" is the third review exit: accept the changes without a
   *  PR and flip straight to `done`. */
  finish(runId: string): boolean {
    return finishContinuation(this.continuationContext(), runId);
  }

  /**
   * "Continue" (spec 003): reopen a finished run's claude session in-process
   * (`claude --resume <sessionId>`) as a new synthetic step. The session then
   * behaves exactly like an interactive step: `waiting` after each turn,
   * messages via sendMessage, closed by finish/idle/cancel.
   */
  continueRun(
    runId: string,
    opts: ContinueRunOptions = {},
    /** Restart recovery may discover several interrupted tasks at once. Those
     *  continuations are queued; an explicit user Continue remains immediate. */
    deferForCapacity = false,
  ): { ok: boolean; error?: string } {
    return continueContinuation(this.continuationContext(), runId, opts, deferForCapacity);
  }

  private runContinuation(
    runId: string,
    stepId: string,
    sessionId: string | undefined,
    backend: RunnerId,
    prompt: string,
    images: PastedContent[] = [],
    persistedImages: ContentBlock[] = [],
    persistedAttachments: PersistedAttachment[] = [],
    ownerToken?: symbol,
  ): Promise<void> {
    return runContinuationTask(
      this.continuationContext(), runId, stepId, sessionId, backend, prompt,
      images, persistedImages, persistedAttachments, ownerToken,
    );
  }

  // ---- execution -----------------------------------------------------------

  private executeContext(): ExecuteContext {
    return {
      store: this.store,
      repoRoot: this.repoRoot,
      dataDir: this.dataDir,
      active: this.active,
      starting: this.starting,
      pendingBranchNames: this.pendingBranchNames,
      checkArtifactSnapshots: this.checkArtifactSnapshots,
      autosaveCheckpointBlockedRuns: this.autosaveCheckpointBlockedRuns,
      lifecycle: this.lifecycle,
      repositoryRootLockDisabledNote: REPOSITORY_ROOT_LOCK_DISABLED_NOTE,
      configuredModelProvider,
      currentCheckExclusions,
      repositoryRootLockDisabled,
      interruptedWorkflowStep: (run) => this.interruptedWorkflowStep(run),
      requeueWhileHeld: (runId, workflow, input, runner, state) => this.requeueWhileHeld(runId, workflow, input, runner, state),
      landingPolicy: (run, config, note) => this.landingPolicy(run, config, note),
      awaitGeneratedBranch: (runId, branchNaming, note) => this.awaitGeneratedBranch(runId, branchNaming, note),
      acquireRepoRoot: (runId, state) => this.acquireRepoRoot(runId, state),
      parkLifecycle: (runId, state, operationId) => this.parkLifecycle(runId, state, operationId),
      armAutosave: (runId, state) => this.armAutosave(runId, state),
      loadManagerSessionContext: (runId, state) => this.loadManagerSessionContext(runId, state),
      prepareDispatchSession: (runId, state, context) => this.prepareDispatchSession(runId, state, context),
      prepareAutomationsSession: (state) => this.prepareAutomationsSession(state),
      executeGraph: (runId, state, workflow, graph, options) =>
        this.executeGraph(runId, state, workflow, graph, options),
      clearAutosaveTimer: (state) => this.clearAutosaveTimer(state),
      settleUnansweredPark: (runId, finishedAt, monitorHandoff) =>
        this.settleUnansweredPark(runId, finishedAt, monitorHandoff),
      inactivityFailureMessage: (runId, state) => this.inactivityFailureMessage(runId, state),
      settleSuccess: (runId, state) => this.settleSuccess(runId, state),
      clearIdleTimer: (state) => this.clearIdleTimer(state),
      dropActive: (runId, state) => this.dropActive(runId, state),
    };
  }

  private execute(runId: string, workflow: WorkflowDef, input: StartRunInput, ownerToken?: symbol): Promise<void> {
    return runExecute(this.executeContext(), runId, workflow, input, ownerToken);
  }
  private graphContext(): GraphContext {
    return {
      store: this.store,
      repoRoot: this.repoRoot,
      dataDir: this.dataDir,
      active: this.active,
      waiting: this.waiting,
      autosaveCheckpointBlockedRuns: this.autosaveCheckpointBlockedRuns,
      resumableBackends: RESUMABLE_BACKENDS,
      applyTemplate,
      cardReply,
      autoResumeReasonFor,
      currentCheckExclusions,
      captureCheckArtifacts,
      runAgentStep: (runId, state, step, input, skills, checkFailure, interactive, emit, images, taskBackend, extraSystemPrompt, chainNote, attachments, graphHooks) =>
        this.runAgentStep(runId, state as ActiveRun, step, input, skills, checkFailure, interactive, emit, images, taskBackend, extraSystemPrompt, chainNote, attachments, graphHooks),
      runCheckStep: (runId, state, step, emit) => this.runCheckStep(runId, state as ActiveRun, step, emit),
      finishStep: (runId, stepId, status, error, emit) => this.finishStep(runId, stepId, status, error, emit),
      idleClosedFails: (runId, state) => this.idleClosedFails(runId, state as ActiveRun),
      inactivityFailureMessage: (runId, state) => this.inactivityFailureMessage(runId, state as ActiveRun | undefined),
      dispatch: (parentId, input, opts) => this.dispatch(parentId, input, opts),
      cancel: runId => this.cancel(runId),
      releaseSlot: () => this.releaseSlot(),
      parkRepoRoot: (runId, state) => this.parkRepoRoot(runId, state as ActiveRun),
      claimFreeRepoRoot: state => this.claimFreeRepoRoot(state as ActiveRun),
      resumeRepoRoot: (runId, state) => this.resumeRepoRoot(runId, state as ActiveRun),
      makeUiSink: (runId, stepId) => this.makeUiSink(runId, stepId),
      recordAttention: (requestId, input) => this.recordAttention(requestId, input),
      runFork: (graph, runId, state, fork, shape, outputs, task, emit, onOutputs, resuming) =>
        this.runFork(graph, runId, state, fork, shape, outputs, task, emit, onOutputs, resuming),
      runSystemNode: (runId, state, node, outputs, task, emit, onOutputs, resuming) =>
        this.runSystemNode(runId, state, node, outputs, task, emit, onOutputs, resuming),
      awaitChildren: (runId, state, nodeId, childIds, mode) => this.awaitChildren(runId, state, nodeId, childIds, mode),
      findWorkflow: name => this.findWorkflow(name),
    };
  }

  /**
   * Walk a graph workflow (spec 2026-09-30-workflow-node-editor, phase 1): the graph twin of the
   * v1 step loop in `execute`, using the same step runners, rail updates and settlement. Each
   * finished node emits one port; `advance` follows it through loop nodes to the next agent or
   * check node, or to the run's end. Returns the run error, or null for a successful end.
   *
   * Semantics kept from v1: a failing check's output is handed to the next agent it reaches
   * (the retry prompt); an agent node whose `done` ends the run is the interactive tail; a
   * mid-graph `ONNI:ASK` park ends the walk and the settlement in `execute` owns the outcome.
   */
  // executeGraphTask owns this async boundary; an async pass-through races cancelAndWait (worktree-lifecycle.test.ts).
  private executeGraph(
    runId: string,
    state: ActiveRun,
    workflow: WorkflowDef,
    graph: WorkflowGraph,
    ctx: {
      input: StartRunInput;
      skills: Skill[];
      emit: (event: { type: string; stepId?: string; [k: string]: unknown }) => void;
      taskBackend: RunnerId;
      extraSystemPrompt: string | undefined;
      startImages: ContentBlock[] | undefined;
      startAttachments: PersistedAttachment[];
      /** The walk so far, when this run is being RESUMED after a restart (`graphState.cursor`). */
      resume?: RunRecord['graphState'];
      /** The agent step a usage limit interrupted (#1300); `resume.cursor` points at it. */
      usageLimitResume?: StepState;
    },
  ): Promise<string | null> {
    return executeGraphTask(this.graphContext(), runId, state, workflow, graph, ctx);
  }

  private sessionCostUsd(runId: string, sessionId: string): number {
    return graphSessionCostUsd(this.graphContext(), runId, sessionId);
  }

  private resumeInterruptedAgent(
    ...args: Parameters<typeof graphResumeInterruptedAgent> extends [GraphContext, ...infer Rest] ? Rest : never
  ): ReturnType<typeof graphResumeInterruptedAgent> {
    return graphResumeInterruptedAgent(this.graphContext(), ...args);
  }

  private runFork(
    ...args: Parameters<typeof graphRunFork> extends [GraphContext, ...infer Rest] ? Rest : never
  ): ReturnType<typeof graphRunFork> {
    return graphRunFork(this.graphContext(), ...args);
  }

  private runSystemNode(
    ...args: Parameters<typeof graphRunSystemNode> extends [GraphContext, ...infer Rest] ? Rest : never
  ): ReturnType<typeof graphRunSystemNode> {
    return graphRunSystemNode(this.graphContext(), ...args);
  }

  private awaitChildren(
    ...args: Parameters<typeof graphAwaitChildren> extends [GraphContext, ...infer Rest] ? Rest : never
  ): ReturnType<typeof graphAwaitChildren> {
    return graphAwaitChildren(this.graphContext(), ...args);
  }

  private findWorkflow(
    ...args: Parameters<typeof graphFindWorkflow> extends [GraphContext, ...infer Rest] ? Rest : never
  ): ReturnType<typeof graphFindWorkflow> {
    return graphFindWorkflow(this.graphContext(), ...args);
  }

  private evaluateCondition(
    ...args: Parameters<typeof graphEvaluateCondition> extends [GraphContext, ...infer Rest] ? Rest : never
  ): ReturnType<typeof graphEvaluateCondition> {
    return graphEvaluateCondition(this.graphContext(), ...args);
  }

  private parkForUser(
    ...args: Parameters<typeof graphParkForUser> extends [GraphContext, ...infer Rest] ? Rest : never
  ): ReturnType<typeof graphParkForUser> {
    return graphParkForUser(this.graphContext(), ...args);
  }

  private parkGraphNode(
    ...args: Parameters<typeof graphParkGraphNode> extends [GraphContext, ...infer Rest] ? Rest : never
  ): ReturnType<typeof graphParkGraphNode> {
    return graphParkGraphNode(this.graphContext(), ...args);
  }

  private graphResumeSession(
    ...args: Parameters<typeof graphResumeGraphSession> extends [GraphContext, ...infer Rest] ? Rest : never
  ): ReturnType<typeof graphResumeGraphSession> {
    return graphResumeGraphSession(this.graphContext(), ...args);
  }

  private provisionTaskSkills(
    state: ActiveRun,
    wantedSkills: { stepSkill?: string; slash?: string },
  ): Promise<string[]> {
    return graphProvisionTaskSkills(this.graphContext(), state, wantedSkills);
  }

  /** Build the live manager seams required by one agent step. */
  private agentStepContext(): AgentStepContext {
    return {
      store: this.store,
      repoRoot: this.repoRoot,
      dataDir: this.dataDir,
      active: this.active,
      waiting: this.waiting,
      pendingBranchNames: this.pendingBranchNames,
      branchNameWaitMs: this.branchNameWaitMs,
      maxCompactionContinues: MAX_COMPACTION_CONTINUES,
      autoResumePrompt: AUTO_RESUME_PROMPT,
      transientRetryPrompt: TRANSIENT_RETRY_PROMPT,
      configuredModelProvider,
      appendTurnText,
      stripDoneMarker,
      stripMonitoringMarker,
      endsWithDoneMarker,
      endsWithMonitoringMarker,
      resolveAskTurn,
      markerlessTurn,
      autoResumeReasonFor,
      deferredBindingActive,
      provisionTaskSkills: (state, wanted) => this.provisionTaskSkills(state as ActiveRun, wanted),
      flushPendingReports: (runId) => this.flushPendingReports(runId),
      flushInbox: (runId) => this.flushInbox(runId),
      flushDeferred: (runId) => this.flushDeferred(runId),
      prepareAttachmentLibrary: () => this.prepareAttachmentLibrary(),
      attachmentLibraryHint: (attachments, grantedDir) => this.attachmentLibraryHint(attachments, grantedDir),
      attachmentsDir: (runId) => this.attachmentsDir(runId),
      persistAttachment: (runId, mediaType, data) => this.persistAttachment(runId, mediaType, data),
      recordNoteMeta: (runId, event) => this.recordNoteMeta(runId, event),
      agentEnvForStep: (runId, backend, options) => this.agentEnvForStep(runId, backend, options),
      privateMcpForLaunch: (backend, onEvent) => this.privateMcpForLaunch(backend, onEvent),
      agentPermissionSpec: (runId, backend, onEvent) => this.agentPermissionSpec(runId, backend, onEvent),
      markQueuedManagerDeliveriesDelivered: (runId) => this.markQueuedManagerDeliveriesDelivered(runId),
      handleDispatchTurn: (runId, text, turn) => this.handleDispatchTurn(runId, text, turn as { state: ActiveRun; stepId: string; done: boolean }),
      recordTurnEnd: (runId, text, state) => this.recordTurnEnd(runId, text, state as ActiveRun | undefined),
      landOnDone: (runId, state, stepId, close) => this.landOnDone(runId, state as ActiveRun, stepId, close),
      tryAutonomousNudge: (runId, state, stepId, ask, turn) => this.tryAutonomousNudge(runId, state as ActiveRun, stepId, ask, turn),
      tryCompactionContinue: (runId, state, stepId, options) => this.tryCompactionContinue(runId, state as ActiveRun, stepId, options),
      recordAsk: (runId, sink, ask) => this.recordAsk(runId, sink, ask),
      enterMonitoring: (runId, spawnParked) => this.enterMonitoring(runId, spawnParked),
      leaveMonitoring: (runId) => this.leaveMonitoring(runId),
      releaseSlot: () => this.releaseSlot(),
      parkRepoRoot: (runId, state) => this.parkRepoRoot(runId, state as ActiveRun),
      armIdleTimer: (runId, state) => this.armIdleTimer(runId, state as ActiveRun),
      clearIdleTimer: (state) => this.clearIdleTimer(state as ActiveRun),
      armMonitoringWakeTimer: (runId, state) => this.armMonitoringWakeTimer(runId, state as ActiveRun),
      clearMonitoringWakeTimer: (state, runId) => this.clearMonitoringWakeTimer(state as ActiveRun, runId),
      recordUsagePeaks: (runId, state) => this.recordUsagePeaks(runId, state as ActiveRun),
      sessionCostUsd: (runId, sessionId) => this.sessionCostUsd(runId, sessionId),
      recordAttention: (requestId, questions) => this.recordAttention(requestId, questions),
      makeUiSink: (runId, stepId) => makeAgentStepUiSink(this.agentStepContext(), runId, stepId),
      handleRunnerUiEvent: (runId, state, sink, event) =>
        handleAgentStepRunnerUiEvent(this.agentStepContext(), runId, state, sink, event),
      beginUsageInvocation: (runId, state, stepId) =>
        beginAgentStepUsageInvocation(this.agentStepContext(), runId, state, stepId),
      recordUsageUiEvent: (runId, state, event) =>
        recordAgentStepUsageUiEvent(this.agentStepContext(), runId, state, event),
      persistUsageCheckpoint: (runId, stepId, patch) =>
        persistAgentStepUsageCheckpoint(this.agentStepContext(), runId, stepId, patch),
    };
  }

  // runAgentStepTask owns this boundary too; another async pass-through delays graph settlement (worktree-lifecycle.test.ts).
  private runAgentStep(
    ...args: Parameters<typeof runAgentStepTask> extends [AgentStepContext, ...infer Rest] ? Rest : never
  ): ReturnType<typeof runAgentStepTask> {
    return runAgentStepTask(this.agentStepContext(), ...args);
  }

  private makeUiSink(runId: string, stepId: string): UiEventSink {
    return makeAgentStepUiSink(this.agentStepContext(), runId, stepId);
  }

  private handleRunnerUiEvent(runId: string, state: ActiveRun, sink: UiEventSink, event: UiEvent): void {
    handleAgentStepRunnerUiEvent(this.agentStepContext(), runId, state, sink, event);
  }

  private beginUsageInvocation(runId: string, state: ActiveRun, stepId: string): void {
    beginAgentStepUsageInvocation(this.agentStepContext(), runId, state, stepId);
  }

  private autoNameRun(
    runId: string,
    skillName: string | undefined,
    task: string,
    live?: { turnText?: string; diffStat?: string },
  ): Promise<string | undefined> {
    return autoNameRunTask(this.agentStepContext(), runId, skillName, task, live);
  }

  private awaitGeneratedBranch(
    runId: string,
    branchNaming: string | undefined,
    note: (message: string) => void,
  ): Promise<string | undefined> {
    return awaitGeneratedBranchTask(this.agentStepContext(), runId, branchNaming, note);
  }

  private settlementContext(): SettlementContext {
    return {
      store: this.store,
      repoRoot: this.repoRoot,
      dataDir: this.dataDir,
      active: this.active,
      waiting: this.waiting,
      lastNamerKey: this.lastNamerKey,
      queuedImageSeq: this.queuedImageSeq,
      repoRootBusy: () => this.repoRootBusy,
      applyTurnMarkers: (runId, run, turnText) => this.applyTurnMarkers(runId, run, turnText),
      agentEnv: runId => this.agentEnv(runId),
      armIdleTimer: (runId, state) => this.armIdleTimer(runId, state as ActiveRun),
      autoNameRun: (runId, skillName, task, live) => this.autoNameRun(runId, skillName, task, live),
      chainRepoRoot: () => this.chainRepoRoot(),
      clearIdleTimer: state => this.clearIdleTimer(state as ActiveRun),
      clearMonitoringWakeTimer: (state, runId) => this.clearMonitoringWakeTimer(state as ActiveRun, runId),
      continueRun: (runId, opts) => this.continueRun(runId, opts),
      deliverMessage: (runId, content, announce) => this.deliverMessage(runId, content, announce),
      fileInAttachmentLibrary: (saved, name, deferredWrites) => this.fileInAttachmentLibrary(saved, name, deferredWrites),
      landBeforeSettle: runId => this.landBeforeSettle(runId),
      landNow: (runId, policy) => this.landNow(runId, policy as NonNullable<ActiveRun['autoLand']>),
      landWithAgent: (runId, state, stepId, close) => this.landWithAgent(runId, state as ActiveRun, stepId, close),
      landingFence: runId => this.landingFence(runId),
      landingPolicy: (run, config, note) => this.landingPolicy(run, config, note),
      latestRequest: runId => this.latestRequest(runId),
      isActive: runId => this.isActive(runId),
      leaveMonitoring: runId => this.leaveMonitoring(runId),
      maybeRefreshTitle: (runId, turnText) => this.maybeRefreshTitle(runId, turnText),
      parkForReview: (runId, state, stepId) => this.parkForReview(runId, state as ActiveRun, stepId),
      persistAttachment: (runId, mediaType, data, namePrefix, ext) => this.persistAttachment(runId, mediaType, data, namePrefix, ext),
      reviewGateApplies: runId => this.reviewGateApplies(runId),
      releaseSlot: () => this.releaseSlot(),
      reviveWorkflow: run => this.reviveWorkflow(run),
      usableAttachmentLibrary: grantedDir => this.usableAttachmentLibrary(grantedDir),
    };
  }

  recordTurnEnd(runId: string, turnText: string, owner?: ActiveRun): Promise<void> {
    return recordSettlementTurnEnd(this.settlementContext(), runId, turnText, owner);
  }

  private applyTurnMarkers(runId: string, run: RunRecord, turnText: string): void {
    return applySettlementTurnMarkers(this.settlementContext(), runId, run, turnText);
  }

  private maybeRefreshTitle(runId: string, turnText: string): Promise<void> {
    return refreshSettlementTitle(this.settlementContext(), runId, turnText);
  }

  private recordUsagePeaks(runId: string, owner: ActiveRun): void {
    return recordSettlementUsagePeaks(this.settlementContext(), runId, owner);
  }

  private settleUnansweredPark(runId: string, finishedAt: string, monitorHandoff: boolean): void {
    return settleRunUnansweredPark(this.settlementContext(), runId, finishedAt, monitorHandoff);
  }

  private settleSuccess(runId: string, owner?: ActiveRun): Promise<boolean> {
    return settleRunSuccess(this.settlementContext(), runId, owner);
  }

  private landingPolicy(
    run: RunRecord | undefined,
    config: OnniConfig,
    note?: (message: string) => void,
  ): Promise<ActiveRun['autoLand']> {
    return settlementLandingPolicy(this.settlementContext(), run, config, note);
  }

  private latestRequest(runId: string): string | undefined {
    return settlementLatestRequest(this.settlementContext(), runId);
  }

  private landingFence(runId: string): () => boolean {
    return settlementLandingFence(this.settlementContext(), runId);
  }

  private landNow(runId: string, policy: NonNullable<ActiveRun['autoLand']>): Promise<LandResult> {
    return landSettlementNow(this.settlementContext(), runId, policy);
  }

  private landOnDone(runId: string, state: ActiveRun, stepId: string | undefined, close: () => void): boolean {
    return landSettlementOnDone(this.settlementContext(), runId, state, stepId, close);
  }

  private parkForReview(runId: string, state: ActiveRun, stepId: string | undefined): void {
    return parkSettlementForReview(this.settlementContext(), runId, state, stepId);
  }

  private landWithAgent(
    runId: string,
    state: ActiveRun,
    stepId: string | undefined,
    close: () => void,
  ): Promise<LandResult> | undefined {
    return landSettlementWithAgent(this.settlementContext(), runId, state, stepId, close);
  }

  land(runId: string): Promise<import('./run/settlement.ts').LandAnswer> {
    return landSettlement(this.settlementContext(), runId);
  }

  private finishReview(runId: string): Promise<void> {
    return finishSettlementReview(this.settlementContext(), runId);
  }

  private landBeforeSettle(runId: string): Promise<string | 'review' | undefined> {
    return landSettlementBeforeSettle(this.settlementContext(), runId);
  }

  private reviewGateApplies(runId: string): Promise<boolean> {
    return settlementReviewGateApplies(this.settlementContext(), runId);
  }

  private idleClosedFails(runId: string, state: ActiveRun): Promise<boolean> {
    return settlementIdleClosedFails(this.settlementContext(), runId, state);
  }

  private inactivityFailureMessage(runId?: string, state?: ActiveRun): string {
    return settlementInactivityFailureMessage(this.settlementContext(), runId, state);
  }

  private persistPastedAttachments(
    runId: string,
    content: readonly PastedContent[],
    imageLibraryWrites?: Array<() => void>,
  ): PersistedAttachment[] {
    return persistSettlementPastedAttachments(this.settlementContext(), runId, content, imageLibraryWrites);
  }

  private fileInAttachmentLibrary(
    saved: PersistedAttachment | null,
    name: string | undefined,
    deferredWrites?: Array<() => void>,
  ): PersistedAttachment | null {
    return settlementFileInAttachmentLibrary(this.settlementContext(), saved, name, deferredWrites);
  }

  private grantableAttachmentLibrary(): string | undefined {
    return settlementGrantableAttachmentLibrary(this.settlementContext());
  }

  private prepareAttachmentLibrary(): string | undefined {
    return prepareSettlementAttachmentLibrary(this.settlementContext());
  }

  private attachmentLibraryHint(attachments: PersistedAttachment[], grantedDir?: string): string | undefined {
    return settlementAttachmentLibraryHint(this.settlementContext(), attachments, grantedDir);
  }

  private usableAttachmentLibrary(grantedDir: string | undefined): string | undefined {
    return settlementUsableAttachmentLibrary(this.settlementContext(), grantedDir);
  }

  private persistAttachment(
    runId: string,
    mediaType: string,
    data: string,
    namePrefix: string = 'screenshot',
    ext: string = attachmentExtension(mediaType),
  ): PersistedAttachment | null {
    return persistSettlementAttachment(this.settlementContext(), runId, mediaType, data, namePrefix, ext);
  }

  private monitoringContext(): MonitoringContext {
    return {
      active: this.active,
      monitoring: this.monitoring,
      unitParents: this.unitParents,
      store: this.store,
      semaphore: this.semaphore,
      dataDir: this.dataDir,
      repoRoot: this.repoRoot,
      releaseSlot: () => this.releaseSlot(),
      leaveMonitoring: (runId) => this.leaveMonitoring(runId),
      parkMonitorAsWaiting: (runId, state, message) =>
        this.parkMonitorAsWaiting(runId, state, message),
      armIdleTimer: (runId, state) => this.armIdleTimer(runId, state),
      deliverMessage: (runId, content, userAuthored) => this.deliverMessage(runId, content, userAuthored),
    };
  }

  private tryAutonomousNudge(
    runId: string,
    state: ActiveRun,
    stepId: string,
    ask: AskRequest | null,
    dispatchTurn: DispatchTurnResult,
  ): boolean {
    return monitoringTryAutonomousNudge(this.monitoringContext(), runId, state, stepId, ask, dispatchTurn);
  }

  private tryCompactionContinue(
    runId: string,
    state: ActiveRun,
    stepId: string,
    opts: { markerless: boolean; dispatchTurn: DispatchTurnResult },
  ): boolean {
    return monitoringTryCompactionContinue(this.monitoringContext(), runId, state, stepId, opts);
  }

  private armIdleTimer(runId: string, state: MonitoringActiveRun): void {
    monitoringArmIdleTimer(this.monitoringContext(), runId, state);
  }

  private clearIdleTimer(state: ActiveRun): void {
    monitoringClearIdleTimer(this.monitoringContext(), state);
  }

  private reconcileMonitoringWakeTimers(): void {
    monitoringReconcileMonitoringWakeTimers(this.monitoringContext());
  }

  private armMonitoringWakeTimer(runId: string, state: ActiveRun): void {
    monitoringArmMonitoringWakeTimer(this.monitoringContext(), runId, state);
  }

  private clearMonitoringWakeTimer(state: ActiveRun, runId?: string): void {
    monitoringClearMonitoringWakeTimer(this.monitoringContext(), state, runId);
  }

  private monitoringWakeCapReached(runId: string, state: ActiveRun): void {
    monitoringMonitoringWakeCapReached(this.monitoringContext(), runId, state);
  }

  private armMonitoringLivenessTimer(runId: string, state: ActiveRun, atCap = false): void {
    monitoringArmMonitoringLivenessTimer(this.monitoringContext(), runId, state, atCap);
  }

  private clearMonitoringLivenessTimer(state: ActiveRun): void {
    monitoringClearMonitoringLivenessTimer(this.monitoringContext(), state);
  }

  private parkMonitorAsWaiting(runId: string, state: MonitoringActiveRun, message: string): void {
    monitoringParkMonitorAsWaiting(this.monitoringContext(), runId, state, message);
  }

  private armAutosave(runId: string, state: ActiveRun): void {
    monitoringArmAutosave(this.monitoringContext(), runId, state);
  }

  private clearAutosaveTimer(state: ActiveRun): void {
    monitoringClearAutosaveTimer(this.monitoringContext(), state);
  }

  private checkStepsContext(): CheckContext {
    return {
      store: this.store,
      active: this.active,
      secrets: this.secrets,
      projectId: this.projectId,
      repoRoot: this.repoRoot,
      dataDir: this.dataDir,
      checkOutputCap: CHECK_OUTPUT_CAP,
    };
  }

  /** Delete PR head refs no live worktree needs, after lifecycle removal. */
  sweepPrHeadRefs(): Promise<void> {
    return sweepPrHeadRefsTask(this.checkStepsContext());
  }

  private checkStepEnv(
    runId: string,
    state: ActiveRun,
    step: WorkflowStepDef,
    emit: (event: { type: string; stepId?: string; [k: string]: unknown }) => void,
  ): Promise<NodeJS.ProcessEnv> {
    return buildCheckStepEnv(this.checkStepsContext(), runId, state, step, emit);
  }

  private runCheckStep(
    runId: string,
    state: ActiveRun,
    step: WorkflowStepDef,
    emit: (event: { type: string; stepId?: string; [k: string]: unknown }) => void,
  ): Promise<{ ok: boolean; output: string; exitCode: number }> {
    return runCheckStepTask(this.checkStepsContext(), runId, state, step, emit);
  }

  private finishStep(
    runId: string,
    stepId: string,
    status: "done" | "failed",
    error: string | undefined,
    emit: (event: { type: string; stepId?: string; [k: string]: unknown }) => void,
  ): void {
    finishCheckStep(this.checkStepsContext(), runId, stepId, status, error, emit);
  }

}
