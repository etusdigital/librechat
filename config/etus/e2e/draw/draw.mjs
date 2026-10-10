import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';

const BASE = process.env.C9_BASE_URL ?? 'http://localhost:3189';
const LLM = process.env.C9_FAKE_LLM_URL ?? 'http://127.0.0.1:4809';
const SHOTS = process.env.C9_SCREENSHOTS;
const BRIDGE_JS = process.env.ETUS_DESIGN_BRIDGE_JS;
const EMAIL = process.env.C9_EMAIL ?? ['designer.c9', 'example.com'].join(String.fromCharCode(64));
const PASSWORD = 'c9-draw-password';
const PROJECT_ID = 'prj_c9e2e';
const NOTE = 'Aumentar o título e trocar a cor do botão';
const REFERENCE = 'Veja as marcações na imagem e ajuste o arquivo index.html.';
const EXPECTED_TEXT = `${NOTE}\n\n${REFERENCE}`;
const MOBILE = { width: 390, height: 844, scale: 3 };
const BACKGROUND = [229, 231, 235];
const MARK_BLUE = [59, 130, 246];

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`);
};

const html =
  '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Landing</title></head><body style="margin:0;font-family:sans-serif"><h1 style="margin:0;padding:24px">Landing Produto X</h1><p style="padding:0 24px">Rolagem</p><div style="height:3000px"></div></body></html>';
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

const JOB_STATUSES = ['queued', 'running', 'succeeded'];

const state = {
  screenshotRequests: [],
  jobPolls: new Map(),
  downloads: [],
  png: null,
};

const summary = () => ({
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
});

const json = (route, body, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

function jobView(jobId) {
  const polls = state.jobPolls.get(jobId) ?? 0;
  const done = polls >= 2;
  const download = `${BASE}/preview/d/c9-shot-${jobId}`;
  return {
    jobId,
    type: 'screenshot',
    projectId: PROJECT_ID,
    status: JOB_STATUSES[Math.min(polls, 2)],
    output: done
      ? { files: [{ device: 'mobile', fileName: 'screenshot-mobile.png', mime: 'image/png' }] }
      : null,
    error: null,
    costUsd: null,
    createdAt: '2026-10-10T12:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    downloadUrl: done ? download : null,
    downloads: done ? [{ fileName: 'screenshot-mobile.png', url: download, expiresAt: 'x' }] : [],
  };
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
  if (rest === `projects/${PROJECT_ID}` && method === 'GET') {
    return json(route, { ...summary(), files: [fileEntry] });
  }
  if (rest === `projects/${PROJECT_ID}/conversations` && method === 'POST') {
    return route.fulfill({ status: 204 });
  }
  if (/^conversations\/[^/]+\/project$/.test(rest)) {
    return json(route, summary());
  }
  if (rest === 'design-systems/etus') {
    return json(route, { id: 'etus', name: 'Etus', swatches: [], category: 'Produto' });
  }
  if (rest === `projects/${PROJECT_ID}/files`) {
    return json(route, { items: [fileEntry] });
  }
  if (rest === `projects/${PROJECT_ID}/changes`) {
    return json(route, {
      items: [fileEntry],
      paths: ['index.html'],
      projectUpdatedAt: '2026-10-10T12:00:00.000Z',
      until: new Date(Date.now() - 2000).toISOString(),
    });
  }
  if (rest === `projects/${PROJECT_ID}/preview-url`) {
    return json(route, {
      url: `${BASE}/preview/p/c9-preview-token/index.html`,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
  }
  if (rest === `projects/${PROJECT_ID}/screenshots` && method === 'POST') {
    const body = request.postDataJSON();
    const jobId = `job_c9${state.screenshotRequests.length}`;
    state.screenshotRequests.push(body);
    state.jobPolls.set(jobId, 0);
    return json(route, jobView(jobId), 202);
  }
  const jobMatch = /^jobs\/([^/]+)$/.exec(rest);
  if (jobMatch && state.jobPolls.has(jobMatch[1])) {
    state.jobPolls.set(jobMatch[1], state.jobPolls.get(jobMatch[1]) + 1);
    return json(route, jobView(jobMatch[1]));
  }
  return json(route, { error: { code: 'not_found' } }, 404);
}

async function preview(route) {
  const request = route.request();
  const headers = {
    'Content-Security-Policy': 'sandbox allow-scripts allow-forms allow-popups',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Cache-Control': 'private, no-store',
  };
  const url = new URL(request.url());
  if (url.pathname === '/preview/__etus/bridge.js') {
    return route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      headers,
      body: BRIDGE_JS ? fs.readFileSync(BRIDGE_JS, 'utf8') : '',
    });
  }
  if (url.pathname.startsWith('/preview/d/')) {
    state.downloads.push({ url: request.url(), headers: await request.allHeaders() });
    return route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: {
        ...headers,
        'Content-Disposition': 'attachment; filename="screenshot-mobile.png"',
      },
      body: state.png,
    });
  }
  const nonce = url.searchParams.get('bridge');
  const body = nonce
    ? html.replace(
        '</head>',
        `<script src="/preview/__etus/bridge.js" data-nonce="${nonce}"></script></head>`,
      )
    : html;
  return route.fulfill({ status: 200, contentType: 'text/html', headers, body });
}

const modelRequests = async () => (await fetch(`${LLM}/__requests`)).json();
const modelImages = async () => (await fetch(`${LLM}/__images`)).json();

async function register() {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Designer C9',
      username: 'designer_c9',
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

async function renderScreenshotPng(browser) {
  const context = await browser.newContext({
    viewport: { width: MOBILE.width, height: MOBILE.height },
    deviceScaleFactor: MOBILE.scale,
  });
  const p = await context.newPage();
  await p.setContent(
    `<body style="margin:0;background:rgb(${BACKGROUND.join(',')})"><div style="height:80px;background:rgb(17,24,39)"></div></body>`,
  );
  const png = await p.screenshot();
  await context.close();
  return png;
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
  if (process.env.C9_DEBUG) {
    p.on('console', (message) =>
      console.log('console', message.type(), message.text().slice(0, 300)),
    );
    p.on('request', (request) => {
      if (request.url().includes('/api/files')) {
        console.log('request', request.method(), request.url());
      }
    });
  }
  await p.goto(`${BASE}/login`);
  await p.fill('input[name="email"]', EMAIL);
  await p.fill('input[name="password"]', PASSWORD);
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/c\//, { timeout: 30000 });
  return p;
}

const noHorizontalScroll = (p) =>
  p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function waitForReplies(p, count) {
  await p.waitForFunction(
    (expected) =>
      (document.querySelector('[data-etus-design-chat]')?.textContent ?? '').split(
        'Projeto visto pelo modelo',
      ).length ===
      expected + 1,
    count,
    { timeout: 60000 },
  );
}

async function drawRect(p, from, to) {
  const canvas = p.getByTestId('design-draw-canvas');
  const box = await canvas.boundingBox();
  const factor = box.width / MOBILE.width;
  const at = ([x, y]) => [box.x + x * factor, box.y + y * factor];
  await p.mouse.move(...at(from));
  await p.mouse.down();
  await p.mouse.move(...at([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]), { steps: 4 });
  await p.mouse.move(...at(to), { steps: 4 });
  await p.mouse.up();
}

const panel = (p) => p.getByTestId('design-draw-panel');

const waitForAttachment = (p) =>
  p.waitForFunction(
    () => {
      const form = document.querySelector('#prompt-textarea')?.closest('form');
      const preview = form?.querySelector('[style*="background-image"]');
      return Boolean(preview && form.querySelector('button[aria-label="Remover arquivo"]'));
    },
    null,
    { timeout: 20000 },
  );

async function pixelsOf(p, dataUrl, points) {
  return p.evaluate(
    async ({ url, points: list }) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      return {
        width: image.naturalWidth,
        height: image.naturalHeight,
        pixels: list.map(([x, y]) => {
          const scale = image.naturalWidth / 390;
          return [...ctx.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data];
        }),
      };
    },
    { url: dataUrl, points },
  );
}

const near = (pixel, color, tolerance = 40) =>
  color.every((value, index) => Math.abs(pixel[index] - value) <= tolerance);

async function desktop(browser) {
  const context = await newContext(browser, { width: 1280, height: 800 });
  const p = await login(context);
  await p.goto(`${BASE}/design/${PROJECT_ID}`);
  await waitForReplies(p, 1);

  const toolbar = p.getByRole('toolbar', { name: 'Controles da prévia' });
  await toolbar.getByRole('button', { name: /^Celular/ }).click();
  const previewFrame = () => p.frames().find((frame) => frame.url().includes('/preview/p/'));
  await p.waitForFunction(
    () => !document.querySelector('[data-testid="design-device-frame"] [role="status"]'),
  );
  await p.waitForTimeout(500);
  await previewFrame().evaluate(() => window.scrollTo(0, 600));
  const scrolledBefore = await previewFrame().evaluate(() => window.scrollY);
  const frameBefore = await p.locator('iframe[title^="Prévia"]').getAttribute('src');
  await toolbar.getByRole('button', { name: 'Desenhar' }).click();
  await panel(p).waitFor();
  const frameAfter = await p.locator('iframe[title^="Prévia"]').getAttribute('src');
  await p.waitForFunction(
    () => !document.querySelector('[data-testid="design-device-frame"] [role="status"]'),
  );
  const scrolledAfter = await previewFrame().evaluate(() => window.scrollY);
  check(
    'Desenhar recarrega a prévia rolada e volta ao topo, como o screenshot',
    frameBefore !== frameAfter && scrolledBefore > 0 && scrolledAfter === 0,
    `scroll ${scrolledBefore} -> ${scrolledAfter}`,
  );
  const canvasBox = await p.getByTestId('design-draw-canvas').boundingBox();
  const viewportBox = await p.getByTestId('design-device-viewport').boundingBox();
  check(
    'canvas cobre exatamente o dispositivo atual, no zoom atual',
    Math.abs(canvasBox.width - viewportBox.width) < 1 &&
      Math.abs(canvasBox.height - viewportBox.height) < 1,
    `${JSON.stringify(canvasBox)} vs ${JSON.stringify(viewportBox)}`,
  );

  await panel(p).getByRole('button', { name: 'Retângulo' }).click();
  await panel(p).getByRole('radio', { name: 'Azul' }).click();
  await drawRect(p, [60, 200], [300, 400]);
  await panel(p).getByRole('button', { name: 'Seta' }).click();
  await drawRect(p, [40, 600], [200, 520]);
  await panel(p).getByRole('button', { name: 'Desfazer' }).click();
  check(
    'desenhar e desfazer',
    (await p.getByTestId('design-draw-canvas').getAttribute('data-shapes')) === '1',
  );
  await panel(p).getByLabel('O que você quer mudar?').fill(NOTE);
  await shot(p, 'desktop-drawing');

  const { violations } = await new AxeBuilder({ page: p })
    .include('[data-testid="design-draw-panel"]')
    .analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  check(
    'axe no painel de desenho sem violação séria',
    serious.length === 0,
    serious.map((v) => v.id).join(', '),
  );

  const uploads = [];
  p.on('response', (response) => {
    if (new URL(response.url()).pathname.startsWith('/api/files')) {
      uploads.push({ url: response.url(), status: response.status() });
    }
  });
  await panel(p).getByRole('button', { name: 'Enviar ao chat' }).click();
  await panel(p).getByText('Gerando a imagem da prévia com as marcações...').waitFor();
  await panel(p)
    .getByText(/Imagem anexada ao chat/)
    .waitFor({ timeout: 30000 });

  check(
    'pede o screenshot do dispositivo atual, sem página inteira',
    JSON.stringify(state.screenshotRequests[0]) ===
      JSON.stringify({ path: 'index.html', devices: ['mobile'], fullPage: false }),
    JSON.stringify(state.screenshotRequests),
  );
  check(
    'espera o job terminar antes de baixar',
    state.jobPolls.get('job_c90') === 2,
    String(state.jobPolls.get('job_c90')),
  );
  check(
    'baixa o PNG da prévia sem o cookie da sessão',
    state.downloads.length === 1 && !('cookie' in state.downloads[0].headers),
    JSON.stringify(state.downloads.map((d) => Object.keys(d.headers))),
  );
  const composer = await p.locator('#prompt-textarea').inputValue();
  check(
    'texto escrito e a referência ao arquivo no composer',
    composer === EXPECTED_TEXT,
    JSON.stringify(composer),
  );
  await waitForAttachment(p);
  check(
    'imagem enviada pelo upload do LibreChat',
    uploads.some((u) => u.status === 200 && /\/api\/files\/images/.test(u.url)),
    JSON.stringify(uploads),
  );
  check(
    'marcações limpas depois de anexar',
    (await p.getByTestId('design-draw-canvas').getAttribute('data-shapes')) === '0',
  );
  await shot(p, 'desktop-composer');

  const sendButton = p.getByTestId('send-button');
  await sendButton.waitFor();
  await p.waitForFunction(
    () => !document.querySelector('[data-testid="send-button"]')?.disabled,
    null,
    {
      timeout: 20000,
    },
  );
  await sendButton.click();
  await waitForReplies(p, 2);
  const requests = await modelRequests();
  const last = requests[requests.length - 1];
  check(
    'e2e: o modelo recebe a mensagem com o texto esperado',
    last?.last.startsWith(EXPECTED_TEXT) || last?.last.includes(EXPECTED_TEXT),
    JSON.stringify(last?.last),
  );
  check(
    'e2e: o modelo recebe uma imagem anexada',
    last?.lastImages === 1,
    String(last?.lastImages),
  );

  const [image] = (await modelImages()).slice(-1);
  if (image) {
    const result = await pixelsOf(p, image, [
      [60, 300],
      [180, 300],
      [180, 40],
    ]);
    check(
      'imagem é a captura do celular (proporção 390x844)',
      Math.abs(result.width / result.height - MOBILE.width / MOBILE.height) < 0.01,
      `${result.width}x${result.height}`,
    );
    check(
      'a marcação azul aparece por cima, no lugar desenhado',
      near(result.pixels[0], MARK_BLUE),
      JSON.stringify(result.pixels[0]),
    );
    check(
      'fora da marcação fica a captura da prévia',
      near(result.pixels[1], BACKGROUND, 12) && near(result.pixels[2], [17, 24, 39], 12),
      JSON.stringify(result.pixels.slice(1)),
    );
  } else {
    check('imagem recebida pelo modelo', false, 'nenhuma imagem');
  }
  await context.close();
}

async function mobile(browser) {
  const context = await newContext(browser, { width: 390, height: 844 }, 'dark');
  const p = await login(context);
  await p.goto(`${BASE}/design/${PROJECT_ID}`);
  await waitForReplies(p, 1);
  const tabs = p.getByRole('tablist');
  await tabs.getByRole('tab', { name: 'Prévia' }).click();
  await p
    .getByRole('toolbar', { name: 'Controles da prévia' })
    .getByRole('button', { name: 'Desenhar' })
    .click();
  await panel(p).waitFor();
  await p.waitForTimeout(300);
  await drawRect(p, [40, 100], [300, 260]);
  check(
    '390x844: desenha mesmo com a prévia recarregando por baixo',
    (await p.getByTestId('design-draw-canvas').getAttribute('data-shapes')) === '1',
  );
  check('390x844: sem rolagem horizontal no modo Desenhar', await noHorizontalScroll(p));
  await shot(p, 'mobile-drawing-dark');
  await panel(p).getByLabel('O que você quer mudar?').fill('Mais espaço aqui');
  await panel(p).getByRole('button', { name: 'Enviar ao chat' }).click();
  await p.waitForFunction(
    () => document.querySelector('#design-tab-chat')?.getAttribute('aria-selected') === 'true',
    null,
    { timeout: 30000 },
  );
  check('390x844: depois de anexar, a aba Chat abre', true);
  const composer = await p.locator('#prompt-textarea').inputValue();
  check(
    '390x844: composer com o texto e a referência',
    composer === `Mais espaço aqui\n\n${REFERENCE}`,
    JSON.stringify(composer),
  );
  await waitForAttachment(p);
  check('390x844: imagem anexada no composer', true);
  await shot(p, 'mobile-composer-dark');
  await context.close();
}

if (process.argv[2] === 'register') {
  await register();
  process.exit(0);
}

const browser = await chromium.launch();
try {
  state.png = await renderScreenshotPng(browser);
  await desktop(browser);
  await mobile(browser);
} finally {
  await browser.close();
}
const failed = results.filter((result) => !result.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
