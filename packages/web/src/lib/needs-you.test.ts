import { describe, expect, it } from 'vitest'

import type { RunRecord } from '@onni/api-client'

import { needsYou } from './needs-you'

const run = (patch: Partial<RunRecord> & { id: string }): RunRecord =>
  ({ title: patch.id, workflow: 'x', task: 't', steps: [], status: 'running', ...patch }) as RunRecord

/**
 * The sidebar strip's whole selection (plan v2 §9): a run with an open manager question is "needs
 * you" even when its turn already settled, because the question outlives the manager's turn. Nothing
 * here is time- or socket-dependent — the SSE-fed `runs` array is the only input.
 */
describe('needsYou', () => {
  it('skips archived runs, and runs with nothing for a human', () => {
    const items = needsYou([
      run({ id: 'busy', status: 'running' }),
      run({ id: 'done', status: 'done' }),
      run({ id: 'archived-waiting', status: 'waiting', archived: true }),
      run({ id: 'archived-asked', status: 'done', archived: true, dispatch: { rootRunId: 'archived-asked', softAsk: { requestId: 'q', askedAt: '2026-11-03T00:00:00.000Z', question: 'keep?' } } as RunRecord['dispatch'] }),
    ])
    expect(items).toEqual([])
  })

  it('includes the ordinary needs-you states, with no question to show', () => {
    const items = needsYou([
      run({ id: 'waiting', status: 'waiting' }),
      run({ id: 'review', status: 'review' }),
      run({ id: 'attention', status: 'running', worktreeLifecycle: { needsAttention: true } as RunRecord['worktreeLifecycle'] }),
      run({ id: 'answering', status: 'failed', awaitingAnswerSince: '2026-11-03T00:00:00.000Z' }),
    ])
    expect(items.map((item) => item.run.id).sort()).toEqual(['answering', 'attention', 'review', 'waiting'])
    expect(items.every((item) => item.question === undefined)).toBe(true)
  })

  it('carries the open manager question — even for a settled run — and puts it first', () => {
    const soft = {
      requestId: 'q-1',
      askedAt: '2026-11-03T00:00:00.000Z',
      expiresAt: '2026-11-03T01:00:00.000Z',
      question: 'Postgres or SQLite?',
      optionCount: 2,
    }
    const items = needsYou([
      run({ id: 'waiting', status: 'waiting' }),
      run({ id: 'asking', status: 'done', dispatch: { rootRunId: 'asking', softAsk: soft } as RunRecord['dispatch'] }),
    ])
    expect(items.map((item) => item.run.id)).toEqual(['asking', 'waiting'])
    expect(items[0]).toEqual({
      run: expect.objectContaining({ id: 'asking' }),
      question: 'Postgres or SQLite?',
      expiresAt: '2026-11-03T01:00:00.000Z',
    })
  })

  it('reports one row per run — a soft ask does not double a run that is also waiting', () => {
    const items = needsYou([
      run({
        id: 'both',
        status: 'waiting',
        dispatch: { rootRunId: 'both', softAsk: { requestId: 'q', askedAt: '2026-11-03T00:00:00.000Z', question: 'which?' } } as RunRecord['dispatch'],
      }),
    ])
    expect(items).toHaveLength(1)
    expect(items[0]?.question).toBe('which?')
  })
})
