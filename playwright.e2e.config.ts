import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report-e2e' }],
    ['json', { outputFile: 'test-results/e2e-results.json' }],
  ],
  timeout: 90_000,
  use: { baseURL: 'http://localhost:3100' },
  projects: [
    { name: 'e2e-light', use: { ...devices['Desktop Chrome'], colorScheme: 'light' } },
    { name: 'e2e-dark', use: { ...devices['Desktop Chrome'], colorScheme: 'dark' } },
  ],
  webServer: {
    command: 'node --env-file=.env.test src/server.ts',
    url: 'http://localhost:3100/health/live',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
