import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.js/,
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 1,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
    navigationTimeout: 30_000,
    actionTimeout: 15_000,
  },
  webServer: {
    command: 'npx vite --port 4173 --strictPort --config vite.test.config.js',
    url: 'http://127.0.0.1:4173/examples/vanilla/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium', testDir: './tests/integration', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'perf',
      testDir: './tests/performance',
      timeout: 600_000,
      retries: 0,
      use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--js-flags=--expose-gc', '--enable-precise-memory-info'] } },
    },
  ],
});
