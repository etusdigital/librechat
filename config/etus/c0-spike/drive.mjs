import { chromium } from 'playwright';
import fs from 'node:fs';
import zlib from 'node:zlib';

const BASE = 'http://localhost:3180';
const EMAIL = 'designer@c0.test';
const PASSWORD = 'spike-password-123';
const PROJECT = 'prj_spike01';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`);
};

function tinyPng() {
  const w = 2,
    h = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h, 0);
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function ensureUser() {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Designer C0',
      username: 'designer_c0',
      email: EMAIL,
      password: PASSWORD,
      confirm_password: PASSWORD,
    }),
  });
  console.log('register status', res.status);
}

const mode = process.argv[2] ?? 'all';
if (mode === 'register') {
  await ensureUser();
  process.exit(0);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const swResponses = [];
context.on('response', (r) => {
  const u = new URL(r.url());
  if (u.pathname.startsWith('/preview/') || /\/assets\/.*\.js$/.test(u.pathname)) {
    swResponses.push({
      path: u.pathname,
      fromSW: r.fromServiceWorker(),
      status: r.status(),
      csp: r.headers()['content-security-policy'] ?? '',
      source: r.headers()['x-c0-source'] ?? '',
    });
  }
});
page.on('pageerror', (e) => console.log('pageerror', e.message));

await page.goto(`${BASE}/login`);
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload();
await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, {
  timeout: 15000,
});
await page.waitForTimeout(2000);
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL(/\/c\//, { timeout: 30000 });

const swState = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  return { scope: reg.scope, active: Boolean(reg.active) };
});
check('service worker do chat registrado', swState.active, JSON.stringify(swState));
await page.reload();
await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, {
  timeout: 15000,
});
check('página do chat controlada pelo service worker', true);

swResponses.length = 0;
await page.goto(
  `${BASE}/design/${PROJECT}?brief=${encodeURIComponent('landing para pequenas empresas')}`,
);
const spike = page.getByTestId('design-spike');
await spike.waitFor({ timeout: 30000 });
await page.waitForFunction(
  () =>
    !document.querySelector('[data-testid="spike-conversation"]')?.textContent?.includes('(nova)'),
  null,
  { timeout: 60000 },
);
const convText = await page.getByTestId('spike-conversation').textContent();
const conversationId = convText.replace('conversa: ', '').trim();
check(
  'conversa criada e id entregue a onConversationCreated',
  /^[0-9a-f-]{36}$/.test(conversationId),
  conversationId,
);
check(
  'URL continua na tela Design',
  new URL(page.url()).pathname === `/design/${PROJECT}`,
  page.url(),
);
await page.waitForFunction(
  () =>
    document.querySelector('[data-testid="spike-last"]')?.textContent?.includes('Exportar em PDF'),
  null,
  { timeout: 60000 },
);
await page.waitForFunction(
  () => document.querySelector('[data-testid="spike-responding"]')?.textContent?.includes('não'),
  null,
  { timeout: 30000 },
);
const last = await page.getByTestId('spike-last').textContent();
check(
  'modelo recebeu a linha de vínculo como primeira linha',
  last.includes(`rótulo de definição, projectId=${PROJECT}`),
  last.split('\n')[0],
);
check(
  'agente Etus Design escolhido pela URL interna (autor da resposta)',
  (await page.locator('[data-etus-design-chat]').innerText()).includes('Etus Design'),
);
const chatText = await page.locator('[data-etus-design-chat]').innerText();
check(
  'linha de vínculo escondida na conversa exibida',
  !chatText.includes('[Projeto Etus Design]') &&
    !chatText.includes(`Projeto Etus Design: ${PROJECT}`) &&
    chatText.includes('landing para pequenas empresas'),
);
const chips = page.getByTestId('spike-chips').locator('button');
check(
  '3 sugestões lidas da última resposta',
  (await chips.count()) === 3,
  String(await chips.count()),
);
await page.screenshot({ path: '/tmp/c0-spike/out/01-first-turn.png' });

const respondingSeen = page
  .waitForFunction(
    () => document.querySelector('[data-testid="spike-responding"]')?.textContent?.includes('sim'),
    null,
    { timeout: 15000 },
  )
  .then(() => true)
  .catch(() => false);
await chips.first().click();
check('useIsResponding vira true durante a resposta', await respondingSeen);
await page.waitForFunction(
  () => document.querySelector('[data-testid="spike-responding"]')?.textContent?.includes('não'),
  null,
  { timeout: 60000 },
);
await page.waitForTimeout(500);
const chatText2 = await page.locator('[data-etus-design-chat]').innerText();
check('sendMessage enviou o texto da sugestão', chatText2.includes('Adicionar seção de FAQ'));
check(
  'resposta nova lida (22 caracteres)',
  (await page.getByTestId('spike-last').textContent()).includes('(22 caracteres)'),
);

await page.getByTestId('spike-insert').click();
await page.waitForTimeout(300);
const composer = page.locator('#prompt-textarea');
check(
  'insertIntoComposer pôs o texto no composer',
  (await composer.inputValue()).includes('Ajuste o arquivo index.html'),
  await composer.inputValue(),
);
await composer.fill('');

await page
  .getByTestId('spike-file')
  .setInputFiles({ name: 'marcacoes.png', mimeType: 'image/png', buffer: tinyPng() });
await page
  .waitForFunction(
    () => document.querySelector('[data-testid="spike-result"]')?.textContent?.includes('true'),
    null,
    { timeout: 20000 },
  )
  .catch(() => {});
await page.waitForTimeout(1500);
const composerArea = page.locator('[data-etus-design-chat] form');
const hasAttachment = await composerArea.locator('[aria-label^="View "]').count();
check(
  'insertIntoComposer anexou o arquivo ao composer',
  hasAttachment > 0,
  `prévias no form: ${hasAttachment}`,
);
check('texto do anexo no composer', (await composer.inputValue()).includes('Veja as marcações'));
await page.screenshot({ path: '/tmp/c0-spike/out/02-attachment.png' });
await composer.press('Enter');
await page
  .waitForFunction(
    () =>
      document
        .querySelector('[data-testid="spike-last"]')
        ?.textContent?.includes('com imagem anexada'),
    null,
    { timeout: 60000 },
  )
  .catch(() => {});
check(
  'imagem anexada chegou ao modelo',
  (await page.getByTestId('spike-last').textContent()).includes('com imagem anexada'),
  (await page.getByTestId('spike-last').textContent()).split('\n')[2],
);

await page.waitForFunction(
  () => document.querySelector('[data-testid="spike-responding"]')?.textContent?.includes('não'),
  null,
  { timeout: 60000 },
);
await page.goto(`${BASE}/design/${PROJECT}?c=${conversationId}`);
await page
  .locator('[data-etus-design-chat]')
  .getByText('landing para pequenas empresas')
  .waitFor({ timeout: 30000 });
const reloaded = await page.locator('[data-etus-design-chat]').innerText();
check('conversa existente reabre embutida', reloaded.includes('Adicionar seção de FAQ'));
check('linha continua escondida depois de recarregar', !reloaded.includes('[Projeto Etus Design]'));
await page
  .waitForFunction(
    () =>
      document
        .querySelector('[data-testid="spike-last"]')
        ?.textContent?.includes('Próximos passos'),
    null,
    { timeout: 30000 },
  )
  .catch(() => {});
check(
  'useLastAssistantMessage lê a conversa recarregada',
  (await page.getByTestId('spike-last').textContent()).includes('Próximos passos'),
);

await page.evaluate(() => localStorage.setItem('enableUserMsgMarkdown', 'false'));
await page.reload();
await page
  .locator('[data-etus-design-chat]')
  .getByText('landing para pequenas empresas')
  .first()
  .waitFor({ timeout: 30000 });
const plain = await page.locator('[data-etus-design-chat]').innerText();
check(
  'sem markdown nas mensagens da pessoa a linha aparece (limite conhecido)',
  plain.includes('[Projeto Etus Design]'),
);
await page.evaluate(() => localStorage.setItem('enableUserMsgMarkdown', 'true'));

const frame = page.frameLocator('[data-testid="spike-preview"]');
await frame.locator('#h').waitFor({ timeout: 10000 });
const frameOrigin = await frame.locator('#h').getAttribute('data-origin');
const frameControlled = await frame.locator('#h').getAttribute('data-controlled');
check('iframe da prévia tem origem opaca', frameOrigin === 'null', frameOrigin);
check(
  'iframe da prévia não é controlado pelo service worker',
  frameControlled === 'false' || frameControlled.startsWith('blocked'),
  frameControlled,
);

const tab = await context.newPage();
const topResponse = await tab.goto(`${BASE}/preview/p/spike-token/index.html`);
check(
  'aba da prévia: resposta veio da rede, não do service worker',
  topResponse.fromServiceWorker() === false && topResponse.headers()['x-c0-source'] === 'network',
);
check(
  'aba da prévia: CSP sandbox presente',
  (topResponse.headers()['content-security-policy'] ?? '').startsWith('sandbox'),
);
const tabControlled = await tab.locator('#h').getAttribute('data-controlled');
check(
  'aba da prévia: documento não controlado',
  tabControlled === 'false' || tabControlled.startsWith('blocked'),
  tabControlled,
);
const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
check('página do chat segue controlada (comparação)', controlled);

const preview = swResponses.filter((r) => r.path.startsWith('/preview/'));
const assets = swResponses.filter((r) => r.path.startsWith('/assets/'));
check(
  'nenhuma resposta de /preview/ veio do service worker',
  preview.length > 0 && preview.every((r) => !r.fromSW),
  JSON.stringify(preview),
);
check(
  'controle: bundle do chat veio do service worker',
  assets.some((r) => r.fromSW),
  JSON.stringify(assets.slice(0, 2)),
);

fs.writeFileSync(
  '/tmp/c0-spike/out/results.json',
  JSON.stringify({ conversationId, results, swResponses }, null, 2),
);
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
