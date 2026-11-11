import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createWorkspaceState,
  openRun,
  readWorkspaceState,
  resetWorkspaceStateStores,
  updateWorkspaceState,
  writeWorkspaceState,
  type WorkspaceState,
} from '@/lib/workspace-state'
import {
  serializePanes,
  toWorkspacePanesPayload,
  useWorkspacePanesSync,
} from './workspace-panes-sync'

const fetchMock = vi.fn<typeof fetch>()

const projectId = 'proj-sync'
const runA = { kind: 'run' as const, paneId: 'pane-a', projectId, runId: 'run-a', title: 'Task A' }
const runB = { kind: 'run' as const, paneId: 'pane-b', projectId, runId: 'run-b', title: 'Task B' }
const draft = { kind: 'draft' as const, paneId: 'pane-draft', projectId, draftId: 'draft-1', title: 'New Task' }

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

describe('toWorkspacePanesPayload and serializePanes', () => {
  it('strips client-only fields (e.g. title, navigator, context) before sync', () => {
    const state: WorkspaceState = {
      navigator: { collapsed: true, width: 300 },
      threads: [runA, draft],
      active: runA.paneId,
      split: { a: runA.paneId, b: draft.paneId },
      context: { open: true, width: 400, view: 'changes' },
    }

    const payload = toWorkspacePanesPayload(state)

    expect(payload).toEqual({
      threads: [
        { kind: 'run', paneId: 'pane-a', projectId, runId: 'run-a' },
        { kind: 'draft', paneId: 'pane-draft', projectId, draftId: 'draft-1' },
      ],
      active: 'pane-a',
      split: { a: 'pane-a', b: 'pane-draft' },
    })

    // Confirm title, navigator, context are absent from the payload
    expect(payload).not.toHaveProperty('navigator')
    expect(payload).not.toHaveProperty('context')
    expect(payload.threads[0]).not.toHaveProperty('title')
    expect(payload.threads[1]).not.toHaveProperty('title')
  })

  it('serializePanes produces deterministic string matching normalized values', () => {
    const payload = toWorkspacePanesPayload({
      ...createWorkspaceState(),
      threads: [runA],
      active: runA.paneId,
    })

    const str1 = serializePanes(payload)
    const str2 = serializePanes(payload)
    expect(str1).toBe(str2)
  })

  it('keeps active and both split panes inside the 50-thread mirror cap', () => {
    const threads = Array.from({ length: 52 }, (_, index) => ({
      kind: 'run' as const,
      paneId: `pane-${index + 1}`,
      projectId,
      runId: `run-${index + 1}`,
    }))
    const state: WorkspaceState = {
      ...createWorkspaceState(),
      threads,
      active: 'pane-52',
      split: { a: 'pane-51', b: 'pane-52' },
    }

    const payload = toWorkspacePanesPayload(state)
    const retainedIds = new Set(payload.threads.map((thread) => thread.paneId))

    expect(payload.threads).toHaveLength(50)
    expect(retainedIds.has('pane-51')).toBe(true)
    expect(retainedIds.has('pane-52')).toBe(true)
    expect(payload.active).toBe('pane-52')
    expect(payload.split).toEqual({ a: 'pane-51', b: 'pane-52' })
    expect(retainedIds.has(payload.active!)).toBe(true)
    expect(retainedIds.has(payload.split === 'none' ? '' : payload.split.a)).toBe(true)
    expect(retainedIds.has(payload.split === 'none' ? '' : payload.split.b)).toBe(true)
  })
})

