import { useMutation, useQueryClient } from '@tanstack/react-query'
import { UsersIcon } from 'lucide-react'
import { useState } from 'react'

import { putWorkspaceConfig } from '@/api/client'
import { useProviderStatus, useWorkspaceConfig, workspaceQueryKeys } from '@/api/queries'
import type { ManagerPreset, WorkspaceConfigResponse } from '@onni/api-client'
import { CenteredState } from '@/components/centered-state'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { RosterEditor } from '@/components/roster-editor'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toaster'
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

const field =
  'block w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50'

/**
 * Settings → Manager–Worker (docs/design/manager-worker.md): the presets a task can start from
 * ("Claude manages, Codex and OpenCode work") and which one the composer opens with. Presets
 * belong to the workspace, so every project sees them; a single task can still override one.
 * Limits and parallelism are set elsewhere and linked, because they bound the whole tree.
 */
export function ManagerWorkerSection() {
  const config = useWorkspaceConfig()
  if (config.isPending) return <p data-slot="mw-loading" className="p-4 text-[13px] text-soft-foreground md:p-6">Loading…</p>
  if (config.isError) {
    return <CenteredState icon={<UsersIcon />} tone="danger" title="Manager–worker settings did not load" subtitle={config.error.message} heading="h2" />
  }
  return <ManagerWorkerForm config={config.data} />
}

function ManagerWorkerForm({ config }: { config: WorkspaceConfigResponse }) {
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

  const commit = () => {
    if (!editing || !parsed?.ok || !editing.name.trim()) return
    const preset: ManagerPreset = { id: editing.id ?? newPresetId(presets), name: editing.name.trim(), roster: parsed.roster }
    const next = editing.id ? presets.map((p) => (p.id === editing.id ? preset : p)) : [...presets, preset]
    save.mutate({ presets: next, defaultPresetId }, { onSuccess: () => { setEditing(null); toast(`Preset "${preset.name}" saved`) } })
  }

  return (
    <div data-slot="manager-worker-section" className="mx-auto flex w-full max-w-2xl flex-col gap-7 p-4 pb-[calc(90px+env(safe-area-inset-bottom))] md:p-6 md:pb-6">
      <SettingsField
        title="Presets"
        hint="A manager and the workers it may use. Choose one in the new-task composer, or adjust it for a single task there. Only the agents listed are ever used."
      >
        {presets.length === 0 ? <p data-slot="mw-empty" className="text-[13px] text-soft-foreground">No presets yet.</p> : null}
        <ul className="flex flex-col gap-2">
          {presets.map((preset) => {
            const gone = disconnectedBackends(preset.roster, connected)
            return (
              <li key={preset.id} data-slot="mw-preset" className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{preset.name}{preset.id === defaultPresetId ? <span className="ml-2 text-[11px] text-soft-foreground">default</span> : null}</div>
                  <div className="truncate text-[12px] text-muted-foreground">{describeRoster(preset.roster)}</div>
                  {gone.length > 0 ? <div className="text-[11px] text-danger">Not connected: {gone.join(', ')}</div> : null}
                </div>
                <Button type="button" size="sm" variant="outline" onClick={() => setEditing({ id: preset.id, name: preset.name, draft: draftFromRoster(preset.roster) })}>Edit</Button>
                <Button type="button" size="sm" variant="danger-ghost" onClick={() => setRemoving(preset)}>Delete</Button>
              </li>
            )
          })}
        </ul>
        {editing ? (
          <div data-slot="mw-editor" className="flex flex-col gap-3 rounded-md border border-border p-3">
            <input aria-label="Preset name" placeholder="Preset name — e.g. Claude manages, Codex and OpenCode work" value={editing.name} maxLength={80} onChange={(event) => setEditing({ ...editing, name: event.target.value })} className={field} />
            <RosterEditor draft={editing.draft} onChange={(draft) => setEditing({ ...editing, draft })} connected={connected} disabled={save.isPending} />
            {parsed && !parsed.ok ? <p className="text-[12px] text-danger">{parsed.error}</p> : null}
            {parsed?.ok && totalConcurrency(parsed.roster) > config.resources.maxParallel ? (
              <p className="text-[12px] text-warning-foreground">These workers may run {totalConcurrency(parsed.roster)} at once; the workspace runs {config.resources.maxParallel} tasks in parallel.</p>
            ) : null}
            <div className="flex gap-2">
              <Button type="button" size="sm" data-slot="mw-save" disabled={!parsed?.ok || !editing.name.trim() || save.isPending} onClick={commit}>Save preset</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div>
            <Button type="button" size="sm" variant="outline" data-slot="mw-new" disabled={presets.length >= 20} onClick={() => setEditing({ id: null, name: '', draft: starterDraft(connected) })}>New preset</Button>
          </div>
        )}
      </SettingsField>

      <SettingsField title="Default" hint="Opens the new-task composer with this preset switched on. None keeps manager–worker off until you turn it on for a task.">
        <select
          aria-label="Default preset"
          data-slot="mw-default"
          value={defaultPresetId ?? ''}
          disabled={save.isPending}
          onChange={(event) => save.mutate({ presets, defaultPresetId: event.target.value || null })}
          className={field}
        >
          <option value="">None</option>
          {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </SettingsField>

      <SettingsField title="Limits that apply to the whole tree" hint="A manager and its workers share one set of ceilings, and workers run within the parallel-task cap.">
        <p data-slot="mw-limit-links" className="text-[13px] text-muted-foreground">
          Cost, token, time and step ceilings, the subtask cap and the unanswered-wait expiry are under{' '}
          <Link to="/settings/global/resources" className="font-medium text-foreground underline">Settings → Resources → Run limits</Link>.
          Workspace parallelism is currently <strong>{config.resources.maxParallel}</strong> task{config.resources.maxParallel === 1 ? '' : 's'} at once (same page).
        </p>
        <p data-slot="mw-fence-note" className="text-[12px] text-soft-foreground">
          The worker list steers orchestration: the server refuses a dispatch to any agent outside it. It is not a security
          boundary — an agent can still run a CLI or call the HTTP API directly, and a top-level task started that way is not
          bound to a roster.
        </p>
      </SettingsField>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => { if (!open) setRemoving(null) }}
        title={`Delete "${removing?.name ?? ''}"?`}
        description="The preset is removed. Tasks already started with it keep their roster."
        confirmLabel="Delete"
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
