import { useContext, useEffect, useRef, useState } from 'react'
import { QueryClientContext } from '@tanstack/react-query'

import { useRun } from '@/api/queries'
import { useMarkRunViewed, type ThreadRunRecord } from '@/api/workspace-threads'
import { useIsDesktop } from '@/lib/use-desktop'
import type { WorkspaceState } from '@/lib/workspace-state'

const SIDE_BY_SIDE_MIN_WIDTH = 1024

export interface MarkViewedTarget {
  kind: string
  runId?: string
}

export interface SingleRunMarkViewedOptions {
  projectId: string
  runId?: string
  lastSeq?: number
  lastViewedSeq?: number
  visible?: boolean
  debounceMs?: number
}

export interface UseMarkViewedOptions {
  projectId: string
  runId?: string
  lastSeq?: number
  lastViewedSeq?: number
  visible?: boolean
  debounceMs?: number
  state?: WorkspaceState
  target?: MarkViewedTarget
}

/**
 * Extract up to 2 visible conversation run IDs from workspace state.
 * On desktop (>= 1024px), split mode renders two panes side by side.
 * Below 1024px, only the active pane is visible.
 */
export function getVisibleRunIds(
  state?: WorkspaceState,
  target?: MarkViewedTarget,
  isDesktop = true,
): string[] {
  if (!state) {
    if (target?.kind === 'run' && target.runId) return [target.runId]
    return []
  }

  const split = state.split
  const isSplit = split !== 'none'
  const paneA = isSplit ? state.threads.find((t) => t.paneId === split.a) : undefined
  const paneB = isSplit ? state.threads.find((t) => t.paneId === split.b) : undefined
  const splitValid =
    isSplit &&
    paneA !== undefined &&
    paneB !== undefined &&
    (state.active === paneA.paneId || state.active === paneB.paneId)

  if (splitValid && paneA && paneB) {
    if (isDesktop) {
      const ids: string[] = []
      if (paneA.kind === 'run') ids.push(paneA.runId)
      if (paneB.kind === 'run') ids.push(paneB.runId)
      return ids
    }
    const activePaneRef = state.active === paneB.paneId ? paneB : paneA
    return activePaneRef.kind === 'run' ? [activePaneRef.runId] : []
  }

  const pane = state.threads.find((t) => t.paneId === state.active)
  if (pane?.kind === 'run') {
    return [pane.runId]
  }
  if (target?.kind === 'run' && target.runId) {
    return [target.runId]
  }
  return []
}

/**
 * Track and mark viewed sequence for a single run pane.
 * While the pane is visible and the document is visible, debounces ~1s before
 * committing the viewed sequence to the server via `useMarkRunViewed`.
 */
export function useMarkSingleRunViewed({
  projectId,
  runId,
  lastSeq: explicitLastSeq,
  lastViewedSeq: explicitLastViewedSeq,
  visible = true,
  debounceMs = 1000,
}: SingleRunMarkViewedOptions) {
  const shouldQuery = Boolean(runId && explicitLastSeq === undefined)
  const runQuery = useRun(shouldQuery ? runId : undefined)

  const currentLastSeq = explicitLastSeq ?? runQuery.data?.lastSeq
  const currentLastViewedSeq = explicitLastViewedSeq ?? (runQuery.data as ThreadRunRecord | undefined)?.lastViewedSeq

  const markRunViewed = useMarkRunViewed()
  const lastMarkedSeqRef = useRef(new Map<string, number>())
  const watermarkKey = JSON.stringify([projectId, runId])

  const [isDocVisible, setIsDocVisible] = useState(() =>
    typeof document !== 'undefined' ? document.visibilityState === 'visible' : true,
  )

  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisibilityChange = () => {
      setIsDocVisible(document.visibilityState === 'visible')
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  useEffect(() => {
    if (!visible || !isDocVisible || !runId || !projectId) return
    if (typeof currentLastSeq !== 'number' || currentLastSeq <= 0) return

    const knownViewed = currentLastViewedSeq ?? 0
    if (currentLastSeq <= knownViewed || currentLastSeq <= (lastMarkedSeqRef.current.get(watermarkKey) ?? 0)) {
      return
    }

    const timer = setTimeout(() => {
      const stillDocVisible = typeof document !== 'undefined' ? document.visibilityState === 'visible' : true
      if (!stillDocVisible) return

      lastMarkedSeqRef.current.set(watermarkKey, currentLastSeq)
      markRunViewed.mutate({
        projectId,
        runId,
        seq: currentLastSeq,
      })
    }, debounceMs)

    return () => {
      clearTimeout(timer)
    }
  }, [
    visible,
    isDocVisible,
    projectId,
    runId,
    watermarkKey,
    currentLastSeq,
    currentLastViewedSeq,
    debounceMs,
    markRunViewed,
  ])
}

/**
 * Top-level workspace hook to mark visible run panes viewed.
 * Accepts either explicit runId/lastSeq options or a workspace state + target pair.
 */
export function useMarkViewed(options: UseMarkViewedOptions) {
  const queryClient = useContext(QueryClientContext)
  if (!queryClient) return

  return useMarkViewedWithClient(options)
}

function useMarkViewedWithClient(options: UseMarkViewedOptions) {
  const isDesktop = useIsDesktop(SIDE_BY_SIDE_MIN_WIDTH)

  const visibleRunIds = options.runId
    ? [options.runId]
    : getVisibleRunIds(options.state, options.target, isDesktop)

  const runId1 = visibleRunIds[0]
  const runId2 = visibleRunIds[1]

  useMarkSingleRunViewed({
    projectId: options.projectId,
    runId: runId1,
    lastSeq: options.runId ? options.lastSeq : undefined,
    lastViewedSeq: options.runId ? options.lastViewedSeq : undefined,
    visible: options.visible !== false && Boolean(runId1),
    debounceMs: options.debounceMs,
  })

  useMarkSingleRunViewed({
    projectId: options.projectId,
    runId: runId2,
    visible: options.visible !== false && Boolean(runId2),
    debounceMs: options.debounceMs,
  })
}
