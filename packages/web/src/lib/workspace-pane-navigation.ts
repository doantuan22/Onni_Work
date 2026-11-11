import { closePane, type PaneId, type WorkspaceState } from './workspace-state'

/** Close a pane and resolve the route for the pane selected by the shared closePane transition. */
export function closePaneWithNavigation(
  state: WorkspaceState,
  paneId: PaneId,
  projectId: string,
): { state: WorkspaceState; path?: string } {
  const next = closePane(state, paneId)
  if (state.active !== paneId || !next.active) return { state: next }
  const active = next.threads.find((pane) => pane.paneId === next.active)
  if (active?.kind === 'run') {
    return { state: next, path: `/p/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(active.runId)}` }
  }
  if (active?.kind === 'draft') return { state: next, path: `/p/${encodeURIComponent(projectId)}/new` }
  return { state: next }
}
