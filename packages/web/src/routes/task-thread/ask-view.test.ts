import { describe, expect, it } from 'vitest'

import type { RunRecord } from '@onni/api-client'

import { askNeedsAnswer, isManagerAskOpen, openAskCard } from './ask-view'

const run = (softAsk?: { requestId: string }): Pick<RunRecord, 'dispatch'> =>
  ({ dispatch: softAsk ? ({ rootRunId: 'root', softAsk: { askedAt: '2026-11-03T00:00:00.000Z', question: 'which?', optionCount: 0, ...softAsk } } as RunRecord['dispatch']) : undefined })

const ask = (id: string, patch: { fromManager?: boolean; resolved?: boolean } = {}) => ({ id, resolved: false, ...patch })

/**
 * Plan v2 §9: a manager ask and a Guard ask can be in the transcript at once. The record decides
 * the manager card's open state (a free message must not close it), and the Guard card wins when
 * both are open — then the manager card comes back as soon as the Guard one is answered.
 */
describe('ask card selection', () => {
  it('a manager ask is open exactly while the record holds its requestId', () => {
    expect(isManagerAskOpen(run({ requestId: 'q-1' }), ask('q-1', { fromManager: true }))).toBe(true)
    expect(isManagerAskOpen(run({ requestId: 'q-1' }), ask('q-2', { fromManager: true }))).toBe(false)
    expect(isManagerAskOpen(run(undefined), ask('q-1', { fromManager: true }))).toBe(false)
    // A workflow ask is never "open by record" — the reducer owns it.
    expect(isManagerAskOpen(run({ requestId: 'q-1' }), ask('q-1'))).toBe(false)
  })

  it('a free message does not close a manager card; a resolved workflow card stays closed', () => {
    expect(askNeedsAnswer(run({ requestId: 'q-1' }), ask('q-1', { fromManager: true }))).toBe(true)
    expect(askNeedsAnswer(run(undefined), ask('q-1', { fromManager: true }))).toBe(false)
    expect(askNeedsAnswer(run(undefined), ask('w-1', { resolved: false }))).toBe(true)
    expect(askNeedsAnswer(run(undefined), ask('w-1', { resolved: true }))).toBe(false)
  })

  it('points at the Guard ask first, then the open manager ask, then nothing', () => {
    const guard = ask('g-1')
    const manager = ask('q-1', { fromManager: true })
    const held = run({ requestId: 'q-1' })
    expect(openAskCard(held, [manager, guard])?.id).toBe('g-1')
    expect(openAskCard(held, [manager, { ...guard, resolved: true }])?.id).toBe('q-1')
    expect(openAskCard(run(undefined), [{ ...guard, resolved: true }])).toBeUndefined()
  })
})
