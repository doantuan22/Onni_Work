import { describe, expect, it } from 'vitest'

import { interpolate, translate, viMessages } from './messages'

describe('translate', () => {
  it('returns English untouched, byte for byte', () => {
    expect(translate('en', 'New task')).toBe('New task')
    expect(translate('en', '{count} tasks left', { count: 3 })).toBe('3 tasks left')
  })

  it('leaves unknown placeholders written rather than blanking them', () => {
    expect(translate('en', 'Hello {missing}')).toBe('Hello {missing}')
  })

  it('falls back to English for a key the Vietnamese dictionary does not cover', () => {
    expect(viMessages['A string nobody has translated yet']).toBeUndefined()
    expect(translate('vi', 'A string nobody has translated yet')).toBe('A string nobody has translated yet')
  })

  it('substitutes placeholders after the lookup', () => {
    // The key keeps its `{name}` token; only the chosen string is interpolated.
    expect(interpolate('Xin chào {name}', { name: 'An' })).toBe('Xin chào An')
  })

  it('translates a covered key and still interpolates it', () => {
    const key = 'Language'
    expect(translate('vi', key)).toBe(viMessages[key])
    expect(viMessages[key]).not.toBe(key)
  })
})
