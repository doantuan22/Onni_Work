import { useHealth } from '@/api/queries'
import { useI18n } from '@/lib/i18n'
import { Link, useActiveProjectId } from '@/lib/project-router'
import { useWebhookList } from '@/hooks/use-webhooks'
import { SettingsField } from './settings-field'
export function WebhookCard() {
  const { t } = useI18n()
  const health = useHealth()
  const enabled = !health.isError && health.data?.capabilities?.webhooks === true
  const unsupported = health.data?.capabilities?.webhooksUnavailableReason === 'unsupported_platform'
  const projectId = useActiveProjectId() ?? 'default'
  const list = useWebhookList(projectId, enabled)
  const rows = list.data?.receivers ?? []
  const attention = rows.filter(row => ['suspended', 'disabled'].includes(row.state)).length
  const inactive = rows.filter(row => row.state === 'inactive').length
  const pending = rows.reduce((total, row) => total + row.pendingCount, 0)
  return <SettingsField title={t('Webhooks')} hint={t('Task updates sent to your own endpoint.')}>
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-border bg-card p-3 text-[13px]">
      <div className="min-w-0">
        {health.isError ? <p>{t('Status unavailable — could not load server health.')}</p>
          : !health.data ? <p>{t('Loading webhook status…')}</p>
          : unsupported ? <p>{t('Not available on this server’s platform.')}</p>
          : !enabled ? <p>{t('Off on this server.')}</p>
          : list.isPending ? <p className="text-muted-foreground">{t('Loading…')}</p>
          : list.error ? <p className="text-danger">{t('Status unavailable — open Webhooks for details.')}</p>
          : !rows.length ? <p>{t('No receivers yet.')}</p>
          : <p>{t('{active} active · {paused} paused', { active: rows.filter(row => row.state === 'active').length, paused: rows.filter(row => row.state === 'paused').length })}{inactive ? ` · ${t('{count} inactive', { count: inactive })}` : ''}{attention ? <> · <span className="text-warning">{t('{count} need attention', { count: attention })}</span></> : ''}{pending ? ` · ${t('{count} pending', { count: pending })}` : ''}</p>}
        {enabled && !unsupported && !list.error && list.data?.webhookHealth && ['degraded', 'unavailable'].includes(list.data.webhookHealth.status) && <p role="status" className="text-warning">{list.data.webhookHealth.reason || t('Webhook delivery needs attention. Open Webhooks for details.')}</p>}
      </div>
      <Link className="shrink-0 underline underline-offset-2 hover:text-foreground" to="/settings/webhooks">{enabled && !unsupported ? t('Manage webhooks') : t('Open webhook settings')}</Link>
    </div>
  </SettingsField>
}
