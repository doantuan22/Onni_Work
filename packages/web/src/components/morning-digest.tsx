import { useMemo, useState } from 'react'

import { useRuns } from '@/api/queries'
import { Link } from '@/lib/project-router'
import { buildDigest, DEFAULT_DIGEST_HOURS, DIGEST_HOURS } from '@/lib/morning-digest'
import { formatLimitValue } from '@/lib/run-limits'
import { RunLimitMeter } from '@/components/run-limit-meter'

const STORAGE_KEY = 'onni.digest.hours'

function readHours(): number {
  try {
    const stored = Number(window.localStorage.getItem(STORAGE_KEY))
    return (DIGEST_HOURS as readonly number[]).includes(stored) ? stored : DEFAULT_DIGEST_HOURS
  } catch {
    return DEFAULT_DIGEST_HOURS
  }
}

/** "While you were away": tasks that finished, failed, hit a ceiling or need you in the last N hours. */
export function MorningDigest({ now = Date.now() }: { now?: number }) {
  const runs = useRuns()
  const [hours, setHours] = useState(readHours)
  const digest = useMemo(() => buildDigest(runs.data ?? [], now, hours), [runs.data, now, hours])
  const changeHours = (value: number) => {
    setHours(value)
    try {
      window.localStorage.setItem(STORAGE_KEY, String(value))
    } catch {
      // a remembered window is a convenience, not state
    }
  }
  return (
    <section data-slot="morning-digest" className="mb-5 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold">While you were away</h2>
        <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          last
          <select
            aria-label="Digest window in hours"
            data-slot="digest-hours"
            value={hours}
            onChange={(event) => changeHours(Number(event.target.value))}
            className="rounded-md border border-input bg-card px-2 py-1 text-[12px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {DIGEST_HOURS.map((h) => <option key={h} value={h}>{h} h</option>)}
          </select>
        </label>
        <span data-slot="digest-totals" className="ml-auto text-[12px] tabular-nums text-muted-foreground">
          {digest.total} task{digest.total === 1 ? '' : 's'} · {formatLimitValue('cost', digest.costUsd)} · {formatLimitValue('tokens', digest.tokens)} tokens
        </span>
      </div>
      {digest.total === 0 ? (
        <p data-slot="digest-empty" className="mt-2 text-[13px] text-soft-foreground">Nothing finished, failed or needs you in this window.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {digest.groups.map((group) => (
            <div key={group.key} data-slot={`digest-${group.key}`}>
              <h3 className="text-[12px] font-medium uppercase tracking-wide text-soft-foreground">{group.title} · {group.runs.length}</h3>
              <ul className="mt-1 flex flex-col gap-1">
                {group.runs.map((run) => (
                  <li key={run.id} className="flex items-center gap-2 text-[13px]">
                    <Link to={`/tasks/${run.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{run.title}</Link>
                    <RunLimitMeter run={run} />
                    <span className="tabular-nums text-muted-foreground">
                      {run.costUsd !== undefined ? formatLimitValue('cost', run.costUsd) : '—'} · {formatLimitValue('tokens', run.tokensUsed ?? 0)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
