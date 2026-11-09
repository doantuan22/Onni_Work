import type { AgentSession, ContentBlock, RunnerId } from '../../core/agent-runner.ts';
import type { WorkflowStepDef } from '../types.ts';
import type { ExecutableNode, ForkShape, GraphNode, GraphTransition, WorkflowGraph } from '../graph.ts';
import type { AgentEvent } from '../../core/agent-runner.ts';
import type { UiEvent } from '../../core/ui-events.ts';
import type { UiEventSink } from '../../runs/ui-event-sink.ts';
import type { LandResult } from '../landing.ts';
import type { Skill } from '../../skills.ts';
import type { resolveBash } from '../../core/bash-path.ts';
import type { runVerifyCommand } from '../../dispatch/verify-exec.ts';
import type { PrivateMcpServer } from '../../core/private-mcp.ts';
import type {
  AgentPermissionLevel,
  DispatchBudget,
  DispatchManagerDeliveryReasonCode,
  DispatchManagerDeliveryState,
  DispatchInput,
  DispatchOrderSnapshot,
  RunDispatch,
  TrackerAssociation,
  UsageWindowsObservation,
  WebhookAttentionRequest,
} from '@onni/contract';
import type { QueuedMessage, RunRecord, RunStore } from '../../runs/store.ts';
import type { AccountHolds, WorkspaceSemaphore } from '../../workspace/semaphore.ts';
import type { SecretStore } from '../../workspace/secrets.ts';
import type { WorkflowDef } from '../types.ts';
import type { StartRunInput } from '../run.ts';
import type { PersistedAttachment, PastedContent } from './preparation.ts';
import type { WorktreeLifecycleCoordinator } from '../../worktree-lifecycle/coordinator.ts';
import type { OnniConfig } from '../../config.ts';
import type { StepState } from '../../runs/store.ts';
import type { ManagerSessionContext } from '../manager-worker.ts';

export interface PendingContinuation {
  stepId: string;
  sessionId: string | undefined;
  backend: RunnerId;
  prompt: string;
  /** Attachments the user pasted into the follow-up composer — images to view, files (#950) to
   *  be given the path of. Persisted when the continuation actually opens, not here. */
  images: PastedContent[];
}

/** What re-reading a message's persisted attachments yields: viewable blocks for the images, and
 *  a path for every attachment including the files that have no block. */
export interface PersistedAttachments {
  blocks: ContentBlock[];
  attachments: PersistedAttachment[];
}

/** A user-authored live message is made durable before it may wait for the
 *  repository lease. Reusing this preparation when the lease arrives prevents
 *  duplicate transcript events and duplicate attachment files. */
export interface PreparedUserMessage {
  text: string;
  persisted: PersistedAttachment[];
  imageLibraryWrites: Array<() => void>;
}

/** The small part of a live run that the startup memory guard inspects. */
export interface StartActiveRun {
  cancelled: boolean;
  autonomous?: boolean;
  session?: { open: boolean; end(): void };
}

/** Dependencies owned by RunManager that the run start helpers need. */
export interface StartContext {
  store: RunStore;
  repoRoot: string;
  dataDir: string;
  active: ReadonlyMap<string, StartActiveRun>;
  starting: Set<string>;
  queue: string[];
  pendingJobs: Map<string, { workflow: WorkflowDef; input: StartRunInput }>;
  pendingBranchNames: Map<string, Promise<string | undefined>>;
  queuedImageSeq: Map<string, number>;
  memoryPausing: Set<string>;
  semaphore: WorkspaceSemaphore;
  managerEnv: () => NodeJS.ProcessEnv;
  secrets: SecretStore;
  projectId: string | undefined;
  resolveTrackerEnv: ((root: string, expected: TrackerAssociation | undefined) => Promise<Record<string, string>>) | undefined;
  pump: () => Promise<void>;
  execute: (runId: string, workflow: WorkflowDef, input: StartRunInput, ownerToken?: symbol) => Promise<void>;
  busySlots: () => number;

  /** Existing manager-owned operations kept behind callbacks during the split. */
  dispatchEnabled: () => boolean;
  dispatchReachable: () => boolean;
  dispatchOf: (runId: string) => RunDispatch | undefined;
  deferredBindingActive: (run: Pick<RunRecord, 'id' | 'deferredBinding' | 'steps'>, runs: readonly RunRecord[]) => boolean;
  clearIdleTimer: (runId: string) => void;
  persistPastedAttachments: (runId: string, images: readonly PastedContent[]) => PersistedAttachment[];
  autoNameRun: (runId: string, skillName: string | undefined, task: string) => Promise<string | undefined>;
}

/** The owner identity and cancellation bit the queue needs when an execute callback rejects. */
export interface QueueActiveOwner {
  ownerToken: symbol;
  cancelled: boolean;
}

/** An interrupted continuation after its queued-message attachments have been re-read. */
export type HydratedQueuedContinuation = PendingContinuation & {
  persistedImages: ContentBlock[];
  persistedAttachments: PersistedAttachment[];
};

/** The narrow state and typed seams used by the queue and admission functions. */
export interface QueueContext<Input, Workflow extends WorkflowDef = WorkflowDef> {
  queue: string[];
  starting: Set<string>;
  active: ReadonlyMap<string, QueueActiveOwner>;
  pendingJobs: Map<string, { workflow: Workflow; input: Input }>;
  pendingContinuations: Map<string, PendingContinuation>;
  pendingBranchNames: Map<string, Promise<string | undefined>>;
  monitoring: Set<string>;
  unitParents: Set<string>;
  waiting: ReadonlySet<string>;
  pumping: boolean;
  pumpAgain: boolean;
  semaphore: WorkspaceSemaphore;
  store: RunStore;
  repoRoot: string;
  redirecting: ReadonlySet<string>;
  startNowRequested: Set<string>;
  forceNextPump: boolean;
  forceStarted: Set<string>;

