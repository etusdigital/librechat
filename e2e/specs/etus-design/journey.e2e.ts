import { expect, test } from '@playwright/test';
import { landingPage } from './fixtures/pages';
import { CHAT, PROJECT_LINE_PREFIX } from './support/env';
import { modelRequests, waitForAgentSeed, waitForModelRequest } from './support/services';
import { DesignApi, loginAs } from './support/session';
import { composer, preview, PREVIEW_FRAME } from './support/workspace';

const BRIEF = 'landing para pequenas empresas, com preços e depoimentos';
const STEPS = ['Adicionar seção de FAQ', 'Trocar a cor do botão principal', 'Exportar em PDF'];

test('C-10 and section 4: a project from a template, the brief to the agent, next steps and resuming on another device', async ({
  page,
  browser,
}, testInfo) => {
  const name = `Landing Produto X ${testInfo.project.name}`;
  await loginAs(page, 'ana');
  await waitForAgentSeed();
  await page.goto('/design');
  await page.getByRole('button', { name: 'Novo projeto' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Passo 1 de 4: Tipo')).toBeVisible();
  await expect(dialog.getByRole('radio', { name: /Protótipo/ })).toBeChecked();
  await dialog.getByRole('button', { name: 'Continuar' }).click();
  await expect(dialog.getByText('Passo 2 de 4: Template')).toBeVisible();
  const previews = dialog.getByRole('button', { name: /^Ver prévia de / });
  await expect(previews.first()).toBeVisible();
  const templateName = ((await previews.first().getAttribute('aria-label')) ?? '').replace(
    'Ver prévia de ',
    '',
  );
  await previews.first().click();
  const templateFrame = page.getByTitle(`Prévia do template ${templateName}`);
  await expect(templateFrame).toHaveAttribute('sandbox', 'allow-scripts');
  await page.getByRole('button', { name: 'Usar este template' }).click();
  await dialog.getByRole('button', { name: 'Continuar' }).click();
  await expect(dialog.getByText('Passo 3 de 4: Design system')).toBeVisible();
  await dialog.getByRole('button', { name: 'Continuar' }).click();
  await expect(dialog.getByText('Passo 4 de 4: Nome e pedido')).toBeVisible();
  await dialog.getByLabel('Nome do projeto').fill(name);
  await dialog.getByLabel('Descreva o que você quer (opcional)').fill(BRIEF);
  await dialog.getByRole('button', { name: 'Criar projeto' }).click();

  await expect(page).toHaveURL(/\/design\/prj_[A-Za-z0-9_-]+$/);
  const projectId = new URL(page.url()).pathname.split('/').at(-1) ?? '';
  const line = `${PROJECT_LINE_PREFIX}${projectId}`;
  const first = await waitForModelRequest((request) => request.firstLine === line);
  expect(first.model).toBe('cc/claude-sonnet-5');
  expect(first.first).toBe(`${line}\n\n${BRIEF}`);
  const chat = page.locator('#design-panel-chat');
  await expect(chat.getByText(BRIEF)).toBeVisible();
  await expect(chat.getByText(PROJECT_LINE_PREFIX)).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).search, { timeout: 30_000 }).toBe('');

  const api = new DesignApi(page.context());
  await expect
    .poll(async () => (await api.conversations(projectId)).items.length, { timeout: 60_000 })
    .toBe(1);
  const conversationId = (await api.conversations(projectId)).items[0].conversationId;

  const chips = page.getByRole('navigation', { name: 'Próximos passos sugeridos' });
  for (const step of STEPS) {
    await expect(chips.getByRole('button', { name: step })).toBeVisible({ timeout: 60_000 });
  }
  await chips.getByRole('button', { name: STEPS[1] }).click();
  const second = await waitForModelRequest(
    (request) => request.firstLine === line && request.last === STEPS[1],
  );
  expect(second.userMessages).toBe(2);

  await api.writeFile(projectId, 'index.html', landingPage('Página do agente'), {
    source: 'agent',
  });
  await expect(preview(page).getByRole('heading', { name: 'Página do agente' })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator(PREVIEW_FRAME)).toHaveAttribute(
    'sandbox',
    /^allow-scripts allow-forms allow-popups$/,
  );

  await expect(chips.getByRole('button', { name: STEPS[0] })).toBeVisible({ timeout: 60_000 });
  const before = (await modelRequests()).filter((request) => request.firstLine === line).length;
  const other = await browser.newContext({
    baseURL: CHAT,
    ignoreHTTPSErrors: true,
    locale: 'pt-BR',
    viewport: { width: 1440, height: 900 },
  });
  const phone = await other.newPage();
  await loginAs(phone, 'ana');
  await phone.goto(`/design/${projectId}`);
  const resumed = phone.locator('#design-panel-chat');
  await expect(resumed.getByText(BRIEF)).toBeVisible({ timeout: 60_000 });
  await expect(resumed.getByText(STEPS[1]).first()).toBeVisible();
  await expect(composer(phone)).toBeVisible();
  await phone.waitForTimeout(3_000);
  expect((await modelRequests()).filter((request) => request.firstLine === line).length).toBe(
    before,
  );
  expect((await new DesignApi(other).conversations(projectId)).items[0].conversationId).toBe(
    conversationId,
  );
  await other.close();
});
