const os = require('node:os');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { PORTS } = require('./stack');

const PROXY_URL = `http://127.0.0.1:${PORTS.proxy}`;
const PREVIEW_URL = `http://127.0.0.1:${PORTS.preview}`;
const SCREENSHOT_DIR =
  process.env.E2E_SCREENSHOT_DIR ?? path.join(os.tmpdir(), 'etus-design-home-e2e-screens');
const PERSON = { name: 'Ana E2E', email: 'ana-e2e@etus.test', password: 'design-home-e2e-1' };
const PROJECT_NAME = 'Landing Produto X';
const BRIEF = 'landing para pequenas empresas, com preços e depoimentos';

async function forward(route, base) {
  const url = new URL(route.request().url());
  const response = await route.fetch({ url: `${base}${url.pathname}${url.search}` });
  await route.fulfill({ response });
}

async function designApi(request, method, apiPath, options = {}) {
  const response = await request.fetch(`${PROXY_URL}/api/etus/design/${apiPath}`, {
    method,
    ...options,
  });
  expect(response.ok(), `${method} ${apiPath} -> ${response.status()}`).toBeTruthy();
  return response.status() === 204 ? null : response.json();
}

async function hasHorizontalScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}

test.beforeAll(async ({ request }) => {
  const register = await request.post('/api/auth/register', {
    data: { ...PERSON, username: '', confirm_password: PERSON.password },
  });
  expect([200, 201]).toContain(register.status());
});

test.beforeEach(async ({ context }) => {
  await context.route('**/api/etus/design/**', (route) => forward(route, PROXY_URL));
  await context.route('**/preview/**', (route) => forward(route, PREVIEW_URL));
  const login = await context.request.post('/api/auth/login', {
    data: { email: PERSON.email, password: PERSON.password },
  });
  expect(login.ok()).toBeTruthy();
});

test.use({ locale: 'pt-BR', viewport: { width: 1280, height: 800 } });

