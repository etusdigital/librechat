import { defineConfig, devices } from '@playwright/test';
import { CHAT } from './support/env';

const workers = Number(process.env.E2E_WORKERS || 2);

export default defineConfig({
  testDir: __dirname,
  testMatch: '*.e2e.ts',
  outputDir: '/results/artifacts',
  globalSetup: require.resolve('./global-setup'),
  fullyParallel: false,
  workers,
  retries: process.env.CI ? 1 : 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [
    ['list'],
    ['json', { outputFile: '/results/report.json' }],
    ['html', { outputFolder: '/results/html', open: 'never' }],
  ],
  use: {
    baseURL: CHAT,
    ignoreHTTPSErrors: true,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
