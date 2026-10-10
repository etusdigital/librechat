import { expect, test, type Page } from '@playwright/test';
import { landingPage } from './fixtures/pages';
import {
  box,
  hitAt,
  noHorizontalScroll,
  openWorkspace,
  preview,
  setDevice,
  setMode,
  setZoom,
} from './support/workspace';

const STAGE = '[data-testid="design-preview-stage"]';
const CHAT = '#design-panel-chat';
const FRAME = '[data-testid="design-device-frame"]';
const PANEL = '[data-testid="design-mode-panel"]';

async function expandChatMenu(page: Page) {
  const toggle = page.getByTestId('design-chat-sidebar-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.waitForTimeout(400);
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
]) {
  test(`C-11 ${viewport.width}x${viewport.height}: split panels, the preview never goes under the chat and the mode panel turns into a drawer`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openWorkspace(page, {
      name: `Layout ${viewport.width}`,
      files: { 'index.html': landingPage() },
    });
    await expandChatMenu(page);
    await expect(page.getByTestId('design-workspace')).toHaveAttribute('data-layout', 'split');
    expect(await noHorizontalScroll(page)).toBe(true);

    const chat = await box(page, CHAT);
    let stage = await box(page, STAGE);
    expect(stage.left).toBeGreaterThanOrEqual(chat.right - 1);

    await setDevice(page, 'Desktop');
    await setZoom(page, '100%');
    await expect(page.locator(FRAME)).toHaveAttribute('data-scale', '1');
    const frame = await box(page, FRAME);
    expect(frame.left).toBeGreaterThanOrEqual(stage.left - 1);
    const scroll = await page.locator(STAGE).evaluate((element) => ({
      overflow: element.scrollWidth > element.clientWidth,
      max: element.scrollWidth - element.clientWidth,
    }));
    expect(scroll.overflow).toBe(true);
    const middle = chat.top + chat.height / 2;
    expect(await hitAt(page, stage.left + 6, middle)).toBe('preview');
    expect(await hitAt(page, chat.right - 12, middle)).toBe('chat');
    await page.locator(STAGE).evaluate((element, left) => element.scrollTo({ left }), scroll.max);
    expect(await hitAt(page, chat.right - 12, middle)).toBe('chat');
    expect(await hitAt(page, stage.left + 6, middle)).toBe('preview');
    await expect(preview(page).locator('#left-edge')).toBeAttached();

    await setZoom(page, 'Ajustar');
    await setMode(page, 'Comentar');
    const panel = page.locator(PANEL);
    await expect(panel).toHaveAttribute('data-layout', 'drawer');
    await expect(panel).toBeHidden();
    const full = await box(page, '[data-testid="design-preview-area"]');
    stage = await box(page, STAGE);
    expect(stage.width).toBeGreaterThanOrEqual(full.width - 1);
    const toggle = page.getByTestId('design-mode-panel-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(panel).toBeVisible();
    expect((await box(page, STAGE)).width).toBeGreaterThanOrEqual(full.width - 1);
    expect(await hitAt(page, chat.right - 12, middle)).toBe('chat');
    await toggle.click();
    await expect(panel).toBeHidden();

    await page.getByTestId('design-chat-sidebar-toggle').click();
    await expect(page.getByTestId('design-chat-sidebar-toggle')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect
      .poll(async () => (await box(page, '[data-testid="design-preview-area"]')).width)
      .toBeGreaterThan(full.width + 200);
    if ((await box(page, '[data-testid="design-preview-area"]')).width >= 800) {
      await expect(panel).toHaveAttribute('data-layout', 'side');
      await expect(panel).toBeVisible();
      expect((await box(page, STAGE)).width).toBeGreaterThanOrEqual(480);
    }
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.getByTestId('design-chat-sidebar-toggle').click();
  });
}

test('C-11 390x844: the three tabs work without horizontal scroll and the mode panel stacks', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWorkspace(page, {
    name: 'Layout celular',
    files: { 'index.html': landingPage() },
    waitPreview: false,
  });
  await expect(page.getByTestId('design-workspace')).toHaveAttribute('data-layout', 'compact');
  const tabs = page.getByRole('tablist');
  await expect(tabs.getByRole('tab')).toHaveCount(3);
  await tabs.getByRole('tab', { name: 'Chat' }).click();
  await expect(page.locator(CHAT)).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);

  await tabs.getByRole('tab', { name: /Prévia/ }).click();
  await expect(page.locator(FRAME)).toBeVisible();
  await expect(page.locator(FRAME)).toHaveAttribute('data-device', 'mobile');
  expect(await noHorizontalScroll(page)).toBe(true);
  await setMode(page, 'Comentar');
  await expect(page.locator(PANEL)).toHaveAttribute('data-layout', 'stacked');
  await expect(page.locator(PANEL)).toBeVisible();
  const stage = await box(page, STAGE);
  expect(stage.right).toBeLessThanOrEqual(391);
  expect(await noHorizontalScroll(page)).toBe(true);

  await tabs.getByRole('tab', { name: 'Arquivos' }).click();
  await expect(page.locator('#design-panel-files').getByText('index.html').first()).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  await tabs.getByRole('tab', { name: 'Chat' }).click();
  await expect(page.locator(CHAT)).toBeVisible();
});
