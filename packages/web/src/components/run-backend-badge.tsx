import type { RunRecord } from '@onni/api-client'

import { useI18n } from '@/lib/i18n'

/**
 * Which agent ran (or manages) a task in a dispatch tree: "claude · opus" for a manager,
 * "codex · gpt-5" for a worker. Only tasks that belong to a tree wear one — a plain task's
 * backend is already in its header — so the tree reads at a glance who did what.
 */
export function RunBackendBadge({ run }: { run: Pick<RunRecord, 'runner' | 'model' | 'roster' | 'dispatch' | 'managerFullAccess'> }) {
  const { t } = useI18n()
  const inTree = run.dispatch !== undefined || run.roster !== undefined
  if (!inTree) return null
  const role = run.roster ? 'manager' : run.dispatch?.parentRunId ? 'worker' : undefined
  const roleLabel = role === undefined ? undefined : role === 'manager' ? t('manager') : t('worker')
  const backend = run.runner ?? 'claude'
  return (
    <>
    <span
      data-slot="run-backend-badge"
      data-backend={backend}
      title={`${roleLabel ? `${roleLabel}: ` : ''}${backend}${run.model ? ` (${run.model})` : ''}`}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-1.5 py-px font-mono text-[10px] font-medium text-soft-foreground"
    >
      {role === 'manager' ? '★ ' : ''}
      {backend}
      {run.model ? <span className="text-muted-foreground">· {run.model}</span> : null}
    </span>
    {role === 'manager' && run.managerFullAccess ? (
      <span
        data-slot="manager-full-access-badge"
        title={t('This manager may merge (Full manager access)')}
        className="inline-flex shrink-0 items-center rounded-full border border-danger/50 bg-danger/10 px-1.5 py-px text-[10px] font-semibold text-danger"
      >
        {t('full access')}
      </span>
    ) : null}
    </>
  )
}
