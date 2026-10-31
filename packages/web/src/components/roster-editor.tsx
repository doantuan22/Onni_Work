import { PlusIcon, Trash2Icon } from 'lucide-react'

import { ROSTER_MAX_CONCURRENT, ROSTER_MAX_WORKERS, type Runner } from '@onni/api-client'
import { Button } from '@/components/ui/button'
import { emptyWorker, type RosterDraft, type WorkerDraft } from '@/lib/roster'

const field =
  'block w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50'

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
  return (
    <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as Runner | '')} className={field}>
      <option value="">Choose a backend…</option>
      {options.map((runner) => (
        <option key={runner} value={runner}>
          {runner}
          {connected.includes(runner) ? '' : ' (not connected)'}
        </option>
      ))}
    </select>
  )
}

/**
 * The manager and the workers it may use. Backends are limited to the ones connected right now;
 * a worker is a backend, an optional model (several entries may share a backend), a free-text
 * role the manager reads, and how many of its tasks may run at once. Agents left out are never
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
  const setWorker = (index: number, patch: Partial<WorkerDraft>) =>
    onChange({ ...draft, workers: draft.workers.map((w, i) => (i === index ? { ...w, ...patch } : w)) })
  return (
    <div data-slot="roster-editor" className="flex flex-col gap-4">
      {connected.length === 0 ? (
        <p data-slot="roster-no-backends" className="text-[12px] text-danger">
          No agent is connected on this machine — connect one in Settings → Agents first.
        </p>
      ) : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-[13px] font-semibold">Manager</legend>
        <div className="grid grid-cols-2 gap-2">
          <BackendSelect label="Manager backend" value={draft.managerRunner} connected={connected} disabled={disabled} onChange={(managerRunner) => onChange({ ...draft, managerRunner })} />
          <input aria-label="Manager model" placeholder="model (optional)" value={draft.managerModel} disabled={disabled} onChange={(e) => onChange({ ...draft, managerModel: e.target.value })} className={field} />
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-[13px] font-semibold">Workers</legend>
        {draft.workers.map((worker, index) => (
          <div key={index} data-slot="roster-worker" className="flex flex-col gap-2 rounded-md border border-border p-2.5">
            <div className="grid grid-cols-[1fr_1fr_5rem_auto] items-center gap-2">
              <BackendSelect label={`Worker ${index + 1} backend`} value={worker.runner} connected={connected} disabled={disabled} onChange={(runner) => setWorker(index, { runner })} />
              <input aria-label={`Worker ${index + 1} model`} placeholder="model (optional)" value={worker.model} disabled={disabled} onChange={(e) => setWorker(index, { model: e.target.value })} className={field} />
              <input
                type="number"
                min={1}
                max={ROSTER_MAX_CONCURRENT}
                aria-label={`Worker ${index + 1} at once`}
                title="How many tasks of this worker run at once"
                value={worker.maxConcurrent}
                disabled={disabled}
                onChange={(e) => setWorker(index, { maxConcurrent: Number(e.target.value) || 1 })}
                className={field}
              />
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove worker ${index + 1}`} disabled={disabled || draft.workers.length <= 1} onClick={() => onChange({ ...draft, workers: draft.workers.filter((_, i) => i !== index) })}>
                <Trash2Icon className="size-[14px]" aria-hidden="true" />
              </Button>
            </div>
            <input aria-label={`Worker ${index + 1} role`} placeholder="Role / strengths — e.g. backend tests, docs, mechanical renames" maxLength={500} value={worker.role} disabled={disabled} onChange={(e) => setWorker(index, { role: e.target.value })} className={field} />
          </div>
        ))}
        <div>
          <Button type="button" variant="outline" size="sm" data-slot="roster-add-worker" disabled={disabled || draft.workers.length >= ROSTER_MAX_WORKERS} onClick={() => onChange({ ...draft, workers: [...draft.workers, emptyWorker(connected[0] ?? '')] })}>
            <PlusIcon className="size-[14px]" aria-hidden="true" />
            Add worker
          </Button>
        </div>
      </fieldset>
      <p data-slot="roster-fence-note" className="text-[11px] text-soft-foreground">
        The manager can hand work only to the workers listed here; the server refuses any other backend. This steers
        orchestration — it is not a security boundary (an agent can still run a CLI or call the API directly).
      </p>
    </div>
  )
}
