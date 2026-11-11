import { useCallback, useMemo, useSyncExternalStore } from 'react'

import { isViewId, type ViewId } from '@/routes/task-workspace/layout-state'

export const WORKSPACE_STORAGE_KEY_PREFIX = 'onni-workspace:'

export type PaneId = string

export interface RunPaneRef {
  kind: 'run'
  paneId: PaneId
  projectId: string
  runId: string
}

export interface DraftPaneRef {
  kind: 'draft'
  paneId: PaneId
  projectId: string
  draftId: string
}

export type PaneRef = RunPaneRef | DraftPaneRef

export type WorkspaceSplit = 'none' | { a: PaneId; b: PaneId }

export interface WorkspaceState {
  navigator: { collapsed?: boolean; width?: number }
  threads: PaneRef[]
  active?: PaneId
  split: WorkspaceSplit
  context: { open: boolean; width?: number; view?: ViewId }
}

export function createWorkspaceState(): WorkspaceState {
  return {
    navigator: {},
    threads: [],
    split: 'none',
    context: { open: false },
  }
}

export function workspaceStorageKey(projectId: string): string {
  return `${WORKSPACE_STORAGE_KEY_PREFIX}${projectId}`
}

function paneIndex(state: WorkspaceState, paneId: PaneId): number {
  return state.threads.findIndex((pane) => pane.paneId === paneId)
}

function withActive(state: WorkspaceState, paneId: PaneId): WorkspaceState {
  if (state.active === paneId) return state
  return { ...state, active: paneId }
}

/** Opens one run once; revisiting it only changes the active pane. */
export function openRun(state: WorkspaceState, pane: RunPaneRef): WorkspaceState {
  const existing = state.threads.find(
    (thread): thread is RunPaneRef =>
      thread.kind === 'run' && thread.projectId === pane.projectId && thread.runId === pane.runId,
  )
  if (existing) return withActive(state, existing.paneId)

  return {
    ...state,
    threads: [...state.threads, pane],
    active: pane.paneId,
  }
}

/** A project has one reusable new-task tab; opening it again focuses the existing draft. */
export function openDraft(state: WorkspaceState, pane: DraftPaneRef): WorkspaceState {
  const existing = state.threads.find(
    (thread): thread is DraftPaneRef => thread.kind === 'draft' && thread.projectId === pane.projectId,
  )
  if (existing) return setActive(state, existing.paneId)
  return {
    ...state,
    threads: [...state.threads, pane],
    active: pane.paneId,
    context: { ...state.context, open: false },
  }
}

/** Removes a tab and gives focus to the next tab, or the preceding one at the end. */
export function closePane(state: WorkspaceState, paneId: PaneId): WorkspaceState {
  const index = paneIndex(state, paneId)
  if (index === -1) return state

  const threads = state.threads.filter((pane) => pane.paneId !== paneId)
  const active = state.active === paneId
    ? threads[index]?.paneId ?? threads[index - 1]?.paneId
    : state.active
  const split = state.split !== 'none' && (state.split.a === paneId || state.split.b === paneId)
    ? 'none'
    : state.split

  if (active === undefined) {
    const { active: _previousActive, ...withoutActive } = state
    return { ...withoutActive, threads, split }
  }
  return { ...state, threads, active, split }
}

/** Ignores stale pane ids rather than selecting a pane that cannot be rendered. */
export function setActive(state: WorkspaceState, paneId: PaneId): WorkspaceState {
  const index = paneIndex(state, paneId)
  if (index === -1) return state
  const pane = state.threads[index]
  return pane?.kind === 'draft'
    ? { ...withActive(state, paneId), context: { ...state.context, open: false } }
    : withActive(state, paneId)
}

/** A successful new-task submission keeps its tab and replaces only its draft reference. */
export function promoteDraft(state: WorkspaceState, paneId: PaneId, runId: string): WorkspaceState {
  const index = paneIndex(state, paneId)
  const pane = index === -1 ? undefined : state.threads[index]
  if (!pane || pane.kind !== 'draft') return state

  const threads = [...state.threads]
  threads[index] = { kind: 'run', paneId: pane.paneId, projectId: pane.projectId, runId }
  return { ...state, threads, active: paneId }
}

/** A split names exactly two existing, different panes; open tabs remain unlimited. */
export function enableSplit(state: WorkspaceState, a: PaneId, b: PaneId): WorkspaceState {
  if (a === b || paneIndex(state, a) === -1 || paneIndex(state, b) === -1) return state
  return {
    ...state,
    split: { a, b },
    active: state.active === a || state.active === b ? state.active : a,
  }
}

export function disableSplit(state: WorkspaceState): WorkspaceState {
  return state.split === 'none' ? state : { ...state, split: 'none' }
}

function isObject(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
}

function optionalWidth(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : undefined
}

