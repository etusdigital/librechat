import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';

const BASE = process.env.C8_BASE_URL ?? 'http://localhost:3188';
const BRIDGE_JS = process.env.ETUS_DESIGN_BRIDGE_JS;
const SHOTS = process.env.C8_SCREENSHOTS;
const EMAIL = process.env.C8_EMAIL ?? ['designer.c8', 'example.com'].join(String.fromCharCode(64));
const PASSWORD = 'c8-inline-edit-password';
const PROJECT_ID = 'prj_c8e2e';
const PREVIEW_PATH = '/preview/p/c8-preview-token/';
const FRAME_TITLE = 'Prévia de index.html';

const results = [];
const pages = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`);
};

const ORIGINAL = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Landing</title>
  <style>:root { --accent: #3be476; } body { font-family: sans-serif; margin: 24px; } h1 { color: #151514; }</style>
</head>
<body>
  <main>
    <h1>Landing Produto X</h1>
    <p class="lead">Para pequenas empresas</p>
    <button id="cta" style="padding: 8px">Começar</button>
  </main>
</body>
</html>
`;

const sha = (body) => crypto.createHash('sha256').update(body).digest('hex');
const file = { body: ORIGINAL, version: 1 };
const writes = [];

const entry = () => ({
  path: 'index.html',
  mime: 'text/html',
  size: Buffer.byteLength(file.body),
  sha256: sha(file.body),
  version: file.version,
  updatedAt: '2026-10-10T12:00:00.000Z',
  updatedBy: 'designer',
});

const project = () => ({
  projectId: PROJECT_ID,
  name: 'Landing Produto X',
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
  files: [entry()],
});

const designSystem = {
  id: 'etus',
  name: 'Etus',
  category: 'Etus',
  colors: [
    { name: 'accent', cssVar: '--accent', value: '#3be476' },
    { name: 'fg', cssVar: '--fg', value: '#151514' },
  ],
  typography: {
    families: [],
    weights: [400, 700],
    scale: [{ name: 'text-3xl', cssVar: '--text-3xl', value: '48px' }],
    leading: [],
    tracking: [],
  },
  tokensCss: ':root { --space-4: 16px; --radius-md: 12px; }',
};

const json = (route, body, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

function agentWrites(body) {
  file.body = body;
  file.version += 1;
}

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
  if (rest === 'design-systems/etus') {
    return json(route, designSystem);
  }
  if (rest === `projects/${PROJECT_ID}`) {
    return json(route, project());
  }
  if (rest === `projects/${PROJECT_ID}/files`) {
    return json(route, { items: [entry()] });
  }
  if (rest === `projects/${PROJECT_ID}/changes`) {
    return json(route, {
      items: [entry()],
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
  if (rest === `projects/${PROJECT_ID}/files/versions`) {
    return json(route, { items: [] });
  }
  if (rest === `projects/${PROJECT_ID}/files/content` && method === 'GET') {
    return route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      headers: {
        'X-Etus-Mime': 'text/html',
        'X-Etus-Version': String(file.version),
        ETag: `"${sha(file.body)}"`,
      },
      body: file.body,
    });
  }
  if (rest === `projects/${PROJECT_ID}/files/content` && method === 'PUT') {
    const headers = request.headers();
    const body = request.postData() ?? '';
    writes.push({ headers, body });
    if (headers['if-match'] !== `"${sha(file.body)}"`) {
      return json(route, { error: { code: 'precondition_failed' } }, 412);
    }
    agentWrites(body);
    return json(route, {
      path: 'index.html',
      version: file.version,
      sha256: sha(body),
      size: Buffer.byteLength(body),
    });
  }
  return json(route, { error: { code: 'not_found' } }, 404);
}

const PREVIEW_HEADERS = {
  'Content-Security-Policy': 'sandbox allow-scripts allow-forms allow-popups',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'private, no-store',
};

async function preview(route) {
  const url = new URL(route.request().url());
  if (url.pathname === '/preview/__etus/bridge.js') {
    return route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      headers: PREVIEW_HEADERS,
      body: fs.readFileSync(BRIDGE_JS, 'utf8'),
    });
  }
  const nonce = url.searchParams.get('bridge');
  const body = nonce
    ? file.body.replace(
        '</head>',
        `<script src="/preview/__etus/bridge.js" data-nonce="${nonce}"></script></head>`,
      )
    : file.body;
  return route.fulfill({ status: 200, contentType: 'text/html', headers: PREVIEW_HEADERS, body });
}

