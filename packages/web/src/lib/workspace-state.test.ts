import { act, cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  closePane,
  createWorkspaceState,
  disableSplit,
  enableSplit,
  hydrate,
  normalizeWorkspaceState,
  openBeside,
  openDraft,
  openRun,
  promoteDraft,
  readWorkspaceState,
  resetWorkspaceStateStores,
  setActive,
  useOpenBeside,
  useWorkspaceState,
  workspaceStorageKey,
  writeWorkspaceState,
  type WorkspaceState,
} from './workspace-state'

const projectId = 'shop'
const runA = { kind: 'run' as const, paneId: 'pane-a', projectId, runId: 'run-a' }
const runB = { kind: 'run' as const, paneId: 'pane-b', projectId, runId: 'run-b' }
const draft = { kind: 'draft' as const, paneId: 'new-task', projectId, draftId: 'draft-a' }

afterEach(() => {
  cleanup()
  localStorage.clear()
  resetWorkspaceStateStores()
})

describe('workspace state reducers', () => {
  it('opens a run once and focuses its existing pane on a later visit', () => {
    const state = openRun(openRun(createWorkspaceState(), runA), runB)
    const revisited = openRun(state, { ...runA, paneId: 'ignored-new-pane' })

    expect(revisited.threads).toEqual([runA, runB])
    expect(revisited.active).toBe(runA.paneId)
  })

  it('keeps one draft pane per project, closes context for it, and promotes that same pane', () => {
    const initial: WorkspaceState = {
      ...createWorkspaceState(),
      context: { open: true, view: 'changes' },
    }
    const opened = openDraft(initial, draft)
    const repeated = openDraft(opened, { ...draft, paneId: 'another-new-task', draftId: 'draft-b' })
    const promoted = promoteDraft(repeated, draft.paneId, 'run-from-draft')

    expect(repeated.threads).toEqual([draft])
    expect(repeated.context.open).toBe(false)
    expect(promoted.threads).toEqual([{ kind: 'run', paneId: draft.paneId, projectId, runId: 'run-from-draft' }])
    expect(promoted.active).toBe(draft.paneId)

    const reopened = openDraft(promoted, draft)
    expect(reopened.threads).toEqual([
      { kind: 'run', paneId: draft.paneId, projectId, runId: 'run-from-draft' },
      { ...draft, paneId: `${draft.paneId}:2` },
    ])
    expect(reopened.active).toBe(`${draft.paneId}:2`)
  })

  it('only activates known panes and selects a neighbor when the active pane closes', () => {
    const state = openRun(openRun(createWorkspaceState(), runA), runB)

    expect(setActive(state, 'missing')).toBe(state)
    expect(closePane(setActive(state, runA.paneId), runA.paneId)).toMatchObject({
      threads: [runB],
      active: runB.paneId,
    })
    expect(closePane(openRun(createWorkspaceState(), runA), runA.paneId)).not.toHaveProperty('active')
  })

  it('permits exactly two distinct visible panes while retaining unlimited tabs', () => {
    const state = openRun(openRun(openRun(createWorkspaceState(), runA), runB), {
      kind: 'run', paneId: 'pane-c', projectId, runId: 'run-c',
    })
    const split = enableSplit(state, runA.paneId, runB.paneId)

    expect(split.split).toEqual({ a: runA.paneId, b: runB.paneId })
    expect(split.threads).toHaveLength(3)
    expect(enableSplit(state, runA.paneId, runA.paneId)).toBe(state)
    expect(enableSplit(state, runA.paneId, 'missing')).toBe(state)
    expect(disableSplit(split).split).toBe('none')
  })

  it('opens a run beside the active pane, enabling split or replacing the inactive split pane', () => {
    const runC = { kind: 'run' as const, paneId: 'pane-c', projectId, runId: 'run-c' }
    // 1-up: openBeside enables split with active pane and new run
    const state1 = openRun(createWorkspaceState(), runA)
    const split1 = openBeside(state1, 'run-b', projectId)
    expect(split1.split).toEqual({ a: runA.paneId, b: 'run:shop:run-b' })
    expect(split1.active).toBe('run:shop:run-b')
    expect(split1.threads).toHaveLength(2)

    // openBeside when target is already active pane is a no-op / keeps active
    expect(openBeside(state1, runA.runId, projectId)).toBe(state1)

    // Already split (active is a): replaces b with target
    const twoRuns = setActive(openRun(openRun(createWorkspaceState(), runA), runB), runA.paneId)
    const split2 = openBeside(twoRuns, runB.runId)
    expect(split2.split).toEqual({ a: runA.paneId, b: runB.paneId })
    expect(split2.active).toBe(runB.paneId)

    const splitActiveA = setActive(split2, runA.paneId)
    const split3 = openBeside(splitActiveA, runC)
    expect(split3.split).toEqual({ a: runA.paneId, b: runC.paneId })
    expect(split3.active).toBe(runC.paneId)

    // Already split (active is b): replaces a with target
    const splitActiveB = setActive(split2, runB.paneId)
    const split4 = openBeside(splitActiveB, runC)
    expect(split4.split).toEqual({ a: runC.paneId, b: runB.paneId })
    expect(split4.active).toBe(runC.paneId)

    // Already visible in split: activates it
    const splitActivate = openBeside(split4, runB.runId)
    expect(splitActivate.active).toBe(runB.paneId)
    expect(splitActivate.split).toEqual(split4.split)
  })

  it('hydrates empty state from external panes preserving navigator and context settings', () => {
    const initial: WorkspaceState = {
      ...createWorkspaceState(),
      navigator: { collapsed: true, width: 320 },
      context: { open: true, view: 'files' },
    }
    const incoming = {
      threads: [runA, runB],
      active: runB.paneId,
      split: { a: runA.paneId, b: runB.paneId },
    }
    const hydrated = hydrate(initial, incoming, projectId)

    expect(hydrated.threads).toEqual([runA, runB])
    expect(hydrated.active).toBe(runB.paneId)
    expect(hydrated.split).toEqual({ a: runA.paneId, b: runB.paneId })
    expect(hydrated.navigator).toEqual({ collapsed: true, width: 320 })
    expect(hydrated.context).toEqual({ open: true, view: 'files' })
  })

  it('hydrate preserves state when incoming is empty, invalid, or cross-project', () => {
    const initial = openRun(createWorkspaceState(), runA)

    expect(hydrate(initial, null)).toBe(initial)
    expect(hydrate(initial, {})).toBe(initial)
    expect(hydrate(initial, { threads: [] })).toBe(initial)
    expect(hydrate(initial, { threads: [{ ...runB, projectId: 'different' }] }, projectId)).toBe(initial)
  })

  it('hydrate closes context if hydrated active pane is a draft', () => {
    const initial: WorkspaceState = {
      ...createWorkspaceState(),
      context: { open: true, view: 'terminal' },
    }
    const incoming = {
      threads: [draft],
      active: draft.paneId,
      split: 'none',
    }
    const hydrated = hydrate(initial, incoming, projectId)

    expect(hydrated.threads).toEqual([draft])
    expect(hydrated.active).toBe(draft.paneId)
    expect(hydrated.context.open).toBe(false)
  })
})

