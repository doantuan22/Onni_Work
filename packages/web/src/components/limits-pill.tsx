import { GaugeIcon } from 'lucide-react'
import { useState } from 'react'

import { RunLimitsFields } from '@/components/run-limits-fields'
import { chevron, chipClass } from '@/components/picker-pill'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { useIsDesktop } from '@/lib/use-desktop'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { LimitsDraft } from '@/lib/run-limits'

/**
 * The composer's per-run ceilings pill: the same `RunLimitsFields` Settings shows, folded into a
 * chip on the footer row's own pill scale. It sits in `new-task.tsx` beside the dispatch and
 * manager–worker pills, so it follows their grammar — a Radix Popover on md-and-up, a bottom Sheet
 * below it, Escape and a click outside closing either one.
 */
export function LimitsPill({
  draft,
  onChange,
  request,
}: {
  draft: LimitsDraft
  onChange: (next: LimitsDraft) => void
  /** The draft's current validity — the composer refuses to start while a field is unparsable. */
  request: { ok: boolean; error?: string }
}) {
  const [open, setOpen] = useState(false)
  const desktop = useIsDesktop()
  const { t } = useI18n()
  const label = draft.mode === 'default' ? t('default') : draft.mode === 'none' ? t('∞ unlimited') : t('custom')
  const settings = (
    <>
      <RunLimitsFields draft={draft} onChange={onChange} allowDefault />
      {!request.ok ? <p data-slot="limits-error" className="mt-2 text-[12px] text-danger">{request.error}</p> : null}
    </>
  )

  // On the Popover branch Radix owns the click (a child `onClick` would replace the trigger's own
  // toggle, and the chip would stop closing); on the Sheet branch the bare chip opens it and the
  // sheet itself closes.
  const chip = (onOpen?: () => void) => (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={t('Run limits')}
      data-slot="limits-pill"
      data-state={draft.mode === 'default' ? 'off' : 'on'}
      title={t('Ceilings for this run: cost, tokens, time and steps')}
      onClick={onOpen}
      className={cn(chipClass, draft.mode !== 'default' && 'border-primary/60 text-foreground')}
    >
      <GaugeIcon aria-hidden="true" className={cn('size-3 shrink-0', draft.mode === 'default' ? 'text-soft-foreground' : 'text-primary')} />
      {t('Limits: {label}', { label })}
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
            data-slot="limits-settings"
            // No SheetHeader, so the close button needs the strip it occupies reserved for it.
            className="rounded-t-xl p-4 pt-16 pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            <SheetTitle className="sr-only">{t('Run limits')}</SheetTitle>
            <SheetDescription className="sr-only">
              {t('Ceilings on cost, tokens, running time and steps for this run')}
            </SheetDescription>
            {settings}
          </SheetContent>
        </Sheet>
      </>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* Radix's trigger owns the click: an `onClick` on the chip would run in addition to its
          toggle, so the click that closes would immediately re-open. */}
      <PopoverTrigger asChild>{chip()}</PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} data-slot="limits-settings" className="w-[20rem] max-w-[calc(100vw-2rem)] p-3.5">
        {settings}
      </PopoverContent>
    </Popover>
  )
}
