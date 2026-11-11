/* Appearance preferences (density + width): the pure half, mirroring `lib/theme.ts`.
 *
 * The authoritative store is the server's `ui-state.json` (`GET/PUT /api/ui-state`, additive
 * `appearance` key) so the choice follows the repo, not the browser. localStorage keeps a
 * per-browser MIRROR of the last-applied values purely so the pre-paint script in
 * `packages/web/index.html` can stamp its historical `data-accent`/`data-density`/`data-width` values before first paint — the same
 * no-flash trick the theme uses. When the server answers, its value wins and the mirror is
 * rewritten.
 *
 * IMPORTANT: `packages/web/index.html`'s inline script duplicates `applyAppearance`'s stamping in
 * vanilla JS on purpose — it must run before the bundle exists. Change one, change the other.
 */

export const ACCENT_STORAGE_KEY = 'onni-accent'
export const DENSITY_STORAGE_KEY = 'onni-density'
export const WIDTH_STORAGE_KEY = 'onni-width'

/**
 * Accent remains in persisted appearance records solely for backwards compatibility. The visual
 * system no longer offers a choice: old values normalize to the one fixed violet accent.
 */
export type Accent = 'violet'

/** Density shrinks Tailwind v4's one spacing token (`--spacing`, default 4px/unit) so every
 *  padding/gap/control height tightens while type stays full-size: `compact` → 3.5px (~12%),
 *  `ultra` ("Compact for real") → 3px (~25%). See the `:root[data-density]` blocks in index.css. */
export type Density = 'comfortable' | 'compact' | 'ultra'

/** Reading width flips the shared `--measure` token (index.css `:root[data-width="narrow"]`):
 *  `wide` is the legacy spelling for the zero-config full-width mode; `narrow` restores the old
 *  820px reading column. Used by task and skill detail views; type size and spacing stay untouched. */
export type Width = 'narrow' | 'wide'

export const DEFAULT_ACCENT: Accent = 'violet'
export const DEFAULT_DENSITY: Density = 'comfortable'
export const DEFAULT_WIDTH: Width = 'wide'

export interface Appearance {
  accent: Accent
  density: Density
  width: Width
}

/** Coerce historic accent records to the fixed violet accent without rejecting old ui-state. */
export function normalizeAccent(raw: unknown): Accent {
  void raw
  return DEFAULT_ACCENT
}

export function normalizeDensity(raw: unknown): Density {
  return raw === 'comfortable' || raw === 'compact' || raw === 'ultra' ? raw : DEFAULT_DENSITY
}

export function normalizeWidth(raw: unknown): Width {
  return raw === 'narrow' || raw === 'wide' ? raw : DEFAULT_WIDTH
}

/** The `appearance` key of a ui-state payload, defaults filled in. Defensive about shape —
 *  the server passes unknown keys through, so this can meet anything. */
export function normalizeAppearance(raw: unknown): Appearance {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    accent: normalizeAccent(obj.accent),
    density: normalizeDensity(obj.density),
    width: normalizeWidth(obj.width),
  }
}

/** The mirrored preference, or the default when storage is empty/unreadable (private mode). */
export function readStoredAppearance(): Appearance {
  try {
    return {
      accent: normalizeAccent(localStorage.getItem(ACCENT_STORAGE_KEY)),
      density: normalizeDensity(localStorage.getItem(DENSITY_STORAGE_KEY)),
      width: normalizeWidth(localStorage.getItem(WIDTH_STORAGE_KEY)),
    }
  } catch {
    return { accent: DEFAULT_ACCENT, density: DEFAULT_DENSITY, width: DEFAULT_WIDTH }
  }
}

export function writeStoredAppearance(appearance: Appearance): void {
  try {
    localStorage.setItem(ACCENT_STORAGE_KEY, appearance.accent)
    localStorage.setItem(DENSITY_STORAGE_KEY, appearance.density)
    localStorage.setItem(WIDTH_STORAGE_KEY, appearance.width)
  } catch {
    // Private mode / storage disabled — the appearance still applies for this page.
  }
}

/**
 * The fixed accent never needs a DOM attribute. Removing a historical stamp makes an old mirror
 * converge after startup while the token sheet stays violet even before that effect runs.
 */
export function applyAppearance(root: HTMLElement, appearance: Appearance): void {
  void appearance.accent
  delete root.dataset.accent
  if (appearance.density === DEFAULT_DENSITY) delete root.dataset.density
  else root.dataset.density = appearance.density
  if (appearance.width === DEFAULT_WIDTH) delete root.dataset.width
  else root.dataset.width = appearance.width
}
