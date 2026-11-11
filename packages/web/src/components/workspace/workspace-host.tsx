import { useCallback, useEffect, type ReactNode } from 'react'

import { useProjectScope } from '@/api/project-scope-context'
import { toast } from '@/components/ui/toaster'
import { useI18n } from '@/lib/i18n'
import { useNavigate } from '@/lib/project-router'
import {
  closePane,
  openDraft,
  openRun,
  promoteDraft,
  setActive,
  useWorkspaceState,
  type DraftPaneRef,
  type RunPaneRef,
} from '@/lib/workspace-state'
import { clearStartedDraft } from '@/routes/new-task-draft'
import { NewTaskSurface } from '@/routes/new-task-surface'
import type { ViewId } from '@/routes/task-workspace/layout-state'

import { ActivePaneProvider, useActivePane } from './active-pane-context'

export type WorkspaceHostTarget =
  | { kind: 'run'; runId: string; view?: ViewId }
  | { kind: 'draft' }

export interface WorkspaceHostProps {
  projectId: string
  target: WorkspaceHostTarget
  /** Kept at the route boundary so the existing task workspace remains lazy. */
  renderRun: (view?: ViewId) => ReactNode
}

function runPane(projectId: string, runId: string): RunPaneRef {
  return { kind: 'run', paneId: `run:${projectId}:${runId}`, projectId, runId }
}

function draftPane(projectId: string): DraftPaneRef {
  // The legacy route's draft id keeps bookmarks and existing in-progress compositions intact.
  return { kind: 'draft', paneId: `draft:${projectId}`, projectId, draftId: 'default' }
}

/**
 * Project-scoped thread host. The URL chooses which pane is focused; only the active pane mounts,
 * keeping its conversation stream and context ownership unambiguous until split panes ship.
 */
export function WorkspaceHost({ projectId, target, renderRun }: WorkspaceHostProps) {
  const { state, update } = useWorkspaceState(projectId)

  return (
    <ActivePaneProvider key={projectId} initialActivePaneId={state.active ?? null}>
      <WorkspaceHostPane
        projectId={projectId}
        target={target}
        state={state}
        update={update}
        renderRun={renderRun}
      />
    </ActivePaneProvider>
  )
}

function WorkspaceHostPane({
  projectId,
  target,
  state,
  update,
  renderRun,
}: WorkspaceHostProps & Pick<ReturnType<typeof useWorkspaceState>, 'state' | 'update'>) {
  const activePane = useActivePane()
  const { projectId: scopeProjectId } = useProjectScope()
  const navigate = useNavigate()
  const { t } = useI18n()

  useEffect(() => {
    update((current) =>
      target.kind === 'run'
        ? openRun(current, runPane(projectId, target.runId))
        : openDraft(current, draftPane(projectId)),
    )
  }, [projectId, target.kind, target.kind === 'run' ? target.runId : undefined, update])

  useEffect(() => {
    if (state.active) activePane.setActive(state.active)
  }, [activePane, state.active])

  const activate = useCallback((paneId: string) => {
    activePane.setActive(paneId)
    update((current) => setActive(current, paneId))
  }, [activePane, update])

  const pane = state.threads.find((thread) => thread.paneId === state.active)
  const matchesTarget = pane !== undefined
    && pane.kind === target.kind
    && (pane.kind !== 'run' || (target.kind === 'run' && pane.runId === target.runId))

  // Do not briefly mount a persisted, unrelated thread while a deep link is taking focus.
  if (!pane || !matchesTarget) return null

  const isActive = activePane.activePaneId === pane.paneId
  return (
    <section
      aria-label={pane.kind === 'run' ? t('Task workspace pane') : t('New task pane')}
      aria-selected={isActive}
      className={isActive ? 'flex min-h-0 flex-1 ring-1 ring-inset ring-ring' : 'flex min-h-0 flex-1'}
      data-active={isActive ? 'true' : undefined}
      data-pane-id={pane.paneId}
      data-slot="workspace-pane"
      role="tabpanel"
      onPointerDown={() => activate(pane.paneId)}
    >
      {pane.kind === 'run' ? renderRun(target.kind === 'run' ? target.view : undefined) : (
        <NewTaskSurface
          draftId={pane.draftId}
          projectId={scopeProjectId}
          onProjectSwitch={(nextProjectId) => {
            void navigate(`/p/${encodeURIComponent(nextProjectId)}/new`, { replace: true })
          }}
          onScheduled={() => {
            update((current) => closePane(current, pane.paneId))
            toast(t('Task scheduled.'))
          }}
          onStarted={(created) => {
            update((current) => promoteDraft(current, pane.paneId, created.id))
            clearStartedDraft(scopeProjectId, pane.draftId)
            void navigate(`/tasks/${encodeURIComponent(created.id)}`)
          }}
        />
      )}
    </section>
  )
}
