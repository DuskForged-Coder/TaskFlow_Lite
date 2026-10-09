import { defineConfig } from 'vitest/config';

// Separate from vitest.config.ts on purpose: the visible and hidden acceptance
// tests are expected to FAIL on the baseline product suite, so they must not be
// picked up by `corepack pnpm test`.
//
// Visible:  corepack pnpm vitest run --config experiment/vitest.visible.config.ts
// Hidden:   experiment/score-hidden.sh  (copies hidden tests in, runs, removes)
export default defineConfig({
  test: {
    environment: 'node',
    include: ['experiment/tests-visible/**/*.test.ts'],
    restoreMocks: true,
    testTimeout: 30_000,
    // Acceptance tests must be deterministic and offline: any command the
    // deterministic parser does not recognise has to fail immediately with a
    // UserError instead of silently falling through to a live AI backend.
    env: {
      TASKFLOW_AI_PROVIDER: 'none',
    },
  },
});
