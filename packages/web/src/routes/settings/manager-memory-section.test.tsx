import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ManagerMemoryRead } from '@onni/api-client'
import { queryKeys, workspaceQueryKeys } from '@/api/queries'
import { createQueryClient } from '@/api/query-client'
import { Toaster, resetToasts } from '@/components/ui/toaster'
import { AppRoutes } from '@/routes'
import { ThemeProvider } from '@/components/theme-provider'

/**
 * Settings → Manager memory (plan v2 §8): one file, edited in place. The server owns the byte
 * ceiling and the revision; this section must never write over a newer copy.
 */

let requests: Array<{ method: string; url: string; body?: Record<string, unknown> }> = []

const LESSONS = '- Run the migrations first (task abcdef12, 2026-11-03)\n- The payments module must not import the UI package\n'

function serve(initial: Partial<ManagerMemoryRead> = {}) {
  requests = []
  const state: ManagerMemoryRead = {
    content: LESSONS,
    bytes: new TextEncoder().encode(LESSONS).length,
    maxBytes: 3072,
    revision: 'rev-1',
    ...initial,
  }
  let putStatus = 200
  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
      requests.push({ method, url, body })
      if (!url.includes('/manager-memory')) return new Promise<never>(() => {})
      if (method === 'GET') return json(state)
      if (method === 'PUT') {
        if (putStatus === 409) {
          // Another window saved first; the refetch must hand back that newer copy.
          state.content = '- Their newer lesson (task 99999999, 2026-11-04)\n'
          state.revision = 'rev-2'
          state.bytes = new TextEncoder().encode(state.content).length
          return json({ error: 'memory changed in another window', current: state }, 409)
        }
        state.content = String(body?.content ?? '')
        state.revision = 'rev-2'
        state.bytes = new TextEncoder().encode(state.content).length
        return json(state)
      }
      return new Promise<never>(() => {})
    }),
  )
  return { state, failNextPutAs: (status: number) => { putStatus = status } }
}

const PROJECT = { id: 'demo', name: 'demo-project', root: '/Users/me/code/demo', addedAt: '2026-01-05T10:00:00.000Z', lastOpenedAt: '2026-07-31T10:00:00.000Z', source: 'local' as const, status: 'ok' as const, branch: 'main' }

function renderSection() {
  const client = createQueryClient()
  client.setQueryData(queryKeys.health, {
    bootProject: 'boot',
    repoRoot: '/Users/me/code/demo',
    repo: { root: '/Users/me/code/demo', branch: 'main' },
    capabilities: { localHandoff: true, terminal: false, followups: true, singleProject: false },
  })
  client.setQueryData(workspaceQueryKeys.projects, { projects: [PROJECT], bootProject: 'demo', projectsDir: '~/onni/projects' })
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <MemoryRouter initialEntries={['/p/demo/settings/manager-memory']}>
          <AppRoutes />
          <Toaster />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

const editor = () => document.querySelector('[data-slot="memory-editor"]') as HTMLTextAreaElement | null
const save = () => document.querySelector('[data-slot="memory-save"]') as HTMLButtonElement | null
const puts = () => requests.filter((request) => request.method === 'PUT' && request.url.includes('/manager-memory'))

afterEach(() => {
  act(() => resetToasts())
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('Settings → Manager memory', () => {
  it('shows the stored lessons with the task that wrote each one, and saves an edit with the revision it loaded', async () => {
    serve()
    renderSection()
    await waitFor(() => expect(editor()).not.toBeNull())
    expect(editor()!.value).toBe(LESSONS)
    expect(screen.getByText('Run the migrations first')).toBeTruthy()
    expect(screen.getByText('task abcdef12')).toBeTruthy()
    expect(screen.getByText('2026-11-03')).toBeTruthy()
    expect(screen.getByText('The payments module must not import the UI package')).toBeTruthy()

    fireEvent.change(editor()!, { target: { value: `${LESSONS}- One more lesson\n` } })
    await waitFor(() => expect(save()!.disabled).toBe(false))
    fireEvent.click(save()!)
    await waitFor(() => expect(puts()).toHaveLength(1))
    expect(puts()[0]!.body).toEqual({ content: `${LESSONS}- One more lesson\n`, revision: 'rev-1' })
    await waitFor(() => expect(screen.getByText('Project memory saved')).toBeTruthy())
  });

  it('counts UTF-8 bytes and refuses to save past the server’s ceiling', async () => {
    serve({ content: '', maxBytes: 40 })
    renderSection()
    await waitFor(() => expect(editor()).not.toBeNull())
    fireEvent.change(editor()!, { target: { value: 'ạ'.repeat(21) } })
    // 21 characters, 63 UTF-8 bytes — the counter must not read "21 / 40".
    await waitFor(() => expect(document.querySelector('[data-slot="memory-bytes"]')!.textContent).toBe('63 / 40 bytes'))
    expect(screen.getByText('Over the limit — remove a lesson before saving.')).toBeTruthy()
    expect(save()!.disabled).toBe(true)
    expect(puts()).toHaveLength(0)
  });

  it('reloads the newer copy when another window saved first', async () => {
    const server = serve()
    server.failNextPutAs(409)
    renderSection()
    await waitFor(() => expect(editor()).not.toBeNull())
    fireEvent.change(editor()!, { target: { value: '- My lesson\n' } })
    await waitFor(() => expect(save()!.disabled).toBe(false))
    fireEvent.click(save()!)
    await waitFor(() => expect(screen.getByText('Memory changed in another window — reloaded the latest version')).toBeTruthy())
    await waitFor(() => expect(editor()!.value).toBe('- Their newer lesson (task 99999999, 2026-11-04)\n'))
  });

  it('clears the file only after confirming', async () => {
    serve()
    renderSection()
    const clear = await waitFor(() => {
      const button = document.querySelector('[data-slot="memory-clear"]') as HTMLButtonElement | null
      expect(button).not.toBeNull()
      return button!
    })
    fireEvent.click(clear)
    const confirm = await screen.findByRole('button', { name: 'Clear' })
    fireEvent.click(confirm)
    await waitFor(() => expect(puts()).toHaveLength(1))
    expect(puts()[0]!.body).toEqual({ content: '', revision: 'rev-1' })
    await waitFor(() => expect(screen.getByText('No lessons yet.')).toBeTruthy())
  });
})