  accountHolds(): AccountHolds;
  isAccountHeld(
    run: Pick<RunRecord, 'runner' | 'agentProfile' | 'status' | 'autoResumeAttempts'>,
    holds: AccountHolds,
    fallbackRunner: RunnerId,
  ): boolean;
  reconcileMonitoringWakeTimers(): void;
  reconcileAutoResumes(): void;
  blockOrphanedDependents(): void;
  workerEntryFull(run: RunRecord): boolean;
  dependencyState(run: RunRecord): 'ready' | 'waiting' | 'blocked';
  refreshQueuedDependencyEnvelope(run: RunRecord): void;
  armMonitoringLivenessTimer(runId: string): void;
  clearMonitoringLivenessTimer(runId: string): void;

  hydrateQueuedInput(runId: string, input: Input): Input;
  hydrateQueuedContinuation(runId: string, continuation: PendingContinuation): HydratedQueuedContinuation;
  refreshQueuedWorkflow(runId: string, snapshot: Workflow, catalog: readonly WorkflowDef[]): Workflow;
  execute(runId: string, workflow: Workflow, input: Input, ownerToken?: symbol): Promise<void>;
  runContinuation(
    runId: string,
    stepId: string,
    sessionId: string | undefined,
    backend: RunnerId,
    prompt: string,
    images: PastedContent[],
    persistedImages: ContentBlock[],
    persistedAttachments: PersistedAttachment[],
    ownerToken?: symbol,
  ): Promise<void>;
  failOwnedContinuation(runId: string, ownerToken: symbol, message: string): void;
  abandonCancelledStart(runId: string): boolean;
  clearIdleTimer(runId: string): void;
  clearAutosaveTimer(runId: string): void;
  dropActive(runId: string, ownerToken: symbol): void;
  reviveWorkflow(run: RunRecord): Promise<Workflow | null>;
  workflowInput(run: RunRecord): Input;
  queuedUsageLimitResume(run: RunRecord): boolean;
  reportSettledChildToParent(runId: string): Promise<void>;
}

/** Testable command dependencies that RunManager owns for task verification. */
export interface VerifyDependencies {
  runCommand: typeof runVerifyCommand;
  resolveBash: typeof resolveBash;
  now: () => number;
  env: () => NodeJS.ProcessEnv;
  baselineTimeoutMs: number;
}

/** The verification state and manager-owned seams used by verify/baseline helpers. */
export interface VerifyContext {
  store: RunStore;
  repoRoot: string;
  dataDir: string;
  verifying: Map<string, AbortController>;
  baselineTrees: Set<string>;
  verifyDeps: VerifyDependencies;
  isActive(runId: string): boolean;
  currentStepId(runId: string): string | undefined;
  updateDispatch(runId: string, patch: (dispatch: RunDispatch) => RunDispatch): void;
  isDisposed(): boolean;
}

/** Internal provenance passed from a redirect operation into ordinary dispatch admission. */
export interface RedirectDispatchOrigin {
  sourceRunId: string;
  canonicalOrder: DispatchOrderSnapshot;
  instruction: string;
}

export interface ManagerControlDispatchOptions {
  workflow?: WorkflowDef;
  antigravityLevel?: AgentPermissionLevel;
  redirectOrigin?: RedirectDispatchOrigin;
  preflightOnly?: boolean;
}

export type ManagerControlDispatchResult = { id: string; branch?: string } | { refused: string };

/** The small live-session surface manager controls inspect for state and receipt support. */
export interface ManagerControlActiveRun {
  currentStepId?: string;
  graphAnswer?: unknown;
  session?: {
    open: boolean;
    sendMessageWithReceipt?: unknown;
  };
}

/** Session fields used while loading and composing the manager opening prompt. */
export interface ManagerControlSessionState {
  currentStepId?: string;
  dispatchPrompt?: string;
}

/** Dependencies owned by RunManager that dispatch manager-control operations need. */
export interface ManagerControlContext {
  store: RunStore;
  repoRoot: string;
  dataDir: string;
  active: ReadonlyMap<string, ManagerControlActiveRun>;
  redirecting: Set<string>;
  queue: string[];
  starting: ReadonlySet<string>;
  continuationManagerDeliveryIds: Map<string, string[]>;
  managerEnv: () => NodeJS.ProcessEnv;
  semaphore: Pick<WorkspaceSemaphore, 'safety'>;
  dispatch: (parentId: string, input: DispatchInput, options?: ManagerControlDispatchOptions) => ManagerControlDispatchResult;
  cancel: (runId: string) => boolean;
  isActive: (runId: string) => boolean;
  waitInactive: (runId: string, timeoutMs: number) => Promise<boolean>;
  sendMessage: (runId: string, content: PastedContent[], replyTo?: string, managerDeliveryId?: string) => boolean;
  enqueueMessage: (runId: string, content: PastedContent[], managerDeliveryId?: string) => QueuedMessage | null;
  deferMessage: (runId: string, content: PastedContent[], managerDeliveryId?: string) => boolean;
  clearSoftAsk: (runId: string) => void;
  blockOrphanedDependents: () => void;
  refreshQueuedDependencyEnvelope: (run: RunRecord) => void;
  pump: () => Promise<void>;
  updateDispatch: (runId: string, patch: (dispatch: RunDispatch) => RunDispatch) => void;
}

