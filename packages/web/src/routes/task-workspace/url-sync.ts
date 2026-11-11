import type { ViewId } from './layout-state'

/** The selection represented by a task route, before any workspace state is applied. */
export interface TaskRouteSelection {
  runId: string
  view?: ViewId
}

/** The workspace selection a local layout interaction is trying to make active. */
export interface EffectiveTaskSelection {
  runId: string
  view?: ViewId
}

export type UrlSyncAction = 'none' | 'push run' | 'replace view' | 'open tab'

export interface UrlSyncInput {
  route: TaskRouteSelection
  effective: EffectiveTaskSelection
  openRunIds: readonly string[]
}

/**
 * The route pair is the only URL input. Route-only visits first enter the workspace; local
 * selection changes then choose the history operation that makes the route catch up.
 */
export function decideUrlSync({ route, effective, openRunIds }: UrlSyncInput): UrlSyncAction {
  if (!openRunIds.includes(route.runId)) return 'open tab'
  if (route.runId !== effective.runId) return 'push run'
  if (route.view !== effective.view) return 'replace view'
  return 'none'
}

export function taskWorkspacePath({ runId, view }: TaskRouteSelection): string {
  const suffix = view === undefined ? '' : view === 'session' ? '/chat' : view === 'browser' ? '/preview' : `/${view}`
  return `/tasks/${encodeURIComponent(runId)}${suffix}`
}

export type TaskWorkspaceNavigate = (to: string, options?: { replace?: boolean }) => void

/** The sole local navigation policy: runs extend history, context subviews replace it. */
export function navigateTaskWorkspace(
  navigate: TaskWorkspaceNavigate,
  input: UrlSyncInput,
): UrlSyncAction {
  const action = decideUrlSync(input)
  if (action === 'push run') navigate(taskWorkspacePath(input.effective))
  if (action === 'replace view') navigate(taskWorkspacePath(input.effective), { replace: true })
  return action
}
