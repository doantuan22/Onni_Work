import { useState, type ChangeEvent } from 'react'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { fieldClass } from '@/components/form-field'
import { useI18n } from '@/lib/i18n'
import type { LimitsDraft } from '@/lib/run-limits'
import { AppSelect, type AppSelectChangeEvent } from '@/components/ui/app-select'

/** Shown before "Unlimited" is accepted — anywhere it can be chosen. */
export const UNLIMITED_WARNING =
  'Unlimited removes every cost, token, time and step ceiling for this run. An unattended run can keep spending until you stop it. Hang guards and dispatch limits stay on.'

/**
 * The mode selector plus the four ceilings, shared by Settings (workspace default) and the
 * composer (one run). A blank number is "no limit on that axis" — the form never invents one.
 * Choosing Unlimited asks once, so a stray click cannot remove the brakes.
 */
export function RunLimitsFields({
  draft,
  onChange,
  allowDefault,
  disabled,
}: {
  draft: LimitsDraft
  onChange: (next: LimitsDraft) => void
  /** The composer offers "Default"; Settings edits the default itself. */
  allowDefault: boolean
  disabled?: boolean
}) {
  const [confirmingUnlimited, setConfirmingUnlimited] = useState(false)
  const { t } = useI18n()
  const setMode = (event: AppSelectChangeEvent) => {
    const mode = event.target.value as LimitsDraft['mode']
    if (mode === 'none' && draft.mode !== 'none') {
      setConfirmingUnlimited(true)
      return
    }
    onChange({ ...draft, mode })
  }
  const field = (key: 'cost' | 'tokens' | 'time' | 'iterations', label: string, hint: string) => (
    <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
      <span className="font-medium text-foreground">{label}</span>
      <input
        type="number"
        min={0}
        inputMode="decimal"
        aria-label={label}
        data-slot={`limit-${key}`}
        value={draft[key]}
        placeholder={t('no limit')}
        disabled={disabled}
        onChange={(event) => onChange({ ...draft, [key]: event.target.value })}
        className={fieldClass}
      />
      <span className="text-[11px] text-soft-foreground">{hint}</span>
    </label>
  )
  return (
    <div data-slot="run-limits-fields" className="flex flex-col gap-3">
      <AppSelect
        aria-label={t('Run limits')}
        data-slot="limits-mode"
        value={draft.mode}
        disabled={disabled}
        onChange={setMode}
        className={fieldClass}
      >
        {allowDefault ? <option value="default">{t('Default (workspace setting)')}</option> : null}
        <option value="capped">{allowDefault ? t('Custom ceilings') : t('Capped — apply the ceilings below')}</option>
        <option value="none">{t('Unlimited ∞')}</option>
      </AppSelect>
      {draft.mode === 'capped' ? (
        <div className="grid grid-cols-2 gap-3">
          {field('cost', t('Max cost (USD)'), t('Backends that report no USD ignore this.'))}
          {field('tokens', t('Max tokens'), t('Cost-weighted; cache reads count at 10%.'))}
          {field('time', t('Max time (minutes)'), t('Active running time, kept across restarts.'))}
          {field('iterations', t('Max steps'), t('Agent steps and continuations.'))}
        </div>
      ) : null}
      {draft.mode === 'none' ? (
        <p data-slot="limits-unlimited-note" className="text-[12px] text-warning">
          {t('∞ No cost, token, time or step ceiling. Hang guards and dispatch limits still apply.')}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirmingUnlimited}
        onOpenChange={setConfirmingUnlimited}
        title={t('Remove all ceilings?')}
        description={t(UNLIMITED_WARNING)}
        confirmLabel={t('Choose Unlimited')}
        danger
        onConfirm={() => onChange({ ...draft, mode: 'none' })}
      />
    </div>
  )
}
