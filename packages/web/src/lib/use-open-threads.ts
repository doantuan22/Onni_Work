import { useCallback, useMemo } from 'react'

import { closePane as closeWorkspacePane, useWorkspaceState } from '@/lib/workspace-state'

/** The Navigator view of the current project's open workspace threads. */
export function useOpenThreads(projectId: string) {
  const { state, update } = useWorkspaceState(projectId)
  const openRunIds = useMemo(
    () => new Set(state.threads.flatMap((pane) => pane.kind === 'run' ? [pane.runId] : [])),
    [state.threads],
  )
  const draftOpen = state.threads.some((pane) => pane.kind === 'draft')
  const closePane = useCallback(
    (paneId: string) => update((current) => closeWorkspacePane(current, paneId)),
    [update],
  )
  const closeRun = useCallback(
    (runId: string) => {
      const pane = state.threads.find((item) => item.kind === 'run' && item.runId === runId)
      if (pane) closePane(pane.paneId)
    },
    [closePane, state.threads],
  )
  const closeDraft = useCallback(() => {
    const pane = state.threads.find((item) => item.kind === 'draft')
    if (pane) closePane(pane.paneId)
  }, [closePane, state.threads])

  return { openRunIds, draftOpen, closeRun, closeDraft }
}
