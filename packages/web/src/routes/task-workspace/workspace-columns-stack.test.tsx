import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

let isDesktopValue = true
vi.mock('@/lib/use-desktop', () => ({ useIsDesktop: () => isDesktopValue }))

import { WorkspaceColumns, type ColumnActions } from './workspace-columns'
import { setStackRatio, type WorkspaceColumn, type WorkspaceLayout } from './layout-state'

afterEach(cleanup)
beforeEach(() => {
  isDesktopValue = true
})

function defaultActions(overrides: Partial<ColumnActions> = {}): ColumnActions {
  return {
    addColumn: vi.fn(),
    closeColumn: vi.fn(),
    setColumnView: vi.fn(),
    resizeColumns: vi.fn(),
    moveColumn: vi.fn(),
    setStackRatio: vi.fn(),
    ...overrides,
  }
}

describe('WorkspaceColumns vertical stack rendering', () => {
  it('renders a column without stack exactly as a single view without vertical separator', () => {
    const columns: WorkspaceColumn[] = [{ view: 'session', width: 100 }]
    render(
      <WorkspaceColumns
        columns={columns}
        actions={defaultActions()}
        renderView={(view) => <div data-testid={`view-${view}`}>Content of {view}</div>}
      />,
    )

    expect(screen.getByTestId('view-session')).toBeDefined()
    expect(screen.queryByRole('separator')).toBeNull()
  })

  it('renders stacked column as two views stacked vertically using VerticalSplit with default ratio 58', () => {
    const columns: WorkspaceColumn[] = [
      { view: 'terminal', width: 100, stack: 'browser' },
    ]
    render(
      <WorkspaceColumns
        columns={columns}
        actions={defaultActions()}
        renderView={(view) => <div data-testid={`view-${view}`}>Content of {view}</div>}
      />,
    )

    expect(screen.getByTestId('view-terminal')).toBeDefined()
    expect(screen.getByTestId('view-browser')).toBeDefined()

    const separator = screen.getByRole('separator', { name: 'Resize Terminal and Preview panels' })
    expect(separator.getAttribute('aria-orientation')).toBe('horizontal')
    expect(separator.getAttribute('aria-valuenow')).toBe('58')
    expect(separator.getAttribute('aria-valuemin')).toBe('15')
    expect(separator.getAttribute('aria-valuemax')).toBe('85')
  })

  it('respects custom stackRatio on the column', () => {
    const columns: WorkspaceColumn[] = [
      { view: 'terminal', width: 100, stack: 'browser', stackRatio: 70 },
    ]
    render(
      <WorkspaceColumns
        columns={columns}
        actions={defaultActions()}
        renderView={(view) => <div data-testid={`view-${view}`}>Content of {view}</div>}
      />,
    )

    const separator = screen.getByRole('separator')
    expect(separator.getAttribute('aria-valuenow')).toBe('70')
  })

  it('dispatches update to actions.setStackRatio on keyboard adjustment and persists via setStackRatio action', () => {
    const initialLayout: WorkspaceLayout = {
      name: 'Workbench',
      columns: [{ view: 'terminal', width: 100, stack: 'browser', stackRatio: 58 }],
    }
    const setStackRatioSpy = vi.fn()

    function ControlledWorkspace() {
      const [layout, setLayout] = useState(initialLayout)
      const actions = defaultActions({
        setStackRatio: (index, ratio) => {
          setStackRatioSpy(index, ratio)
          setLayout((current) => setStackRatio(current, index, ratio))
        },
      })
      return (
        <WorkspaceColumns
          columns={layout.columns}
          actions={actions}
          renderView={(view) => <div>{view}</div>}
        />
      )
    }

    render(<ControlledWorkspace />)

    const separator = screen.getByRole('separator')
    // ArrowDown increases top height ratio (step 2): 58 -> 60
    fireEvent.keyDown(separator, { key: 'ArrowDown' })
    expect(setStackRatioSpy).toHaveBeenLastCalledWith(0, 60)
    expect(separator.getAttribute('aria-valuenow')).toBe('60')

    // ArrowUp with shift decreases top height ratio (large step 10): 60 -> 50
    fireEvent.keyDown(separator, { key: 'ArrowUp', shiftKey: true })
    expect(setStackRatioSpy).toHaveBeenLastCalledWith(0, 50)
    expect(separator.getAttribute('aria-valuenow')).toBe('50')

    // Home clamps to min (15)
    fireEvent.keyDown(separator, { key: 'Home' })
    expect(setStackRatioSpy).toHaveBeenLastCalledWith(0, 15)
    expect(separator.getAttribute('aria-valuenow')).toBe('15')

    // End clamps to max (85)
    fireEvent.keyDown(separator, { key: 'End' })
    expect(setStackRatioSpy).toHaveBeenLastCalledWith(0, 85)
    expect(separator.getAttribute('aria-valuenow')).toBe('85')
  })

  it('resets stack ratio to default 58 on double click', () => {
    const setStackRatioMock = vi.fn()
    const actions = defaultActions({ setStackRatio: setStackRatioMock })
    render(
      <WorkspaceColumns
        columns={[{ view: 'terminal', width: 100, stack: 'browser', stackRatio: 75 }]}
        actions={actions}
        renderView={(view) => <div>{view}</div>}
      />,
    )

    const separator = screen.getByRole('separator')
    fireEvent.doubleClick(separator)
    expect(setStackRatioMock).toHaveBeenCalledWith(0, 58)
  })

  it('handles multi-column layout with unstacked and stacked columns', () => {
    const setStackRatioMock = vi.fn()
    const actions = defaultActions({ setStackRatio: setStackRatioMock })
    const columns: WorkspaceColumn[] = [
      { view: 'session', width: 50 },
      { view: 'terminal', width: 50, stack: 'browser', stackRatio: 58 },
    ]

    render(
      <WorkspaceColumns
        columns={columns}
        actions={actions}
        renderView={(view, index) => <div data-testid={`col-${index}-${view}`}>{view}</div>}
      />,
    )

    expect(screen.getByTestId('col-0-session')).toBeDefined()
    expect(screen.getByTestId('col-1-terminal')).toBeDefined()
    expect(screen.getByTestId('col-1-browser')).toBeDefined()

    // There should be two separators: one vertical ColumnDivider between cols, one horizontal VerticalSplit inside col 1
    const separators = screen.getAllByRole('separator')
    expect(separators).toHaveLength(2)

    const horizontalSeparator = separators.find((sep) => sep.getAttribute('aria-orientation') === 'horizontal')!
    expect(horizontalSeparator).toBeDefined()
    expect(horizontalSeparator.getAttribute('aria-valuenow')).toBe('58')

    fireEvent.keyDown(horizontalSeparator, { key: 'ArrowDown' })
    expect(setStackRatioMock).toHaveBeenCalledWith(1, 60)
  })

  it('renders stacked column and allows ratio change in narrow mode', () => {
    isDesktopValue = false
    const setStackRatioMock = vi.fn()
    const actions = defaultActions({ setStackRatio: setStackRatioMock })
    const columns: WorkspaceColumn[] = [
      { view: 'terminal', width: 100, stack: 'browser', stackRatio: 64 },
    ]

    render(
      <WorkspaceColumns
        columns={columns}
        actions={actions}
        renderView={(view) => <div data-testid={`narrow-${view}`}>{view}</div>}
      />,
    )

    expect(screen.getByTestId('narrow-terminal')).toBeDefined()
    expect(screen.getByTestId('narrow-browser')).toBeDefined()

    const separator = screen.getByRole('separator')
    expect(separator.getAttribute('aria-orientation')).toBe('horizontal')
    expect(separator.getAttribute('aria-valuenow')).toBe('64')

    fireEvent.keyDown(separator, { key: 'ArrowDown' })
    expect(setStackRatioMock).toHaveBeenCalledWith(0, 66)
  })

  it('calls onRatioChange prop when provided on WorkspaceColumns', () => {
    const onRatioChange = vi.fn()
    render(
      <WorkspaceColumns
        columns={[{ view: 'terminal', width: 100, stack: 'browser', stackRatio: 58 }]}
        actions={defaultActions()}
        onRatioChange={onRatioChange}
        renderView={(view) => <div>{view}</div>}
      />,
    )

    const separator = screen.getByRole('separator')
    fireEvent.keyDown(separator, { key: 'ArrowDown' })
    expect(onRatioChange).toHaveBeenCalledWith(0, 60)
  })
})
