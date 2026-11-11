import { useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router'

import { closePane as closeWorkspacePane, useWorkspaceState } from '@/lib/workspace-state'
import { closePaneWithNavigation } from '@/lib/workspace-pane-navigation'

/** The Navigator view of the current project's open workspace threads. */
export function useOpenThreads(projectId: string) {
  const { state, update } = useWorkspaceState(projectId)
  const navigate = useNavigate()
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
      if (pane) {
        update((current) => {
          const result = closePaneWithNavigation(current, pane.paneId, projectId)
          if (result.path) void navigate(result.path)
          return result.state
        })
      }
    },
    [navigate, projectId, state.threads, update],
  )
  const closeDraft = useCallback(() => {
    const pane = state.threads.find((item) => item.kind === 'draft')
    if (pane) closePane(pane.paneId)
  }, [closePane, state.threads])

  return { openRunIds, draftOpen, closeRun, closeDraft }
}
