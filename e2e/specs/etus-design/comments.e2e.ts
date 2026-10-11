import { expect, test } from '@playwright/test';
import { landingPage } from './fixtures/pages';
import { waitForModelRequest } from './support/services';
import {
  clickInPreview,
  collapseChatMenu,
  composer,
  openWorkspace,
  setDevice,
  setMode,
  setZoom,
  waitForProjectConversation,
} from './support/workspace';

const EXPECTED = new RegExp(
  [
    '^Ajuste o arquivo index\\.html \\(versão 1\\) conforme estes comentários:',
    '1\\. \\[[^\\]\\n]*h1[^\\]\\n]*\\] "Landing Produto X": deixar mais curto e direto\\.',
    '2\\. \\[[^\\]\\n]*footer[^\\]\\n]*a:nth-of-type\\(2\\)\\] "Contato": trocar por WhatsApp\\.',
    'Ao terminar, marque cada comentário como resolvido\\.$',
  ].join('\\n'),
);

test('C-5: two comments are created and go to the chat composer in the 3.7 format', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const { api, project } = await openWorkspace(page, {
    name: 'Comentários C-5',
    files: { 'index.html': landingPage() },
  });
  await waitForProjectConversation(page, project.projectId);
  await collapseChatMenu(page);
  await setDevice(page, 'Celular');
  await setZoom(page, '100%');
  await setMode(page, 'Comentar');

  const box = page.getByTestId('comment-composer');
  for (const [selector, body] of [
    ['h1', 'deixar mais curto e direto.'],
    ['footer a:nth-of-type(2)', 'trocar por WhatsApp.'],
  ] as const) {
    await clickInPreview(page, selector);
    await expect(box).toBeVisible();
    await box.getByRole('textbox').fill(body);
    await box.getByRole('button', { name: 'Comentar' }).click();
    await expect(box).toHaveCount(0);
  }

  const panel = page.getByTestId('comment-panel');
  await panel.getByRole('button', { name: 'Enviar ao chat (2)' }).click();
  await expect.poll(() => composer(page).inputValue()).toMatch(EXPECTED);

  const stored = await api.comments(project.projectId, 'index.html');
  expect(stored).toHaveLength(2);
  for (const comment of stored) {
    expect(comment.status).toBe('open');
    expect(comment.sentToChatAt).toBeTruthy();
  }
  await expect(panel.getByText('Enviado ao chat').first()).toBeVisible();

  const text = await composer(page).inputValue();
  await page.getByTestId('send-button').click();
  const line = `[Projeto Etus Design]: ${project.projectId}`;
  const seen = await waitForModelRequest(
    (request) => request.firstLine === line && request.last === text,
  );
  expect(seen.userMessages).toBe(2);
});
