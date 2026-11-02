import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RunLimitsFields, UNLIMITED_WARNING } from './run-limits-fields'
import type { LimitsDraft } from '@/lib/run-limits'
import { optionValues, pickOption, selectValue } from '@/test-utils/app-select'

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

  it('asks once before choosing Unlimited, and does not switch until confirmed', async () => {
    const onChange = vi.fn()
    render(<RunLimitsFields draft={capped} onChange={onChange} allowDefault />)
    await pickOption(screen.getByLabelText('Run limits'), 'none')
    expect(await screen.findByText(UNLIMITED_WARNING)).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Cancel'))
    expect(onChange).not.toHaveBeenCalled()
    await pickOption(screen.getByLabelText('Run limits'), 'none')
    fireEvent.click(await screen.findByText('Choose Unlimited'))
    expect(onChange).toHaveBeenCalledWith({ ...capped, mode: 'none' })
  })

  it('offers Default only where a default exists', async () => {
    const { rerender } = render(<RunLimitsFields draft={capped} onChange={vi.fn()} allowDefault />)
    expect(await optionValues(screen.getByLabelText('Run limits'))).toContain('default')
    rerender(<RunLimitsFields draft={capped} onChange={vi.fn()} allowDefault={false} />)
    expect(await optionValues(screen.getByLabelText('Run limits'))).not.toContain('default')
  })
})
