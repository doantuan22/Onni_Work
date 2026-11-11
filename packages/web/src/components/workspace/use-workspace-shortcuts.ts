import * as React from 'react'

import { chordFromEvent, WORKSPACE_RESERVED_CHORDS } from '@/lib/keybindings'
import { useNavigate } from '@/lib/project-router'
import { toggleNavigatorRail } from '@/lib/rail-state'
import { setActive, useWorkspaceState, type WorkspaceState } from '@/lib/workspace-state'
import { toggleDrawerState } from '@/routes/task-workspace/drawer-state'

import { paneShortcutAllowed, useActivePane, type ActivePaneContextValue } from './active-pane-context'

export interface UseWorkspaceShortcutsOptions {
  projectId: string
  state?: WorkspaceState
  update?: (reducer: (current: WorkspaceState) => WorkspaceState) => void
  activePane?: ActivePaneContextValue
  navigate?: (to: string) => void
}

/**
 * Workspace chords yield to typing, xterm, and surfaces that own keyboard focus (dialogs, menus, listboxes).
 */
export function workspaceShortcutAllowed(target: EventTarget | null, root: ParentNode = document): boolean {
  if (!paneShortcutAllowed(target, root)) return false
  if (root.querySelector('[role="listbox"]') !== null) return false
  return true
}

export function useWorkspaceShortcuts(options: UseWorkspaceShortcutsOptions): void {
  const { projectId } = options
  const defaultWorkspace = useWorkspaceState(projectId)
  const defaultActivePane = useActivePane()
  const defaultNavigate = useNavigate()

  const state = options.state ?? defaultWorkspace.state
  const update = options.update ?? defaultWorkspace.update
  const activePane = options.activePane ?? defaultActivePane
  const navigate = options.navigate ?? defaultNavigate

  const latestRef = React.useRef({ state, update, activePane, navigate, projectId })
  React.useLayoutEffect(() => {
    latestRef.current = { state, update, activePane, navigate, projectId }
  })

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return
      if (!workspaceShortcutAllowed(event.target)) return

      const chord = chordFromEvent(event)
      if (!chord) return

      const { state, update, activePane, navigate, projectId } = latestRef.current

      // 1. Switch to Nth open thread: Alt+1..9
      for (let i = 1; i <= 9; i++) {
        if (chord === WORKSPACE_RESERVED_CHORDS[`workspace:switch-pane:${i}`]) {
          const index = i - 1
          const targetPane = state.threads[index]
          if (targetPane) {
            event.preventDefault()
            activePane?.setActive(targetPane.paneId)
            update((current) => setActive(current, targetPane.paneId))
            if (targetPane.kind === 'run') {
              void navigate(`/p/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(targetPane.runId)}`)
            } else if (targetPane.kind === 'draft') {
              void navigate(`/p/${encodeURIComponent(projectId)}/new`)
            }
          }
          return
        }
      }

      // 2. Toggle navigator: Mod+Alt+Left
      if (chord === WORKSPACE_RESERVED_CHORDS['workspace:toggle-navigator']) {
        event.preventDefault()
        toggleNavigatorRail(projectId)
        return
      }

      // 3. Toggle context area: Mod+Alt+Right
      if (chord === WORKSPACE_RESERVED_CHORDS['workspace:toggle-context']) {
        event.preventDefault()
        update((current) => {
          const activeRef = current.threads.find((t) => t.paneId === current.active)
          if (activeRef?.kind === 'draft') return current
          return {
            ...current,
            context: {
              ...current.context,
              open: !current.context.open,
            },
          }
        })
        return
      }

      // 4. Toggle terminal drawer: Mod+Alt+Down
      if (chord === WORKSPACE_RESERVED_CHORDS['workspace:toggle-terminal']) {
        event.preventDefault()
        const activeRef = state.threads.find((t) => t.paneId === state.active)
        const taskId = activeRef?.kind === 'run' ? activeRef.runId : undefined
        toggleDrawerState(taskId)
        return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
