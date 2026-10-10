import { expect, test } from '@playwright/test';
import { landingPage } from './fixtures/pages';
import { companySettings, hubCalls } from './support/services';
import { DesignApi, loginAs, newProject } from './support/session';
import { noHorizontalScroll } from './support/workspace';

test.describe('C-15 design systems gallery', () => {
  test('search and category filter the grid, cards show thumbnails and the "Inspirado em" badge', async ({
    page,
  }) => {
    await loginAs(page, 'ana');
    await page.goto('/design/systems');
    const grid = page.getByRole('list', { name: 'Design systems' });
    await expect(grid.getByRole('listitem').first()).toBeVisible({ timeout: 60_000 });
    const all = await grid.getByRole('listitem').count();
    expect(all).toBeGreaterThan(10);

    await page.getByLabel('Buscar design systems').fill('zzz-nenhum-sistema');
    await expect(page.getByText('Nenhum design system encontrado para essa busca')).toBeVisible();

    await page.getByLabel('Buscar design systems').fill('airbnb');
    await expect(grid.getByRole('listitem')).toHaveCount(1, { timeout: 20_000 });
    const card = grid.getByRole('listitem').first();
    await expect(card).toContainText('Airbnb');
    await expect(card.getByText('Inspirado em Airbnb')).toBeVisible();
    const thumbnail = card.locator('img').first();
    await expect
      .poll(
        () => thumbnail.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth),
        {
          timeout: 90_000,
        },
      )
      .toBeGreaterThan(0);

    await page.getByLabel('Buscar design systems').fill('');
    const category = page.getByLabel('Categoria', { exact: true });
    const options = await category.locator('option').allTextContents();
    expect(options.length).toBeGreaterThan(2);
    await category.selectOption({ index: 1 });
    await expect.poll(() => grid.getByRole('listitem').count()).toBeLessThan(all);
    await expect.poll(() => grid.getByRole('listitem').count()).toBeGreaterThan(0);
  });

  test('the detail shows colors, typography and components in a sandbox without allow-same-origin', async ({
    page,
  }) => {
    await loginAs(page, 'ana');
    await page.goto('/design/systems/airbnb');
    await expect(page.getByRole('heading', { name: 'Cores' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('heading', { name: 'Tipografia' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Componentes' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Copiar #/ }).first()).toBeVisible();
    const components = page.locator('iframe[title^="Prévia de componentes de"]');
    await expect(components).toHaveAttribute('sandbox', 'allow-scripts');
    expect(await components.getAttribute('sandbox')).not.toContain('allow-same-origin');
    await expect(components).toHaveAttribute('src', /\/preview\/ds\/airbnb\//);
  });

  test('"Usar neste projeto" saves the designSystemId', async ({ page }) => {
    await loginAs(page, 'ana');
    const api = new DesignApi(page.context());
    const project = await newProject(api, 'Galeria C-15', { 'index.html': landingPage() });
    await page.goto(`/design/systems?project=${project.projectId}`);
    await expect(
      page.getByText('Escolhendo um design system para o projeto Galeria C-15'),
    ).toBeVisible({
      timeout: 60_000,
    });
    await page.getByLabel('Buscar design systems').fill('airbnb');
    const grid = page.getByRole('list', { name: 'Design systems' });
    await expect(grid.getByRole('listitem')).toHaveCount(1, { timeout: 20_000 });
    await expect(grid.getByRole('listitem').first()).toContainText('Airbnb');
    await grid.getByRole('link').first().click();
    await expect(page.getByRole('heading', { name: 'Airbnb', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Usar neste projeto' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Usar Airbnb no projeto Galeria C-15?');
    await dialog.getByRole('button', { name: 'Usar neste projeto' }).click();
    await expect(
      dialog.getByText('Airbnb agora é o design system do projeto Galeria C-15.'),
    ).toBeVisible();
    const saved = await api.json<{ designSystemId: string }>(
      'GET',
      `projects/${project.projectId}`,
    );
    expect(saved.designSystemId).toBe('airbnb');
    await expect(
      dialog.getByRole('button', { name: 'Pedir ao agente para aplicar' }),
    ).toBeVisible();
  });

  test.describe('states', () => {
    test('loading, error with retry, empty and data, without horizontal scroll at 390x844', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await loginAs(page, 'ana');
      let mode: 'slow' | 'fail' | 'pass' = 'slow';
      await page.route('**/api/etus/design/design-systems?**', async (route) => {
        if (mode === 'slow') {
          await new Promise((resolve) => setTimeout(resolve, 2_500));
          return route.continue();
        }
        if (mode === 'fail') {
          return route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'internal', message: 'falha' } }),
          });
        }
        return route.continue();
      });
      await page.goto('/design/systems');
      await expect(
        page.getByRole('status').filter({ hasText: 'Carregando' }).first(),
      ).toBeVisible();
      const grid = page.getByRole('list', { name: 'Design systems' });
      await expect(grid.getByRole('listitem').first()).toBeVisible({ timeout: 60_000 });
      expect(await noHorizontalScroll(page)).toBe(true);

      mode = 'fail';
      await page.getByLabel('Buscar design systems').fill('erro-simulado');
      await expect(page.getByText('Não foi possível carregar os design systems.')).toBeVisible({
        timeout: 30_000,
      });
      mode = 'pass';
      await page.getByRole('button', { name: 'Tentar de novo' }).click();
      await expect(page.getByText('Nenhum design system encontrado para essa busca')).toBeVisible();
      await page.getByLabel('Buscar design systems').fill('');
      await expect(grid.getByRole('listitem').first()).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);

      await page.goto('/design/systems/airbnb');
      await expect(page.getByRole('heading', { name: 'Cores' })).toBeVisible({ timeout: 60_000 });
      expect(await noHorizontalScroll(page)).toBe(true);
    });
  });
});

