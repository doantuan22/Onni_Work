import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '@/api/query-client'
import { ModelPickerField } from './model-picker-field'
import type { Runner } from '@onni/api-client'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderField(onChange = vi.fn(), runner: Runner = 'codex') {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ModelPickerField runner={runner} value="" onChange={onChange} ariaLabel="Model" />
    </QueryClientProvider>,
  )
  return onChange
}

function serveModels(models: Array<{ id: string; label: string; description: string }>, source = 'live') {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ runner: 'codex', models, source, stale: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('ModelPickerField', () => {
  it('does not spawn a discovery CLI until the field is opened', () => {
    const fetchMock = serveModels([])
    renderField()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lists the host catalog and finds a model by typing part of it', async () => {
    serveModels([
      { id: 'gpt-5.4', label: 'gpt-5.4', description: 'Frontier' },
      { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini', description: 'Fast' },
    ])
    const onChange = renderField()
    fireEvent.pointerDown(screen.getByLabelText('Model'))
    const search = await screen.findByRole('searchbox', { name: 'Search codex models…' })
    fireEvent.change(search, { target: { value: 'mini' } })
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /gpt-5\.4-mini/ }))
    expect(onChange).toHaveBeenCalledWith('gpt-5.4-mini')
  })

  it('keeps a typo unpickable once the machine has listed the models', async () => {
    serveModels([{ id: 'gpt-5.4', label: 'gpt-5.4', description: 'Frontier' }])
    renderField()
    fireEvent.pointerDown(screen.getByLabelText('Model'))
    const search = await screen.findByRole('searchbox', { name: 'Search codex models…' })
    fireEvent.change(search, { target: { value: 'gpt-5.4-codex' } })
    expect(await screen.findByText('No codex models match.')).toBeTruthy()
    expect(screen.queryByText(/Use “/)).toBeNull()
  })

  it('offers the typed value only when no list is available, and says so', async () => {
    serveModels([], 'unavailable')
    const onChange = renderField()
    fireEvent.pointerDown(screen.getByLabelText('Model'))
    const search = await screen.findByRole('searchbox', { name: 'Search codex models…' })
    expect(await screen.findByText(/Latest Codex models unavailable/)).toBeTruthy()
    fireEvent.change(search, { target: { value: 'gpt-5.4-codex' } })
    fireEvent.click(await screen.findByText('Use “gpt-5.4-codex”'))
    expect(onChange).toHaveBeenCalledWith('gpt-5.4-codex')
  })

  it('keeps a typed model for a backend with no host discovery at all', async () => {
    const onChange = renderField(vi.fn(), 'copilot')
    fireEvent.pointerDown(screen.getByLabelText('Model'))
    const search = await screen.findByRole('searchbox', { name: 'Type a copilot model…' })
    expect(await screen.findByText(/Type a model your copilot account offers/)).toBeTruthy()
    fireEvent.change(search, { target: { value: 'claude-sonnet-4' } })
    fireEvent.click(await screen.findByText('Use “claude-sonnet-4”'))
    expect(onChange).toHaveBeenCalledWith('claude-sonnet-4')
  })

  it('is disabled until a backend is chosen', () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ModelPickerField runner="" value="" onChange={vi.fn()} ariaLabel="Model" />
      </QueryClientProvider>,
    )
    const field = screen.getByLabelText('Model') as HTMLButtonElement
    expect(field.disabled).toBe(true)
    expect(field.textContent).toContain('Choose a backend first')
  })
})
