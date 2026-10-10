import { expect, test } from '@playwright/test';
import { landingPage } from './fixtures/pages';
import { waitForModelRequest } from './support/services';
import {
  collapseChatMenu,
  composer,
  openWorkspace,
  setDevice,
  setMode,
  setZoom,
  waitForPreview,
  waitForProjectConversation,
} from './support/workspace';

test('C9: marks over the preview go to the chat as a real screenshot with the expected text', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const { project } = await openWorkspace(page, {
    name: 'Desenho C9',
    files: { 'index.html': landingPage() },
  });
  await waitForProjectConversation(page, project.projectId);
  await collapseChatMenu(page);
  await setDevice(page, 'Celular');
  await setZoom(page, '100%');
  await setMode(page, 'Desenhar');
  await waitForPreview(page);

  const canvas = page.getByLabel('Área de desenho sobre a prévia');
  await expect(canvas.first()).toBeVisible();
  await page.getByRole('button', { name: 'Retângulo', exact: true }).click();
  const area = await canvas.first().boundingBox();
  if (!area) throw new Error('drawing area not found');
  await page.mouse.move(area.x + 40, area.y + 120);
  await page.mouse.down();
  await page.mouse.move(area.x + 200, area.y + 180, { steps: 8 });
  await page.mouse.up();
  await page.getByLabel('O que você quer mudar?').fill('Aumentar o título');
  await page.getByRole('button', { name: 'Enviar ao chat', exact: true }).click();
  await expect(page.getByText('Imagem anexada ao chat. Revise e envie a mensagem.')).toBeVisible({
    timeout: 150_000,
  });
  await expect
    .poll(() => composer(page).inputValue())
    .toBe('Aumentar o título\n\nVeja as marcações na imagem e ajuste o arquivo index.html.');

  const text = await composer(page).inputValue();
  await expect(page.getByTestId('send-button')).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId('send-button').click();
  const line = `[Projeto Etus Design]: ${project.projectId}`;
  const seen = await waitForModelRequest(
    (request) => request.firstLine === line && request.last.startsWith(text),
  );
  expect(seen.lastImages).toBe(1);
});
