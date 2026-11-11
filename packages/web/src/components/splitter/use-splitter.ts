import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react'

export type SplitterAxis = 'horizontal' | 'vertical'
export type SplitterUnit = 'px' | 'percent'

export interface SplitterAdapter {
  unit: SplitterUnit
  axis: SplitterAxis
  /** Read current value and bounds at interaction time (bounds can depend on adjacent panes). */
  getRange: () => { value: number | null; min: number; max: number }
  step: number
  largeStep?: number
  /** Convert a pointer displacement from the drag origin to an absolute value. */
  pointerToValue: (startValue: number, delta: number, event: ReactPointerEvent<HTMLElement>) => number
  /** Arrow key sign and Home/End destinations are adapter-specific. */
  keys: Partial<Record<string, number | 'min' | 'max' | 'reset'>>
  onChange: (value: number | null) => void
  onCommit?: (value: number | null) => void
  reset?: () => void
  focusOnDown?: boolean
  ariaValue?: boolean
}

/** Headless pointer and keyboard mechanics; wrappers retain their DOM, ARIA labels and persistence. */
export function useSplitter(adapter: SplitterAdapter) {
  const drag = useRef<{ coordinate: number; value: number } | null>(null)
  const range = adapter.getRange()
  const clamp = useCallback((value: number) => {
    const { min, max } = adapter.getRange()
    return Math.max(min, Math.min(max, value))
  }, [adapter])

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    const value = adapter.getRange().value
    if (value === null) return
    const coordinate = adapter.axis === 'vertical' ? event.clientX : event.clientY
    drag.current = { coordinate, value }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    if (adapter.focusOnDown !== false) event.currentTarget.focus()
  }, [adapter])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const start = drag.current
    if (!start) return
    const coordinate = adapter.axis === 'vertical' ? event.clientX : event.clientY
    adapter.onChange(clamp(adapter.pointerToValue(start.value, coordinate - start.coordinate, event)))
  }, [adapter, clamp])

  const onPointerEnd = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!drag.current) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    adapter.onCommit?.(adapter.getRange().value)
  }, [adapter])

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    const action = adapter.keys[event.key]
    if (action === undefined) return
    event.preventDefault()
    if (action === 'reset' && adapter.reset) {
      adapter.reset()
      return
    }
    const { value } = adapter.getRange()
    if (action === 'min' || action === 'max') adapter.onChange(action === 'min' ? adapter.getRange().min : adapter.getRange().max)
    else if (typeof action === 'number' && value !== null) adapter.onChange(clamp(value + action * (event.shiftKey ? adapter.largeStep ?? adapter.step : adapter.step)))
    adapter.onCommit?.(adapter.getRange().value)
  }, [adapter, clamp])

  const onDoubleClick = useCallback(() => adapter.reset?.(), [adapter])

  return {
    ariaValueNow: adapter.ariaValue === false ? undefined : range.value ?? undefined,
    onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd,
    onKeyDown, onDoubleClick,
  }
}
