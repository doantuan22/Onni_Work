import type { ContentBlock, RunnerId } from '../../core/agent-runner.ts';
import type { AccountHolds, WorkspaceSemaphore } from '../../workspace/semaphore.ts';
import type { RunRecord, RunStore } from '../../runs/store.ts';
import type { WorkflowDef } from '../types.ts';
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
