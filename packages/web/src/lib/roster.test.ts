import { describe, expect, it } from 'vitest'
import { rosterSchema, type ProviderStatusResponse } from '@onni/api-client'
import { connectedBackends, describeRoster, disconnectedBackends, draftFromRoster, managerCapable, newPresetId, rosterFromDraft, starterDraft, totalConcurrency } from './roster'

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
    const draft = { managerRunner: 'claude' as const, managerModel: ' opus ', workers: [{ runner: 'codex' as const, model: 'gpt-5', role: 'tests', kinds: [] as never[], tier: '' as const, maxConcurrent: 99 }] }
    const result = rosterFromDraft(draft)
    expect(result.ok && result.roster.workers[0]).toMatchObject({ model: 'gpt-5', maxConcurrent: 4 })
    expect(result.ok && result.roster.manager.model).toBe('opus')
    if (result.ok) expect(draftFromRoster(result.roster).workers[0]?.role).toBe('tests')
  })
  it('carries tier and kinds through the contract and back', () => {
    const draft = { managerRunner: 'claude' as const, managerModel: '', workers: [{ runner: 'codex' as const, model: '', role: '', kinds: ['test' as const, 'review' as const], tier: 'light' as const, maxConcurrent: 1 }] }
    const result = rosterFromDraft(draft)
    expect(result.ok && result.roster.workers[0]).toMatchObject({ tier: 'light', kinds: ['test', 'review'] })
    if (result.ok) expect(draftFromRoster(result.roster).workers[0]).toMatchObject({ tier: 'light', kinds: ['test', 'review'] })
  })
  it('sends a worker that states neither exactly as before: no tier and no kinds key at all', () => {
    const result = rosterFromDraft({ managerRunner: 'claude', managerModel: '', workers: [{ runner: 'codex', model: '', role: 'docs', kinds: [], tier: '', maxConcurrent: 1 }] })
    expect(result.ok && result.roster.workers[0]).toEqual({ runner: 'codex', role: 'docs', maxConcurrent: 1 })
    if (result.ok) expect(JSON.stringify(result.roster)).not.toMatch(/tier|kinds/)
  })
  it('reads a saved roster from before tier and kinds existed as an unset draft', () => {
    const old = rosterSchema.parse({ manager: { runner: 'claude' }, workers: [{ runner: 'codex', role: 'docs' }] })
    expect(draftFromRoster(old).workers[0]).toMatchObject({ kinds: [], tier: '' })
  })
  it('names the problem and the row', () => {
    expect(rosterFromDraft({ managerRunner: '', managerModel: '', workers: [{ runner: 'codex', model: '', role: '', kinds: [], tier: '', maxConcurrent: 1 }] })).toMatchObject({ ok: false, error: expect.stringContaining('manager') })
    expect(rosterFromDraft({ managerRunner: 'claude', managerModel: 'a', workers: [{ runner: 'claude', model: 'a', role: '', kinds: [], tier: '', maxConcurrent: 1 }] })).toMatchObject({ ok: false, error: expect.stringContaining('worker 1') })
    expect(rosterFromDraft({ managerRunner: 'claude', managerModel: '', workers: [] })).toMatchObject({ ok: false })
  })
})

describe('antigravity is a worker, not a manager', () => {
  it('a starter draft never makes it the manager, even when it is the first connected backend', () => {
    const draft = starterDraft(['antigravity', 'codex'])
    expect(draft.managerRunner).toBe('codex')
    expect(draft.workers[0]?.runner).toBe('antigravity')
    expect(starterDraft(['antigravity']).managerRunner).toBe('')
  })
  it('the contract refuses it as the manager and names the reason, and accepts it as a worker', () => {
    const refused = rosterFromDraft({ managerRunner: 'antigravity', managerModel: '', workers: [{ runner: 'claude', model: '', role: '', kinds: [], tier: '', maxConcurrent: 1 }] })
    expect(refused).toMatchObject({ ok: false, error: expect.stringContaining('cannot be a manager') })
    expect(rosterFromDraft({ managerRunner: 'claude', managerModel: '', workers: [{ runner: 'antigravity', model: 'claude-sonnet-4-6', role: 'edits', kinds: [], tier: '', maxConcurrent: 2 }] })).toMatchObject({ ok: true })
  })
  it('managerCapable keeps the order and drops only what cannot manage', () => {
    expect(managerCapable(['claude', 'antigravity', 'pi'])).toEqual(['claude', 'pi'])
  })
})

describe('roster summaries', () => {
  const roster = { manager: { runner: 'claude', model: 'opus' }, workers: [{ runner: 'codex', model: 'gpt-5', role: '', kinds: [], tier: '', maxConcurrent: 2 }, { runner: 'opencode', role: '', kinds: [], tier: '', maxConcurrent: 1 }] } as never
  it('describes, counts concurrency and finds backends that went away', () => {
    expect(describeRoster(roster)).toBe('claude (opus) → codex (gpt-5), opencode')
    expect(totalConcurrency(roster)).toBe(3)
    expect(disconnectedBackends(roster, ['claude', 'codex'])).toEqual(['opencode'])
  })
  it('mints an unused preset id', () => {
    expect(newPresetId([{ id: 'preset-1' }, { id: 'preset-3' }] as never)).toBe('preset-3'.replace('3', '4') === 'preset-4' ? 'preset-4' : '')
  })
})
