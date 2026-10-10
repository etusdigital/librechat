import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';

const BASE = process.env.C6_BASE_URL ?? 'http://localhost:3186';
const LLM = process.env.C6_FAKE_LLM_URL ?? 'http://127.0.0.1:4799';
const SHOTS = process.env.C6_SCREENSHOTS;
const EMAIL = process.env.C6_EMAIL ?? ['designer.c6', 'example.com'].join(String.fromCharCode(64));
const PASSWORD = 'c6-chat-password';
const PROJECT_ID = 'prj_c6e2e';
const PROJECT_NAME = 'Landing Produto X';
const BRIEF = 'landing para pequenas empresas, com preços e depoimentos';
const PROJECT_LINE = `[Projeto Etus Design]: ${PROJECT_ID}`;
const PREVIEW_PATH = '/preview/p/c6-preview-token/';
const STEPS = ['Adicionar seção de FAQ', 'Trocar a cor do botão principal', 'Exportar em PDF'];

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`);
};

const html =
  '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Landing</title></head><body><h1>Landing Produto X</h1></body></html>';
const sha = (body) => crypto.createHash('sha256').update(body).digest('hex');
const fileEntry = {
  path: 'index.html',
  mime: 'text/html',
  size: Buffer.byteLength(html),
  sha256: sha(html),
  version: 1,
  updatedAt: '2026-10-10T12:00:00.000Z',
  updatedBy: 'designer',
};

const state = { created: false, bindings: new Map(), bindCalls: [], lookups: [], changes: [] };

const summary = () => ({
  projectId: PROJECT_ID,
  name: PROJECT_NAME,
  kind: 'prototype',
  designSystemId: 'etus',
  entryFile: 'index.html',
  templateId: null,
  tags: [],
  owner: { sub: 'designer', name: 'Designer' },
  access: 'owner',
  canWrite: true,
  createdAt: '2026-10-10T12:00:00.000Z',
  updatedAt: '2026-10-10T12:00:00.000Z',
});

const system = (id, name, swatches) => ({
  id,
  name,
  category: 'Produto',
  summary: `${name} design system`,
  license: 'MIT',
  hasComponents: false,
  thumbnailUrl: null,
  swatches,
  headingFont: 'Inter',
});
const SYSTEMS = [
  system('etus', 'Etus', ['#0b0b0b', '#3be476', '#ffffff', '#1f2937', '#9ca3af']),
  system('airbnb', 'Airbnb', ['#ff385c', '#222222', '#ffffff', '#717171', '#f7f7f7']),
];

const json = (route, body, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function designApi(route) {
  const request = route.request();
  const url = new URL(request.url());
  const rest = url.pathname.replace(/^\/api\/etus\/design\//, '');
  const method = request.method();
  if (rest === 'me') {
    return json(route, {
      sub: 'designer',
      name: 'Designer',
      orgId: 'org_1',
      permissions: ['projects.use'],
      defaultDesignSystem: 'etus',
    });
  }
  if (rest === 'templates') {
    return json(route, { items: [] });
  }
  if (rest === 'design-systems') {
    return json(route, { items: SYSTEMS, nextCursor: null, total: SYSTEMS.length, categories: [] });
  }
  const systemMatch = /^design-systems\/([a-z]+)$/.exec(rest);
  if (systemMatch) {
    const found = SYSTEMS.find((item) => item.id === systemMatch[1]);
    return found ? json(route, found) : json(route, { error: { code: 'not_found' } }, 404);
  }
  if (rest === 'projects' && method === 'GET') {
    return json(route, { items: state.created ? [summary()] : [], nextCursor: null });
  }
  if (rest === 'projects' && method === 'POST') {
    state.created = true;
    return json(route, summary(), 201);
  }
  if (rest === `projects/${PROJECT_ID}` && method === 'GET') {
    return json(route, { ...summary(), files: [fileEntry] });
  }
  if (rest === `projects/${PROJECT_ID}/conversations` && method === 'POST') {
    const { conversationId } = request.postDataJSON();
    state.bindCalls.push(conversationId);
    state.bindings.set(conversationId, PROJECT_ID);
    return route.fulfill({ status: 204 });
  }
  const lookup = /^conversations\/([^/]+)\/project$/.exec(rest);
  if (lookup) {
    state.lookups.push(lookup[1]);
    return state.bindings.has(lookup[1])
      ? json(route, summary())
      : json(route, { error: { code: 'not_found' } }, 404);
  }
  if (rest === `projects/${PROJECT_ID}/files`) {
    return json(route, { items: [fileEntry] });
  }
  if (rest === `projects/${PROJECT_ID}/changes`) {
    state.changes.push(Date.now());
    return json(route, {
      items: [fileEntry],
      paths: ['index.html'],
      projectUpdatedAt: '2026-10-10T12:00:00.000Z',
      until: new Date(Date.now() - 2000).toISOString(),
    });
  }
  if (rest === `projects/${PROJECT_ID}/preview-url`) {
    return json(route, {
      url: `${BASE}${PREVIEW_PATH}index.html`,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
  }
  if (rest === `projects/${PROJECT_ID}/files/content`) {
    return route.fulfill({
      status: 200,
      contentType: 'text/html',
      headers: { 'X-Etus-Mime': 'text/html', 'X-Etus-Version': '1', ETag: `"${sha(html)}"` },
      body: html,
    });
  }
  return json(route, { error: { code: 'not_found' } }, 404);
}

async function preview(route) {
  return route.fulfill({
    status: 200,
    contentType: 'text/html',
    headers: {
      'Content-Security-Policy': 'sandbox allow-scripts allow-forms allow-popups',
      'Cache-Control': 'private, no-store',
    },
    body: html,
  });
}

const modelRequests = async () => (await fetch(`${LLM}/__requests`)).json();

async function register() {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Designer C6',
      username: 'designer_c6',
      email: EMAIL,
      password: PASSWORD,
      confirm_password: PASSWORD,
    }),
  });
  console.log('register status', res.status);
}

async function shot(p, name) {
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await p.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  }
}

async function newContext(browser, viewport, colorScheme = 'light') {
  const context = await browser.newContext({
    viewport,
    locale: 'pt-BR',
    colorScheme,
    serviceWorkers: 'block',
  });
  await context.route('**/api/etus/design/**', designApi);
  await context.route('**/preview/**', preview);
  return context;
}

async function login(context) {
  const p = await context.newPage();
  p.on('pageerror', (error) => console.log('pageerror', error.message));
  await p.goto(`${BASE}/login`);
  await p.fill('input[name="email"]', EMAIL);
  await p.fill('input[name="password"]', PASSWORD);
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/c\//, { timeout: 30000 });
  return p;
}

const chat = (p) => p.locator('[data-etus-design-chat]');
const chips = (p) => p.getByRole('navigation', { name: 'Próximos passos sugeridos' });
const noHorizontalScroll = (p) =>
  p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function waitForReply(p, count) {
  await p.waitForFunction(
    (expected) =>
      document
        .querySelector('[data-etus-design-chat]')
        ?.textContent?.split('Projeto visto pelo modelo').length ===
      expected + 1,
    count,
    { timeout: 60000 },
  );
  await chips(p).waitFor({ timeout: 30000 });
}

async function createProject(p) {
  await p.goto(`${BASE}/design`);
  await p.getByRole('button', { name: 'Novo projeto' }).first().click();
  const dialog = p.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Continuar' }).click();
  await dialog.getByText('Passo 2 de 4: Template').waitFor();
  await dialog.getByRole('button', { name: 'Continuar' }).click();
  await dialog.getByText('Passo 3 de 4: Design system').waitFor();
  await dialog.getByRole('button', { name: 'Continuar' }).click();
  await dialog.getByLabel('Nome do projeto').fill(PROJECT_NAME);
  await dialog.getByLabel('Descreva o que você quer (opcional)').fill(BRIEF);
  await dialog.getByRole('button', { name: 'Criar projeto' }).click();
  await p.waitForURL(`**/design/${PROJECT_ID}`, { timeout: 30000 });
}

async function desktop(browser) {
  const context = await newContext(browser, { width: 1280, height: 800 });
  const p = await login(context);
  await createProject(p);
  await waitForReply(p, 1);

  const [first] = await modelRequests();
  check(
    'primeira linha que chega ao modelo é a do projeto',
    first?.firstLine === PROJECT_LINE,
    first?.firstLine,
  );
  check(
    'primeira mensagem leva a linha, uma linha em branco e o pedido do C4',
    first?.first === `${PROJECT_LINE}\n\n${BRIEF}`,
    JSON.stringify(first?.first),
  );
  check(
    'agente Etus Design responde (modelo do agente)',
    first?.model === 'cc/claude-sonnet-5',
    first?.model,
  );
  const shown = await chat(p).innerText();
  check(
    'conversa mostra o pedido e esconde a linha do projeto',
    shown.includes(BRIEF) && !shown.includes('Projeto Etus Design]'),
  );
  check(
    'a URL continua na tela do projeto, sem os parâmetros do chat',
    new URL(p.url()).pathname === `/design/${PROJECT_ID}` && new URL(p.url()).search === '',
    p.url(),
  );
  const deadline = Date.now() + 10000;
  while (state.bindCalls.length === 0 && Date.now() < deadline) {
    await p.waitForTimeout(200);
  }
  const conversationId = state.bindCalls[0];
  check(
    'conversa vinculada ao projeto depois da primeira resposta',
    state.bindCalls.length === 1 && /^[0-9a-f-]{36}$/.test(conversationId ?? ''),
    String(state.bindCalls),
  );
  const hidden = await chat(p).evaluate((element) =>
    ['header-new-chat-button', 'model-selector-button'].every((id) =>
      [...element.querySelectorAll(`[data-testid="${id}"]`)].every(
        (node) => node.offsetParent === null,
      ),
    ),
  );
  check('"Novo chat" e o seletor de modelo escondidos no chat embutido', hidden);

  const buttons = chips(p).getByRole('button');
  const labels = await buttons.allInnerTexts();
  check(
    'C-10: 3 sugestões da última resposta',
    JSON.stringify(labels) === JSON.stringify(STEPS),
    JSON.stringify(labels),
  );
  await shot(p, 'desktop-first-reply');
  const { violations } = await new AxeBuilder({ page: p })
    .include('[data-testid="design-next-steps"]')
    .analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  check(
    'axe nas sugestões sem violação séria',
    serious.length === 0,
    serious.map((v) => v.id).join(', '),
  );

  const clickedAt = Date.now();
  await buttons.nth(1).click();
  await p.waitForTimeout(3600);
  const stillResponding = (await chips(p).count()) === 0;
  const fastPoll = state.changes.some((at) => at > clickedAt + 500);
  check(
    'consulta de mudanças acelera enquanto o agente responde (useIsResponding)',
    stillResponding && fastPoll,
    `respondendo=${stillResponding} consulta=${fastPoll}`,
  );
  await waitForReply(p, 2);
  const requests = await modelRequests();
  const second = requests[1];
  check(
    'C-10: clicar envia o texto da sugestão na mesma conversa',
    requests.length === 2 &&
      second.last === STEPS[1] &&
      second.firstLine === PROJECT_LINE &&
      second.userMessages === 2,
    JSON.stringify(second),
  );
  check(
    'sem novo vínculo na segunda resposta',
    state.bindCalls.length === 1,
    String(state.bindCalls),
  );

  await p.locator('#prompt-textarea').fill('meu rascunho');
  await p.waitForTimeout(1500);
  await p.goto(`${BASE}/design/${PROJECT_ID}?applyDesignSystem=airbnb`);
  await waitForReply(p, 2);
  check(
    'ao reabrir, consulta o vínculo da conversa guardada',
    state.lookups.includes(conversationId),
    String(state.lookups),
  );
  await p.waitForFunction(
    () =>
      document.querySelector('#prompt-textarea')?.value.includes('Aplique o design system Airbnb'),
    null,
    { timeout: 20000 },
  );
  const composer = await p.locator('#prompt-textarea').inputValue();
  check(
    'pedido da galeria entra no composer sem apagar o rascunho',
    composer === 'meu rascunho\n\nAplique o design system Airbnb',
    JSON.stringify(composer),
  );
  check('parâmetro da galeria sai da URL', !p.url().includes('applyDesignSystem'), p.url());
  check('retomar não manda mensagem nova ao modelo', (await modelRequests()).length === 2);
  check(
    'retoma a mesma conversa (2 respostas na tela)',
    (await chat(p).innerText()).split('Projeto visto pelo modelo').length === 3,
  );
  await shot(p, 'desktop-resumed');
  await p.locator('#prompt-textarea').fill('');
  await p.waitForTimeout(1500);

  await p.setViewportSize({ width: 390, height: 844 });
  await p.reload();
  await waitForReply(p, 2);
  const tabs = p.getByRole('tablist');
  check('390x844: sugestões na aba Chat', await chips(p).isVisible());
  check('390x844: sem rolagem horizontal com as sugestões', await noHorizontalScroll(p));
  await shot(p, 'mobile-chat');
  await tabs.getByRole('tab', { name: 'Prévia' }).click();
  await tabs.getByRole('tab', { name: 'Chat' }).click();
  check(
    '390x844: conversa continua a mesma depois de trocar de aba',
    (await chat(p).innerText()).split('Projeto visto pelo modelo').length === 3,
  );
  await context.close();
}

async function otherBrowser(browser) {
  const before = (await modelRequests()).length;
  const context = await newContext(browser, { width: 1280, height: 800 }, 'dark');
  const p = await login(context);
  await p.goto(`${BASE}/design/${PROJECT_ID}`);
  await waitForReply(p, 1);
  const requests = await modelRequests();
  const latest = requests[requests.length - 1];
  check(
    'outro navegador sem conversa guardada abre conversa nova do projeto com o texto padrão',
    requests.length === before + 1 &&
      latest.first === `${PROJECT_LINE}\n\nVamos trabalhar neste projeto.`,
    JSON.stringify(latest?.first),
  );
  await shot(p, 'desktop-dark-new-conversation');
  await context.close();
}

if (process.argv[2] === 'register') {
  await register();
  process.exit(0);
}

const browser = await chromium.launch();
try {
  await desktop(browser);
  await otherBrowser(browser);
} finally {
  await browser.close();
}
const failed = results.filter((result) => !result.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
