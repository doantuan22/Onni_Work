import { useCallback, useEffect, useState, type ReactNode } from 'react'

import { useProjectScope } from '@/api/project-scope-context'
import { toast } from '@/components/ui/toaster'
import { useI18n } from '@/lib/i18n'
import { useNavigate } from '@/lib/project-router'
import {
  closePane,
  disableSplit,
  openBeside,
  openDraft,
  openRun,
  promoteDraft,
  setActive,
  useWorkspaceState,
  type DraftPaneRef,
  type PaneRef,
  type RunPaneRef,
} from '@/lib/workspace-state'
import { clearStartedDraft } from '@/routes/new-task-draft'
import { startedRunPath } from '@/routes/new-task-form'
import { NewTaskSurface } from '@/routes/new-task-surface'
import type { ViewId } from '@/routes/task-workspace/layout-state'

import { ActivePaneProvider, useActivePane } from './active-pane-context'
import { SplitTabStrip } from './split-tab-strip'
import { useWorkspaceShortcuts } from './use-workspace-shortcuts'

export type WorkspaceHostTarget =
  | { kind: 'run'; runId: string; view?: ViewId }
  | { kind: 'draft' }

export interface WorkspaceHostProps {
  projectId: string
  target: WorkspaceHostTarget
  /** Kept at the route boundary so the existing task workspace remains lazy. */
  renderRun: (view?: ViewId, runId?: string, pane?: RunPaneRef) => ReactNode
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

  useWorkspaceShortcuts({ projectId })

  const [scrollAnchors, setScrollAnchors] = useState<Record<string, number>>({})

  const updateScrollAnchor = useCallback((paneId: string, scrollTop: number) => {
    setScrollAnchors((prev) => {
      if (prev[paneId] === scrollTop) return prev
      return { ...prev, [paneId]: scrollTop }
    })
  }, [])

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

  const handleClosePane = useCallback(
    (paneId: string) => {
      update((current) => {
        const next = closePane(current, paneId)
        if (current.active === paneId && next.active) {
          const nextPane = next.threads.find((t) => t.paneId === next.active)
          if (nextPane?.kind === 'run') {
            void navigate(`/p/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(nextPane.runId)}`)
          } else if (nextPane?.kind === 'draft') {
            void navigate(`/p/${encodeURIComponent(projectId)}/new`)
          }
        }
        return next
      })
    },
    [navigate, projectId, update],
  )

  const split = state.split
  const isSplit = split !== 'none'
  const paneA = isSplit ? state.threads.find((t) => t.paneId === split.a) : undefined
  const paneB = isSplit ? state.threads.find((t) => t.paneId === split.b) : undefined
  const splitValid = isSplit && paneA !== undefined && paneB !== undefined && (state.active === paneA.paneId || state.active === paneB.paneId)

  const renderPane = (pane: PaneRef) => {
    const isActive = activePane.activePaneId === pane.paneId
    const paneView = isActive && target.kind === 'run' ? target.view : undefined

    return (
      <section
        key={pane.paneId}
        ref={(el) => {
          if (el) {
            const saved = scrollAnchors[pane.paneId]
            if (saved !== undefined && el.scrollTop !== saved) {
              el.scrollTop = saved
            }
          }
        }}
        aria-label={pane.kind === 'run' ? t('Task workspace pane') : t('New task pane')}
        aria-selected={isActive}
        className={isActive ? 'flex min-h-0 flex-1 overflow-auto ring-1 ring-inset ring-ring' : 'flex min-h-0 flex-1 overflow-auto'}
        data-active={isActive ? 'true' : undefined}
        data-pane-id={pane.paneId}
        data-scroll-anchor={scrollAnchors[pane.paneId] ?? 0}
        data-slot="workspace-pane"
        role="tabpanel"
        onPointerDown={() => activate(pane.paneId)}
        onScroll={(e) => updateScrollAnchor(pane.paneId, e.currentTarget.scrollTop)}
      >
        {pane.kind === 'run' ? (
          renderRun(paneView, pane.runId, pane)
        ) : (
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
              const runPath = startedRunPath(created)
              const firstRun = 'runs' in created ? created.runs[0] : created
              if (firstRun === undefined) {
                void navigate(runPath)
                return
              }
              update((current) => promoteDraft(current, pane.paneId, firstRun.id))
              clearStartedDraft(scopeProjectId, pane.draftId)
              void navigate(runPath)
            }}
          />
        )}
      </section>
    )
  }

  if (splitValid && paneA && paneB) {
    const matchesTarget = (target.kind === 'run' && ((paneA.kind === 'run' && paneA.runId === target.runId) || (paneB.kind === 'run' && paneB.runId === target.runId)))
      || (target.kind === 'draft' && (paneA.kind === 'draft' || paneB.kind === 'draft'))

    if (!matchesTarget) return null

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <SplitTabStrip
          state={state}
          onActivate={activate}
          onClose={handleClosePane}
          onUnsplit={() => update(disableSplit)}
          onPickThread={(runId) => update((current) => openBeside(current, runId, projectId))}
        />
        <div className="flex min-h-0 flex-1 flex-row divide-x divide-border">
          {renderPane(paneA)}
          {renderPane(paneB)}
        </div>
      </div>
    )
  }

  const pane = state.threads.find((thread) => thread.paneId === state.active)
  const matchesTarget = pane !== undefined
    && pane.kind === target.kind
    && (pane.kind !== 'run' || (target.kind === 'run' && pane.runId === target.runId))

  // Do not briefly mount a persisted, unrelated thread while a deep link is taking focus.
  if (!pane || !matchesTarget) return null

  return renderPane(pane)
}
