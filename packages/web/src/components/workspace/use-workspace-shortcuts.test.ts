import { act, cleanup, fireEvent, renderHook } from '@testing-library/react'
import * as React from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createWorkspaceState,
  openDraft,
  openRun,
  readWorkspaceState,
  resetWorkspaceStateStores,
  writeWorkspaceState,
} from '@/lib/workspace-state'
import { readStoredRailOverride, TOGGLE_NAVIGATOR_EVENT, useRailState } from '@/lib/rail-state'
import { readStoredDrawerState, TOGGLE_DRAWER_EVENT, writeDrawerState } from '@/routes/task-workspace/drawer-state'

import { ActivePaneProvider, useActivePane } from './active-pane-context'
import { useWorkspaceShortcuts, workspaceShortcutAllowed } from './use-workspace-shortcuts'

function createKeydown(
  key: string,
  code: string,
  mods: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {},
): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key,
    code,
    bubbles: true,
    cancelable: true,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  })
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  resetWorkspaceStateStores()
  vi.unstubAllGlobals()
})

describe('workspaceShortcutAllowed', () => {
  it('allows shortcuts on neutral elements', () => {
    const btn = document.createElement('button')
    expect(workspaceShortcutAllowed(btn)).toBe(true)
  })

  it('yields to editable targets', () => {
    expect(workspaceShortcutAllowed(document.createElement('input'))).toBe(false)
    expect(workspaceShortcutAllowed(document.createElement('textarea'))).toBe(false)
    expect(workspaceShortcutAllowed(document.createElement('select'))).toBe(false)

    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    expect(workspaceShortcutAllowed(editable)).toBe(false)
  })

  it('yields inside xterm', () => {
    const terminal = document.createElement('div')
    terminal.className = 'xterm'
    const target = terminal.appendChild(document.createElement('div'))
    document.body.append(terminal)
    expect(workspaceShortcutAllowed(target)).toBe(false)
    terminal.remove()
  })

  it('yields when a dialog, alertdialog, or menu is open', () => {
    const root = document.createElement('div')
    root.innerHTML = '<div role="dialog"></div>'
    expect(workspaceShortcutAllowed(document.createElement('button'), root)).toBe(false)

    root.innerHTML = '<div role="alertdialog"></div>'
    expect(workspaceShortcutAllowed(document.createElement('button'), root)).toBe(false)

    root.innerHTML = '<div role="menu"></div>'
    expect(workspaceShortcutAllowed(document.createElement('button'), root)).toBe(false)
  })

  it('yields when a listbox is open', () => {
    const root = document.createElement('div')
    root.innerHTML = '<div role="listbox"></div>'
    expect(workspaceShortcutAllowed(document.createElement('button'), root)).toBe(false)
  })
})

