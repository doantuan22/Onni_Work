import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { queryKeys, workspaceQueryKeys } from '@/api/queries'
import { createQueryClient } from '@/api/query-client'
import type { ManagerPreset, WorkspaceConfigResponse } from '@onni/api-client'
import { Toaster, resetToasts } from '@/components/ui/toaster'
import { AppRoutes } from '@/routes'
import { ThemeProvider } from '@/components/theme-provider'

/** Settings → Manager–Worker: presets live in the workspace config, backends come from provider status. */

let requests: Array<{ method: string; url: string; body?: unknown }> = []
const PRESET: ManagerPreset = {
  id: 'preset-1',
  name: 'Claude manages, Codex and OpenCode work',
  roster: { manager: { runner: 'claude' }, workers: [{ runner: 'codex', model: 'gpt-5', role: 'backend tests', maxConcurrent: 2 }, { runner: 'opencode', role: 'docs', maxConcurrent: 1 }] },
}

function serve(presets: ManagerPreset[] = [PRESET], defaultPresetId: string | null = null) {
  requests = []
  const state = {
    branding: { name: 'onni', logoUrl: null },
    agentDefaults: {},
    browseRoot: '~/',
    projectsDir: '~/onni/projects',
    orgSkillsRepos: [],
    systemPrompt: null,
    limits: { mode: 'capped', maxCostUsd: 10, maxTokens: 10000000, maxWallClockMinutes: 240, maxStepIterations: 30 },
    safety: { waitExpiryMinutes: 30, dispatchMaxDepth: 1, dispatchMaxSubtasks: 12, dispatchRetryLimit: 1 },
    managerWorker: { presets, defaultPresetId },
    composerDefaults: { autonomous: null, worktree: null, inheritedAutonomous: 'source-dependent', inheritedWorktree: true },
    resources: { maxParallel: 1, maxMonitoringSessions: 2, idleTimeoutMinutes: 15, monitoringWakeIntervalMinutes: null, autoResumeOnUsageLimit: true, memoryLimitMb: null, worktreeRetentionDefault: 10 },
  } as unknown as WorkspaceConfigResponse
  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
      requests.push({ method, url, body })
      if (url === '/api/v1/workspace/config' && method === 'GET') return json(state)
      if (url === '/api/v1/workspace/config' && method === 'PUT') {
        if (body?.managerWorker) state.managerWorker = body.managerWorker as WorkspaceConfigResponse['managerWorker']
        return json(state)
      }
      if (url.startsWith('/api/v1/workspace/providers/status') || url.includes('/providers/status')) {
        return json({ providers: [{ provider: 'claude', status: 'connected', enabled: true }, { provider: 'codex', status: 'connected', enabled: true }, { provider: 'opencode', status: 'disconnected', enabled: true }] })
      }
      return new Promise<never>(() => {})
    }),
  )
}

function renderSection() {
  const client = createQueryClient()
  client.setQueryData(queryKeys.health, { bootProject: 'boot' })
  client.setQueryData(workspaceQueryKeys.projects, { projects: [], bootProject: 'boot', projectsDir: '~/onni/projects' })
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <MemoryRouter initialEntries={['/settings/global/manager-worker']}>
          <AppRoutes />
          <Toaster />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  )
}
const puts = () => requests.filter((r) => r.method === 'PUT' && r.url === '/api/v1/workspace/config')

afterEach(() => {
  act(() => resetToasts())
  cleanup()
  vi.unstubAllGlobals()
})

describe('Settings → Manager–Worker', () => {
  it('lists presets with their roster, flags a backend that is no longer connected, and links to limits and parallelism', async () => {
    serve()
    renderSection()
    await waitFor(() => expect(document.querySelector('[data-slot="manager-worker-section"]')).not.toBeNull())
    expect(screen.getAllByText(PRESET.name).length).toBeGreaterThan(0)
    expect(screen.getByText('claude → codex (gpt-5), opencode')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('Not connected: opencode')).toBeTruthy())
    const links = document.querySelector('[data-slot="mw-limit-links"]')!
    expect(links.textContent).toContain('Run limits')
    expect(links.textContent).toContain('1 task at once')
    expect(links.querySelector('a')?.getAttribute('href')).toBe('/settings/global/resources')
    expect(document.querySelector('[data-slot="mw-fence-note"]')?.textContent).toContain('not a security boundary')
  })

  it('saves the default preset to the workspace config', async () => {
    serve()
    renderSection()
    await waitFor(() => expect(document.querySelector('[data-slot="mw-default"]')).not.toBeNull())
    fireEvent.change(document.querySelector('[data-slot="mw-default"]')!, { target: { value: 'preset-1' } })
    await waitFor(() => expect(puts()).toHaveLength(1))
    expect(puts()[0]!.body).toEqual({ managerWorker: { presets: [PRESET], defaultPresetId: 'preset-1' } })
  })

  it('creates a preset from the editor, offering only connected backends', async () => {
    serve([])
    renderSection()
    await waitFor(() => expect(document.querySelector('[data-slot="mw-new"]')).not.toBeNull())
    await waitFor(() => expect(screen.getByText('No presets yet.')).toBeTruthy())
    fireEvent.click(document.querySelector('[data-slot="mw-new"]')!)
    await waitFor(() => expect(document.querySelector('[data-slot="mw-editor"]')).not.toBeNull())
    await waitFor(() => {
      const options = Array.from((screen.getByLabelText('Worker 1 backend') as HTMLSelectElement).options).map((o) => o.value)
      expect(options).toEqual(['', 'claude', 'codex'])
    })
    fireEvent.change(screen.getByLabelText('Preset name'), { target: { value: 'Duo' } })
    fireEvent.change(screen.getByLabelText('Worker 1 role'), { target: { value: 'tests' } })
    const save = document.querySelector<HTMLButtonElement>('[data-slot="mw-save"]')!
    await waitFor(() => expect(save.disabled).toBe(false))
    fireEvent.click(save)
    await waitFor(() => expect(puts()).toHaveLength(1))
    const sent = (puts()[0]!.body as { managerWorker: { presets: ManagerPreset[] } }).managerWorker.presets[0]!
    expect(sent).toMatchObject({ id: 'preset-1', name: 'Duo', roster: { manager: { runner: 'claude' }, workers: [{ runner: 'codex', role: 'tests', maxConcurrent: 1 }] } })
  })
})
