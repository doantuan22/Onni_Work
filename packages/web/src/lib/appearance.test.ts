import { afterEach, describe, expect, it } from 'vitest'

import {
  ACCENT_STORAGE_KEY,
  DENSITY_STORAGE_KEY,
  WIDTH_STORAGE_KEY,
  applyAppearance,
  normalizeAccent,
  normalizeAppearance,
  normalizeDensity,
  normalizeWidth,
  readStoredAppearance,
  writeStoredAppearance,
} from './appearance'

afterEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.accent
  delete document.documentElement.dataset.density
  delete document.documentElement.dataset.width
})

describe('normalize', () => {
  it('accepts the known values and defaults everything else', () => {
    expect(normalizeAccent('violet')).toBe('violet')
    // Historical records continue to parse, but the old selector now resolves to fixed violet.
    expect(normalizeAccent('lime')).toBe('violet')
    // Unknown/garbage inputs — localStorage and ui-state.json both outlive this code's vocabulary.
    for (const raw of [null, undefined, 'magenta', 42, {}]) {
      expect(normalizeAccent(raw)).toBe('violet')
      expect(normalizeDensity(raw)).toBe('comfortable')
      expect(normalizeWidth(raw)).toBe('wide')
    }
    expect(normalizeDensity('compact')).toBe('compact')
    expect(normalizeDensity('ultra')).toBe('ultra')
    expect(normalizeWidth('wide')).toBe('wide')
    expect(normalizeWidth('narrow')).toBe('narrow')
  })

  it('migrates stored lime appearance without breaking its other preferences', () => {
    expect(normalizeAppearance({ accent: 'lime', density: 'compact', width: 'narrow' })).toEqual({
      accent: 'violet',
      density: 'compact',
      width: 'narrow',
    })
  })

  it('normalizes a missing or invalid accent to violet', () => {
    expect(normalizeAppearance(undefined)).toEqual({
      accent: 'violet',
      density: 'comfortable',
      width: 'wide',
    })
    expect(normalizeAppearance('not-an-object')).toEqual({
      accent: 'violet',
      density: 'comfortable',
      width: 'wide',
    })
    expect(normalizeAppearance({ accent: 'violet' })).toEqual({
      accent: 'violet',
      density: 'comfortable',
      width: 'wide',
    })
    expect(normalizeAppearance({ accent: 'nope', density: 'compact', width: 'wide' })).toEqual({
      accent: 'violet',
      density: 'compact',
      width: 'wide',
    })
  })
})

describe('the localStorage mirror', () => {
  it('round-trips through the same keys the index.html pre-paint script reads', () => {
    writeStoredAppearance({ accent: 'violet', density: 'compact', width: 'wide' })
    expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBe('violet')
    expect(localStorage.getItem(DENSITY_STORAGE_KEY)).toBe('compact')
    expect(localStorage.getItem(WIDTH_STORAGE_KEY)).toBe('wide')
    expect(readStoredAppearance()).toEqual({ accent: 'violet', density: 'compact', width: 'wide' })
  })

  it('defaults when the mirror is empty', () => {
    expect(readStoredAppearance()).toEqual({ accent: 'violet', density: 'comfortable', width: 'wide' })
  })
})

describe('applyAppearance', () => {
  it('clears a historical accent stamp while preserving the independent preferences', () => {
    const root = document.documentElement
    root.dataset.accent = 'lime'
    applyAppearance(root, { accent: 'violet', density: 'compact', width: 'narrow' })
    expect(root.hasAttribute('data-accent')).toBe(false)
    expect(root.dataset.density).toBe('compact')
    expect(root.dataset.width).toBe('narrow')

    // Back to defaults: independent preference attributes still come off as before.
    applyAppearance(root, { accent: 'violet', density: 'comfortable', width: 'wide' })
    expect(root.hasAttribute('data-accent')).toBe(false)
    expect(root.hasAttribute('data-density')).toBe(false)
    expect(root.hasAttribute('data-width')).toBe(false)
  })
})
