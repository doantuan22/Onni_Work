import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * The app's one `<select>`: a real native element (keyboard, mobile pickers, form semantics and the
 * tests' `change` events all keep working) dressed in the theme — card surface, input border, rounded,
 * hover/focus ring, our own chevron. The opened list follows the theme's `color-scheme` and the
 * `option` colours below, so it is no longer the browser's white default on a dark UI.
 *
 * Callers keep passing sizing classes (`w-28`, `max-w-xs`): `cn` merges them over the base.
 */
const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%239ca3af' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m4 6 4 4 4-4'/%3E%3C/svg%3E\")"

const NativeSelect = React.forwardRef<HTMLSelectElement, React.ComponentProps<'select'>>(function NativeSelect(
  { className, style, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      data-slot="native-select"
      style={{ backgroundImage: CHEVRON, ...style }}
      className={cn(
        'appearance-none rounded-md border border-input bg-card bg-[length:1rem] bg-[position:right_0.5rem_center] bg-no-repeat py-1.5 pr-8 pl-3 text-sm text-foreground shadow-xs transition-colors outline-none',
        'hover:border-ring/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'disabled:cursor-not-allowed disabled:opacity-50 [&>optgroup]:bg-card [&>option]:bg-card [&>option]:text-foreground',
        className,
      )}
      {...props}
    />
  )
})

export { NativeSelect }
