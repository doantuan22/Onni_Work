import { UsersIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { Roster } from '@onni/api-client'
import { chevron, chipClass } from '@/components/picker-pill'
import { RosterEditor } from '@/components/roster-editor'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Link } from '@/lib/project-router'
import { useI18n } from '@/lib/i18n'
import { useIsDesktop } from '@/lib/use-desktop'
import { cn } from '@/lib/utils'
import { useProviderStatus, useWorkspaceConfig } from '@/api/queries'
import {
  connectedBackends,
  describeRoster,
  disconnectedBackends,
  draftFromRoster,
  rosterFromDraft,
  starterDraft,
  totalConcurrency,
  type RosterDraft,
} from '@/lib/roster'

/**
 * The panel's Manager–Worker control (docs/design/manager-worker.md). It is CONTROLLED: the
 * route owns the roster (so a task preset can set it and the draft can restore it), and this
 * component only edits a draft of it.
 *
 * Presets are not saved here any more (ADR 0008): a saved roster is a TASK preset whose
 * `settings.roster` is set. Settings → Manager–Worker still edits the shared roster list, and
 * the task panel shows those presets read-only.
 */
export function ManagerWorkerPill({
  roster,
  onRoster,
  inline,
  onEnabledChange,
}: {
  roster: Roster | null
  onRoster: (roster: Roster | null) => void
  /** Render the manager and worker settings in place (the wide panel) instead of behind a chip. */
  inline?: boolean
  /** The switch, as the user sees it: a draft can be on before it forms a valid roster. */
  onEnabledChange?: (on: boolean) => void
}) {
  const { t, tn } = useI18n()
  const config = useWorkspaceConfig()
  const providers = useProviderStatus()
  const desktop = useIsDesktop()
  const connected = connectedBackends(providers.data)
  const [draft, setDraft] = useState<RosterDraft | null>(() =>
    roster ? draftFromRoster(roster) : null,
  )
  const [open, setOpen] = useState(false)
  // The last roster this component reported, so an external change (preset, draft restore) is
  // distinguishable from its own echo.
  const reported = useRef<string>(roster ? JSON.stringify(roster) : '')

  // Memoised on the draft's content: `rosterFromDraft` builds a fresh object every call, and
  // reporting that to the composer each render would loop.
  const draftKey = draft ? JSON.stringify(draft) : ''
  const parsed = useMemo(() => (draftKey && draft ? rosterFromDraft(draft) : null), [draftKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const rosterNow = parsed?.ok ? parsed.roster : null

  // An external roster wins over the local draft — a preset applied while this is mounted.
  useEffect(() => {
    const next = roster ? JSON.stringify(roster) : ''
    if (next === reported.current) return
    reported.current = next
    setDraft(roster ? draftFromRoster(roster) : null)
    onEnabledChange?.(roster !== null)
  }, [roster]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!rosterNow) {
      if (reported.current !== '') {
        reported.current = ''
        onRoster(null)
      }
      return
    }
    const key = JSON.stringify(rosterNow)
    if (key === reported.current) return
    reported.current = key
    onRoster(rosterNow)
  }, [rosterNow, onRoster])

  const maxParallel = config.data?.resources.maxParallel
  const on = draft !== null
  const gone = rosterNow ? disconnectedBackends(rosterNow, connected) : []
  const toggle = (next: boolean) => {
    onEnabledChange?.(next)
    if (!next) {
      setDraft(null)
      reported.current = ''
      onRoster(null)
      return
    }
    if (!draft) setDraft(starterDraft(connected))
  }

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
            {rosterNow ? describeRoster(rosterNow) : t('One agent plans and hands parts to the workers you list')}
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
          <div className={cn(!inline && 'max-h-[min(26rem,60vh)] overflow-y-auto overscroll-contain pr-0.5')}>
            <RosterEditor draft={draft} onChange={setDraft} connected={connected} />
          </div>
          {parsed && !parsed.ok ? <p data-slot="roster-error" className="text-[12px] text-danger">{parsed.error}</p> : null}
          {gone.length > 0 ? <p className="text-[12px] text-danger">{t('Not connected: {backends} — the task would be refused.', { backends: gone.join(', ') })}</p> : null}
          {rosterNow && maxParallel !== undefined && totalConcurrency(rosterNow) > maxParallel ? (
            <p data-slot="roster-capacity-note" className="text-[12px] text-warning">
              {t('Workers may run {workers} at once but the workspace runs {max} tasks in parallel.', { workers: totalConcurrency(rosterNow), max: maxParallel })}{' '}
              <Link to="/settings/global/resources" className="underline">{t('Change it in Settings → Resources')}</Link>.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )

  if (inline) return <div data-slot="manager-worker-settings">{settings}</div>

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
      title={rosterNow ? tn(rosterNow.workers.length, 'Manager {runner} with {count} worker', 'Manager {runner} with {count} workers', { runner: rosterNow.manager.runner }) : t('Choose the manager and the workers it may use')}
      onClick={onOpen}
      className={cn(chipClass, on && 'border-primary/60 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary')}
    >
      <UsersIcon aria-hidden="true" className={cn('size-3 shrink-0', on ? 'text-primary' : 'text-soft-foreground')} />
      {on && rosterNow ? t('Manager · {runner}', { runner: rosterNow.manager.runner }) : t('Manager')}
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
