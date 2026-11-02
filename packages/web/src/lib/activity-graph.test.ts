import { describe, expect, it } from 'vitest'
import type { ApiRun } from '@onni/api-client'

import { buildActivityGraph, COLLAPSE_ABOVE, NODE_WIDTH, rootOf, runActivityState } from '@/lib/activity-graph'

const run = (over: Record<string, unknown>): ApiRun =>
  ({ id: 'r', title: 'task', status: 'running', createdAt: '2026-11-02T10:00:00Z', steps: [], workflow: 'w', task: 't', ...over }) as unknown as ApiRun

const MANAGER = run({ id: 'm', title: 'manager', runner: 'claude', model: 'opus', roster: { manager: { runner: 'claude' }, workers: [] }, dispatch: { rootRunId: 'm' }, activity: 'monitoring' })
const worker = (id: string, over: Record<string, unknown> = {}) =>
  run({ id, title: `worker ${id}`, runner: 'codex', createdAt: `2026-11-02T10:00:${id.padStart(2, '0').slice(-2)}Z`, dispatch: { rootRunId: 'm', parentRunId: 'm' }, ...over })

describe('runActivityState', () => {
  it.each([
    [{ status: 'queued' }, 'queued'],
    [{ status: 'running' }, 'running'],
    [{ status: 'running', activity: 'monitoring' }, 'monitoring'],
    [{ status: 'waiting' }, 'asking'],
    [{ status: 'done' }, 'done'],
    [{ status: 'review' }, 'done'],
    [{ status: 'cancelled' }, 'cancelled'],
    [{ status: 'failed', error: 'timeout' }, 'failed'],
    [{ status: 'failed', error: "antigravity was blocked — blocked by Onni's permission level" }, 'blocked'],
    [{ status: 'failed', deniedActions: ['run_command x'] }, 'blocked'],
  ])('%j → %s', (input, expected) => {
    expect(runActivityState(input as never)).toBe(expected)
  })
})

describe('buildActivityGraph', () => {
  it('draws a single task as one node, with no edges', () => {
    const solo = run({ id: 's', runner: 'claude' })
    const g = buildActivityGraph([solo], 's')
    expect(g.nodes).toHaveLength(1)
    expect(g.nodes[0]).toMatchObject({ id: 's', role: 'solo', state: 'running' })
    expect(g.edges).toEqual([])
  })

  it('puts the manager on top and each worker below, with assign edges and a report edge once settled', () => {
    const g = buildActivityGraph([MANAGER, worker('1', { status: 'running' }), worker('2', { status: 'done', finishedAt: '2026-11-02T10:05:00Z' })], 'm', { now: Date.parse('2026-11-02T10:05:03Z') })
    const mgr = g.nodes.find((n) => n.id === 'm')!
    expect(mgr).toMatchObject({ role: 'manager', state: 'monitoring' })
    const workers = g.nodes.filter((n) => n.role === 'worker')
    expect(workers.every((w) => w.position.y > mgr.position.y)).toBe(true)
    expect(g.edges.filter((e) => e.kind === 'assign').map((e) => [e.target, e.active])).toEqual([['1', true], ['2', false]])
    // Only a settled worker reports; it flows for a few seconds after it lands.
    expect(g.edges.filter((e) => e.kind === 'report')).toEqual([{ id: 'report:2', source: '2', target: 'm', kind: 'report', active: true }])
    const later = buildActivityGraph([MANAGER, worker('2', { status: 'done', finishedAt: '2026-11-02T10:05:00Z' })], 'm', { now: Date.parse('2026-11-02T10:06:00Z') })
    expect(later.edges.find((e) => e.kind === 'report')!.active).toBe(false)
  })

  it('wraps workers into rows of four so twelve never overlap', () => {
    const many = Array.from({ length: 12 }, (_, i) => worker(String(i + 1), { status: 'running' }))
    const g = buildActivityGraph([MANAGER, ...many], 'm')
    const boxes = g.nodes.map((n) => `${n.position.x},${n.position.y}`)
    expect(new Set(boxes).size).toBe(g.nodes.length)
    expect(new Set(g.nodes.filter((n) => n.role === 'worker').map((n) => n.position.y)).size).toBe(3)
    // No two nodes on the same row sit closer than a node width.
    for (const a of g.nodes) for (const b of g.nodes) if (a !== b && a.position.y === b.position.y) expect(Math.abs(a.position.x - b.position.x)).toBeGreaterThanOrEqual(NODE_WIDTH)
  })

  it('folds finished workers into one group past the threshold, but never hides a failure or a running one', () => {
    const done = Array.from({ length: COLLAPSE_ABOVE }, (_, i) => worker(String(i + 1), { status: 'done' }))
    const extra = [worker('50', { status: 'failed', error: 'boom' }), worker('51', { status: 'running' })]
    const g = buildActivityGraph([MANAGER, ...done, ...extra], 'm')
    expect(g.hiddenDone).toBe(COLLAPSE_ABOVE)
    expect(g.nodes.find((n) => n.kind === 'group')).toMatchObject({ count: COLLAPSE_ABOVE })
    expect(g.nodes.some((n) => n.id === '50')).toBe(true)
    expect(g.nodes.some((n) => n.id === '51')).toBe(true)
    // Expanded: everyone is there.
    expect(buildActivityGraph([MANAGER, ...done, ...extra], 'm', { collapseDone: false }).nodes).toHaveLength(1 + COLLAPSE_ABOVE + 2)
  })

  it('marks a permission-blocked worker distinctly from a plain failure', () => {
    const g = buildActivityGraph([MANAGER, worker('1', { status: 'failed', error: 'blocked by Onni\'s permission level' }), worker('2', { status: 'failed', error: 'oops' })], 'm')
    expect(g.nodes.find((n) => n.id === '1')!.state).toBe('blocked')
    expect(g.nodes.find((n) => n.id === '2')!.state).toBe('failed')
  })

  it('draws an ordering edge for --after, and a finished tree is drawn statically in its final state', () => {
    const a = worker('1', { status: 'done', finishedAt: '2026-11-02T10:01:00Z' })
    const b = worker('2', { status: 'done', finishedAt: '2026-11-02T10:02:00Z', dispatch: { rootRunId: 'm', parentRunId: 'm', after: ['1'] } })
    const g = buildActivityGraph([{ ...MANAGER, status: 'done', activity: undefined } as ApiRun, a, b], 'm', { now: Date.parse('2026-11-02T11:00:00Z') })
    expect(g.edges.find((e) => e.kind === 'after')).toMatchObject({ source: '1', target: '2' })
    expect(g.edges.every((e) => !e.active)).toBe(true)
    expect(g.nodes.map((n) => n.state)).toEqual(['done', 'done', 'done'])
  })

  it('answers an empty graph for an unknown root, and rootOf finds the tree root', () => {
    expect(buildActivityGraph([], 'x')).toEqual({ nodes: [], edges: [], hiddenDone: 0 })
    expect(rootOf(worker('1'))).toBe('m')
    expect(rootOf(run({ id: 'solo' }))).toBe('solo')
  })
})
