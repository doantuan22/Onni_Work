import { describe, expect, it, vi } from 'vitest'

import { decideUrlSync, navigateTaskWorkspace, taskWorkspacePath } from './url-sync'

describe('URL workspace synchronization', () => {
  it('opens an unknown deep-linked run as a tab before comparing selection', () => {
    expect(
      decideUrlSync({
        route: { runId: 'r-deep-link', view: 'changes' },
        effective: { runId: 'r-current', view: 'session' },
        openRunIds: ['r-current'],
      }),
    ).toBe('open tab')
  })

  it('does nothing when the route and effective selection already converge', () => {
    expect(
      decideUrlSync({
        route: { runId: 'r1', view: 'changes' },
        effective: { runId: 'r1', view: 'changes' },
        openRunIds: ['r1'],
      }),
    ).toBe('none')
  })

  it('pushes a run switch while replacing an internal context-view change', () => {
    const navigate = vi.fn()

    expect(
      navigateTaskWorkspace(navigate, {
        route: { runId: 'r1', view: 'changes' },
        effective: { runId: 'r2', view: 'files' },
        openRunIds: ['r1', 'r2'],
      }),
    ).toBe('push run')
    expect(navigate).toHaveBeenLastCalledWith('/tasks/r2/files')

    expect(
      navigateTaskWorkspace(navigate, {
        route: { runId: 'r2', view: 'files' },
        effective: { runId: 'r2', view: 'terminal' },
        openRunIds: ['r1', 'r2'],
      }),
    ).toBe('replace view')
    expect(navigate).toHaveBeenLastCalledWith('/tasks/r2/terminal', { replace: true })
  })

  it('keeps bookmark-compatible Chat and Preview suffixes', () => {
    expect(taskWorkspacePath({ runId: 'r 1', view: 'session' })).toBe('/tasks/r%201/chat')
    expect(taskWorkspacePath({ runId: 'r1', view: 'browser' })).toBe('/tasks/r1/preview')
  })
})
