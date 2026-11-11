import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  RAIL_STORAGE_KEY_PREFIX,
  railIsCollapsed,
  railStorageKey,
  readStoredRailOverride,
  useRailState,
  writeStoredRailOverride,
} from './rail-state'

afterEach(() => { cleanup(); localStorage.clear() })

describe('navigator rail state', () => {
  it('stores a manual override per project under its own key', () => {
    const key = railStorageKey('shop')
    expect(key).toBe(`${RAIL_STORAGE_KEY_PREFIX}shop`)
    expect(key).not.toBe('onni-sidebar-width')

    writeStoredRailOverride('shop', 'collapsed')

    expect(readStoredRailOverride('shop')).toBe('collapsed')
    expect(readStoredRailOverride('other')).toBeNull()
  })

  it('ignores malformed persisted values', () => {
    localStorage.setItem(railStorageKey('shop'), 'open')
    expect(readStoredRailOverride('shop')).toBeNull()
  })

  it.each([
    [{ windowWidth: 1359, contentZoneCount: 1 }, true],
    [{ windowWidth: 1360, contentZoneCount: 4 }, true],
    [{ windowWidth: 1360, contentZoneCount: 3 }, false],
  ] as const)('auto-collapses only for the viewport or dense layout rule', (input, expected) => {
    expect(railIsCollapsed(input)).toBe(expected)
  })

  it('lets a manual choice override both automatic collapse conditions', () => {
    expect(railIsCollapsed({ windowWidth: 1200, contentZoneCount: 4, manualOverride: 'expanded' })).toBe(false)
    expect(railIsCollapsed({ windowWidth: 1600, contentZoneCount: 1, manualOverride: 'collapsed' })).toBe(true)
  })

  it('uses the new project override on the first render after a project change', () => {
    localStorage.setItem(railStorageKey('a'), 'collapsed')
    localStorage.setItem(railStorageKey('b'), 'expanded')
    const hook = renderHook(({ projectId }) => useRailState(projectId, 1), { initialProps: { projectId: 'a' } })
    expect(hook.result.current.collapsed).toBe(true)

    hook.rerender({ projectId: 'b' })

    expect(hook.result.current.manualOverride).toBe('expanded')
    expect(hook.result.current.collapsed).toBe(false)
  })
})
