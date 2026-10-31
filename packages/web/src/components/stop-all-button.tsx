import { useMutation, useQueryClient } from '@tanstack/react-query'
import { OctagonXIcon } from 'lucide-react'

import { stopAllRuns } from '@/api/client'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toaster'

/**
 * The emergency stop (docs/design/unattended-safety.md §6): cancels every queued and live task in
 * every project. Worktrees and sessions are kept, so Continue still works. One confirmation, then
 * it acts — a runaway night is not the moment for a second dialog.
 */
export function StopAllButton({
  confirm = (message: string) => window.confirm(message),
  className,
}: {
  confirm?: (message: string) => boolean
  className?: string
}) {
  const queryClient = useQueryClient()
  const stop = useMutation({
    mutationFn: stopAllRuns,
    onSuccess: ({ stopped }) => {
      toast(stopped === 0 ? 'Nothing was running' : `Stopped ${stopped} task${stopped === 1 ? '' : 's'}`)
      void queryClient.invalidateQueries()
    },
    onError: (error: Error) => toast(error.message, { tone: 'danger' }),
  })
  return (
    <Button
      type="button"
      variant="danger-ghost"
      size="sm"
      data-slot="stop-all"
      disabled={stop.isPending}
      className={className}
      onClick={() => {
        if (confirm('Stop every queued and running task in every project? Worktrees and sessions are kept; Continue still works.')) {
          stop.mutate()
        }
      }}
    >
      <OctagonXIcon className="size-[14px]" aria-hidden="true" />
      Stop all
    </Button>
  )
}
