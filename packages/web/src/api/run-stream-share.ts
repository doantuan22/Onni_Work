import { apiPath, getApiScope } from '@onni/api-client'
import type { RunEvent, RunRecord } from '@onni/api-client'

/**
 * Both wire event names emitted by the per-run events endpoint.
 */
export const RUN_EVENT_NAMES = ['run-event', 'ui-event'] as const

const CLOSED = 2 // EventSource.CLOSED
const REOPEN_DELAY_MS = 1_500
const STALE_MS = 40_000
const LIVENESS_CHECK_MS = 10_000

export function parseRunRecordFrame(data: string): RunRecord | null {
  let payload: unknown
  try {
    payload = JSON.parse(data)
  } catch {
    return null
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null
  const { id, steps } = payload as { id?: unknown; steps?: unknown }
  return typeof id === 'string' && id !== '' && Array.isArray(steps) ? (payload as RunRecord) : null
}

export function parseRunEvent(data: string): RunEvent | null {
  let payload: unknown
  try {
    payload = JSON.parse(data)
  } catch {
    return null
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null
  const { seq, type } = payload as { seq?: unknown; type?: unknown }
  if (typeof seq !== 'number' || typeof type !== 'string' || type === '') return null
  return payload as RunEvent
}

export interface RunStreamSubscriber {
  onFrame?: (event: MessageEvent<string>, name: string) => void
  onPing?: (event: Event) => void
  onRun?: (run: RunRecord, event: MessageEvent<string>) => void
  onError?: (event: Event) => void
  cursor?: string | (() => string | undefined)
  afterSeq?: number
}

export interface RunStreamSubscription {
  unsubscribe: () => void
  updateWatermark: (afterSeq: number, cursor?: string) => void
}

interface SharedStreamState {
  key: string
  scope: string | null | undefined
  runId: string
  subscribers: Set<RunStreamSubscriber>
  source: EventSource | null
  streamToken: number
  reopenTimer?: ReturnType<typeof setTimeout>
  livenessTimer?: ReturnType<typeof setInterval>
  lastFrameAt: number
  maxSeq: number
  initialAfterSeq: number
  cursor?: string
  disposed: boolean
  onVisibilityChange?: () => void
  onPageHide?: () => void
  onPageShow?: (event: PageTransitionEvent) => void
}

const sharedStreams = new Map<string, SharedStreamState>()

export function getStreamKey(scope: string | null | undefined, runId: string): string {
  return `${scope ?? ''}\0${runId}`
}

export function buildRunEventsPath(scope: string | null | undefined, runId: string, query = ''): string {
  const activeScope = getApiScope()
  if (scope === activeScope || scope === undefined) {
    return apiPath(`/runs/${encodeURIComponent(runId)}/events${query}`)
  }
  if (scope) {
    return `/api/v1/p/${encodeURIComponent(scope)}/runs/${encodeURIComponent(runId)}/events${query}`
  }
  return `/api/v1/runs/${encodeURIComponent(runId)}/events${query}`
}

function reopenLater(stream: SharedStreamState): void {
  if (stream.disposed || stream.reopenTimer !== undefined) return
  stream.reopenTimer = setTimeout(() => {
    stream.reopenTimer = undefined
    if (!stream.disposed) openSource(stream)
  }, REOPEN_DELAY_MS)
}

function closeSource(stream: SharedStreamState): void {
  stream.streamToken += 1
  const current = stream.source
  if (!current) return
  current.close()
  stream.source = null
}

function openSource(stream: SharedStreamState): void {
  closeSource(stream)
  const token = stream.streamToken
  const Source = globalThis.EventSource
  if (typeof Source !== 'function') return

  stream.lastFrameAt = Date.now()

  const params = new URLSearchParams()
  const liveCursor = [...stream.subscribers]
    .map((subscriber) => typeof subscriber.cursor === 'function' ? subscriber.cursor() : subscriber.cursor)
    .find((cursor) => cursor !== undefined)
  const cursor = liveCursor ?? stream.cursor
  if (cursor !== undefined) params.set('cursor', cursor)
  const highWater = Math.max(stream.initialAfterSeq, stream.maxSeq)
  if (cursor !== undefined || highWater > 0) params.set('afterSeq', String(highWater))
  const query = params.size > 0 ? `?${params.toString()}` : ''

  const url = buildRunEventsPath(stream.scope, stream.runId, query)
  const current = new Source(url, { withCredentials: true })
  stream.source = current

  const frameListener = (event: Event): void => {
    if (stream.disposed || token !== stream.streamToken) return
    stream.lastFrameAt = Date.now()
    const msg = event as MessageEvent<string>
    const parsed = parseRunEvent(msg.data)
    if (parsed) {
      stream.maxSeq = Math.max(stream.maxSeq, parsed.seq)
    }
    for (const sub of [...stream.subscribers]) {
      sub.onFrame?.(msg, event.type)
    }
  }

  for (const name of RUN_EVENT_NAMES) {
    current.addEventListener(name, frameListener)
  }

  const pingListener = (event: Event): void => {
    if (stream.disposed || token !== stream.streamToken) return
    stream.lastFrameAt = Date.now()
    for (const sub of [...stream.subscribers]) {
      sub.onPing?.(event)
    }
  }
  current.addEventListener('ping', pingListener)

  const runListener = (event: Event): void => {
    if (stream.disposed || token !== stream.streamToken) return
    stream.lastFrameAt = Date.now()
    const msg = event as MessageEvent<string>
    const run = parseRunRecordFrame(msg.data)
    if (!run) return
    for (const sub of [...stream.subscribers]) {
      sub.onRun?.(run, msg)
    }
  }
  current.addEventListener('run', runListener)

  const errorListener = (event: Event): void => {
    if (stream.disposed || token !== stream.streamToken) return
    for (const sub of [...stream.subscribers]) {
      sub.onError?.(event)
    }
    if (current.readyState === CLOSED) {
      reopenLater(stream)
    }
  }
  current.addEventListener('error', errorListener)
}

function destroyStream(stream: SharedStreamState): void {
  stream.disposed = true
  clearTimeout(stream.reopenTimer)
  stream.reopenTimer = undefined
  clearInterval(stream.livenessTimer)
  stream.livenessTimer = undefined

  if (typeof document !== 'undefined' && stream.onVisibilityChange) {
    document.removeEventListener('visibilitychange', stream.onVisibilityChange)
  }
  if (typeof window !== 'undefined') {
    if (stream.onPageHide) window.removeEventListener('pagehide', stream.onPageHide)
    if (stream.onPageShow) window.removeEventListener('pageshow', stream.onPageShow)
  }

  closeSource(stream)
  sharedStreams.delete(stream.key)
}

/**
 * Ref-counted per-(project,run) stream share.
 * Multiple consumers subscribing to the same run in the same project share one EventSource.
 * The stream automatically closes when the last subscriber unmounts or disables.
 */
export function subscribeRunStream(
  runId: string,
  subscriber: RunStreamSubscriber,
  scope: string | null | undefined = getApiScope(),
): RunStreamSubscription {
  const key = getStreamKey(scope, runId)
  let stream = sharedStreams.get(key)

  if (!stream) {
    stream = {
      key,
      scope,
      runId,
      subscribers: new Set(),
      source: null,
      streamToken: 0,
      lastFrameAt: Date.now(),
      maxSeq: 0,
      initialAfterSeq: subscriber.afterSeq ?? 0,
      cursor: typeof subscriber.cursor === 'string' ? subscriber.cursor : subscriber.cursor?.(),
      disposed: false,
    }
    sharedStreams.set(key, stream)

    const onVisibilityChange = (): void => {
      if (document.visibilityState !== 'visible') return
      if (!stream!.source || stream!.source.readyState === CLOSED) {
        clearTimeout(stream!.reopenTimer)
        stream!.reopenTimer = undefined
        openSource(stream!)
      }
    }
    const onPageHide = (): void => {
      clearTimeout(stream!.reopenTimer)
      stream!.reopenTimer = undefined
      closeSource(stream!)
    }
    const onPageShow = (event: PageTransitionEvent): void => {
      if (event.persisted) openSource(stream!)
    }

    stream.onVisibilityChange = onVisibilityChange
    stream.onPageHide = onPageHide
    stream.onPageShow = onPageShow

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange)
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', onPageHide)
      window.addEventListener('pageshow', onPageShow)
    }

    stream.livenessTimer = setInterval(() => {
      if (stream!.disposed) return
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      if (Date.now() - stream!.lastFrameAt <= STALE_MS) return
      clearTimeout(stream!.reopenTimer)
      stream!.reopenTimer = undefined
      openSource(stream!)
    }, LIVENESS_CHECK_MS)

  } else {
    if (subscriber.afterSeq !== undefined && subscriber.afterSeq > 0) {
      stream.initialAfterSeq = Math.max(stream.initialAfterSeq, subscriber.afterSeq)
    }
    if (typeof subscriber.cursor === 'string' && stream.cursor === undefined) {
      stream.cursor = subscriber.cursor
    }
  }

  stream.subscribers.add(subscriber)
  if (!stream.source) {
    clearTimeout(stream.reopenTimer)
    stream.reopenTimer = undefined
    openSource(stream)
  }

  let unsubscribed = false
  return {
    unsubscribe: () => {
      if (unsubscribed) return
      unsubscribed = true
      stream!.subscribers.delete(subscriber)
      if (stream!.subscribers.size === 0) {
        destroyStream(stream!)
      }
    },
    updateWatermark: (afterSeq: number, cursor?: string) => {
      if (unsubscribed) return
      stream!.initialAfterSeq = Math.max(stream!.initialAfterSeq, afterSeq)
      if (cursor !== undefined) stream!.cursor = cursor
    },
  }
}

export function getSharedStreamSubscriberCount(
  runId: string,
  scope: string | null | undefined = getApiScope(),
): number {
  const key = getStreamKey(scope, runId)
  return sharedStreams.get(key)?.subscribers.size ?? 0
}

export function hasSharedStream(runId: string, scope: string | null | undefined = getApiScope()): boolean {
  const key = getStreamKey(scope, runId)
  return sharedStreams.has(key)
}

export function resetSharedRunStreamsForTests(): void {
  for (const stream of [...sharedStreams.values()]) {
    destroyStream(stream)
  }
  sharedStreams.clear()
}
