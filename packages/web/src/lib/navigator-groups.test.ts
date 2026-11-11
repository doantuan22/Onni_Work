import { describe, expect, it } from 'vitest'
import type { RunRecord } from '@onni/api-client'
import { groupNavigatorRows } from './navigator-groups'
import { buildTaskTree } from './task-tree'
import type { QuickListBucket } from './task-groups'

function run(id: string, status: RunRecord['status'], extra: Partial<RunRecord> = {}): RunRecord {
  return { id, title: id, task: id, workflow: 'default', status, createdAt: '2026-11-11T00:00:00.000Z', tokensUsed: 0, archived: false, steps: [], ...extra }
}

const bucket = (label: QuickListBucket['label'], ...runs: RunRecord[]): QuickListBucket => ({
  label,
  rows: runs.map((run) => ({ kind: 'run', run, queuePosition: null })),
})

describe('groupNavigatorRows', () => {
  it('orders actionable failures, active work, then recent outcomes', () => {
    const groups = groupNavigatorRows([
      bucket('Recent', run('done', 'done'), run('failed', 'failed')),
      bucket('Working', run('running', 'running')),
      bucket('Needs you', run('ask', 'waiting')),
    ])
    expect(groups.map(({ label }) => label)).toEqual(['Needs you', 'Running', 'Recent'])
    expect(groups[0]!.rows.map((row) => row.kind === 'run' && row.run.id)).toEqual(['failed', 'ask'])
  })

  it('keeps pinned and archived placement and promotes a variant tile as a unit', () => {
    const members = [run('a', 'failed'), run('b', 'done')]
    const groups = groupNavigatorRows([
      bucket('Pinned', run('pin', 'failed', { pinned: true })),
      { label: 'Recent', rows: [{ kind: 'group', groupId: 'g', title: 'variants', members }] },
      bucket('Archived', run('old', 'failed', { archived: true })),
    ])
    expect(groups.map(({ label }) => label)).toEqual(['Pinned', 'Needs you', 'Archived'])
    expect(groups[1]!.rows[0]).toMatchObject({ kind: 'group', groupId: 'g' })
  })

  it('keeps a failed worker grouped under its running manager in Needs you', () => {
    const manager = run('manager', 'running')
    const worker = run('worker', 'failed', {
      dispatch: { rootRunId: 'manager', parentRunId: 'manager' },
    })
    const groups = groupNavigatorRows([bucket('Working', manager), bucket('Recent', worker)])

    expect(groups.map(({ label }) => label)).toEqual(['Needs you'])
    expect(groups[0]!.rows.map((row) => row.kind === 'run' && row.run.id)).toEqual(['manager', 'worker'])
    const tree = buildTaskTree(groups[0]!.rows.map((row) => row.kind === 'run'
      ? { id: row.run.id, dispatch: row.run.dispatch }
      : { id: `group:${row.groupId}` }))
    expect(tree).toHaveLength(1)
    expect(tree[0]!.run.id).toBe('manager')
    expect(tree[0]!.children.map((child) => child.run.id)).toEqual(['worker'])
  })
})
