export { LANGUAGE_STORAGE_KEY, isLanguage, readStoredLanguage, writeStoredLanguage, applyDocumentLanguage } from './language'
export type { Language } from './language'
export { interpolate, translate, viMessages } from './messages'
export { I18nProvider, useI18n } from './provider'
export type { I18nValue, Translate } from './provider'

import { readStoredLanguage as _read } from './language'
import { translate as _translate } from './messages'

/** For toasts and other code outside React: translate in the stored language. */
export const tr = (text: string, vars?: Record<string, string | number>): string => _translate(_read(), text, vars)
