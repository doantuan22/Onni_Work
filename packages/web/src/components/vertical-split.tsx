import type { ReactNode } from 'react'

import { useSplitter } from './splitter/use-splitter'

export interface VerticalSplitProps {
  ratio: number
  onRatioChange: (ratio: number) => void
  minPercent?: number
  labels?: {
    top?: string
    bottom?: string
    separator?: string
  }
  top: ReactNode
  bottom: ReactNode
}

const DEFAULT_RATIO = 58

/** Presentational two-pane stack with a controlled, accessible horizontal splitter. */
export function VerticalSplit({
  ratio,
  onRatioChange,
  minPercent = 15,
  labels,
  top,
  bottom,
}: VerticalSplitProps) {
  const minimum = Math.max(0, Math.min(50, minPercent))
  const value = Math.max(minimum, Math.min(100 - minimum, ratio))
  const splitter = useSplitter({
    unit: 'percent',
    axis: 'horizontal',
    getRange: () => ({ value, min: minimum, max: 100 - minimum }),
    step: 2,
    largeStep: 10,
    pointerToValue: (start, delta, event) => {
      const height = event.currentTarget.parentElement?.clientHeight ?? 0
      return height > 0 ? start + (delta / height) * 100 : start
    },
    keys: { ArrowUp: -1, ArrowDown: 1, Home: 'min', End: 'max' },
    onChange: (next) => { if (next !== null) onRatioChange(next) },
    reset: () => onRatioChange(DEFAULT_RATIO),
  })

  return (
    <div className="grid h-full min-h-0 w-full" style={{ gridTemplateRows: `minmax(0, ${value}fr) 4px minmax(0, ${100 - value}fr)` }}>
      <div className="min-h-0 overflow-hidden" aria-label={labels?.top}>
        {top}
      </div>
      <div
        aria-label={labels?.separator ?? 'Resize panels'}
        aria-orientation="horizontal"
        aria-valuemax={100 - minimum}
        aria-valuemin={minimum}
        aria-valuenow={value}
        className="relative z-10 h-1 cursor-row-resize touch-none before:absolute before:inset-x-0 before:top-1/2 before:h-px before:-translate-y-1/2 before:bg-border hover:before:bg-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onDoubleClick={splitter.onDoubleClick}
        onKeyDown={splitter.onKeyDown}
        onPointerCancel={splitter.onPointerCancel}
        onLostPointerCapture={splitter.onLostPointerCapture}
        onPointerDown={splitter.onPointerDown}
        onPointerMove={splitter.onPointerMove}
        onPointerUp={splitter.onPointerUp}
        role="separator"
        tabIndex={0}
      />
      <div className="min-h-0 overflow-hidden" aria-label={labels?.bottom}>
        {bottom}
      </div>
    </div>
  )
}
