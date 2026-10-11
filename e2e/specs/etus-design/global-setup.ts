import { chromium } from '@playwright/test';
import { CHAT } from './support/env';
import { waitForAgentSeed } from './support/services';
import { loginAs } from './support/session';

export default async function globalSetup() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      baseURL: CHAT,
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    await loginAs(page, 'ana');
    await waitForAgentSeed();
    await context.close();
  } finally {
    await browser.close();
  }
}
