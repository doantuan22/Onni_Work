import { useCallback, useMemo, useSyncExternalStore } from 'react'

export const TASK_OPEN_FILES_STORAGE_KEY_PREFIX = 'onni-task-open-files:'

export interface TaskOpenFilesState {
  openPaths: string[]
  activePath: string | null
}

const EMPTY_TASK_OPEN_FILES: TaskOpenFilesState = { openPaths: [], activePath: null }

type Listener = () => void

interface TaskOpenFilesStore {
  getSnapshot(): TaskOpenFilesState
  set(next: TaskOpenFilesState): void
  subscribe(listener: Listener): () => void
}

const stores = new Map<string, TaskOpenFilesStore>()

export function taskOpenFilesStorageKey(runId: string): string {
  return `${TASK_OPEN_FILES_STORAGE_KEY_PREFIX}${runId}`
}

export function createTaskOpenFilesState(): TaskOpenFilesState {
  return EMPTY_TASK_OPEN_FILES
}

function normalizeTaskOpenFiles(raw: unknown): TaskOpenFilesState {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return EMPTY_TASK_OPEN_FILES
  const candidate = raw as { openPaths?: unknown; activePath?: unknown }
  const seen = new Set<string>()
  const openPaths = Array.isArray(candidate.openPaths)
    ? candidate.openPaths.filter((path): path is string => {
        if (typeof path !== 'string' || path === '' || seen.has(path)) return false
        seen.add(path)
        return true
      })
    : []
  const activePath = typeof candidate.activePath === 'string' && seen.has(candidate.activePath)
    ? candidate.activePath
    : null

  return openPaths.length === 0 ? EMPTY_TASK_OPEN_FILES : { openPaths, activePath }
}

export function readTaskOpenFiles(runId: string): TaskOpenFilesState {
  if (typeof window === 'undefined') return EMPTY_TASK_OPEN_FILES
  try {
    const stored = window.sessionStorage.getItem(taskOpenFilesStorageKey(runId))
    return stored === null ? EMPTY_TASK_OPEN_FILES : normalizeTaskOpenFiles(JSON.parse(stored))
  } catch {
    // A blocked or stale browser store must not stop a user opening a worktree file.
    return EMPTY_TASK_OPEN_FILES
  }
}

function writeTaskOpenFiles(runId: string, state: TaskOpenFilesState): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(taskOpenFilesStorageKey(runId), JSON.stringify(state))
  } catch {
    // The in-memory store remains the source of truth for this tab when storage is unavailable.
  }
}

/** Opens a path once and makes it the active editor tab. */
export function openTaskFile(state: TaskOpenFilesState, path: string): TaskOpenFilesState {
  if (path === '') return state
  const openPaths = state.openPaths.includes(path) ? state.openPaths : [...state.openPaths, path]
  return state.activePath === path && openPaths === state.openPaths ? state : { openPaths, activePath: path }
}

/** Selects an existing tab and ignores paths that are not open. */
export function activateTaskFile(state: TaskOpenFilesState, path: string): TaskOpenFilesState {
  if (!state.openPaths.includes(path) || state.activePath === path) return state
  return { ...state, activePath: path }
}

/** Closing the selected tab moves to its right neighbour, then its left neighbour. */
export function closeTaskFile(state: TaskOpenFilesState, path: string): TaskOpenFilesState {
  const index = state.openPaths.indexOf(path)
  if (index === -1) return state

  const openPaths = state.openPaths.filter((openPath) => openPath !== path)
  if (state.activePath !== path) return { ...state, openPaths }
  return {
    openPaths,
    activePath: openPaths[index] ?? openPaths[index - 1] ?? null,
  }
}

function taskOpenFilesStore(runId: string): TaskOpenFilesStore {
  const cached = stores.get(runId)
  if (cached) return cached

  let state = readTaskOpenFiles(runId)
  const listeners = new Set<Listener>()
  const store: TaskOpenFilesStore = {
    getSnapshot: () => state,
    set(next) {
      state = normalizeTaskOpenFiles(next)
      writeTaskOpenFiles(runId, state)
      listeners.forEach((listener) => listener())
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  stores.set(runId, store)
  return store
}

export function updateTaskOpenFiles(runId: string, update: (state: TaskOpenFilesState) => TaskOpenFilesState): void {
  const store = taskOpenFilesStore(runId)
  store.set(update(store.getSnapshot()))
}

/** Per-run tab state shared by a files tree and an editor rendered in separate columns. */
export function useTaskOpenFiles(runId: string) {
  const store = useMemo(() => taskOpenFilesStore(runId), [runId])
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, createTaskOpenFilesState)
  const open = useCallback((path: string) => {
    store.set(openTaskFile(store.getSnapshot(), path))
  }, [store])
  const close = useCallback((path: string) => {
    store.set(closeTaskFile(store.getSnapshot(), path))
  }, [store])
  const activate = useCallback((path: string) => {
    store.set(activateTaskFile(store.getSnapshot(), path))
  }, [store])

  return { ...state, open, close, activate }
}

/** Test seam: retained session storage simulates a reload while memory starts fresh. */
export function resetTaskOpenFilesStores(): void {
  stores.clear()
}
