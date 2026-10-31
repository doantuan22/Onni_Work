import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RunLimitsFields, UNLIMITED_WARNING } from './run-limits-fields'
import type { LimitsDraft } from '@/lib/run-limits'

afterEach(cleanup)

const capped: LimitsDraft = { mode: 'capped', cost: '10', tokens: '10000000', time: '240', iterations: '30' }

describe('RunLimitsFields', () => {
  it('shows the four ceilings only while capped, and a blank stays blank', () => {
    const onChange = vi.fn()
    const { rerender } = render(<RunLimitsFields draft={capped} onChange={onChange} allowDefault={false} />)
    fireEvent.change(screen.getByLabelText('Max cost (USD)'), { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith({ ...capped, cost: '' })
    rerender(<RunLimitsFields draft={{ ...capped, mode: 'none' }} onChange={onChange} allowDefault={false} />)
    expect(screen.queryByLabelText('Max cost (USD)')).toBeNull()
    expect(screen.getByText(/No cost, token, time or step ceiling/)).toBeTruthy()
  })

  it('asks once before choosing Unlimited, and does not switch when declined', () => {
    const onChange = vi.fn()
    const confirm = vi.fn(() => false)
    render(<RunLimitsFields draft={capped} onChange={onChange} allowDefault confirm={confirm} />)
    fireEvent.change(screen.getByLabelText('Run limits'), { target: { value: 'none' } })
    expect(confirm).toHaveBeenCalledWith(UNLIMITED_WARNING)
    expect(onChange).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    fireEvent.change(screen.getByLabelText('Run limits'), { target: { value: 'none' } })
    expect(onChange).toHaveBeenCalledWith({ ...capped, mode: 'none' })
  })

  it('offers Default only where a default exists', () => {
    const { rerender } = render(<RunLimitsFields draft={capped} onChange={vi.fn()} allowDefault />)
    expect(screen.getByRole('option', { name: /Default/ })).toBeTruthy()
    rerender(<RunLimitsFields draft={capped} onChange={vi.fn()} allowDefault={false} />)
    expect(screen.queryByRole('option', { name: /Default/ })).toBeNull()
  })
})
