import { beforeEach, describe, expect, it } from 'vitest'

import { recordSettingsReturn, resetSettingsReturn, settingsReturnLocation } from './settings-return'

const at = (pathname: string, search = '', hash = '') => ({ pathname, search, hash })

beforeEach(resetSettingsReturn)

describe('the settings return store', () => {
  it('starts empty — a cold load into settings has nothing to come back to', () => {
    expect(settingsReturnLocation()).toBeNull()
  })

  it('remembers the last NON-settings location, query and hash included', () => {
    recordSettingsReturn(at('/p/onni/tasks/run-1', '?tab=changes', '#file-3'))
    expect(settingsReturnLocation()).toEqual(at('/p/onni/tasks/run-1', '?tab=changes', '#file-3'))
  })

  it('ignores settings pages, so hopping between sections never moves the way back', () => {
    recordSettingsReturn(at('/p/onni/git'))
    recordSettingsReturn(at('/p/onni/settings/agents'))
    recordSettingsReturn(at('/settings/global/appearance'))
    recordSettingsReturn(at('/p/other/settings'))
    expect(settingsReturnLocation()).toEqual(at('/p/onni/git'))
  })

  it('the latest non-settings page wins', () => {
    recordSettingsReturn(at('/p/onni/git'))
    recordSettingsReturn(at('/p/other/skills'))
    expect(settingsReturnLocation()).toEqual(at('/p/other/skills'))
  })
})
