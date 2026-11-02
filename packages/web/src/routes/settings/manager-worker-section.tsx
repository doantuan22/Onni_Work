import { useMutation, useQueryClient } from '@tanstack/react-query'
import { UsersIcon } from 'lucide-react'
import { useState } from 'react'

import { putWorkspaceConfig } from '@/api/client'
import { useProviderStatus, useWorkspaceConfig, workspaceQueryKeys } from '@/api/queries'
import { MANAGER_PRESETS_MAX, type ManagerPreset, type WorkspaceConfigResponse } from '@onni/api-client'
import { CenteredState } from '@/components/centered-state'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { fieldClass } from '@/components/form-field'
import { RosterEditor } from '@/components/roster-editor'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/toaster'
import { useI18n } from '@/lib/i18n'
import { Link } from '@/lib/project-router'
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
import { SettingsField } from './settings-field'
import { AppSelect } from '@/components/ui/app-select'

/**
 * Settings → Manager–Worker (docs/design/manager-worker.md): the presets a task can start from
 * ("Claude manages, Codex and OpenCode work") and which one the composer opens with. Presets
 * belong to the workspace, so every project sees them; a single task can still override one.
 * Limits and parallelism are set elsewhere and linked, because they bound the whole tree.
 */
export function ManagerWorkerSection() {
  const { t } = useI18n()
  const config = useWorkspaceConfig()
  if (config.isPending) return <p data-slot="mw-loading" className="p-4 text-[13px] text-soft-foreground md:p-6">{t('Loading…')}</p>
  if (config.isError) {
    return <CenteredState icon={<UsersIcon />} tone="danger" title={t('Manager–worker settings did not load')} subtitle={config.error.message} heading="h2" />
  }
  return <ManagerWorkerForm config={config.data} />
}

