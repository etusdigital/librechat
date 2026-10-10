import { expect, test } from '@playwright/test';
import { landingPage } from './fixtures/pages';
import {
  clickInPreview,
  collapseChatMenu,
  openWorkspace,
  previewFrameOf,
  setDevice,
  setMode,
  setZoom,
} from './support/workspace';

test('C-4: editing text and color saves an inline_edit version and a conflict offers both options', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const original = landingPage();
  const { api, project } = await openWorkspace(page, {
    name: 'Edição C-4',
    files: { 'index.html': original },
  });
  await collapseChatMenu(page);
  await setDevice(page, 'Celular');
  await setZoom(page, '100%');
  await setMode(page, 'Editar');
  await expect(page.getByTestId('inspect-panel')).toBeVisible();

  let frame = await clickInPreview(page, 'h1');
  const text = page.getByRole('textbox', { name: 'Texto do elemento' });
  await expect(text).toHaveValue('Landing Produto X');
  await text.fill('Landing editada');
  await expect
    .poll(() => frame.evaluate(() => document.querySelector('h1')?.textContent))
    .toBe('Landing editada');
  const color = page.getByRole('textbox', { name: 'Cor do texto' });
  await color.fill('#ff0000');
  await color.press('Enter');
  await expect
    .poll(() => frame.evaluate(() => getComputedStyle(document.querySelector('h1')!).color))
    .toBe('rgb(255, 0, 0)');

  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Edição salva na versão 2')).toBeVisible();
  const saved = await api.readFile(project.projectId, 'index.html');
  expect(saved).toBe(
    original.replace(
      '<h1>Landing Produto X</h1>',
      '<h1 style="color: #ff0000">Landing editada</h1>',
    ),
  );
  const versions = await api.versions(project.projectId, 'index.html');
  expect(versions.items.find((item) => item.version === 2)?.source).toBe('inline_edit');
  expect(versions.items.find((item) => item.version === 1)?.source).toBe('agent');

  frame = await clickInPreview(page, '#lead');
  await expect(text).toHaveValue('Software simples para pequenas empresas.');
  await text.fill('Para empresas de todos os tamanhos');
  const agentVersion = saved.replace(
    '<footer>',
    '<section id="faq"><h2>FAQ</h2></section>\n    <footer>',
  );
  await api.writeFile(project.projectId, 'index.html', agentVersion, { source: 'agent' });
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  const conflict = page.getByTestId('inspect-conflict');
  await expect(conflict).toBeVisible({ timeout: 30_000 });
  await expect(conflict.getByText('O arquivo mudou enquanto você editava')).toBeVisible();
  await expect(conflict.getByRole('button', { name: 'Recarregar', exact: true })).toBeVisible();
  await conflict.getByRole('button', { name: 'Aplicar de novo sobre a versão nova' }).click();
  await expect(page.getByText('Edição salva na versão 4')).toBeVisible();
  const merged = await api.readFile(project.projectId, 'index.html');
  expect(merged).toContain('<section id="faq"><h2>FAQ</h2></section>');
  expect(merged).toContain('<p id="lead">Para empresas de todos os tamanhos</p>');
  frame = await previewFrameOf(page);
  await expect.poll(() => frame.evaluate(() => document.querySelector('#faq') != null)).toBe(true);
});
