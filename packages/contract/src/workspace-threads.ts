import { z } from 'zod';
import { runStatusSchema, type RunStatus } from './runs.ts';

/**
 * Contract schemas for multi-thread workspace navigation, search, and pane persistence.
 *
 * (Phase 5 contract additions, design.md section 7 items 1-4, survey-C 'Proposed contract additions')
 *
 * Intended routes (schemas defined here; routes to be implemented in a subsequent phase):
 * - GET /api/v1/workspace/threads
 * - GET /api/v1/workspace/search
 * - POST /api/v1/p/:projectId/runs/:id/viewed
 * - GET /api/v1/p/:projectId/workspace/panes
 * - PUT /api/v1/p/:projectId/workspace/panes
 */

export const MAX_THREAD_CURSOR_LENGTH = 2048;
export const MAX_THREAD_SUMMARY_PREVIEW_LENGTH = 280;
export const MAX_THREADS_PAGE_LIMIT = 100;
export const DEFAULT_THREADS_PAGE_LIMIT = 50;

export const MAX_TRANSCRIPT_SEARCH_QUERY_LENGTH = 200;
export const MAX_TRANSCRIPT_SEARCH_PAGE_LIMIT = 50;
export const MAX_TRANSCRIPT_SEARCH_SNIPPET_LENGTH = 400;

export const MAX_WORKSPACE_PANES_THREADS = 50;

/**
 * `GET /api/v1/workspace/threads`
 *
 * Cursor-paged, cross-project session query with optional project and status filters.
 */
export const threadsQuerySchema = z.object({
  cursor: z.string().max(MAX_THREAD_CURSOR_LENGTH).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_THREADS_PAGE_LIMIT).default(DEFAULT_THREADS_PAGE_LIMIT),
  projectId: z.string().optional(),
  status: z.string().optional(),
});
export type ThreadsQuery = z.infer<typeof threadsQuerySchema>;
export type ThreadsQueryInput = z.input<typeof threadsQuerySchema>;

/**
 * One thread summary item in a workspace threads listing.
 */
export const threadSummarySchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  title: z.string(),
  status: runStatusSchema,
  updatedAt: z.string(),
  preview: z.string().max(MAX_THREAD_SUMMARY_PREVIEW_LENGTH).optional(),
  awaitingAsk: z.boolean(),
  workerCount: z.number().int().min(0),
  parentRunId: z.string().optional(),
  unread: z.boolean(),
});
export type ThreadSummary = z.infer<typeof threadSummarySchema>;

/**
 * `GET /api/v1/workspace/threads` response body.
 */
export const threadsPageSchema = z.object({
  items: z.array(threadSummarySchema),
  nextCursor: z.string().optional(),
  truncatedProjects: z.array(z.string()).optional(),
});
export type ThreadsPage = z.infer<typeof threadsPageSchema>;

/**
 * `GET /api/v1/workspace/search`
 *
 * Query parameters for cross-project / per-thread transcript search.
 */
export const transcriptSearchQuerySchema = z.object({
  q: z.string().min(1).max(MAX_TRANSCRIPT_SEARCH_QUERY_LENGTH),
  projectId: z.string().optional(),
  runId: z.string().optional(),
  cursor: z.string().max(MAX_THREAD_CURSOR_LENGTH).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_TRANSCRIPT_SEARCH_PAGE_LIMIT).optional(),
});
export type TranscriptSearchQuery = z.infer<typeof transcriptSearchQuerySchema>;
export type TranscriptSearchQueryInput = z.input<typeof transcriptSearchQuerySchema>;

/**
 * A matched transcript search result snippet.
 */
export const transcriptSearchItemSchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  seq: z.number().int().min(0),
  turnId: z.string().optional(),
  snippet: z.string().max(MAX_TRANSCRIPT_SEARCH_SNIPPET_LENGTH),
});
export type TranscriptSearchItem = z.infer<typeof transcriptSearchItemSchema>;

/**
 * `GET /api/v1/workspace/search` response body.
 */
export const transcriptSearchPageSchema = z.object({
  items: z.array(transcriptSearchItemSchema),
  nextCursor: z.string().optional(),
});
export type TranscriptSearchPage = z.infer<typeof transcriptSearchPageSchema>;

/**
 * `POST /api/v1/p/:projectId/runs/:id/viewed`
 *
 * Request body for recording the highest transcript event sequence viewed by the user.
 */
export const markViewedInputSchema = z.object({
  seq: z.number().int().min(0),
});
export type MarkViewedInput = z.infer<typeof markViewedInputSchema>;

/**
 * Reference to an active or settled run pane.
 */
export const workspaceRunPaneRefSchema = z.object({
  kind: z.literal('run'),
  paneId: z.string(),
  projectId: z.string(),
  runId: z.string(),
});
export type WorkspaceRunPaneRef = z.infer<typeof workspaceRunPaneRefSchema>;

/**
 * Reference to an unstarted draft composer pane.
 */
export const workspaceDraftPaneRefSchema = z.object({
  kind: z.literal('draft'),
  paneId: z.string(),
  projectId: z.string(),
  draftId: z.string(),
});
export type WorkspaceDraftPaneRef = z.infer<typeof workspaceDraftPaneRefSchema>;

/**
 * A single conversation pane tab: either a concrete run or a draft.
 */
export const workspacePaneThreadSchema = z.discriminatedUnion('kind', [
  workspaceRunPaneRefSchema,
  workspaceDraftPaneRefSchema,
]);
export type WorkspacePaneThread = z.infer<typeof workspacePaneThreadSchema>;

/**
 * The 2-up split configuration: either 'none' or two pane IDs ({ a, b }).
 */
export const workspaceSplitObjectSchema = z.object({
  a: z.string(),
  b: z.string(),
});
export type WorkspaceSplitObject = z.infer<typeof workspaceSplitObjectSchema>;

export const workspaceSplitSchema = z.union([
  z.literal('none'),
  workspaceSplitObjectSchema,
]);
export type WorkspaceSplit = z.infer<typeof workspaceSplitSchema>;

/**
 * `GET /api/v1/p/:projectId/workspace/panes`
 * `PUT /api/v1/p/:projectId/workspace/panes`
 *
 * Workspace multi-thread pane state.
 */
export const workspacePanesSchema = z.object({
  threads: z.array(workspacePaneThreadSchema).max(MAX_WORKSPACE_PANES_THREADS),
  active: z.string().optional(),
  split: workspaceSplitSchema,
});
export type WorkspacePanes = z.infer<typeof workspacePanesSchema>;

/** PUT body has the exact same shape as the saved panes document. */
export const workspacePanesInputSchema = workspacePanesSchema;
export type WorkspacePanesInput = WorkspacePanes;

export const putWorkspacePanesInputSchema = workspacePanesSchema;
export type PutWorkspacePanesInput = WorkspacePanes;

export const setWorkspacePanesInputSchema = workspacePanesSchema;
export type SetWorkspacePanesInput = WorkspacePanes;
