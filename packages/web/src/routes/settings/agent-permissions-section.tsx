import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ShieldIcon } from 'lucide-react'
import { useState } from 'react'

import { putWorkspaceConfig } from '@/api/client'
import { useWorkspaceConfig, workspaceQueryKeys } from '@/api/queries'
import type { AgentPermissionLevel, WorkspaceConfigResponse } from '@onni/api-client'
import { CenteredState } from '@/components/centered-state'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { toast } from '@/components/ui/toaster'
import { SettingsField } from './settings-field'

/** The three levels, safest first. The copy states what is NOT possible as plainly as what is. */
export const PERMISSION_LEVELS: readonly { id: AgentPermissionLevel; label: string; hint: string }[] = [
  {
    id: 'files-only',
    label: 'Files only (default)',
    hint: 'Edits files in the task worktree. Shell commands — tests, builds, git — are denied. A task that needed one stops and says what it was denied.',
  },
  {
    id: 'allow-rules',
    label: 'Narrow allow-rules',
    hint: 'Also allows git status/diff/log/add/commit, the task report, and the step’s own test/build commands. git push, network tools and bulk delete stay denied. Rule matching for extra arguments is not yet verified, so a command can still be denied.',
  },
  {
    id: 'bypass',
    label: 'Skip all confirmations',
    hint: 'Antigravity approves everything it asks for — shell, browser and web tools included. Never applied to an unattended task (autonomous, or a worker in a manager–worker tree): those use the narrow allow-rules instead.',
  },
]

/**
 * Settings → Agent permissions (ADR 0007): what Antigravity may do without asking. It cannot ask
 * for approval when run headless, so the answer has to be chosen up front. Safe by default; the
 * widest level needs an explicit confirmation, which the server enforces as well.
 */
export function AgentPermissionsSection() {
  const config = useWorkspaceConfig()
  if (config.isPending) return <p data-slot="agent-permissions-loading" className="p-4 text-[13px] text-soft-foreground md:p-6">Loading…</p>
  if (config.isError) {
    return <CenteredState icon={<ShieldIcon />} tone="danger" title="Agent permission settings did not load" subtitle={config.error.message} heading="h2" />
  }
  return <AgentPermissionsForm config={config.data} />
}

function AgentPermissionsForm({ config }: { config: WorkspaceConfigResponse }) {
  const queryClient = useQueryClient()
  const current = config.agentPermissions.antigravity
  const [confirming, setConfirming] = useState(false)
  const save = useMutation({
    mutationFn: (patch: { antigravity: AgentPermissionLevel; confirmBypass?: true }) => putWorkspaceConfig({ agentPermissions: patch }),
    onSuccess: (result) => queryClient.setQueryData(workspaceQueryKeys.config, result),
    onError: (error: Error) => toast(error.message, { tone: 'danger' }),
  })
  const choose = (level: AgentPermissionLevel) => {
    if (level === current) return
    if (level === 'bypass') setConfirming(true)
    else save.mutate({ antigravity: level })
  }

  return (
    <div data-slot="agent-permissions-section" className="mx-auto flex w-full max-w-2xl flex-col gap-7 p-4 pb-[calc(90px+env(safe-area-inset-bottom))] md:p-6 md:pb-6">
      <SettingsField
        title="Antigravity"
        hint="agy cannot ask you before running a command when Onni drives it, so what it may do is decided here. It applies to every project."
      >
        <div role="radiogroup" aria-label="Antigravity permission level" className="flex flex-col gap-2">
          {PERMISSION_LEVELS.map((level) => (
            <label
              key={level.id}
              data-slot="agent-permission-level"
              data-level={level.id}
              className={`flex cursor-pointer items-start gap-2.5 rounded-md border p-3 ${current === level.id ? 'border-ring bg-card' : 'border-border'}`}
            >
              <input
                type="radio"
                name="antigravity-permission"
                value={level.id}
                checked={current === level.id}
                disabled={save.isPending}
                onChange={() => choose(level.id)}
                className="mt-1"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-[13px] font-medium text-foreground">{level.label}</span>
                <span className={`text-[12px] ${level.id === 'bypass' ? 'text-danger' : 'text-soft-foreground'}`}>{level.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {current === 'bypass' ? (
          <p data-slot="agent-permission-bypass-active" role="alert" className="text-[12px] text-danger">
            Antigravity is set to skip all confirmations for watched tasks. Choose another level to turn it off.
          </p>
        ) : null}
      </SettingsField>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        danger
        title="Skip all Antigravity confirmations?"
        description="Antigravity will run shell commands, drive a browser and fetch web pages without asking, as you, in the task worktree and beyond it. Onni’s push guard is a barrier, not a sandbox. This applies to tasks you start yourself; unattended tasks keep the narrow allow-rules."
        confirmLabel="Skip confirmations"
        onConfirm={() => {
          setConfirming(false)
          save.mutate({ antigravity: 'bypass', confirmBypass: true })
        }}
      />
    </div>
  )
}
