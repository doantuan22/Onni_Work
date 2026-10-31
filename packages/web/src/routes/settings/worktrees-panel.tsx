import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { reclaimWorktrees, removeRunWorktree, startLifecycleRemoval } from '@/api/client'
import { queryKeys, useWorktrees, useConfig } from '@/api/queries'
import { lifecycleQueryKeys, useWorktreeLifecycles } from '@/api/worktree-lifecycle'
import { LifecycleOperationCard } from '@/components/worktree-lifecycle-operation'
import type { WorktreeLifecycleSummary, WorktreeInfo } from '@onni/api-client'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toaster'
import { useI18n } from '@/lib/i18n'
import { formatMem } from '@/lib/tasks-table'
import { shortAge } from '@/lib/format'

/** What the confirm dialog is about — a bulk reclaim, or one row's delete. */
type Confirming = { kind: 'reclaim' } | { kind: 'delete'; runId: string; title: string } | { kind: 'orphan'; worktreeId: string; title: string } | null

/**
 * Settings → Resources: the worktrees management panel (#483). Lists every task
 * worktree materialized on disk with its size, age and retention state; a
 * per-row Delete (reclaims the directory AND branch, the spec-006 route), a
 * footer with the total disk used and the keep-limit, and a "Reclaim now" button
 * that runs the count-based enforcer immediately. Both destructive actions
 * confirm through the design-system AlertDialog (native confirm() is banned).
 * Live-updates through the global event stream (queryKeys.worktrees).
 */
