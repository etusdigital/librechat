import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';

const BASE = process.env.C7_BASE_URL ?? 'http://localhost:3187';
const LLM = process.env.C7_FAKE_LLM_URL ?? 'http://127.0.0.1:4801';
const BRIDGE_JS = process.env.ETUS_DESIGN_BRIDGE_JS;
const SHOTS = process.env.C7_SCREENSHOTS;
const EMAIL = process.env.C7_EMAIL ?? ['designer.c7', 'example.com'].join(String.fromCharCode(64));
const PASSWORD = 'c7-comments-password';
const PROJECT_ID = 'prj_c7e2e';
const PROJECT_NAME = 'Landing Produto X';
const PREVIEW_PATH = '/preview/p/c7-preview-token/';
const VERSION = 4;
const HERO = 'body > section:nth-of-type(1) > h1:nth-of-type(1)';
const CONTACT = 'body > footer:nth-of-type(1) > a:nth-of-type(2)';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`);
};

const html = [
  '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Landing</title>',
  '<style>body{margin:0;font-family:sans-serif}section{padding:48px 24px}h1{margin:0;font-size:40px}',
  'footer{display:flex;gap:16px;padding:24px}</style></head>',
  '<body><section class="hero"><h1>Título atual</h1><p>Landing para pequenas empresas.</p></section>',
  '<footer><a href="#sobre">Sobre</a><a href="#contato">Contato</a></footer></body></html>',
].join('');
const sha = (body) => crypto.createHash('sha256').update(body).digest('hex');
const fileEntry = {
  path: 'index.html',
  mime: 'text/html',
  size: Buffer.byteLength(html),
  sha256: sha(html),
  version: VERSION,
  updatedAt: '2026-10-10T12:00:00.000Z',
  updatedBy: 'designer',
};

const state = { comments: [], creates: [], patches: [], bindings: new Map(), next: 1 };

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

const json = (route, body, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

function createComment(input) {
  const comment = {
    commentId: `cmt_c7e2e${String(state.next).padStart(4, '0')}`,
    projectId: PROJECT_ID,
    path: input.path,
    version: input.version,
    anchor: input.anchor,
    body: input.body.trim(),
    authorSub: 'designer',
    authorName: 'Designer',
    status: 'open',
    resolvedBy: null,
    resolvedNote: null,
    sentToChatAt: null,
    createdAt: new Date(Date.UTC(2026, 9, 10, 12, state.next)).toISOString(),
  };
  state.next += 1;
  state.comments.push(comment);
  return comment;
}

function patchComment(commentId, patch) {
  const comment = state.comments.find((item) => item.commentId === commentId);
  if (!comment) {
    return null;
  }
  if (patch.status === 'resolved') {
    Object.assign(comment, { status: 'resolved', resolvedBy: 'designer' });
  }
  if (patch.status === 'open') {
    Object.assign(comment, { status: 'open', resolvedBy: null, resolvedNote: null });
  }
  if (patch.sentToChat === true) {
    comment.sentToChatAt = new Date().toISOString();
  }
  return comment;
}

function resolveAsAgent(note) {
  state.comments
    .filter((comment) => comment.status === 'open')
    .forEach((comment) =>
      Object.assign(comment, { status: 'resolved', resolvedBy: 'agent', resolvedNote: note }),
    );
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
    return json(route, { id: 'etus', name: 'Etus' });
  }
  if (rest === `projects/${PROJECT_ID}` && method === 'GET') {
    return json(route, { ...summary(), files: [fileEntry] });
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
      url: `${BASE}${PREVIEW_PATH}index.html`,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
  }
  if (rest === `projects/${PROJECT_ID}/comments` && method === 'GET') {
    const filter = url.searchParams.get('path');
    return json(
      route,
      state.comments.filter((comment) => !filter || comment.path === filter),
    );
  }
  if (rest === `projects/${PROJECT_ID}/comments` && method === 'POST') {
    const input = request.postDataJSON();
    state.creates.push(input);
    if (input.version !== VERSION) {
      return json(route, { error: { code: 'version_not_found' } }, 404);
    }
    return json(route, createComment(input), 201);
  }
  const patch = /^comments\/([^/]+)$/.exec(rest);
  if (patch && method === 'PATCH') {
    const input = request.postDataJSON();
    state.patches.push({ commentId: patch[1], ...input });
    const comment = patchComment(patch[1], input);
    return comment ? json(route, comment) : json(route, { error: { code: 'not_found' } }, 404);
  }
  if (rest === `projects/${PROJECT_ID}/conversations` && method === 'POST') {
    const { conversationId } = request.postDataJSON();
    state.bindings.set(conversationId, PROJECT_ID);
    return route.fulfill({ status: 204 });
  }
  const lookup = /^conversations\/([^/]+)\/project$/.exec(rest);
  if (lookup) {
    return state.bindings.has(lookup[1])
      ? json(route, summary())
      : json(route, { error: { code: 'not_found' } }, 404);
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
    ? html.replace(
        '</head>',
        `<script src="/preview/__etus/bridge.js" data-nonce="${nonce}"></script></head>`,
      )
    : html;
  return route.fulfill({ status: 200, contentType: 'text/html', headers: PREVIEW_HEADERS, body });
}

const modelRequests = async () => (await fetch(`${LLM}/__requests`)).json();

async function register() {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Designer C7',
      username: 'designer_c7',
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

const composerValue = (p) => p.locator('#prompt-textarea').inputValue();
const panel = (p) => p.getByTestId('comment-panel');
const frame = (p) => p.frameLocator('iframe[title="Prévia de index.html"]');
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

async function enterCommentMode(p) {
  await p.getByRole('button', { name: 'Comentar', exact: true }).click();
  await panel(p).waitFor();
  await p.waitForTimeout(500);
}

async function pick(p, selector, { real = true } = {}) {
  const target = frame(p).locator(selector);
  if (real) {
    await target.click();
  } else {
    await target.dispatchEvent('click');
  }
}

async function comment(p, selector, body, options) {
  await pick(p, selector, options);
  const composer = p.getByTestId('comment-composer');
  await composer.waitFor();
  await composer.getByRole('textbox').fill(body);
  await composer.getByRole('button', { name: 'Comentar' }).click();
  await composer.waitFor({ state: 'detached' });
}

function expectedRequest(comments) {
  return [
    `Ajuste o arquivo index.html (versão ${VERSION}) conforme estes comentários:`,
    ...comments.map(
      ({ selector, snippet, body }, index) => `${index + 1}. [${selector}] "${snippet}": ${body}`,
    ),
    'Ao terminar, marque cada comentário como resolvido.',
  ].join('\n');
}

async function desktop(browser) {
  const context = await newContext(browser, { width: 1600, height: 900 });
  const p = await login(context);
  await p.goto(`${BASE}/design/${PROJECT_ID}`);
  await waitForReplies(p, 1);
  const baseline = (await modelRequests()).length;
  await frame(p).locator('h1').waitFor();
  await p.getByRole('button', { name: 'Celular (390 x 844)' }).click();
  await p.getByRole('combobox', { name: 'Zoom' }).selectOption('1');
  await enterCommentMode(p);
  await pick(p, 'h1');
  const anchored = p.getByTestId('comment-anchored-composer');
  await anchored.waitFor();
  const [composerBox, h1Box] = await Promise.all([
    anchored.boundingBox(),
    frame(p).locator('h1').boundingBox(),
  ]);
  check(
    'clique real na prévia abre a caixa do comentário logo abaixo do elemento',
    composerBox &&
      h1Box &&
      Math.abs(composerBox.x - h1Box.x) <= 1 &&
      composerBox.y >= h1Box.y + h1Box.height &&
      composerBox.y - (h1Box.y + h1Box.height) <= 12,
    JSON.stringify({ composerBox, h1Box }),
  );
  await shot(p, 'desktop-composer');
  await p.keyboard.press('Escape');
  await anchored.waitFor({ state: 'detached' });

  await comment(p, 'h1', 'mais curto');
  await comment(p, 'footer a:nth-of-type(2)', 'trocar por WhatsApp');
  check(
    'dois comentários gravados com âncora, versão e dispositivo',
    state.creates.length === 2 &&
      state.creates[0].anchor.selector === HERO &&
      state.creates[0].anchor.textSnippet === 'Título atual' &&
      state.creates[1].anchor.selector === CONTACT &&
      state.creates.every((input) => input.version === VERSION && input.anchor.device === 'mobile'),
    JSON.stringify(state.creates.map((input) => input.anchor)),
  );
  const items = panel(p).getByTestId('comment-item');
  check('painel lista os 2 abertos', (await items.count()) === 2);
  const { violations } = await new AxeBuilder({ page: p })
    .include('[data-testid="comment-panel"]')
    .analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  check('axe no painel sem violação séria', serious.length === 0, serious.map((v) => v.id).join());
  await shot(p, 'desktop-panel');

  await p.getByRole('button', { name: 'Desktop (1440 x 900)' }).click();
  await p.getByRole('combobox', { name: 'Zoom' }).selectOption('fit');
  await pick(p, 'h1', { real: false });
  await anchored.waitFor();
  const [scaledBox, frameBox, scale] = await Promise.all([
    anchored.boundingBox(),
    p.getByTestId('design-device-frame').boundingBox(),
    p.getByTestId('design-device-frame').getAttribute('data-scale'),
  ]);
  check(
    'com Ajustar, a caixa fica no tamanho normal e dentro da prévia',
    Number(scale) < 1 &&
      scaledBox &&
      frameBox &&
      Math.round(scaledBox.width) === 288 &&
      scaledBox.x >= frameBox.x - 1 &&
      scaledBox.x + scaledBox.width <= frameBox.x + frameBox.width + 1 &&
      scaledBox.y + scaledBox.height <= frameBox.y + frameBox.height + 1,
    JSON.stringify({ scale, scaledBox, frameBox }),
  );
  await shot(p, 'desktop-composer-fit');
  await p.keyboard.press('Escape');
  await anchored.waitFor({ state: 'detached' });

  await panel(p).getByRole('button', { name: 'Enviar ao chat (2)' }).click();
  await p.waitForFunction(
    () => document.querySelector('#prompt-textarea')?.value.includes('Ao terminar'),
    null,
    { timeout: 10000 },
  );
  const expected = expectedRequest([
    { selector: HERO, snippet: 'Título atual', body: 'mais curto' },
    { selector: CONTACT, snippet: 'Contato', body: 'trocar por WhatsApp' },
  ]);
  const staged = await composerValue(p);
  check('C-5: texto no composer no formato de 3.7', staged === expected, JSON.stringify(staged));
  await p.waitForTimeout(500);
  check(
    'comentários marcados como enviados ao chat',
    state.comments.every((item) => item.sentToChatAt),
    JSON.stringify(state.patches),
  );
  check(
    'nada foi enviado ao agente sem a pessoa pedir',
    (await modelRequests()).length === baseline,
  );

  await p.locator('#prompt-textarea').press('Enter');
  await waitForReplies(p, 2);
  const requests = await modelRequests();
  check(
    'agente simulado recebe o pedido dos comentários',
    requests.length === baseline + 1 && requests.at(-1).last === expected,
    JSON.stringify(requests.at(-1)?.last),
  );
  resolveAsAgent('Ajustado pelo agente');
  await panel(p).getByRole('button', { name: 'Resolvidos (2)' }).waitFor({ timeout: 30000 });
  check('painel mostra os comentários resolvidos pelo agente', true);
  await panel(p).getByRole('button', { name: 'Resolvidos (2)' }).click();
  check(
    'nota do agente aparece no comentário resolvido',
    (await panel(p).getByText('Nota: Ajustado pelo agente').count()) === 2,
  );
  await panel(p).getByRole('button', { name: 'Reabrir o comentário 1' }).click();
  await panel(p).getByRole('button', { name: 'Abertos (1)' }).waitFor();
  check(
    'reabrir manda status open',
    state.patches.some((item) => item.status === 'open'),
  );
  await panel(p).getByRole('button', { name: 'Abertos (1)' }).click();
  await panel(p)
    .getByRole('button', { name: /^Comentário 1/ })
    .click();
  await p.waitForTimeout(300);
  const highlighted = await frame(p)
    .locator('[data-etus-bridge="highlight"]')
    .evaluate((node) => node.style.display);
  check('clicar no comentário realça o elemento na prévia', highlighted === 'block', highlighted);
  await shot(p, 'desktop-resolved');
  await p.locator('#prompt-textarea').fill('');
  await context.close();
}

async function mobile(browser, colorScheme) {
  const before = state.comments.length;
  const context = await newContext(browser, { width: 390, height: 844 }, colorScheme);
  const p = await login(context);
  await p.goto(`${BASE}/design/${PROJECT_ID}`);
  await waitForReplies(p, 1);
  const tabs = p.getByRole('tablist');
  await tabs.getByRole('tab', { name: 'Prévia' }).click();
  await frame(p).locator('h1').waitFor();
  await enterCommentMode(p);
  await comment(p, 'p', `no celular ${colorScheme}`, { real: false });
  check(
    `390x844 ${colorScheme}: comentário gravado com o dispositivo celular`,
    state.comments.length === before + 1 && state.comments.at(-1).anchor.device === 'mobile',
  );
  check(
    `390x844 ${colorScheme}: sem rolagem horizontal no modo Comentar`,
    await noHorizontalScroll(p),
  );
  await shot(p, `mobile-${colorScheme}-panel`);
  const send = panel(p).getByRole('button', { name: /^Enviar ao chat \(\d+\)$/ });
  await send.scrollIntoViewIfNeeded();
  await send.click();
  await p.waitForFunction(
    (text) => document.querySelector('#prompt-textarea')?.value.includes(text),
    `no celular ${colorScheme}`,
    { timeout: 10000 },
  );
  const selected = await tabs.getByRole('tab', { name: 'Chat' }).getAttribute('aria-selected');
  check(`390x844 ${colorScheme}: enviar ao chat troca para a aba Chat`, selected === 'true');
  check(
    `390x844 ${colorScheme}: composer visível com o pedido`,
    await p.locator('#prompt-textarea').isVisible(),
  );
  await shot(p, `mobile-${colorScheme}-chat`);
  await context.close();
}

if (process.argv[2] === 'register') {
  await register();
  process.exit(0);
}

if (!BRIDGE_JS) {
  console.error('ETUS_DESIGN_BRIDGE_JS must point to design-service/src/preview/bridge/bridge.js');
  process.exit(2);
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
