import { defineConfig, mergeConfig } from 'vitest/config'

import viteConfig from './vite.config'

// Reuse the build config verbatim (root, React plugin, `@` → packages/web/src) and only add the
// test layer, so a component under test resolves its imports exactly like the shipped bundle.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      name: 'web',
      environment: 'jsdom',
      setupFiles: ['./src/test-setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      // The full suite runs ~340 files in parallel; under that load a lazily-loaded chunk (the diff
      // viewer) or a long scheduling flow can outlast the 5 s default. Alone they finish in ~1 s.
      testTimeout: 20_000,
    },
  }),
)
