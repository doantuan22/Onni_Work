import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { queryKeys, workspaceQueryKeys } from '@/api/queries'
import { createQueryClient } from '@/api/query-client'
import type { WorkspaceConfigResponse } from '@onni/api-client'
import { Toaster, resetToasts } from '@/components/ui/toaster'
import { AppRoutes } from '@/routes'
import { ThemeProvider } from '@/components/theme-provider'

/** Settings → Agent permissions: Antigravity's level. Safe by default; the widest level is confirmed. */

let requests: Array<{ method: string; url: string; body?: Record<string, unknown> }> = []

function serve(level: 'files-only' | 'allow-rules' | 'bypass' = 'files-only') {
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
    managerWorker: { presets: [], defaultPresetId: null },
    agentPermissions: { antigravity: level },
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
        const patch = body?.agentPermissions as { antigravity?: 'files-only' | 'allow-rules' | 'bypass' } | undefined
        if (patch?.antigravity) state.agentPermissions = { antigravity: patch.antigravity }
        return json(state)
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
        <MemoryRouter initialEntries={['/settings/global/agent-permissions']}>
          <AppRoutes />
          <Toaster />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  )
}
const puts = () => requests.filter((r) => r.method === 'PUT' && r.url === '/api/v1/workspace/config')
const radio = (level: string) => document.querySelector<HTMLInputElement>(`[data-level="${level}"] input`)!

afterEach(() => {
  act(() => resetToasts())
  cleanup()
  vi.unstubAllGlobals()
})

describe('Settings → Agent permissions', () => {
  it('opens on the safe default and says what each level can and cannot do', async () => {
    serve()
    renderSection()
    await waitFor(() => expect(document.querySelector('[data-slot="agent-permissions-section"]')).not.toBeNull())
    expect(radio('files-only').checked).toBe(true)
    expect(radio('allow-rules').checked).toBe(false)
    expect(radio('bypass').checked).toBe(false)
    const text = document.querySelector('[data-slot="agent-permissions-section"]')!.textContent!
    expect(text).toContain('Shell commands')
    expect(text).toContain('git push, network tools and bulk delete stay denied')
    expect(text).toContain('Never applied to an unattended task')
    expect(document.querySelector('[data-slot="agent-permission-bypass-active"]')).toBeNull()
  })

  it('saves the narrow allow-rules level without any confirmation', async () => {
    serve()
    renderSection()
    await waitFor(() => expect(radio('allow-rules')).not.toBeNull())
    fireEvent.click(radio('allow-rules'))
    await waitFor(() => expect(puts()).toHaveLength(1))
    expect(puts()[0]!.body).toEqual({ agentPermissions: { antigravity: 'allow-rules' } })
  })

  it('asks before skipping all confirmations, and sends the confirmation the server requires', async () => {
    serve()
    renderSection()
    await waitFor(() => expect(radio('bypass')).not.toBeNull())
    fireEvent.click(radio('bypass'))
    expect(puts()).toHaveLength(0)
    const confirm = await screen.findByText('Skip confirmations')
    expect(screen.getByText(/barrier, not a sandbox/)).toBeTruthy()
    fireEvent.click(confirm)
    await waitFor(() => expect(puts()).toHaveLength(1))
    expect(puts()[0]!.body).toEqual({ agentPermissions: { antigravity: 'bypass', confirmBypass: true } })
    await waitFor(() => expect(document.querySelector('[data-slot="agent-permission-bypass-active"]')).not.toBeNull())
  })

  it('cancelling the confirmation changes nothing', async () => {
    serve()
    renderSection()
    await waitFor(() => expect(radio('bypass')).not.toBeNull())
    fireEvent.click(radio('bypass'))
    fireEvent.click(await screen.findByText('Cancel'))
    expect(puts()).toHaveLength(0)
    expect(radio('files-only').checked).toBe(true)
  })

  it('leaving bypass needs no confirmation', async () => {
    serve('bypass')
    renderSection()
    await waitFor(() => expect(document.querySelector('[data-slot="agent-permission-bypass-active"]')).not.toBeNull())
    fireEvent.click(radio('files-only'))
    await waitFor(() => expect(puts()).toHaveLength(1))
    expect(puts()[0]!.body).toEqual({ agentPermissions: { antigravity: 'files-only' } })
  })
})
