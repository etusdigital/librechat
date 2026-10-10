import { expect, test, type Page } from '@playwright/test';
import { landingPage } from './fixtures/pages';
import { openWorkspace } from './support/workspace';

async function openAction(page: Page, name: 'Versões' | 'Exportar' | 'Compartilhar') {
  await page.getByTestId('design-workspace-actions').getByRole('button', { name }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test('C-7: restoring a version creates a new version with the old content', async ({ page }) => {
  const first = landingPage('Primeira versão');
  const { api, project } = await openWorkspace(page, {
    name: 'Versões C-7',
    files: { 'index.html': first },
  });
  await api.writeFile(project.projectId, 'index.html', landingPage('Segunda versão'), {
    source: 'agent',
  });
  const dialog = await openAction(page, 'Versões');
  const list = dialog.getByRole('list', { name: 'Versões do arquivo' });
  await expect(list.getByRole('button')).toHaveCount(2);
  await list.getByRole('button', { name: /^Versão 1 · Agente/ }).click();
  await dialog.getByRole('button', { name: 'Restaurar esta versão' }).click();
  const confirm = page.getByRole('dialog', { name: 'Restaurar a versão 1?' });
  await confirm.getByRole('button', { name: 'Restaurar esta versão' }).click();
  await expect(page.getByText('Versão 1 restaurada como versão 3.').first()).toBeVisible();

  const versions = await api.versions(project.projectId, 'index.html');
  expect(versions.items.map((item) => item.version).sort()).toEqual([1, 2, 3]);
  expect(versions.items.find((item) => item.version === 3)?.source).toBe('restore');
  expect(await api.readFile(project.projectId, 'index.html')).toBe(first);
});

test('C-8: PDF and ZIP download from the real design-service', async ({ page }) => {
  await openWorkspace(page, { name: 'Export C-8', files: { 'index.html': landingPage() } });
  const dialog = await openAction(page, 'Exportar');
  const formats = dialog.getByRole('list', { name: 'Formatos de exportação' });

  const pdfDownload = page.waitForEvent('download', { timeout: 150_000 });
  await formats.getByRole('button', { name: /^PDF Texto selecionável/ }).click();
  const pdf = await pdfDownload;
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  const pdfBytes = await (await pdf.createReadStream()).toArray();
  expect(Buffer.concat(pdfBytes).subarray(0, 5).toString()).toBe('%PDF-');
  await expect(dialog.getByText('PDF pronto. O download começou.')).toBeVisible();

  const zipDownload = page.waitForEvent('download', { timeout: 150_000 });
  await formats.getByRole('button', { name: /^ZIP/ }).click();
  const zip = await zipDownload;
  expect(zip.suggestedFilename()).toMatch(/\.zip$/);
  const zipBytes = Buffer.concat(await (await zip.createReadStream()).toArray());
  expect(zipBytes.subarray(0, 2).toString()).toBe('PK');
});

test('C-8: an option without permission stays disabled with the reason', async ({ page }) => {
  await openWorkspace(page, {
    persona: 'bia',
    name: 'Export sem PPTX',
    files: { 'index.html': landingPage() },
  });
  const dialog = await openAction(page, 'Exportar');
  const reason = 'Sua conta não tem permissão para exportar PPTX. Fale com a administração do hub';
  for (const name of [/^PPTX em imagem/, /^PPTX editável/]) {
    const option = dialog.getByRole('button', { name });
    await expect(option).toBeDisabled();
    await expect(option).toContainText(reason);
  }
  await expect(dialog.getByRole('button', { name: /^PDF Texto selecionável/ })).toBeEnabled();
});

test('C-9: the public link shows the preview without login and "Link expirado ou revogado" after revoking', async ({
  page,
  browser,
}) => {
  await openWorkspace(page, {
    name: 'Share C-9',
    files: { 'index.html': landingPage('Landing compartilhada') },
  });
  const dialog = await openAction(page, 'Compartilhar');
  await dialog.getByLabel('Validade').selectOption({ label: '7 dias' });
  await dialog.getByRole('button', { name: 'Criar link' }).click();
  const field = dialog.getByRole('textbox', { name: 'Link público' });
  await expect(field).toHaveValue(/^https:\/\/chat\.etus\.test\/preview\//);
  const link = await field.inputValue();

  const anonymous = await browser.newContext({ ignoreHTTPSErrors: true });
  const visitor = await anonymous.newPage();
  await visitor.goto(link);
  await expect(visitor.getByRole('heading', { name: 'Landing compartilhada' })).toBeVisible();
  await expect(visitor.getByText('Pedir ao agente', { exact: false })).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Revogar Link público' }).first().click();
  await page
    .getByRole('dialog', { name: 'Revogar o compartilhamento?' })
    .getByRole('button', { name: 'Revogar' })
    .click();
  await expect(page.getByText('Compartilhamento revogado.').first()).toBeVisible();
  await visitor.reload();
  await expect(visitor.getByText('Link expirado ou revogado.')).toBeVisible();
  await anonymous.close();
});
