import { describe, expect, it } from 'vitest'

import { closePaneWithNavigation } from './workspace-pane-navigation'
import { createWorkspaceState, openDraft, openRun } from './workspace-state'

describe('closePaneWithNavigation', () => {
  it('routes to the next active run when closing the active pane', () => {
    const initial = openRun(
      openRun(createWorkspaceState(), { kind: 'run', paneId: 'run:a', projectId: 'shop', runId: 'a' }),
      { kind: 'run', paneId: 'run:b', projectId: 'shop', runId: 'b' },
    )

    const result = closePaneWithNavigation(initial, 'run:b', 'shop / 1')

    expect(result.state.active).toBe('run:a')
    expect(result.path).toBe('/p/shop%20%2F%201/tasks/a')
  })

  it('routes to a remaining draft and leaves the URL alone for a background pane', () => {
    const withRun = openRun(
      openDraft(createWorkspaceState(), { kind: 'draft', paneId: 'draft:shop', projectId: 'shop', draftId: 'draft:shop' }),
      { kind: 'run', paneId: 'run:a', projectId: 'shop', runId: 'a' },
    )
    const closedRun = closePaneWithNavigation(withRun, 'run:a', 'shop')
    expect(closedRun.path).toBe('/p/shop/new')

    const background = openRun(withRun, { kind: 'run', paneId: 'run:b', projectId: 'shop', runId: 'b' })
    expect(closePaneWithNavigation(background, 'run:a', 'shop').path).toBeUndefined()
  })
})
