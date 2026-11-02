import { fireEvent, waitFor } from '@testing-library/react'

/** The value an AppSelect trigger currently holds (the equivalent of `select.value`). */
export const selectValue = (trigger: Element | null): string | null => trigger?.getAttribute('data-value') ?? null

/** Open an AppSelect the way a pointer does and choose the option with this value. */
export async function pickOption(trigger: Element | null, value: string): Promise<void> {
  if (!trigger) throw new Error('pickOption: no select trigger')
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
  const item = await waitFor(() => {
    const found = [...document.querySelectorAll('[role="option"]')].find((el) => el.getAttribute('data-value') === value)
    if (!found) throw new Error(`no option "${value}"`)
    return found
  })
  fireEvent.pointerUp(item, { button: 0, pointerType: 'mouse' })
  fireEvent.click(item)
}

/** Open an AppSelect and answer the values of its options (the equivalent of `[...select.options]`). */
export async function optionValues(trigger: Element | null): Promise<string[]> {
  if (!trigger) throw new Error('optionValues: no select trigger')
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
  const items = await waitFor(() => {
    const found = [...document.querySelectorAll('[role="option"]')]
    if (found.length === 0) throw new Error('no options')
    return found
  })
  const values = items.map((el) => el.getAttribute('data-value') ?? '')
  fireEvent.keyDown(document.activeElement ?? trigger, { key: 'Escape' })
  return values
}
