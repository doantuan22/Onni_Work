import { useMemo, useState } from 'react'

import { useRuns } from '@/api/queries'
import { Link } from '@/lib/project-router'
import { useI18n } from '@/lib/i18n'
import { buildDigest, DEFAULT_DIGEST_HOURS, DIGEST_HOURS } from '@/lib/morning-digest'
import { formatLimitValue } from '@/lib/run-limits'
import { RunBackendBadge } from '@/components/run-backend-badge'
import { RunLimitMeter } from '@/components/run-limit-meter'
import { AppSelect } from '@/components/ui/app-select'

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
  const { t, tn } = useI18n()
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
        <h2 className="text-sm font-semibold">{t('While you were away')}</h2>
        <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          {t('last')}
          <AppSelect
            aria-label={t('Digest window in hours')}
            data-slot="digest-hours"
            value={hours}
            onChange={(event) => changeHours(Number(event.target.value))}
            className="rounded-md border border-input bg-card px-2 py-1 text-[12px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {DIGEST_HOURS.map((h) => <option key={h} value={h}>{h} h</option>)}
          </AppSelect>
        </label>
        <span data-slot="digest-totals" className="ml-auto text-[12px] tabular-nums text-muted-foreground">
          {tn(digest.total, '{count} task', '{count} tasks')} · {formatLimitValue('cost', digest.costUsd)} ·{' '}
          {formatLimitValue('tokens', digest.tokens)} {t('tokens')}
        </span>
      </div>
      {digest.notDelegated.length > 0 ? (
        <p data-slot="digest-not-delegated-note" className="mt-2 text-[12px] text-warning">
          {tn(
            digest.notDelegated.length,
            '{count} manager task',
            '{count} manager tasks',
          )}{' '}
          {t('finished without giving any work to a worker.')}
        </p>
      ) : null}
      {digest.needSignIn.length > 0 ? (
        <p data-slot="digest-sign-in-note" role="status" className="mt-2 text-[12px] text-danger">
          {tn(
            digest.needSignIn.length,
            '{count} failed task needs a sign-in: the agent is not signed in or its login expired. Sign in again, then Continue — retrying without that will fail the same way.',
            '{count} failed tasks need a sign-in: the agent is not signed in or its login expired. Sign in again, then Continue — retrying without that will fail the same way.',
          )}
        </p>
      ) : null}
      {digest.withDeniedActions.length > 0 ? (
        <p data-slot="digest-denied-note" className="mt-2 text-[12px] text-warning">
          {tn(digest.withDeniedActions.length, '{count} task', '{count} tasks')}{' '}
          {t("had something denied by the agent's permission level")} (
          {tn(
            digest.withDeniedActions.reduce((n, run) => n + (run.deniedActions?.length ?? 0), 0),
            '{count} action',
            '{count} actions',
          )}) — {t('open them to see what.')}
        </p>
      ) : null}
      {digest.total === 0 ? (
        <p data-slot="digest-empty" className="mt-2 text-[13px] text-soft-foreground">{t('Nothing finished, failed or needs you in this window.')}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {digest.groups.map((group) => (
            <div key={group.key} data-slot={`digest-${group.key}`}>
              <h3 className="text-[12px] font-medium uppercase tracking-wide text-soft-foreground">{t(group.title)} · {group.runs.length}</h3>
              <ul className="mt-1 flex flex-col gap-1">
                {group.runs.map((run) => (
                  <li key={run.id} className="flex items-center gap-2 text-[13px]">
                    <Link to={`/tasks/${run.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{run.title}</Link>
                    <RunBackendBadge run={run} />
                    {run.status === 'failed' && run.failureClass === 'auth' ? (
                      <span data-slot="digest-sign-in" className="rounded-full bg-danger/10 px-1.5 py-px text-[10px] font-medium text-danger">
                        {t('needs sign-in')}
                      </span>
                    ) : null}
                    {(run.deniedActions?.length ?? 0) > 0 ? (
                      <span
                        data-slot="digest-denied"
                        title={run.deniedActions?.join('\n')}
                        className="rounded-full bg-warning/10 px-1.5 py-px text-[10px] font-medium text-warning"
                      >
                        {t('{count} denied', { count: run.deniedActions!.length })}
                      </span>
                    ) : null}
                    {run.managerDidNotDelegate ? (
                      <span data-slot="digest-not-delegated" className="rounded-full bg-warning/10 px-1.5 py-px text-[10px] font-medium text-warning">{t('manager did not delegate')}</span>
                    ) : null}
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