/** The turn facts the manager state helpers share with both turn-end handlers. */
export interface DispatchTurnResult {
  hasDispatch: boolean;
  /** This turn created children through `dispatch()` — the run parks as a monitor for them. */
  dispatched: boolean;
  overBudget: boolean;
  /** The run's own inbox was delivered into the still-open session, so it is working again. */
  rePrompted: boolean;
}

/** The small live-run surface used by manager memory, asks, complexity and inbox delivery. */
export interface ManagerStateActive {
  cancelled: boolean;
  autonomous?: boolean;
  currentStepId?: string;
  dispatchedThisTurn?: boolean;
  complexityWarned?: boolean;
  autoContinues?: number;
  session?: {
    open: boolean;
    sendMessage(content: ContentBlock[]): boolean;
  };
}

export interface ManagerStateTurnContext {
  state: ManagerStateActive;
  stepId: string;
  done: boolean;
}

/** The narrow RunManager state and callbacks used by `run/manager-state.ts`. */
export interface ManagerStateContext {
  store: RunStore;
  dataDir: string;
  repoRoot: string;
  active: ReadonlyMap<string, ManagerStateActive>;
  /** Kept on RunManager and passed by reference so timer ownership stays with its lifecycle. */
  softAskTimers: Map<string, NodeJS.Timeout>;
  maxAutoContinues: number;

  dispatchEnabled(): boolean;
  dispatchOf(runId: string): RunDispatch | undefined;
  updateDispatch(runId: string, patch: (dispatch: RunDispatch) => RunDispatch): void;
  makeUiSink(runId: string, stepId: string): import('../../runs/ui-event-sink.ts').UiEventSink;
  emitAskRequested(sink: import('../../runs/ui-event-sink.ts').UiEventSink, ask: import('../../core/ask.ts').AskRequest): string;
  turnEndMarkerText(text: string): string;
  enforceDispatchBudget(runId: string, note: (message: string, tone?: 'danger') => void): boolean;
  deliverMessage(runId: string, content: import('./preparation.ts').PastedContent[], userAuthored: boolean): boolean;
  managerComplexityPolicyEnabled(): boolean;
}

/** Continue options retained on an active owner until its teardown releases the run. */
export interface LifecycleContinueOptions {
  text?: string;
  images?: PastedContent[];
  runner?: RunnerId;
  model?: string;
  agentProfile?: string;
  raiseLimits?: boolean;
  replyTo?: string;
}

/** The portion of an active owner touched by recovery, cancellation, and terminal cleanup. */
export interface LifecycleActiveRun {
  ownerToken: symbol;
  cancelled: boolean;
  releaseWorktree?: () => void;
  releaseRepoRoot?: () => void;
  interrupt: () => void;
  session?: {
    result: Promise<unknown>;
    hardStop?: () => unknown;
  };
  sessionEverOpened?: boolean;
  cancellationTimer?: NodeJS.Timeout;
  finishRequested?: boolean;
  finishedAtWait?: boolean;
  acceptReviewOnDrop?: boolean;
  continueOnDrop?: { opts: LifecycleContinueOptions; deferForCapacity: boolean };
}

/** The worktree barrier methods used by recovery and cancellation. */
export interface LifecycleBarrier {
  reconcile(): Promise<void>;
  isBlocked(runId: string): boolean;
}

/** State and typed seams used by run recovery, cleanup, cancellation, and activity queries. */
export interface LifecycleContext {
  store: RunStore;
  dataDir: string;
  active: Pick<Map<string, LifecycleActiveRun>, 'get' | 'has' | 'delete'>;
  queue: string[];
  starting: Set<string>;
  cancelledStarting: Set<string>;
  waiting: Set<string>;
  monitoring: Set<string>;
  unitParents: Set<string>;
  pendingJobs: Pick<Map<string, { workflow: WorkflowDef; input: StartRunInput }>, 'delete'>;
  pendingBranchNames: Pick<Map<string, Promise<string | undefined>>, 'delete'>;
  pendingContinuations: Pick<Map<string, PendingContinuation>, 'delete'>;
  startNowRequested: Pick<Set<string>, 'delete'>;
  deferredMessages: Map<string, PastedContent[][]>;
  deferredManagerDeliveryIds: Map<string, Array<string | undefined>>;
  continuationManagerDeliveryIds: Map<string, string[]>;
  autoResumeTimers: ReadonlyMap<string, NodeJS.Timeout>;
  memoryPausing: Pick<Set<string>, 'has' | 'delete'>;
  lastNamerKey: Pick<Map<string, string>, 'delete'>;
  forceStarted: Pick<Set<string>, 'delete'>;
  lifecycle: LifecycleBarrier;

  abortVerification(runId: string): void;
  recoverRedirectOperations(): Promise<void>;
  recoverSoftAsks(): void;
  expireLostManagerDeliveriesAfterRestart(): void;
  reconcileAutoResumes(): void;
  reviveQueuedRun(run: RunRecord, reason: string): Promise<void>;
  settleSuccess(runId: string): Promise<boolean>;
  continueRun(runId: string, options: LifecycleContinueOptions, deferForCapacity?: boolean): { ok: boolean; error?: string };
  reportSettledChildToParent(runId: string): Promise<void>;
  pump(): Promise<void>;
  clearSoftAsk(runId: string): void;
  expireUnacceptedManagerDeliveries(runId: string, reason: 'target-settled'): void;
  scheduleAutoResumeIfLimited(runId: string): void;
  cancelAutoResume(runId: string): boolean;
  leaveMonitoring(runId: string): void;
  clearMonitoringWakeTimer(state: LifecycleActiveRun, runId?: string): void;
  clearIdleTimer(state: LifecycleActiveRun): void;
  releaseSlot(): void;
  finishReview(runId: string): Promise<void>;
  startRetentionPass(): void;
  cancelDescendants(runId: string, seen: Set<string>): void;
  cancel(runId: string): boolean;
  isQueued(runId: string): boolean;
  enqueueMessage(runId: string, content: PastedContent[], managerDeliveryId?: string): QueuedMessage | null;
  recordManagerDeliveryTransition(
    runId: string,
    deliveryId: string,
    state: 'expired',
    reason: 'target-settled',
  ): void;
}

