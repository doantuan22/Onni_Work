import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TerminalSession } from '@onni/api-client'

/**
 * The project terminal page: opens empty, reattaches to what the project already has, starts an
 * agent only on a click, and asks before closing a tab that may be running something.
 */

const getProjectTerminal = vi.fn()
const createProjectTerminal = vi.fn()
const stopProjectTerminal = vi.fn(async () => undefined)

vi.mock('@/api/client', () => ({
  getProjectTerminal: (...args: unknown[]) => getProjectTerminal(...(args as [])),
  createProjectTerminal: (...args: unknown[]) => createProjectTerminal(...(args as [])),
  stopProjectTerminal: (...args: unknown[]) => stopProjectTerminal(...(args as [])),
  readProjectTerminal: vi.fn(),
  writeProjectTerminal: vi.fn(),
  resizeProjectTerminal: vi.fn(),
}))

vi.mock('@/api/queries', () => ({
  useHealth: () => ({
    data: {
      checks: [
        { name: 'codex', available: true },
        { name: 'claude', available: false },
      ],
    },
  }),
}))

// The emulator is not under test, and mounting it would drag xterm in.
vi.mock('../task-workspace/terminal-pane', () => ({
  TerminalPane: ({ session }: { session: TerminalSession }) => <div data-testid="pane" data-session={session.id} />,
}))

const { ProjectTerminalRoute } = await import('./project-terminal')

function session(id: string, overrides: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id,
    runId: 'project:default',
    cwd: '/tmp/project',
    shell: '/bin/zsh',
    cols: 80,
    rows: 24,
    startedAt: '2026-11-02T01:00:00.000Z',
    exitCode: null,
    label: `Terminal ${id}`,
    busy: false,
    topic: `terminal:${id}`,
    ...overrides,
  }
}

const state = (sessions: TerminalSession[] = []) => ({ available: true, sessions, shells: ['/bin/zsh'] })

/** Radix opens a menu on the trigger's keyboard activation; a pointer event is not needed. */
const openMenu = async () => {
  const trigger = await screen.findByRole('button', { name: 'New terminal' })
  await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false))
  fireEvent.keyDown(trigger, { key: 'Enter' })
}

describe('ProjectTerminalRoute', () => {
  beforeEach(() => {
    getProjectTerminal.mockReset()
    createProjectTerminal.mockReset()
    stopProjectTerminal.mockClear()
  })
  afterEach(cleanup)

  it('opens empty and never creates a shell on its own', async () => {
    getProjectTerminal.mockResolvedValue(state())
    render(<ProjectTerminalRoute />)
    await screen.findByText(/No terminals yet/)
    expect(createProjectTerminal).not.toHaveBeenCalled()
  })

  it('reattaches to the live tabs the project already has, ignoring an exited one', async () => {
    getProjectTerminal.mockResolvedValue(state([session('a'), session('b', { exitCode: 0 })]))
    render(<ProjectTerminalRoute />)
    await waitFor(() => expect(screen.getAllByTestId('pane')).toHaveLength(1))
    expect(screen.getByTestId('pane').getAttribute('data-session')).toBe('a')
  })

  it('starts an installed agent in a new tab, and keeps the other tabs', async () => {
    getProjectTerminal.mockResolvedValue(state([session('a')]))
    createProjectTerminal.mockResolvedValue(session('c', { label: 'codex', agent: 'codex' }))
    render(<ProjectTerminalRoute />)
    await screen.findByTestId('pane')

    await openMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: /Codex/ }))

    await waitFor(() => expect(createProjectTerminal).toHaveBeenCalledWith({ agent: 'codex' }))
    await waitFor(() => expect(screen.getAllByTestId('pane')).toHaveLength(2))
  })

  it('offers a shell with no agent', async () => {
    getProjectTerminal.mockResolvedValue(state())
    createProjectTerminal.mockResolvedValue(session('s'))
    render(<ProjectTerminalRoute />)
    await openMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Shell' }))
    await waitFor(() => expect(createProjectTerminal).toHaveBeenCalledWith({}))
  })

  it('disables an agent that is not installed', async () => {
    getProjectTerminal.mockResolvedValue(state())
    render(<ProjectTerminalRoute />)
    await openMenu()
    const claude = await screen.findByRole('menuitem', { name: /Claude Code/ })
    expect(claude.getAttribute('data-disabled')).not.toBeNull()
  })

  it('closes an idle tab at once but asks before closing a busy one', async () => {
    getProjectTerminal.mockResolvedValue(state([session('idle'), session('busy', { busy: true })]))
    render(<ProjectTerminalRoute />)
    await waitFor(() => expect(screen.getAllByTestId('pane')).toHaveLength(2))

    const closeButtons = screen.getAllByRole('button', { name: 'Close terminal' })
    fireEvent.click(closeButtons[0]!)
    await waitFor(() => expect(stopProjectTerminal).toHaveBeenCalledWith('idle'))

    fireEvent.click(screen.getAllByRole('button', { name: 'Close terminal' })[0]!)
    await screen.findByText('Close this terminal?')
    expect(stopProjectTerminal).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(stopProjectTerminal).toHaveBeenCalledWith('busy'))
  })

  // A poll that left before a tab was opened (or closed) answers after it. Applying that answer
  // used to drop the new tab for two seconds, or bring a just-closed one back.
  it('ignores a poll answer that was already in flight when a tab was opened', async () => {
    let release!: (value: ReturnType<typeof state>) => void
    getProjectTerminal
      .mockResolvedValueOnce(state())
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
      .mockResolvedValue(state())
    createProjectTerminal.mockResolvedValue(session('new'))
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      render(<ProjectTerminalRoute />)
      await screen.findByText(/No terminals yet/)
      await vi.advanceTimersByTimeAsync(2_100) // the second request is now pending

      await openMenu()
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Shell' }))
      await waitFor(() => expect(screen.getAllByTestId('pane')).toHaveLength(1))

      release(state()) // the stale answer: it predates the new tab
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })
      expect(screen.getAllByTestId('pane')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not bring a closed tab back from a poll answer that was already in flight', async () => {
    let release!: (value: ReturnType<typeof state>) => void
    const live = state([session('a')])
    getProjectTerminal
      .mockResolvedValueOnce(live)
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
      .mockResolvedValue(state())
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      render(<ProjectTerminalRoute />)
      await screen.findByTestId('pane')
      await vi.advanceTimersByTimeAsync(2_100)

      fireEvent.click(screen.getByRole('button', { name: 'Close terminal' }))
      await waitFor(() => expect(screen.queryAllByTestId('pane')).toHaveLength(0))

      release(live) // still lists the tab the user just closed
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })
      expect(screen.queryAllByTestId('pane')).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('treats an unknown busy state as busy and asks', async () => {
    getProjectTerminal.mockResolvedValue(state([session('x', { busy: null })]))
    render(<ProjectTerminalRoute />)
    await screen.findByTestId('pane')
    fireEvent.click(screen.getByRole('button', { name: 'Close terminal' }))
    await screen.findByText('Close this terminal?')
    expect(stopProjectTerminal).not.toHaveBeenCalled()
  })

  it('shows the server’s reason when the terminal is unavailable and disables New terminal', async () => {
    getProjectTerminal.mockResolvedValue({ available: false, reason: 'the terminal is disabled here', sessions: [] })
    render(<ProjectTerminalRoute />)
    await screen.findByText('the terminal is disabled here')
    expect((screen.getByRole('button', { name: 'New terminal' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
