import { describe, expect, it } from 'vitest'
import { buildDigest } from './morning-digest'

const NOW = Date.parse('2026-11-01T08:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()
function run(id: string, patch: Record<string, unknown>) {
  return { id, title: id, createdAt: hoursAgo(30), steps: [], ...patch } as never
}

describe('buildDigest', () => {
  const runs = [
    run('ok', { status: 'done', finishedAt: hoursAgo(3), costUsd: 1.5, tokensUsed: 1000 }),
    run('old', { status: 'done', finishedAt: hoursAgo(20), costUsd: 9 }),
    run('bad', { status: 'failed', finishedAt: hoursAgo(5), costUsd: 0.5, tokensUsed: 50 }),
    run('capped', { status: 'cancelled', finishedAt: hoursAgo(2), limitHit: { kind: 'cost', limit: 10, used: 10, scope: 'run', at: hoursAgo(2) }, costUsd: 10 }),
    run('asking', { status: 'waiting', createdAt: hoursAgo(40) }),
    run('expired', { status: 'failed', finishedAt: hoursAgo(1), waitExpiredAt: hoursAgo(1) }),
    run('plain-cancel', { status: 'cancelled', finishedAt: hoursAgo(1) }),
    run('archived', { status: 'done', finishedAt: hoursAgo(1), archived: true }),
  ]

  it('groups what ended in the window by how it ended, with the spend', () => {
    const digest = buildDigest(runs, NOW, 12)
    expect(digest.groups.map((g) => [g.key, g.runs.map((r) => r.id)])).toEqual([
      ['attention', ['expired', 'asking']],
      ['limit', ['capped']],
      ['failed', ['bad']],
      ['done', ['ok']],
    ])
    expect(digest.costUsd).toBe(12)
    expect(digest.tokens).toBe(1050)
    expect(digest.total).toBe(5)
  })

  it('lists managers that finished without delegating', () => {
    const digest = buildDigest([...runs, run('lazy', { status: 'done', finishedAt: hoursAgo(2), managerDidNotDelegate: true })], NOW, 12)
    expect(digest.notDelegated.map((r) => r.id)).toEqual(['lazy'])
    expect(buildDigest(runs, NOW, 12).notDelegated).toEqual([])
  })

  it('widens with the window, and always keeps a task that is still waiting on you', () => {
    expect(buildDigest(runs, NOW, 24).groups.find((g) => g.key === 'done')?.runs.map((r) => r.id)).toEqual(['ok', 'old'])
    expect(buildDigest(runs, NOW, 1).groups.map((g) => g.key)).toEqual(['attention'])
  })
})
