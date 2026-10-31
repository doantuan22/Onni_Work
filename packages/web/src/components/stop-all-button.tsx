import { useMutation, useQueryClient } from '@tanstack/react-query'
import { OctagonXIcon } from 'lucide-react'
import { useState } from 'react'

import { stopAllRuns } from '@/api/client'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toaster'
import { useI18n } from '@/lib/i18n'

/**
 * The emergency stop (docs/design/unattended-safety.md §6): cancels every queued and live task in
 * every project. Worktrees and sessions are kept, so Continue still works. One confirmation, then
 * it acts — a runaway night is not the moment for a second dialog.
 */
export function StopAllButton({ className }: { className?: string }) {
  const { t, tn } = useI18n()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const stop = useMutation({
    mutationFn: stopAllRuns,
    onSuccess: ({ stopped }) => {
      toast(stopped === 0 ? t('Nothing was running') : tn(stopped, 'Stopped {count} task', 'Stopped {count} tasks'))
      void queryClient.invalidateQueries()
    },
    onError: (error: Error) => toast(error.message, { tone: 'danger' }),
  })
  return (
    <>
      <Button
        type="button"
        variant="danger-ghost"
        size="sm"
        data-slot="stop-all"
        disabled={stop.isPending}
        className={className}
        onClick={() => setConfirming(true)}
      >
        <OctagonXIcon className="size-[14px]" aria-hidden="true" />
        {t('Stop all')}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('Stop every task?')}
        description={t('Cancels every queued and running task in every project. Worktrees and sessions are kept; Continue still works.')}
        confirmLabel={t('Stop all')}
        danger
        onConfirm={() => stop.mutate()}
      />
    </>
  )
}
