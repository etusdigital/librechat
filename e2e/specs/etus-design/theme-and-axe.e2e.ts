import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { landingPage } from './fixtures/pages';
import { DesignApi, loginAs, newProject } from './support/session';
import { waitForPreview } from './support/workspace';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const KEY_PATTERN =
  /etus-design:|\b(home|workspace|actions|systems|comments|inspect|draw|chat)\.[a-z]+[._][a-z_.]+\b/;

async function seriousViolations(page: Page, include: string, exclude: string[] = []) {
  let builder = new AxeBuilder({ page }).include(include).withTags(TAGS);
  for (const selector of exclude) builder = builder.exclude(selector);
  const result = await builder.analyze();
  return result.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.slice(0, 4).map((node) => ({
        target: node.target.join(' '),
        detail: node.any.map((check) => check.message).join('; '),
      })),
    }));
}

async function expectNoRawKeys(page: Page, selector: string) {
  const text = await page.locator(selector).first().innerText();
  expect(text).not.toMatch(KEY_PATTERN);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`C-12 ${scheme}`, () => {
    test.use({ colorScheme: scheme });
    test(`C-12 ${scheme}: Home, workspace, dialogs and gallery have no serious axe violation and no raw text keys`, async ({
      page,
    }, testInfo) => {
      const projectName = `Acessibilidade ${scheme} ${testInfo.project.name} ${Date.now()}`;
      await page.addInitScript((theme) => {
        if (location.hostname === 'chat.etus.test') localStorage.setItem('color-theme', theme);
      }, scheme);
      await loginAs(page, 'ana');
      await expect
        .poll(() =>
          page.evaluate(() => ({
            dark: document.documentElement.classList.contains('dark'),
            prefersDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
            stored: localStorage.getItem('color-theme'),
          })),
        )
        .toMatchObject({ dark: scheme === 'dark' });
      const api = new DesignApi(page.context());
      const project = await newProject(api, projectName, {
        'index.html': landingPage(),
      });

      await page.goto('/design');
      await expect(page.getByRole('heading', { name: 'Design', exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: new RegExp(projectName) })).toBeVisible();
      expect(await seriousViolations(page, 'main')).toEqual([]);
      await expectNoRawKeys(page, 'main');

      await page.getByRole('button', { name: 'Novo projeto' }).first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.waitForTimeout(400);
      expect(await seriousViolations(page, '[role="dialog"]')).toEqual([]);
      await expectNoRawKeys(page, '[role="dialog"]');
      await page.keyboard.press('Escape');

      await page.goto(`/design/${project.projectId}`);
      await waitForPreview(page);
      expect(
        await seriousViolations(page, '[data-testid="design-workspace"]', ['#design-panel-chat']),
      ).toEqual([]);
      await expectNoRawKeys(page, '[data-testid="design-workspace"]');
      for (const name of ['Versões', 'Exportar', 'Compartilhar']) {
        await page.getByTestId('design-workspace-actions').getByRole('button', { name }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await page.waitForTimeout(300);
        expect(await seriousViolations(page, '[role="dialog"]'), name).toEqual([]);
        await expectNoRawKeys(page, '[role="dialog"]');
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
      }

      await page.goto('/design/systems');
      await expect(
        page.getByRole('list', { name: 'Design systems' }).getByRole('listitem').first(),
      ).toBeVisible({
        timeout: 60_000,
      });
      expect(await seriousViolations(page, 'main')).toEqual([]);
      await expectNoRawKeys(page, 'main');
      await page.goto('/design/systems/etus');
      await expect(page.getByRole('heading', { name: 'Cores' })).toBeVisible({ timeout: 60_000 });
      expect(await seriousViolations(page, 'main')).toEqual([]);
      await expectNoRawKeys(page, 'main');
    });
  });
}
