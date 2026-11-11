import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setApiScope } from '@onni/api-client'
import type { RunRecord } from '@onni/api-client'
import { RUN_EVENT_BATCH_MS, useRunEvents } from './run-events'
import {
  getSharedStreamSubscriberCount,
  hasSharedStream,
  resetSharedRunStreamsForTests,
  subscribeRunStream,
} from './run-stream-share'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  static get last(): FakeEventSource {
    const instance = FakeEventSource.instances.at(-1)
    if (!instance) throw new Error('no EventSource was constructed')
    return instance
  }

  readyState = 0
  closeCount = 0
  private readonly listeners = new Map<string, Set<(event: Event) => void>>()

  constructor(readonly url: string, readonly init?: EventSourceInit) {
    FakeEventSource.instances.push(this)
  }

  addEventListener(name: string, fn: (event: Event) => void): void {
    const set = this.listeners.get(name) ?? new Set()
    set.add(fn)
    this.listeners.set(name, set)
  }

  removeEventListener(name: string, fn: (event: Event) => void): void {
    this.listeners.get(name)?.delete(fn)
  }

  close(): void {
    this.readyState = 2
    this.closeCount += 1
  }

  emit(name: string, data: string): void {
    act(() => {
      for (const fn of this.listeners.get(name) ?? []) fn(new MessageEvent(name, { data }))
    })
  }
}

const line = (seq: number, type: string, rest: Record<string, unknown> = {}) =>
  JSON.stringify({ seq, ts: '2026-07-14T12:00:00.000Z', type, ...rest })

beforeEach(() => {
  FakeEventSource.instances = []
  resetSharedRunStreamsForTests()
  vi.useFakeTimers()
  vi.stubGlobal('EventSource', FakeEventSource)
})

afterEach(() => {
  cleanup()
  resetSharedRunStreamsForTests()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function flushEvents(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(RUN_EVENT_BATCH_MS)
  })
}

describe('subscribeRunStream (stream share manager)', () => {
  it('two consumers -> one EventSource', () => {
    const received1: string[] = []
    const received2: string[] = []
    const sub1 = subscribeRunStream('run-1', {
      onFrame: (ev) => received1.push(ev.data),
    })
    const sub2 = subscribeRunStream('run-1', {
      onFrame: (ev) => received2.push(ev.data),
    })

    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.last.url).toBe('/api/v1/runs/run-1/events')
    expect(getSharedStreamSubscriberCount('run-1')).toBe(2)

    FakeEventSource.last.emit('run-event', line(1, 'stdout', { text: 'hello' }))
    expect(received1).toHaveLength(1)
    expect(received2).toHaveLength(1)

    sub1.unsubscribe()
    sub2.unsubscribe()
  })

  it('unmount of one keeps stream', () => {
    const received1: string[] = []
    const received2: string[] = []
    const sub1 = subscribeRunStream('run-1', {
      onFrame: (ev) => received1.push(ev.data),
    })
    const sub2 = subscribeRunStream('run-1', {
      onFrame: (ev) => received2.push(ev.data),
    })

    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.last.closeCount).toBe(0)

    sub1.unsubscribe()
    expect(FakeEventSource.last.closeCount).toBe(0)
    expect(FakeEventSource.last.readyState).toBe(0)
    expect(getSharedStreamSubscriberCount('run-1')).toBe(1)

    FakeEventSource.last.emit('run-event', line(2, 'stdout', { text: 'still alive' }))
    expect(received1).toHaveLength(0)
    expect(received2).toHaveLength(1)

    sub2.unsubscribe()
    expect(FakeEventSource.last.closeCount).toBe(1)
    expect(FakeEventSource.last.readyState).toBe(2)
  })

  it('enabled=false closes (when last consumer releases reference)', () => {
    const sub1 = subscribeRunStream('run-1', {})
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(hasSharedStream('run-1')).toBe(true)

    sub1.unsubscribe()
    expect(FakeEventSource.last.closeCount).toBe(1)
    expect(hasSharedStream('run-1')).toBe(false)
  })

  it('reopen resumes', () => {
    const sub1 = subscribeRunStream('run-1', {})
    expect(FakeEventSource.instances).toHaveLength(1)
    sub1.unsubscribe()
    expect(FakeEventSource.last.closeCount).toBe(1)

    const sub2 = subscribeRunStream('run-1', {})
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(FakeEventSource.last.closeCount).toBe(0)
    sub2.unsubscribe()
  })

  it('distributes all frame types: run, ui-event, run-event, ping', () => {
    const events: string[] = []
    const runs: RunRecord[] = []
    let pings = 0

    const sub = subscribeRunStream('run-1', {
      onFrame: (ev, name) => events.push(`${name}:${ev.data}`),
      onRun: (run) => runs.push(run),
      onPing: () => { pings += 1 },
    })

    const source = FakeEventSource.last
    source.emit('run-event', line(1, 'stdout', { text: 'v1' }))
    source.emit('ui-event', line(2, 'item.started', { item: { id: 'i1' } }))
    source.emit('ping', '')
    source.emit('run', JSON.stringify({ id: 'run-1', steps: [], status: 'running' }))

    expect(events).toHaveLength(2)
    expect(events[0]).toContain('run-event')
    expect(events[1]).toContain('ui-event')
    expect(pings).toBe(1)
    expect(runs).toHaveLength(1)
    expect(runs[0]?.status).toBe('running')

    sub.unsubscribe()
  })

  it('isolates stream shares across different projects for the same runId', () => {
    const subA = subscribeRunStream('run-1', {}, 'proj-a')
    const subB = subscribeRunStream('run-1', {}, 'proj-b')

    expect(FakeEventSource.instances).toHaveLength(2)
    expect(FakeEventSource.instances[0]?.url).toBe('/api/v1/p/proj-a/runs/run-1/events')
    expect(FakeEventSource.instances[1]?.url).toBe('/api/v1/p/proj-b/runs/run-1/events')

    subA.unsubscribe()
    expect(FakeEventSource.instances[0]?.closeCount).toBe(1)
    expect(FakeEventSource.instances[1]?.closeCount).toBe(0)

    subB.unsubscribe()
    expect(FakeEventSource.instances[1]?.closeCount).toBe(1)
  })
})

