import { useMutation, useQueryClient } from '@tanstack/react-query'
import { BrainIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { ApiError, putManagerMemory } from '@/api/client'
import { queryKeys, useManagerMemory } from '@/api/queries'
import { queryScope, type ManagerMemoryRead } from '@onni/api-client'
import { CenteredState } from '@/components/centered-state'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { fieldClass } from '@/components/form-field'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toaster'
import { useI18n } from '@/lib/i18n'
import { SettingsField } from './settings-field'

/** One remembered lesson, with the provenance the file line carries (`task <id8>, date`). */
interface MemoryEntry {
  text: string
  task?: string
  date?: string
}

const ENTRY_LINE = /^-\s+(.*?)(?:\s+\(task ([0-9a-f]{8}), (\d{4}-\d{2}-\d{2})\))?$/

export function parseMemoryEntries(content: string): MemoryEntry[] {
  return content
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => {
      const match = ENTRY_LINE.exec(line)
      return match
        ? { text: match[1] ?? '', ...(match[2] ? { task: match[2] } : {}), ...(match[3] ? { date: match[3] } : {}) }
        : { text: line.slice(2) }
    })
    .filter((entry) => entry.text !== '')
}

/**
 * Settings → Manager memory (plan v2 §8): the lessons managers leave for later tasks in this
 * project, edited as one file. The ceiling is the server's and is counted in UTF-8 BYTES, so the
 * counter here uses the same measure — a Vietnamese lesson costs more bytes than characters.
 *
 * "New since your last visit" is client-only state (one localStorage marker per project); the
 * server stores nothing about reading.
 */
export function ManagerMemorySection() {
  const { t } = useI18n()
  const memory = useManagerMemory()
  if (memory.isPending) return <p data-slot="memory-loading" className="p-4 text-[13px] text-soft-foreground md:p-6">{t('Loading…')}</p>
  if (memory.isError) {
    return <CenteredState icon={<BrainIcon />} tone="danger" title={t('Manager memory did not load')} subtitle={memory.error.message} heading="h2" />
  }
  return <ManagerMemoryForm memory={memory.data} />
}

function ManagerMemoryForm({ memory }: { memory: ManagerMemoryRead }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState(memory.content)
  const [clearing, setClearing] = useState(false)
  const savedRevision = useRef(memory.revision)
  const bytes = new TextEncoder().encode(draft).length
  const overLimit = bytes > memory.maxBytes

  // The marker is written on open, so this visit's badges are the entries added since the last one.
  const seenKey = `onni:manager-memory-seen:${queryScope()}`
  const [seenOn] = useState(() => {
    try {
      return localStorage.getItem(seenKey)
    } catch {
      return null
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(seenKey, new Date().toISOString().slice(0, 10))
    } catch {
      // a browser with storage disabled loses only the badge
    }
  }, [seenKey])
  const entries = parseMemoryEntries(memory.content)

  const save = useMutation({
    mutationFn: (content: string) => putManagerMemory({ content, revision: memory.revision }),
    onSuccess: (result) => {
      savedRevision.current = result.revision
      queryClient.setQueryData(queryKeys.managerMemory(), result)
      setDraft(result.content)
      toast(t('Project memory saved'))
    },
    onError: (error: Error) => {
      if (error instanceof ApiError && error.status === 409) {
        // Another window saved first: reload rather than overwrite what the user cannot see.
        void queryClient.invalidateQueries({ queryKey: queryKeys.managerMemory() })
        toast(t('Memory changed in another window — reloaded the latest version'), { tone: 'danger' })
        return
      }
      toast(error.message, { tone: 'danger' })
    },
  })

  // A refetch (the 409 path, or another tab) replaces the server copy; adopt it when the user is
  // not mid-save. `savedRevision` keeps an unrelated re-render from discarding a local draft.
  useEffect(() => {
    if (memory.revision !== savedRevision.current && !save.isPending) {
      savedRevision.current = memory.revision
      setDraft(memory.content)
    }
  }, [memory.revision, memory.content, save.isPending])

  const dirty = draft !== memory.content

  return (
    <div data-slot="manager-memory-section" className="mx-auto flex w-full max-w-2xl flex-col gap-7 p-4 pb-[calc(90px+env(safe-area-inset-bottom))] md:p-6 md:pb-6">
      <SettingsField
        title={t('Lessons for later tasks')}
        hint={t('Managers write here with "onni task memory add". Every manager–worker task in this project reads this list into its brief when it opens — keep it short and specific.')}
      >
        <textarea
          data-slot="memory-editor"
          aria-label={t('Project memory')}
          className={`${fieldClass} min-h-40 font-mono text-[12px]`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t('- Run the database migrations before the unit suite.\n- The payments module must not import the UI package.')}
        />
        <div className="flex items-center justify-between text-[12px]">
          <span data-slot="memory-bytes" className={overLimit ? 'text-danger' : 'text-soft-foreground'}>
            {t('{bytes} / {max} bytes', { bytes, max: memory.maxBytes })}
          </span>
          {overLimit ? <span className="text-danger">{t('Over the limit — remove a lesson before saving.')}</span> : null}
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" data-slot="memory-save" disabled={!dirty || overLimit || save.isPending} onClick={() => save.mutate(draft)}>
            {t('Save memory')}
          </Button>
          <Button type="button" size="sm" variant="danger-ghost" data-slot="memory-clear" disabled={memory.content === '' || save.isPending} onClick={() => setClearing(true)}>
            {t('Clear memory')}
          </Button>
        </div>
      </SettingsField>

      <SettingsField title={t('Stored lessons')} hint={t('Each line names the task that wrote it. Lessons are not orders: a manager is told they never override the user’s request.')}>
        {entries.length === 0 ? (
          <p data-slot="memory-empty" className="text-[13px] text-soft-foreground">{t('No lessons yet.')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {entries.map((entry, index) => (
              <li key={`${index}:${entry.text}`} data-slot="memory-entry" className="rounded-md border border-border p-2.5">
                <div className="text-[13px]">{entry.text}</div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-soft-foreground">
                  {entry.task ? <span>{t('task {id}', { id: entry.task })}</span> : null}
                  {entry.date ? <span>{entry.date}</span> : null}
                  {entry.date && seenOn !== null && entry.date > seenOn ? <span className="rounded bg-accent px-1.5 py-0.5 text-accent-foreground">{t('new')}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsField>

      <ConfirmDialog
        open={clearing}
        onOpenChange={setClearing}
        danger
        title={t('Clear project memory?')}
        description={t('Every stored lesson is removed. Managers that are already running keep the copy they opened with.')}
        confirmLabel={t('Clear')}
        onConfirm={() => {
          setClearing(false)
          save.mutate('')
        }}
      />
    </div>
  )
}
