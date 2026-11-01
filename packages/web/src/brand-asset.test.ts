import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'


const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function readBrandSvg(): string {
  return readFileSync(resolve(webRoot, 'public/icon.svg'), 'utf8')
}

/** Every `fill="…"` in the file, lowercased — the whole palette of a flat vector mark. */
function fills(svg: string): string[] {
  return [...svg.matchAll(/fill="([^"]+)"/g)].map((match) => (match[1] ?? '').toLowerCase())
}

/**
 * The brand mark is one public file shared by the favicon (`index.html`), the sidebar
 * (`/icon.svg`) and — through `packages/desktop`'s `npm run icon` — the desktop app's icon set and
 * splash. The canonical public URL is `/icon.svg`; `/onni.svg` is an alias on the server serving
 * the same bytes.
 *
 * It is the OnniCode cat, pixel art, embedded as a PNG inside a square SVG so the URL, the MIME type
 * and every consumer (`rsvg`, `tauri icon`, the browser) keep working unchanged. The earlier
 * geometric C was a vector (2026-09-28); the cat is a raster by nature, drawn pixelated.
 */
describe('cockpit brand asset', () => {
  it('ships a valid, square SVG at packages/web/public/icon.svg', () => {
    const svg = readBrandSvg()
    expect(svg.trimStart().startsWith('<svg')).toBe(true)
    // Square, so the favicon, the 26px sidebar mark and the app icon all frame it the same way.
    const viewBox = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg)
    expect(viewBox).not.toBeNull()
    expect(viewBox?.[1]).toBe(viewBox?.[2])
  })

  it('embeds one PNG and keeps it hard-edged', () => {
    const svg = readBrandSvg()
    const images = [...svg.matchAll(/<image\b[^>]*>/g)].map((match) => match[0])
    expect(images).toHaveLength(1)
    expect(images[0]).toMatch(/image-rendering:\s*pixelated/)
    const data = /(?:xlink:)?href="data:image\/png;base64,([^"]+)"/.exec(images[0] ?? '')?.[1] ?? ''
    // A real PNG: the 8-byte signature, then a square IHDR.
    const bytes = Buffer.from(data, 'base64')
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(bytes.readUInt32BE(16)).toBe(bytes.readUInt32BE(20))
  })

  // The retired geometric C — a black tile with four white polygons — must not come back by accident.
  it('no longer carries the retired geometric mark', () => {
    const svg = readBrandSvg()
    expect(svg).not.toMatch(/<polygon\b/)
    expect(svg).not.toMatch(/<rect\b/)
  })

  // Self-hosted like every other face (the cockpit must work offline) and licensed beside it.
  it('ships the wordmark face, Chakra Petch SemiBold, with its licence', () => {
    const fonts = resolve(webRoot, 'src/assets/fonts')
    expect(readFileSync(resolve(fonts, 'chakra-petch-latin-600-normal.woff2')).subarray(0, 4).toString('latin1')).toBe('wOF2')
    expect(readFileSync(resolve(fonts, 'chakra-petch-LICENSE.txt'), 'utf8')).toContain('SIL Open Font License')
    const css = readFileSync(resolve(webRoot, 'src/styles/index.css'), 'utf8')
    expect(css).toMatch(/font-family: 'Chakra Petch';[\s\S]*?font-weight: 600;[\s\S]*?chakra-petch-latin-600-normal\.woff2/)
    expect(css).toMatch(/--brand: 'Chakra Petch', var\(--sans\);/)
  })

  it('points the favicon at /icon.svg', () => {
    const html = readFileSync(resolve(webRoot, 'index.html'), 'utf8')
    expect(html).toMatch(/rel=["']icon["'][^>]*href=["']\/icon\.svg["']/)
  })
})