describe('useWorkspacePanesSync', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    queryClient = createTestQueryClient()
    fetchMock.mockReset()
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
    resetWorkspaceStateStores()
    fetchMock.mockReset()
    vi.unstubAllGlobals()
    queryClient.clear()
  })

  it('hydrates empty local state once from server GET and does not immediately PUT', async () => {
    const serverPanes = {
      threads: [{ kind: 'run' as const, paneId: 'pane-a', projectId, runId: 'run-a' }],
      active: 'pane-a',
      split: 'none' as const,
    }
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(serverPanes), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const wrapper = createWrapper(queryClient)
    renderHook(() => useWorkspacePanesSync(projectId, { debounceMs: 40 }), { wrapper })

    // Wait for hydration to complete
    await waitFor(() => {
      const current = readWorkspaceState(projectId)
      expect(current.threads).toEqual([{ kind: 'run', paneId: 'pane-a', projectId, runId: 'run-a' }])
      expect(current.active).toBe('pane-a')
    })

    // Confirm only GET was called, no PUT
    const putCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')
    expect(putCalls).toHaveLength(0)

    // Wait past debounce time to be certain no PUT is triggered
    await new Promise((resolve) => setTimeout(resolve, 80))
    const laterPutCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')
    expect(laterPutCalls).toHaveLength(0)
  })

  it('does NOT hydrate from server when local state already has threads on mount (localStorage primary)', async () => {
    const initial = openRun(createWorkspaceState(), runA)
    writeWorkspaceState(projectId, initial)

    const serverPanes = {
      threads: [{ kind: 'run' as const, paneId: 'pane-server', projectId, runId: 'run-server' }],
      active: 'pane-server',
      split: 'none' as const,
    }
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(serverPanes), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const wrapper = createWrapper(queryClient)
    renderHook(() => useWorkspacePanesSync(projectId, { debounceMs: 40 }), { wrapper })

    // Wait to confirm local threads remain
    await new Promise((resolve) => setTimeout(resolve, 80))

    const current = readWorkspaceState(projectId)
    expect(current.threads).toEqual([runA])
    expect(current.active).toBe(runA.paneId)

    // No PUT on initial mount when state has not changed
    const putCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')
    expect(putCalls).toHaveLength(0)
  })

  it('debounces local changes (~800ms) and PUTs to server', async () => {
    fetchMock.mockImplementation(async (url, init) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body))
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ threads: [], split: 'none' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    const wrapper = createWrapper(queryClient)
    renderHook(() => useWorkspacePanesSync(projectId, { debounceMs: 60 }), { wrapper })

    // Wait for initial hydration to complete
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0)

    // Trigger local state change
    act(() => {
      updateWorkspaceState(projectId, (curr) => openRun(curr, runA))
    })

    // Wait for debounced PUT to be called
    await waitFor(
      () => {
        const putCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')
        expect(putCalls).toHaveLength(1)
        const [url, init] = putCalls[0]!
        expect(String(url)).toBe(`/api/v1/p/${projectId}/workspace/panes`)
        expect(JSON.parse(String(init?.body))).toMatchObject({
          threads: [{ kind: 'run', paneId: 'pane-a', projectId, runId: 'run-a' }],
          active: 'pane-a',
          split: 'none',
        })
      },
      { timeout: 1000 },
    )
  })

  it('collapses rapid successive changes into a single PUT of the latest state', async () => {
    fetchMock.mockImplementation(async (url, init) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body))
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ threads: [], split: 'none' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    const wrapper = createWrapper(queryClient)
    renderHook(() => useWorkspacePanesSync(projectId, { debounceMs: 80 }), { wrapper })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })

    // Rapid change 1
    act(() => {
      updateWorkspaceState(projectId, (curr) => openRun(curr, runA))
    })

    await new Promise((resolve) => setTimeout(resolve, 30))

    // Rapid change 2
    act(() => {
      updateWorkspaceState(projectId, (curr) => openRun(curr, runB))
    })

    // Wait past debounce
    await waitFor(
      () => {
        const putCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')
        expect(putCalls).toHaveLength(1)
        const [, init] = putCalls[0]!
        const parsed = JSON.parse(String(init?.body))
        expect(parsed.threads).toHaveLength(2)
        expect(parsed.active).toBe('pane-b')
      },
      { timeout: 1000 },
    )
  })

  it('skips PUT when local state returns to last synced state or context-only changes occur', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ threads: [], split: 'none' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const wrapper = createWrapper(queryClient)
    renderHook(() => useWorkspacePanesSync(projectId, { debounceMs: 40 }), { wrapper })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })

    // Change context only (not part of workspacePanesSchema)
    act(() => {
      updateWorkspaceState(projectId, (curr) => ({
        ...curr,
        context: { open: true, view: 'terminal' },
      }))
    })

    await new Promise((resolve) => setTimeout(resolve, 80))

    const putCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')
    expect(putCalls).toHaveLength(0)
  })

  it('never PUTs an empty default over a non-empty server copy before hydration finished', async () => {
    let resolveServerQuery: (res: Response) => void
    const pendingQuery = new Promise<Response>((resolve) => {
      resolveServerQuery = resolve
    })

    fetchMock.mockImplementation(async (url, init) => {
      if (init?.method === 'PUT') {
        return new Response(JSON.stringify({ threads: [], split: 'none' }), { status: 200 })
      }
      return pendingQuery
    })

    const wrapper = createWrapper(queryClient)
    renderHook(() => useWorkspacePanesSync(projectId, { debounceMs: 40 }), { wrapper })

    // While query is pending, state is empty default
    await new Promise((resolve) => setTimeout(resolve, 80))

    // Must NOT have PUT
    const putCallsWhilePending = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')
    expect(putCallsWhilePending).toHaveLength(0)

    // Resolve query with server threads
    act(() => {
      resolveServerQuery!(
        new Response(
          JSON.stringify({
            threads: [{ kind: 'run', paneId: 'pane-a', projectId, runId: 'run-a' }],
            active: 'pane-a',
            split: 'none',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
    })

    // Hydrated locally
    await waitFor(() => {
      expect(readWorkspaceState(projectId).threads).toHaveLength(1)
    })

    // Still no PUT
    const laterPutCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')
    expect(laterPutCalls).toHaveLength(0)
  })

  it('handles server network errors silently without crashing', async () => {
    fetchMock.mockImplementation(async (url, init) => {
      if (init?.method === 'PUT') {
        throw new TypeError('Failed to fetch (offline)')
      }
      throw new TypeError('Failed to fetch (offline)')
    })

    const wrapper = createWrapper(queryClient)
    renderHook(() => useWorkspacePanesSync(projectId, { debounceMs: 40 }), { wrapper })

    await new Promise((resolve) => setTimeout(resolve, 60))

    // User can still make local changes offline
    act(() => {
      updateWorkspaceState(projectId, (curr) => openRun(curr, runA))
    })

    await waitFor(
      () => {
        const putCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')
        expect(putCalls).toHaveLength(1)
      },
      { timeout: 1000 },
    )

    // Local state remains intact
    expect(readWorkspaceState(projectId).threads).toHaveLength(1)
  })

  it('degrades silently when rendered without a QueryClientProvider', () => {
    expect(() => {
      renderHook(() => useWorkspacePanesSync(projectId))
    }).not.toThrow()
  })
})