/** The live-run fields dispatch needs when it records a child or resolves a graph waiter. */
export interface DispatchActiveRun {
  currentStepId?: string;
  dispatchedThisTurn?: boolean;
  graphChildWaits?: ReadonlyMap<string, (child: { status: string; summary: string }) => void>;
}

/** The narrow RunManager state and seams used by worker dispatch and child reports. */
export interface DispatchContext {
  store: RunStore;
  dataDir: string;
  active: ReadonlyMap<string, DispatchActiveRun>;
  queue: string[];
  pendingJobs: ReadonlyMap<string, { input: { task: string } }>;
  starting: ReadonlySet<string>;
  redirecting: ReadonlySet<string>;
  semaphore: Pick<WorkspaceSemaphore, 'safety'>;

  dispatchEnabled(): boolean;
  dispatchOf(runId: string): RunDispatch | undefined;
  dispatchBudgetFor(runId: string): DispatchBudget | undefined;
  updateDispatch(runId: string, patch: (dispatch: RunDispatch) => RunDispatch): void;
  startRun(workflow: WorkflowDef, input: StartRunInput): RunRecord;
  cancelOne(runId: string): boolean;
  deferredBindingActive(run: Pick<RunRecord, 'id' | 'deferredBinding' | 'steps'>, runs: readonly RunRecord[]): boolean;
  verificationAskMatches(text: string): boolean;
  assignPlanPart(rootRunId: string, partId: string, childRunId: string): Promise<void>;
  notifyTreeInboxes(rootRunId: string, writerId: string): void;
  ackPendingReport(runId: string, fromRunId: string, at: string): void;
  deliverMessage(runId: string, content: PastedContent[], userAuthored: boolean): boolean;
  enqueueMessage(runId: string, content: PastedContent[]): QueuedMessage | null;
  deferMessage(runId: string, content: PastedContent[]): boolean;
  continueRun(runId: string, options: { text: string }, deferForCapacity?: boolean): unknown;
  pump(): Promise<void>;
}

/** The live-run fields read or updated by queued and live message handling. */
export interface MessageActiveRun {
  cancelled: boolean;
  sessionEverOpened?: boolean;
  session?: Pick<AgentSession, 'open' | 'sendMessage' | 'sendMessageWithReceipt'>;
  currentStepId?: string;
  graphAnswer?: (text: string) => void;
  repoRootParked?: boolean;
  repoRootResume?: Promise<boolean>;
  skills?: import('../../skills.ts').Skill[];
  grantedAttachmentLibrary?: string;
  monitoringWakeups?: number;
  idleClosed?: boolean;
  compactionContinues?: number;
  askPark?: 'waiting' | 'abandoned';
}

/** State and callbacks used by queued message hydration and live message delivery. */
export interface MessageContext {
  store: RunStore;
  dataDir: string;
  active: ReadonlyMap<string, MessageActiveRun>;
  starting: ReadonlySet<string>;
  cancelledStarting: ReadonlySet<string>;
  waiting: Set<string>;
  pendingJobs: ReadonlyMap<string, { workflow: WorkflowDef; input: StartRunInput }>;
  pendingContinuations: ReadonlyMap<string, PendingContinuation>;
  deferredMessages: ReadonlyMap<string, PastedContent[][]>;
  deferredManagerDeliveryIds: ReadonlyMap<string, Array<string | undefined>>;
  lifecycle: Pick<LifecycleBarrier, 'isBlocked'>;
  repoRootResumedNote: string;

  setDeferred(runId: string, pending: PastedContent[][] | undefined, deliveryIds?: Array<string | undefined>): void;
  persistPastedAttachments(
    runId: string,
    content: readonly PastedContent[],
    imageLibraryWrites?: Array<() => void>,
  ): PersistedAttachment[];
  claimFreeRepoRoot(state: MessageActiveRun): boolean;
  resumeRepoRoot(runId: string, state: MessageActiveRun): Promise<boolean>;
  recordManagerDeliveryTransition(
    runId: string,
    deliveryId: string,
    state: DispatchManagerDeliveryState,
    reasonCode?: DispatchManagerDeliveryReasonCode,
  ): void;
  enqueueMessage(runId: string, content: PastedContent[], managerDeliveryId?: string): QueuedMessage | null;
  deferMessage(runId: string, content: PastedContent[], managerDeliveryId?: string): boolean;
  sendMessage(runId: string, content: PastedContent[], replyTo?: string, managerDeliveryId?: string): boolean;
  deliverMessage(
    runId: string,
    content: PastedContent[],
    userAuthored: boolean,
    preparedUserMessage?: PreparedUserMessage,
    replyTo?: string,
    managerDeliveryId?: string,
  ): boolean;
  softAskFor(runId: string, requestId: string | undefined): RunDispatch['softAsk'];
  clearPendingAsk(runId: string): void;
  clearSoftAsk(runId: string): void;
  attachmentLibraryHint(attachments: PersistedAttachment[], grantedDir?: string): string | undefined;
  usableAttachmentLibrary(grantedDir: string | undefined): string | undefined;
  provisionTaskSkills(state: MessageActiveRun, wantedSkills: { stepSkill?: string; slash?: string }): Promise<string[]>;
  clearIdleTimer(state: MessageActiveRun): void;
  clearMonitoringWakeTimer(state: MessageActiveRun, runId?: string): void;
  leaveMonitoring(runId: string): void;
  leadingSlashSkillName(text: string): string | undefined;
  expandRegistrySlashSkill(blocks: ContentBlock[], skills: readonly import('../../skills.ts').Skill[]): ContentBlock[];
}

