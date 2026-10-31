import { UsersIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import type { ManagerPreset, Roster } from '@onni/api-client'
import { putWorkspaceConfig } from '@/api/client'
import { useProviderStatus, useWorkspaceConfig, workspaceQueryKeys } from '@/api/queries'
import { fieldClass } from '@/components/form-field'
import { chevron, chipClass } from '@/components/picker-pill'
import { RosterEditor } from '@/components/roster-editor'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/toaster'
import { Link } from '@/lib/project-router'
import { useI18n } from '@/lib/i18n'
import { useIsDesktop } from '@/lib/use-desktop'
import { cn } from '@/lib/utils'
import {
  connectedBackends,
  describeRoster,
  disconnectedBackends,
  draftFromRoster,
  newPresetId,
  rosterFromDraft,
  starterDraft,
  totalConcurrency,
  type RosterDraft,
} from '@/lib/roster'

/**
 * The composer's "Manager / Workers" pill (docs/design/manager-worker.md): off by default, or on
 * with the workspace's default preset. Presets are shared by every project and can be overridden
 * for this one task without touching them. `onRoster` reports the roster to start with (or null).
 *
 * It follows the DispatchToggle grammar rather than inventing its own, because the two sit in the
 * same footer row: a chip on the row's own 26px pill scale, its settings in a Radix Popover on
 * md-and-up and a bottom Sheet below it, and the on/off as the switch in the settings header. The
 * chip's label is the manager backend — short enough to keep the row steady — and never the whole
 * roster, which the previous free-text summary grew and shrank with every edit.
 */
export function ManagerWorkerPill({ onRoster }: { onRoster: (roster: Roster | null) => void }) {
  const { t, tn } = useI18n()
  const config = useWorkspaceConfig()
  const providers = useProviderStatus()
  const queryClient = useQueryClient()
  const desktop = useIsDesktop()
  const connected = connectedBackends(providers.data)
  const presets = config.data?.managerWorker.presets ?? []
  const [on, setOn] = useState(false)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<RosterDraft | null>(null)
  const [presetId, setPresetId] = useState('')
  const [name, setName] = useState('')
  const seeded = useRef(false)

  // The workspace default turns the block on once, when the settings first arrive.
  useEffect(() => {
    if (seeded.current || !config.data) return
    seeded.current = true
    const preset = config.data.managerWorker.presets.find((p) => p.id === config.data.managerWorker.defaultPresetId)
    if (preset) {
      setOn(true)
      setPresetId(preset.id)
      setDraft(draftFromRoster(preset.roster))
    }
  }, [config.data])

  // Memoised on the draft's content: `rosterFromDraft` builds a fresh object every call, and
  // reporting that to the composer each render would loop.
  const draftKey = on && draft ? JSON.stringify(draft) : ''
  const parsed = useMemo(() => (draftKey && draft ? rosterFromDraft(draft) : null), [draftKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const roster = parsed?.ok ? parsed.roster : null
  useEffect(() => onRoster(roster), [roster, onRoster])

  const save = useMutation({
    mutationFn: (next: ManagerPreset[]) =>
      putWorkspaceConfig({ managerWorker: { presets: next, defaultPresetId: config.data?.managerWorker.defaultPresetId ?? null } }),
    onSuccess: (result) => queryClient.setQueryData(workspaceQueryKeys.config, result),
    onError: (error: Error) => toast(error.message, { tone: 'danger' }),
  })
  const savePreset = () => {
    if (!roster || !name.trim()) return
    const preset: ManagerPreset = { id: newPresetId(presets), name: name.trim(), roster }
    save.mutate([...presets, preset], {
      onSuccess: () => { setPresetId(preset.id); setName(''); toast(t('Preset "{name}" saved', { name: preset.name })) },
    })
  }
  const choose = (id: string) => {
    setPresetId(id)
    const preset = presets.find((p) => p.id === id)
    if (preset) setDraft(draftFromRoster(preset.roster))
  }
  const toggle = (next: boolean) => {
    setOn(next)
    if (next && !draft) setDraft(starterDraft(connected))
  }
  const maxParallel = config.data?.resources.maxParallel
  const gone = roster ? disconnectedBackends(roster, connected) : []

  const settings = (
    <div className="flex flex-col gap-3">
      <header className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
        >
          <UsersIcon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold leading-tight text-foreground">{t('Manager–worker')}</div>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
            {roster ? describeRoster(roster) : t('One agent plans and hands parts to the workers you list')}
          </p>
        </div>
        <Switch
          aria-label={t('Run as manager–worker')}
          data-slot="manager-worker-on"
          checked={on}
          onCheckedChange={toggle}
        />
      </header>

      {on && draft ? (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          {presets.length > 0 ? (
            <select aria-label={t('Preset')} value={presetId} onChange={(event) => choose(event.target.value)} className={fieldClass}>
              <option value="">{t('Custom for this task')}</option>
              {presets.map((p) => <option key={p.id} value={p.id}>{p.name} — {describeRoster(p.roster)}</option>)}
            </select>
          ) : null}
          <div className="max-h-[min(26rem,60vh)] overflow-y-auto overscroll-contain pr-0.5">
            <RosterEditor draft={draft} onChange={(next) => { setDraft(next); setPresetId('') }} connected={connected} />
          </div>
          {parsed && !parsed.ok ? <p data-slot="roster-error" className="text-[12px] text-danger">{parsed.error}</p> : null}
          {gone.length > 0 ? <p className="text-[12px] text-danger">{t('Not connected: {backends} — the task would be refused.', { backends: gone.join(', ') })}</p> : null}
          {roster && maxParallel !== undefined && totalConcurrency(roster) > maxParallel ? (
            <p data-slot="roster-capacity-note" className="text-[12px] text-warning">
              {t('Workers may run {workers} at once but the workspace runs {max} tasks in parallel.', { workers: totalConcurrency(roster), max: maxParallel })}{' '}
              <Link to="/settings/global/resources" className="underline">{t('Change it in Settings → Resources')}</Link>.
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <input aria-label={t('Preset name')} placeholder={t('Save as preset…')} value={name} onChange={(event) => setName(event.target.value)} maxLength={80} className={fieldClass} />
            <Button type="button" size="sm" variant="outline" data-slot="save-preset" disabled={!roster || !name.trim() || save.isPending} onClick={savePreset}>{t('Save')}</Button>
          </div>
        </div>
      ) : null}
    </div>
  )

  // On the Popover branch Radix owns the click (a child `onClick` would replace the trigger's
  // own toggle, and the chip would stop closing); on the Sheet branch the bare chip opens it and
  // the sheet itself closes.
  const chip = (onOpen?: () => void) => (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={t('Manager–worker roster')}
      data-slot="manager-worker-pill"
      data-state={on ? 'on' : 'off'}
      title={roster ? tn(roster.workers.length, 'Manager {runner} with {count} worker', 'Manager {runner} with {count} workers', { runner: roster.manager.runner }) : t('Choose the manager and the workers it may use')}
      onClick={onOpen}
      className={cn(chipClass, on && 'border-primary/60 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary')}
    >
      <UsersIcon aria-hidden="true" className={cn('size-3 shrink-0', on ? 'text-primary' : 'text-soft-foreground')} />
      {on && roster ? t('Manager · {runner}', { runner: roster.manager.runner }) : t('Manager')}
      {chevron}
    </button>
  )

  if (!desktop) {
    return (
      <>
        {chip(() => setOpen(true))}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            data-slot="manager-worker-settings"
            // No SheetHeader, so the sheet's own close button would land on the settings switch —
            // reserve the strip it occupies, the way the dispatch settings sheet does.
            className="rounded-t-xl p-4 pt-16 pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            {/* Radix wants a title on every dialog; the form's own header is the visible one. */}
            <SheetTitle className="sr-only">{t('Manager–worker')}</SheetTitle>
            <SheetDescription className="sr-only">
              {t('One agent plans the task and hands parts to the workers listed here')}
            </SheetDescription>
            {settings}
          </SheetContent>
        </Sheet>
      </>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* Radix's trigger owns the click: an `onClick` on the chip would replace its toggle, and the
          popover would never close on the second click. */}
      <PopoverTrigger asChild>{chip()}</PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        data-slot="manager-worker-settings"
        className="w-[22rem] max-w-[calc(100vw-2rem)] p-3.5"
      >
        {settings}
      </PopoverContent>
    </Popover>
  )
}
