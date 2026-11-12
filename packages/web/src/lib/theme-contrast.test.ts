import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * WCAG AA for the tokens that carry small text. Reads the real stylesheet, so a token edit that
 * drops below 4.5:1 fails here instead of surfacing as "washed out" in a screenshot.
 */
const css = readFileSync(resolve(__dirname, '../styles/index.css'), 'utf8')

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`\n${selector} {`)
  const body = css.slice(start, css.indexOf('\n}', start))
  const tokens: Record<string, string> = {}
  for (const m of body.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) tokens[m[1]!] = m[2]!.trim()
  return tokens
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

const dark = block(':root')
const light = { ...dark, ...block('.light') }

describe('theme contrast (WCAG AA, 4.5:1)', () => {
  it.each([
    ['dark', dark, ['--background', '--card', '--card-2']],
    ['light', light, ['--background', '--sidebar', '--muted']],
  ] as const)('soft foreground reads on every %s surface it sits on', (_name, tokens, surfaces) => {
    for (const surface of surfaces) {
      expect(ratio(tokens['--soft-foreground']!, tokens[surface]!), surface).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each([
    ['dark', dark, ['--background', '--card', '--card-2']],
    ['light', light, ['--background', '--sidebar', '--muted']],
  ] as const)('violet is readable as ink on every %s surface', (_name, tokens, surfaces) => {
    for (const surface of surfaces) {
      expect(ratio(tokens['--violet']!, tokens[surface]!), surface).toBeGreaterThanOrEqual(4.5)
    }
  })

  // `--success` and `--danger` carry small text ("+N"/"−N", error lines, "Completed tasks"), so
  // both must stay AA as ink. The dark values pass; the light theme needs its own darker step.
  it.each([
    ['dark', dark, ['--background', '--card', '--card-2']],
    ['light', light, ['--background', '--sidebar', '--muted']],
  ] as const)('success and danger read as ink on every %s surface', (_name, tokens, surfaces) => {
    for (const ink of ['--success', '--danger']) {
      for (const surface of surfaces) {
        expect(ratio(tokens[ink]!, tokens[surface]!), `${ink} on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it.each([
    ['dark', dark],
    ['light', light],
  ] as const)('the %s violet fill has AA text and drives every interactive token', (_name, tokens) => {
    expect(ratio(tokens['--violet']!, tokens['--violet-foreground']!)).toBeGreaterThanOrEqual(4.5)
    expect(tokens['--primary']).toBe('var(--violet)')
    expect(tokens['--ring']).toBe('var(--violet)')
    expect(tokens['--link']).toBe('var(--violet)')
    expect(tokens['--active-tab']).toBe('var(--violet)')
  })
})
