import { describe, expect, it } from 'vitest'

import { viMessages } from '../lib/i18n/vi-messages'

/**
 * Integrity of the Vietnamese UI layer. English text is the key, so a translation
 * that drops or renames a `{placeholder}` renders a raw token in a real screen,
 * and an empty value silently blanks a label. Neither is caught by a type.
 */

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort()
}

describe('the Vietnamese dictionary', () => {
  const entries = Object.entries(viMessages)

  it('is non-trivial — a vacuous dictionary would pass every check below', () => {
    expect(entries.length).toBeGreaterThan(1000)
  })

  it('has a real value for every key', () => {
    for (const [key, value] of entries) {
      expect(value.trim(), `empty translation for: ${key}`).not.toBe('')
    }
  })

  it('keeps exactly the placeholders the English key declares', () => {
    for (const [key, value] of entries) {
      expect(placeholders(value), `placeholder mismatch for: ${key}`).toEqual(placeholders(key))
    }
  })

  it('keeps the line shape of its English key', () => {
    // A multi-line key (the task-order example) may stay multi-line; a label that
    // gains an embedded newline or tab breaks inline composition.
    for (const [key, value] of entries) {
      expect(value.split('\n').length, `line count changed for: ${key}`).toBe(key.split('\n').length)
      expect(/\r|\t/.test(value) && !/\r|\t/.test(key), `control whitespace in: ${key}`).toBe(false)
    }
  })

  it('covers every label the task list paints from deriveAttention', () => {
    // These are the status labels `lib/attention.ts` can return; the quick list and its dot render
    // them through `t`, so a missing entry shows English inside a Vietnamese cockpit. Mirrors the
    // label literals there — the audit found `running` and `cancelled` missing.
    const attentionLabels = [
      'setup needs attention',
      'cleanup needs attention',
      'preparing worktree',
      'cleaning up worktree',
      'needs permission',
      'scheduled',
      'needs you',
      'failed',
      'budget reached',
      'needs review',
      'monitoring',
      'running',
      'unseen',
      'queued',
      'done',
      'cancelled',
    ]
    for (const label of attentionLabels) {
      expect(viMessages[label], `missing VI for attention label: ${label}`).toBeDefined()
    }
  })
})