/** A manager-owned mutable value exposed through a narrow scheduling context. */
export interface SchedulingMutableValue<T> {
  value: T;
}

export type SchedulingAutoResumeReason = NonNullable<RunRecord['autoResumeReason']>;

/** Run.ts policies kept at the façade because other workflow parts also use them. */
export interface SchedulingPolicy {
  accountHeldFor(
    run: Pick<RunRecord, 'runner' | 'agentProfile' | 'status' | 'autoResumeAttempts'>,
    holds: AccountHolds,
    fallbackRunner: RunnerId,
  ): boolean;
  runAccountKey(run: Pick<RunRecord, 'runner' | 'agentProfile'>, fallbackRunner: RunnerId): string;
  resumeInFlight(run: Pick<RunRecord, 'status' | 'autoResumeAttempts'>): boolean;
  autoResumeReasonFor(error: string | undefined): SchedulingAutoResumeReason | undefined;
  autoResumeCap(reason: SchedulingAutoResumeReason | undefined): number;
  formatWakeInstant(at: Date): string;
  autoResumeGraceMs: number;
  maxAutoResumes: number;
  autoResumeMissedWindowMs: number;
  autoResumePrompt: string;
  transientRetryPrompt: string;
}

/** State and callbacks used by retry/resume, queue holds, repository leases, and run limits. */
export interface SchedulingContext {
  store: RunStore;
  repoRoot: string;
  lifecycle: WorktreeLifecycleCoordinator;
  active: ReadonlyMap<string, SchedulingActiveRun>;
  starting: ReadonlySet<string>;
  queue: string[];
  pendingJobs: Map<string, { workflow: WorkflowDef; input: StartRunInput }>;
  pendingContinuations: ReadonlyMap<string, PendingContinuation>;
  autoResumeTimers: Map<string, NodeJS.Timeout>;
  waiting: Set<string>;
  forceNextPump: SchedulingMutableValue<boolean>;
  forceStarted: ReadonlySet<string>;
  startNowRequested: Set<string>;
  semaphore: WorkspaceSemaphore;
  repoRootTail: SchedulingMutableValue<Promise<void>>;
  repoRootBusy: SchedulingMutableValue<number>;
  lastLimitTick: SchedulingMutableValue<number>;
  queueReasonRevision: SchedulingMutableValue<number>;
  policy: SchedulingPolicy;

  pump(): Promise<void>;
  dropActive(runId: string): void;
  continueRun(runId: string, options: LifecycleContinueOptions, deferForCapacity?: boolean): { ok: boolean; error?: string };
  hydrateQueuedInput(runId: string, input: StartRunInput): StartRunInput;
  cancel(runId: string): boolean;
  releaseSlot(): void;
  busySlots(): number;
  reviveQueuedRun(run: RunRecord, reason: string): Promise<void>;
  dispatchOf(runId: string): RunDispatch | undefined;
}

/** Active-owner fields touched by repository-lease and held-queue scheduling. */
export interface SchedulingActiveRun {
  cancelled: boolean;
  cwd: string;
  releaseRepoRoot?: () => void;
  repoRootParked?: boolean;
  repoRootResume?: Promise<boolean>;
  currentStepId?: string;
  interrupt: () => void;
}

/** The owner fields used when an execution task creates, starts, and settles a run. */
export interface ExecuteActiveRun {
  ownerToken: symbol;
  cancelled: boolean;
  interrupt: () => void;
  cwd: string;
  releaseWorktree?: () => void;
  autosaveExcludedPaths: Map<string, string>;
  checkInProgress: boolean;
  autosaveCheckpointBlocked: boolean;
  autonomous?: boolean;
  autoContinues?: number;
  autoLand?: {
    checks: string[];
    baseBranch?: string;
    baseLabel: string;
    attempts: number;
    inFlight?: Promise<import('../landing.ts').LandResult>;
  };
  readOnly?: boolean;
  skills?: import('../../skills.ts').Skill[];
  askPark?: 'waiting' | 'abandoned';
  monitorHandoff?: boolean;
  turnSettled?: boolean;
  waitExpired?: boolean;
}

export interface ExecuteGraphOptions {
  input: StartRunInput;
  skills: import('../../skills.ts').Skill[];
  emit: (event: { type: string; stepId?: string; [k: string]: unknown }) => void;
  taskBackend: RunnerId;
  extraSystemPrompt: string | undefined;
  startImages: ContentBlock[] | undefined;
  startAttachments: PersistedAttachment[];
  resume?: RunRecord['graphState'];
  usageLimitResume?: StepState;
}

/** State and typed RunManager seams used while creating and starting one workflow run. */
export interface ExecuteContext {
  store: RunStore;
  repoRoot: string;
  dataDir: string;
  active: Pick<Map<string, ExecuteActiveRun>, 'get' | 'set'>;
  starting: Pick<Set<string>, 'delete'>;
  pendingBranchNames: Pick<Map<string, Promise<string | undefined>>, 'delete'>;
  checkArtifactSnapshots: Pick<Map<string, Map<string, string>>, 'get' | 'set'>;
  autosaveCheckpointBlockedRuns: Pick<Set<string>, 'has'>;
  lifecycle: Pick<WorktreeLifecycleCoordinator, 'acquireAgentLease' | 'prepare'>;
  repositoryRootLockDisabledNote: string;

