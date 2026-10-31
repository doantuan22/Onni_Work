import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'

import { applyDocumentLanguage, readStoredLanguage, writeStoredLanguage, type Language } from './language'
import { translate } from './messages'

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

  useLayoutEffect(() => {
    applyDocumentLanguage(language)
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
    [language, setLanguage],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  return useContext(I18nContext)
}
