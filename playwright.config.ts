import { defineConfig } from '@playwright/test';

// Single runner for all test levels (tools.md §3.4). These projects never request the
// `page` fixture, so no browser is launched. E2E lives in playwright.e2e.config.ts,
// which adds the Chromium project and the webServer.
export default defineConfig({
  testDir: 'tests',
  // Separate outputDir per config: Playwright wipes outputDir on start, and the e2e run must not
  // delete this run's JSON report (the quality gate reads both).
  outputDir: 'test-results/base',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]],
  timeout: 60_000,
  projects: [
    { name: 'unit', testDir: 'tests/unit' },
    { name: 'integration', testDir: 'tests/integration' },
    { name: 'security', testDir: 'tests/security' },
    { name: 'adversarial', testDir: 'tests/adversarial' },
  ],
});
