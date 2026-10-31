import { describe, expect, it } from 'vitest'
import type { ProviderStatusResponse } from '@onni/api-client'
import { connectedBackends, describeRoster, disconnectedBackends, draftFromRoster, newPresetId, rosterFromDraft, starterDraft, totalConcurrency } from './roster'

const status = {
  providers: [
    { provider: 'claude', status: 'connected', enabled: true },
    { provider: 'codex', status: 'connected' },
    { provider: 'opencode', status: 'disconnected', enabled: true },
    { provider: 'cursor', status: 'connected', enabled: false },
    { provider: 'pi', status: 'not-installed' },
  ],
} as ProviderStatusResponse

describe('connectedBackends', () => {
  it('offers only backends that are connected and enabled, from the status — not a fixed list', () => {
    expect(connectedBackends(status)).toEqual(['claude', 'codex'])
    expect(connectedBackends(undefined)).toEqual([])
  })
})

describe('roster drafts', () => {
  it('starts from the first two connected backends', () => {
    const draft = starterDraft(['claude', 'codex'])
    expect(draft).toMatchObject({ managerRunner: 'claude', workers: [{ runner: 'codex', maxConcurrent: 1 }] })
  })
  it('round-trips through the contract and clamps concurrency', () => {
    const draft = { managerRunner: 'claude' as const, managerModel: ' opus ', workers: [{ runner: 'codex' as const, model: 'gpt-5', role: 'tests', maxConcurrent: 99 }] }
    const result = rosterFromDraft(draft)
    expect(result.ok && result.roster.workers[0]).toMatchObject({ model: 'gpt-5', maxConcurrent: 4 })
    expect(result.ok && result.roster.manager.model).toBe('opus')
    if (result.ok) expect(draftFromRoster(result.roster).workers[0]?.role).toBe('tests')
  })
  it('names the problem and the row', () => {
    expect(rosterFromDraft({ managerRunner: '', managerModel: '', workers: [{ runner: 'codex', model: '', role: '', maxConcurrent: 1 }] })).toMatchObject({ ok: false, error: expect.stringContaining('manager') })
    expect(rosterFromDraft({ managerRunner: 'claude', managerModel: 'a', workers: [{ runner: 'claude', model: 'a', role: '', maxConcurrent: 1 }] })).toMatchObject({ ok: false, error: expect.stringContaining('worker 1') })
    expect(rosterFromDraft({ managerRunner: 'claude', managerModel: '', workers: [] })).toMatchObject({ ok: false })
  })
})

describe('roster summaries', () => {
  const roster = { manager: { runner: 'claude', model: 'opus' }, workers: [{ runner: 'codex', model: 'gpt-5', role: '', maxConcurrent: 2 }, { runner: 'opencode', role: '', maxConcurrent: 1 }] } as never
  it('describes, counts concurrency and finds backends that went away', () => {
    expect(describeRoster(roster)).toBe('claude (opus) → codex (gpt-5), opencode')
    expect(totalConcurrency(roster)).toBe(3)
    expect(disconnectedBackends(roster, ['claude', 'codex'])).toEqual(['opencode'])
  })
  it('mints an unused preset id', () => {
    expect(newPresetId([{ id: 'preset-1' }, { id: 'preset-3' }] as never)).toBe('preset-3'.replace('3', '4') === 'preset-4' ? 'preset-4' : '')
  })
})
