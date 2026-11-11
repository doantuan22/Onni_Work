import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  activatePaneFromPointerDown,
  activatePaneFromShortcut,
  activatePaneFromTabClick,
  ActivePaneProvider,
  paneShortcutAllowed,
  useActivePane,
} from './active-pane-context'

function PaneProbe() {
  const { activePaneId, setActive } = useActivePane()
  return (
    <>
      <output>{activePaneId ?? 'none'}</output>
      <button type="button" onPointerDown={() => activatePaneFromPointerDown(setActive, 'pointer')}>
        pointer
      </button>
      <button type="button" onClick={() => activatePaneFromTabClick(setActive, 'tab')}>
        tab
      </button>
      <button type="button" onClick={() => activatePaneFromShortcut(setActive, 'shortcut')}>
        shortcut
      </button>
    </>
  )
}

describe('ActivePaneContext', () => {
  it('starts at the supplied pane and changes only through explicit activation helpers', () => {
    render(
      <ActivePaneProvider initialActivePaneId="first">
        <PaneProbe />
      </ActivePaneProvider>,
    )

    expect(screen.getByRole('status').textContent).toBe('first')
    fireEvent.pointerDown(screen.getByRole('button', { name: 'pointer' }))
    expect(screen.getByRole('status').textContent).toBe('pointer')
    fireEvent.click(screen.getByRole('button', { name: 'tab' }))
    expect(screen.getByRole('status').textContent).toBe('tab')
    fireEvent.click(screen.getByRole('button', { name: 'shortcut' }))
    expect(screen.getByRole('status').textContent).toBe('shortcut')
  })
})

describe('paneShortcutAllowed', () => {
  it('yields to editable targets and xterm', () => {
    expect(paneShortcutAllowed(document.createElement('input'))).toBe(false)
    expect(paneShortcutAllowed(document.createElement('textarea'))).toBe(false)

    const terminal = document.createElement('div')
    terminal.className = 'xterm'
    const target = terminal.appendChild(document.createElement('div'))
    document.body.append(terminal)
    expect(paneShortcutAllowed(target)).toBe(false)
    terminal.remove()
  })

  it('yields when a dialog or menu owns the keyboard', () => {
    const root = document.createElement('div')
    root.innerHTML = '<div role="dialog"></div>'
    expect(paneShortcutAllowed(document.createElement('button'), root)).toBe(false)

    root.innerHTML = '<div role="menu"></div>'
    expect(paneShortcutAllowed(document.createElement('button'), root)).toBe(false)
  })

  it('allows a pane shortcut when nothing else owns it', () => {
    expect(paneShortcutAllowed(document.createElement('button'))).toBe(true)
  })
})
