import { describe, expect, it } from 'vitest'

import { isSettingsPathname } from './settings-path'

describe('isSettingsPathname', () => {
  it.each([
    '/settings/global',
    '/settings/global/',
    '/settings/global/appearance',
    '/p/onni/settings',
    '/p/onni/settings/agents',
    '/p/default/settings/worktrees',
    // Legacy flat spellings — one frame before their redirect lands on a family above.
    '/settings',
    '/settings/agents',
    '/settings/skills',
  ])('%s is a settings page', (pathname) => {
    expect(isSettingsPathname(pathname)).toBe(true)
  })

  it.each([
    '/',
    '/p/onni/',
    '/p/onni/skills',
    '/p/onni/settingsfoo',
    '/settingsfoo',
    '/p/onni/tasks/run-1',
    '/new',
  ])('%s is not', (pathname) => {
    expect(isSettingsPathname(pathname)).toBe(false)
  })
})