const SYSTEM_BY_BROWSER: Record<string, [string, string]> = {
  chromium: ['airbnb', 'Airbnb'],
  firefox: ['stripe', 'Stripe'],
  webkit: ['notion', 'Notion'],
};

test.describe('C-16 use as the company default', () => {
  test('without design-systems.set-default the button is absent and the service answers 403', async ({
    page,
  }) => {
    await loginAs(page, 'bia');
    await page.goto('/design/systems/airbnb');
    await expect(page.getByRole('heading', { name: 'Cores' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Usar como padrão' })).toHaveCount(0);
    const api = new DesignApi(page.context());
    const me = await api.json<{ canSetCompanyDefault: boolean }>('GET', 'me');
    expect(me.canSetCompanyDefault).toBe(false);
    const refused = await api.raw('PUT', 'company/default-design-system', {
      json: { designSystemId: 'airbnb' },
    });
    expect(refused.status()).toBe(403);
  });

  test('with the permission the ConfirmDialog saves in the hub with the person token and audits', async ({
    page,
  }, testInfo) => {
    const [id, name] = SYSTEM_BY_BROWSER[testInfo.project.name] ?? ['airbnb', 'Airbnb'];
    await loginAs(page, 'carla');
    const api = new DesignApi(page.context());
    const startedAt = Date.now();
    await page.goto(`/design/systems/${id}`);
    await page.getByRole('button', { name: 'Usar como padrão' }).click();
    const dialog = page.getByRole('dialog', { name: `Usar ${name} como padrão da empresa?` });
    await expect(dialog).toContainText(
      `Todas as pessoas da empresa passam a começar projetos com ${name}.`,
    );
    await dialog.getByRole('button', { name: 'Usar como padrão' }).click();
    await expect(page.getByText(`${name} agora é o padrão da empresa.`).first()).toBeVisible();

    const write = (await hubCalls()).find(
      (call) =>
        call.kind === 'company-setting' &&
        call.persona === 'carla' &&
        call.at >= startedAt &&
        call.value === id,
    );
    expect(write).toMatchObject({ field: 'defaultDesignSystem', personToken: true });
    expect(Object.keys(await companySettings())).toContain('defaultDesignSystem');
    const audit = await api.json<Array<{ action: string; actorSub: string; at: string }>>(
      'GET',
      'audit?action=design_system.default_set',
    );
    expect(
      audit.some(
        (event) => event.actorSub === 'logto-carla' && Date.parse(event.at) >= startedAt - 5_000,
      ),
    ).toBe(true);
  });
});
