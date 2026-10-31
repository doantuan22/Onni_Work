import { beforeEach, describe, expect, it } from 'vitest'

import {
  NEW_TASK_PANEL_OPEN_KEY,
  readPanelOpen,
  writePanelOpen,
} from './new-task-panel-state'

describe('the /new Task settings panel collapse preference', () => {
  beforeEach(() => localStorage.clear())

  it('is OPEN by default, so the run settings are never hidden behind a fold', () => {
    expect(readPanelOpen()).toBe(true)
  })

  it('remembers a collapse and an explicit re-open', () => {
    writePanelOpen(false)
    expect(localStorage.getItem(NEW_TASK_PANEL_OPEN_KEY)).toBe('0')
    expect(readPanelOpen()).toBe(false)
    writePanelOpen(true)
    expect(readPanelOpen()).toBe(true)
  })

  it('treats junk as the safe default (open) instead of crashing', () => {
    localStorage.setItem(NEW_TASK_PANEL_OPEN_KEY, '{"not":"a boolean"}')
    expect(readPanelOpen()).toBe(true)
  })
})
