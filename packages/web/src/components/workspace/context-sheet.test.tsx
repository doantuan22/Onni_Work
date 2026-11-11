import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ContextSheet } from './context-sheet'

const HOST_VIEWS = ['changes', 'files', 'files-tree', 'editor'] as const

afterEach(() => {
  cleanup()
})

describe('ContextSheet', () => {
  it('does not render content when open is false', () => {
    render(
      <ContextSheet open={false} onOpenChange={vi.fn()} title="Task 1" views={HOST_VIEWS}>
        <div data-testid="context-child">Child Content</div>
      </ContextSheet>,
    )

    expect(screen.queryByTestId('context-child')).toBeNull()
    expect(document.querySelector('[data-slot="context-sheet"]')).toBeNull()
  })

  it('renders full-screen sheet with title, default tabs, and content when open is true', () => {
    render(
      <ContextSheet open={true} onOpenChange={vi.fn()} title="Task 1" views={HOST_VIEWS}>
        <div data-testid="context-child">Child Content</div>
      </ContextSheet>,
    )

    const sheet = document.querySelector('[data-slot="context-sheet"]')
    expect(sheet).not.toBeNull()
    expect(sheet?.className).toContain('fixed')
    expect(sheet?.className).toContain('inset-0')

    expect(screen.getByText(/Task 1/)).toBeDefined()
    expect(screen.getByTestId('context-child')).toBeDefined()

    const tablist = screen.getByRole('tablist', { name: /context views/i })
    expect(tablist).toBeDefined()

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(HOST_VIEWS.length)
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true')
  })

  it('switches tabs and calls onViewChange when a tab is clicked', () => {
    const handleViewChange = vi.fn()
    render(
      <ContextSheet
        open={true}
        onOpenChange={vi.fn()}
        title="Task 1"
        views={HOST_VIEWS}
        activeView="changes"
        onViewChange={handleViewChange}
        renderContent={(view) => <div data-testid="rendered-view">{view}</div>}
      />,
    )

    expect(screen.getByTestId('rendered-view').textContent).toBe('changes')

    const filesTab = screen.getByRole('tab', { name: /^Files$/ })
    fireEvent.click(filesTab)

    expect(handleViewChange).toHaveBeenCalledWith('files')
  })

  it('calls onOpenChange(false) when the close button is clicked', () => {
    const handleOpenChange = vi.fn()
    render(
      <ContextSheet open={true} onOpenChange={handleOpenChange} title="Task 1" views={HOST_VIEWS}>
        <div>Content</div>
      </ContextSheet>,
    )

    const closeButton = screen.getByRole('button', { name: /close/i })
    fireEvent.click(closeButton)

    expect(handleOpenChange).toHaveBeenCalledWith(false)
  })

  it('renders custom view list when provided', () => {
    render(
      <ContextSheet
        open={true}
        onOpenChange={vi.fn()}
        title="Task 1"
        views={['changes', 'terminal']}
      >
        <div>Content</div>
      </ContextSheet>,
    )

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    expect(screen.getByRole('tab', { name: /changes/i })).toBeDefined()
    expect(screen.getByRole('tab', { name: /terminal/i })).toBeDefined()
  })

  it('renders host-provided Workbench views and exposes a keyboard-operable tab panel', () => {
    const onViewChange = vi.fn()
    render(
      <ContextSheet
        open
        onOpenChange={vi.fn()}
        views={HOST_VIEWS}
        activeView="changes"
        onViewChange={onViewChange}
        renderContent={(view) => <span>{view}</span>}
      />,
    )

    const treeTab = screen.getByRole('tab', { name: /files tree/i })
    const editorTab = screen.getByRole('tab', { name: /editor/i })
    expect(treeTab).toBeTruthy()
    expect(editorTab).toBeTruthy()

    const panel = screen.getByRole('tabpanel')
    expect(treeTab.getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.getAttribute('aria-labelledby')).toBe(screen.getByRole('tab', { name: /changes/i }).id)

    const changesTab = screen.getByRole('tab', { name: /changes/i })
    changesTab.focus()
    fireEvent.keyDown(changesTab, { key: 'ArrowRight' })
    expect(onViewChange).toHaveBeenLastCalledWith('files')
    const filesTab = screen.getByRole('tab', { name: /^Files$/ })
    expect(document.activeElement).toBe(filesTab)

    fireEvent.keyDown(filesTab, { key: 'End' })
    expect(onViewChange).toHaveBeenLastCalledWith('editor')
    expect(document.activeElement).toBe(editorTab)
    fireEvent.keyDown(editorTab, { key: 'Home' })
    expect(onViewChange).toHaveBeenLastCalledWith('changes')
    expect(document.activeElement).toBe(changesTab)
  })
})