async function register() {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Designer C8',
      username: 'designer_c8',
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

async function axe(p, label) {
  const { violations } = await new AxeBuilder({ page: p })
    .include('[data-testid="inspect-panel"]')
    .analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  check(
    `axe ${label}: sem violação séria`,
    serious.length === 0,
    serious.map((v) => `${v.id}: ${v.nodes[0]?.target}`).join('; '),
  );
}

async function open(browser, viewport, colorScheme = 'light') {
  const context = await browser.newContext({
    viewport,
    locale: 'pt-BR',
    colorScheme,
    serviceWorkers: 'block',
  });
  await context.route('**/api/etus/design/**', designApi);
  await context.route('**/preview/**', preview);
  const p = await context.newPage();
  pages.push(p);
  p.on('pageerror', (error) => {
    if (!error.message.includes("'serviceWorker' property")) {
      console.log('pageerror', error.message);
    }
  });
  await p.goto(`${BASE}/login`);
  await p.fill('input[name="email"]', EMAIL);
  await p.fill('input[name="password"]', PASSWORD);
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/c\//, { timeout: 30000 });
  await p.goto(`${BASE}/design/${PROJECT_ID}`);
  await p.getByTestId('design-workspace').waitFor({ timeout: 30000 });
  return { context, p };
}

async function previewFrame(p) {
  const handle = await p.waitForSelector(`iframe[title="${FRAME_TITLE}"]`, { timeout: 20000 });
  const frame = await handle.contentFrame();
  await frame.waitForFunction(() => document.documentElement.hasAttribute('data-etus-mode'), null, {
    timeout: 20000,
  });
  return frame;
}

async function clickInFrame(p, selector) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const frame = await previewFrame(p);
      await frame.click(selector, { timeout: 5000 });
      return frame;
    } catch (error) {
      if (attempt === 3) {
        throw error;
      }
      await p.waitForTimeout(500);
    }
  }
  return null;
}

async function enterEdit(p) {
  await p.getByRole('button', { name: 'Celular (390 x 844)' }).click();
  await p.getByRole('combobox', { name: 'Zoom' }).selectOption('1');
  await p.getByRole('button', { name: 'Editar', exact: true }).click();
  await p.getByTestId('inspect-panel').waitFor();
  return previewFrame(p);
}

const textField = (p) => p.getByRole('textbox', { name: 'Texto do elemento' });

