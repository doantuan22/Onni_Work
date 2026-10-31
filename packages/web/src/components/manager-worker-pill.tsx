import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'

import { putWorkspaceConfig } from '@/api/client'
import { useProviderStatus, useWorkspaceConfig, workspaceQueryKeys } from '@/api/queries'
import type { ManagerPreset, Roster } from '@onni/api-client'
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

const selectClass =
  'block w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'

/**
 * The composer's "Manager / Workers" block (docs/design/manager-worker.md): off by default, or on
 * with the workspace's default preset. Presets are shared by every project and can be overridden
 * for this one task without touching them. `onRoster` reports the roster to start with (or null).
 */
export function ManagerWorkerPill({ onRoster }: { onRoster: (roster: Roster | null) => void }) {
  const config = useWorkspaceConfig()
  const providers = useProviderStatus()
  const queryClient = useQueryClient()
  const connected = connectedBackends(providers.data)
  const presets = config.data?.managerWorker.presets ?? []
  const [on, setOn] = useState(false)
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
      onSuccess: () => { setPresetId(preset.id); setName(''); toast(`Preset "${preset.name}" saved`) },
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

  return (
    <details data-slot="manager-worker-pill" className="relative">
      <summary className="cursor-pointer select-none rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
        {roster ? `Manager: ${roster.manager.runner} → ${roster.workers.length} worker${roster.workers.length === 1 ? '' : 's'}` : 'Manager / Workers'}
      </summary>
      <div className="absolute z-20 mt-1 w-[34rem] max-w-[92vw] rounded-md border border-border bg-card p-3 shadow-md">
        <label className="mb-3 flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" data-slot="manager-worker-on" checked={on} onChange={(event) => toggle(event.target.checked)} />
          Run as manager–worker
        </label>
        {on && draft ? (
          <div className="flex flex-col gap-3">
            {presets.length > 0 ? (
              <select aria-label="Preset" value={presetId} onChange={(event) => choose(event.target.value)} className={selectClass}>
                <option value="">Custom for this task</option>
                {presets.map((p) => <option key={p.id} value={p.id}>{p.name} — {describeRoster(p.roster)}</option>)}
              </select>
            ) : null}
            <RosterEditor draft={draft} onChange={(next) => { setDraft(next); setPresetId('') }} connected={connected} />
            {parsed && !parsed.ok ? <p data-slot="roster-error" className="text-[12px] text-danger">{parsed.error}</p> : null}
            {gone.length > 0 ? <p className="text-[12px] text-danger">Not connected: {gone.join(', ')} — the task would be refused.</p> : null}
            {roster && maxParallel !== undefined && totalConcurrency(roster) > maxParallel ? (
              <p data-slot="roster-capacity-note" className="text-[12px] text-warning-foreground">
                Workers may run {totalConcurrency(roster)} at once but the workspace runs {maxParallel} tasks in parallel.{' '}
                <Link to="/settings/global/resources" className="underline">Change it in Settings → Resources</Link>.
              </p>
            ) : null}
            <div className="flex items-center gap-2">
              <input aria-label="Preset name" placeholder="Save as preset…" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} className={selectClass} />
              <Button type="button" size="sm" variant="outline" data-slot="save-preset" disabled={!roster || !name.trim() || save.isPending} onClick={savePreset}>Save</Button>
            </div>
          </div>
        ) : null}
      </div>
    </details>
  )
}
