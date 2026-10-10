const os = require('node:os');
const path = require('node:path');
const { defineConfig, devices } = require('@playwright/test');
const { CHAT_URL } = require('./stack');

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: '*.e2e.js',
  outputDir: path.join(os.tmpdir(), 'etus-design-home-e2e-results'),
  globalSetup: require.resolve('./global-setup'),
  globalTeardown: require.resolve('./global-teardown'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [['list']],
  expect: { timeout: 15_000 },
  use: {
    baseURL: CHAT_URL,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
