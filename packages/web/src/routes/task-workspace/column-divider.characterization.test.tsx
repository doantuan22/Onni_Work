import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/use-desktop', () => ({ useIsDesktop: () => true }))
import { WorkspaceColumns } from './workspace-columns'

afterEach(cleanup)

describe('ColumnDivider characterization', () => {
  it('exposes pair-relative separator values and resizes by the small and Shift arrow steps', () => {
    const resizeColumns = vi.fn()
    render(<WorkspaceColumns columns={[{ view: 'session', width: 33 }, { view: 'changes', width: 67 }]}
      actions={{ addColumn: vi.fn(), closeColumn: vi.fn(), setColumnView: vi.fn(), resizeColumns, moveColumn: vi.fn() }}
      renderView={() => null} />)
    const divider = screen.getByRole('separator')
    expect(divider.getAttribute('aria-orientation')).toBe('vertical')
    expect(divider.getAttribute('aria-valuenow')).toBe('33')
    expect(divider.getAttribute('aria-valuemin')).toBe('12')
    expect(divider.getAttribute('aria-valuemax')).toBe('88')
    fireEvent.keyDown(divider, { key: 'ArrowRight' })
    fireEvent.keyDown(divider, { key: 'ArrowLeft', shiftKey: true })
    expect(resizeColumns).toHaveBeenNthCalledWith(1, 0, 2)
    expect(resizeColumns).toHaveBeenNthCalledWith(2, 0, -10)
  })
})
