import { defineConfig } from 'vitest/config'

// The service + CLI suite: Node ESM, no DOM, no bundler. `test/` is deliberately NOT included
// — those are the node:test suites (`npm run test:unit`, `npm run test:package`), which pack
// and install the real tarball and must not run inside the fast unit gate.
export default defineConfig({
  test: {
    name: 'server',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // ~165 files run in parallel, many spawning git; under that load a test that is ~1 s alone
    // can outlast the 5 s default. Real hangs still fail, at 20 s.
    testTimeout: 20_000,
    // Pins ONNI_HOME to a per-worker sandbox so no case can write the developer's
    // real ~/.onni — see the file for the failure it prevents.
    setupFiles: ['./vitest.setup.ts'],
  },
})
