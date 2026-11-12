import type { Language } from './language'

/** The Vietnamese layer, empty until its chunk arrives (see `loadViMessages`). English text is the
 *  key: a missing entry falls back to English instead of showing a key, and English mode never
 *  needs a dictionary at all. */
let viMessages: Readonly<Record<string, string>> = {}

/** Tests seed the dictionary directly; the app goes through `loadViMessages`. */
export function setViMessages(messages: Readonly<Record<string, string>>): void {
  viMessages = messages
}

let pending: Promise<void> | undefined

/** Fetch the dictionary chunk on demand. An English cockpit never calls this, so the ~3 200-entry
 *  VI bundle stays out of the entry graph; every later call reuses the same import. */
export function loadViMessages(): Promise<void> {
  pending ??= import('./vi-messages').then((module) => setViMessages(module.viMessages))
  return pending
}

/** Replace `{name}` placeholders. Unknown placeholders are left as written, never blanked. */
export function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  )
}

/** The one translation rule: English returns the text itself; Vietnamese looks it up, then falls
 *  back to English. Placeholders are substituted AFTER the lookup, so a translated entry keeps
 *  the same `{name}` tokens as its key. */
export function translate(language: Language, text: string, vars?: Record<string, string | number>): string {
  const chosen = language === 'vi' ? (viMessages[text] ?? text) : text
  return interpolate(chosen, vars)
}
