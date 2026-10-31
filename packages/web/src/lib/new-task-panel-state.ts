/**
 * Whether the `/new` Task settings panel is open — per BROWSER, like the sidebar's collapse
 * state (`sidebar-collapse.ts`). Which column you keep open is a property of the window you are
 * sitting at, not of the workspace, so it belongs in localStorage and not in `ui-state.json`.
 *
 * Default: OPEN. The panel is where every run setting now lives; opening `/new` with it folded
 * away would hide the safe default (isolated worktree) from the person about to start a run.
 */

export const NEW_TASK_PANEL_OPEN_KEY = 'onni-new-task-panel-open'

/** The width below which the panel becomes a drawer. One constant, shared by the CSS and tests. */
export const NEW_TASK_PANEL_BREAKPOINT_PX = 1100

export function readPanelOpen(): boolean {
  try {
    const raw = localStorage.getItem(NEW_TASK_PANEL_OPEN_KEY)
    // Absent is the default (open), never "collapsed": see the module comment.
    if (raw === null) return true
    return raw !== '0' && raw !== 'false'
  } catch {
    // Private mode / storage disabled — the in-memory state still works this session.
    return true
  }
}

export function writePanelOpen(open: boolean): void {
  try {
    localStorage.setItem(NEW_TASK_PANEL_OPEN_KEY, open ? '1' : '0')
  } catch {
    // The panel still collapses for this page.
  }
}