describe('workspace persistence', () => {
  it('uses a project-scoped key and restores a valid saved workspace', () => {
    const state = openRun(createWorkspaceState(), runA)
    writeWorkspaceState(projectId, state)
    resetWorkspaceStateStores()

    expect(workspaceStorageKey(projectId)).toBe('onni-workspace:shop')
    expect(readWorkspaceState(projectId)).toEqual(state)
    expect(readWorkspaceState('other')).toEqual(createWorkspaceState())
  })

  it('tolerates absent, corrupt, stale, and cross-project values without throwing', () => {
    expect(readWorkspaceState(projectId)).toEqual(createWorkspaceState())
    localStorage.setItem(workspaceStorageKey(projectId), '{ nope')
    expect(readWorkspaceState(projectId)).toEqual(createWorkspaceState())

    expect(normalizeWorkspaceState({
      navigator: { collapsed: 'yes', width: -1 },
      threads: [runA, runA, draft, { ...draft, paneId: 'another-draft' }, { ...runB, projectId: 'other' }],
      active: 'unknown',
      split: { a: runA.paneId, b: 'unknown' },
      context: { open: true, width: Number.NaN, view: 'made-up' },
    }, projectId)).toEqual({
      navigator: {},
      threads: [runA, draft],
      split: 'none',
      context: { open: true },
    })
  })
})

function Probe() {
  const { state, update } = useWorkspaceState(projectId)
  return createElement(
    'button',
    { onClick: () => update((current) => openRun(current, runA)) },
    state.active ?? 'empty',
  )
}

describe('useWorkspaceState', () => {
  it('subscribes to its project store and writes reducer updates', () => {
    render(createElement(Probe))
    expect(screen.getByRole('button').textContent).toBe('empty')

    act(() => screen.getByRole('button').click())

    expect(screen.getByRole('button').textContent).toBe(runA.paneId)
    expect(readWorkspaceState(projectId)).toMatchObject({ threads: [runA], active: runA.paneId })
  })

  it('exposes openBeside which enables split with the target run', () => {
    function OpenBesideProbe() {
      const openBeside = useOpenBeside(projectId)
      return createElement('button', { onClick: () => openBeside('run-b') }, 'split')
    }

    // Set initial 1-up state with runA
    writeWorkspaceState(projectId, openRun(createWorkspaceState(), runA))
    render(createElement(OpenBesideProbe))

    act(() => screen.getByRole('button').click())
    expect(readWorkspaceState(projectId).split).toEqual({ a: runA.paneId, b: 'run:shop:run-b' })
  })
})
