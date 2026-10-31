import type { ChangeEvent } from 'react'

import type { LimitsDraft } from '@/lib/run-limits'

/** Shown before "Unlimited" is accepted — anywhere it can be chosen. */
export const UNLIMITED_WARNING =
  'Unlimited removes every cost, token, time and step ceiling for this run. An unattended run can keep spending until you stop it. Hang guards and dispatch limits stay on. Continue?'

const inputClass =
  'block w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50'

/**
 * The mode selector plus the four ceilings, shared by Settings (workspace default) and the
 * composer (one run). A blank number is "no limit on that axis" — the form never invents one.
 * Choosing Unlimited asks once, through `confirm`, so a stray click cannot remove the brakes.
 */
export function RunLimitsFields({
  draft,
  onChange,
  allowDefault,
  disabled,
  confirm = (message: string) => window.confirm(message),
}: {
  draft: LimitsDraft
  onChange: (next: LimitsDraft) => void
  /** The composer offers "Default"; Settings edits the default itself. */
  allowDefault: boolean
  disabled?: boolean
  confirm?: (message: string) => boolean
}) {
  const setMode = (event: ChangeEvent<HTMLSelectElement>) => {
    const mode = event.target.value as LimitsDraft['mode']
    if (mode === 'none' && draft.mode !== 'none' && !confirm(UNLIMITED_WARNING)) return
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
        placeholder="no limit"
        disabled={disabled}
        onChange={(event) => onChange({ ...draft, [key]: event.target.value })}
        className={inputClass}
      />
      <span className="text-[11px] text-soft-foreground">{hint}</span>
    </label>
  )
  return (
    <div data-slot="run-limits-fields" className="flex flex-col gap-3">
      <select
        aria-label="Run limits"
        data-slot="limits-mode"
        value={draft.mode}
        disabled={disabled}
        onChange={setMode}
        className={inputClass}
      >
        {allowDefault ? <option value="default">Default (workspace setting)</option> : null}
        <option value="capped">{allowDefault ? 'Custom ceilings' : 'Capped — apply the ceilings below'}</option>
        <option value="none">Unlimited ∞</option>
      </select>
      {draft.mode === 'capped' ? (
        <div className="grid grid-cols-2 gap-3">
          {field('cost', 'Max cost (USD)', 'Backends that report no USD ignore this.')}
          {field('tokens', 'Max tokens', 'Cost-weighted; cache reads count at 10%.')}
          {field('time', 'Max time (minutes)', 'Active running time, kept across restarts.')}
          {field('iterations', 'Max steps', 'Agent steps and continuations.')}
        </div>
      ) : null}
      {draft.mode === 'none' ? (
        <p data-slot="limits-unlimited-note" className="text-[12px] text-warning-foreground">
          ∞ No cost, token, time or step ceiling. Hang guards and dispatch limits still apply.
        </p>
      ) : null}
    </div>
  )
}
