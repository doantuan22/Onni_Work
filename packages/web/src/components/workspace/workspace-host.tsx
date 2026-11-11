import { PanelRightIcon } from 'lucide-react'
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { UNSAFE_RouteContext } from 'react-router'

import { useProjectScope } from '@/api/project-scope-context'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toaster'
import { useI18n } from '@/lib/i18n'
import { scopeToProject, useNavigate } from '@/lib/project-router'
import { useIsDesktop } from '@/lib/use-desktop'
import { cn } from '@/lib/utils'
import { useWorkspacePanesSync } from '@/lib/workspace-panes-sync'
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
import { navigateWorkspacePane } from '@/routes/task-workspace/url-sync'

import { ActivePaneProvider, useActivePane } from './active-pane-context'
import { ContextSheet } from './context-sheet'
import { SplitTabStrip } from './split-tab-strip'
import { useMarkViewed } from './use-mark-viewed'
import { useWorkspaceShortcuts } from './use-workspace-shortcuts'

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
 * Scopes `useParams()` inside a rendered run pane to that pane's own `runId` and `projectId`,
 * so split panes never read the other pane's route param from the outer URL match.
 */
function PaneRouteScope({
  projectId,
  runId,
  children,
}: {
  projectId: string
  runId: string
  children: ReactNode
}) {
  const routeContext = useContext(UNSAFE_RouteContext)
  const scopedContext = useMemo(() => {
    if (routeContext.matches.length === 0) return routeContext
    const matches = routeContext.matches.map((match, index) =>
      index === routeContext.matches.length - 1
        ? { ...match, params: { ...match.params, projectId, id: runId } }
        : match,
    )
    return { ...routeContext, matches }
  }, [projectId, routeContext, runId])

  return (
    <UNSAFE_RouteContext.Provider value={scopedContext}>
      {children}
    </UNSAFE_RouteContext.Provider>
  )
}

/**
 * Project-scoped thread host. The URL and active pane converge in both 1-up and 2-up split modes:
 * URL visits (including Back/Forward) focus their target pane, while local pane activations push
 * the newly active pane's URL through `navigateWorkspacePane`.
 */
export function WorkspaceHost({ projectId, target, renderRun }: WorkspaceHostProps) {
  useWorkspacePanesSync(projectId)
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

  useWorkspaceShortcuts({ projectId })
  useMarkViewed({ projectId, state, target })

  const [scrollAnchors, setScrollAnchors] = useState<Record<string, number>>({})

  const updateScrollAnchor = useCallback((paneId: string, scrollTop: number) => {
    setScrollAnchors((prev) => {
      if (prev[paneId] === scrollTop) return prev
      return { ...prev, [paneId]: scrollTop }
    })
  }, [])

  const syncPaneUrl = useCallback(
    (nextPane: PaneRef | undefined, currentThreads: readonly PaneRef[]) => {
      if (!nextPane) return
      const openRunIds = currentThreads
        .filter((thread): thread is RunPaneRef => thread.kind === 'run')
        .map((thread) => thread.runId)
      navigateWorkspacePane(
        (to, options) => {
          void navigate(projectId ? scopeToProject(to, projectId) : to, options)
        },
        {
          route: target,
          effective: nextPane.kind === 'run' ? { kind: 'run', runId: nextPane.runId } : { kind: 'draft' },
          openRunIds,
        },
      )
    },
    [navigate, projectId, target],
  )

  const targetPaneId = target.kind === 'run' ? `run:${projectId}:${target.runId}` : `draft:${projectId}`
  const prevSyncRef = useRef({ targetPaneId, activePaneId: state.active })

  useEffect(() => {
    update((current) =>
      target.kind === 'run'
        ? openRun(current, runPane(projectId, target.runId))
        : openDraft(current, draftPane(projectId)),
    )
  }, [projectId, target.kind, target.kind === 'run' ? target.runId : undefined, update])

  useEffect(() => {
    if (state.active) activePane.setActive(state.active)
    const prev = prevSyncRef.current
    prevSyncRef.current = { targetPaneId, activePaneId: state.active }
    if (
      prev.targetPaneId === targetPaneId
      && prev.activePaneId === targetPaneId
      && state.active !== undefined
      && state.active !== targetPaneId
    ) {
      const activeThread = state.threads.find((thread) => thread.paneId === state.active)
      syncPaneUrl(activeThread, state.threads)
    }
  }, [activePane, state.active, state.threads, syncPaneUrl, targetPaneId])

  const activate = useCallback(
    (paneId: string) => {
      activePane.setActive(paneId)
      let activatedPane: PaneRef | undefined
      let nextThreads: readonly PaneRef[] = []
      update((current) => {
        const next = setActive(current, paneId)
        activatedPane = next.threads.find((thread) => thread.paneId === next.active)
        nextThreads = next.threads
        return next
      })
      syncPaneUrl(activatedPane, nextThreads)
    },
    [activePane, syncPaneUrl, update],
  )

  const handleClosePane = useCallback(
    (paneId: string) => {
      let nextActivePane: PaneRef | undefined
      let nextThreads: readonly PaneRef[] = []
      update((current) => {
        const next = closePane(current, paneId)
        if (current.active === paneId && next.active) {
          nextActivePane = next.threads.find((t) => t.paneId === next.active)
          nextThreads = next.threads
        }
        return next
      })
      if (nextActivePane) {
        activePane.setActive(nextActivePane.paneId)
        syncPaneUrl(nextActivePane, nextThreads)
      }
    },
    [activePane, syncPaneUrl, update],
  )

  const handlePickThread = useCallback(
    (runId: string) => {
      let pickedPane: PaneRef | undefined
      let nextThreads: readonly PaneRef[] = []
      update((current) => {
        const next = openBeside(current, runId, projectId)
        pickedPane = next.threads.find((t) => t.paneId === next.active)
        nextThreads = next.threads
        return next
      })
      if (pickedPane) {
        activePane.setActive(pickedPane.paneId)
        syncPaneUrl(pickedPane, nextThreads)
      }
    },
    [activePane, projectId, syncPaneUrl, update],
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
          <PaneRouteScope projectId={projectId} runId={pane.runId}>
            {renderRun(paneView, pane.runId, pane)}
          </PaneRouteScope>
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
            onPickThread={handlePickThread}
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
            renderContent={(view) => (
              <PaneRouteScope projectId={projectId} runId={activePaneRef.runId}>
                {renderRun(view, activePaneRef.runId, activePaneRef)}
              </PaneRouteScope>
            )}
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
          renderContent={(view) => (
            <PaneRouteScope projectId={projectId} runId={pane.runId}>
              {renderRun(view, pane.runId, pane)}
            </PaneRouteScope>
          )}
        />
      ) : null}
    </div>
  )
}
