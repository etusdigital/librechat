import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';

const BASE = process.env.C5_BASE_URL ?? 'http://localhost:3185';
const BRIDGE_JS = process.env.ETUS_DESIGN_BRIDGE_JS;
const SHOTS = process.env.C5_SCREENSHOTS;
const EMAIL = process.env.C5_EMAIL ?? ['designer.c5', 'example.com'].join(String.fromCharCode(64));
const PASSWORD = 'c5-workspace-password';
const PROJECT_ID = 'prj_c5e2e';
const PREVIEW_TOKEN = 'c5-preview-token';
const PREVIEW_PATH = `/preview/p/${PREVIEW_TOKEN}/`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`);
};

const page = (heading) => `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Landing</title><link rel="stylesheet" href="styles.css"></head>
<body><main><h1>${heading}</h1><p id="vw"></p></main>
<script>document.getElementById('vw').textContent = innerWidth + 'x' + innerHeight;</script>
</body></html>`;

const files = new Map([
  ['index.html', { mime: 'text/html', body: page('Landing Produto X') }],
  [
    'styles.css',
    {
      mime: 'text/css',
      body: 'body { font-family: sans-serif; margin: 0; }\nh1 { color: #3be476; }\n',
    },
  ],
  ['README.md', { mime: 'text/markdown', body: '# Landing\n\nTexto **em negrito**.\n' }],
  [
    'assets/logo.svg',
    {
      mime: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30" fill="#3be476"/></svg>',
    },
  ],
]);

const sha = (body) => crypto.createHash('sha256').update(body).digest('hex');
const entryOf = (filePath) => {
  const file = files.get(filePath);
  return {
    path: filePath,
    mime: file.mime,
    size: Buffer.byteLength(file.body),
    sha256: sha(file.body),
    version: 1,
    updatedAt: '2026-10-10T12:00:00.000Z',
    updatedBy: 'designer',
  };
};
const fileList = () => [...files.keys()].map(entryOf);
const COPY_ID = 'prj_c5copy';
const projectNames = new Map([[PROJECT_ID, 'Landing Produto X']]);
const project = (projectId = PROJECT_ID) => ({
  projectId,
  name: projectNames.get(projectId),
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
  files: fileList(),
});

const json = (route, body, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const bridgeRequests = [];

async function designApi(route) {
  const url = new URL(route.request().url());
  let rest = url.pathname.replace(/^\/api\/etus\/design\//, '');
  const method = route.request().method();
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
    return json(route, { id: 'etus', name: 'Etus' });
  }
  if (rest === 'projects' && method === 'GET') {
    const { files: _files, ...summary } = project();
    return json(route, { items: [summary], nextCursor: null });
  }
  if (rest === 'templates') {
    return json(route, { items: [] });
  }
  if (rest === 'design-systems') {
    return json(route, { items: [], nextCursor: null, total: 0, categories: [] });
  }
  const projectMatch = /^projects\/(prj_[a-z0-9]+)$/.exec(rest);
  if (projectMatch && projectNames.has(projectMatch[1]) && method === 'GET') {
    return json(route, project(projectMatch[1]));
  }
  if (rest === `projects/${PROJECT_ID}/duplicate` && method === 'POST') {
    projectNames.set(COPY_ID, route.request().postDataJSON().name);
    const { files: _files, ...copy } = project(COPY_ID);
    return json(route, copy, 201);
  }
  const scoped = /^projects\/(prj_[a-z0-9]+)\/(.+)$/.exec(rest);
  if (scoped && scoped[1] === COPY_ID) {
    rest = `projects/${PROJECT_ID}/${scoped[2]}`;
  }
  if (rest === `projects/${PROJECT_ID}/files`) {
    return json(route, { items: fileList() });
  }
  if (rest === `projects/${PROJECT_ID}/changes`) {
    return json(route, {
      items: fileList(),
      paths: [...files.keys()],
      projectUpdatedAt: '2026-10-10T12:00:00.000Z',
      until: new Date(Date.now() - 2000).toISOString(),
    });
  }
  if (rest === `projects/${PROJECT_ID}/preview-url`) {
    const body = route.request().postDataJSON() ?? {};
    return json(route, {
      url: `${BASE}${PREVIEW_PATH}${body.path ?? 'index.html'}`,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
  }
  if (rest === `projects/${PROJECT_ID}/files/content`) {
    const file = files.get(url.searchParams.get('path'));
    if (!file) {
      return json(route, { error: { code: 'file_not_found' } }, 404);
    }
    return route.fulfill({
      status: 200,
      contentType: file.mime,
      headers: {
        'X-Etus-Mime': file.mime,
        'X-Etus-Version': '1',
        ETag: `"${sha(file.body)}"`,
      },
      body: file.body,
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
      body: BRIDGE_JS ? fs.readFileSync(BRIDGE_JS, 'utf8') : '',
    });
  }
  const filePath = decodeURIComponent(url.pathname.slice(PREVIEW_PATH.length));
  const file = files.get(filePath);
  if (!file) {
    return route.fulfill({ status: 404, headers: PREVIEW_HEADERS, body: 'not found' });
  }
  let body = file.body;
  const nonce = url.searchParams.get('bridge');
  if (file.mime === 'text/html' && nonce) {
    bridgeRequests.push(nonce);
    body = body.replace(
      '</head>',
      `<script src="/preview/__etus/bridge.js" data-nonce="${nonce}"></script></head>`,
    );
  }
  return route.fulfill({ status: 200, contentType: file.mime, headers: PREVIEW_HEADERS, body });
}

async function register() {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Designer C5',
      username: 'designer_c5',
      email: EMAIL,
      password: PASSWORD,
      confirm_password: PASSWORD,
    }),
  });
  console.log('register status', res.status);
}

async function noHorizontalScroll(p) {
  return p.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
}

async function previewFrame(p) {
  const handle = await p.waitForSelector('iframe[title="Prévia de index.html"]', {
    timeout: 20000,
  });
  const frame = await handle.contentFrame();
  await frame.waitForSelector('#vw', { state: 'attached', timeout: 20000 });
  await frame.waitForFunction(() => document.getElementById('vw')?.textContent);
  return { handle, frame };
}

async function axe(p, label) {
  const { violations } = await new AxeBuilder({ page: p })
    .include('[data-testid="design-workspace"]')
    .exclude('iframe')
    .analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  check(
    `axe ${label}: sem violação séria`,
    serious.length === 0,
    serious
      .map(
        (v) =>
          `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target} ${v.nodes[0]?.any?.[0]?.message ?? ''}`,
      )
      .join('; '),
  );
}

async function shot(p, name) {
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await p.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  }
}

async function login(context) {
  const p = await context.newPage();
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
  return p;
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

async function desktop(browser) {
  const context = await newContext(browser, { width: 1280, height: 800 });
  const p = await login(context);
  await p.goto(`${BASE}/design/${PROJECT_ID}`);
  await p.getByTestId('design-workspace').waitFor({ timeout: 30000 });
  const { handle, frame } = await previewFrame(p);

  check(
    '1280x800: layout dividido',
    (await p.getByTestId('design-workspace').getAttribute('data-layout')) === 'split',
  );
  const chatBox = await p.getByRole('region', { name: 'Chat com o agente' }).boundingBox();
  const workBox = await p.getByRole('region', { name: 'Área de trabalho' }).boundingBox();
  check(
    '1280x800: chat à esquerda com 440 px e área de trabalho à direita',
    chatBox &&
      workBox &&
      Math.round(chatBox.width) === 440 &&
      workBox.x >= chatBox.x + chatBox.width,
    JSON.stringify({ chat: chatBox?.width, workX: workBox?.x }),
  );
  check('1280x800: sem rolagem horizontal', await noHorizontalScroll(p));
  await axe(p, '1280x800 prévia');

  const sandbox = await handle.getAttribute('sandbox');
  check(
    'iframe sem allow-same-origin',
    sandbox === 'allow-scripts allow-forms allow-popups',
    sandbox,
  );
  const src = await handle.getAttribute('src');
  const nonce = new URL(src).searchParams.get('bridge');
  check('iframe com nonce da ponte na URL', /^[A-Za-z0-9_-]{16,128}$/.test(nonce ?? ''), src);
  check('ponte injetada com o mesmo nonce', bridgeRequests.includes(nonce));
  const origin = await frame.evaluate(() => window.origin);
  check('documento da prévia com origem opaca', origin === 'null', origin);

  for (const [label, device, width, height] of [
    ['Celular (390 x 844)', 'mobile', 390, 844],
    ['Tablet (820 x 1180)', 'tablet', 820, 1180],
    ['Desktop (1440 x 900)', 'desktop', 1440, 900],
  ]) {
    await p.getByRole('button', { name: label }).click();
    await p.waitForFunction(
      (d) => document.querySelector('[data-testid="design-device-frame"]')?.dataset.device === d,
      device,
    );
    const inner = await frame.evaluate(() => [innerWidth, innerHeight]);
    check(
      `C-6 ${device}: viewport interno ${width}x${height}`,
      inner[0] === width && inner[1] === height,
      inner.join('x'),
    );
    await shot(p, `desktop-${device}`);
  }

  await p.getByRole('button', { name: 'Celular (390 x 844)' }).click();
  const zoom = p.getByRole('combobox', { name: 'Zoom' });
  for (const [value, scale] of [
    ['0.5', 0.5],
    ['0.75', 0.75],
    ['1', 1],
    ['1.25', 1.25],
    ['1.5', 1.5],
  ]) {
    await zoom.selectOption(value);
    await p.waitForTimeout(150);
    const inner = await frame.evaluate(() => innerWidth);
    const box = await handle.boundingBox();
    check(
      `C-6 zoom ${value}: layout interno igual e escala ${scale}`,
      inner === 390 && Math.abs(box.width - 390 * scale) < 1.5,
      `innerWidth=${inner} box=${box.width.toFixed(1)}`,
    );
  }
  await zoom.selectOption('fit');
  await p.waitForTimeout(150);
  const fitBox = await handle.boundingBox();
  const stageBox = await p.getByTestId('design-preview-stage').boundingBox();
  check(
    'C-6 ajustar: cabe na área da prévia',
    fitBox.height <= stageBox.height && fitBox.width <= stageBox.width,
    `${fitBox.width.toFixed(0)}x${fitBox.height.toFixed(0)} em ${stageBox.width.toFixed(0)}x${stageBox.height.toFixed(0)}`,
  );
  check(
    'C-6 ajustar: viewport interno continua 390',
    (await frame.evaluate(() => innerWidth)) === 390,
  );
  await shot(p, 'desktop-fit-mobile');

  await p.getByRole('button', { name: 'Livre' }).click();
  await p.waitForTimeout(150);
  const freeInner = await frame.evaluate(() => innerWidth);
  const freeStage = await p.getByTestId('design-preview-stage').boundingBox();
  check(
    'dispositivo livre ocupa a área',
    Math.abs(freeInner - (freeStage.width - 32)) <= 2,
    `${freeInner} vs ${freeStage.width}`,
  );

  const before = await handle.getAttribute('src');
  files.set('index.html', { mime: 'text/html', body: page('Landing atualizada pelo agente') });
  await p.waitForFunction(
    (previous) =>
      document.querySelector('iframe[title="Prévia de index.html"]')?.getAttribute('src') !==
      previous,
    before,
    { timeout: 30000 },
  );
  const updated = await previewFrame(p);
  const heading = await updated.frame.textContent('h1');
  check(
    'consulta de mudanças recarrega a prévia',
    heading === 'Landing atualizada pelo agente',
    heading,
  );

  await p.getByRole('button', { name: 'Mostrar arquivos' }).click();
  await p.getByRole('button', { name: 'styles.css', exact: true }).click();
  const code = await p.getByRole('region', { name: 'Código de styles.css' }).textContent();
  check('código só leitura com o conteúdo do arquivo', code.includes('#3be476'));
  await shot(p, 'desktop-code');
  await p.getByRole('button', { name: 'README.md', exact: true }).click();
  await p.getByRole('heading', { name: 'Landing', exact: true }).waitFor();
  check('markdown em leitura', true);
  await p.getByRole('button', { name: 'logo.svg', exact: true }).click();
  const img = p.getByRole('img', { name: 'logo.svg' });
  await img.waitFor();
  check('imagem na visualização de mídia', (await img.evaluate((el) => el.naturalWidth)) === 64);
  await shot(p, 'desktop-media');
  await axe(p, '1280x800 gaveta e mídia');
  check('1280x800: sem rolagem horizontal com a gaveta aberta', await noHorizontalScroll(p));

  await p.getByRole('button', { name: 'Mais ações' }).click();
  await p.getByRole('menuitem', { name: 'Duplicar' }).click();
  const duplicate = p.getByRole('dialog', { name: 'Duplicar projeto' });
  await duplicate.getByRole('textbox', { name: 'Nome da cópia' }).fill('Landing B');
  await duplicate.getByRole('button', { name: 'Duplicar' }).click();
  await p.waitForURL(`${BASE}/design/${COPY_ID}`, { timeout: 15000 });
  await p.getByRole('heading', { level: 1, name: 'Landing B' }).waitFor({ timeout: 15000 });
  const copyFrame = await previewFrame(p);
  check(
    'Duplicar abre design/:projectId da cópia com a prévia',
    copyFrame.handle !== null && p.url().endsWith(`/design/${COPY_ID}`),
    p.url(),
  );

  await p.goto(`${BASE}/design`);
  await p
    .getByRole('link', { name: /Landing Produto X/ })
    .first()
    .click();
  await p.waitForURL(`${BASE}/design/${PROJECT_ID}`, { timeout: 15000 });
  await p.getByRole('heading', { level: 1, name: 'Landing Produto X' }).waitFor();
  check(
    'card do Início abre design/:projectId',
    p.url().endsWith(`/design/${PROJECT_ID}`),
    p.url(),
  );
  await context.close();
}

async function mobile(browser, colorScheme) {
  const context = await newContext(browser, { width: 390, height: 844 }, colorScheme);
  const p = await login(context);
  await p.goto(`${BASE}/design/${PROJECT_ID}`);
  await p.getByTestId('design-workspace').waitFor({ timeout: 30000 });
  const suffix = colorScheme === 'dark' ? ' (escuro)' : '';

  check(
    `390x844${suffix}: layout em abas`,
    (await p.getByTestId('design-workspace').getAttribute('data-layout')) === 'compact',
  );
  const tabs = p.getByRole('tablist', { name: 'Seções do projeto' });
  const names = await tabs.getByRole('tab').allTextContents();
  check(
    `390x844${suffix}: abas Chat, Prévia e Arquivos`,
    names.join('|') === 'Chat|Prévia|Arquivos',
    names.join('|'),
  );
  await p.getByTestId('design-chat-slot').evaluate((el) => {
    el.dataset.marker = 'kept';
  });
  check(`390x844${suffix}: aba Chat sem rolagem horizontal`, await noHorizontalScroll(p));
  const header = await p.evaluate(() => {
    const element = document.querySelector('[data-testid="design-workspace"] header');
    const controls = [...element.querySelectorAll('a, button, h1')].map((node) =>
      node.getBoundingClientRect(),
    );
    const title = element.querySelector('h1').getBoundingClientRect();
    return {
      inside: controls.every((rect) => rect.left >= 0 && rect.right <= innerWidth + 0.5),
      title: title.width,
    };
  });
  check(
    `390x844${suffix}: cabeçalho cabe na tela com as ações`,
    header.inside && header.title >= 60,
    `nome com ${Math.round(header.title)} px`,
  );
  await shot(p, `mobile-chat${suffix}`);
  await axe(p, `390x844${suffix} chat`);

  await tabs.getByRole('tab', { name: 'Prévia' }).click();
  const { frame } = await previewFrame(p);
  const inner = await frame.evaluate(() => innerWidth);
  check(`390x844${suffix}: prévia abre no celular (390)`, inner === 390, String(inner));
  check(`390x844${suffix}: aba Prévia sem rolagem horizontal`, await noHorizontalScroll(p));
  const chatHidden = await p
    .getByTestId('design-chat-slot')
    .evaluate((el) => el.offsetParent === null);
  check(`390x844${suffix}: chat escondido e montado`, chatHidden);
  await shot(p, `mobile-preview${suffix}`);
  await axe(p, `390x844${suffix} prévia`);

  await tabs.getByRole('tab', { name: 'Arquivos' }).click();
  await p.getByRole('navigation', { name: 'Arquivos do projeto' }).waitFor();
  check(`390x844${suffix}: aba Arquivos sem rolagem horizontal`, await noHorizontalScroll(p));
  await shot(p, `mobile-files${suffix}`);
  await axe(p, `390x844${suffix} arquivos`);
  await p.getByRole('button', { name: 'styles.css', exact: true }).click();
  const selected = await tabs.getByRole('tab', { name: 'Prévia' }).getAttribute('aria-selected');
  check(`390x844${suffix}: abrir arquivo leva à aba Prévia`, selected === 'true');

  await tabs.getByRole('tab', { name: 'Chat' }).click();
  const marker = await p.getByTestId('design-chat-slot').getAttribute('data-marker');
  check(`390x844${suffix}: o mesmo chat continua montado`, marker === 'kept');
  await context.close();
}

if (process.argv[2] === 'register') {
  await register();
  process.exit(0);
}

const browser = await chromium.launch();
try {
  await desktop(browser);
  await mobile(browser, 'light');
  await mobile(browser, 'dark');
} finally {
  await browser.close();
}
const failed = results.filter((result) => !result.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
