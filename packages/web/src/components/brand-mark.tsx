import { cn } from '@/lib/utils'

/**
 * The onni mark and its lockup with the name.
 *
 * THE MARK is the OnniCode cat — pixel art — served as `/icon.svg` (a vector wrapper around the
 * raster, so the favicon, the server's `/onni.svg` alias and the desktop splash keep one URL).
 * It is drawn with `image-rendering: pixelated` so the pixels stay hard at 26px and on a
 * high-density display. Unlike the old geometric C it has its own colours, so it is not tinted with
 * `currentColor`; it is drawn for a dark surface and carries its own outline for a light one.
 *
 * THE LOCKUP keeps the arithmetic stated once in `BRAND_LOCKUP`: the name is lowercase, Chakra
 * Petch SemiBold (600); the mark is 1.5 × the type size tall; the gap is 0.6 × the type size.
 */

/** The navigation lockup, in px: the guideline's "znak 26 px i nazwa 19 px", gap 0.6 × 19. */
export const BRAND_LOCKUP = { mark: 26, name: 19, gap: 11.4 } as const

export function BrandMark({ height = BRAND_LOCKUP.mark, className }: { height?: number; className?: string }) {
  return (
    <img
      data-slot="brand-mark"
      src="/icon.svg"
      alt=""
      aria-hidden="true"
      draggable={false}
      height={height}
      width={height}
      className={cn('shrink-0 [image-rendering:pixelated]', className)}
    />
  )
}

/** The mark beside the name, at the navigation sizes. */
export function BrandLockup({ className, name = 'onni', logoUrl = null }: { className?: string; name?: string; logoUrl?: string | null }) {
  return (
    <span
      data-slot="brand-lockup"
      className={cn('flex min-w-0 items-center text-foreground', className)}
      style={{ gap: BRAND_LOCKUP.gap }}
    >
      {logoUrl ? <img data-slot="brand-logo" src={logoUrl} alt="" className="size-[26px] shrink-0 object-contain" /> : <BrandMark />}
      <span
        data-slot="brand-name"
        className={cn('max-w-full truncate leading-none font-semibold tracking-normal', name === 'onni' && 'lowercase')}
        style={{ fontFamily: 'var(--brand)', fontSize: BRAND_LOCKUP.name }}
      >
        {name}
      </span>
    </span>
  )
}

/** Runtime brand settings are workspace-global and cached by the shared config query. */
