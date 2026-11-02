import { PlusIcon, Trash2Icon } from 'lucide-react'

import { ROSTER_MAX_CONCURRENT, ROSTER_MAX_WORKERS, RUNNER_CAPABILITIES, type Runner } from '@onni/api-client'
import { fieldClass } from '@/components/form-field'
import { ModelPickerField } from '@/components/model-picker-field'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'
import { emptyWorker, managerCapable, type RosterDraft, type WorkerDraft } from '@/lib/roster'
import { NativeSelect } from '@/components/ui/native-select'

function BackendSelect({
  value,
  connected,
  onChange,
  label,
  disabled,
}: {
  value: Runner | ''
  connected: readonly Runner[]
  onChange: (runner: Runner | '') => void
  label: string
  disabled?: boolean
}) {
  // A backend already chosen but no longer connected stays visible (and flagged) instead of vanishing.
  const options = value && !connected.includes(value) ? [...connected, value] : connected
  const { t } = useI18n()
  return (
    <NativeSelect aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as Runner | '')} className={fieldClass}>
      <option value="">{t('Choose a backend…')}</option>
      {options.map((runner) => (
        <option key={runner} value={runner}>
          {runner}
          {connected.includes(runner) ? '' : ` ${t('(not connected)')}`}
        </option>
      ))}
    </NativeSelect>
  )
}

/**
 * The manager and the workers it may use. Backends are limited to the ones connected right now;
 * a worker is a backend, an optional model from that backend's own list (several entries may share
 * a backend), a free-text role the manager reads, and how many of its tasks may run at once.
 * Agents left out are never
 * used — the server refuses a dispatch to them.
 */
export function RosterEditor({
  draft,
  onChange,
  connected,
  disabled,
}: {
  draft: RosterDraft
  onChange: (next: RosterDraft) => void
  connected: readonly Runner[]
  disabled?: boolean
}) {
  const workerOnly = connected.filter((runner) => !managerCapable(connected).includes(runner))
  const { t } = useI18n()
  const setWorker = (index: number, patch: Partial<WorkerDraft>) =>
    onChange({ ...draft, workers: draft.workers.map((w, i) => (i === index ? { ...w, ...patch } : w)) })
  return (
    <div data-slot="roster-editor" className="@container flex flex-col gap-4">
      {connected.length === 0 ? (
        <p data-slot="roster-no-backends" className="text-xs text-danger">
          {t('No agent is connected on this machine — connect one in Settings → Agents first.')}
        </p>
      ) : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-[13px] font-semibold">{t('Manager')}</legend>
        <div className="grid grid-cols-2 gap-2">
          <BackendSelect label={t('Manager backend')} value={draft.managerRunner} connected={managerCapable(connected)} disabled={disabled} onChange={(managerRunner) => onChange({ ...draft, managerRunner })} />
          <ModelPickerField runner={draft.managerRunner} value={draft.managerModel} onChange={(managerModel) => onChange({ ...draft, managerModel })} ariaLabel={t('Manager model')} disabled={disabled} />
        </div>
        {workerOnly.map((runner) => (
          <p key={runner} data-slot="roster-worker-only" data-backend={runner} className="text-xs text-soft-foreground">
            {t('{runner} is offered as a worker only: {reason}.', { runner, reason: RUNNER_CAPABILITIES[runner].manageReason ?? '' })}
          </p>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-[13px] font-semibold">{t('Workers')}</legend>
        {draft.workers.map((worker, index) => (
          <div key={index} data-slot="roster-worker" className="flex flex-col gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0">
            {/* One row in Settings (the pane is ~479px here), two in the composer's 352px popover:
                the query is on the CONTAINER, because a 400px-wide phone viewport can still host a
                wide settings pane. @md is 448px — the four columns need ~110px each to stay legible. */}
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 @md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5rem_auto] @md:items-center">
              <BackendSelect label={t('Worker {n} backend', { n: index + 1 })} value={worker.runner} connected={connected} disabled={disabled} onChange={(runner) => setWorker(index, { runner })} />
              <ModelPickerField runner={worker.runner} value={worker.model} onChange={(model) => setWorker(index, { model })} ariaLabel={t('Worker {n} model', { n: index + 1 })} disabled={disabled} />
              <input
                type="number"
                min={1}
                max={ROSTER_MAX_CONCURRENT}
                aria-label={t('Worker {n} at once', { n: index + 1 })}
                title={t('How many tasks of this worker run at once')}
                value={worker.maxConcurrent}
                disabled={disabled}
                onChange={(e) => setWorker(index, { maxConcurrent: Number(e.target.value) || 1 })}
                className={fieldClass}
              />
              <Button type="button" variant="ghost" size="icon" aria-label={t('Remove worker {n}', { n: index + 1 })} disabled={disabled || draft.workers.length <= 1} onClick={() => onChange({ ...draft, workers: draft.workers.filter((_, i) => i !== index) })}>
                <Trash2Icon className="size-[14px]" aria-hidden="true" />
              </Button>
            </div>
            <input aria-label={t('Worker {n} role', { n: index + 1 })} placeholder={t('Role / strengths — e.g. backend tests, docs, mechanical renames')} maxLength={500} value={worker.role} disabled={disabled} onChange={(e) => setWorker(index, { role: e.target.value })} className={fieldClass} />
          </div>
        ))}
        <div>
          <Button type="button" variant="outline" size="sm" data-slot="roster-add-worker" disabled={disabled || draft.workers.length >= ROSTER_MAX_WORKERS} onClick={() => onChange({ ...draft, workers: [...draft.workers, emptyWorker(connected[0] ?? '')] })}>
            <PlusIcon className="size-[14px]" aria-hidden="true" />
            {t('Add worker')}
          </Button>
        </div>
      </fieldset>
      <p data-slot="roster-fence-note" className="text-xs text-soft-foreground">
        {t('The manager can hand work only to the workers listed here; the server refuses any other backend. This steers orchestration — it is not a security boundary (an agent can still run a CLI or call the API directly).')}
      </p>
    </div>
  )
}
