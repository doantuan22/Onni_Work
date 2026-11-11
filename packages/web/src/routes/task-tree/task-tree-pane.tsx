import * as React from 'react'
import { GitBranchIcon, GitForkIcon, TriangleAlertIcon } from 'lucide-react'

import type { ApiRun } from '@onni/api-client'
import { useRuns } from '@/api/queries'
import { useRunHistory } from '@/api/run-history'
import { CenteredState } from '@/components/centered-state'
import { RunBackendBadge } from '@/components/run-backend-badge'
import { StatusDot } from '@/components/status-dot'
import { deriveAttention, type AttentionTone } from '@/lib/attention'
import { useI18n } from '@/lib/i18n'
import { runTitle } from '@/lib/task-groups'
import { buildTaskTree, flattenTaskTree, type TaskTreeNode } from '@/lib/task-tree'
import { cn } from '@/lib/utils'
import {
  collectSubagents,
  subagentActivityText,
  type SubagentSummary,
} from '@/routes/task-thread/subagent-dock'
import { reduceThread, type ThreadTurn } from '@/routes/task-thread/thread-state'

export interface TaskTreePaneProps {
  /** The active run ID representing the current conversation or view */
  runId: string
  /** Fired when clicking on any run row in the manager->worker tree */
  onOpenRun?: (runId: string) => void
  /** Fired when clicking on a runner subagent */
  onOpenSubagent?: (subagentId: string) => void
  /** Injected runs list (overrides useRuns query when supplied) */
  runs?: ApiRun[]
  /** Injected runner subagents list (overrides derivation when supplied) */
  subagents?: SubagentSummary[]
  /** Injected turns from which runner subagents are derived */
  turns?: ThreadTurn[]
  /** Optional extra classes */
  className?: string
}

function getReportSummary(run: ApiRun): string | undefined {
  if (run.dispatch?.report?.result) {
    const line = run.dispatch.report.result.split('\n').find((l) => l.trim().length > 0)
    if (line) return line.trim()
  }
  if (run.dispatch?.report?.status) {
    return `Report: ${run.dispatch.report.status}`
  }
  return run.titleSummary
}

function getChangedFilesCount(run: ApiRun): number | undefined {
  if (typeof run.diffStat?.files === 'number') {
    return run.diffStat.files
  }
  return undefined
}

function subagentTone(agent: SubagentSummary): { tone: AttentionTone; pulse: boolean } {
  if (agent.stalled) return { tone: 'danger', pulse: false }
  switch (agent.status) {
    case 'completed':
      return { tone: 'success', pulse: false }
    case 'running':
      return { tone: 'pending', pulse: true }
    case 'failed':
    case 'declined':
      return { tone: 'danger', pulse: false }
    case 'pending':
      return { tone: 'pending', pulse: true }
    default:
      return { tone: 'neutral', pulse: false }
  }
}

function BackendChip({ run }: { run: ApiRun }) {
  const inTree = run.dispatch !== undefined || run.roster !== undefined
  if (inTree) {
    return (
      <span data-slot="backend-chip">
        <RunBackendBadge run={run} />
      </span>
    )
  }
  const runner = run.runner ?? 'claude'
  return (
    <span
      data-slot="backend-chip"
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-1.5 py-px font-mono text-[10px] font-medium text-soft-foreground"
    >
      {runner}
      {run.model ? <span className="text-muted-foreground">· {run.model}</span> : null}
    </span>
  )
}

/**
 * Unified task-tree pane component (design.md §4 'Manager -> worker').
 *
 * Shows the manager->worker tree of persistent dispatched child runs (depth-nested,
 * single-line truncating rows with status dot, title, backend chip, branch, report summary line,
 * and changed-files count).
 *
 * Below it, displays a separate 'Runner subagents' section derived from subagent-dock.ts.
 * The counts between dispatched runs and runner subagents are strictly distinct and never merged.
 */
