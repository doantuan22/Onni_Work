import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import type { WebhookReceiver, WebhookHistoricalReceiver, WebhookDelivery, WebhookDeliveryStatus } from '@onni/api-client'
import { webhookApi } from '@/api/client'
import { webhookKey } from '@/hooks/use-webhooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useI18n } from '@/lib/i18n'
import { activityLabel, deliveryStatusLabels, reasonLabel, sourceLabels, webhookTime, webhookTimeZone } from './webhook-presentation'
import { Link } from '@/lib/project-router'
import { eventLabels } from './webhook-form'
const statuses = Object.keys(deliveryStatusLabels) as WebhookDeliveryStatus[]
const statusTone: Partial<Record<WebhookDeliveryStatus, string>> = { delivered: 'text-success', failed: 'text-danger', dropped: 'text-danger', blocked_policy: 'text-warning', retrying: 'text-warning' }
export function ReceiverHistory({ projectId, receiver, operation, tab: selectedTab, onTabChange }: { tab?: 'deliveries' | 'activity'; onTabChange?: (tab: 'deliveries' | 'activity') => void; projectId: string; receiver: WebhookReceiver | WebhookHistoricalReceiver; operation: (action: 'retry' | 'replay', row: WebhookDelivery, receiver: WebhookReceiver) => void }) {
  const { t, tn } = useI18n()
  const [localTab, setLocalTab] = useState<'deliveries' | 'activity'>('deliveries')
  const tab = selectedTab ?? localTab
  const setTab = (value: typeof tab) => { setLocalTab(value); onTabChange?.(value) }
  const [filter, setFilter] = useState('all')
  const resultLabelId = useId()
  const [taskId, setTaskId] = useState('')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string>()
  const deliveries = useInfiniteQuery({ queryKey: [...webhookKey(projectId), receiver.id, 'deliveries', taskId], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => webhookApi.deliveries(projectId, receiver.id, pageParam, taskId || undefined), getNextPageParam: page => page.nextCursor, enabled: tab === 'deliveries', retry: false })
  const activity = useQuery({ queryKey: [...webhookKey(projectId), receiver.id, 'activity'], queryFn: () => webhookApi.activity(projectId, receiver.id), enabled: tab === 'activity', retry: false })
  const rows = [...new Map((deliveries.data?.pages.flatMap(page => page.items) ?? []).map(row => [row.deliveryId, row])).values()]
  const visible = rows.filter(row => filter === 'all' || row.status === filter)
  const zone = deliveries.data?.pages[0]?.timezone
  const time = (value: string) => webhookTime(value, zone)
  return <section className="flex min-w-0 flex-col gap-3">
    {receiver.kind === 'history' && <p className="rounded-md border border-border bg-muted p-3 text-[13px] text-muted-foreground">{t('Deleted {time} — read-only. Its settings and signing keys are gone; history is kept for up to 30 days.', { time: webhookTime(receiver.deletedAt) })}</p>}
    <Tabs value={tab} onValueChange={value => setTab(value as typeof tab)}>
    <TabsList aria-label={t('Receiver history')}><TabsTrigger value="deliveries">{t('Deliveries')}</TabsTrigger><TabsTrigger value="activity">{t('Activity')}</TabsTrigger></TabsList>
    <TabsContent value="activity" className="flex flex-col gap-2">
      <p className="text-[13px] text-muted-foreground">{t('Times in {zone}.', { zone: webhookTimeZone(activity.data?.timezone).label })}</p>
      {activity.isPending && <p className="text-sm text-muted-foreground">{t('Loading activity…')}</p>}{activity.error && <p role="alert" className="text-sm text-danger">{activity.error.message}</p>}
      {activity.data?.items.map(row => <div key={row.id} className="rounded-md border border-border p-3 text-sm"><p><span className="font-medium">{t(activityLabel(row.action))}</span> <span className="text-muted-foreground">· {webhookTime(row.at, activity.data?.timezone)} · {t('via {source}', { source: t(sourceLabels[row.source]) })}{row.revision !== undefined && ` · ${t('revision {revision}', { revision: row.revision })}`}</span></p>{row.fields.length > 0 && <p className="text-[13px] text-muted-foreground">{t('Changed: {fields}', { fields: row.fields.join(', ') })}</p>}{row.detail && <p className="text-[13px] text-muted-foreground">{row.detail}</p>}</div>)}
      {activity.data?.items.length === 0 && <p className="text-sm text-muted-foreground">{t('No activity in the retained history.')}</p>}{activity.data?.hasMore && <p className="text-[13px] text-muted-foreground">{t('Showing the latest 100 actions.')}</p>}
    </TabsContent><TabsContent value="deliveries" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <form className="flex min-w-0 flex-1 items-end gap-2" onSubmit={event => { event.preventDefault(); setTaskId(search.trim()) }}><label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-medium">{t('Task ID')}<Input value={search} onChange={event => setSearch(event.target.value)} placeholder={t('Optional — show one task’s deliveries')} /></label><Button type="submit" variant="outline">{t('Find')}</Button></form>
        <div className="flex flex-col gap-1.5"><span id={resultLabelId} className="text-sm font-medium">{t('Result')}</span><Select value={filter} onValueChange={setFilter}>
          <SelectTrigger aria-labelledby={resultLabelId}><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">{t('All results')}</SelectItem>{statuses.map(value => <SelectItem key={value} value={value}>{t(deliveryStatusLabels[value])}</SelectItem>)}</SelectContent>
        </Select></div>
      </div>
      <p className="text-[13px] text-muted-foreground">{t('Showing {range} of {total}', { range: rows.length ? `1–${rows.length}` : '0', total: deliveries.data?.pages[0]?.total ?? 0 })}{taskId ? ` ${t('for task {taskId}', { taskId })}` : ''}{t('. The result filter applies to loaded entries. Times in {zone}.', { zone: webhookTimeZone(zone).label })}</p>
      {deliveries.isPending && <p className="text-sm text-muted-foreground">{t('Loading deliveries…')}</p>}{deliveries.error && <p role="alert" className="text-sm text-danger">{deliveries.error.message}</p>}
      {!deliveries.isPending && visible.length === 0 && <p className="text-sm text-muted-foreground">{t('No deliveries match.')}</p>}
      {visible.map(row => <article key={row.deliveryId} className="min-w-0 rounded-md border border-border p-3 text-sm">
        <button className="w-full min-w-0 text-left" type="button" aria-expanded={expanded === row.deliveryId} onClick={() => setExpanded(current => current === row.deliveryId ? undefined : row.deliveryId)}><span className="font-medium">{t(eventLabels[row.eventType])}</span> · <span className={statusTone[row.status]}>{t(deliveryStatusLabels[row.status])}</span><span className="block text-[13px] text-muted-foreground">{time(row.createdAt)} · {tn(row.attempts, '{count} attempt', '{count} attempts')}{row.taskId ? ` · ${t('task {id}', { id: row.taskId.slice(0, 8) })}` : ''}</span></button>
        {expanded === row.deliveryId && <div className="mt-3 flex flex-col gap-2 break-words border-t border-border pt-3 text-[13px]">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 [overflow-wrap:anywhere]">
            {row.reason && <><dt className="text-muted-foreground">{t('Reason')}</dt><dd>{t(reasonLabel(row.reason))}</dd></>}
            {row.httpStatus && <><dt className="text-muted-foreground">{t('HTTP status')}</dt><dd>{row.httpStatus}</dd></>}
            {row.nextAttemptAt && <><dt className="text-muted-foreground">{t('Next attempt')}</dt><dd>{time(row.nextAttemptAt)}</dd></>}
            <dt className="text-muted-foreground">{t('Retries until')}</dt><dd>{time(row.expiresAt)}</dd>
            {row.taskId && <><dt className="text-muted-foreground">{t('Task')}</dt><dd>{row.taskAvailability === 'available' ? <Link className="underline underline-offset-2" to={`/tasks/${encodeURIComponent(row.taskId)}`}>{row.taskId}</Link> : row.taskId}{row.taskAvailability === 'deleted' && ` ${t('(deleted)')}`}{row.taskAvailability === 'unknown' && ` ${t('(availability unknown)')}`}</dd></>}
            <dt className="text-muted-foreground">{t('Destination')}</dt><dd>{row.destination}</dd>
            <dt className="text-muted-foreground">{t('Event ID')}</dt><dd className="font-mono text-xs">{row.eventId}</dd>
            <dt className="text-muted-foreground">{t('Delivery ID')}</dt><dd className="font-mono text-xs">{row.deliveryId}</dd>
            {row.payloadRetainedUntil && <><dt className="text-muted-foreground">{t('Payload kept until')}</dt><dd>{time(row.payloadRetainedUntil)}</dd></>}
            {row.historyRetainedUntil && <><dt className="text-muted-foreground">{t('History kept until')}</dt><dd>{time(row.historyRetainedUntil)}{t(' at most')}</dd></>}
          </dl>
          {row.payloadAvailability === 'not_created' && <p className="text-muted-foreground">{t('No payload was created for this delivery.')}</p>}
          {row.payloadAvailability === 'unknown' && <p className="text-muted-foreground">{t('Payload availability is unknown.')}</p>}
          {row.response && <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">{row.response}</pre>}
          {receiver.kind === 'live' && <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" disabled={!row.retryAllowed} onClick={() => operation('retry', row, receiver)}>{t('Retry now')}</Button><Button size="sm" variant="outline" disabled={!row.replayAllowed} onClick={() => operation('replay', row, receiver)}>{t('Replay')}</Button>
            {!row.replayAllowed && <span className="text-muted-foreground">{t('Replay unavailable: {reason}', { reason: row.replayUnavailableReason ? t(replayReason[row.replayUnavailableReason]) : t('the payload or receiver is no longer eligible.') })}</span>}</div>}
        </div>}
      </article>)}
      {deliveries.hasNextPage && <div><Button variant="outline" disabled={deliveries.isFetchingNextPage} onClick={() => void deliveries.fetchNextPage()}>{t('Load older')}</Button></div>}
    </TabsContent></Tabs>
  </section>
}

const replayReason: Record<NonNullable<WebhookDelivery['replayUnavailableReason']>, string> = {
  receiver_deleted: 'the receiver was deleted.', receiver_inactive: 'activate the receiver first.',
  configuration_changed: 'the receiver settings changed since.', task_unavailable: 'the task is deleted or its state cannot be checked.',
  not_fresh: 'the event is out of date.', not_terminal: 'the delivery has not finished yet.',
  synthetic_test: 'send a new test instead.', payload_expired: 'the payload is no longer kept.', payload_unavailable: 'the original payload is unavailable.',
}
