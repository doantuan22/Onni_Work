import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RosterEditor } from './roster-editor'
import type { RosterDraft } from '@/lib/roster'

afterEach(cleanup)

const draft: RosterDraft = {
  managerRunner: 'claude',
  managerModel: '',
  workers: [{ runner: 'codex', model: '', role: '', maxConcurrent: 1 }],
}

describe('RosterEditor', () => {
  it('offers only the connected backends', () => {
    render(<RosterEditor draft={draft} onChange={vi.fn()} connected={['claude', 'codex']} />)
    const options = Array.from((screen.getByLabelText('Worker 1 backend') as HTMLSelectElement).options).map((o) => o.value)
    expect(options).toEqual(['', 'claude', 'codex'])
  })
  it('flags a chosen backend that has gone away rather than hiding it', () => {
    render(<RosterEditor draft={{ ...draft, workers: [{ ...draft.workers[0]!, runner: 'opencode' }] }} onChange={vi.fn()} connected={['claude']} />)
    expect(screen.getAllByRole('option', { name: 'opencode (not connected)' }).length).toBeGreaterThan(0)
  })
  it('edits a worker role and model, adds workers, and keeps at least one', () => {
    const onChange = vi.fn()
    render(<RosterEditor draft={draft} onChange={onChange} connected={['claude', 'codex']} />)
    fireEvent.change(screen.getByLabelText('Worker 1 role'), { target: { value: 'backend tests' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...draft, workers: [{ ...draft.workers[0], role: 'backend tests' }] })
    fireEvent.change(screen.getByLabelText('Worker 1 model'), { target: { value: 'gpt-5' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...draft, workers: [{ ...draft.workers[0], model: 'gpt-5' }] })
    fireEvent.click(screen.getByText('Add worker'))
    expect(onChange.mock.calls.at(-1)![0].workers).toHaveLength(2)
    expect((screen.getByLabelText('Remove worker 1') as HTMLButtonElement).disabled).toBe(true)
  })
  it('says plainly that nothing is connected, and that the fence is not a security boundary', () => {
    render(<RosterEditor draft={draft} onChange={vi.fn()} connected={[]} />)
    expect(screen.getByText(/No agent is connected/)).toBeTruthy()
    expect(screen.getByText(/not a security boundary/)).toBeTruthy()
  })
})
