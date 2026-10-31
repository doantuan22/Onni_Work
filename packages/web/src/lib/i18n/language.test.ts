import { afterEach, describe, expect, it } from 'vitest'

import { LANGUAGE_STORAGE_KEY, applyDocumentLanguage, isLanguage, readStoredLanguage, writeStoredLanguage } from './language'

describe('language storage', () => {
  afterEach(() => {
    localStorage.clear()
    document.documentElement.lang = 'en'
  })

  it('treats anything that is not en or vi as not a language', () => {
    expect(isLanguage('en')).toBe(true)
    expect(isLanguage('vi')).toBe(true)
    expect(isLanguage('fr')).toBe(false)
    expect(isLanguage(null)).toBe(false)
  })

  it('defaults to English when nothing was chosen', () => {
    expect(readStoredLanguage()).toBe('en')
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'klingon')
    expect(readStoredLanguage()).toBe('en')
  })

  it('round-trips a choice through localStorage', () => {
    writeStoredLanguage('vi')
    expect(readStoredLanguage()).toBe('vi')
  })

  it('publishes the language on the html element', () => {
    applyDocumentLanguage('vi')
    expect(document.documentElement.lang).toBe('vi')
  })
})
