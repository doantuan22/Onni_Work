import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppSelect } from '@/components/ui/app-select'
import { optionValues, pickOption, selectValue } from '@/test-utils/app-select'

afterEach(cleanup)

const MODELS = ['auto', 'opus', 'sonnet', 'haiku', 'gpt-5', 'gpt-5-mini', 'o3', 'o4-mini', 'gemini-pro']

function Harness({ values = MODELS, onChange = vi.fn() }: { values?: string[]; onChange?: (v: string) => void }) {
  const [value, setValue] = useState('auto')
  return (
    <AppSelect aria-label="Model" value={value} className="block w-full" onChange={(e) => { setValue(e.target.value); onChange(e.target.value) }}>
      {values.map((v) => <option key={v} value={v}>{v === 'auto' ? 'Tự động' : v}</option>)}
    </AppSelect>
  )
}

describe('AppSelect', () => {
  it('keeps the arrow in the trigger row even when the caller passes `block`', () => {
    render(<Harness values={['a', 'b']} />)
    const trigger = screen.getByLabelText('Model')
    // `flex!` (important) is what beats a caller's `block`.
    expect(trigger.className).toContain('flex!')
    expect(trigger.querySelector('svg')).not.toBeNull()
  })

  it('a short list is the plain select, a long one gains a search box', async () => {
    const { rerender } = render(<Harness values={['a', 'b']} />)
    expect(screen.getByLabelText('Model').getAttribute('data-searchable')).toBeNull()
    rerender(<Harness />)
    expect(screen.getByLabelText('Model').getAttribute('data-searchable')).toBe('true')
    expect(await optionValues(screen.getByLabelText('Model'))).toEqual(MODELS)
  })

  it('filters by typed characters, ignoring case, and picks the result', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const trigger = screen.getByLabelText('Model')
    fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' })
    fireEvent.click(trigger)
    const search = await screen.findByPlaceholderText('Search…')
    fireEvent.change(search, { target: { value: 'GPT' } })
    await waitFor(() => expect(screen.getAllByRole('option').map((o) => o.getAttribute('data-value'))).toEqual(['gpt-5', 'gpt-5-mini']))
    fireEvent.change(search, { target: { value: 'zzz' } })
    await waitFor(() => expect(screen.getByText('Nothing found')).toBeTruthy())
    fireEvent.change(search, { target: { value: 'mini' } })
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3)) // gpt-5-mini, o4-mini, gemini-pro
    fireEvent.click(screen.getAllByRole('option').find((o) => o.getAttribute('data-value') === 'o4-mini')!)
    expect(onChange).toHaveBeenCalledWith('o4-mini')
    await waitFor(() => expect(selectValue(trigger)).toBe('o4-mini'))
  })

  it('also finds by the shown label, and pickOption works on both forms', async () => {
    render(<Harness />)
    await pickOption(screen.getByLabelText('Model'), 'haiku')
    expect(selectValue(screen.getByLabelText('Model'))).toBe('haiku')
  })

  it('can be forced off for a long list', () => {
    render(
      <AppSelect aria-label="Plain" searchable={false} value="a" onChange={() => {}}>
        {MODELS.map((v) => <option key={v} value={v}>{v}</option>)}
      </AppSelect>,
    )
    expect(screen.getByLabelText('Plain').getAttribute('data-searchable')).toBeNull()
  })
})
