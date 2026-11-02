import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '@/api/query-client'
import type { ApiRun } from '@onni/api-client'
import { ThemeProvider } from '@/components/theme-provider'

import { TaskGraphView } from './task-graph'

/**
 * The Activity mode of the task Graph tab (P9). The mapping from runs to nodes is table-tested in
 * `lib/activity-graph.test.ts`; here the view itself: it draws the live tree from the run list,
 * shows each state with a label (not colour alone), keeps the flow view one click away, and
 * remembers the choice.
 */
beforeEach(() => {
  window.localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const run = (over: Record<string, unknown>): ApiRun =>
  ({ id: 'r', title: 'task', status: 'running', createdAt: '2026-11-02T10:00:00Z', steps: [], workflow: 'w', task: 't', ...over }) as unknown as ApiRun

const MANAGER = run({ id: 'm', title: 'Build the landing page', runner: 'claude', model: 'opus', activity: 'monitoring', roster: { manager: { runner: 'claude' }, workers: [] }, dispatch: { rootRunId: 'm' } })
const W1 = run({ id: 'w1', title: 'hero section', runner: 'codex', createdAt: '2026-11-02T10:01:00Z', startedAt: '2026-11-02T10:01:05Z', dispatch: { rootRunId: 'm', parentRunId: 'm' } })
const W2 = run({ id: 'w2', title: 'pricing table', runner: 'antigravity', status: 'failed', error: "antigravity was blocked — blocked by Onni's permission level", createdAt: '2026-11-02T10:02:00Z', dispatch: { rootRunId: 'm', parentRunId: 'm' } })

function mount(runs: ApiRun[], current: ApiRun = MANAGER) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(runs), { headers: { 'content-type': 'application/json' } })))
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <ThemeProvider>
        <MemoryRouter>
          <div style={{ width: 1000, height: 700 }}>
            <TaskGraphView run={current} embedded />
          </div>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

const cards = () => [...document.querySelectorAll<HTMLElement>('[data-slot="activity-node"]')]

describe('TaskGraphView — Activity mode', () => {
  it('opens on Activity and draws the manager and every worker with a labelled state', async () => {
    mount([MANAGER, W1, W2])
    await waitFor(() => expect(cards()).toHaveLength(3))
    const byRole = (role: string) => cards().find((c) => c.getAttribute('data-role') === role)!
    expect(byRole('manager').getAttribute('data-state')).toBe('monitoring')
    const states = cards().map((c) => c.getAttribute('data-state')).sort()
    expect(states).toEqual(['blocked', 'monitoring', 'running'])
    // State is spelled out as text too, never colour alone.
    expect(document.body.textContent).toContain('Blocked by permission')
    expect(document.body.textContent).toContain('Working')
    expect(document.body.textContent).toContain('hero section')
  })

  it('draws a plain single task as one agent node', async () => {
    const solo = run({ id: 's', title: 'fix the bug', runner: 'claude' })
    mount([solo], solo)
    await waitFor(() => expect(cards()).toHaveLength(1))
    expect(cards()[0]!.getAttribute('data-role')).toBe('solo')
  })

  it('switches to the flow view and remembers the choice', async () => {
    mount([MANAGER, W1])
    await waitFor(() => expect(cards().length).toBeGreaterThan(0))
    expect(document.querySelector('[data-mode="activity"]')!.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(document.querySelector('[data-mode="flow"]')!)
    expect(window.localStorage.getItem('onni.graph.mode')).toBe('flow')
    expect(document.querySelector('[data-slot="activity-graph"]')).toBeNull()
  })

  it('degrades to a message when the runs cannot be read', { timeout: 30_000 }, async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ThemeProvider>
          <MemoryRouter>
            <TaskGraphView run={MANAGER} embedded />
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByText('The activity map did not load')).toBeTruthy(), { timeout: 15_000 })
  })
})
