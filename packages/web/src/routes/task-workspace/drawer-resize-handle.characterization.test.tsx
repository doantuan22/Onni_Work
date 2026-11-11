import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalSession } from '@onni/api-client'

const getRunTerminal = vi.fn()
vi.mock('@/api/client', () => ({
  getRunTerminal: (...args: unknown[]) => getRunTerminal(...args),
  createRunTerminal: vi.fn(), stopRunTerminal: vi.fn(), writeRunTerminal: vi.fn(),
}))
vi.mock('@/api/queries', () => ({ useHealth: () => ({ data: { repo: { root: '/tmp/project' }, capabilities: { terminal: true } } }) }))
vi.mock('./terminal-pane', () => ({ TerminalPane: () => null }))
vi.mock('./terminal-extras', () => ({ CommandPicker: () => null, DetectedUrlsStrip: () => null }))
import { TerminalDrawer } from './terminal-drawer'

afterEach(cleanup)

const session: TerminalSession = {
  id: 's1', runId: 'r1', cwd: '/tmp/wt/r1', shell: '/bin/sh', cols: 80, rows: 24,
  startedAt: '2026-11-11T00:00:00.000Z', exitCode: null, label: 'Terminal 1', busy: false, topic: 'terminal:s1',
}

describe('DrawerResizeHandle characterization', () => {
  it('exposes a horizontal separator range and pins its vertical keyboard map', async () => {
    getRunTerminal.mockResolvedValue({ available: true, sessions: [session] })
    const onHeightChange = vi.fn()
    render(<TerminalDrawer runId="r1" height={320} onHeightChange={onHeightChange} onClose={vi.fn()} onOpenInBrowser={() => true} />)
    const divider = await screen.findByRole('separator', { name: 'Resize terminal' })
    expect(divider.getAttribute('aria-orientation')).toBe('horizontal')
    expect(divider.getAttribute('aria-valuenow')).toBe('320')
    expect(divider.getAttribute('aria-valuemin')).toBe('120')
    expect(divider.getAttribute('aria-valuemax')).toBe('640')
    fireEvent.keyDown(divider, { key: 'ArrowUp' })
    fireEvent.keyDown(divider, { key: 'ArrowDown', shiftKey: true })
    fireEvent.keyDown(divider, { key: 'Home' })
    fireEvent.keyDown(divider, { key: 'End' })
    expect(onHeightChange.mock.calls.map(([height]) => height)).toEqual([336, 256, 640, 120])
  })
})
