import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { getApiBaseUrl, type RunRecord, type RunStatus } from '@onni/api-client'
import { ApiError, unwrap } from './client'
import { queryKeys } from './queries'

export type ThreadRunRecord = RunRecord & {
  lastViewedSeq?: number
}

export interface ThreadsQuery {
  cursor?: string
  limit?: number
  projectId?: string
  status?: string
}

export interface ThreadSummary {
  runId: string
  projectId: string
  title: string
  status: RunStatus
  updatedAt: string
  preview?: string
  awaitingAsk: boolean
  workerCount: number
  parentRunId?: string
  unread: boolean
}

export interface ThreadsPage {
  items: ThreadSummary[]
  nextCursor?: string
  truncatedProjects?: string[]
}

export interface ThreadsIndexFilters {
  projectId?: string
  status?: string
  limit?: number
  enabled?: boolean
}

export interface TranscriptSearchQuery {
  q: string
  projectId?: string
  runId?: string
  cursor?: string
  limit?: number
}

export interface TranscriptSearchItem {
  runId: string
  projectId: string
  seq: number
  turnId?: string
  snippet: string
}

export interface TranscriptSearchPage {
  items: TranscriptSearchItem[]
  nextCursor?: string
}

export interface TranscriptSearchOpts {
  projectId?: string
  runId?: string
  cursor?: string
  limit?: number
  enabled?: boolean
}

export interface MarkViewedInput {
  seq: number
}

export interface WorkspaceRunPaneRef {
  kind: 'run'
  paneId: string
  projectId: string
  runId: string
}

export interface WorkspaceDraftPaneRef {
  kind: 'draft'
  paneId: string
  projectId: string
  draftId: string
}

export type WorkspacePaneThread = WorkspaceRunPaneRef | WorkspaceDraftPaneRef

export type WorkspaceSplit = 'none' | { a: string; b: string }

export interface WorkspacePanes {
  threads: WorkspacePaneThread[]
  active?: string
  split: WorkspaceSplit
}

/**
 * Hierarchical and scope-led query keys for multi-thread navigation,
 * transcript search, and workspace pane persistence.
 */
export const workspaceThreadsQueryKeys = {
  all: ['workspace', 'threads'] as const,
  list: (filters?: ThreadsIndexFilters) =>
    [
      'workspace',
      'threads',
      'list',
      filters?.projectId ?? null,
      filters?.status ?? null,
      filters?.limit ?? null,
    ] as const,
  searchAll: ['workspace', 'search'] as const,
  search: (q: string, opts?: TranscriptSearchOpts) =>
    [
      'workspace',
      'search',
      q,
      opts?.projectId ?? null,
      opts?.runId ?? null,
      opts?.limit ?? null,
    ] as const,
  panesAll: ['workspace-panes'] as const,
  panes: (projectId: string) => ['workspace-panes', projectId] as const,
}

async function fetchOrThrow(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, credentials: 'include' })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new ApiError(0, `cannot reach the onni server (${url})`, { cause })
  }
}

/**
 * `GET /api/v1/workspace/threads`
 *
 * Cursor-paged, cross-project activity-ordered session query.
 */
export async function fetchThreadsIndex(
  query?: ThreadsQuery,
  opts?: { signal?: AbortSignal },
): Promise<ThreadsPage> {
  const params = new URLSearchParams()
  if (query?.cursor) params.set('cursor', query.cursor)
  if (query?.limit !== undefined) params.set('limit', String(query.limit))
  if (query?.projectId) params.set('projectId', query.projectId)
  if (query?.status) params.set('status', query.status)
  const qs = params.toString()
  const path = `/workspace/threads${qs ? `?${qs}` : ''}`
  const url = `${getApiBaseUrl()}/api/v1${path}`
  const res = await fetchOrThrow(url, { method: 'GET', signal: opts?.signal })
  return (await unwrap(res as never, path)) as unknown as ThreadsPage
}

/**
 * Infinite query over cursor-paged workspace threads index.
 * No polling: relies on SSE/WS bus notifications to invalidate.
 */
