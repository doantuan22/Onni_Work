import { Link as GlobalLink } from 'react-router'

import type { ApiRun } from '@onni/api-client'
import { StatusDot } from '@/components/status-dot'

/** One denied action as the engine recorded it: `antigravity: denied <what> (permission level "<level>")`. */
export interface DeniedAction {
  /** What the agent tried — a tool and its command or path. */
  action: string
  /** The permission level that said no; absent for a line this build cannot split. */
  level?: string
}

const RECORDED = /^antigravity: denied (.+) \(permission level "([^"]+)"\)$/

/** Split a recorded line into the action and the level; an unrecognised line is kept whole. */
export function parseDeniedAction(line: string): DeniedAction {
  const match = RECORDED.exec(line)
  return match ? { action: match[1]!, level: match[2]! } : { action: line }
}

/**
 * "This task finished, but its agent was refused something" (ADR 0007). A backend that cannot ask for
 * approval denies a tool outright; when the turn still answered, the run goes on and the denial is
 * recorded. Without this the only trace is a note scrolled up in the transcript, so a task that
 * silently skipped its tests would read as done. Lives in the dock, beside the other "what should I
 * know right now" hints, and says why and where to change it.
 */
export function DeniedActionsHint({ run }: { run: Pick<ApiRun, 'deniedActions'> }) {
  const denied = run.deniedActions ?? []
  if (denied.length === 0) return null
  const items = denied.map(parseDeniedAction)
  const levels = [...new Set(items.map((item) => item.level).filter((level): level is string => level !== undefined))]
  return (
    <details data-slot="denied-actions-hint" className="px-1 text-xs text-muted-foreground">
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1">
        <StatusDot tone="pending" />
        <span>
          <span className="font-medium text-foreground">
            {denied.length} action{denied.length === 1 ? '' : 's'} denied
          </span>{' '}
          by the agent’s permission level
          {levels.length > 0 ? ` (${levels.join(', ')})` : ''} — the task went on without {denied.length === 1 ? 'it' : 'them'}
        </span>
      </summary>
      <ul data-slot="denied-actions-list" className="mt-1 flex flex-col gap-1 pl-5">
        {items.map((item, index) => (
          <li key={`${index}:${item.action}`} data-slot="denied-action" className="flex flex-col">
            <code className="break-all font-mono text-[11px] text-foreground">{item.action}</code>
            <span>
              {item.level
                ? `Denied by the “${item.level}” level: the agent cannot ask for approval when Onni runs it, so it is refused outright.`
                : 'Denied by the agent’s permission level.'}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1 pl-5">
        {/* Global settings live OUTSIDE every project scope: react-router's own Link, as the auto-resume hint does. */}
        <GlobalLink
          to="/settings/global/agent-permissions"
          data-slot="denied-actions-settings-link"
          className="font-medium text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
        >
          Agent permissions
        </GlobalLink>{' '}
        sets what it may do; a widened level applies to the next run, not this one.
      </p>
    </details>
  )
}
