import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_RUN_LIMITS, type Roster } from '@onni/api-client'

import type { TaskPreset, TaskSettingsSnapshot } from '@/lib/new-task-presets'

import { TaskSettingsPanel, TaskSummary } from './task-settings-panel'

const roster: Roster = {
  manager: { runner: 'claude' },
  workers: [{ runner: 'codex', role: '', maxConcurrent: 1 }],
}

const settings: TaskSettingsSnapshot = {
  runner: 'claude',
  model: 'sonnet',
  variants: 1,
  worktree: true,
  newBranch: false,
  autonomous: false,
  limits: { mode: 'default' },
  roster: null,
}

const quick: TaskPreset = { id: 'builtin-quick', name: 'Quick', origin: 'builtin', settings }
const overnight: TaskPreset = {
  id: 'builtin-overnight',
  name: 'Overnight (safe)',
  origin: 'builtin',
  settings: {
    ...settings,
    newBranch: true,
    autonomous: true,
    limits: DEFAULT_RUN_LIMITS,
  },
}
const mine: TaskPreset = {
  id: 'task-preset-5',
  name: 'Mine',
  origin: 'user',
  settings: { ...settings, model: 'opus' },
}
const manager: TaskPreset = {
  id: 'manager-review',
  name: 'Review pair',
  origin: 'manager-worker',
  settings: { ...settings, roster },
}

const nodes = {
  who: <p>who slot</p>,
  where: <p>where slot</p>,
  autonomy: <p>autonomy slot</p>,
  skill: <p>skill slot</p>,
  advanced: <p>advanced slot</p>,
}

function panel(overrides: Partial<ComponentProps<typeof TaskSettingsPanel>> = {}) {
  return (
    <TaskSettingsPanel
      open
      onOpenChange={() => {}}
      presets={[quick, overnight, manager]}
      selectedPresetId={null}
      modified={false}
      onApplyPreset={() => {}}
      onSavePreset={() => {}}
      onRenamePreset={() => {}}
      onDeletePreset={() => {}}
      focusSection={null}
      {...nodes}
      {...overrides}
    />
  )
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Task settings panel', () => {
  it('lists presets in order and applies one from its name', () => {
    const onApplyPreset = vi.fn()
    render(panel({ onApplyPreset }))
    const names = screen.getAllByRole('button', { pressed: false }).map((node) => node.textContent)
    expect(names.some((name) => name?.includes('Quick'))).toBe(true)
    expect(names.some((name) => name?.includes('Overnight (safe)'))).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /Overnight \(safe\)/ }))
    expect(onApplyPreset).toHaveBeenCalledWith(overnight)
  })

  it('shows "(modified)" on the selected preset and re-applying restores it', () => {
    const onApplyPreset = vi.fn()
    render(panel({ selectedPresetId: quick.id, modified: true, onApplyPreset }))
    const selected = screen.getByRole('button', { name: /Quick \(modified\)/ })
    expect(selected.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(selected)
    expect(onApplyPreset).toHaveBeenCalledWith(quick)
  })

  it('offers an explicit restore on a modified selection', () => {
    const onApplyPreset = vi.fn()
    render(panel({ selectedPresetId: quick.id, modified: true, onApplyPreset }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    expect(onApplyPreset).toHaveBeenCalledWith(quick)
  })

  it('does not offer restore while the selection is untouched', () => {
    render(panel({ selectedPresetId: quick.id, modified: false }))
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull()
  })

  it('saves the current settings under a typed name', () => {
    const onSavePreset = vi.fn()
    render(panel({ onSavePreset }))
    fireEvent.click(screen.getByRole('button', { name: /Save current as preset/ }))
    fireEvent.change(screen.getByLabelText('Preset name'), { target: { value: '  Review  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSavePreset).toHaveBeenCalledWith('Review')
  })

  it('renames and deletes only user presets', () => {
    const onRenamePreset = vi.fn()
    const onDeletePreset = vi.fn()
    render(panel({ presets: [quick, mine], onRenamePreset, onDeletePreset }))

    // Built-ins have no rename/delete affordances.
    expect(screen.queryByRole('button', { name: 'Rename Quick' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete Quick' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Rename Mine' }))
    fireEvent.change(screen.getByLabelText('Preset name'), { target: { value: 'Yours' } })
    fireEvent.keyDown(screen.getByLabelText('Preset name'), { key: 'Enter' })
    expect(onRenamePreset).toHaveBeenCalledWith(mine.id, 'Yours')

    fireEvent.click(screen.getByRole('button', { name: 'Delete Mine' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onDeletePreset).toHaveBeenCalledWith(mine.id)
  })

  it('disables a Manager–Worker preset that has no roster to apply', () => {
    render(
      panel({
        presets: [
          {
            ...manager,
            settings: { ...manager.settings, roster: null },
            unavailableReason: 'Choose a default manager–worker preset in Settings first.',
          },
        ],
      }),
    )
    const button = screen.getByRole('button', { name: /Review pair/ })
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(button.getAttribute('title')).toContain('Settings')
  })

  it('moves focus to the section a summary segment names', async () => {
    render(panel({ focusSection: { section: 'autonomy', nonce: 1 } }))
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('data-section')).toBe('autonomy'),
    )
  })

  it('collapses the advanced block until asked', () => {
    render(panel())
    expect(screen.queryByText('advanced slot')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
    expect(screen.getByText('advanced slot')).toBeTruthy()
  })

  it('opens Advanced when the summary asks for it', () => {
    render(panel({ focusSection: { section: 'advanced', nonce: 2 } }))
    expect(screen.getByText('advanced slot')).toBeTruthy()
  })

  it('hides the whole aside when collapsed', () => {
    render(panel({ open: false }))
    expect(screen.queryByRole('dialog', { name: 'Task settings' })).toBeNull()
  })
})

describe('Task settings panel as one wide surface', () => {
  it('opens as a large dialog with a left rail and a Close button', () => {
    const onOpenChange = vi.fn()
    render(panel({ onOpenChange }))
    expect(screen.getByRole('dialog', { name: 'Task settings' })).toBeTruthy()
    expect(document.querySelector('[data-slot="task-settings-nav"]')).not.toBeNull()
    fireEvent.click(document.querySelector('[data-slot="task-settings-done"]') as HTMLElement)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('renders nothing while closed', () => {
    render(panel({ open: false }))
    expect(screen.queryByRole('dialog', { name: 'Task settings' })).toBeNull()
  })
})

describe('Task summary', () => {
  it('renders every segment and opens the section it describes', () => {
    const onOpen = vi.fn()
    render(
      <TaskSummary
        onOpen={onOpen}
        segments={[
          { key: 'agent', label: 'claude', tone: 'normal', section: 'who' },
          { key: 'autonomous', label: 'autonomous', tone: 'danger', section: 'autonomy' },
          { key: 'limits', label: 'limits: ∞', tone: 'danger', section: 'autonomy' },
        ]}
      />,
    )
    expect(screen.getByText('claude')).toBeTruthy()
    expect(screen.getByText('autonomous').getAttribute('data-tone')).toBe('danger')
    fireEvent.click(screen.getByText('limits: ∞'))
    expect(onOpen).toHaveBeenCalledWith('autonomy')
  })

  it('offers one control that opens the panel at its presets', () => {
    const onOpen = vi.fn()
    render(<TaskSummary onOpen={onOpen} segments={[{ key: 'agent', label: 'claude', tone: 'normal', section: 'who' }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Task settings' }))
    expect(onOpen).toHaveBeenCalledWith('presets')
  })
})