function normalizePane(raw: unknown, projectId: string): PaneRef | null {
  if (!isObject(raw) || raw.projectId !== projectId || typeof raw.paneId !== 'string' || raw.paneId === '') return null
  if (raw.kind === 'run' && typeof raw.runId === 'string' && raw.runId !== '') {
    return { kind: 'run', paneId: raw.paneId, projectId, runId: raw.runId }
  }
  if (raw.kind === 'draft' && typeof raw.draftId === 'string' && raw.draftId !== '') {
    return { kind: 'draft', paneId: raw.paneId, projectId, draftId: raw.draftId }
  }
  return null
}

/** Coerces persisted browser data into the current project-scoped workspace shape. */
export function normalizeWorkspaceState(raw: unknown, projectId: string): WorkspaceState {
  if (!isObject(raw)) return createWorkspaceState()

  const seenPaneIds = new Set<string>()
  let hasDraft = false
  const threads: PaneRef[] = []
  if (Array.isArray(raw.threads)) {
    for (const entry of raw.threads) {
      const pane = normalizePane(entry, projectId)
      if (!pane || seenPaneIds.has(pane.paneId) || (pane.kind === 'draft' && hasDraft)) continue
      seenPaneIds.add(pane.paneId)
      if (pane.kind === 'draft') hasDraft = true
      threads.push(pane)
    }
  }

  const navigator = isObject(raw.navigator)
    ? {
        ...(typeof raw.navigator.collapsed === 'boolean' ? { collapsed: raw.navigator.collapsed } : {}),
        ...(optionalWidth(raw.navigator.width) === undefined ? {} : { width: optionalWidth(raw.navigator.width) }),
      }
    : {}
  const context = isObject(raw.context)
    ? {
        open: raw.context.open === true,
        ...(optionalWidth(raw.context.width) === undefined ? {} : { width: optionalWidth(raw.context.width) }),
        ...(isViewId(raw.context.view) ? { view: raw.context.view } : {}),
      }
    : { open: false }
  const active = typeof raw.active === 'string' && seenPaneIds.has(raw.active) ? raw.active : undefined
  const split = isObject(raw.split)
    && typeof raw.split.a === 'string'
    && typeof raw.split.b === 'string'
    && raw.split.a !== raw.split.b
    && seenPaneIds.has(raw.split.a)
    && seenPaneIds.has(raw.split.b)
      ? { a: raw.split.a, b: raw.split.b }
      : 'none'

  const activePane = active === undefined ? undefined : threads.find((pane) => pane.paneId === active)
  return {
    navigator,
    threads,
    ...(active === undefined ? {} : { active }),
    split,
    context: activePane?.kind === 'draft' ? { ...context, open: false } : context,
  }
}

export function readWorkspaceState(projectId: string): WorkspaceState {
  if (typeof window === 'undefined') return createWorkspaceState()
  try {
    const stored = window.localStorage.getItem(workspaceStorageKey(projectId))
    return stored === null ? createWorkspaceState() : normalizeWorkspaceState(JSON.parse(stored), projectId)
  } catch {
    // Local state is a convenience: inaccessible or stale storage starts from the safe default.
    return createWorkspaceState()
  }
}

export function writeWorkspaceState(projectId: string, state: WorkspaceState): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(workspaceStorageKey(projectId), JSON.stringify(normalizeWorkspaceState(state, projectId)))
  } catch {
    // A private-mode or full store must not make the workspace unusable in this tab.
  }
}

type Listener = () => void

interface WorkspaceStore {
  getSnapshot(): WorkspaceState
  set(next: WorkspaceState): void
  subscribe(listener: Listener): () => void
}

const stores = new Map<string, WorkspaceStore>()

function workspaceStore(projectId: string): WorkspaceStore {
  const cached = stores.get(projectId)
  if (cached) return cached

  let state = readWorkspaceState(projectId)
  const listeners = new Set<Listener>()
  const store: WorkspaceStore = {
    getSnapshot: () => state,
    set(next) {
      state = normalizeWorkspaceState(next, projectId)
      writeWorkspaceState(projectId, state)
      listeners.forEach((listener) => listener())
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  stores.set(projectId, store)
  return store
}

export function setWorkspaceState(projectId: string, next: WorkspaceState): void {
  workspaceStore(projectId).set(next)
}

export function updateWorkspaceState(
  projectId: string,
  update: (state: WorkspaceState) => WorkspaceState,
): void {
  const store = workspaceStore(projectId)
  store.set(update(store.getSnapshot()))
}

/** Project-scoped external store for the workspace host; safe to render on the server. */
export function useWorkspaceState(projectId: string) {
  const store = useMemo(() => workspaceStore(projectId), [projectId])
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, createWorkspaceState)
  const setState = useCallback((next: WorkspaceState) => store.set(next), [store])
  const update = useCallback((reducer: (current: WorkspaceState) => WorkspaceState) => {
    store.set(reducer(store.getSnapshot()))
  }, [store])

  return { state, setState, update }
}

/** Test seam: storage remains intact, but the next read behaves like a fresh page load. */
export function resetWorkspaceStateStores(): void {
  stores.clear()
}
