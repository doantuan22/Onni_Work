/// <reference types="vitest/jsdom" />

// Node 25 exposes its own Web Storage globals. Browser tests must use the JSDOM
// origin's storage, including its normal clear/key/quota behavior, on every Node version.
const storageWindow = jsdom.window
for (const key of ['localStorage', 'sessionStorage'] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: storageWindow[key],
  })
}

// Radix Select/Popover probe pointer-capture and scrolling APIs jsdom does not implement.
if (typeof Element !== 'undefined') {
  const proto = Element.prototype as unknown as Record<string, unknown>
  proto.hasPointerCapture ??= () => false
  proto.setPointerCapture ??= () => {}
  proto.releasePointerCapture ??= () => {}
  proto.scrollIntoView ??= () => {}
}

// cmdk (the searchable AppSelect) measures its list with ResizeObserver, which jsdom lacks.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}
