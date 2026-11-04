import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ArchiveToggle } from '@/components/archive-toggle'
import { PinToggle } from '@/components/pin-toggle'

afterEach(cleanup)

// WCAG 2.5.8 asks for a 24×24px target. jsdom has no layout, so pin the size class; the pointer
// target is the button itself, not the 12px icon inside it.
describe('row icon toggles', () => {
  it('keep a 24px hit target', () => {
    const { container } = render(
      <>
        <PinToggle pinned={false} onToggle={vi.fn()} />
        <ArchiveToggle archived={false} onToggle={vi.fn()} />
      </>,
    )
    const buttons = [...container.querySelectorAll('button')]
    expect(buttons).toHaveLength(2)
    for (const button of buttons) {
      expect(button.className).toContain('size-6')
      expect(button.className).not.toContain('size-5')
    }
  })
})