export function WorktreesPanel() {
  const { t, tn } = useI18n()
  const worktrees = useWorktrees()
  const lifecycle = useWorktreeLifecycles()
  const config = useConfig()
  const [selectedOperation, setSelectedOperation] = useState<{id: string; title: string} | null>(null)
  const managed = lifecycle.data?.worktrees ?? []
  const configured = !!config.data?.worktreeLifecycle && (config.data.worktreeLifecycle.afterCreate.length > 0 || config.data.worktreeLifecycle.beforeRemove.length > 0)
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState<Confirming>(null)
  const refresh = async () => {
    await Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.worktrees }), queryClient.invalidateQueries({ queryKey: lifecycleQueryKeys.all() })])
  }

  const reclaim = useMutation({
    mutationFn: () => reclaimWorktrees(),
    onSuccess: (result) => {
      void refresh()
      toast(
        result.reclaimed.length === 0
          ? configured || managed.some(item => item.operation || item.autoCleanupSuppressed)
            ? t('No worktrees reclaimed yet. Pending cleanup or retained worktrees may keep usage above the limit.')
            : t('Nothing to reclaim — all worktrees are within the limit')
          : tn(result.reclaimed.length, 'Reclaimed {count} worktree (branch kept)', 'Reclaimed {count} worktrees (branch kept)'),
      )
    },
    onError: (error: Error) => toast(error.message, { tone: 'danger' }),
  })

  const remove = useMutation({
    mutationFn: async (runId: string) => configured || managed.some(item => item.runId === runId)
      ? startLifecycleRemoval({ requestId: crypto.randomUUID(), runId, intent: 'remove-worktree' })
      : removeRunWorktree(runId),
    onSuccess: (result, runId) => {
      void refresh()
      if ('operation' in result) {
        setSelectedOperation({id: result.operation.id, title: worktrees.data?.worktrees.find(item => item.runId === runId)?.title ?? runId})
        toast(t('Cleanup requested. The worktree remains until cleanup and removal complete.'))
      } else toast(t('Worktree removed'))
    },
    onError: (error: Error) => toast(error.message, { tone: 'danger' }),
  })

  const removeOrphan = useMutation({
    mutationFn: (worktreeId: string) => startLifecycleRemoval({ requestId: crypto.randomUUID(), worktreeId, intent: 'orphan' }),
    onSuccess: result => { setSelectedOperation({id: result.operation.id, title: t('Orphan worktree')}); void refresh(); toast(t('Orphan cleanup requested. Review its progress below.')) },
    onError: (error: Error) => toast(error.message, { tone: 'danger' }),
  })

  if (worktrees.isPending) {
    return (
      <p data-slot="worktrees-loading" className="text-[13px] text-soft-foreground">
        {t('Loading worktrees…')}
      </p>
    )
  }
  if (worktrees.isError) {
    return (
      <p data-slot="worktrees-error" className="text-[13px] text-danger">
        {t('Worktrees did not load: {message}', { message: worktrees.error.message })}
      </p>
    )
  }

  const { worktrees: rows, totalBytes, keep } = worktrees.data
  const busy = reclaim.isPending || remove.isPending || removeOrphan.isPending

  const runConfirmed = () => {
    if (confirming?.kind === 'reclaim') reclaim.mutate()
    else if (confirming?.kind === 'delete') remove.mutate(confirming.runId)
    else if (confirming?.kind === 'orphan') removeOrphan.mutate(confirming.worktreeId)
    setConfirming(null)
  }

  return (
    <div data-slot="worktrees-panel" className="flex flex-col gap-3">
      {rows.length === 0 ? (
        <p data-slot="worktrees-empty" className="text-[13px] text-soft-foreground">
          {t('No task worktrees on disk.')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t('Task worktrees currently materialized on disk')}</caption>
            <thead>
              <tr className="border-b border-border text-left text-[12px] text-soft-foreground">
                <th scope="col" className="px-3 py-2 font-medium">{t('Task')}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t('Status')}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t('Size')}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t('Age')}</th>
                <th scope="col" className="px-3 py-2 font-medium text-right">{t('Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <WorktreeRow
                  key={w.runId}
                  worktree={w}
                  lifecycle={managed.find(item => item.runId === w.runId)}
                  disabled={busy || !!managed.find(item => item.runId === w.runId)?.operation}
                  onDelete={() => setConfirming({ kind: 'delete', runId: w.runId, title: w.title })}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p data-slot="worktrees-footer" className="text-[12px] text-soft-foreground">
          {tn(rows.length, '{count} worktree', '{count} worktrees')}
          {totalBytes !== null ? ` · ${t('{size} on disk', { size: formatMem(totalBytes) || '0 kB' })}` : ` · ${t('size unavailable')}`}
          {' · '}
          {keep === 0 ? t('keeping all (unlimited)') : t('keeping the last {count}', { count: keep })}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-action="worktrees-reclaim-now"
          disabled={busy}
          onClick={() => setConfirming({ kind: 'reclaim' })}
        >
          {t('Reclaim now')}
        </Button>
      </div>

      {lifecycle.isError && <p className="text-xs text-danger" role="alert">{t('Lifecycle state could not be loaded: {message}', { message: lifecycle.error.message })}</p>}
      {managed.filter(item => item.operation || item.autoCleanupSuppressed || item.needsAttention || !item.task).map(item => <section key={item.worktreeId} className="min-w-0 rounded-md border border-border p-3" data-slot="lifecycle-worktree-row">
        <h3 className="text-sm font-medium">{item.task?.title ?? t('Orphan worktree {id}', { id: item.runId.slice(0, 8) })}</h3>
        <p className="break-all font-mono text-[11px] text-muted-foreground">{item.worktreePath}</p>
        {item.error && <p className="mt-1 text-xs text-danger">{item.error}</p>}
        {item.needsAttention && <p className="mt-1 text-xs text-danger">{item.operation?.phase === 'setup' ? t('Setup needs attention') : t('Cleanup needs attention')} — {t('worktree retained.')}</p>}
        {item.autoCleanupSuppressed && <p className="mt-1 text-xs text-muted-foreground">{t('Automatic cleanup is suppressed for this generation because it was kept or cancelled. Explicit removal is still available.')}</p>}
        {item.operation ? <div id={`lifecycle-operation-${item.operation.id}`} className="mt-3 scroll-mt-4"><LifecycleOperationCard operationId={item.operation.id} worktreePath={item.worktreePath} taskTitle={item.task?.title} /></div>
          : !item.task && !item.error && item.onDisk ? <Button className="mt-2" type="button" variant="outline" size="sm" disabled={busy} onClick={() => setConfirming({kind: 'orphan', worktreeId: item.worktreeId, title: item.worktreePath})}>{t('Remove orphan worktree')}</Button> : null}
      </section>)}
      {selectedOperation && !managed.some(item => item.operation?.id === selectedOperation.id) && <div id={`lifecycle-operation-${selectedOperation.id}`}><LifecycleOperationCard operationId={selectedOperation.id} taskTitle={selectedOperation.title} /></div>}

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming?.kind === 'delete' || confirming?.kind === 'orphan' ? t('Delete this worktree?') : t('Reclaim old worktrees?')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming?.kind === 'delete' || confirming?.kind === 'orphan' ? (
                <>
                  {t('This removes the worktree directory and its branch — the local-only work is not recoverable afterwards. Configured cleanup scripts run first; failures retain the directory for your recovery choice.')}
                  <span className="mt-1 block truncate font-medium text-foreground" title={confirming.title}>
                    {confirming.title}
                  </span>
                </>
              ) : (
                t('Finished worktrees beyond the keep-limit are reclaimed now (directory only). Their branches are kept, so the work stays recoverable.')
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Keep it')}</AlertDialogCancel>
            <AlertDialogAction
              data-action="worktrees-confirm"
              className={confirming?.kind === 'delete' || confirming?.kind === 'orphan' ? 'bg-danger text-danger-foreground hover:brightness-[0.96]' : undefined}
              onClick={runConfirmed}
            >
              {confirming?.kind === 'delete' || confirming?.kind === 'orphan' ? t('Delete') : t('Reclaim now')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function WorktreeRow({
  worktree,
  lifecycle,
  disabled,
  onDelete,
}: {
  worktree: WorktreeInfo
  lifecycle?: WorktreeLifecycleSummary
  disabled: boolean
  onDelete: () => void
}) {
  const { t } = useI18n()
  return (
    <tr data-slot="worktree-row" data-run={worktree.runId} className="border-b border-border last:border-0">
      <th scope="row" className="max-w-[220px] px-3 py-2 text-left font-normal">
        <span className="block truncate text-foreground" title={worktree.title}>{worktree.title}</span>
        <span className="block truncate font-mono text-[11px] text-soft-foreground">
          {worktree.branch ?? worktree.runId.slice(0, 8)}
        </span>
      </th>
      <td className="px-3 py-2">
        <span className="text-[12px] text-soft-foreground">{worktree.status}</span>
        {lifecycle?.needsAttention && <span className="block text-[11px] text-danger">{lifecycle.operation?.phase === 'setup' ? t('Setup needs attention') : t('Cleanup needs attention')}</span>}
        {lifecycle?.autoCleanupSuppressed && <span className="block text-[11px] text-muted-foreground">{t('Automatic cleanup suppressed')}</span>}
        {worktree.reclaimable && !lifecycle?.autoCleanupSuppressed ? (
          <span data-slot="worktree-reclaimable" className="ml-1 text-[11px] text-soft-foreground">
            {t('(reclaimable)')}
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2 tabular-nums text-soft-foreground">
        {worktree.sizeBytes !== null ? formatMem(worktree.sizeBytes) || '0 kB' : '—'}
      </td>
      <td className="px-3 py-2 tabular-nums text-soft-foreground">{shortAge(worktree.finishedAt ?? undefined) || '—'}</td>
      <td className="px-3 py-2 text-right">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-action="worktree-delete"
          aria-label={t('Delete the worktree for {task}', { task: worktree.title })}
          disabled={disabled}
          onClick={onDelete}
        >
          {t('Delete')}
        </Button>
      </td>
    </tr>
  )
}
