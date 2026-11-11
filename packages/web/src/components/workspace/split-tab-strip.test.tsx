import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { createWorkspaceState, enableSplit, openRun, type WorkspaceState } from '@/lib/workspace-state'

import { SplitTabStrip, splitTabId } from './split-tab-strip'

afterEach(cleanup)

const runA = { kind: 'run' as const, paneId: 'run:shop:a', projectId: 'shop', runId: 'a' }
const runB = { kind: 'run' as const, paneId: 'run:shop:b', projectId: 'shop', runId: 'b' }

function initialState(): WorkspaceState {
  return {
    ...enableSplit(openRun(openRun(createWorkspaceState(), runA), runB), runA.paneId, runB.paneId),
    active: runA.paneId,
  }
}

function ControlledStrip() {
  const [state, setState] = useState(initialState)
  return (
    <>
      <SplitTabStrip
        state={state}
        onActivate={(paneId) => setState((current) => ({ ...current, active: paneId }))}
        onClose={() => {}}
        onUnsplit={() => {}}
      />
      {state.threads.map((pane) => (
        <section key={pane.paneId} id={pane.paneId} role="tabpanel" aria-labelledby={splitTabId(pane.paneId)}>
          {pane.paneId}
        </section>
      ))}
    </>
  )
}

describe('SplitTabStrip', () => {
  it('supports roving keyboard tab navigation and links each tab to its panel', () => {
    render(<ControlledStrip />)
    const tablist = screen.getByRole('tablist', { name: 'Split conversation panes' })
    const tabs = within(tablist).getAllByRole('tab')
    expect(tabs[0]?.getAttribute('tabindex')).toBe('0')
    expect(tabs[1]?.getAttribute('tabindex')).toBe('-1')

    for (const tab of tabs) {
      const panelId = tab.getAttribute('aria-controls')
      expect(panelId).toBeTruthy()
      expect(document.getElementById(panelId!)?.getAttribute('role')).toBe('tabpanel')
      expect(document.getElementById(panelId!)?.getAttribute('aria-labelledby')).toBe(tab.id)
    }

    fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight' })
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true')
    expect(tabs[1]?.getAttribute('tabindex')).toBe('0')
    expect(document.activeElement).toBe(tabs[1])

    fireEvent.keyDown(tabs[1]!, { key: 'Home' })
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabs[0])

    fireEvent.keyDown(tabs[0]!, { key: 'End' })
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabs[1])

    fireEvent.keyDown(tabs[1]!, { key: 'ArrowLeft' })
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabs[0])
  })

  it('keeps close actions outside the tab buttons', () => {
    render(<ControlledStrip />)
    const tablist = screen.getByRole('tablist', { name: 'Split conversation panes' })
    for (const tab of within(tablist).getAllByRole('tab')) {
      expect(tab.querySelector('button')).toBeNull()
    }
    expect(screen.getByRole('button', { name: 'Close a' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Close b' })).toBeDefined()
  })
})
