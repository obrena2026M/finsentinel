import { defineConfig, devices } from '@playwright/test';

// User-manual capture run (STAGE04). Drives the real UI in Chromium against a fresh in-memory
// server (.env.test, mock LLM gateway, seeded demo cases) and writes screenshots + diagram PNGs to
// documents/manual/. Not part of `npm test` / `npm run test:e2e`; run with `npm run manual:capture`.
export default defineConfig({
  testDir: 'tests/manual',
  outputDir: 'test-results/manual',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 240_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:3100',
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    deviceScaleFactor: 1,
  },
  webServer: {
    command: 'node --env-file=.env.test src/server.ts',
    url: 'http://localhost:3100/health/live',
    // Always a fresh server so the seeded cases are in their initial state for the walkthrough.
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
