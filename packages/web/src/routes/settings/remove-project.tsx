import { useWebhookList } from '@/hooks/use-webhooks'
import { useHealth, useRemoveProject } from '@/api/queries'
import type { ProjectListEntry } from '@onni/api-client'
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
import { toast } from '@/components/ui/toaster'
import { useI18n } from '@/lib/i18n'

/**
 * Removing a project, said the same way in both places that offer it: the global registry table
 * (Settings → Projects) and the project's own General page.
 *
 * "Remove" next to a project path is exactly the kind of button a user reads as "delete my repo",
 * so the wording is load-bearing and belongs in ONE file — the confirm title, the body, the path
 * it names and the success toast all insist on the same fact: this DEREGISTERS.
 * `DELETE /api/v1/projects/:id` is a registry filter and touches nothing under the root (see the
 * route), and adding the folder back later finds its tasks and worktrees intact. It does NOT come
 * back on its own: boot registration is seed-once (`shouldAutoRegisterProject`), so serving the
 * folder again never re-registers it.
 *
 * The refusals stay the server's: a project with running tasks and the boot project both answer
 * 409, whose message is toasted verbatim. Callers that can know about the boot project up front
 * (both of them) disable the trigger instead, so the explanation arrives before the click.
 */

/** The deregistration itself, with the wording every caller shares. `onRemoved` runs only after
 *  the server confirmed — the project's own settings page uses it to navigate off a URL that has
 *  just stopped resolving. */
export function useProjectRemoval() {
  const { t } = useI18n()
  const remove = useRemoveProject()
  return {
    isPending: remove.isPending,
    confirm: (project: ProjectListEntry, onRemoved?: () => void) =>
      remove.mutate(project.id, {
        // "Removed from the workspace", not "Deleted": the toast is the last word the user reads
        // about a button they may have pressed nervously.
        onSuccess: (result) => {
          if (result.warning) toast(result.warning, { tone: 'danger' })
          toast(t('{name} removed from the workspace — its files are untouched', { name: project.name }))
          onRemoved?.()
        },
        onError: (error: Error) => toast(error.message, { tone: 'danger' }),
      }),
  }
}

/** The confirm step. `project` doubles as the open state — `null` while it is closed. */
export function RemoveProjectDialog({
  project,
  onOpenChange,
  onConfirm,
}: {
  project: ProjectListEntry | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const { t, tn } = useI18n()
  const health = useHealth()
  const webhooks = useWebhookList(project?.id ?? 'default', project !== null && health.data?.capabilities?.webhooks === true)
  const affected = webhooks.data?.receivers.filter(receiver => ['active', 'suspended'].includes(receiver.state)) ?? []
  const pending = affected.reduce((total, receiver) => total + receiver.pendingCount, 0)
  const inFlight = affected.reduce((total, receiver) => total + receiver.inFlightCount, 0)
  return (
    <AlertDialog open={project !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('Remove {name} from the workspace?', { name: project?.name ?? '' })}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('This only unregisters the project —')}{' '}
            <strong>{t('nothing on disk is deleted')}</strong>
            {t('. The folder, its git history and its task history all stay exactly where they are, and adding it back later finds everything intact.')}
            {affected.length > 0 && <span className="mt-2 block">{t('{receivers} will be paused. {deliveries} will be cancelled; {inFlight} in flight may still arrive.', { receivers: tn(affected.length, '{count} receiver', '{count} receivers'), deliveries: tn(pending, '{count} pending delivery', '{count} pending deliveries'), inFlight })}</span>}
            {webhooks.error && <span className="mt-2 block">{t('Webhook state is unavailable. Removal will report whether receivers could be paused.')}</span>}
            <span className="mt-1 block truncate font-mono text-[11px] text-foreground" title={project?.root}>
              {project?.root}
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('Keep it')}</AlertDialogCancel>
          <AlertDialogAction
            data-action="projects-confirm-remove"
            className="bg-danger text-danger-foreground hover:brightness-[0.96]"
            onClick={onConfirm}
          >
            {t('Remove from list')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
