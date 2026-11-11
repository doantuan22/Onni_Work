import * as React from 'react'

import { shortcutsBlocked } from '@/lib/keybindings'
import { isEditableTarget } from '@/lib/use-command-shortcut'

export interface ActivePaneContextValue {
  activePaneId: string | null
  setActive: (paneId: string) => void
}

const ActivePaneContext = React.createContext<ActivePaneContextValue | null>(null)

export function ActivePaneProvider({
  children,
  initialActivePaneId = null,
}: {
  children: React.ReactNode
  initialActivePaneId?: string | null
}) {
  const [activePaneId, setActivePaneId] = React.useState<string | null>(initialActivePaneId)
  const setActive = React.useCallback((paneId: string) => setActivePaneId(paneId), [])
  const value = React.useMemo(() => ({ activePaneId, setActive }), [activePaneId, setActive])
  return <ActivePaneContext.Provider value={value}>{children}</ActivePaneContext.Provider>
}

export function useActivePane(): ActivePaneContextValue {
  const context = React.useContext(ActivePaneContext)
  if (!context) throw new Error('useActivePane must be used within ActivePaneProvider')
  return context
}

/** Pane activation is explicit: pointer-down, a tab click, or a keyboard shortcut — never hover or wheel. */
export function activatePaneFromPointerDown(setActive: ActivePaneContextValue['setActive'], paneId: string): void {
  setActive(paneId)
}

export function activatePaneFromTabClick(setActive: ActivePaneContextValue['setActive'], paneId: string): void {
  setActive(paneId)
}

export function activatePaneFromShortcut(setActive: ActivePaneContextValue['setActive'], paneId: string): void {
  setActive(paneId)
}

/** Pane-local chords yield to typing, xterm, and surfaces that already own the keyboard. */
export function paneShortcutAllowed(target: EventTarget | null, root: ParentNode = document): boolean {
  if (isEditableTarget(target)) return false
  if (target instanceof HTMLElement && target.closest('.xterm')) return false
  return !shortcutsBlocked(root)
}
