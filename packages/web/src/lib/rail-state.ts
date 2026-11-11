import * as React from 'react'

/** The navigator rail is deliberately independent from the resizable sidebar width preference. */
export const RAIL_STORAGE_KEY_PREFIX = 'onni-sidebar-rail:'
export const RAIL_WIDTH = 55
export const RAIL_COLLAPSE_MEDIA_QUERY = '(max-width: 1359px)'
export const TOGGLE_NAVIGATOR_EVENT = 'onni:toggle-navigator'

export function toggleNavigatorRail(projectId?: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(TOGGLE_NAVIGATOR_EVENT, { detail: { projectId } }))
}

export type RailManualOverride = 'collapsed' | 'expanded'

export function railStorageKey(projectId: string): string {
  return `${RAIL_STORAGE_KEY_PREFIX}${projectId}`
}

export function readStoredRailOverride(projectId: string): RailManualOverride | null {
  try {
    const value = window.localStorage.getItem(railStorageKey(projectId))
    return value === 'collapsed' || value === 'expanded' ? value : null
  } catch {
    // A blocked localStorage must still leave a usable, auto-sized navigator.
    return null
  }
}

export function writeStoredRailOverride(projectId: string, value: RailManualOverride): void {
  try {
    window.localStorage.setItem(railStorageKey(projectId), value)
  } catch {
    // localStorage is a convenience, not a prerequisite for the cockpit.
  }
}

export function railIsCollapsed({
  windowWidth,
  contentZoneCount,
  manualOverride = null,
}: {
  windowWidth: number
  contentZoneCount: number
  manualOverride?: RailManualOverride | null
}): boolean {
  if (manualOverride !== null) return manualOverride === 'collapsed'
  return windowWidth < 1360 || contentZoneCount >= 4
}

function useNarrowRailViewport(): boolean {
  const getSnapshot = React.useCallback(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(RAIL_COLLAPSE_MEDIA_QUERY).matches
  }, [])

  return React.useSyncExternalStore(
    (listener) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => undefined
      const media = window.matchMedia(RAIL_COLLAPSE_MEDIA_QUERY)
      media.addEventListener('change', listener)
      return () => media.removeEventListener('change', listener)
    },
    getSnapshot,
    () => false,
  )
}

/** The project-scoped manual choice wins over changing viewport and pane density. */
export function useRailState(projectId: string, contentZoneCount: number) {
  const [manualOverride, setManualOverride] = React.useState<RailManualOverride | null>(() =>
    typeof window === 'undefined' ? null : readStoredRailOverride(projectId),
  )
  const narrowViewport = useNarrowRailViewport()

  React.useEffect(() => {
    setManualOverride(readStoredRailOverride(projectId))
  }, [projectId])

  const collapsed = railIsCollapsed({
    windowWidth: narrowViewport ? 1359 : 1360,
    contentZoneCount,
    manualOverride,
  })
  const toggle = React.useCallback(() => {
    const next: RailManualOverride = collapsed ? 'expanded' : 'collapsed'
    writeStoredRailOverride(projectId, next)
    setManualOverride(next)
  }, [collapsed, projectId])

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const onToggle = (event: Event) => {
      const custom = event as CustomEvent<{ projectId?: string } | undefined>
      const targetProject = custom.detail?.projectId
      if (!targetProject || targetProject === projectId) {
        toggle()
      }
    }
    window.addEventListener(TOGGLE_NAVIGATOR_EVENT, onToggle)
    return () => window.removeEventListener(TOGGLE_NAVIGATOR_EVENT, onToggle)
  }, [projectId, toggle])

  return { collapsed, manualOverride, toggle }
}
