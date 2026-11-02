import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '@/api/query-client'
import type { ProjectListEntry } from '@onni/api-client'
import { Toaster, resetToasts } from '@/components/ui/toaster'

import { ClearProjectData } from './clear-project-data'

const PROJECT = { id: 'shop', name: 'shop', root: '/home/me/shop', addedAt: '', lastOpenedAt: '', source: 'local' } as unknown as ProjectListEntry

afterEach(() => {
  act(() => resetToasts())
  cleanup()
  vi.unstubAllGlobals()
})

function mount(answer: unknown, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(answer), { status, headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ClearProjectData project={PROJECT} />
      <Toaster />
    </QueryClientProvider>,
  )
  return fetchMock
}

const confirmButton = () => document.querySelector('[data-action="project-clear-confirm"]') as HTMLButtonElement
const input = () => document.querySelector('[data-slot="project-clear-confirm-input"]') as HTMLInputElement

describe('ClearProjectData', () => {
  it('keeps the delete button locked until the project name is typed, then posts it', async () => {
    const fetchMock = mount({ deleted: 4, skipped: [] })
    fireEvent.click(document.querySelector('[data-action="project-clear-data"]')!)
    await waitFor(() => expect(input()).not.toBeNull())
    expect(confirmButton().disabled).toBe(true)
    fireEvent.change(input(), { target: { value: 'sho' } })
    expect(confirmButton().disabled).toBe(true)
    fireEvent.change(input(), { target: { value: 'SHOP' } })
    expect(confirmButton().disabled).toBe(false)
    fireEvent.click(confirmButton())
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(url)).toContain('/api/v1/p/shop/project-data/clear')
    expect(JSON.parse(String(init.body))).toEqual({ confirm: 'SHOP' })
    await waitFor(() => expect(screen.getByText('Deleted 4 tasks and their chats')).toBeTruthy())
  })

  it('says which tasks it kept because they are still running', async () => {
    mount({ deleted: 2, skipped: [{ id: 'r', title: 'busy', reason: 'still running — stop it first' }] })
    fireEvent.click(document.querySelector('[data-action="project-clear-data"]')!)
    await waitFor(() => expect(input()).not.toBeNull())
    fireEvent.change(input(), { target: { value: 'shop' } })
    fireEvent.click(confirmButton())
    await waitFor(() => expect(screen.getByText('Deleted 2 tasks; kept 1 that are still running')).toBeTruthy())
  })

  it('shows the server refusal and keeps the dialog open', async () => {
    mount({ error: 'type the project name to confirm' }, 400)
    fireEvent.click(document.querySelector('[data-action="project-clear-data"]')!)
    await waitFor(() => expect(input()).not.toBeNull())
    fireEvent.change(input(), { target: { value: 'shop' } })
    fireEvent.click(confirmButton())
    await waitFor(() => expect(screen.getByText('type the project name to confirm')).toBeTruthy())
    expect(input()).not.toBeNull()
  })
})
