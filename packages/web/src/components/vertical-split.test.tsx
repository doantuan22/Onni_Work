import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

import { VerticalSplit } from './vertical-split'

afterEach(cleanup)

function ControlledSplit({ onChange = vi.fn(), minPercent }: { onChange?: (value: number) => void; minPercent?: number }) {
  const [ratio, setRatio] = useState(58)
  const change = (next: number) => { onChange(next); setRatio(next) }
  return <VerticalSplit ratio={ratio} onRatioChange={change} minPercent={minPercent} labels={{ top: 'Chat', bottom: 'Terminal', separator: 'Resize terminal' }} top={<div>Top content</div>} bottom={<div>Bottom content</div>} />
}

describe('VerticalSplit', () => {
  it('renders two labeled panes and an accessible horizontal separator with percent values', () => {
    render(<ControlledSplit />)
    const separator = screen.getByRole('separator', { name: 'Resize terminal' })
    expect(screen.getByLabelText('Chat').textContent).toContain('Top content')
    expect(screen.getByLabelText('Terminal').textContent).toContain('Bottom content')
    expect(separator.getAttribute('aria-orientation')).toBe('horizontal')
    expect(separator.getAttribute('aria-valuenow')).toBe('58')
    expect(separator.getAttribute('aria-valuemin')).toBe('15')
    expect(separator.getAttribute('aria-valuemax')).toBe('85')
  })

  it('supports arrow steps, shifted steps, Home, and End within the bounds', () => {
    const onChange = vi.fn()
    render(<ControlledSplit onChange={onChange} />)
    const separator = screen.getByRole('separator')
    fireEvent.keyDown(separator, { key: 'ArrowDown' })
    expect(separator.getAttribute('aria-valuenow')).toBe('60')
    fireEvent.keyDown(separator, { key: 'ArrowUp', shiftKey: true })
    expect(separator.getAttribute('aria-valuenow')).toBe('50')
    fireEvent.keyDown(separator, { key: 'Home' })
    expect(separator.getAttribute('aria-valuenow')).toBe('15')
    fireEvent.keyDown(separator, { key: 'End' })
    expect(separator.getAttribute('aria-valuenow')).toBe('85')
    expect(onChange).toHaveBeenCalledWith(60)
  })

  it('captures pointer drag, converts vertical movement to percent, and clamps to minimum', () => {
    const onChange = vi.fn()
    render(<ControlledSplit onChange={onChange} />)
    const separator = screen.getByRole('separator')
    const container = separator.parentElement!
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 200 })
    separator.setPointerCapture = vi.fn()
    separator.hasPointerCapture = vi.fn(() => true)
    separator.releasePointerCapture = vi.fn()
    fireEvent.pointerDown(separator, { button: 0, pointerId: 3, clientY: 100 })
    fireEvent.pointerMove(separator, { pointerId: 3, clientY: 140 })
    expect(separator.getAttribute('aria-valuenow')).toBe('78')
    fireEvent.pointerUp(separator, { pointerId: 3, clientY: 140 })
    expect(separator.setPointerCapture).toHaveBeenCalledWith(3)
    expect(separator.releasePointerCapture).toHaveBeenCalledWith(3)
    fireEvent.keyDown(separator, { key: 'Home' })
    expect(separator.getAttribute('aria-valuenow')).toBe('15')
  })

  it('resets to 58 percent on double-click and uses a supplied minimum', () => {
    render(<ControlledSplit minPercent={20} />)
    const separator = screen.getByRole('separator')
    expect(separator.getAttribute('aria-valuemin')).toBe('20')
    expect(separator.getAttribute('aria-valuemax')).toBe('80')
    fireEvent.keyDown(separator, { key: 'Home' })
    expect(separator.getAttribute('aria-valuenow')).toBe('20')
    fireEvent.doubleClick(separator)
    expect(separator.getAttribute('aria-valuenow')).toBe('58')
  })
})
