import type { ContentBlock, RunnerId } from '../../core/agent-runner.ts';
import type { PrivateMcpServer } from '../../core/private-mcp.ts';
import type { RunDispatch, TrackerAssociation, UsageWindowsObservation } from '@onni/contract';
import type { RunRecord, RunStore } from '../../runs/store.ts';
import type { WorkspaceSemaphore } from '../../workspace/semaphore.ts';
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
