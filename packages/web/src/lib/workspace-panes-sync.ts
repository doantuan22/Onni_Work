import { useContext, useEffect, useRef } from 'react'
import { QueryClientContext } from '@tanstack/react-query'

import {
  useSaveWorkspacePanes,
  useWorkspacePanes,
  type WorkspacePanes,
  type WorkspacePaneThread,
} from '@/api/workspace-threads'
import {
  hydrate,
  useWorkspaceState,
  type WorkspaceState,
} from '@/lib/workspace-state'

export const DEFAULT_SYNC_DEBOUNCE_MS = 800
export const MAX_WORKSPACE_PANES_THREADS = 50

export interface WorkspacePanesSyncOptions {
  debounceMs?: number
}

/**
 * Strips client-only fields (e.g. title, navigator, context) so the payload strictly
 * conforms to workspacePanesSchema before persistence to the server.
 */
export function toWorkspacePanesPayload(state: WorkspaceState): WorkspacePanes {
  const retainedIds = new Set<string>()
  if (state.active && state.threads.some((thread) => thread.paneId === state.active)) {
    retainedIds.add(state.active)
  }
  if (state.split !== 'none') {
    for (const paneId of [state.split.a, state.split.b]) {
      if (state.threads.some((thread) => thread.paneId === paneId)) retainedIds.add(paneId)
    }
  }

  const orderedThreads = [
    ...state.threads.filter((thread) => retainedIds.has(thread.paneId)),
    ...state.threads.filter((thread) => !retainedIds.has(thread.paneId)),
  ]
  const retainedThreads = orderedThreads.slice(0, MAX_WORKSPACE_PANES_THREADS)
  const retainedThreadIds = new Set(retainedThreads.map((thread) => thread.paneId))
  const threads: WorkspacePaneThread[] = retainedThreads
    .map((thread) => {
      if (thread.kind === 'draft') {
        return {
          kind: 'draft',
          paneId: thread.paneId,
          projectId: thread.projectId,
          draftId: thread.draftId,
        }
      }
      return {
        kind: 'run',
        paneId: thread.paneId,
        projectId: thread.projectId,
        runId: thread.runId,
      }
    })

  const payload: WorkspacePanes = {
    threads,
    split: state.split !== 'none'
      && retainedThreadIds.has(state.split.a)
      && retainedThreadIds.has(state.split.b)
      ? { a: state.split.a, b: state.split.b }
      : 'none',
  }

  if (typeof state.active === 'string' && state.active !== '' && retainedThreadIds.has(state.active)) {
    payload.active = state.active
  }

  return payload
}

/**
 * Deterministically serializes a WorkspacePanes payload for change detection.
 */
export function serializePanes(panes: WorkspacePanes): string {
  return JSON.stringify({
    threads: panes.threads.map((t) =>
      t.kind === 'draft'
        ? { kind: t.kind, paneId: t.paneId, projectId: t.projectId, draftId: t.draftId }
        : { kind: t.kind, paneId: t.paneId, projectId: t.projectId, runId: t.runId },
    ),
    active: panes.active ?? null,
    split: panes.split === 'none' ? 'none' : { a: panes.split.a, b: panes.split.b },
  })
}

function useWorkspacePanesSyncInternal(
  projectId: string,
  options?: WorkspacePanesSyncOptions,
): void {
  const debounceMs = options?.debounceMs ?? DEFAULT_SYNC_DEBOUNCE_MS
  const { state, update } = useWorkspaceState(projectId)
  const { data: serverPanes, isError: isServerError } = useWorkspacePanes(projectId)
  const savePanes = useSaveWorkspacePanes(projectId)

  const hydratedRef = useRef(false)
  const lastSyncedRef = useRef<string | null>(null)
  const initialHadThreadsRef = useRef<boolean | null>(null)
  const currentProjectRef = useRef(projectId)

  if (currentProjectRef.current !== projectId) {
    currentProjectRef.current = projectId
    hydratedRef.current = false
    lastSyncedRef.current = null
    initialHadThreadsRef.current = null
  }

  if (initialHadThreadsRef.current === null && projectId) {
    initialHadThreadsRef.current = state.threads.length > 0
  }

  // Hydration phase:
  // On mount, if local state has no threads, hydrate it once from useWorkspacePanes(projectId) (server GET).
  // If local state already has threads on mount, localStorage is primary, so hydration is completed immediately.
  useEffect(() => {
    if (!projectId) return

    if (!hydratedRef.current) {
      if (initialHadThreadsRef.current === true) {
        hydratedRef.current = true
        if (lastSyncedRef.current === null) {
          lastSyncedRef.current = serializePanes(toWorkspacePanesPayload(state))
        }
      } else if (serverPanes !== undefined) {
        if (state.threads.length === 0 && serverPanes.threads.length > 0) {
          update((current) => {
            if (current.threads.length > 0) return current
            return hydrate(current, serverPanes, projectId)
          })
          const hydrated = hydrate(state, serverPanes, projectId)
          lastSyncedRef.current = serializePanes(toWorkspacePanesPayload(hydrated))
        } else {
          lastSyncedRef.current = serializePanes(serverPanes)
        }
        hydratedRef.current = true
      } else if (isServerError) {
        // Cockpit works offline: network failures are silent.
        hydratedRef.current = true
        lastSyncedRef.current = serializePanes(toWorkspacePanesPayload(state))
      }
    }
  }, [projectId, serverPanes, isServerError, state, update])

  // Sync phase:
  // Afterwards, on any local change, debounce (~800ms) and PUT via useSaveWorkspacePanes,
  // skipping the PUT when the payload equals the last synced one and never PUTting an empty default
  // over a non-empty server copy before hydration finished.
  useEffect(() => {
    if (!projectId) return

    if (!hydratedRef.current) return

    const payload = toWorkspacePanesPayload(state)
    const serialized = serializePanes(payload)

    if (lastSyncedRef.current !== null && serialized === lastSyncedRef.current) {
      return
    }

    if (lastSyncedRef.current === null) {
      lastSyncedRef.current = serialized
      return
    }

    const timer = setTimeout(() => {
      if (serialized === lastSyncedRef.current) return

      savePanes.mutate(payload, {
        onError: () => {
          // Network failures are silent (cockpit must work offline: state is written, never required).
        },
      })
      lastSyncedRef.current = serialized
    }, debounceMs)

    return () => {
      clearTimeout(timer)
    }
  }, [projectId, state, debounceMs, savePanes])
}

/**
 * Mirrors workspace conversation pane state to the server for a project.
 * localStorage stays the primary store.
 *
 * - On mount, if local state has no threads, hydrates it once from the server.
 * - Afterwards, on any local change, debounces (~800ms) and PUTs to the server.
 * - Skips PUT when payload equals the last synced one.
 * - Never PUTs an empty default over a non-empty server copy before hydration finished.
 * - Network failures are silent (offline-friendly).
 * - Strips client-only fields before PUT.
 */
export function useWorkspacePanesSync(
  projectId: string,
  options?: WorkspacePanesSyncOptions,
): void {
  const queryClient = useContext(QueryClientContext)
  if (!queryClient) {
    // Graceful degradation when rendered outside a QueryClientProvider (e.g. lightweight tests).
    return
  }
  return useWorkspacePanesSyncInternal(projectId, options)
}
