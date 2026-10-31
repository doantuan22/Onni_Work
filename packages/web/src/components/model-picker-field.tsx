import { useState } from 'react'

import { runnerDiscoversModels, type Runner } from '@onni/api-client'
import { useRunnerModels } from '@/api/queries'
import { fieldClass } from '@/components/form-field'
import { PickerPill } from '@/components/picker-pill'
import { useI18n } from '@/lib/i18n'
import { modelCatalogStatus, modelsForRunner } from '@/routes/new-task-form'

/**
 * The roster's model field (docs/design/manager-worker.md): the models the chosen backend actually
 * reports on THIS machine — `GET /api/v1/models` behind `useRunnerModels` — instead of a free-text
 * box where a typo only surfaces when the run fails. The list is searched as you type; the value
 * committed is always an id the CLI listed.
 *
 * Free text survives only where no list can be complete: a backend with no host discovery
 * (copilot's catalog is per GitHub account) or an unavailable CLI. Then the typed value is offered
 * as an explicit "Use …" row, so the escape hatch is visible rather than the only path.
 *
 * The catalog is fetched on first open, not on render: a roster can list several backends, and
 * discovering models spawns each CLI once (`RunnerModelCatalog` caches it host-side afterwards).
 */
export function ModelPickerField({
  runner,
  value,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  runner: Runner | ''
  value: string
  onChange: (model: string) => void
  ariaLabel: string
  disabled?: boolean
}) {
  const [requested, setRequested] = useState(false)
  const { t } = useI18n()
  const catalog = useRunnerModels(runner || 'claude', requested && runner !== '')
  const models = modelsForRunner(runner || 'claude', runner ? catalog.data : undefined, [value])
  const discovered = runner && runnerDiscoversModels(runner) ? (catalog.data?.models.length ?? 0) : 0
  const selected = models.find((model) => model.id === value)
  let status: string | undefined
  if (!runner) status = undefined
  else if (!runnerDiscoversModels(runner)) status = t('Type a model your {runner} account offers', { runner })
  else if (catalog.isPending) status = t('Loading {runner} models…', { runner })
  else status = modelCatalogStatus(runner, catalog.data, catalog.isError) ?? (discovered === 0 ? t('No {runner} models listed on this machine — type one', { runner }) : undefined)

  return (
    <PickerPill
      slot="roster-model"
      ariaLabel={ariaLabel}
      label={runner ? (selected?.label || value || t('auto')) : t('Choose a backend first')}
      value={value}
      onPick={onChange}
      options={models.map((model) => ({ value: model.id, label: model.label, desc: model.desc }))}
      disabled={disabled || runner === ''}
      disabledHint={runner === '' ? t('Choose a backend first') : undefined}
      onOpenChange={(open) => {
        if (open) setRequested(true)
      }}
      searchPlaceholder={
        runner ? (runnerDiscoversModels(runner) ? t('Search {runner} models…', { runner }) : t('Type a {runner} model…', { runner })) : undefined
      }
      triggerClassName={`${fieldClass} text-left`}
      allowCustom={runner !== '' && discovered === 0}
      customHint={t('Not in the {runner} list on this machine — sent exactly as typed', { runner })}
      emptyLabel={t('No {runner} models match.', { runner })}
      status={status}
    />
  )
}
