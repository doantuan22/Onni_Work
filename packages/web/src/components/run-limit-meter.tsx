import type { RunRecord } from '@onni/api-client'

import { describeRow, formatLimitValue, limitRows, tightestRow } from '@/lib/run-limits'

/**
 * "Used / ceiling" for one run, compact enough for a list row or the thread header: ∞ when the run
 * is unlimited, the tightest ceiling as a bar when it is capped, and a plain "limit reached" when a
 * ceiling ended it. The title lists every ceiling, including ones this backend cannot report.
 */
export function RunLimitMeter({ run }: { run: RunRecord }) {
  if (run.limitHit) {
    return (
      <span
        data-slot="run-limit-hit"
        title={run.error ?? 'A run ceiling ended this task'}
        className="rounded-full bg-danger/10 px-1.5 py-px text-[10px] font-medium text-danger"
      >
        limit: {run.limitHit.kind}
      </span>
    )
  }
  if (run.limits?.mode === 'none') {
    return (
      <span
        data-slot="run-limit-unlimited"
        title="Unlimited — no cost, token, time or step ceiling"
        aria-label="Unlimited"
        className="text-[13px] font-semibold leading-none text-warning-foreground"
      >
        ∞
      </span>
    )
  }
  const rows = limitRows(run)
  const tight = tightestRow(rows)
  if (!tight) return null
  const percent = Math.round(tight.fraction * 100)
  return (
    <span
      data-slot="run-limit-bar"
      title={rows.map(describeRow).join('\n')}
      className="flex items-center gap-1 text-[10px] tabular-nums text-soft-foreground"
    >
      <span className="h-1 w-10 overflow-hidden rounded-full bg-border" aria-hidden="true">
        <span
          className={`block h-full ${percent >= 90 ? 'bg-danger' : percent >= 70 ? 'bg-warning' : 'bg-foreground/50'}`}
          style={{ width: `${percent}%` }}
        />
      </span>
      <span aria-label={`${tight.label} ${percent}% of ceiling`}>
        {formatLimitValue(tight.kind, tight.used)}/{formatLimitValue(tight.kind, tight.limit)}
      </span>
    </span>
  )
}
