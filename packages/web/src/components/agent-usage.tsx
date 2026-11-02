import { RefreshCwIcon } from 'lucide-react'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { getAgentUsage } from '@/api/client'
import { useAgentUsage, workspaceQueryKeys } from '@/api/queries'
import type { AgentUsageEntry, UsageWindow } from '@onni/api-client'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/** Where the bar turns from quiet to amber to red (the same spirit as the CPU bar). */
const WARN_PCT = 80
const DANGER_PCT = 90

/** "2 h 15 min" / "3 d 4 h" / "45 min": the time between two instants. */
export function formatSpan(from: number, to: number): string {
  const minutes = Math.max(0, Math.round((to - from) / 60_000))
  if (minutes >= 2 * 24 * 60) return `${Math.floor(minutes / 1440)} d ${Math.floor((minutes % 1440) / 60)} h`
  if (minutes >= 60) return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
  return `${minutes} min`
}

export function windowLabel(w: UsageWindow): string {
  if (w.kind === 'five-hour') return '5-hour window'
  if (w.kind === 'weekly') return 'Weekly window'
  if (w.kind === 'primary') return w.durationMinutes === 300 ? '5-hour window' : 'Primary window'
  if (w.kind === 'secondary') return w.durationMinutes === 10080 ? 'Weekly window' : 'Secondary window'
  return 'Other window'
}

function Bar({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct))
  const fill = clamped >= DANGER_PCT ? 'bg-danger' : clamped >= WARN_PCT ? 'bg-pending' : 'bg-primary'
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(clamped)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full transition-[width] duration-300', fill)} style={{ width: `${clamped}%` }} />
    </div>
  )
}

/**
 * The selected agent usage limits (P8): a bar per window with the reset time, or an honest
 * "not supported" / "no data yet" line. Never a made-up number; read-only.
 */
export function AgentUsage({ provider, now = Date.now() }: { provider: string; now?: number }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const usage = useAgentUsage()
  const [refreshing, setRefreshing] = useState(false)
  const entry: AgentUsageEntry | undefined = usage.data?.agents.find((agent) => agent.provider === provider)

  const refresh = async () => {
    setRefreshing(true)
    try {
      queryClient.setQueryData(workspaceQueryKeys.agentUsage, await getAgentUsage(true))
    } catch {
      /* the entry keeps its last state; the button just stops spinning */
    } finally {
      setRefreshing(false)
    }
  }

  let body: React.ReactNode
  if (usage.isPending) body = <p className="text-[13px] text-muted-foreground">{t('Checking…')}</p>
  else if (usage.isError || !entry) body = <p data-slot="usage-unavailable" className="text-[13px] text-muted-foreground">{t('Usage is unavailable right now. Try again in a moment.')}</p>
  else if (entry.support === 'unsupported') {
    body = (
      <div data-slot="usage-unsupported">
        <p className="text-[13px] text-foreground">{t('Usage tracking is not supported yet')}</p>
        {entry.reason ? <p className="text-[12px] text-muted-foreground">{t(entry.reason)}</p> : null}
      </div>
    )
  } else if (entry.windows.length === 0) {
    body = (
      <p data-slot="usage-none" className="text-[13px] text-muted-foreground">
        {entry.state === 'unavailable'
          ? t('Usage is unavailable right now. Try again in a moment.')
          : entry.support === 'observed'
            ? t('No usage data yet — it appears after this agent runs a task.')
            : t('No usage data yet.')}
      </p>
    )
  } else {
    body = (
      <div className="flex flex-col gap-3">
        {entry.windows.map((w) => (
          <div key={w.id} data-slot="usage-window" data-window={w.id} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="font-medium text-foreground">{t(windowLabel(w))}</span>
              <span className="tabular-nums text-muted-foreground">
                {w.usedPercent === null ? '—' : `${Math.round(w.usedPercent)}%`}
                {w.status === 'blocked' ? ` · ${t('blocked')}` : ''}
              </span>
            </div>
            {w.usedPercent === null ? null : <Bar pct={w.usedPercent} />}
            {w.resetsAt ? <span className="text-[11.5px] text-soft-foreground">{t('Resets in {time}', { time: formatSpan(now, w.resetsAt) })}</span> : null}
          </div>
        ))}
        {entry.state === 'stale' ? <p className="text-[11.5px] text-warning">{t('These numbers are old — they refresh when the agent next runs.')}</p> : null}
        {entry.state === 'unavailable' ? <p className="text-[11.5px] text-warning">{t('Live read failed; showing the last known numbers.')}</p> : null}
      </div>
    )
  }

  return (
    <section data-slot="agent-usage" data-provider={provider} className="flex flex-col gap-3 rounded-lg border border-border bg-card/40 p-3.5">
      <header className="flex items-center gap-2">
        <h3 className="text-[13px] font-semibold text-foreground">{t('Usage limits')}</h3>
        {entry?.observedAt ? <span className="text-[11px] text-soft-foreground">{t('updated {time} ago', { time: formatSpan(entry.observedAt, now) })}</span> : null}
        {entry && entry.support !== 'unsupported' ? (
          <Button type="button" size="sm" variant="ghost" className="ml-auto h-7 gap-1.5 px-2" data-action="usage-refresh" disabled={refreshing} onClick={() => void refresh()}>
            <RefreshCwIcon className={cn('size-3.5', refreshing && 'animate-spin')} aria-hidden="true" />
            {t('Refresh')}
          </Button>
        ) : null}
      </header>
      {body}
    </section>
  )
}
