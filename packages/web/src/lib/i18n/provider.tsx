import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'

import { applyDocumentLanguage, readStoredLanguage, writeStoredLanguage, type Language } from './language'
import { loadViMessages, translate } from './messages'

type Vars = Record<string, string | number>

export type Translate = (text: string, vars?: Vars) => string

export interface I18nValue {
  language: Language
  setLanguage: (language: Language) => void
  /** Translate one English string. In English it returns the string itself, interpolated. */
  t: Translate
  /** Pick `singular` for one item and `plural` otherwise. `count` is available as `{count}`. */
  tn: (count: number, singular: string, plural: string, vars?: Vars) => string
}

/**
 * Tests render pieces of the cockpit without `App`, so a missing provider must keep today's
 * English UI rather than throw. This identity value is also what `en` resolves to at runtime.
 */
const englishIdentity: I18nValue = {
  language: 'en',
  setLanguage: () => {},
  t: (text, vars) => translate('en', text, vars),
  tn: (count, singular, plural, vars) =>
    translate('en', count === 1 ? singular : plural, { ...vars, count }),
}

const I18nContext = createContext<I18nValue>(englishIdentity)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => readStoredLanguage())
  // The VI dictionary arrives in its own chunk. Until then `t` answers English — the key — and
  // this counter re-renders the tree once the translations exist.
  const [dictionaryLoads, setDictionaryLoads] = useState(0)

  useLayoutEffect(() => {
    applyDocumentLanguage(language)
  }, [language])

  useEffect(() => {
    if (language !== 'vi') return
    let live = true
    void loadViMessages().then(() => {
      if (live) setDictionaryLoads((count) => count + 1)
    })
    return () => {
      live = false
    }
  }, [language])

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next)
    writeStoredLanguage(next)
  }, [])

  const value = useMemo<I18nValue>(
    () => ({
      language,
      setLanguage,
      t: (text, vars) => translate(language, text, vars),
      tn: (count, singular, plural, vars) =>
        translate(language, count === 1 ? singular : plural, { ...vars, count }),
    }),
    // `dictionaryLoads` is not read above; it is the signal that `translate` now has a dictionary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language, setLanguage, dictionaryLoads],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  return useContext(I18nContext)
}