describe('useRunEvents — shared stream deduplication', () => {
  it('two consumers of the same run share ONE EventSource and each receives all frames', async () => {
    const hook1 = renderHook(() => useRunEvents('run-1'))
    const hook2 = renderHook(() => useRunEvents('run-1'))

    expect(FakeEventSource.instances).toHaveLength(1)
    const source = FakeEventSource.last

    source.emit('run-event', line(1, 'stdout', { text: 'shared output' }))
    await flushEvents()

    expect(hook1.result.current.map((e) => e.seq)).toEqual([1])
    expect(hook2.result.current.map((e) => e.seq)).toEqual([1])
  })

  it('unmount of one keeps stream and remaining consumer receives subsequent frames', async () => {
    const hook1 = renderHook(() => useRunEvents('run-1'))
    const hook2 = renderHook(() => useRunEvents('run-1'))

    expect(FakeEventSource.instances).toHaveLength(1)
    const source = FakeEventSource.last

    source.emit('run-event', line(1, 'stdout', { text: 'first' }))
    await flushEvents()

    hook1.unmount()
    expect(source.closeCount).toBe(0)
    expect(source.readyState).toBe(0)

    source.emit('run-event', line(2, 'stdout', { text: 'second' }))
    await flushEvents()

    expect(hook2.result.current.map((e) => e.seq)).toEqual([1, 2])

    hook2.unmount()
    expect(source.closeCount).toBe(1)
    expect(source.readyState).toBe(2)
  })

  it('enabled=false releases reference and closes stream if last', async () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useRunEvents('run-1', { enabled }),
      { initialProps: { enabled: true } },
    )

    expect(FakeEventSource.instances).toHaveLength(1)
    const first = FakeEventSource.last
    expect(first.closeCount).toBe(0)

    rerender({ enabled: false })
    expect(first.closeCount).toBe(1)
    expect(first.readyState).toBe(2)

    rerender({ enabled: true })
    expect(FakeEventSource.instances).toHaveLength(2)
    const second = FakeEventSource.last
    expect(second.closeCount).toBe(0)

    second.emit('run-event', line(1, 'stdout', { text: 'resumed' }))
    await flushEvents()
    expect(result.current.map((e) => e.seq)).toEqual([1])
  })

  it('two consumers with one disabled only counts the active one', async () => {
    const activeHook = renderHook(() => useRunEvents('run-1', { enabled: true }))
    const disabledHook = renderHook(() => useRunEvents('run-1', { enabled: false }))

    expect(FakeEventSource.instances).toHaveLength(1)
    expect(getSharedStreamSubscriberCount('run-1')).toBe(1)

    activeHook.unmount()
    expect(FakeEventSource.last.closeCount).toBe(1)

    disabledHook.unmount()
    expect(FakeEventSource.instances).toHaveLength(1)
  })
})