export function TaskTreePane({
  runId,
  onOpenRun,
  onOpenSubagent,
  runs: runsProp,
  subagents: subagentsProp,
  turns: turnsProp,
  className,
}: TaskTreePaneProps) {
  const { t } = useI18n()
  const runsQuery = useRuns()
  const runs = runsProp ?? runsQuery.data

  const history = useRunHistory(
    subagentsProp === undefined && turnsProp === undefined ? runId : undefined,
  )

  const currentRun = runs?.find((r) => r.id === runId)
  const rootRunId = currentRun?.dispatch?.rootRunId ?? runId

  // Build the tree runs set: root + all dispatched descendants
  const treeRuns = React.useMemo(() => {
    if (!runs) return []
    const treeRunIds = new Set<string>([rootRunId])
    for (const r of runs) {
      if (r.dispatch?.rootRunId === rootRunId) {
        treeRunIds.add(r.id)
      }
    }
    let added = true
    while (added) {
      added = false
      for (const r of runs) {
        if (!treeRunIds.has(r.id) && r.dispatch?.parentRunId && treeRunIds.has(r.dispatch.parentRunId)) {
          treeRunIds.add(r.id)
          added = true
        }
      }
    }
    return runs.filter((r) => treeRunIds.has(r.id))
  }, [runs, rootRunId])

  const treeNodes = React.useMemo(() => {
    return flattenTaskTree(buildTaskTree(treeRuns))
  }, [treeRuns])

  const dispatchedCount = React.useMemo(() => {
    return treeNodes.filter((node) => node.depth > 0).length
  }, [treeNodes])

  const runIsTerminal = currentRun
    ? currentRun.status !== 'running' && currentRun.status !== 'queued' && currentRun.status !== 'waiting'
    : false

  const threadTurns = React.useMemo(() => {
    if (turnsProp) return turnsProp
    if (history?.currentEvents && history.currentEvents.length > 0) {
      const reduced = reduceThread(history.currentEvents, {
        activeTurn: currentRun?.status === 'running',
        runner: currentRun?.runner,
      })
      return reduced.turns
    }
    return []
  }, [turnsProp, history?.currentEvents, currentRun?.status, currentRun?.runner])

  const subagents = React.useMemo(() => {
    if (subagentsProp) return subagentsProp
    if (threadTurns.length > 0) {
      return collectSubagents(threadTurns, runIsTerminal)
    }
    return []
  }, [subagentsProp, threadTurns, runIsTerminal])

  const subagentCount = subagents.length

  // Error state: failure fetching runs
  if (runsQuery.isError && !runsProp) {
    return (
      <section
        data-slot="task-tree-pane"
        data-route="task-tree"
        className={cn('flex h-full min-h-0 min-w-0 flex-col bg-background', className)}
      >
        <header className="flex h-header min-h-header min-w-0 items-center justify-between border-b border-border px-3">
          <h2 className="text-xs font-medium text-foreground">{t('Task tree')}</h2>
        </header>
        <div data-slot="tree-error" className="flex min-h-0 flex-1 items-center justify-center p-4">
          <CenteredState
            icon={<TriangleAlertIcon className="size-6" />}
            tone="danger"
            heading="h2"
            title={t('Could not load task tree')}
            subtitle={
              runsQuery.error instanceof Error
                ? runsQuery.error.message
                : t('Could not load tasks for this tree')
            }
          />
        </div>
      </section>
    )
  }

  // Loading state
  if (runsQuery.isPending && !runsProp) {
    return (
      <section
        data-slot="task-tree-pane"
        data-route="task-tree"
        className={cn('flex h-full min-h-0 min-w-0 flex-col bg-background', className)}
      >
        <header className="flex h-header min-h-header min-w-0 items-center justify-between border-b border-border px-3">
          <h2 className="text-xs font-medium text-foreground">{t('Task tree')}</h2>
        </header>
        <div data-slot="tree-loading" className="flex min-h-0 flex-1 items-center justify-center p-4">
          <span className="text-xs text-muted-foreground">{t('Loading task tree…')}</span>
        </div>
      </section>
    )
  }

  // Empty state: no dispatched workers and no runner subagents
  if (dispatchedCount === 0 && subagentCount === 0) {
    return (
      <section
        data-slot="task-tree-pane"
        data-route="task-tree"
        className={cn('flex h-full min-h-0 min-w-0 flex-col bg-background', className)}
      >
        <header className="flex h-header min-h-header min-w-0 items-center justify-between border-b border-border px-3">
          <h2 className="text-xs font-medium text-foreground">{t('Task tree')}</h2>
        </header>
        <div data-slot="tree-empty" className="flex min-h-0 flex-1 items-center justify-center p-4">
          <CenteredState
            icon={<GitForkIcon className="size-6" />}
            tone="neutral"
            heading="h2"
            title={t('No subtasks or runner subagents')}
            subtitle={t('This task has no dispatched child tasks or runner subagents.')}
          />
        </div>
      </section>
    )
  }

  return (
    <section
      data-slot="task-tree-pane"
      data-route="task-tree"
      className={cn('flex h-full min-h-0 min-w-0 flex-col bg-background', className)}
    >
      <header className="flex h-header min-h-header min-w-0 items-center justify-between border-b border-border px-3">
        <h2 className="text-xs font-medium text-foreground">{t('Task tree')}</h2>
      </header>

      <div
        data-slot="task-tree-content"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain"
      >
        {/* Section 1: Dispatched tasks */}
        <section
          data-slot="dispatched-tasks-section"
          aria-label={t('Dispatched tasks')}
          className="flex flex-col border-b border-border"
        >
          <div className="flex h-8 items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>{t('Dispatched tasks')}</span>
            <span data-slot="dispatched-count" className="tabular-nums font-mono text-[10px]">
              {dispatchedCount}
            </span>
          </div>

          {dispatchedCount === 0 ? (
            <p data-slot="no-dispatched" className="px-3 py-2 text-xs text-muted-foreground">
              {t('No dispatched tasks')}
            </p>
          ) : (
            <div role="tree" aria-label={t('Task hierarchy')} className="flex flex-col">
              {treeNodes.map((node) => {
                const attention = deriveAttention(node.run)
                const reportSummary = getReportSummary(node.run)
                const changedFiles = getChangedFilesCount(node.run)
                const isCurrent = node.run.id === runId
                const title = runTitle(node.run)

                return (
                  <div
                    key={node.run.id}
                    role="treeitem"
                    aria-level={node.depth + 1}
                    aria-selected={isCurrent}
                    data-slot="task-tree-row"
                    data-run-id={node.run.id}
                    data-depth={node.depth}
                    data-current={isCurrent ? 'true' : undefined}
                    tabIndex={0}
                    onClick={() => onOpenRun?.(node.run.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onOpenRun?.(node.run.id)
                      }
                    }}
                    className={cn(
                      'group/tree-row flex min-w-0 cursor-pointer items-center justify-between gap-2 border-b border-border/40 px-3 py-2 text-xs transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none',
                      isCurrent && 'bg-muted/70 font-medium',
                    )}
                  >
                    <div
                      className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden"
                      style={{ paddingLeft: `${node.depth * 16}px` }}
                    >
                      <StatusDot
                        tone={attention.tone}
                        pulse={attention.pulse}
                        data-slot="status-dot"
                        aria-label={t(attention.label)}
                      />
                      <span
                        data-slot="task-title"
                        className="truncate font-medium text-foreground"
                        title={title}
                      >
                        {title}
                      </span>
                      <BackendChip run={node.run} />
                      {node.run.branch ? (
                        <span
                          data-slot="branch-chip"
                          className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] text-muted-foreground truncate"
                          title={node.run.branch}
                        >
                          <GitBranchIcon className="size-3 shrink-0" aria-hidden="true" />
                          <span className="truncate">{node.run.branch}</span>
                        </span>
                      ) : null}
                      {reportSummary ? (
                        <span
                          data-slot="report-summary"
                          className="truncate text-xs text-muted-foreground"
                          title={reportSummary}
                        >
                          {reportSummary}
                        </span>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {changedFiles !== undefined ? (
                        <span
                          data-slot="changed-files-count"
                          className="font-mono text-[10px] tabular-nums text-muted-foreground"
                        >
                          {changedFiles} {changedFiles === 1 ? t('file') : t('files')}
                        </span>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* Section 2: Runner subagents */}
        <section
          data-slot="runner-subagents-section"
          aria-label={t('Runner subagents')}
          className="flex flex-col"
        >
          <div className="flex h-8 items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>{t('Runner subagents')}</span>
            <span data-slot="runner-subagents-count" className="tabular-nums font-mono text-[10px]">
              {subagentCount}
            </span>
          </div>

          {subagentCount === 0 ? (
            <p data-slot="no-subagents" className="px-3 py-2 text-xs text-muted-foreground">
              {t('No runner subagents')}
            </p>
          ) : (
            <div role="list" aria-label={t('Runner subagents list')} className="flex flex-col">
              {subagents.map((agent) => {
                const toneInfo = subagentTone(agent)
                const activityText = subagentActivityText(agent)

                return (
                  <div
                    key={agent.id}
                    role="listitem"
                    data-slot="runner-subagent-row"
                    data-subagent-id={agent.id}
                    tabIndex={0}
                    onClick={() => onOpenSubagent?.(agent.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onOpenSubagent?.(agent.id)
                      }
                    }}
                    className="flex min-w-0 cursor-pointer items-center justify-between gap-2 border-b border-border/40 px-3 py-2 text-xs transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                      <StatusDot
                        tone={toneInfo.tone}
                        pulse={toneInfo.pulse}
                        data-slot="subagent-status-dot"
                        aria-label={agent.status}
                      />
                      <span
                        data-slot="subagent-title"
                        className="truncate font-medium text-foreground"
                        title={agent.title}
                      >
                        {agent.title}
                      </span>
                      {agent.agentType ? (
                        <span
                          data-slot="subagent-type"
                          className="shrink-0 rounded-full border border-border px-1.5 py-px font-mono text-[10px] text-muted-foreground"
                        >
                          {agent.agentType}
                        </span>
                      ) : null}
                      <span
                        data-slot="subagent-activity"
                        className="truncate text-xs text-muted-foreground"
                        title={activityText}
                      >
                        {activityText}
                      </span>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        data-slot="subagent-tool-calls"
                        className="font-mono text-[10px] tabular-nums text-muted-foreground"
                      >
                        {agent.toolCalls} {agent.toolCalls === 1 ? t('tool') : t('tools')}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </section>
  )
}
