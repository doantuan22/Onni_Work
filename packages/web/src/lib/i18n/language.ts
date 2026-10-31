/**
 * Interface language (spec: English today, Vietnamese added as a UI-only layer).
 *
 * Per-browser, like the theme: no account, no workspace file, no round trip. English stays the
 * default so every existing screenshot, doc and test keeps its wording unless someone opts in.
 */
export type Language = 'en' | 'vi'

export const LANGUAGE_STORAGE_KEY = 'onni-language'

export function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'vi'
}

export function readStoredLanguage(): Language {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    return isLanguage(stored) ? stored : 'en'
  } catch {
    return 'en'
  }
}

export function writeStoredLanguage(language: Language): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  } catch {
    // A read-only or full storage still leaves the in-memory choice working for this tab.
  }
}

/** `<html lang>` drives hyphenation, screen-reader pronunciation and `:lang()` CSS. */
export function applyDocumentLanguage(language: Language): void {
  document.documentElement.lang = language
}
