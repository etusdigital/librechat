import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Frame, type Page, type Response } from '@playwright/test';
import { nginxLog } from './support/services';
import { DesignApi, loginAs, newProject } from './support/session';
import { PREVIEW_FRAME } from './support/workspace';

const ATTACK = fs.readFileSync(path.join(__dirname, 'fixtures', 'attack.html'), 'utf8');
const SESSION_COOKIES = ['refreshToken', 'token_provider', 'openid_user_id', 'connect.sid'];

async function previewFrameOf(page: Page): Promise<Frame> {
  await page.locator(PREVIEW_FRAME).first().waitFor({ timeout: 60_000 });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const frame = page.frames().find((candidate) => candidate.url().includes('/preview/p/'));
    if (frame) return frame;
    await page.waitForTimeout(100);
  }
  throw new Error('preview frame not found');
}

async function attackResults(target: Page | Frame) {
  await target.waitForSelector('body[data-done="1"]', { timeout: 90_000 });
  return JSON.parse((await target.textContent('#results')) ?? '{}') as Record<string, string>;
}

function expectNothingLeaked(results: Record<string, string>, mode: 'frame' | 'tab') {
  const text = JSON.stringify(results);
  for (const name of SESSION_COOKIES) {
    expect(text, `${mode} read the ${name} cookie`).not.toContain(name);
  }
  expect(results.readCookie, mode).toMatch(/^(value:|blocked:)/);
  expect(results.readCookie.replace(/^value:/, ''), mode).not.toMatch(/\w+=/);
  expect(results.localStorage, mode).toMatch(/^blocked:/);
  expect(results.sessionStorage, mode).toMatch(/^blocked:/);
  expect(results.indexedDB, mode).not.toBe('opened');
  for (const vector of ['fetchConvos', 'fetchUser', 'xhr']) {
    expect(results[vector], `${mode} ${vector}`).toMatch(/^blocked:/);
  }
  expect(results.imageApi, mode).toBe('blocked:error');
  expect(results.imageImages, mode).toBe('blocked:error');
  expect(results.serviceWorker, mode).not.toBe('value:controlled');
  if (mode === 'frame') {
    expect(results.parentDocument).toMatch(/^blocked:/);
    expect(results.parentStorage).toMatch(/^blocked:/);
  }
}

function previewResponses(page: Page) {
  const seen: Response[] = [];
  page.on('response', (response) => {
    if (new URL(response.url()).pathname.startsWith('/preview/')) seen.push(response);
  });
  return seen;
}

function expectFromNetworkWithSandbox(responses: Response[]) {
  expect(responses.length).toBeGreaterThan(0);
  for (const response of responses) {
    expect(response.fromServiceWorker(), response.url()).toBe(false);
    const csp = response.headers()['content-security-policy'] ?? '';
    expect(csp, response.url()).toMatch(/^sandbox allow-scripts allow-popups allow-forms;/);
    expect(csp).not.toContain('allow-same-origin');
    expect(response.headers()['set-cookie']).toBeUndefined();
  }
}

test.use({ serviceWorkers: 'allow' });

test('C-2: the project HTML in the workspace iframe and in a tab cannot reach the chat session', async ({
  page,
  context,
}) => {
  await loginAs(page, 'ana', { serviceWorker: true });
  expect(await page.evaluate(() => navigator.serviceWorker.controller != null)).toBe(true);
  const logoutLinesBefore = (await nginxLog()).filter((line) => line.includes('/api/auth/logout'));

  const api = new DesignApi(context);
  const project = await newProject(api, 'Ataque C-2', { 'index.html': ATTACK });
  const responses = previewResponses(page);
  const popups: Page[] = [];
  context.on('page', (popup) => popups.push(popup));

  await page.goto(`/design/${project.projectId}`);
  const workspacePath = new URL(page.url()).pathname;
  const frame = await previewFrameOf(page);
  const framed = await attackResults(frame);
  expectNothingLeaked(framed, 'frame');
  expect(framed.form).toMatch(/^(submitted|blocked:)/);
  expect(framed.topNavigation === 'navigated' || /^blocked:/.test(framed.topNavigation)).toBe(true);
  await page.waitForTimeout(1500);
  expect(new URL(page.url()).pathname).toBe(workspacePath);
  expectFromNetworkWithSandbox(responses);

  const src = (await page.locator(PREVIEW_FRAME).first().getAttribute('src')) ?? '';
  const tabUrl = new URL(src, page.url());
  tabUrl.searchParams.delete('bridge');
  const tab = await context.newPage();
  const tabResponses = previewResponses(tab);
  const navigation = await tab.goto(tabUrl.toString());
  expect(navigation?.fromServiceWorker()).toBe(false);
  expect(navigation?.headers()['content-security-policy']).toMatch(/^sandbox /);
  const direct = await attackResults(tab);
  expectNothingLeaked(direct, 'tab');
  expectFromNetworkWithSandbox(tabResponses);
  await tab.close();
  for (const popup of popups) {
    await popup.close().catch(() => undefined);
  }

  await page.reload();
  await expect.poll(() => new URL(page.url()).pathname).toBe(workspacePath);
  expect((await api.raw('GET', 'me')).status()).toBe(200);
  const user = await context.request.post('https://chat.etus.test/api/auth/refresh');
  expect(user.status()).toBe(200);

  await expect
    .poll(async () => (await nginxLog()).filter((line) => line.includes('c2probe')).length, {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  const log = await nginxLog();
  const probes = log.filter((line) => line.includes('c2probe'));
  for (const line of probes) {
    expect(line, 'a request from the preview reached the chat with the session cookie').toContain(
      'cookie=-',
    );
  }
  const fromPreview = log.filter(
    (line) => /"[A-Z]+ \/(api|images)\//.test(line) && line.includes('site=cross-site'),
  );
  for (const line of fromPreview) {
    expect(line).toContain('cookie=-');
  }
  const logoutLinesAfter = log.filter((line) => line.includes('/api/auth/logout'));
  expect(logoutLinesAfter.length).toBe(logoutLinesBefore.length);
});
