import { defineConfig } from 'vitest/config';

// Deliberately separate from vite.config.ts. Vitest bundles its own copy of Vite,
// and sharing one config file makes the PWA plugin's types clash with
// `exactOptionalPropertyTypes`. The test runner has no use for the PWA plugin.
export default defineConfig({
  test: {
    globals: true,
    // Engine tests are pure and must stay that way — no DOM. UI tests opt into
    // jsdom per-file with `// @vitest-environment jsdom`.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The property tests run tens of thousands of draws; they are fast because
    // the engine is pure, but give them room.
    testTimeout: 30_000,
  },
});
