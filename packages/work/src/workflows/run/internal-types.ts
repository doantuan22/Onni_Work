import type { ContentBlock, RunnerId } from '../../core/agent-runner.ts';
import type { resolveBash } from '../../core/bash-path.ts';
import type { runVerifyCommand } from '../../dispatch/verify-exec.ts';
import type { PrivateMcpServer } from '../../core/private-mcp.ts';
import type {
  AgentPermissionLevel,
  DispatchInput,
  DispatchOrderSnapshot,
  RunDispatch,
  TrackerAssociation,
  UsageWindowsObservation,
} from '@onni/contract';
import type { QueuedMessage, RunRecord, RunStore } from '../../runs/store.ts';
import type { AccountHolds, WorkspaceSemaphore } from '../../workspace/semaphore.ts';
import type { SecretStore } from '../../workspace/secrets.ts';
import type { WorkflowDef } from '../types.ts';
import type { StartRunInput } from '../run.ts';
import type { PersistedAttachment, PastedContent } from './preparation.ts';

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