async function desktop(browser) {
  const { context, p } = await open(browser, { width: 1600, height: 1000 });
  let frame = await enterEdit(p);
  check('modo Editar abre o painel', await p.getByTestId('inspect-panel').isVisible());

  frame = await clickInFrame(p, 'h1');
  await textField(p).waitFor();
  check(
    'clicar no título mostra o texto atual',
    (await textField(p).inputValue()) === 'Landing Produto X',
  );
  await textField(p).fill('Landing editada');
  await frame.waitForFunction(() => document.querySelector('h1').textContent === 'Landing editada');
  check('texto muda ao vivo na prévia', true);

  await p.getByText('Valores do design system (2)').first().click();
  await p
    .getByRole('list', { name: 'Valores do design system para Cor do texto' })
    .getByRole('button', { name: 'accent' })
    .click();
  const color = await frame.evaluate(() => getComputedStyle(document.querySelector('h1')).color);
  check('cor do design system aplicada ao vivo', color === 'rgb(59, 228, 118)', color);
  await shot(p, 'desktop-editing');
  await axe(p, '1600x1000 painel');

  const unsafe = p.getByRole('textbox', { name: 'Cor de fundo' });
  await unsafe.fill('url(https://evil.test/x.png)');
  await unsafe.press('Enter');
  check('valor perigoso recusado no campo', (await unsafe.getAttribute('aria-invalid')) === 'true');
  const background = await frame.evaluate(
    () => document.querySelector('h1').getAttribute('style') ?? '',
  );
  check('valor perigoso não chega à prévia', !background.includes('url('), background);
  await unsafe.fill('');
  await unsafe.press('Escape');

  await p.getByRole('button', { name: 'Salvar', exact: true }).click();
  await p.getByText('Edição salva na versão 2').waitFor({ timeout: 15000 });
  const saved = writes.at(-1);
  check(
    'C-4: gravação com If-Match da versão aberta e origem inline_edit',
    saved.headers['if-match'] === `"${sha(ORIGINAL)}"` &&
      saved.headers['x-etus-version-source'] === 'inline_edit',
    JSON.stringify({
      ifMatch: saved.headers['if-match'],
      source: saved.headers['x-etus-version-source'],
    }),
  );
  const expected = ORIGINAL.replace(
    '<h1>Landing Produto X</h1>',
    '<h1 style="color: var(--accent, #3be476)">Landing editada</h1>',
  );
  check('C-4: HTML gravado é o esperado (só o título mudou)', saved.body === expected);
  frame = await previewFrame(p);
  check(
    'prévia recarrega com a versão salva',
    (await frame.textContent('h1')) === 'Landing editada',
  );

  frame = await clickInFrame(p, 'p.lead');
  await textField(p).waitFor();
  await textField(p).fill('Para empresas de todos os tamanhos');
  const agentVersion = file.body.replace(
    '</main>',
    '  <footer>Feito pelo agente</footer>\n  </main>',
  );
  agentWrites(agentVersion);
  await p.getByRole('button', { name: 'Salvar', exact: true }).click();
  const conflict = p.getByTestId('inspect-conflict');
  await conflict.waitFor({ timeout: 15000 });
  const options = await conflict.getByRole('button').allTextContents();
  check(
    'C-4: conflito mostra as duas opções',
    options.join('|') === 'Recarregar|Aplicar de novo sobre a versão nova',
    options.join('|'),
  );
  check(
    'conflito avisa que o arquivo mudou',
    await conflict.getByText('O arquivo mudou enquanto você editava').isVisible(),
  );
  await shot(p, 'desktop-conflict');
  await axe(p, '1600x1000 conflito');
  await conflict.getByRole('button', { name: 'Aplicar de novo sobre a versão nova' }).click();
  await p.getByText('Edição salva na versão 4').waitFor({ timeout: 15000 });
  const rebased = writes.at(-1);
  check(
    'C-4: aplicar de novo grava sobre a versão do agente',
    rebased.headers['if-match'] === `"${sha(agentVersion)}"` &&
      rebased.body ===
        agentVersion.replace(
          '<p class="lead">Para pequenas empresas</p>',
          '<p class="lead">Para empresas de todos os tamanhos</p>',
        ),
  );

  frame = await clickInFrame(p, '#cta');
  await p.getByRole('textbox', { name: 'Espaço interno' }).waitFor();
  check(
    'estilo inline do código aparece no campo',
    (await p.getByRole('textbox', { name: 'Espaço interno' }).inputValue()) === '8px',
  );
  await textField(p).fill('Assinar');
  agentWrites(file.body.replace('Feito pelo agente', 'Feito de novo pelo agente'));
  const before = writes.length;
  await p.getByTestId('inspect-conflict').waitFor({ timeout: 40000 });
  check(
    'conflito aparece sozinho quando o agente grava durante a edição',
    writes.length === before,
  );
  await p.getByRole('button', { name: 'Recarregar', exact: true }).click();
  frame = await previewFrame(p);
  await frame.waitForFunction(
    () => document.querySelector('footer')?.textContent === 'Feito de novo pelo agente',
  );
  check(
    'Recarregar descarta a edição e mostra a versão nova',
    (await frame.textContent('#cta')) === 'Começar' && writes.length === before,
  );
  await context.close();
}

async function mobile(browser, colorScheme) {
  const { context, p } = await open(browser, { width: 390, height: 844 }, colorScheme);
  const suffix = colorScheme === 'dark' ? ' (escuro)' : '';
  await p
    .getByRole('tablist', { name: 'Seções do projeto' })
    .getByRole('tab', { name: 'Prévia' })
    .click();
  await enterEdit(p);
  await clickInFrame(p, 'h1');
  await textField(p).waitFor();
  const fits = await p.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  check(`390x844${suffix}: painel sem rolagem horizontal`, fits);
  const panel = await p.getByTestId('inspect-panel').boundingBox();
  check(
    `390x844${suffix}: painel cabe na largura`,
    panel && panel.x >= 0 && panel.x + panel.width <= 390.5,
  );
  await shot(p, `mobile-editing${suffix}`);
  await axe(p, `390x844${suffix} painel`);
  await context.close();
}

if (process.argv[2] === 'register') {
  await register();
  process.exit(0);
}
if (!BRIDGE_JS) {
  console.error('ETUS_DESIGN_BRIDGE_JS is required');
  process.exit(2);
}

const browser = await chromium.launch();
try {
  await desktop(browser);
  await mobile(browser, 'light');
  await mobile(browser, 'dark');
} catch (error) {
  const last = pages.at(-1);
  if (last && !last.isClosed()) {
    const panel = await last
      .getByTestId('inspect-panel')
      .innerText()
      .catch(() => '');
    console.log('panel on failure:', panel);
    await shot(last, 'failure');
  }
  throw error;
} finally {
  await browser.close();
}
const failed = results.filter((result) => !result.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
