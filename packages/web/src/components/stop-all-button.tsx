import { useMutation, useQueryClient } from '@tanstack/react-query'
import { OctagonXIcon } from 'lucide-react'
import { useState } from 'react'

import { stopAllRuns } from '@/api/client'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toaster'

/**
 * The emergency stop (docs/design/unattended-safety.md §6): cancels every queued and live task in
 * every project. Worktrees and sessions are kept, so Continue still works. One confirmation, then
 * it acts — a runaway night is not the moment for a second dialog.
 */
export function StopAllButton({ className }: { className?: string }) {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const stop = useMutation({
    mutationFn: stopAllRuns,
    onSuccess: ({ stopped }) => {
      toast(stopped === 0 ? 'Nothing was running' : `Stopped ${stopped} task${stopped === 1 ? '' : 's'}`)
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
        Stop all
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Stop every task?"
        description="Cancels every queued and running task in every project. Worktrees and sessions are kept; Continue still works."
        confirmLabel="Stop all"
        danger
        onConfirm={() => stop.mutate()}
      />
    </>
  )
}
