import { expect, test } from '@playwright/test';
import { CHAT } from './support/env';

const BANNED = [
  'posthog',
  'langfuse',
  'open-design.ai',
  'vela',
  'amr',
  'fetch(',
  'xmlhttprequest',
  'sendbeacon',
  'websocket',
  'eventsource',
];

test('C-13: the bridge served in the preview has no Open Design telemetry nor network calls', async ({
  request,
}) => {
  const response = await request.get(`${CHAT}/preview/__etus/bridge.js`);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-security-policy']).toMatch(/^sandbox /);
  const source = (await response.text()).toLowerCase();
  expect(source.length).toBeGreaterThan(1000);
  for (const banned of BANNED) {
    expect(source.includes(banned), banned).toBe(false);
  }
});
