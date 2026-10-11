import { expect, test, type Page } from '@playwright/test';
import { expectNoRawKeys, expectTheme, seriousViolations, useTheme } from './support/axe';
import { noHorizontalScroll, openWorkspace, waitForPreview } from './support/workspace';
import { DesignApi, gotoPath, loginAs, newProject } from './support/session';
import { landingPage } from './fixtures/pages';
import { agent } from './support/mcp';

const STEPS = ['Capa', 'Agenda', 'Resultados', 'Próximos passos'];
const IDLE_POLL = { timeout: 30_000 };

const planPanel = (page: Page) => page.locator('#design-plan-panel');
const steps = (page: Page) => planPanel(page).getByTestId('plan-item');

async function statuses(page: Page) {
  return steps(page).evaluateAll((items) => items.map((item) => item.getAttribute('data-status')));
}

test('D-3: the Plan panel opens and checks the steps off as the agent moves on, without a reload', async ({
  page,
  request,
}) => {
  await useTheme(page, 'light');
  const { project } = await openWorkspace(page, {
    name: 'Plano D-3',
    files: { 'index.html': landingPage() },
  });
  await expectTheme(page, 'light');
  const button = page.getByTestId('design-plan-button');
  await expect(button).toHaveAccessibleName('Plano');
  await button.click();
  await expect(planPanel(page).getByText(/^Ainda não há plano\./)).toBeVisible();
  await planPanel(page).getByRole('button', { name: 'Fechar o painel Plano' }).click();
  await expect(planPanel(page)).toHaveCount(0);

  const tools = agent(request);
  const saved = await tools.savePlan(project.projectId, STEPS);
  expect(saved.items.map((item) => item.id)).toEqual(['i1', 'i2', 'i3', 'i4']);

  await expect(planPanel(page)).toBeVisible(IDLE_POLL);
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(planPanel(page).getByText('Editorial sóbrio')).toBeVisible();
  await expect(steps(page)).toHaveText(STEPS.map((title) => new RegExp(`^${title}`)));
  expect(await statuses(page)).toEqual(['pending', 'pending', 'pending', 'pending']);
  await expect(page.getByTestId('design-plan-announcement')).toHaveText('Novo plano com 4 etapas.');

  await tools.updateItem(saved.planId, 'i1', 'done');
  await tools.updateItem(saved.planId, 'i2', 'in_progress');
  await expect
    .poll(() => statuses(page), IDLE_POLL)
    .toEqual(['done', 'in_progress', 'pending', 'pending']);
  await expect(steps(page).nth(1)).toHaveAttribute('aria-current', 'step');
  await expect(planPanel(page).getByTestId('plan-progress')).toHaveText('1 de 4 etapas concluídas');
  await expect(button).toHaveAccessibleName('Plano, 1 de 4 etapas concluídas');

  await tools.updateItem(saved.planId, 'i2', 'done');
  await tools.updateItem(saved.planId, 'i3', 'done', 'Gráfico de receita por trimestre');
  await tools.updateItem(saved.planId, 'i4', 'skipped');
  await expect.poll(() => statuses(page), IDLE_POLL).toEqual(['done', 'done', 'done', 'skipped']);
  await expect(planPanel(page).getByText('Gráfico de receita por trimestre')).toBeVisible();
  await expect(planPanel(page).getByTestId('plan-progress')).toHaveText('4 de 4 etapas concluídas');
  await expect(button).toContainText('4/4');

  expect(await seriousViolations(page, '#design-plan-panel')).toEqual([]);
  expect(await seriousViolations(page, '[data-testid="design-workspace-actions"]')).toEqual([]);
  await expectNoRawKeys(page, '#design-plan-panel');
});

test('D-3 tablet, dark: the Plan panel fits the tablet and passes axe', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await useTheme(page, 'dark');
  await loginAs(page, 'ana');
  const project = await newProject(new DesignApi(page.context()), 'Plano tablet', {
    'index.html': landingPage(),
  });
  const saved = await agent(request).savePlan(project.projectId, STEPS);
  await agent(request).updateItem(saved.planId, 'i1', 'in_progress');
  await gotoPath(page, `/design/${project.projectId}`);
  await waitForPreview(page);
  await expectTheme(page, 'dark');

  const button = page.getByTestId('design-plan-button');
  await expect(button).toHaveAccessibleName('Plano, 0 de 4 etapas concluídas');
  await button.click();
  await expect(planPanel(page)).toHaveAttribute('data-layout', 'drawer');
  await expect(steps(page)).toHaveCount(4);
  await expect(steps(page).first()).toHaveAttribute('data-status', 'in_progress');
  expect(await noHorizontalScroll(page)).toBe(true);
  const panel = await planPanel(page).boundingBox();
  const viewport = page.viewportSize();
  expect(panel && viewport && panel.x + panel.width <= viewport.width + 1).toBe(true);

  expect(await seriousViolations(page, '#design-plan-panel')).toEqual([]);
  await expectNoRawKeys(page, '#design-plan-panel');
  await planPanel(page).getByRole('button', { name: 'Fechar o painel Plano' }).press('Escape');
  await expect(planPanel(page)).toHaveCount(0);
});

test('D-3 mobile: the Plan panel opens from the menu under the preview', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAs(page, 'ana');
  const project = await newProject(new DesignApi(page.context()), 'Plano celular', {
    'index.html': landingPage(),
  });
  await agent(request).savePlan(project.projectId, STEPS);
  await gotoPath(page, `/design/${project.projectId}`);
  await expect(page.getByTestId('design-workspace')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Mais ações' }).click();
  await page.getByRole('menuitem', { name: 'Plano' }).click();
  await expect(page.getByRole('tab', { name: 'Prévia' })).toHaveAttribute('aria-selected', 'true');
  await expect(planPanel(page)).toHaveAttribute('data-layout', 'stacked');
  await expect(steps(page)).toHaveCount(4);
  expect(await noHorizontalScroll(page)).toBe(true);
  expect(await seriousViolations(page, '#design-plan-panel')).toEqual([]);
});
