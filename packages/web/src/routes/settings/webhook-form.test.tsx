import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebhookForm, webhookDraft } from './webhook-form'

afterEach(cleanup)
function mount() {
  const save = vi.fn()
  function Form() {
    const [draft, setDraft] = useState(webhookDraft())
    return <WebhookForm draft={draft} setDraft={setDraft} pending={false} guideHref="https://example.com/guide" save={save} />
  }
  render(<Form />)
  return save
}
describe('receiver settings', () => {
  it('keeps custom receivers signed and previews their JSON', () => {
    mount()
    expect(screen.getByLabelText('Synthetic JSON sample')).toBeTruthy()
    expect(screen.getByLabelText('Allow a receiver on this computer or private network')).toBeTruthy()
  })
  it('uses the shared 36px control height for every receiver select', () => {
    mount()
    for (const label of ['Events', 'Message content', 'Tasks', 'Waiting and review delay']) {
      expect(screen.getByLabelText(label).classList.contains('h-9'), label).toBe(true)
    }
  })
})
