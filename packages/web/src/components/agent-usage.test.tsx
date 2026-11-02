import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '@/api/query-client'
import { AgentUsage, formatSpan } from '@/components/agent-usage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const NOW = 1_800_000_000_000
const win = (id: string, used: number | null, resetIn: number) => ({
  id, kind: id === 'five_hour' ? 'five-hour' : 'weekly', applicability: 'all', models: [],
  resetsAt: NOW + resetIn, durationMinutes: null, usedPercent: used, status: 'allowed', observedAt: NOW - 120_000,
})

function serve(agents: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ agents, checkedAt: NOW }), { headers: { 'content-type': 'application/json' } })))
}
const mount = (provider: string) =>
  render(<QueryClientProvider client={createQueryClient()}><AgentUsage provider={provider} now={NOW} /></QueryClientProvider>)

describe('formatSpan', () => {
  it('words minutes, hours and days', () => {
    expect(formatSpan(0, 45 * 60_000)).toBe('45 min')
    expect(formatSpan(0, 135 * 60_000)).toBe('2 h 15 min')
    expect(formatSpan(0, (3 * 24 + 4) * 3_600_000)).toBe('3 d 4 h')
  })
})

describe('AgentUsage', () => {
  it('draws a bar per window with the reset time and the last update', async () => {
    serve([{ provider: 'claude', support: 'observed', state: 'ok', observedAt: NOW - 120_000, windows: [win('five_hour', 69, 3_600_000), win('seven_day', 91, 2 * 86_400_000)] }])
    mount('claude')
    await waitFor(() => expect(document.querySelectorAll('[data-slot="usage-window"]')).toHaveLength(2))
    const text = document.querySelector('[data-slot="agent-usage"]')!.textContent!
    expect(text).toContain('69%')
    expect(text).toContain('91%')
    expect(text).toContain('Resets in 1 h 0 min')
    expect(text).toContain('updated 2 min ago')
    // 91 % is past the danger line.
    expect(document.querySelectorAll('[role="progressbar"] > div')[1]!.className).toContain('bg-danger')
  })

  it('says plainly that an agent without a limit source is not supported', async () => {
    serve([{ provider: 'opencode', support: 'unsupported', state: 'none', observedAt: null, windows: [], reason: 'OpenCode only reports local token and cost totals, not the provider limit.' }])
    mount('opencode')
    await waitFor(() => expect(document.querySelector('[data-slot="usage-unsupported"]')).not.toBeNull())
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(document.querySelector('[data-action="usage-refresh"]')).toBeNull()
  })

  it('shows "no data yet" rather than a zero when nothing was observed', async () => {
    serve([{ provider: 'claude', support: 'observed', state: 'none', observedAt: null, windows: [] }])
    mount('claude')
    await waitFor(() => expect(document.querySelector('[data-slot="usage-none"]')).not.toBeNull())
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('degrades to an unavailable line when the read fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    mount('codex')
    await waitFor(() => expect(document.querySelector('[data-slot="usage-unavailable"]')).not.toBeNull())
  })
})
