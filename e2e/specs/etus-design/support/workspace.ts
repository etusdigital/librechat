import { expect, type Page } from '@playwright/test';
import type { Persona } from './env';
import { DesignApi, gotoPath, loginAs, newProject } from './session';

export const PREVIEW_FRAME = 'iframe[title^="Prévia de"]';

export async function openWorkspace(
  page: Page,
  {
    persona = 'ana',
    name,
    files,
    designSystemId,
    waitPreview = true,
  }: {
    persona?: Persona;
    name: string;
    files: Record<string, string>;
    designSystemId?: string;
    waitPreview?: boolean;
  },
) {
  await loginAs(page, persona);
  const api = new DesignApi(page.context());
  const project = await newProject(api, name, files, designSystemId ? { designSystemId } : {});
  await gotoPath(page, `/design/${project.projectId}`);
  if (waitPreview) {
    await waitForPreview(page);
  } else {
    await expect(page.getByTestId('design-workspace')).toBeVisible({ timeout: 60_000 });
  }
  return { api, project };
}

export async function waitForPreview(page: Page) {
  const frame = page.locator(PREVIEW_FRAME).first();
  await expect(frame).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('design-device-frame').getByRole('status')).toHaveCount(0, {
    timeout: 60_000,
  });
  return frame;
}

export function preview(page: Page) {
  return page.frameLocator(PREVIEW_FRAME).first();
}

export async function bridgeNonce(page: Page) {
  const src = (await page.locator(PREVIEW_FRAME).first().getAttribute('src')) ?? '';
  return new URL(src, 'https://chat.etus.test').searchParams.get('bridge') ?? '';
}

export async function setZoom(page: Page, label: string) {
  await page.getByLabel('Zoom', { exact: true }).selectOption({ label });
}

export async function setDevice(page: Page, name: 'Celular' | 'Tablet' | 'Desktop' | 'Livre') {
  await page
    .getByRole('group', { name: 'Dispositivo' })
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .click();
}

export async function setMode(page: Page, name: 'Ver' | 'Comentar' | 'Editar' | 'Desenhar') {
  await page
    .getByRole('group', { name: 'Modo' })
    .getByRole('button', { name, exact: true })
    .click();
}

export type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export async function box(page: Page, selector: string): Promise<Box> {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    });
}

export async function hitAt(page: Page, x: number, y: number) {
  return page.evaluate(
    ([px, py]) => {
      const element = document.elementFromPoint(px, py);
      if (!element) return 'none';
      if (element.closest('[data-testid="design-preview-stage"]')) return 'preview';
      if (element.closest('#design-panel-chat')) return 'chat';
      if (element.closest('[data-testid="design-mode-panel"]')) return 'panel';
      return element.tagName.toLowerCase();
    },
    [x, y],
  );
}

export async function noHorizontalScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

export async function collapseChatMenu(page: Page) {
  const toggle = page.getByTestId('design-chat-sidebar-toggle');
  if ((await toggle.getAttribute('aria-expanded')) === 'true') {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
}

export async function previewFrameOf(page: Page) {
  await page.locator(PREVIEW_FRAME).first().waitFor({ timeout: 60_000 });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const frame = page.frames().find((candidate) => candidate.url().includes('/preview/p/'));
    if (frame) return frame;
    await page.waitForTimeout(100);
  }
  throw new Error('preview frame not found');
}

export async function clickInPreview(page: Page, selector: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const frame = await previewFrameOf(page);
      await frame.click(selector, { timeout: 5_000 });
      return frame;
    } catch (error) {
      if (attempt === 4) throw error;
      await page.waitForTimeout(500);
    }
  }
  throw new Error('unreachable');
}

export const composer = (page: Page) => page.locator('#prompt-textarea');

export async function waitForProjectConversation(page: Page, projectId: string) {
  await expect(
    page.locator('#design-panel-chat').getByText(`Projeto visto pelo modelo: ${projectId}.`),
  ).toBeVisible({ timeout: 90_000 });
  await expect(composer(page)).toBeVisible();
}
