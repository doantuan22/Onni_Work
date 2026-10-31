import { cleanup, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'

import { DeniedActionsHint, parseDeniedAction } from './denied-actions-hint'

afterEach(cleanup)

const RECORDED = 'antigravity: denied run_command `npm test` (permission level "Files only")'

function show(deniedActions?: string[]) {
  return render(
    <MemoryRouter>
      <DeniedActionsHint run={{ deniedActions }} />
    </MemoryRouter>,
  )
}

describe('parseDeniedAction', () => {
  it('splits what was tried from the level that refused it', () => {
    expect(parseDeniedAction(RECORDED)).toEqual({ action: 'run_command `npm test`', level: 'Files only' })
  })
  it('keeps a line it cannot split, whole', () => {
    expect(parseDeniedAction('something else')).toEqual({ action: 'something else' })
  })
})

describe('DeniedActionsHint', () => {
  it('renders nothing for a task nothing was denied on', () => {
    expect(show().container.innerHTML).toBe('')
    expect(show([]).container.innerHTML).toBe('')
  })

  it('lists each denied action with the level and a reason, and links to the setting', () => {
    show([RECORDED, 'antigravity: denied run_command `git push` (permission level "Allow-rules")'])
    const hint = document.querySelector('[data-slot="denied-actions-hint"]')!
    expect(hint.textContent).toContain('2 actions denied')
    expect(hint.textContent).toContain('Files only, Allow-rules')
    const items = [...document.querySelectorAll('[data-slot="denied-action"]')]
    expect(items).toHaveLength(2)
    expect(items[0]!.querySelector('code')!.textContent).toBe('run_command `npm test`')
    expect(items[0]!.textContent).toContain('cannot ask for approval')
    expect(items[0]!.textContent).toContain('“Files only” level')
    expect(document.querySelector('[data-slot="denied-actions-settings-link"]')!.getAttribute('href')).toBe('/settings/global/agent-permissions')
  })

  it('says "1 action … it" for one, and shows a line it cannot split without a level', () => {
    show(['odd line'])
    const hint = document.querySelector('[data-slot="denied-actions-hint"]')!
    expect(hint.textContent).toContain('1 action denied')
    expect(hint.textContent).toContain('without it')
    expect(document.querySelector('[data-slot="denied-action"]')!.textContent).toContain('Denied by the agent’s permission level.')
  })
})