function ManagerWorkerForm({ config }: { config: WorkspaceConfigResponse }) {
  const { t, tn } = useI18n()
  const queryClient = useQueryClient()
  const providers = useProviderStatus()
  const connected = connectedBackends(providers.data)
  const { presets, defaultPresetId } = config.managerWorker
  const [editing, setEditing] = useState<{ id: string | null; name: string; draft: RosterDraft } | null>(null)
  const [removing, setRemoving] = useState<ManagerPreset | null>(null)
  const save = useMutation({
    mutationFn: (next: { presets: ManagerPreset[]; defaultPresetId: string | null }) => putWorkspaceConfig({ managerWorker: next }),
    onSuccess: (result) => queryClient.setQueryData(workspaceQueryKeys.config, result),
    onError: (error: Error) => toast(error.message, { tone: 'danger' }),
  })
  const parsed = editing ? rosterFromDraft(editing.draft) : null
  // Shipped ON: a server that predates the key answers without it, and that must still read as on.
  const complexityPolicy = config.safety.managerComplexityPolicy ?? true
  const fullAccess = config.safety.managerFullAccess ?? false
  const [confirmingAccess, setConfirmingAccess] = useState(false)
  const saveFullAccess = useMutation({
    mutationFn: (on: boolean) => putWorkspaceConfig({ safety: { managerFullAccess: on } }),
    onSuccess: (result) => queryClient.setQueryData(workspaceQueryKeys.config, result),
    onError: (error: Error) => toast(error.message, { tone: 'danger' }),
  })
  const saveComplexityPolicy = useMutation({
    mutationFn: (on: boolean) => putWorkspaceConfig({ safety: { managerComplexityPolicy: on } }),
    onSuccess: (result) => queryClient.setQueryData(workspaceQueryKeys.config, result),
    onError: (error: Error) => toast(error.message, { tone: 'danger' }),
  })

  const commit = () => {
    if (!editing || !parsed?.ok || !editing.name.trim()) return
    const preset: ManagerPreset = { id: editing.id ?? newPresetId(presets), name: editing.name.trim(), roster: parsed.roster }
    const next = editing.id ? presets.map((p) => (p.id === editing.id ? preset : p)) : [...presets, preset]
    save.mutate({ presets: next, defaultPresetId }, { onSuccess: () => { setEditing(null); toast(t('Preset "{name}" saved', { name: preset.name })) } })
  }

  return (
    <div data-slot="manager-worker-section" className="mx-auto flex w-full max-w-2xl flex-col gap-7 p-4 pb-[calc(90px+env(safe-area-inset-bottom))] md:p-6 md:pb-6">
      <SettingsField
        title={t('Presets')}
        hint={t('A manager and the workers it may use. Choose one in the new-task composer, or adjust it for a single task there. Only the agents listed are ever used.')}
      >
        {presets.length === 0 ? <p data-slot="mw-empty" className="text-[13px] text-soft-foreground">{t('No presets yet.')}</p> : null}
        <ul className="flex flex-col gap-2">
          {presets.map((preset) => {
            const gone = disconnectedBackends(preset.roster, connected)
            return (
              <li key={preset.id} data-slot="mw-preset" className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{preset.name}{preset.id === defaultPresetId ? <span className="ml-2 text-[11px] text-soft-foreground">{t('default')}</span> : null}</div>
                  <div className="truncate text-[12px] text-muted-foreground">{describeRoster(preset.roster)}</div>
                  {gone.length > 0 ? <div className="text-[11px] text-danger">{t('Not connected: {backends}', { backends: gone.join(', ') })}</div> : null}
                </div>
                <Button type="button" size="sm" variant="outline" onClick={() => setEditing({ id: preset.id, name: preset.name, draft: draftFromRoster(preset.roster) })}>{t('Edit')}</Button>
                <Button type="button" size="sm" variant="danger-ghost" onClick={() => setRemoving(preset)}>{t('Delete')}</Button>
              </li>
            )
          })}
        </ul>
        {editing ? (
          <div data-slot="mw-editor" className="flex flex-col gap-3 rounded-md border border-border p-3">
            <input aria-label={t('Preset name')} placeholder={t('Preset name — e.g. Claude manages, Codex and OpenCode work')} value={editing.name} maxLength={80} onChange={(event) => setEditing({ ...editing, name: event.target.value })} className={fieldClass} />
            <RosterEditor draft={editing.draft} onChange={(draft) => setEditing({ ...editing, draft })} connected={connected} disabled={save.isPending} />
            {parsed && !parsed.ok ? <p className="text-[12px] text-danger">{parsed.error}</p> : null}
            {parsed?.ok && totalConcurrency(parsed.roster) > config.resources.maxParallel ? (
              <p className="text-[12px] text-warning">{t('These workers may run {workers} at once; the workspace runs {tasks} tasks in parallel.', { workers: totalConcurrency(parsed.roster), tasks: config.resources.maxParallel })}</p>
            ) : null}
            <div className="flex gap-2">
              <Button type="button" size="sm" data-slot="mw-save" disabled={!parsed?.ok || !editing.name.trim() || save.isPending} onClick={commit}>{t('Save preset')}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>{t('Cancel')}</Button>
            </div>
          </div>
        ) : (
          <div>
            <Button type="button" size="sm" variant="outline" data-slot="mw-new" disabled={presets.length >= MANAGER_PRESETS_MAX} title={presets.length >= MANAGER_PRESETS_MAX ? t('{count} presets is the cap — edit or delete one first', { count: MANAGER_PRESETS_MAX }) : undefined} onClick={() => setEditing({ id: null, name: '', draft: starterDraft(connected) })}>{t('New preset')}</Button>
          </div>
        )}
      </SettingsField>

      <SettingsField title={t('Default')} hint={t('Opens the new-task composer with this preset switched on. None keeps manager–worker off until you turn it on for a task.')}>
        <AppSelect
          aria-label={t('Default preset')}
          data-slot="mw-default"
          value={defaultPresetId ?? ''}
          disabled={save.isPending}
          onChange={(event) => save.mutate({ presets, defaultPresetId: event.target.value || null })}
          className={fieldClass}
        >
          <option value="">{t('None')}</option>
          {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </AppSelect>
      </SettingsField>

      <SettingsField
        title={t('Hand complex work to workers')}
        hint={t('A manager may do a small job itself (about 2 files, 40 lines). Bigger or multi-part work it must hand to workers or split with them, and onni warns it when it does a big job alone. Off restores the old behaviour.')}
      >
        <label className="flex w-fit items-center gap-3">
          <Switch
            aria-label={t('Hand complex work to workers')}
            data-slot="mw-complexity-policy"
            checked={complexityPolicy}
            disabled={saveComplexityPolicy.isPending}
            onCheckedChange={(on) => saveComplexityPolicy.mutate(on)}
          />
          <span className="text-[13px] text-muted-foreground">{complexityPolicy ? t('On') : t('Off')}</span>
        </label>
      </SettingsField>

      <SettingsField
        title={t('Full manager access')}
        hint={t('The highest permission: the manager may merge worker branches into its own branch and its branch into the local base branch. Off by default; it never pushes. A single task can override this in its Task settings.')}
      >
        <label className="flex w-fit items-center gap-3">
          <Switch
            aria-label={t('Full manager access')}
            data-slot="mw-full-access"
            checked={fullAccess}
            disabled={saveFullAccess.isPending}
            onCheckedChange={(on) => (on ? setConfirmingAccess(true) : saveFullAccess.mutate(false))}
          />
          <span className={fullAccess ? 'text-[13px] font-medium text-danger' : 'text-[13px] text-muted-foreground'}>{fullAccess ? t('On — managers may merge') : t('Off')}</span>
        </label>
        <ConfirmDialog
          open={confirmingAccess}
          onOpenChange={setConfirmingAccess}
          danger
          title={t('Give managers full access?')}
          description={t('Every new manager–worker task will be allowed to merge worker branches into its own branch, and its branch into the base branch of its project (locally; it never pushes). You can still turn it off per task.')}
          confirmLabel={t('Allow merging')}
          onConfirm={() => {
            setConfirmingAccess(false)
            saveFullAccess.mutate(true)
          }}
        />
      </SettingsField>

      <SettingsField title={t('Limits that apply to the whole tree')} hint={t('A manager and its workers share one set of ceilings, and workers run within the parallel-task cap.')}>
        <p data-slot="mw-limit-links" className="text-[13px] text-muted-foreground">
          {t('Cost, token, time and step ceilings, the subtask cap and the unanswered-wait expiry are under')}{' '}
          <Link to="/settings/global/resources" className="font-medium text-foreground underline">{t('Settings → Resources → Run limits')}</Link>
          {'. '}
          {t('Workspace parallelism is currently')}{' '}
          <strong>{config.resources.maxParallel}</strong>{' '}
          {tn(config.resources.maxParallel, 'task at once (same page).', 'tasks at once (same page).')}
        </p>
        <p data-slot="mw-fence-note" className="text-[12px] text-soft-foreground">
          {t('The worker list steers orchestration: the server refuses a dispatch to any agent outside it. It is not a security boundary — an agent can still run a CLI or call the HTTP API directly, and a top-level task started that way is not bound to a roster.')}
        </p>
      </SettingsField>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => { if (!open) setRemoving(null) }}
        title={t('Delete "{name}"?', { name: removing?.name ?? '' })}
        description={t('The preset is removed. Tasks already started with it keep their roster.')}
        confirmLabel={t('Delete')}
        danger
        onConfirm={() => {
          if (!removing) return
          const rest = presets.filter((p) => p.id !== removing.id)
          save.mutate({ presets: rest, defaultPresetId: defaultPresetId === removing.id ? null : defaultPresetId })
        }}
      />
    </div>
  )
}