describe('useWorkspaceShortcuts', () => {
  const projectId = 'shop'

  function renderShortcuts(options: {
    initialActivePaneId?: string
    navigate?: (to: string) => void
  } = {}) {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/p/shop/tasks/run-1'] },
        React.createElement(
          ActivePaneProvider,
          { initialActivePaneId: options.initialActivePaneId ?? null, children },
        ),
      )

    return renderHook(
      () =>
        useWorkspaceShortcuts({
          projectId,
          ...(options.navigate ? { navigate: options.navigate } : {}),
        }),
      { wrapper },
    )
  }

  it('switches to the Nth open thread with Alt+1..9 and navigates', () => {
    const run1 = { kind: 'run' as const, paneId: 'run:shop:run-1', projectId, runId: 'run-1' }
    const run2 = { kind: 'run' as const, paneId: 'run:shop:run-2', projectId, runId: 'run-2' }
    const draft = { kind: 'draft' as const, paneId: 'draft:shop', projectId, draftId: 'default' }

    let state = openRun(createWorkspaceState(), run1)
    state = openRun(state, run2)
    state = openDraft(state, draft)
    writeWorkspaceState(projectId, state)

    const navigations: string[] = []
    renderShortcuts({
      initialActivePaneId: run1.paneId,
      navigate: (to) => navigations.push(to),
    })

    // Alt+2 switches to thread 2 (run-2)
    const eventAlt2 = createKeydown('2', 'Digit2', { altKey: true })
    window.dispatchEvent(eventAlt2)

    expect(eventAlt2.defaultPrevented).toBe(true)
    expect(readWorkspaceState(projectId).active).toBe('run:shop:run-2')
    expect(navigations).toContain('/p/shop/tasks/run-2')

    // Alt+3 switches to thread 3 (draft)
    const eventAlt3 = createKeydown('3', 'Digit3', { altKey: true })
    window.dispatchEvent(eventAlt3)

    expect(eventAlt3.defaultPrevented).toBe(true)
    expect(readWorkspaceState(projectId).active).toBe('draft:shop')
    expect(navigations).toContain('/p/shop/new')

    // Alt+4 is absent (only 3 threads open) -> ignored, default not prevented
    const eventAlt4 = createKeydown('4', 'Digit4', { altKey: true })
    window.dispatchEvent(eventAlt4)

    expect(eventAlt4.defaultPrevented).toBe(false)
    expect(readWorkspaceState(projectId).active).toBe('draft:shop')
  })

  it('toggles navigator rail with Mod+Alt+Left', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' })
    const events: unknown[] = []
    const listener = (e: Event) => events.push((e as CustomEvent).detail)
    window.addEventListener(TOGGLE_NAVIGATOR_EVENT, listener)

    renderShortcuts()

    const event = createKeydown('ArrowLeft', 'ArrowLeft', { metaKey: true, altKey: true })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(events).toEqual([{ projectId: 'shop' }])

    window.removeEventListener(TOGGLE_NAVIGATOR_EVENT, listener)
  })

  it('integrates toggle navigator rail with useRailState', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' })

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/p/shop/tasks/run-1'] },
        React.createElement(ActivePaneProvider, { children }),
      )

    const { result: railResult } = renderHook(() => useRailState(projectId, 1), { wrapper })
    renderHook(() => useWorkspaceShortcuts({ projectId }), { wrapper })

    expect(railResult.current.collapsed).toBe(false)

    // Trigger toggle via Mod+Alt+Left
    act(() => {
      const event = createKeydown('ArrowLeft', 'ArrowLeft', { metaKey: true, altKey: true })
      window.dispatchEvent(event)
    })

    expect(readStoredRailOverride(projectId)).toBe('collapsed')
    expect(railResult.current.collapsed).toBe(true)
  })

  it('toggles context area with Mod+Alt+Right', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' })

    const run1 = { kind: 'run' as const, paneId: 'run:shop:run-1', projectId, runId: 'run-1' }
    const state = openRun(createWorkspaceState(), run1)
    writeWorkspaceState(projectId, state)

    renderShortcuts({ initialActivePaneId: run1.paneId })

    expect(readWorkspaceState(projectId).context.open).toBe(false)

    // Toggle open
    const event1 = createKeydown('ArrowRight', 'ArrowRight', { metaKey: true, altKey: true })
    window.dispatchEvent(event1)

    expect(event1.defaultPrevented).toBe(true)
    expect(readWorkspaceState(projectId).context.open).toBe(true)

    // Toggle closed
    const event2 = createKeydown('ArrowRight', 'ArrowRight', { metaKey: true, altKey: true })
    window.dispatchEvent(event2)

    expect(event2.defaultPrevented).toBe(true)
    expect(readWorkspaceState(projectId).context.open).toBe(false)
  })

  it('keeps context area closed if active pane is a draft', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' })

    const draft = { kind: 'draft' as const, paneId: 'draft:shop', projectId, draftId: 'default' }
    const state = openDraft(createWorkspaceState(), draft)
    writeWorkspaceState(projectId, state)

    renderShortcuts({ initialActivePaneId: draft.paneId })

    const event = createKeydown('ArrowRight', 'ArrowRight', { metaKey: true, altKey: true })
    window.dispatchEvent(event)

    expect(readWorkspaceState(projectId).context.open).toBe(false)
  })

  it('toggles terminal drawer with Mod+Alt+Down and persists open state', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' })

    const run1 = { kind: 'run' as const, paneId: 'run:shop:run-1', projectId, runId: 'run-1' }
    const state = openRun(createWorkspaceState(), run1)
    writeWorkspaceState(projectId, state)

    const drawerEvents: unknown[] = []
    const listener = (e: Event) => drawerEvents.push((e as CustomEvent).detail)
    window.addEventListener(TOGGLE_DRAWER_EVENT, listener)

    renderShortcuts({ initialActivePaneId: run1.paneId })

    expect(readStoredDrawerState('run-1').open).toBe(false)

    // Toggle open
    const event1 = createKeydown('ArrowDown', 'ArrowDown', { metaKey: true, altKey: true })
    window.dispatchEvent(event1)

    expect(event1.defaultPrevented).toBe(true)
    expect(readStoredDrawerState('run-1').open).toBe(true)
    expect(drawerEvents.at(-1)).toEqual({ taskId: 'run-1', state: { open: true, height: 256 } })

    // Toggle closed
    const event2 = createKeydown('ArrowDown', 'ArrowDown', { metaKey: true, altKey: true })
    window.dispatchEvent(event2)

    expect(event2.defaultPrevented).toBe(true)
    expect(readStoredDrawerState('run-1').open).toBe(false)

    window.removeEventListener(TOGGLE_DRAWER_EVENT, listener)
  })

  it('yields when typing in an input', () => {
    const run1 = { kind: 'run' as const, paneId: 'run:shop:run-1', projectId, runId: 'run-1' }
    const run2 = { kind: 'run' as const, paneId: 'run:shop:run-2', projectId, runId: 'run-2' }
    let state = openRun(createWorkspaceState(), run1)
    state = openRun(state, run2)
    state = { ...state, active: run1.paneId }
    writeWorkspaceState(projectId, state)

    renderShortcuts({ initialActivePaneId: run1.paneId })

    const input = document.createElement('input')
    document.body.append(input)
    input.focus()

    fireEvent.keyDown(input, { key: '2', code: 'Digit2', altKey: true })

    expect(readWorkspaceState(projectId).active).toBe('run:shop:run-1')

    input.remove()
  })

  it('yields when typing in an xterm terminal element', () => {
    const run1 = { kind: 'run' as const, paneId: 'run:shop:run-1', projectId, runId: 'run-1' }
    const run2 = { kind: 'run' as const, paneId: 'run:shop:run-2', projectId, runId: 'run-2' }
    let state = openRun(createWorkspaceState(), run1)
    state = openRun(state, run2)
    state = { ...state, active: run1.paneId }
    writeWorkspaceState(projectId, state)

    renderShortcuts({ initialActivePaneId: run1.paneId })

    const term = document.createElement('div')
    term.className = 'xterm'
    const xtermTextarea = document.createElement('textarea')
    term.append(xtermTextarea)
    document.body.append(term)
    xtermTextarea.focus()

    fireEvent.keyDown(xtermTextarea, { key: '2', code: 'Digit2', altKey: true })

    expect(readWorkspaceState(projectId).active).toBe('run:shop:run-1')

    term.remove()
  })

  it('yields when a listbox is present in DOM', () => {
    const listbox = document.createElement('div')
    listbox.setAttribute('role', 'listbox')
    document.body.append(listbox)

    const run1 = { kind: 'run' as const, paneId: 'run:shop:run-1', projectId, runId: 'run-1' }
    const state = openRun(createWorkspaceState(), run1)
    writeWorkspaceState(projectId, state)

    renderShortcuts({ initialActivePaneId: run1.paneId })

    const event = createKeydown('ArrowLeft', 'ArrowLeft', { metaKey: true, altKey: true })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)

    listbox.remove()
  })

  it('yields when a modal dialog is present in DOM', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.append(dialog)

    const run1 = { kind: 'run' as const, paneId: 'run:shop:run-1', projectId, runId: 'run-1' }
    const state = openRun(createWorkspaceState(), run1)
    writeWorkspaceState(projectId, state)

    renderShortcuts({ initialActivePaneId: run1.paneId })

    const event = createKeydown('ArrowLeft', 'ArrowLeft', { metaKey: true, altKey: true })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)

    dialog.remove()
  })

  it('supports Mod chord on Windows/Linux via ctrlKey', () => {
    vi.stubGlobal('navigator', { platform: 'Win32' })

    const run1 = { kind: 'run' as const, paneId: 'run:shop:run-1', projectId, runId: 'run-1' }
    const state = openRun(createWorkspaceState(), run1)
    writeWorkspaceState(projectId, state)

    renderShortcuts({ initialActivePaneId: run1.paneId })

    // On Windows, Mod is Ctrl
    const event = createKeydown('ArrowRight', 'ArrowRight', { ctrlKey: true, altKey: true })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(readWorkspaceState(projectId).context.open).toBe(true)
  })
})