export function useThreadsIndex(filters?: ThreadsIndexFilters) {
  const enabled = filters?.enabled ?? true
  return useInfiniteQuery({
    queryKey: workspaceThreadsQueryKeys.list(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      fetchThreadsIndex({ ...filters, cursor: pageParam }, { signal }),
    getNextPageParam: (lastPage: ThreadsPage) => lastPage.nextCursor ?? undefined,
    enabled,
  })
}

/**
 * `GET /api/v1/workspace/search`
 *
 * Cross-project / per-thread transcript snippet search.
 */
export async function fetchTranscriptSearch(
  query: TranscriptSearchQuery,
  opts?: { signal?: AbortSignal },
): Promise<TranscriptSearchPage> {
  const params = new URLSearchParams()
  params.set('q', query.q)
  if (query.projectId) params.set('projectId', query.projectId)
  if (query.runId) params.set('runId', query.runId)
  if (query.cursor) params.set('cursor', query.cursor)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  const qs = params.toString()
  const path = `/workspace/search${qs ? `?${qs}` : ''}`
  const url = `${getApiBaseUrl()}/api/v1${path}`
  const res = await fetchOrThrow(url, { method: 'GET', signal: opts?.signal })
  return (await unwrap(res as never, path)) as unknown as TranscriptSearchPage
}

/**
 * Search transcript events. Enabled only for query length >= 2; debounce is left to the caller.
 */
export function useTranscriptSearch(q: string, opts?: TranscriptSearchOpts) {
  const trimmed = typeof q === 'string' ? q.trim() : ''
  const enabled = (opts?.enabled ?? true) && trimmed.length >= 2
  return useQuery({
    queryKey: workspaceThreadsQueryKeys.search(trimmed, opts),
    queryFn: ({ signal }) => fetchTranscriptSearch({ q: trimmed, ...opts }, { signal }),
    enabled,
  })
}

/**
 * `POST /api/v1/p/:projectId/runs/:id/viewed`
 *
 * Monotonically advance the highest transcript event sequence viewed by the user.
 */
export async function markRunViewed(
  projectId: string,
  runId: string,
  seq: number,
  opts?: { signal?: AbortSignal },
): Promise<ThreadRunRecord> {
  const scope = projectId ? `/p/${encodeURIComponent(projectId)}` : ''
  const path = `${scope}/runs/${encodeURIComponent(runId)}/viewed`
  const url = `${getApiBaseUrl()}/api/v1${path}`
  const res = await fetchOrThrow(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ seq }),
    signal: opts?.signal,
  })
  return (await unwrap(res as never, path)) as unknown as ThreadRunRecord
}

/**
 * Mutation hook helper for `markRunViewed`. Updates cached run record and invalidates threads.
 */
export function useMarkRunViewed() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      projectId,
      runId,
      seq,
    }: {
      projectId: string
      runId: string
      seq: number
    }) => markRunViewed(projectId, runId, seq),
    onSuccess: (updated) => {
      queryClient.setQueryData<RunRecord>(queryKeys.runs.detail(updated.id), (current) => {
        if (!current) return updated
        const cur = current as ThreadRunRecord
        const lastViewed = Math.max(cur.lastViewedSeq ?? 0, updated.lastViewedSeq ?? 0)
        return { ...current, ...updated, lastViewedSeq: lastViewed }
      })
      void queryClient.invalidateQueries({ queryKey: workspaceThreadsQueryKeys.all })
    },
  })
}

/**
 * `GET /api/v1/p/:projectId/workspace/panes`
 *
 * Retrieve workspace multi-thread conversation panes state for a project.
 */
export async function fetchWorkspacePanes(
  projectId: string,
  opts?: { signal?: AbortSignal },
): Promise<WorkspacePanes> {
  const scope = projectId ? `/p/${encodeURIComponent(projectId)}` : ''
  const path = `${scope}/workspace/panes`
  const url = `${getApiBaseUrl()}/api/v1${path}`
  const res = await fetchOrThrow(url, { method: 'GET', signal: opts?.signal })
  return (await unwrap(res as never, path)) as unknown as WorkspacePanes
}

/**
 * `PUT /api/v1/p/:projectId/workspace/panes`
 *
 * Save workspace multi-thread conversation panes state for a project.
 */
export async function putWorkspacePanes(
  projectId: string,
  panes: WorkspacePanes,
  opts?: { signal?: AbortSignal },
): Promise<WorkspacePanes> {
  const scope = projectId ? `/p/${encodeURIComponent(projectId)}` : ''
  const path = `${scope}/workspace/panes`
  const url = `${getApiBaseUrl()}/api/v1${path}`
  const res = await fetchOrThrow(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(panes),
    signal: opts?.signal,
  })
  return (await unwrap(res as never, path)) as unknown as WorkspacePanes
}

/**
 * Hook to read workspace conversation panes.
 */
export function useWorkspacePanes(projectId: string, enabled = true) {
  return useQuery({
    queryKey: workspaceThreadsQueryKeys.panes(projectId),
    queryFn: ({ signal }) => fetchWorkspacePanes(projectId, { signal }),
    enabled: Boolean(projectId) && enabled,
  })
}

/**
 * Mutation hook to persist workspace conversation panes.
 */
export function useSaveWorkspacePanes(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (panes: WorkspacePanes) => putWorkspacePanes(projectId, panes),
    onSuccess: (saved) => {
      queryClient.setQueryData(workspaceThreadsQueryKeys.panes(projectId), saved)
    },
  })
}
