import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateWebhook, UpdateWebhook, WebhookReceiver, WebhookHistoricalReceiver, WebhookDelivery } from '@onni/api-client'
import { webhookApi } from '@/api/client'
import { useHealth } from '@/api/queries'
import { useActiveProjectId } from '@/lib/project-router'
import { useWebhookList, webhookKey } from '@/hooks/use-webhooks'
import { EllipsisIcon, KeyRoundIcon, PlusIcon, RefreshCwIcon, ShieldOffIcon, Trash2Icon } from 'lucide-react'
import { toast } from '@/components/ui/toaster'
import { Pill } from '@/components/pill'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { WebhookForm, eventLabels, webhookDraft } from './webhook-form'
import { WebhookTestFeedback, type PendingWebhookTest } from './webhook-test-feedback'
import { ReceiverHistory } from './webhook-history'
import { activityLabel, endpointHealthTone, graceLabels, lastTestLabels, presetLabels, profileLabels, receiverStateLabels, scopeLabels, sourceLabels, webhookGuide, webhookTime } from './webhook-presentation'
import { useI18n } from '@/lib/i18n'
type Confirmation = { title: string; text: string; run: () => Promise<unknown>; standard?: boolean; local?: boolean; receiver?: WebhookReceiver; deletesReceiver?: boolean }
export function WebhooksSection() {
  const { t } = useI18n()
  const projectId = useActiveProjectId() ?? 'default'
  const health = useHealth()
  if (health.isError) return <p role="status" className={chassis}>{t('Webhook status unavailable — could not load server health.')}</p>
  if (!health.data) return <p role="status" className={chassis}>{t('Loading webhook status…')}</p>
  return <WebhookPanel key={projectId} projectId={projectId} enabled={health.data?.capabilities.webhooks === true} unsupportedPlatform={health.data?.capabilities.webhooksUnavailableReason === 'unsupported_platform'} />
}
function WebhookPanel({ projectId, enabled, unsupportedPlatform }: { projectId: string; enabled: boolean; unsupportedPlatform: boolean }) {
  const { t, tn } = useI18n()
  const client = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const view = useRef({ mounted: false, token: Symbol() })
  useLayoutEffect(() => { view.current = { mounted: true, token: Symbol() }; return () => { view.current.mounted = false } }, [location])
  // Router keys return on Back/Forward; a visit token must never be reused.
  const currentView = (token: symbol) => view.current.mounted && view.current.token === token
  const endpoint = searchParams.get('endpoint') ?? ''
  const requestedTab = searchParams.get('tab') ?? 'settings'
  const validEndpoint = /^[A-Za-z0-9_-]{1,128}$/.test(endpoint)
  const validTab = ['settings', 'deliveries', 'activity'].includes(requestedTab)
  const historyTab = requestedTab === 'activity' ? 'activity' : 'deliveries'
  const navigationSearch = useRef(searchParams.toString())
  useLayoutEffect(() => { navigationSearch.current = searchParams.toString() }, [searchParams])
  const navigateReceiver = (id?: string, tab = 'deliveries') => {
    const next = new URLSearchParams(navigationSearch.current)
    if (id) { next.set('endpoint', id); next.set('tab', tab) }
    else { next.delete('endpoint'); next.delete('tab') }
    // Tabs can request selection on both mouse-down and focus before React commits.
    // Reserve the target synchronously so one interaction creates one history entry.
    if (next.toString() === navigationSearch.current) return
    navigationSearch.current = next.toString()
    setSearchParams(next)
  }
  const guide = webhookGuide()
  const list = useWebhookList(projectId, enabled)
  const [form, setForm] = useState<'new' | WebhookReceiver>()
  const [draft, setDraft] = useState(() => webhookDraft())
  const [stale, setStale] = useState(false)
  const [copyMessage, setCopyMessage] = useState('')
  const [secret, setSecret] = useState<string>()
  const [confirmation, setConfirmation] = useState<Confirmation>()
  const addTrigger = useRef<HTMLButtonElement>(null)
  const formFocusTarget = useRef<HTMLElement | null>(null)
  const secretFocusTarget = useRef<HTMLElement | null>(null)
  const confirmationFocusTarget = useRef<HTMLElement | null>(null)
  // Controlled dialogs have no Radix trigger. Never restore behind another
  // open dialog (form → review → form, signing key, or navigation to history).
  const restoreFocus = (event: Event, target: HTMLElement | null) => {
    event.preventDefault()
    const openDialogs = [...document.querySelectorAll('[role="dialog"][data-state="open"]')]
    if (openDialogs.length && !openDialogs.some(dialog => target && dialog.contains(target))) return
    if (target?.isConnected && !target.matches(':disabled')) target.focus()
    else addTrigger.current?.focus()
  }
  const [standardConsent, setStandardConsent] = useState(false)
  const [localConsent, setLocalConsent] = useState(false)
  // Add is local to this visit. Back/Forward must retire it before showing a
  // URL-backed history view; confirmation toggles do not navigate or lose drafts.
  useLayoutEffect(() => {
    if (form === 'new') { setForm(undefined); setDraft(webhookDraft()); setStale(false); setError('') }
  }, [location])
  // A confirmation and its consent belong only to the view where the action was chosen.
  useLayoutEffect(() => { setConfirmation(undefined); setStandardConsent(false); setLocalConsent(false) }, [location])
  const historyTriggers = useRef(new Map<string, HTMLButtonElement>())
  const menuTriggers = useRef(new Map<string, HTMLButtonElement>())
  const historyFocusTarget = useRef<HTMLButtonElement | undefined>(undefined)
  useLayoutEffect(() => {
    if (validEndpoint && validTab && requestedTab !== 'settings') historyFocusTarget.current = historyTriggers.current.get(endpoint)
  }, [endpoint, validEndpoint, validTab, requestedTab, list.data])
  const openedSettings = useRef<string | undefined>(undefined)
  const knownReceiver = list.data?.receivers.find(row => row.id === endpoint) ?? list.data?.history.find(row => row.id === endpoint)
  const resolution = useQuery({ queryKey: [...webhookKey(projectId), 'resolve', endpoint, historyTab],
    queryFn: async () => (await (historyTab === 'activity' ? webhookApi.activity(projectId, endpoint) : webhookApi.deliveries(projectId, endpoint))).receiver,
    enabled: enabled && validEndpoint && validTab && requestedTab !== 'settings' && !knownReceiver, retry: false })
  useEffect(() => {
    if (enabled && validEndpoint && requestedTab === 'settings') {
      const receiver = list.data?.receivers.find(row => row.id === endpoint)
      if (receiver && openedSettings.current !== endpoint) {
        openedSettings.current = endpoint; setForm(receiver); setDraft(webhookDraft(receiver)); setStale(false); setError('')
      }
    } else if (openedSettings.current) {
      openedSettings.current = undefined; setForm(undefined); setDraft(webhookDraft()); setStale(false)
    }
  }, [enabled, endpoint, validEndpoint, requestedTab, list.data])
  const [deleted, setDeleted] = useState(false)
  const [error, setError] = useState('')
  const [pendingTest, setPendingTest] = useState<PendingWebhookTest & { viewKey: string }>()
  // Retire the explicit test on navigation, including Back to an earlier location key.
  useLayoutEffect(() => { setPendingTest(undefined) }, [location.key])
  const sendTest = async (row: WebhookReceiver, input: { expectedRevision: number; deliveryRevision: number; operationId: string }) => {
    const key = view.current.token
    const result = await webhookApi.test(projectId, row.id, input)
    if (!currentView(key)) return
    setPendingTest({ viewKey: location.key, deliveryId: result.deliveryId, receiverId: row.id, receiverName: row.name, initialState: row.state, deliveryRevision: row.deliveryRevision })
  }
  const history = useInfiniteQuery({ queryKey: [...webhookKey(projectId), 'history'], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => webhookApi.history(projectId, pageParam), getNextPageParam: page => page.nextCursor, enabled: enabled && deleted, retry: false })
  const mutation = useMutation({ onMutate: () => ({ viewKey: view.current.token, form, confirmation }), mutationFn: async (run: () => Promise<unknown>) => {
    const key = view.current.token
    const result = await run()
    // Never put the one-time secret in React Query's shared mutation cache.
    if (currentView(key) && result && typeof result === 'object' && 'secret' in result && typeof result.secret === 'string' && result.secret.length > 0) { secretFocusTarget.current = form ? formFocusTarget.current : confirmationFocusTarget.current; setCopyMessage(''); setSecret(result.secret) }
  }, onSuccess: async (_result, _run, context) => {
    if (!context || !currentView(context.viewKey)) { await client.invalidateQueries({ queryKey: webhookKey(projectId) }); return }
    // A list action can finish after Add opens on the same URL. Only retire
    // the form/confirmation that actually belonged to this operation.
    if (form === context.form && confirmation === context.confirmation) {
      if (form) confirmationFocusTarget.current = formFocusTarget.current
      if (confirmation?.deletesReceiver) confirmationFocusTarget.current = addTrigger.current
      if (form && endpoint && requestedTab === 'settings') navigateReceiver()
      setForm(undefined); setDraft(webhookDraft()); setStale(false); setConfirmation(undefined); setError('')
    }
    await client.invalidateQueries({ queryKey: webhookKey(projectId) })
  }, onError: (issue: Error, _run, context) => {
    if (!context || !currentView(context.viewKey)) { void client.invalidateQueries({ queryKey: webhookKey(projectId) }); return }
    // Like success, an error belongs to the form/confirmation that started it.
    // Report an older action separately instead of blocking an unrelated draft.
    if (form === context.form && confirmation === context.confirmation) {
      setError(issue.message)
      if ('status' in issue && issue.status === 409) setStale(true)
    } else toast(t('Earlier webhook action failed: {message}', { message: issue.message }), { tone: 'danger' })
    void client.invalidateQueries({ queryKey: webhookKey(projectId) })
  } })
  const openConfirmation = (value: Confirmation, trigger: Element | null = document.activeElement) => { confirmationFocusTarget.current = trigger instanceof HTMLElement ? trigger : null; setStandardConsent(false); setLocalConsent(false); setError(''); setStale(false); setConfirmation(value) }
  const operation = (action: 'retry' | 'replay', row: WebhookDelivery, receiver: WebhookReceiver) => {
    const input = { expectedRevision: receiver.revision, deliveryRevision: receiver.deliveryRevision, operationId: crypto.randomUUID() }
    openConfirmation(action === 'replay'
      ? { title: t('Replay this event?'), text: t('Sends the same event again with a new 72-hour retry window. Your receiver or channel may show it twice.'), run: () => webhookApi.replay(projectId, row.deliveryId, input) }
      : { title: t('Retry this delivery now?'), text: t('Sends the same message again now. Rate limits and freshness checks still apply.'), run: () => webhookApi.retry(projectId, row.deliveryId, input) })
  }
  const pauseConfirmation = (row: WebhookReceiver): Confirmation => ({ title: t('Pause {name}?', { name: row.name }), text: `${t('New events won’t be queued while it is paused.')}${cancelled(row.pendingCount, tn)}`, run: () => webhookApi.pause(projectId, row.id, row.revision) })
  const deleteConfirmation = (row: WebhookReceiver): Confirmation => {
    const pending = cancelled(row.pendingCount, tn).trim()
    return { title: t('Delete {name}?', { name: row.name }), text: `${pending ? `${pending} ` : ''}${t('Its settings and signing keys are removed; delivery history stays for up to 30 days.')}`, deletesReceiver: true, run: () => webhookApi.remove(projectId, row.id, row.revision) }
  }
  if (unsupportedPlatform || !enabled) return <div data-slot="webhooks-settings" className={chassis}>
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div><h2 className="text-sm font-semibold">{unsupportedPlatform ? t('Webhooks aren’t available on this platform') : t('Webhooks are off')}</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">{unsupportedPlatform
          ? t('Delivery needs an OS-verified process identity to keep a single sender. Linux, macOS and Windows provide one; this platform does not.')
          : t('Send task updates to your own endpoint when a task needs you, is ready for review or finishes.')}</p></div>
      {!unsupportedPlatform && <p className="text-[13px]">{t('Start onni with')} <code>ONNI_WEBHOOKS=1</code>{t(', then reload this page. If someone else runs this server, ask them to turn webhooks on.')}</p>}
      <a className="w-fit text-[13px] underline underline-offset-2 hover:text-foreground" href={guide.href} target="_blank" rel="noreferrer">{t(guide.note)}</a>
    </section>
  </div>
  const receivers = list.data?.receivers ?? []
  const current = validEndpoint && validTab && requestedTab !== 'settings' ? knownReceiver ?? resolution.data : undefined
  const notice = list.data?.notice
  const noticeReceiver = notice?.receiverId ? receivers.find(row => row.id === notice.receiverId) : undefined
  const latestEdit = form && form !== 'new' ? receivers.find(row => row.id === form.id) : undefined
  const historyCount = list.data?.historyCount ?? 0
  const reconciliation = stale && <div className="flex flex-col gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-[13px]" role="alert">
    <p>{t('This receiver changed in the meantime, so nothing was applied. Review its latest state and confirm again.')}</p>
    {form && form !== 'new' ? <>
      <p>{t('Your draft is kept. Saving it replaces the latest settings below; a blank URL keeps the current destination.')}</p>
      {list.isFetching ? <p className="text-muted-foreground">{t('Loading the latest settings…')}</p> : list.error ? <p className="text-danger">{t('Couldn’t load the latest settings.')}</p> : latestEdit ? <><p className="font-medium">{t('Latest: revision {revision} · {state}', { revision: latestEdit.revision, state: t(receiverStateLabels[latestEdit.state]) })}</p><ActivationSummary receiver={latestEdit} projectId={projectId} /></> : <p>{t('This receiver no longer exists. Close this dialog to return to the list.')}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={list.isFetching} onClick={() => void list.refetch()}>{t('Refresh latest settings')}</Button>
        <Button size="sm" disabled={!latestEdit || list.isFetching || !!list.error} onClick={() => { if (latestEdit) { setForm(latestEdit); setStale(false); setConfirmation(undefined); setError('') } }}>{t('Keep draft and review again')}</Button>
      </div>
    </> : <p>{t('Cancel, check the refreshed receiver or its history, then choose the action again. Earlier consent is not reused.')}</p>}
  </div>
  return <div data-slot="webhooks-settings" className={chassis}>
    <section className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold">{t('Receivers')}</h2>
        <p className="text-[13px] text-muted-foreground">{t('Each receiver gets the task updates you choose while onni is running. New receivers stay Inactive until you test and activate them.')} <a className="underline underline-offset-2 hover:text-foreground" href={guide.href} target="_blank" rel="noreferrer">{t(guide.note)}</a></p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="ghost" size="icon" aria-label={t('Refresh')} title={t('Refresh')} disabled={list.isFetching} onClick={() => void list.refetch()}><RefreshCwIcon /></Button>
        <Button ref={addTrigger} disabled={list.isPending || !!list.error} onClick={event => { formFocusTarget.current = event.currentTarget; setError(''); setStale(false); setDraft(webhookDraft()); setForm('new') }}><PlusIcon />{t('Add receiver')}</Button>
      </div>
    </section>
    {notice && <section role="status" className="flex min-w-0 flex-col gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm [overflow-wrap:anywhere]">
      <p><span className="font-medium">{t(activityLabel(notice.action))}</span>{notice.receiverName ? ` — ${notice.receiverName}` : ''}<span className="text-muted-foreground">{notice.destination ? ` · ${notice.destination}` : ''} · {webhookTime(notice.at)}{notice.source ? ` · ${t('via {source}', { source: t(sourceLabels[notice.source]) })}` : ''}</span></p>
      <p className="text-[13px] text-muted-foreground">{t('Any local process, including agents, can change receivers and read signing keys. If this wasn’t you, review it.')}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate(() => webhookApi.acknowledge(projectId, list.data!.changeSequence))}>{t('Mark as reviewed')}</Button>
        {notice.receiverId && <Button size="sm" variant="ghost" onClick={() => navigateReceiver(notice.receiverId, 'activity')}>{t('View activity')}</Button>}
        {noticeReceiver && ['active', 'suspended'].includes(noticeReceiver.state) && <Button size="sm" variant="ghost" onClick={event => openConfirmation(pauseConfirmation(noticeReceiver), event.currentTarget)}>{t('Pause receiver')}</Button>}
        {noticeReceiver && <Button size="sm" variant="danger-ghost" onClick={event => openConfirmation(deleteConfirmation(noticeReceiver), event.currentTarget)}>{t('Delete receiver')}</Button>}
      </div>
    </section>}
    {endpoint && (!validEndpoint || !validTab) && <p role="alert" className="text-sm text-danger">{t('This receiver link is invalid.')}</p>}
    {validEndpoint && requestedTab === 'settings' && !list.isPending && !list.error && !receivers.some(row => row.id === endpoint) && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm"><span>{t('This receiver’s settings are unavailable — it may have been deleted.')}</span><Button size="sm" variant="outline" onClick={() => navigateReceiver(endpoint, 'deliveries')}>{t('View its history')}</Button></div>}
    {validEndpoint && validTab && requestedTab !== 'settings' && !current && <p role="status" className="text-sm text-muted-foreground">{resolution.error ? t('This receiver’s history is unavailable or no longer kept.') : t('Loading history…')}</p>}
    {(error || list.error) && <p role="alert" className="text-sm text-danger">{error || list.error?.message}</p>}
    {list.data?.webhookHealth.status !== 'ready' && list.data?.webhookHealth.reason && <p role="status" className="rounded-md border border-warning/50 bg-warning/10 p-3 text-[13px]">{list.data.webhookHealth.reason}</p>}
    {list.isPending && <p className="text-sm text-muted-foreground">{t('Loading receivers…')}</p>}
    {!list.isPending && !list.error && !receivers.length && <div className="rounded-lg border border-dashed border-border p-6 text-center"><p className="text-sm font-medium">{t('No receivers yet')}</p><p className="mt-1 text-[13px] text-muted-foreground">{t('Add your own endpoint. Send a test, then activate it.')}</p></div>}
    {receivers.map(row => {
      const inactive = ['inactive', 'disabled', 'paused'].includes(row.state)
      const testLabel = row.state === 'suspended' ? t('Test and recover') : row.state === 'disabled' ? t('Test after repair') : t('Send test')
      const summary = [row.destination, t('{profile} content', { profile: t(profileLabels[row.profile]) }), t('Last test: {result}', { result: t(lastTestLabels[row.lastTest]).toLowerCase() }),
        row.pendingCount ? tn(row.pendingCount, '{count} pending delivery', '{count} pending deliveries') : '', row.inFlightCount ? t('{count} sending', { count: row.inFlightCount }) : ''].filter(Boolean).join(' · ')
      return <article key={row.id} className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold [overflow-wrap:anywhere]">{row.name}<Pill dot={endpointHealthTone[row.state]}>{t(receiverStateLabels[row.state])}</Pill></h3>
          <p className="mt-1 break-words text-[13px] text-muted-foreground">{summary}</p>
          {row.consecutiveFailures > 0 && <p className="mt-1 text-[13px] text-warning">{tn(row.consecutiveFailures, '{count} failed attempt in a row.', '{count} failed attempts in a row.')}{row.pendingCount > 0 ? row.nextProbeAt ? ` ${t('Next retry {time}.', { time: webhookTime(row.nextProbeAt) })}` : '' : ` ${t('Nothing is queued, so nothing will be retried until the next event.')}`}</p>}
          {row.state === 'paused' && <p className="mt-1 text-[13px] text-muted-foreground">{row.pauseReason === 'project_removal' ? t('Paused when this project was removed from the workspace.') : t('Paused.')} {t('New events aren’t queued.')}</p>}
          {row.activationBlocked && <p className="mt-1 text-[13px] text-warning">{t('Send a passing test of these settings before activating.')}</p>}
          {row.retiredKeyExpiresAt && <p className="mt-1 text-[13px] text-muted-foreground">{t('The previous signing key stops working {time}.', { time: webhookTime(row.retiredKeyExpiresAt) })}</p>}
        </div>
        {pendingTest && pendingTest.viewKey === location.key && pendingTest.receiverId === row.id && <WebhookTestFeedback key={pendingTest.deliveryId} projectId={projectId} test={pendingTest} openHistory={id => navigateReceiver(id)} />}
        <div className="flex flex-wrap items-center gap-2">
          {inactive && <Button size="sm" disabled={mutation.isPending || row.activationBlocked || row.state === 'disabled' && row.lastTest !== 'success'} onClick={event => openConfirmation({ title: t('{action} {name}?', { action: row.state === 'paused' ? t('Resume') : t('Activate'), name: row.name }), text: `${t('Only events from now on are sent — nothing from before {action}.', { action: row.state === 'paused' ? t('resuming') : t('activation') })}${row.lastTest === 'transient_failure' ? ` ${t('The last test failed with a temporary error, so delivery may still fail.')}` : ''}`, receiver: row, standard: row.profile === 'standard', local: row.allowLocalNetwork, run: () => row.state === 'paused' ? webhookApi.resume(projectId, row.id, row.revision) : webhookApi.activate(projectId, row.id, row.revision) }, event.currentTarget)}>{row.state === 'paused' ? t('Resume') : t('Activate')}</Button>}
          <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={event => { const input = { expectedRevision: row.revision, deliveryRevision: row.deliveryRevision, operationId: crypto.randomUUID() }; if (row.state === 'suspended') openConfirmation({ title: t('Test and recover?'), text: t('If the test passes, {name} becomes Active and sends its queued deliveries that are still current{queued}.', { name: row.name, queued: row.pendingCount ? ` (${t('{count} queued now', { count: row.pendingCount })})` : '' }), run: () => sendTest(row, input) }, event.currentTarget); else mutation.mutate(() => sendTest(row, input)) }}>{testLabel}</Button>
          {!inactive && <Button size="sm" variant="outline" onClick={event => openConfirmation(pauseConfirmation(row), event.currentTarget)}>{t('Pause')}</Button>}
          <Button size="sm" variant="outline" onClick={event => { formFocusTarget.current = event.currentTarget; setDraft(webhookDraft(row)); setStale(false); setError(''); setForm(row); navigateReceiver(row.id, 'settings') }}>{t('Edit')}</Button>
          <Button size="sm" variant="outline" ref={node => { if (node) historyTriggers.current.set(row.id, node); else historyTriggers.current.delete(row.id) }} onClick={() => navigateReceiver(row.id)}>{t('History')}</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label={t('More actions for {name}', { name: row.name })} ref={node => { if (node) menuTriggers.current.set(row.id, node); else menuTriggers.current.delete(row.id) }}><EllipsisIcon /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[220px]">
              <DropdownMenuItem disabled={!!row.retiredKeyExpiresAt && Date.parse(row.retiredKeyExpiresAt) > Date.now()} onSelect={() => openConfirmation({ title: t('Rotate signing key?'), text: t('Old and new keys both sign deliveries for 24 hours. Install the new key in your receiver within that time.'), run: () => webhookApi.rotate(projectId, row.id, row.revision, 'graceful') }, menuTriggers.current.get(row.id))}><KeyRoundIcon />{t('Rotate key')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openConfirmation({ title: t('Revoke old signing keys now?'), text: t('Old keys stop signing immediately, and deliveries fail until your receiver uses the new key. Also remove old keys from your receiver — onni can’t revoke keys it still accepts.'), run: () => webhookApi.rotate(projectId, row.id, row.revision, 'revoke_now') }, menuTriggers.current.get(row.id))}><ShieldOffIcon />{t('Revoke old keys')}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => openConfirmation(deleteConfirmation(row), menuTriggers.current.get(row.id))}><Trash2Icon />{t('Delete')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </article>
    })}
    {(historyCount > 0 || deleted) && <section className="flex flex-col gap-2">
      <div><Button size="sm" variant="ghost" onClick={() => setDeleted(value => !value)}>{deleted ? t('Hide deleted receivers') : t('Show deleted receivers ({count})', { count: historyCount })}</Button></div>
      {deleted && <>
        {history.error && <p role="alert" className="text-sm text-danger">{history.error.message}</p>}
        {history.data?.pages.flatMap(page => page.items).map(row => <Button key={row.id} ref={node => { if (node) historyTriggers.current.set(row.id, node); else historyTriggers.current.delete(row.id) }} variant="outline" className="h-auto max-w-full justify-start whitespace-normal py-2 text-left font-normal [overflow-wrap:anywhere]" onClick={() => navigateReceiver(row.id)}>{t('{name} — deleted {time}', { name: row.name, time: webhookTime(row.deletedAt) })}</Button>)}
        {history.data && !history.data.pages.some(page => page.items.length) && <p className="text-[13px] text-muted-foreground">{t('No deleted receivers are kept.')}</p>}
        {history.hasNextPage && <div><Button size="sm" variant="outline" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>{t('Load older')}</Button></div>}
      </>}
    </section>}
    <Dialog open={form !== undefined && !confirmation} onOpenChange={open => { if (!open && !mutation.isPending) { setForm(undefined); setDraft(webhookDraft()); setStale(false); if (endpoint) navigateReceiver() } }}><DialogContent onCloseAutoFocus={event => restoreFocus(event, formFocusTarget.current)} className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{form === 'new' ? t('Add receiver') : t('Edit receiver')}</DialogTitle><DialogDescription>{t('New and changed receivers stay Inactive until you test and activate them.')}</DialogDescription></DialogHeader>{form && <WebhookForm key={form === 'new' ? 'new' : `${form.id}-${form.revision}`} receiver={form === 'new' ? undefined : form} guideHref={guide.href} draft={draft} setDraft={setDraft} pending={mutation.isPending} blocked={stale} save={value => {
      if (form === 'new') mutation.mutate(() => webhookApi.create(projectId, value as CreateWebhook))
      else { const row = form; openConfirmation({ title: t('Save changes?'), text: t('Changing where or what {name} sends makes it Inactive again{cancels}. A delivery already sending may still arrive. Renaming alone keeps it active.', { name: row.name, cancels: row.pendingCount ? ` ${tn(row.pendingCount, 'and cancels {count} pending delivery', 'and cancels {count} pending deliveries')}` : '' }) + (row.format !== 'onni.json.v1' && value.format === 'onni.json.v1' ? ` ${t('After saving, use Rotate key and copy the new signing key into your receiver before testing.')}` : ''), run: () => webhookApi.update(projectId, row.id, value as UpdateWebhook) }) }
    }} />}{reconciliation}{error && <p role="alert" className="text-sm text-danger">{error}</p>}</DialogContent></Dialog>
    <Dialog open={!!confirmation} onOpenChange={open => { if (!open && !mutation.isPending) setConfirmation(undefined) }}><DialogContent onCloseAutoFocus={event => restoreFocus(event, confirmationFocusTarget.current)} className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{confirmation?.title}</DialogTitle><DialogDescription>{confirmation?.text}</DialogDescription></DialogHeader>
      {confirmation?.receiver && <ActivationSummary receiver={confirmation.receiver} projectId={projectId} />}
      {confirmation?.standard && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={standardConsent} onChange={event => setStandardConsent(event.target.checked)} />{t('I understand Standard sends task titles, questions and error text to this receiver.')}</label>}
      {confirmation?.local && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={localConsent} onChange={event => setLocalConsent(event.target.checked)} />{t('I allow delivery to this computer or private network.')}</label>}
      {reconciliation}{error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <DialogFooter><Button variant="outline" disabled={mutation.isPending} onClick={() => setConfirmation(undefined)}>{t('Cancel')}</Button><Button className={confirmation?.deletesReceiver ? 'bg-danger text-danger-foreground hover:brightness-[0.96]' : undefined} disabled={mutation.isPending || stale || !!confirmation?.standard && !standardConsent || !!confirmation?.local && !localConsent} onClick={() => confirmation && mutation.mutate(confirmation.run)}>{mutation.isPending ? t('Working…') : confirmation?.deletesReceiver ? t('Delete') : t('Confirm')}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!secret} onOpenChange={open => { if (!open) setSecret(undefined) }}><DialogContent onCloseAutoFocus={event => restoreFocus(event, secretFocusTarget.current)} className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{t('Save your signing key')}</DialogTitle><DialogDescription>{t('Copy it into your receiver now — it is shown only once. If you lose it, use Rotate key to get a new one (or Revoke old keys while a rotation is still overlapping).')}</DialogDescription></DialogHeader><code tabIndex={0} className="block select-text break-all rounded-md bg-muted p-3 font-mono text-sm">{secret}</code>{copyMessage && <p role="status" className="text-[13px] text-muted-foreground">{copyMessage}</p>}<DialogFooter><Button variant="outline" onClick={async () => { try { if (!secret || !navigator.clipboard?.writeText) throw new Error(t('Clipboard unavailable')); await navigator.clipboard.writeText(secret); setCopyMessage(t('Key copied. Store it in your receiver.')); } catch { setCopyMessage(t('Couldn’t copy — select the key and copy it manually before closing.')); } }}>{t('Copy key')}</Button><Button onClick={() => setSecret(undefined)}>{t('I’ve saved the key')}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!current} onOpenChange={open => { if (!open) navigateReceiver() }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl [overflow-wrap:anywhere]" onCloseAutoFocus={event => {
      const trigger = historyFocusTarget.current
      if (trigger?.isConnected) { event.preventDefault(); trigger.focus() }
    }}><DialogHeader className="min-w-0"><DialogTitle>{t('{name} — history', { name: current?.name ?? '' })}</DialogTitle><DialogDescription>{t('Delivery results and setting changes for this receiver.')}</DialogDescription></DialogHeader>{current && <ReceiverHistory key={current.id} projectId={projectId} receiver={current} tab={historyTab} onTabChange={tab => navigateReceiver(current.id, tab)} operation={operation} />}</DialogContent></Dialog>
  </div>
}

