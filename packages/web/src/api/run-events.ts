import { useEffect, useRef, useState } from 'react'

import { getApiScope } from '@onni/api-client'
import type { RunEvent, RunRecord } from '@onni/api-client'
import {
  parseRunEvent,
  RUN_EVENT_NAMES,
  subscribeRunStream,
  type RunStreamSubscription,
} from './run-stream-share'

export { parseRunEvent, RUN_EVENT_NAMES }

/**
 * EventSource delivers token/delta frames as separate tasks. Rendering once per frame makes a
 * transcript rebuild the whole visible thread at agent-event rate, so publish at most one batch
 * every 50 ms. This is below a normal typing frame while bounding React work during fast streams.
 */
export const RUN_EVENT_BATCH_MS = 50
const COMPACTION_RETRY_BASE_MS = 1_000
const COMPACTION_RETRY_MAX_MS = 60_000
const MAX_SEEN_SEQS = 10_000

function rememberSeq(seqs: Set<number>, seq: number): void {
  seqs.add(seq)
  if (seqs.size <= MAX_SEEN_SEQS) return
  const oldest = seqs.values().next().value
  if (typeof oldest === 'number') seqs.delete(oldest)
}

export type RunEventCompaction = readonly number[]

export function runItemKey(stepId: unknown, itemId: string): string {
  return typeof stepId === 'string' ? `${stepId}:${itemId}` : itemId
}

export function liveItemKey(event: RunEvent): string | undefined {
  const itemId = event.type === 'item.delta'
    ? event.itemId
    : typeof event.item === 'object' && event.item !== null && !Array.isArray(event.item)
      ? (event.item as { id?: unknown }).id
      : undefined
  return typeof itemId === 'string' && itemId !== ''
    ? runItemKey(event.stepId, itemId)
    : undefined
}

/** Keep optimized transcript state lossless without retaining one row per streamed chunk. */
function coalesceLiveDeltas(events: readonly RunEvent[]): RunEvent[] {
  const output: RunEvent[] = []
  const deltaIndexes = new Map<string, number>()
  for (const event of events) {
    const itemKey = liveItemKey(event)
    if (itemKey !== undefined && event.type !== 'item.delta') {
      for (const field of ['text', 'reasoning', 'output']) deltaIndexes.delete(`${itemKey}:${field}`)
    }
    if (
      event.type === 'item.delta' &&
      itemKey !== undefined &&
      (event.field === 'text' || event.field === 'reasoning' || event.field === 'output') &&
      typeof event.delta === 'string'
    ) {
      const key = `${itemKey}:${event.field}`
      const previousIndex = deltaIndexes.get(key)
      if (previousIndex !== undefined) {
        const previous = output[previousIndex]!
        // Keep the newest constituent seq. If a durable snapshot covers only the first chunk,
        // filtering by that old seq must not evict the merged event and lose the later text.
        const merged = {
          ...previous,
          seq: event.seq,
          ts: event.ts,
          delta: `${previous.delta as string}${event.delta}`,
        }
        if (previousIndex === output.length - 1) {
          output[previousIndex] = merged
        } else {
          output.splice(previousIndex, 1)
          for (const [trackedKey, index] of deltaIndexes) {
            if (index > previousIndex) deltaIndexes.set(trackedKey, index - 1)
          }
          deltaIndexes.set(key, output.length)
          output.push(merged)
        }
        continue
      }
      deltaIndexes.set(key, output.length)
    }
    output.push(event)
  }
  return output
}

/**
 * Subscribe to one run's event stream and accumulate the ordered list. The optimized history
 * caller losslessly coalesces same-item delta chunks; the fallback keeps raw frames.
 *
 * The list resets when `runId` changes (a different run's events are not "earlier state" of
 * this one) and the socket closes when the last subscriber unmounts. Underneath, a ref-counted
 * per-(project,run) stream share deduplicates active consumers.
 */
export interface RunEventStreamOptions {
  cursor?: string
  afterSeq?: number
  /** Request another compaction when the live snapshot exceeds this size; never truncates it. */
  compactWhenOver?: number
  /** Ask the history owner to fold the live prefix into a fresh persisted tail page. */
  compactAt?: number
  /** Return exactly the live sequence numbers now covered by durable history. */
  onCompact?: (events: readonly RunEvent[]) => RunEventCompaction | false | Promise<RunEventCompaction | false>
  /** The whole run record, sent on connect and on every change of this run. Delivered on the same
   *  `RUN_EVENT_BATCH_MS` flush as the transcript frames, so a burst of changes costs one call
   *  with the latest record. */
  onRun?: (run: RunRecord) => void
  /** When false, releases stream subscription (e.g. hidden pane). Defaults to true. */
  enabled?: boolean
}

