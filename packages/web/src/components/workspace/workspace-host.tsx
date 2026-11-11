import { PanelRightIcon } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'

import { useProjectScope } from '@/api/project-scope-context'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toaster'
import { useI18n } from '@/lib/i18n'
import { useNavigate } from '@/lib/project-router'
import { useIsDesktop } from '@/lib/use-desktop'
import { cn } from '@/lib/utils'
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
import { ContextSheet } from './context-sheet'
import { SplitTabStrip } from './split-tab-strip'

const SIDE_BY_SIDE_MIN_WIDTH = 1024

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

function paneTitle(pane: PaneRef, fallbackNewTask: string): string {
  if (pane.kind === 'draft') return pane.title ?? fallbackNewTask
  return pane.title ?? pane.runId
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
  const isDesktop = useIsDesktop(SIDE_BY_SIDE_MIN_WIDTH)

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

    if (isDesktop) {
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

    // Below 1024px: ONE conversation pane at a time (the active one)
    const activePaneRef = state.active === paneB.paneId ? paneB : paneA
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          data-slot="conversation-header"
          className="flex h-[var(--header-h,48px)] min-w-0 shrink-0 items-center justify-between border-b border-border bg-muted/40 px-3 text-xs"
        >
          <div
            role="tablist"
            aria-label={t('Split conversation panes')}
            data-slot="split-tab-strip"
            className="flex min-w-0 items-center gap-1.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={state.active === paneA.paneId}
              data-active={state.active === paneA.paneId ? 'true' : undefined}
              data-pane-id={paneA.paneId}
              className={cn(
                'group flex h-8 items-center gap-2 rounded-md px-2.5 font-medium transition-colors cursor-pointer select-none',
                state.active === paneA.paneId
                  ? 'bg-background text-foreground shadow-xs ring-1 ring-border'
                  : 'text-muted-foreground hover:bg-background/50 hover:text-foreground',
              )}
              onClick={() => activate(paneA.paneId)}
            >
              <span className="max-w-[120px] truncate">{paneTitle(paneA, t('New task'))}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={state.active === paneB.paneId}
              data-active={state.active === paneB.paneId ? 'true' : undefined}
              data-pane-id={paneB.paneId}
              className={cn(
                'group flex h-8 items-center gap-2 rounded-md px-2.5 font-medium transition-colors cursor-pointer select-none',
                state.active === paneB.paneId
                  ? 'bg-background text-foreground shadow-xs ring-1 ring-border'
                  : 'text-muted-foreground hover:bg-background/50 hover:text-foreground',
              )}
              onClick={() => activate(paneB.paneId)}
            >
              <span className="max-w-[120px] truncate">{paneTitle(paneB, t('New task'))}</span>
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            {activePaneRef?.kind === 'run' ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                aria-label={t('Context views')}
                data-slot="open-context-button"
                onClick={() =>
                  update((current) => ({
                    ...current,
                    context: { ...current.context, open: true },
                  }))
                }
              >
                <PanelRightIcon className="h-3.5 w-3.5" />
                <span>{t('Context')}</span>
              </Button>
            ) : null}
          </div>
        </div>
        {renderPane(activePaneRef)}
        {activePaneRef?.kind === 'run' ? (
          <ContextSheet
            open={Boolean(state.context.open)}
            onOpenChange={(open) =>
              update((current) => ({
                ...current,
                context: { ...current.context, open },
              }))
            }
            projectId={projectId}
            runId={activePaneRef.runId}
            title={activePaneRef.title ?? activePaneRef.runId}
            activeView={state.context.view ?? (target.kind === 'run' ? target.view : undefined)}
            onViewChange={(view) =>
              update((current) => ({
                ...current,
                context: { ...current.context, view },
              }))
            }
            renderContent={(view) => renderRun(view, activePaneRef.runId, activePaneRef)}
          />
        ) : null}
      </div>
    )
  }

  const pane = state.threads.find((thread) => thread.paneId === state.active)
  const matchesTarget = pane !== undefined
    && pane.kind === target.kind
    && (pane.kind !== 'run' || (target.kind === 'run' && pane.runId === target.runId))

  // Do not briefly mount a persisted, unrelated thread while a deep link is taking focus.
  if (!pane || !matchesTarget) return null

  if (isDesktop) {
    return renderPane(pane)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        data-slot="conversation-header"
        className="flex h-[var(--header-h,48px)] min-w-0 shrink-0 items-center justify-between border-b border-border bg-muted/40 px-3 text-xs"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-foreground">
            {paneTitle(pane, t('New task'))}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {pane.kind === 'run' ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
              aria-label={t('Context views')}
              data-slot="open-context-button"
              onClick={() =>
                update((current) => ({
                  ...current,
                  context: { ...current.context, open: true },
                }))
              }
            >
              <PanelRightIcon className="h-3.5 w-3.5" />
              <span>{t('Context')}</span>
            </Button>
          ) : null}
        </div>
      </div>
      {renderPane(pane)}
      {pane.kind === 'run' ? (
        <ContextSheet
          open={Boolean(state.context.open)}
          onOpenChange={(open) =>
            update((current) => ({
              ...current,
              context: { ...current.context, open },
            }))
          }
          projectId={projectId}
          runId={pane.runId}
          title={pane.title ?? pane.runId}
          activeView={state.context.view ?? (target.kind === 'run' ? target.view : undefined)}
          onViewChange={(view) =>
            update((current) => ({
              ...current,
              context: { ...current.context, view },
            }))
          }
          renderContent={(view) => renderRun(view, pane.runId, pane)}
        />
      ) : null}
    </div>
  )
}