const chassis = 'mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-6 p-4 pb-[calc(90px+env(safe-area-inset-bottom))] md:p-6 md:pb-6'
const cancelled = (count: number, tn: (count: number, singular: string, plural: string, vars?: Record<string, string | number>) => string) => count ? ` ${tn(count, '{count} pending delivery will be cancelled; one already sending may still arrive.', '{count} pending deliveries will be cancelled; one already sending may still arrive.')}` : ''

function ActivationSummary({ receiver, projectId }: { receiver: WebhookReceiver; projectId: string }) {
  const { t } = useI18n()
  const events = receiver.preset === 'custom' ? receiver.events : receiver.preset === 'all'
    ? ['task.attention_required', 'task.review_ready', 'task.finished', 'task.failed', 'task.cancelled'] as const
    : ['task.attention_required', 'task.review_ready', 'task.finished', 'task.failed'] as const
  const term = 'text-muted-foreground'
  return <div className="flex min-w-0 flex-col gap-2 text-[13px]">
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-md border border-border bg-card p-3 [overflow-wrap:anywhere]">
      <dt className={term}>{t('Receiver')}</dt><dd>{receiver.name}</dd>
      <dt className={term}>{t('Destination')}</dt><dd>{t('Custom receiver (signed onni JSON)')}</dd>
      <dt className={term}>{t('URL')}</dt><dd>{receiver.destination}</dd>
      <dt className={term}>{t('Project')}</dt><dd>{projectId}</dd>
      <dt className={term}>{t('Message content')}</dt><dd>{t(profileLabels[receiver.profile])}</dd>
      <dt className={term}>{t('Events')}</dt><dd>{t(presetLabels[receiver.preset])}: {events.map(type => t(eventLabels[type])).join(', ')}</dd>
      <dt className={term}>{t('Tasks')}</dt><dd>{t(scopeLabels[receiver.scope])}</dd>
      <dt className={term}>{t('Waiting and review delay')}</dt><dd>{t(graceLabels[receiver.graceSeconds])}</dd>
      <dt className={term}>{t('Private network')}</dt><dd>{receiver.allowLocalNetwork ? t('Allowed') : t('Not allowed')}</dd>
      <dt className={term}>{t('Failures that resume automatically')}</dt><dd>{receiver.preset === 'all' || receiver.includeScheduledFailures ? t('Included') : t('Excluded')}</dd>
    </dl>
    {receiver.destination.startsWith('http:') && <p role="alert" className="text-warning">{t('HTTP is unencrypted — others on the network may read these messages. Use HTTPS where possible.')}</p>}
  </div>
}
