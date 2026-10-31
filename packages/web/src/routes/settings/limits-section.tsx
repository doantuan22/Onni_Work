import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ShieldAlertIcon } from 'lucide-react'
import { useState } from 'react'

import { putWorkspaceConfig } from '@/api/client'
import { useWorkspaceConfig, workspaceQueryKeys } from '@/api/queries'
import type { SetWorkspaceConfigInput, WorkspaceConfigResponse } from '@onni/api-client'
import { CenteredState } from '@/components/centered-state'
import { IntegerStepper } from '@/components/integer-stepper'
import { RunLimitsFields } from '@/components/run-limits-fields'
import { StopAllButton } from '@/components/stop-all-button'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toaster'
import { draftFromLimits, requestFromDraft, type LimitsDraft } from '@/lib/run-limits'
import { SettingsField } from './settings-field'

/**
 * Global settings → Limits (docs/design/unattended-safety.md §2–§4): the workspace default for how
 * much a run may spend, plus the guards that stay on in every mode ("Advanced"). A run snapshots
 * the default when it starts, so a change here applies to new runs only.
 */
export function LimitsSection() {
  const config = useWorkspaceConfig()
  if (config.isPending) {
    return <p data-slot="limits-loading" className="p-4 text-[13px] text-soft-foreground md:p-6">Loading limits…</p>
  }
  if (config.isError) {
    return <CenteredState icon={<ShieldAlertIcon />} tone="danger" title="Limits did not load" subtitle={config.error.message} heading="h2" />
  }
  return <LimitsForm config={config.data} />
}

function LimitsForm({ config }: { config: WorkspaceConfigResponse }) {
  const queryClient = useQueryClient()
  const save = useMutation({
    mutationFn: (patch: SetWorkspaceConfigInput) => putWorkspaceConfig(patch),
    onSuccess: (result) => queryClient.setQueryData(workspaceQueryKeys.config, result),
    onError: (error: Error) => toast(error.message, { tone: 'danger' }),
  })
  const [draft, setDraft] = useState<LimitsDraft>(() => draftFromLimits(config.limits))
  const parsed = requestFromDraft(draft)
  const saved = draftFromLimits(config.limits)
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const submit = () => {
    if (!parsed.ok || parsed.request.mode === 'default') return
    save.mutate(
      { limits: parsed.request as Extract<typeof parsed.request, { mode: 'none' | 'capped' }> },
      { onSuccess: () => toast(parsed.request.mode === 'none' ? 'New runs are unlimited ∞' : 'Run limits saved') },
    )
  }
  const safety = config.safety

  return (
    <div data-slot="limits-section" className="mx-auto flex w-full max-w-2xl flex-col gap-7 p-4 pb-[calc(90px+env(safe-area-inset-bottom))] md:p-6 md:pb-6">
      <SettingsField
        title="Run limits"
        hint="The default for new runs. Capped applies only the numbers you enter (blank = no limit on that axis); Unlimited applies none. Each run keeps the values it started with, and a task tree shares its root's ceilings."
      >
        <RunLimitsFields draft={draft} onChange={setDraft} allowDefault={false} disabled={save.isPending} />
        {!parsed.ok ? <p data-slot="limits-error" className="text-[12px] text-danger">{parsed.error}</p> : null}
        <div>
          <Button type="button" size="sm" data-slot="limits-save" disabled={!dirty || !parsed.ok || save.isPending} onClick={submit}>
            Save limits
          </Button>
        </div>
      </SettingsField>

      <SettingsField
        title="Emergency stop"
        hint="Cancels every queued and running task in every project. Also: onni stop --all."
      >
        <div><StopAllButton /></div>
      </SettingsField>

      <details data-slot="limits-advanced" className="rounded-md border border-border p-3">
        <summary className="cursor-pointer text-sm font-semibold">Advanced</summary>
        <p className="mt-1 text-[12px] text-muted-foreground">
          These stay on whichever mode you choose: they stop a night-long task from hanging or fanning out.
        </p>
        <div className="mt-4 flex flex-col gap-6">
          <SettingsField title="Unanswered-wait expiry" hint="Minutes an autonomous or dispatched task may wait for an answer before it ends as failed (worktree and session kept; Continue answers it). Cannot be switched off.">
            <IntegerStepper aria-label="Unanswered-wait expiry" data-slot="safety-wait-expiry" value={safety.waitExpiryMinutes} min={1} max={1440}
              onCommit={(minutes) => save.mutateAsync({ safety: { waitExpiryMinutes: minutes ?? 30 } })} />
          </SettingsField>
          <SettingsField title="Dispatch depth" hint="1 means a worker cannot dispatch further tasks. Higher values let workers fan out too.">
            <IntegerStepper aria-label="Dispatch depth" data-slot="safety-depth" value={safety.dispatchMaxDepth} min={1} max={3}
              onCommit={(depth) => save.mutateAsync({ safety: { dispatchMaxDepth: depth ?? 1 } })} />
          </SettingsField>
          <SettingsField title="Subtasks per tree" hint="Applies when the task was not started with its own subtask limit.">
            <IntegerStepper aria-label="Subtasks per tree" data-slot="safety-subtasks" value={safety.dispatchMaxSubtasks} min={1} max={50}
              onCommit={(n) => save.mutateAsync({ safety: { dispatchMaxSubtasks: n ?? 12 } })} />
          </SettingsField>
          <SettingsField title="Retries per dispatched order" hint="How many times the same order may be dispatched again after it failed. An order can only lower this.">
            <IntegerStepper aria-label="Retries per dispatched order" data-slot="safety-retry" value={safety.dispatchRetryLimit} min={0} max={3}
              onCommit={(n) => save.mutateAsync({ safety: { dispatchRetryLimit: n ?? 0 } })} />
          </SettingsField>
        </div>
        <p data-slot="limits-fence-note" className="mt-4 text-[12px] text-muted-foreground">
          A fence, not a sandbox: unattended agents get a pre-push hook that refuses refs outside onni/*, and Claude
          sessions deny git push. A backend can still reach your home folder, the network and files outside its
          worktree, and <code>git push --no-verify</code> skips the hook.
        </p>
      </details>
    </div>
  )
}
