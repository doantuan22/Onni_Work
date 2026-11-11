import { act, cleanup, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useSplitter, type SplitterAdapter } from './use-splitter'

afterEach(cleanup)

function adapter(overrides: Partial<SplitterAdapter> = {}): SplitterAdapter {
  return {
    unit: 'px', axis: 'vertical', getRange: () => ({ value: 300, min: 100, max: 600 }),
    step: 16, largeStep: 64, pointerToValue: (start, delta) => start + delta,
    keys: { ArrowLeft: -1, ArrowRight: 1, Home: 'min', End: 'max', Escape: 'reset' },
    onChange: vi.fn(), onCommit: vi.fn(), reset: vi.fn(), ...overrides,
  }
}

describe('useSplitter', () => {
  it('maps vertical px pointer movement, captures, focuses, and commits on pointer end', () => {
    const config = adapter()
    const { result } = renderHook(() => useSplitter(config))
    const handle = document.createElement('div')
    handle.setPointerCapture = vi.fn()
    handle.hasPointerCapture = vi.fn(() => true)
    handle.releasePointerCapture = vi.fn()
    const down = { button: 0, pointerId: 7, clientX: 40, currentTarget: handle, preventDefault: vi.fn() } as never
    act(() => result.current.onPointerDown(down))
    act(() => result.current.onPointerMove({ clientX: 65, pointerId: 7, currentTarget: handle } as never))
    act(() => result.current.onPointerUp({ pointerId: 7, currentTarget: handle } as never))
    expect(config.onChange).toHaveBeenCalledWith(325)
    expect(handle.setPointerCapture).toHaveBeenCalledWith(7)
    expect(handle.releasePointerCapture).toHaveBeenCalledWith(7)
    expect(config.onCommit).toHaveBeenCalledWith(325)
  })

  it('supports pair-relative percent bounds and Shift arrow steps', () => {
    const config = adapter({ unit: 'percent', step: 2, largeStep: 10, keys: { ArrowRight: 1 },
      getRange: () => ({ value: 33, min: 12, max: 54 }),
      pointerToValue: (start, delta, event) => start + (delta / event.currentTarget.clientWidth) * 100,
    })
    const { result } = renderHook(() => useSplitter(config))
    act(() => result.current.onKeyDown({ key: 'ArrowRight', shiftKey: true, preventDefault: vi.fn() } as never))
    expect(config.onChange).toHaveBeenCalledWith(43)
  })

  it('maps horizontal drawer drag upward to a larger height and follows dynamic bounds', () => {
    let maximum = 640
    const config = adapter({ axis: 'horizontal', getRange: () => ({ value: 320, min: 120, max: maximum }),
      pointerToValue: (start, delta) => start - delta })
    const { result, rerender } = renderHook(() => useSplitter(config))
    const handle = document.createElement('div')
    handle.setPointerCapture = vi.fn()
    handle.hasPointerCapture = vi.fn(() => false)
    act(() => result.current.onPointerDown({ button: 0, pointerId: 1, clientY: 100, currentTarget: handle, preventDefault: vi.fn() } as never))
    maximum = 400
    rerender()
    act(() => result.current.onPointerMove({ clientY: 0, pointerId: 1, currentTarget: handle } as never))
    expect(config.onChange).toHaveBeenCalledWith(400)
  })

  it('omits null aria value and resets a null tree width', () => {
    const config = adapter({ getRange: () => ({ value: null, min: 160, max: 720 }), ariaValue: true })
    const { result } = renderHook(() => useSplitter(config))
    expect(result.current.ariaValueNow).toBeUndefined()
    act(() => result.current.onDoubleClick())
    expect(config.reset).toHaveBeenCalledOnce()
  })

  it('honors Home/End direction, dynamic clamping, and optional aria value', () => {
    let value = 300
    const config = adapter({ ariaValue: false, getRange: () => ({ value, min: 120, max: 640 }),
      onChange: vi.fn((next) => { value = next as number }) })
    const { result } = renderHook(() => useSplitter(config))
    act(() => result.current.onKeyDown({ key: 'Home', preventDefault: vi.fn() } as never))
    expect(config.onChange).toHaveBeenLastCalledWith(120)
    act(() => result.current.onKeyDown({ key: 'End', preventDefault: vi.fn() } as never))
    expect(config.onChange).toHaveBeenLastCalledWith(640)
    expect(result.current.ariaValueNow).toBeUndefined()
  })
})
