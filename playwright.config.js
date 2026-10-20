import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.js/,
  timeout: 60_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite --port 4173 --strictPort --config vite.test.config.js',
    url: 'http://127.0.0.1:4173/examples/vanilla/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