  configuredModelProvider(backend: RunnerId, repoRoot: string): Promise<string | undefined>;
  currentCheckExclusions(dir: string, owned: Map<string, string>): Promise<string[]>;
  repositoryRootLockDisabled(): boolean;
  interruptedWorkflowStep(run: RunRecord): StepState | undefined;
  requeueWhileHeld(
    runId: string,
    workflow: WorkflowDef,
    input: StartRunInput,
    runner: RunnerId,
    state?: ExecuteActiveRun,
  ): boolean;
  landingPolicy(
    run: RunRecord | undefined,
    config: OnniConfig,
    note?: (message: string) => void,
  ): Promise<ExecuteActiveRun['autoLand']>;
  awaitGeneratedBranch(
    runId: string,
    branchNaming: string | undefined,
    note: (message: string) => void,
  ): Promise<string | undefined>;
  acquireRepoRoot(runId: string, state: ExecuteActiveRun): Promise<boolean>;
  parkLifecycle(runId: string, state: ExecuteActiveRun, operationId?: string): void;
  armAutosave(runId: string, state: ExecuteActiveRun): void;
  loadManagerSessionContext(runId: string, state: ExecuteActiveRun): Promise<ManagerSessionContext>;
  prepareDispatchSession(runId: string, state: ExecuteActiveRun, context: ManagerSessionContext): void;
  prepareAutomationsSession(state: ExecuteActiveRun): void;
  executeGraph(
    runId: string,
    state: ExecuteActiveRun,
    workflow: WorkflowDef,
    graph: WorkflowGraph,
    options: ExecuteGraphOptions,
  ): Promise<string | null>;
  clearAutosaveTimer(state: ExecuteActiveRun): void;
  settleUnansweredPark(runId: string, finishedAt: string, monitorHandoff: boolean): void;
  inactivityFailureMessage(runId?: string, state?: ExecuteActiveRun): string;
  settleSuccess(runId: string, state: ExecuteActiveRun): Promise<boolean>;
  clearIdleTimer(state: ExecuteActiveRun): void;
  dropActive(runId: string, state: ExecuteActiveRun): void;
}

/** Options accepted by the user-facing Continue operation. */
export interface ContinuationOptions {
  text?: string;
  images?: PastedContent[];
  runner?: RunnerId;
  model?: string;
  agentProfile?: string;
  raiseLimits?: boolean;
  replyTo?: string;
}

/** Active-run fields used by continuation and finish flows. */
export interface ContinuationActiveRun {
  ownerToken: symbol;
  cancelled: boolean;
  interrupt: () => void;
  cwd: string;
  autosaveExcludedPaths: Map<string, string>;
  checkInProgress: boolean;
  autosaveCheckpointBlocked: boolean;
  session?: AgentSession;
  currentStepId?: string;
  graphFinish?: () => void;
  idleTimer?: NodeJS.Timeout;
  idleClosed?: boolean;
  waitExpired?: boolean;
  finishRequested?: boolean;
  finishedAtWait?: boolean;
  acceptReviewOnDrop?: boolean;
  turnSettled?: boolean;
  continueOnDrop?: { opts: ContinuationOptions; deferForCapacity: boolean };
  monitoringWakeTimer?: NodeJS.Timeout;
  monitoringWakeIntervalMinutes?: number;
  monitoringWakeups?: number;
  monitoringLivenessTimer?: NodeJS.Timeout;
  monitoringLivenessAtCap?: boolean;
  autosaveTimer?: NodeJS.Timeout;
  cancellationTimer?: NodeJS.Timeout;
  sessionEverOpened?: boolean;
  autonomous?: boolean;
  autoContinues?: number;
  compactionContinues?: number;
  askPark?: 'waiting' | 'abandoned';
  monitorHandoff?: boolean;
  skills?: Skill[];
  grantedAttachmentLibrary?: string;
  dispatchPrompt?: string;
  automationsPrompt?: string;
  releaseWorktree?: () => void;
  autoLand?: { checks: string[]; baseBranch?: string; baseLabel: string; attempts: number; inFlight?: Promise<LandResult> };
  readOnly?: boolean;
  repoRootParked?: boolean;
  repoRootResume?: Promise<boolean>;
}

/** Helpers shared with the adjacent turn-end handler stay on the RunManager façade. */
export interface ContinuationHelpers {
  configuredModelProvider(backend: RunnerId, cwd: string): Promise<string | undefined>;
  endsWithMonitoringMarker(turnText: string): boolean;
  endsWithDoneMarker(turnText: string): boolean;
  appendTurnText(current: string, next: string): string;
  stripDoneMarker(text: string): string;
  stripMonitoringMarker(text: string): string;
  resolveAskTurn(turnText: string, enabled: boolean): {
    ask: import('../../core/ask.ts').AskRequest | null;
    notes: Array<{ message: string; tone?: 'danger' }>;
  };
  markerlessTurn(turnText: string): boolean;
  repositoryRootLockDisabled(): boolean;
  repositoryRootLockDisabledNote: string;
  continuableStatuses: readonly string[];
  maxAutoContinues: number;
  leadingSlashSkillName(text: string): string | undefined;
  expandRegistrySlashSkillText(text: string, skills: readonly Skill[]): string;
  currentCheckExclusions(dir: string, owned: Map<string, string>): Promise<string[]>;
}

