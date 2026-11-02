import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2Icon } from 'lucide-react'
import { useState } from 'react'

import { clearProjectData } from '@/api/client'
import type { ProjectListEntry } from '@onni/api-client'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toaster'
import { useI18n } from '@/lib/i18n'
import { SettingsField } from './settings-field'

/**
 * Settings → this project → "Delete project data": every task of THIS project, with its chat and
 * its worktree, in one confirmed step. The folder, its git history and every other project are
 * untouched. The user types the project's name, the GitHub-style guard for an irreversible
 * action; the server checks the same name, so a stray request cannot do it either.
 */
export function ClearProjectData({ project }: { project: ProjectListEntry }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const matches = typed.trim().toLowerCase() === project.name.toLowerCase()

  const clear = useMutation({
    mutationFn: () => clearProjectData(project.id, typed.trim()),
    onSuccess: async (result) => {
      setOpen(false)
      setTyped('')
      // Every list that may show these tasks (sidebar, tasks page, dashboard) reads again.
      await queryClient.invalidateQueries()
      const skipped = result.skipped.length
      toast(
        skipped === 0
          ? t('Deleted {count} tasks and their chats', { count: result.deleted })
          : t('Deleted {count} tasks; kept {skipped} that are still running', { count: result.deleted, skipped }),
      )
    },
    onError: (error: Error) => toast(error.message, { tone: 'danger' }),
  })

  return (
    <SettingsField
      title={t('Delete project data')}
      hint={t('Deletes every task of this project with its chat, notes, worktree and branch. Running tasks are kept. The project folder, its files and its git history are not touched.')}
    >
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-action="project-clear-data"
          className="gap-1.5 text-danger"
          onClick={() => setOpen(true)}
        >
          <Trash2Icon className="size-3.5" aria-hidden="true" />
          {t('Delete all tasks and chats…')}
        </Button>
      </div>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (clear.isPending) return
          setOpen(next)
          if (!next) setTyped('')
        }}
      >
        <AlertDialogContent data-slot="project-clear-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Delete all tasks and chats of {name}?', { name: project.name })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('This cannot be undone. Every finished, failed or cancelled task of this project is deleted with its chat, notes, worktree and branch. Tasks that are still running are kept.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex flex-col gap-1.5 text-[13px]">
            <span className="text-muted-foreground">
              {t('Type the project name to confirm:')} <strong className="font-mono text-foreground">{project.name}</strong>
            </span>
            <Input
              autoFocus
              data-slot="project-clear-confirm-input"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && matches && !clear.isPending) clear.mutate()
              }}
              aria-label={t('Project name')}
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clear.isPending}>{t('Cancel')}</AlertDialogCancel>
            <Button
              type="button"
              data-action="project-clear-confirm"
              disabled={!matches || clear.isPending}
              onClick={() => clear.mutate()}
              className="bg-danger text-danger-foreground hover:brightness-[0.96]"
            >
              {clear.isPending ? t('Deleting…') : t('Delete everything')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsField>
  )
}
