import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { WorkspaceState } from '@/lib/workspace-state'

import {
  getVisibleRunIds,
  useMarkSingleRunViewed,
  useMarkViewed,
} from './use-mark-viewed'

const mockMutate = vi.fn()

vi.mock('@/api/workspace-threads', () => ({
  useMarkRunViewed: () => ({
    mutate: mockMutate,
  }),
}))

vi.mock('@/api/queries', () => ({
  useRun: (id?: string) => ({
    data: id ? { id, lastSeq: 20, lastViewedSeq: 5 } : undefined,
  }),
}))

function createWrapper(client: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children)
  }
}

describe('use-mark-viewed', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.useFakeTimers()
    mockMutate.mockReset()
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    // Ensure document.visibilityState is 'visible' by default in jsdom
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  describe('getVisibleRunIds', () => {
    it('returns target runId when state is absent', () => {
      expect(getVisibleRunIds(undefined, { kind: 'run', runId: 'run-1' })).toEqual(['run-1'])
      expect(getVisibleRunIds(undefined, { kind: 'draft' })).toEqual([])
    })

    it('returns active run pane id in single mode', () => {
      const state: WorkspaceState = {
        navigator: {},
        threads: [
          { kind: 'run', paneId: 'run:p1:r1', projectId: 'p1', runId: 'r1' },
          { kind: 'run', paneId: 'run:p1:r2', projectId: 'p1', runId: 'r2' },
        ],
        active: 'run:p1:r1',
        split: 'none',
        context: { open: false },
      }
      expect(getVisibleRunIds(state, undefined, true)).toEqual(['r1'])
    })

    it('returns empty array when active pane is a draft in single mode', () => {
      const state: WorkspaceState = {
        navigator: {},
        threads: [
          { kind: 'draft', paneId: 'draft:p1', projectId: 'p1', draftId: 'default' },
        ],
        active: 'draft:p1',
        split: 'none',
        context: { open: false },
      }
      expect(getVisibleRunIds(state, undefined, true)).toEqual([])
    })

    it('returns both run pane ids in desktop split mode', () => {
      const state: WorkspaceState = {
        navigator: {},
        threads: [
          { kind: 'run', paneId: 'run:p1:r1', projectId: 'p1', runId: 'r1' },
          { kind: 'run', paneId: 'run:p1:r2', projectId: 'p1', runId: 'r2' },
        ],
        active: 'run:p1:r1',
        split: { a: 'run:p1:r1', b: 'run:p1:r2' },
        context: { open: false },
      }
      expect(getVisibleRunIds(state, undefined, true)).toEqual(['r1', 'r2'])
    })

    it('returns only the active pane on mobile split mode', () => {
      const state: WorkspaceState = {
        navigator: {},
        threads: [
          { kind: 'run', paneId: 'run:p1:r1', projectId: 'p1', runId: 'r1' },
          { kind: 'run', paneId: 'run:p1:r2', projectId: 'p1', runId: 'r2' },
        ],
        active: 'run:p1:r2',
        split: { a: 'run:p1:r1', b: 'run:p1:r2' },
        context: { open: false },
      }
      expect(getVisibleRunIds(state, undefined, false)).toEqual(['r2'])
    })
  })

  describe('useMarkSingleRunViewed', () => {
    it('keeps the viewed watermark separate for each project and run', () => {
      const { rerender } = renderHook(
        ({ projectId, runId, seq }: { projectId: string; runId: string; seq: number }) =>
          useMarkSingleRunViewed({ projectId, runId, lastSeq: seq, lastViewedSeq: 0, visible: true, debounceMs: 100 }),
        {
          initialProps: { projectId: 'proj-1', runId: 'run-a', seq: 100 },
          wrapper: createWrapper(queryClient),
        },
      )

      act(() => vi.advanceTimersByTime(100))
      expect(mockMutate).toHaveBeenCalledWith({ projectId: 'proj-1', runId: 'run-a', seq: 100 })
      rerender({ projectId: 'proj-1', runId: 'run-b', seq: 3 })
      act(() => vi.advanceTimersByTime(100))
      expect(mockMutate).toHaveBeenCalledWith({ projectId: 'proj-1', runId: 'run-b', seq: 3 })
      rerender({ projectId: 'proj-2', runId: 'run-b', seq: 2 })
      act(() => vi.advanceTimersByTime(100))
      expect(mockMutate).toHaveBeenCalledWith({ projectId: 'proj-2', runId: 'run-b', seq: 2 })
      expect(mockMutate).toHaveBeenCalledTimes(3)
    })

    it('marks run viewed debounced ~1s when visible and document visible', () => {
      renderHook(
        () =>
          useMarkSingleRunViewed({
            projectId: 'proj-1',
            runId: 'run-1',
            lastSeq: 10,
            lastViewedSeq: 5,
            visible: true,
            debounceMs: 1000,
          }),
        { wrapper: createWrapper(queryClient) },
      )

      expect(mockMutate).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(500)
      })
      expect(mockMutate).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(500)
      })
      expect(mockMutate).toHaveBeenCalledTimes(1)
      expect(mockMutate).toHaveBeenCalledWith({
        projectId: 'proj-1',
        runId: 'run-1',
        seq: 10,
      })
    })

    it('debounces multiple advances to only mark the latest seq', () => {
      const { rerender } = renderHook(
        ({ seq }: { seq: number }) =>
          useMarkSingleRunViewed({
            projectId: 'proj-1',
            runId: 'run-1',
            lastSeq: seq,
            lastViewedSeq: 5,
            visible: true,
            debounceMs: 1000,
          }),
        {
          initialProps: { seq: 10 },
          wrapper: createWrapper(queryClient),
        },
      )

      act(() => {
        vi.advanceTimersByTime(600)
      })
      expect(mockMutate).not.toHaveBeenCalled()

      // lastSeq advances to 15
      rerender({ seq: 15 })

      act(() => {
        vi.advanceTimersByTime(600)
      })
      // Previous timer was cancelled; new timer has not reached 1000ms yet
      expect(mockMutate).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(400)
      })
      expect(mockMutate).toHaveBeenCalledTimes(1)
      expect(mockMutate).toHaveBeenCalledWith({
        projectId: 'proj-1',
        runId: 'run-1',
        seq: 15,
      })
    })

    it('does not mark viewed when lastSeq has not advanced past lastViewedSeq', () => {
      renderHook(
        () =>
          useMarkSingleRunViewed({
            projectId: 'proj-1',
            runId: 'run-1',
            lastSeq: 5,
            lastViewedSeq: 5,
            visible: true,
          }),
        { wrapper: createWrapper(queryClient) },
      )

      act(() => {
        vi.advanceTimersByTime(1500)
      })
      expect(mockMutate).not.toHaveBeenCalled()
    })

    it('does not re-mark viewed for the same seq', () => {
      const { rerender } = renderHook(
        ({ seq }: { seq: number }) =>
          useMarkSingleRunViewed({
            projectId: 'proj-1',
            runId: 'run-1',
            lastSeq: seq,
            lastViewedSeq: 5,
            visible: true,
          }),
        {
          initialProps: { seq: 10 },
          wrapper: createWrapper(queryClient),
        },
      )

      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(mockMutate).toHaveBeenCalledTimes(1)

      // Re-render with same seq
      rerender({ seq: 10 })
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(mockMutate).toHaveBeenCalledTimes(1)
    })

    it('does not mark viewed when visible is false', () => {
      renderHook(
        () =>
          useMarkSingleRunViewed({
            projectId: 'proj-1',
            runId: 'run-1',
            lastSeq: 10,
            lastViewedSeq: 5,
            visible: false,
          }),
        { wrapper: createWrapper(queryClient) },
      )

      act(() => {
        vi.advanceTimersByTime(1500)
      })
      expect(mockMutate).not.toHaveBeenCalled()
    })

    it('does not mark viewed when document is hidden', () => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        configurable: true,
        writable: true,
      })

      renderHook(
        () =>
          useMarkSingleRunViewed({
            projectId: 'proj-1',
            runId: 'run-1',
            lastSeq: 10,
            lastViewedSeq: 5,
            visible: true,
          }),
        { wrapper: createWrapper(queryClient) },
      )

      act(() => {
        vi.advanceTimersByTime(1500)
      })
      expect(mockMutate).not.toHaveBeenCalled()
    })

    it('marks viewed once document becomes visible', () => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        configurable: true,
        writable: true,
      })

      renderHook(
        () =>
          useMarkSingleRunViewed({
            projectId: 'proj-1',
            runId: 'run-1',
            lastSeq: 10,
            lastViewedSeq: 5,
            visible: true,
            debounceMs: 1000,
          }),
        { wrapper: createWrapper(queryClient) },
      )

      act(() => {
        vi.advanceTimersByTime(1500)
      })
      expect(mockMutate).not.toHaveBeenCalled()

      // User returns to tab
      act(() => {
        Object.defineProperty(document, 'visibilityState', {
          value: 'visible',
          configurable: true,
          writable: true,
        })
        document.dispatchEvent(new Event('visibilitychange'))
      })

      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(mockMutate).toHaveBeenCalledTimes(1)
      expect(mockMutate).toHaveBeenCalledWith({
        projectId: 'proj-1',
        runId: 'run-1',
        seq: 10,
      })
    })

    it('cleans up timer on unmount', () => {
      const { unmount } = renderHook(
        () =>
          useMarkSingleRunViewed({
            projectId: 'proj-1',
            runId: 'run-1',
            lastSeq: 10,
            lastViewedSeq: 5,
            visible: true,
          }),
        { wrapper: createWrapper(queryClient) },
      )

      act(() => {
        vi.advanceTimersByTime(500)
      })
      unmount()

      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(mockMutate).not.toHaveBeenCalled()
    })
  })

  describe('useMarkViewed with workspace state', () => {
    it('marks active run pane viewed from workspace state', () => {
      const state: WorkspaceState = {
        navigator: {},
        threads: [
          { kind: 'run', paneId: 'run:p1:r1', projectId: 'p1', runId: 'r1' },
        ],
        active: 'run:p1:r1',
        split: 'none',
        context: { open: false },
      }

      renderHook(
        () =>
          useMarkViewed({
            projectId: 'p1',
            state,
            debounceMs: 1000,
          }),
        { wrapper: createWrapper(queryClient) },
      )

      act(() => {
        vi.advanceTimersByTime(1000)
      })

      // useRun mock returns lastSeq: 20, lastViewedSeq: 5
      expect(mockMutate).toHaveBeenCalledTimes(1)
      expect(mockMutate).toHaveBeenCalledWith({
        projectId: 'p1',
        runId: 'r1',
        seq: 20,
      })
    })

    it('marks both run panes viewed in desktop split mode', () => {
      const state: WorkspaceState = {
        navigator: {},
        threads: [
          { kind: 'run', paneId: 'run:p1:r1', projectId: 'p1', runId: 'r1' },
          { kind: 'run', paneId: 'run:p1:r2', projectId: 'p1', runId: 'r2' },
        ],
        active: 'run:p1:r1',
        split: { a: 'run:p1:r1', b: 'run:p1:r2' },
        context: { open: false },
      }

      renderHook(
        () =>
          useMarkViewed({
            projectId: 'p1',
            state,
            debounceMs: 1000,
          }),
        { wrapper: createWrapper(queryClient) },
      )

      act(() => {
        vi.advanceTimersByTime(1000)
      })

      expect(mockMutate).toHaveBeenCalledTimes(2)
      expect(mockMutate).toHaveBeenCalledWith({
        projectId: 'p1',
        runId: 'r1',
        seq: 20,
      })
      expect(mockMutate).toHaveBeenCalledWith({
        projectId: 'p1',
        runId: 'r2',
        seq: 20,
      })
    })
  })
})
