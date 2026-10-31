import type { RunRecord } from '@onni/api-client'

/**
 * Which agent ran (or manages) a task in a dispatch tree: "claude · opus" for a manager,
 * "codex · gpt-5" for a worker. Only tasks that belong to a tree wear one — a plain task's
 * backend is already in its header — so the tree reads at a glance who did what.
 */
export function RunBackendBadge({ run }: { run: Pick<RunRecord, 'runner' | 'model' | 'roster' | 'dispatch'> }) {
  const inTree = run.dispatch !== undefined || run.roster !== undefined
  if (!inTree) return null
  const role = run.roster ? 'manager' : run.dispatch?.parentRunId ? 'worker' : undefined
  const backend = run.runner ?? 'claude'
  return (
    <span
      data-slot="run-backend-badge"
      data-backend={backend}
      title={`${role ? `${role}: ` : ''}${backend}${run.model ? ` (${run.model})` : ''}`}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-1.5 py-px font-mono text-[10px] font-medium text-soft-foreground"
    >
      {role === 'manager' ? '★ ' : ''}
      {backend}
      {run.model ? <span className="text-muted-foreground">· {run.model}</span> : null}
    </span>
  )
}
