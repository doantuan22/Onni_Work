import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { setApiBaseUrl, type RunRecord } from '@onni/api-client'
import { ApiError } from './client'
import { queryKeys } from './queries'
import {
  fetchThreadsIndex,
  fetchTranscriptSearch,
  fetchWorkspacePanes,
  markRunViewed,
  putWorkspacePanes,
  useMarkRunViewed,
  useSaveWorkspacePanes,
  useThreadsIndex,
  useTranscriptSearch,
  useWorkspacePanes,
  workspaceThreadsQueryKeys,
  type ThreadsPage,
  type TranscriptSearchPage,
  type WorkspacePanes,
} from './workspace-threads'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
  setApiBaseUrl('')
})

function createWrapper(client: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children)
  }
}

describe('workspace-threads API and hooks', () => {
  describe('fetchThreadsIndex & useThreadsIndex', () => {
    const mockPage1: ThreadsPage = {
      items: [
        {
          runId: 'run-1',
          projectId: 'proj-1',
          title: 'First task',
          status: 'running',
          updatedAt: '2026-11-11T10:00:00Z',
          preview: 'Working on feature',
          awaitingAsk: false,
          workerCount: 0,
          unread: true,
        },
      ],
      nextCursor: 'cursor-page-2',
    }

    const mockPage2: ThreadsPage = {
      items: [
        {
          runId: 'run-2',
          projectId: 'proj-1',
          title: 'Second task',
          status: 'done',
          updatedAt: '2026-11-11T09:00:00Z',
          awaitingAsk: false,
          workerCount: 2,
          unread: false,
        },
      ],
      truncatedProjects: ['proj-old'],
    }

    it('sends GET to /api/v1/workspace/threads with query parameters and credentials: include', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(mockPage1), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

      const result = await fetchThreadsIndex({
        projectId: 'proj-1',
        status: 'running',
        limit: 10,
        cursor: 'cur-1',
      })

      expect(result).toEqual(mockPage1)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]!
      const parsedUrl = new URL(String(url), 'http://localhost')
      expect(parsedUrl.pathname).toBe('/api/v1/workspace/threads')
      expect(parsedUrl.searchParams.get('projectId')).toBe('proj-1')
      expect(parsedUrl.searchParams.get('status')).toBe('running')
      expect(parsedUrl.searchParams.get('limit')).toBe('10')
      expect(parsedUrl.searchParams.get('cursor')).toBe('cur-1')
      expect(init?.credentials).toBe('include')
    })

    it('handles fetchThreadsIndex with default/empty query', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

      const result = await fetchThreadsIndex()
      expect(result).toEqual({ items: [] })
      const [url] = fetchMock.mock.calls[0]!
      const parsedUrl = new URL(String(url), 'http://localhost')
      expect(parsedUrl.pathname).toBe('/api/v1/workspace/threads')
      expect(parsedUrl.search).toBe('')
    })

    it('throws ApiError on server error or network failure', async () => {
      fetchMock.mockImplementation(
        async () =>
          new Response(JSON.stringify({ error: 'invalid cursor' }), {
            status: 400,
            statusText: 'Bad Request',
            headers: { 'content-type': 'application/json' },
          }),
      )

      await expect(fetchThreadsIndex({ cursor: 'bad' })).rejects.toThrow(ApiError)
      await expect(fetchThreadsIndex({ cursor: 'bad' })).rejects.toMatchObject({
        status: 400,
        message: 'invalid cursor',
      })
    })

    it('wraps network failure into ApiError(0)', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      await expect(fetchThreadsIndex()).rejects.toMatchObject({
        status: 0,
        message: expect.stringContaining('cannot reach the onni server'),
      })
    })

    it('rethrows AbortError untouched', async () => {
      const abortError = new DOMException('The user aborted a request.', 'AbortError')
      fetchMock.mockRejectedValueOnce(abortError)
      await expect(fetchThreadsIndex()).rejects.toBe(abortError)
    })

    it('useThreadsIndex paginates over cursor with useInfiniteQuery', async () => {
      fetchMock
        .mockResolvedValueOnce(
          new Response(JSON.stringify(mockPage1), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(mockPage2), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )

      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const { result } = renderHook(
        () => useThreadsIndex({ projectId: 'proj-1', limit: 1 }),
        { wrapper: createWrapper(client) },
      )

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data?.pages).toHaveLength(1)
      expect(result.current.data?.pages[0]?.items[0]?.runId).toBe('run-1')
      expect(result.current.hasNextPage).toBe(true)

      // Fetch second page
      await result.current.fetchNextPage()
      await waitFor(() => expect(result.current.data?.pages).toHaveLength(2))
      expect(result.current.data?.pages[1]?.items[0]?.runId).toBe('run-2')
      expect(result.current.hasNextPage).toBe(false)

      expect(fetchMock).toHaveBeenCalledTimes(2)
      const secondCallUrl = new URL(String(fetchMock.mock.calls[1]![0]), 'http://localhost')
      expect(secondCallUrl.searchParams.get('cursor')).toBe('cursor-page-2')
      expect(secondCallUrl.searchParams.get('projectId')).toBe('proj-1')
    })

    it('useThreadsIndex respects enabled: false', () => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const { result } = renderHook(
        () => useThreadsIndex({ enabled: false }),
        { wrapper: createWrapper(client) },
      )

      expect(result.current.status).toBe('pending')
      expect(result.current.fetchStatus).toBe('idle')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('fetchTranscriptSearch & useTranscriptSearch', () => {
    const mockSearchResults: TranscriptSearchPage = {
      items: [
        {
          runId: 'run-1',
          projectId: 'proj-1',
          seq: 42,
          snippet: 'found needle here in transcript',
        },
      ],
      nextCursor: 'next-search-cursor',
    }

    it('sends GET to /api/v1/workspace/search with query parameters', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(mockSearchResults), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

      const result = await fetchTranscriptSearch({
        q: 'needle',
        projectId: 'proj-1',
        runId: 'run-1',
        limit: 25,
      })

      expect(result).toEqual(mockSearchResults)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]!
      const parsedUrl = new URL(String(url), 'http://localhost')
      expect(parsedUrl.pathname).toBe('/api/v1/workspace/search')
      expect(parsedUrl.searchParams.get('q')).toBe('needle')
      expect(parsedUrl.searchParams.get('projectId')).toBe('proj-1')
      expect(parsedUrl.searchParams.get('runId')).toBe('run-1')
      expect(parsedUrl.searchParams.get('limit')).toBe('25')
      expect(init?.credentials).toBe('include')
    })

    it('useTranscriptSearch is disabled for queries shorter than 2 chars', () => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

      const { result: emptyResult } = renderHook(
        () => useTranscriptSearch(''),
        { wrapper: createWrapper(client) },
      )
      expect(emptyResult.current.fetchStatus).toBe('idle')

      const { result: singleCharResult } = renderHook(
        () => useTranscriptSearch('a'),
        { wrapper: createWrapper(client) },
      )
      expect(singleCharResult.current.fetchStatus).toBe('idle')

      const { result: whitespaceResult } = renderHook(
        () => useTranscriptSearch('  x  '),
        { wrapper: createWrapper(client) },
      )
      expect(whitespaceResult.current.fetchStatus).toBe('idle')

      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('useTranscriptSearch executes when query length >= 2', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(mockSearchResults), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const { result } = renderHook(
        () => useTranscriptSearch('find me', { projectId: 'proj-1' }),
        { wrapper: createWrapper(client) },
      )

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toEqual(mockSearchResults)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url] = fetchMock.mock.calls[0]!
      const parsedUrl = new URL(String(url), 'http://localhost')
      expect(parsedUrl.searchParams.get('q')).toBe('find me')
      expect(parsedUrl.searchParams.get('projectId')).toBe('proj-1')
    })

    it('useTranscriptSearch respects enabled: false option even when q >= 2', () => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const { result } = renderHook(
        () => useTranscriptSearch('long enough', { enabled: false }),
        { wrapper: createWrapper(client) },
      )

      expect(result.current.fetchStatus).toBe('idle')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('markRunViewed & useMarkRunViewed', () => {
    const mockUpdatedRun: RunRecord = {
      id: 'run-123',
      title: 'Run task',
      workflow: 'default',
      task: 'do work',
      createdAt: '2026-11-11T00:00:00Z',
      status: 'running',
      runner: 'claude',
      lastViewedSeq: 15,
    } as unknown as RunRecord

    it('sends POST /api/v1/p/:projectId/runs/:id/viewed with seq payload', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(mockUpdatedRun), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

      const result = await markRunViewed('proj-x', 'run-123', 15)
      expect(result).toEqual(mockUpdatedRun)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      const [url, init] = fetchMock.mock.calls[0]!
      expect(String(url)).toBe('/api/v1/p/proj-x/runs/run-123/viewed')
      expect(init?.method).toBe('POST')
      expect(init?.headers).toEqual({ 'content-type': 'application/json' })
      expect(JSON.parse(String(init?.body))).toEqual({ seq: 15 })
      expect(init?.credentials).toBe('include')
    })

    it('useMarkRunViewed updates run detail cache and invalidates threads', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(mockUpdatedRun), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      client.setQueryData(queryKeys.runs.detail('run-123'), {
        id: 'run-123',
        lastViewedSeq: 5,
      })

      const invalidateSpy = vi.spyOn(client, 'invalidateQueries')

      const { result } = renderHook(() => useMarkRunViewed(), {
        wrapper: createWrapper(client),
      })

      await result.current.mutateAsync({
        projectId: 'proj-x',
        runId: 'run-123',
        seq: 15,
      })

      const cached = client.getQueryData<RunRecord & { lastViewedSeq?: number }>(
        queryKeys.runs.detail('run-123'),
      )
      expect(cached?.lastViewedSeq).toBe(15)
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: workspaceThreadsQueryKeys.all,
      })
    })
  })

  describe('fetchWorkspacePanes, putWorkspacePanes, and hooks', () => {
    const mockPanes: WorkspacePanes = {
      threads: [
        {
          kind: 'run',
          paneId: 'p-run-1',
          projectId: 'proj-1',
          runId: 'run-1',
        },
        {
          kind: 'draft',
          paneId: 'p-draft-1',
          projectId: 'proj-1',
          draftId: 'draft-abc',
        },
      ],
      active: 'p-run-1',
      split: { a: 'p-run-1', b: 'p-draft-1' },
    }

    it('fetchWorkspacePanes sends GET to /api/v1/p/:projectId/workspace/panes', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(mockPanes), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

      const result = await fetchWorkspacePanes('proj-1')
      expect(result).toEqual(mockPanes)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]!
      expect(String(url)).toBe('/api/v1/p/proj-1/workspace/panes')
      expect(init?.method).toBe('GET')
      expect(init?.credentials).toBe('include')
    })

    it('putWorkspacePanes sends PUT to /api/v1/p/:projectId/workspace/panes with panes payload', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(mockPanes), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

      const result = await putWorkspacePanes('proj-1', mockPanes)
      expect(result).toEqual(mockPanes)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]!
      expect(String(url)).toBe('/api/v1/p/proj-1/workspace/panes')
      expect(init?.method).toBe('PUT')
      expect(init?.headers).toEqual({ 'content-type': 'application/json' })
      expect(JSON.parse(String(init?.body))).toEqual(mockPanes)
      expect(init?.credentials).toBe('include')
    })

    it('useWorkspacePanes reads panes and caches by project scope', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(mockPanes), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const { result } = renderHook(() => useWorkspacePanes('proj-1'), {
        wrapper: createWrapper(client),
      })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toEqual(mockPanes)
      expect(client.getQueryData(workspaceThreadsQueryKeys.panes('proj-1'))).toEqual(
        mockPanes,
      )
    })

    it('useSaveWorkspacePanes persists panes and updates query cache', async () => {
      const updatedPanes: WorkspacePanes = {
        ...mockPanes,
        split: 'none',
      }
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(updatedPanes), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const { result } = renderHook(() => useSaveWorkspacePanes('proj-1'), {
        wrapper: createWrapper(client),
      })

      await result.current.mutateAsync(updatedPanes)
      expect(client.getQueryData(workspaceThreadsQueryKeys.panes('proj-1'))).toEqual(
        updatedPanes,
      )
    })
  })

  describe('workspaceThreadsQueryKeys structure', () => {
    it('provides hierarchical and scope-led query keys', () => {
      expect(workspaceThreadsQueryKeys.all).toEqual(['workspace', 'threads'])
      expect(
        workspaceThreadsQueryKeys.list({ projectId: 'p1', status: 'running', limit: 20 }),
      ).toEqual(['workspace', 'threads', 'list', 'p1', 'running', 20])
      expect(workspaceThreadsQueryKeys.searchAll).toEqual(['workspace', 'search'])
      expect(
        workspaceThreadsQueryKeys.search('my-query', { projectId: 'p1', limit: 10 }),
      ).toEqual(['workspace', 'search', 'my-query', 'p1', null, 10])
      expect(workspaceThreadsQueryKeys.panesAll).toEqual(['workspace-panes'])
      expect(workspaceThreadsQueryKeys.panes('p1')).toEqual(['workspace-panes', 'p1'])
    })
  })
})
