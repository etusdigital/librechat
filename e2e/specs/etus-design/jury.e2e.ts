import { expect, test, type Page } from '@playwright/test';
import { expectNoRawKeys, expectTheme, seriousViolations, useTheme } from './support/axe';
import { waitForModelRequest } from './support/services';
import { lowContrastPage } from './fixtures/pages';
import { loginAs, DesignApi, newProject } from './support/session';
import {
  noHorizontalScroll,
  openWorkspace,
  previewFrameOf,
  waitForProjectConversation,
} from './support/workspace';

const REVIEW_TIMEOUT = { timeout: 90_000 };
const juryPanel = (page: Page) => page.locator('#design-jury-panel');

test('D jury: review the page, show an item in the preview, ask the agent for fixes and hit the round limit', async ({
  page,
}) => {
  await useTheme(page, 'light');
  const { project } = await openWorkspace(page, {
    name: 'Júri D-5',
    files: { 'index.html': lowContrastPage() },
  });
  await expectTheme(page, 'light');
  await waitForProjectConversation(page, project.projectId);

  const button = page.getByTestId('design-jury-button');
  await expect(button).toHaveAccessibleName('Revisar com o júri');
  await button.click();
  const panel = juryPanel(page);
  await expect(panel.getByTestId('jury-running')).toHaveText(
    'O júri está revisando index.html. Isso leva cerca de 1 minuto.',
  );
  await expect(button).toHaveAttribute('aria-busy', 'true');

  await expect(panel.getByTestId('jury-score')).toHaveText('7,5', REVIEW_TIMEOUT);
  await expect(button).toHaveAttribute('aria-busy', 'false');
  await expect(panel.getByTestId('jury-verdict')).toHaveText('Abaixo da nota mínima de 8,0');
  await expect(panel.getByTestId('jury-dimension-visual')).toContainText('7,5');
  await expect(panel.getByTestId('jury-dimension-accessibility')).toContainText('6,0');
  await expect(panel.getByText('Rodada 1 de 2 nesta hora')).toBeVisible();

  const findings = panel.getByTestId('jury-must-fix').getByTestId('jury-finding');
  const axeItem = findings.filter({ hasText: 'Verificado pelo axe' }).first();
  await expect(axeItem).toContainText('Acessibilidade');
  await expect(findings.filter({ hasText: 'Título genérico demais para a oferta' })).toBeVisible();
  await expect(panel.getByTestId('jury-nice-to-have')).toContainText(
    'Espaço vertical irregular entre as seções',
  );
  await expect(
    panel.getByRole('img', { name: /^Captura no Celular, parte 1 de \d$/ }),
  ).toBeVisible();
  await expect(panel.getByText(/^Custo desta revisão: US\$\s0,0123$/)).toBeVisible();

  await axeItem.getByRole('button', { name: 'Ver na prévia' }).click();
  const frame = await previewFrameOf(page);
  await expect
    .poll(() =>
      frame.evaluate(() => {
        const overlay = document.querySelector<HTMLElement>('[data-etus-bridge="highlight"]');
        const cta = document.querySelector('a.cta');
        if (!overlay || !cta || overlay.style.display !== 'block') return false;
        const a = overlay.getBoundingClientRect();
        const b = cta.getBoundingClientRect();
        return Math.abs(a.left - b.left) < 2 && Math.abs(a.top - b.top) < 2;
      }),
    )
    .toBe(true);

  await panel.getByRole('button', { name: 'Pedir correções ao agente' }).click();
  const header =
    'Corrija o arquivo index.html conforme a revisão do júri (nota 7,5 de 10, rodada 1 de 2):';
  const asked = await waitForModelRequest((request) => request.last.startsWith(header));
  expect(asked.last).toContain('Acessibilidade');
  expect(asked.last).toContain('Título genérico demais para a oferta');
  expect(asked.last.split('\n').pop()).toBe(
    'Ao terminar, peça uma nova revisão do júri e me diga a nota nova e o que ficou como sugestão.',
  );
  expect(asked.last).not.toMatch(/[–—]/);
  await expect(panel.getByText('Pedido enviado ao agente.')).toBeVisible();

  await panel.getByRole('button', { name: 'Revisar de novo' }).click();
  await expect(panel.getByText('Rodada 2 de 2 nesta hora')).toBeVisible(REVIEW_TIMEOUT);
  await panel.getByRole('button', { name: 'Revisar de novo' }).click();
  await expect(panel.getByTestId('jury-round-limit')).toContainText(
    'index.html já passou pelo júri 2 vezes nesta hora. Tente de novo mais tarde.',
  );
  await expect(panel.getByTestId('jury-score')).toHaveText('7,5');
  await expect(panel.getByTestId('jury-review')).toBeDisabled();

  expect(await seriousViolations(page, '#design-jury-panel')).toEqual([]);
  expect(await seriousViolations(page, '[data-testid="design-workspace-actions"]')).toEqual([]);
  await expectNoRawKeys(page, '#design-jury-panel');
});

test('D jury mobile, dark: the review opens from the menu, stacks under the preview and passes axe', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await useTheme(page, 'dark');
  await openWorkspace(page, {
    name: 'Júri celular',
    files: { 'index.html': lowContrastPage() },
    waitPreview: false,
  });
  await expectTheme(page, 'dark');
  await page.getByRole('button', { name: 'Mais ações' }).click();
  await page.getByRole('menuitem', { name: 'Revisar com o júri' }).click();
  await expect(page.getByRole('tab', { name: 'Prévia' })).toHaveAttribute('aria-selected', 'true');
  const panel = juryPanel(page);
  await expect(panel).toHaveAttribute('data-layout', 'stacked');
  await expect(panel.getByTestId('jury-score')).toHaveText('7,5', REVIEW_TIMEOUT);
  expect(await noHorizontalScroll(page)).toBe(true);
  expect(await seriousViolations(page, '#design-jury-panel')).toEqual([]);
  await expectNoRawKeys(page, '#design-jury-panel');
});

test('D jury: hidden and refused without review.jury', async ({ page }) => {
  await loginAs(page, 'bia');
  const api = new DesignApi(page.context());
  const project = await newProject(api, 'Júri sem permissão', {
    'index.html': lowContrastPage(),
  });
  await page.goto(`/design/${project.projectId}`);
  await expect(page.getByTestId('design-plan-button')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('design-jury-button')).toHaveCount(0);
  const response = await api.raw('POST', `projects/${project.projectId}/reviews`, {
    json: { path: 'index.html' },
  });
  expect(response.status()).toBe(403);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
    'permission_required',
  );
});