/** Dependencies for finish, continue, and resumed-session execution. */
export interface ContinuationContext {
  store: RunStore;
  repoRoot: string;
  dataDir: string;
  lifecycle: WorktreeLifecycleCoordinator;
  active: Map<string, ContinuationActiveRun>;
  starting: Set<string>;
  queue: string[];
  pendingContinuations: Map<string, PendingContinuation>;
  checkArtifactSnapshots: Map<string, Map<string, string>>;
  autosaveCheckpointBlockedRuns: Set<string>;
  waiting: Set<string>;
  helpers: ContinuationHelpers;

  abandonCancelledStart(runId: string): boolean;
  acquireRepoRoot(runId: string, state: ContinuationActiveRun): Promise<boolean>;
  agentEnvForStep(
    runId: string,
    backend: RunnerId,
    options?: { generateFollowups?: boolean; recordedProfileId?: string },
  ): Promise<{ env: Record<string, string>; profileId: string; onUsageWindows?: (observation: UsageWindowsObservation) => void }>;
  agentPermissionSpec(runId: string, backend: string, onEvent: (event: AgentEvent) => void): Promise<{ permissionLevel?: AgentPermissionLevel }>;
  armAutosave(runId: string, state: ContinuationActiveRun): void;
  armIdleTimer(runId: string, state: ContinuationActiveRun): void;
  armMonitoringWakeTimer(runId: string, state: ContinuationActiveRun): void;
  attachmentLibraryHint(attachments: PersistedAttachment[], grantedDir?: string): string | undefined;
  attachmentsDir(runId: string): string;
  beginUsageInvocation(runId: string, state: ContinuationActiveRun, stepId: string): void;
  clearAutoResume(runId: string): void;
  clearAutosaveTimer(state: ContinuationActiveRun): void;
  clearIdleTimer(state: ContinuationActiveRun): void;
  clearMonitoringWakeTimer(state: ContinuationActiveRun, runId?: string): void;
  clearSoftAsk(runId: string): void;
  dropActive(runId: string, expectedState?: ContinuationActiveRun): void;
  enterMonitoring(runId: string, spawnParked: boolean): void;
  failOwnedContinuation(runId: string, ownerToken: symbol, message: string): void;
  finishReview(runId: string): Promise<void>;
  flushDeferred(runId: string): void;
  flushInbox(runId: string): string | undefined;
  flushPendingReports(runId: string): string | undefined;
  handleDispatchTurn(runId: string, turnText: string, ctx: { state: ContinuationActiveRun; stepId: string; done: boolean }): DispatchTurnResult;
  handleRunnerUiEvent(runId: string, state: ContinuationActiveRun, sink: UiEventSink, event: UiEvent): void;
  idleClosedFails(runId: string, state: ContinuationActiveRun): Promise<boolean>;
  inactivityFailureMessage(runId?: string, state?: ContinuationActiveRun): string;
  isActive(runId: string): boolean;
  landingPolicy(run: RunRecord | undefined, config: import('../../config.ts').OnniConfig): Promise<ContinuationActiveRun['autoLand']>;
  landOnDone(runId: string, state: ContinuationActiveRun, stepId: string | undefined, close: () => void): boolean;
  landWithAgent(runId: string, state: ContinuationActiveRun, stepId: string | undefined, close: () => void): Promise<LandResult> | undefined;
  leaveMonitoring(runId: string): void;
  loadManagerSessionContext(runId: string, state: ContinuationActiveRun): Promise<ManagerSessionContext>;
  makeUiSink(runId: string, stepId: string): UiEventSink;
  markQueuedManagerDeliveriesDelivered(runId: string): void;
  parkLifecycle(runId: string, state: ContinuationActiveRun, operationId?: string): void;
  parkRepoRoot(runId: string, state: ContinuationActiveRun): void;
  persistAttachment(runId: string, mediaType: string, data: string, namePrefix?: string, ext?: string): PersistedAttachment | null;
  persistPastedAttachments(runId: string, content: readonly PastedContent[]): PersistedAttachment[];
  prepareAttachmentLibrary(): string | undefined;
  prepareAutomationsSession(state: ContinuationActiveRun): void;
  prepareDispatchSession(runId: string, state: ContinuationActiveRun, context?: ManagerSessionContext): void;
  privateMcpForLaunch(backend: RunnerId, onEvent: (event: AgentEvent) => void): Promise<PrivateMcpServer[] | undefined>;
  provisionTaskSkills(state: ContinuationActiveRun, wantedSkills: { stepSkill?: string; slash?: string }): Promise<string[]>;
  raiseAfterLimit(run: RunRecord): void;
  recordAsk(runId: string, sink: UiEventSink, ask: import('../../core/ask.ts').AskRequest): WebhookAttentionRequest;
  recordNoteMeta(runId: string, event: Extract<AgentEvent, { type: 'note' }>): void;
  recordTurnEnd(runId: string, turnText: string, owner?: ContinuationActiveRun): Promise<void>;
  recordUsagePeaks(runId: string, owner: ContinuationActiveRun): void;
  releaseSlot(): void;
  runContinuation(
    runId: string,
    stepId: string,
    sessionId: string | undefined,
    backend: RunnerId,
    prompt: string,
    images?: PastedContent[],
    persistedImages?: ContentBlock[],
    persistedAttachments?: PersistedAttachment[],
    ownerToken?: symbol,
  ): Promise<void>;
  sessionCostUsd(runId: string, sessionId: string): number;
  settleSuccess(runId: string, owner?: ContinuationActiveRun): Promise<boolean>;
  settleUnansweredPark(runId: string, finishedAt: string, monitorHandoff: boolean): void;
  softAskFor(runId: string, requestId: string | undefined): RunDispatch['softAsk'];
  tryAutonomousNudge(runId: string, state: ContinuationActiveRun, stepId: string, ask: import('../../core/ask.ts').AskRequest | null, dispatchTurn: DispatchTurnResult): boolean;
  tryCompactionContinue(runId: string, state: ContinuationActiveRun, stepId: string, opts: { markerless: boolean; dispatchTurn: DispatchTurnResult }): boolean;
}

