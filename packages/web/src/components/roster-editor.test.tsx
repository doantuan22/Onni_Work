import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '@/api/query-client'
import { RosterEditor } from './roster-editor'
import type { RosterDraft } from '@/lib/roster'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const draft: RosterDraft = {
  managerRunner: 'claude',
  managerModel: '',
  workers: [{ runner: 'codex', model: '', role: '', maxConcurrent: 1 }],
}

const renderEditor = (ui: ReactElement) =>
  render(<QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>)

describe('RosterEditor', () => {
  it('offers only the connected backends', () => {
    renderEditor(<RosterEditor draft={draft} onChange={vi.fn()} connected={['claude', 'codex']} />)
    const options = Array.from((screen.getByLabelText('Worker 1 backend') as HTMLSelectElement).options).map((o) => o.value)
    expect(options).toEqual(['', 'claude', 'codex'])
  })
  it('flags a chosen backend that has gone away rather than hiding it', () => {
    renderEditor(<RosterEditor draft={{ ...draft, workers: [{ ...draft.workers[0]!, runner: 'opencode' }] }} onChange={vi.fn()} connected={['claude']} />)
    expect(screen.getAllByRole('option', { name: 'opencode (not connected)' }).length).toBeGreaterThan(0)
  })
  it('edits a worker role, adds workers, and keeps at least one', () => {
    const onChange = vi.fn()
    renderEditor(<RosterEditor draft={draft} onChange={onChange} connected={['claude', 'codex']} />)
    fireEvent.change(screen.getByLabelText('Worker 1 role'), { target: { value: 'backend tests' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...draft, workers: [{ ...draft.workers[0], role: 'backend tests' }] })
    fireEvent.click(screen.getByText('Add worker'))
    expect(onChange.mock.calls.at(-1)![0].workers).toHaveLength(2)
    expect((screen.getByLabelText('Remove worker 1') as HTMLButtonElement).disabled).toBe(true)
  })
  it('offers the backend’s own model list, filtered as you type, instead of a free-text guess', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).startsWith('/api/v1/models')) {
          return new Response(
            JSON.stringify({
              runner: 'codex',
              models: [
                { id: 'gpt-5.4', label: 'gpt-5.4', description: 'Frontier' },
                { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini', description: 'Fast' },
              ],
              source: 'live',
              stale: false,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        return new Promise<never>(() => {})
      }),
    )
    const onChange = vi.fn()
    renderEditor(<RosterEditor draft={draft} onChange={onChange} connected={['claude', 'codex']} />)
    fireEvent.pointerDown(screen.getByLabelText('Worker 1 model'))
    const search = await screen.findByRole('searchbox', { name: 'Search codex models…' })
    fireEvent.change(search, { target: { value: 'mini' } })
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /gpt-5\.4-mini/ }))
    expect(onChange).toHaveBeenLastCalledWith({ ...draft, workers: [{ ...draft.workers[0], model: 'gpt-5.4-mini' }] })
  })
  it('offers antigravity as a worker but never as the manager, and says why', () => {
    renderEditor(<RosterEditor draft={draft} onChange={vi.fn()} connected={['claude', 'codex', 'antigravity']} />)
    const manager = Array.from((screen.getByLabelText('Manager backend') as HTMLSelectElement).options).map((o) => o.value)
    const worker = Array.from((screen.getByLabelText('Worker 1 backend') as HTMLSelectElement).options).map((o) => o.value)
    expect(manager).toEqual(['', 'claude', 'codex'])
    expect(worker).toEqual(['', 'claude', 'codex', 'antigravity'])
    const note = document.querySelector('[data-slot="roster-worker-only"][data-backend="antigravity"]')
    expect(note?.textContent).toContain('antigravity is offered as a worker only')
    expect(note?.textContent).toContain('not yet verified')
  })
  it('shows no worker-only note when every connected backend can manage', () => {
    renderEditor(<RosterEditor draft={draft} onChange={vi.fn()} connected={['claude', 'codex']} />)
    expect(document.querySelector('[data-slot="roster-worker-only"]')).toBeNull()
  })
  it('says plainly that nothing is connected, and that the fence is not a security boundary', () => {
    renderEditor(<RosterEditor draft={draft} onChange={vi.fn()} connected={[]} />)
    expect(screen.getByText(/No agent is connected/)).toBeTruthy()
    expect(screen.getByText(/not a security boundary/)).toBeTruthy()
  })
})