export function useRunEvents(runId: string | undefined, options: RunEventStreamOptions = {}): RunEvent[] {
  const [events, setEvents] = useState<RunEvent[]>([])
  const scope = getApiScope()
  const enabled = options.enabled ?? true
  const optionsRef = useRef(options)
  optionsRef.current = options
  const maxSeqRef = useRef(0)
  const pageHighWaterRef = useRef(0)
  const initialPageHighWaterRef = useRef(0)
  const allowLateFramesRef = useRef(false)
  const seenSeqsRef = useRef(new Set<number>())
  const compactCommittedRef = useRef<((events: readonly RunEvent[]) => void) | undefined>(undefined)
  const subscriptionRef = useRef<RunStreamSubscription | null>(null)

  useEffect(() => {
    const { afterSeq = 0 } = optionsRef.current
    maxSeqRef.current = 0
    pageHighWaterRef.current = afterSeq
    initialPageHighWaterRef.current = afterSeq
    allowLateFramesRef.current = false
    seenSeqsRef.current.clear()
    setEvents([])

    if (!runId || !enabled) {
      subscriptionRef.current = null
      return
    }

    let disposed = false
    let compactionRequested = false
    let compactionFailures = 0
    let nextCompactionAt = 0
    let eventsSinceCompaction = 0
    let pending: RunEvent[] = []
    let pendingRun: RunRecord | undefined
    let flushTimer: ReturnType<typeof setTimeout> | undefined

    const markCompactionFailed = (): void => {
      compactionRequested = false
      compactionFailures = Math.min(compactionFailures + 1, 6)
      nextCompactionAt = Date.now() + Math.min(
        COMPACTION_RETRY_MAX_MS,
        COMPACTION_RETRY_BASE_MS * 2 ** (compactionFailures - 1),
      )
    }

    const requestCompaction = (snapshot: readonly RunEvent[]): void => {
      const options = optionsRef.current
      if (options.onCompact === undefined) return
      if (
        (options.compactAt === undefined || eventsSinceCompaction < options.compactAt)
        && (options.compactWhenOver === undefined || snapshot.length <= options.compactWhenOver)
      ) return
      if (Date.now() < nextCompactionAt) return
      compactionRequested = true
      const requestedAt = eventsSinceCompaction
      void Promise.resolve()
        .then(() => {
          if (disposed) return undefined
          return optionsRef.current.onCompact?.(snapshot)
        })
        .then(
          (coveredSeqs) => {
            if (disposed) return
            if (!Array.isArray(coveredSeqs) || coveredSeqs.length === 0) {
              markCompactionFailed()
              return
            }
            compactionFailures = 0
            nextCompactionAt = 0
            eventsSinceCompaction = Math.max(0, eventsSinceCompaction - requestedAt)
            compactionRequested = false
            const covered = new Set(coveredSeqs)
            if (covered.size === 0) return
            setEvents((current) => current.filter(({ seq }) => !covered.has(seq)))
          },
          () => {
            if (!disposed) markCompactionFailed()
          },
        )
    }

    const flush = (): void => {
      flushTimer = undefined
      if (pendingRun !== undefined) {
        const run = pendingRun
        pendingRun = undefined
        if (!disposed) optionsRef.current.onRun?.(run)
      }
      if (pending.length === 0) return
      const batch = pending
      pending = []
      setEvents((current) => {
        const options = optionsRef.current
        return options.compactAt !== undefined || options.onCompact !== undefined
          ? coalesceLiveDeltas([...current, ...batch])
          : [...current, ...batch]
      })
    }

    const scheduleFlush = (): void => {
      if (flushTimer === undefined) flushTimer = setTimeout(flush, RUN_EVENT_BATCH_MS)
    }

    const onFrame = (event: MessageEvent<string>): void => {
      if (disposed) return
      const parsed = parseRunEvent(event.data)
      if (!parsed || seenSeqsRef.current.has(parsed.seq)) return
      if (
        parsed.seq <= maxSeqRef.current
        && (!allowLateFramesRef.current || parsed.seq <= initialPageHighWaterRef.current)
      ) return
      rememberSeq(seenSeqsRef.current, parsed.seq)
      maxSeqRef.current = Math.max(maxSeqRef.current, parsed.seq)
      eventsSinceCompaction += 1
      pending.push(parsed)
      scheduleFlush()
    }

    const onRun = (run: RunRecord): void => {
      if (disposed) return
      pendingRun = run
      scheduleFlush()
    }

    const subscription = subscribeRunStream(
      runId,
      {
        cursor: optionsRef.current.cursor,
        afterSeq: pageHighWaterRef.current,
        onFrame,
        onRun,
      },
      scope,
    )
    subscriptionRef.current = subscription
    compactCommittedRef.current = requestCompaction

    return () => {
      disposed = true
      clearTimeout(flushTimer)
      flushTimer = undefined
      pending = []
      pendingRun = undefined
      if (compactCommittedRef.current === requestCompaction) compactCommittedRef.current = undefined
      subscriptionRef.current = null
      subscription.unsubscribe()
    }
  }, [runId, scope, enabled])

  useEffect(() => {
    if (events.length === 0) return
    compactCommittedRef.current?.(events)
  }, [events])

  const afterSeq = options.afterSeq ?? 0
  useEffect(() => {
    if (!runId || !enabled) return
    if (afterSeq > pageHighWaterRef.current) allowLateFramesRef.current = true
    pageHighWaterRef.current = Math.max(pageHighWaterRef.current, afterSeq)
    subscriptionRef.current?.updateWatermark(afterSeq)
  }, [afterSeq, runId, enabled])

  return events
}
