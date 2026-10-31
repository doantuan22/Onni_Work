import { describe, expect, it } from 'vitest'
import { describeRow, draftFromLimits, limitRows, requestFromDraft, tightestRow } from './run-limits'

const steps = [{ iterations: 2 }, { iterations: 3 }] as never

describe('limitRows', () => {
  it('shows used / ceiling for each capped axis and nothing for blank or unlimited ones', () => {
    const rows = limitRows({ steps, costUsd: 2.5, tokensUsed: 500, limitUsage: { wallMs: 30 * 60_000 }, runner: 'claude', limits: { mode: 'capped', maxCostUsd: 10, maxStepIterations: 10 } })
    expect(rows.map((r) => [r.kind, r.used, r.limit, r.fraction])).toEqual([['cost', 2.5, 10, 0.25], ['iterations', 5, 10, 0.5]])
    expect(tightestRow(rows)?.kind).toBe('iterations')
    expect(limitRows({ steps, runner: 'claude', limits: { mode: 'none' } } as never)).toEqual([])
    expect(limitRows({ steps, runner: 'claude' } as never)).toEqual([])
  })
  it('says so when the backend reports no USD, and does not count it toward the tightest bar', () => {
    const rows = limitRows({ steps, costUsd: 99, runner: 'codex', limits: { mode: 'capped', maxCostUsd: 1, maxTokens: 100 }, tokensUsed: 10 } as never)
    expect(rows[0]).toMatchObject({ kind: 'cost', measured: false, fraction: 0 })
    expect(describeRow(rows[0]!)).toContain('not reported')
    expect(tightestRow(rows)?.kind).toBe('tokens')
  })
})

describe('the limits draft', () => {
  it('round-trips the shipped default and validates what a person types', () => {
    const draft = draftFromLimits({ mode: 'capped', maxCostUsd: 10, maxTokens: 10_000_000, maxWallClockMinutes: 240, maxStepIterations: 30 })
    expect(requestFromDraft(draft)).toEqual({ ok: true, request: { mode: 'capped', maxCostUsd: 10, maxTokens: 10_000_000, maxWallClockMinutes: 240, maxStepIterations: 30 } })
    expect(requestFromDraft({ ...draft, cost: '', time: '' })).toEqual({ ok: true, request: { mode: 'capped', maxTokens: 10_000_000, maxStepIterations: 30 } })
    expect(requestFromDraft({ ...draft, tokens: '1.5' })).toMatchObject({ ok: false })
    expect(requestFromDraft({ ...draft, cost: '-1' })).toMatchObject({ ok: false })
    expect(requestFromDraft({ ...draft, mode: 'none' })).toEqual({ ok: true, request: { mode: 'none' } })
    expect(requestFromDraft({ ...draft, mode: 'default' })).toEqual({ ok: true, request: { mode: 'default' } })
  })
})