/** The live-run fields read or updated by the workflow graph engine. */
export interface GraphActiveRun {
  cancelled: boolean;
  cwd: string;
  interrupt: () => void;
  askPark?: 'waiting' | 'abandoned';
  graphAnswer?: (text: string) => void;
  graphFinish?: () => void;
  graphChildWaits?: Map<string, (child: { status: string; summary: string }) => void>;
  repoRootParked?: boolean;
  repoRootResume?: Promise<boolean>;
  skills?: Skill[];
  autosaveExcludedPaths: Map<string, string>;
  checkInProgress: boolean;
  autosaveCheckpointBlocked: boolean;
}

/** The graph walk's state, manager-owned callbacks, and narrowly scoped effects. */
export interface GraphContext {
  store: RunStore;
  repoRoot: string;
  dataDir: string;
  active: ReadonlyMap<string, GraphActiveRun>;
  waiting: Set<string>;
  autosaveCheckpointBlockedRuns: Set<string>;
  resumableBackends: ReadonlySet<RunnerId>;
  applyTemplate(template: string, task: string): string;
  cardReply(text: string, header: string): string;
  autoResumeReasonFor(error: string | undefined): SchedulingAutoResumeReason | undefined;
  currentCheckExclusions(dir: string, owned: Map<string, string>): Promise<string[]>;
  captureCheckArtifacts(dir: string, owned: Map<string, string>): Promise<void>;

  runAgentStep(
    runId: string,
    state: GraphActiveRun,
    step: WorkflowStepDef,
    input: StartRunInput,
    skills: Skill[],
    checkFailure: string | null,
    interactive: boolean,
    emit: (event: { type: string; stepId?: string; [k: string]: unknown }) => void,
    images: ContentBlock[] | undefined,
    taskBackend: RunnerId,
    extraSystemPrompt: string | undefined,
    chainNote: string | undefined,
    attachments?: PersistedAttachment[],
    graphHooks?: { resumeSessionId?: string; lastTurn?: { text: string }; usageLimitResume?: StepState },
  ): Promise<string | null>;
  runCheckStep(
    runId: string,
    state: GraphActiveRun,
    step: WorkflowStepDef,
    emit: (event: { type: string; stepId?: string; [k: string]: unknown }) => void,
  ): Promise<{ ok: boolean; output: string; exitCode: number }>;
  finishStep(
    runId: string,
    stepId: string,
    status: 'done' | 'failed',
    error: string | undefined,
    emit: (event: { type: string; stepId?: string; [k: string]: unknown }) => void,
  ): void;
  idleClosedFails(runId: string, state: GraphActiveRun): Promise<boolean>;
  inactivityFailureMessage(runId?: string, state?: GraphActiveRun): string;
  dispatch(
    parentId: string,
    input: DispatchInput,
    opts?: {
      workflow?: WorkflowDef;
      antigravityLevel?: AgentPermissionLevel;
      redirectOrigin?: RedirectDispatchOrigin;
      preflightOnly?: boolean;
    },
  ): { id: string; branch?: string } | { refused: string };
  cancel(runId: string): boolean;
  releaseSlot(): void;
  parkRepoRoot(runId: string, state: GraphActiveRun): void;
  claimFreeRepoRoot(state: GraphActiveRun): boolean;
  resumeRepoRoot(runId: string, state: GraphActiveRun): Promise<boolean>;
  makeUiSink(runId: string, stepId: string): UiEventSink;
  recordAttention(
    requestId: string,
    input: readonly { question: string; options?: readonly { label: string; description?: string }[] }[],
  ): WebhookAttentionRequest;
  runFork(
    graph: WorkflowGraph,
    runId: string,
    state: GraphActiveRun,
    fork: Extract<GraphNode, { type: 'fork' }>,
    shape: ForkShape,
    outputs: Map<string, Record<string, string | number>>,
    task: string,
    emit: (event: { type: string; stepId?: string; [k: string]: unknown }) => void,
    onOutputs: () => void,
    resuming: boolean,
  ): Promise<{ port: 'done' | 'failed'; join: string; transitions: GraphTransition[] } | 'finished'>;
  runSystemNode(
    runId: string,
    state: GraphActiveRun,
    node: Exclude<ExecutableNode, { type: 'agent' | 'check' | 'fork' | 'join' }>,
    outputs: Map<string, Record<string, string | number>>,
    task: string,
    emit: (event: { type: string; stepId?: string; [k: string]: unknown }) => void,
    onOutputs?: () => void,
    resuming?: boolean,
  ): Promise<string | 'finished'>;
  awaitChildren(
    runId: string,
    state: GraphActiveRun,
    nodeId: string,
    childIds: string[],
    mode: 'all' | 'any',
  ): Promise<Map<string, { status: string; summary: string }> | 'finished'>;
  findWorkflow(name: string): Promise<WorkflowDef | undefined>;
}

/** The owner fields a running check step reads or updates while its child process is live. */
export interface CheckActiveRun {
  cancelled: boolean;
  cwd: string;
  interrupt: () => void;
}

/** State and manager-owned dependencies used by workflow check steps and their helpers. */
export interface CheckContext {
  store: RunStore;
  active: ReadonlyMap<string, CheckActiveRun>;
  secrets: SecretStore;
  projectId: string | undefined;
  repoRoot: string;
  dataDir: string;
  checkOutputCap: number;
}