test('creates a project from a template and opens the workspace', async ({ page, request }) => {
  await page.goto('/design');
  await expect(page.getByRole('heading', { level: 1, name: 'Design' })).toBeVisible();
  await expect(page.getByText('Você ainda não tem projetos. Comece por um template')).toBeVisible();

  const filters = page.getByRole('group', { name: 'Filtrar templates por tipo' });
  await expect(filters.getByRole('button')).toHaveText(['Todos', 'Protótipo', 'Deck', 'Imagem']);
  await expect(page.getByRole('link', { name: /Design systems/ })).toHaveAttribute(
    'href',
    '/design/systems',
  );
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, 'home-empty-desktop.png'),
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Novo projeto' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Passo 1 de 4: Tipo')).toBeVisible();
  await expect(dialog.getByRole('radio', { name: /Protótipo/ })).toBeChecked();
  await dialog.getByRole('button', { name: 'Continuar' }).click();

  await expect(dialog.getByText('Passo 2 de 4: Template')).toBeVisible();
  const previews = dialog.getByRole('button', { name: /^Ver prévia de / });
  await expect(previews.first()).toBeVisible();
  const previewLabel = await previews.first().getAttribute('aria-label');
  const templateName = previewLabel.replace('Ver prévia de ', '');
  await previews.first().click();
  const previewFrame = page.getByTitle(`Prévia do template ${templateName}`);
  await expect(previewFrame).toHaveAttribute('sandbox', 'allow-scripts');
  const previewSrc = await previewFrame.getAttribute('src');
  expect(previewSrc).toMatch(/\/preview\/t\/tpl-[a-z0-9-]+\/$/);
  const templateId = previewSrc.split('/').at(-2);
  await expect(
    page.frameLocator(`iframe[title="Prévia do template ${templateName}"]`).locator('body'),
  ).not.toBeEmpty();
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'template-preview-desktop.png') });
  await page.getByRole('button', { name: 'Usar este template' }).click();
  await expect(
    dialog.getByRole('button', { name: new RegExp(templateName), pressed: true }),
  ).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'dialog-template-desktop.png') });
  await dialog.getByRole('button', { name: 'Continuar' }).click();

  await expect(dialog.getByText('Passo 3 de 4: Design system')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Etus/, pressed: true })).toBeVisible();
  await dialog.getByRole('searchbox', { name: 'Buscar design system' }).fill('airbnb');
  await dialog.getByRole('button', { name: /^Airbnb/ }).click();
  await expect(dialog.getByRole('button', { name: /^Airbnb/, pressed: true })).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'dialog-system-desktop.png') });
  await dialog.getByRole('button', { name: 'Continuar' }).click();

  await expect(dialog.getByText('Passo 4 de 4: Nome e pedido')).toBeVisible();
  await dialog.getByLabel('Nome do projeto').fill(PROJECT_NAME);
  await dialog.getByLabel('Descreva o que você quer (opcional)').fill(BRIEF);
  await dialog.getByRole('button', { name: 'Criar projeto' }).click();

  await expect(page).toHaveURL(/\/design\/prj_[A-Za-z0-9_-]+$/);
  const projectId = page.url().split('/').at(-1);
  await expect(page.getByRole('heading', { name: PROJECT_NAME })).toBeVisible();

  const created = await designApi(request, 'GET', `projects/${projectId}`);
  expect(created).toMatchObject({
    name: PROJECT_NAME,
    kind: 'prototype',
    designSystemId: 'airbnb',
    templateId,
    access: 'owner',
  });

  await designApi(request, 'PUT', `projects/${projectId}/files/content?path=index.html`, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
    data: `<!doctype html><html><body style="margin:0;background:#3be476"><h1>${PROJECT_NAME}</h1></body></html>`,
  });

  await page.goto('/design');
  const card = page.getByRole('link', { name: new RegExp(PROJECT_NAME) });
  await expect(card).toHaveAttribute('href', `/design/${projectId}`);
  await expect(card.getByText('Airbnb')).toBeVisible();
  const thumbnail = card.locator('iframe');
  await expect(thumbnail).toHaveAttribute('src', /\/preview\/p\/[^/]+\/index\.html$/);
  await expect(thumbnail).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(
    page.frameLocator(`iframe[title="Miniatura de ${PROJECT_NAME}"]`).getByRole('heading', {
      name: PROJECT_NAME,
    }),
  ).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, 'home-grid-desktop.png'),
    fullPage: true,
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  for (const colorScheme of ['light', 'dark']) {
    test(`fits 390 px without horizontal scroll (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto('/design');
      await expect(page.getByRole('link', { name: new RegExp(PROJECT_NAME) })).toBeVisible();
      expect(await hasHorizontalScroll(page)).toBe(false);
      await page.waitForTimeout(400);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `home-grid-mobile-${colorScheme}.png`),
        fullPage: true,
      });

      await page.getByRole('button', { name: 'Novo projeto' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.locator('label').filter({ hasText: 'Apresentações em slides.' }).click();
      await expect(dialog.getByRole('radio', { name: /Deck/ })).toBeChecked();
      await dialog.getByRole('button', { name: 'Continuar' }).click();
      await expect(dialog.getByRole('button', { name: /^Ver prévia de / }).first()).toBeVisible();
      expect(await hasHorizontalScroll(page)).toBe(false);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `dialog-template-mobile-${colorScheme}.png`),
      });
      await dialog.getByRole('button', { name: 'Continuar' }).click();
      await expect(dialog.getByRole('group', { name: 'Categorias' })).toBeVisible();
      expect(await hasHorizontalScroll(page)).toBe(false);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `dialog-system-mobile-${colorScheme}.png`),
      });
      await dialog.getByRole('button', { name: 'Fechar' }).click();
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(/\/design$/);
    });
  }
});
