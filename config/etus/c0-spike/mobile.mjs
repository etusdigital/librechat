import { chromium } from 'playwright';
const BASE = 'http://localhost:3180';
const b = await chromium.launch();
const results = [];
const check = (n, ok, d = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` :: ${d}` : ''}`);
};
for (const vp of [
  { width: 390, height: 844, name: 'celular' },
  { width: 1280, height: 800, name: 'desktop' },
]) {
  const ctx = await b.newContext({ viewport: { width: vp.width, height: vp.height } });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`);
  await p.fill('input[name="email"]', 'designer@c0.test');
  await p.fill('input[name="password"]', 'spike-password-123');
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/c\//);
  const outsideSelector = await p
    .getByTestId('model-selector-button')
    .first()
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  await p.goto(`${BASE}/design/prj_spike_${vp.name}`);
  await p.waitForFunction(
    () =>
      !document
        .querySelector('[data-testid="spike-conversation"]')
        ?.textContent?.includes('(nova)'),
    null,
    { timeout: 60000 },
  );
  await p.waitForFunction(
    () => document.querySelector('[data-testid="spike-responding"]')?.textContent?.includes('não'),
    null,
    { timeout: 60000 },
  );
  await p.waitForTimeout(800);
  const embed = p.locator('[data-etus-design-chat]');
  check(`${vp.name}: seletor de modelo visível fora da tela Design`, outsideSelector);
  check(
    `${vp.name}: seletor de modelo escondido no chat embutido`,
    !(await embed
      .getByTestId('model-selector-button')
      .isVisible()
      .catch(() => false)),
  );
  check(
    `${vp.name}: novo chat do cabeçalho escondido no embutido`,
    !(await embed
      .getByTestId('header-new-chat-button')
      .isVisible()
      .catch(() => false)),
  );
  const overflow = await p.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(`${vp.name}: sem rolagem horizontal`, overflow <= 0, String(overflow));
  await p.screenshot({ path: `/tmp/c0-spike/out/${vp.name}.png` });
  await ctx.close();
}
await b.close();
process.exit(results.every(Boolean) ? 0 : 1);
