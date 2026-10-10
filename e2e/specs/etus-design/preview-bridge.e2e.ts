import { expect, test } from '@playwright/test';
import { landingPage } from './fixtures/pages';
import {
  bridgeNonce,
  collapseChatMenu,
  openWorkspace,
  previewFrameOf,
  setDevice,
  setMode,
  setZoom,
  waitForPreview,
} from './support/workspace';

const COMPUTED = {
  color: 'rgb(0, 0, 0)',
  backgroundColor: 'rgba(0, 0, 0, 0)',
  fontSize: '16px',
  fontWeight: '400',
  textAlign: 'left',
  margin: '0px',
  padding: '0px',
  borderRadius: '0px',
};

test('C-3: frame messages with a wrong nonce, from another window or with an invalid shape are ignored', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await openWorkspace(page, { name: 'Ponte C-3', files: { 'index.html': landingPage() } });
  await collapseChatMenu(page);
  await setDevice(page, 'Celular');
  await setZoom(page, '100%');
  await setMode(page, 'Comentar');
  await waitForPreview(page);
  const nonce = await bridgeNonce(page);
  expect(nonce).not.toBe('');
  const frame = await previewFrameOf(page);
  expect(await frame.evaluate(() => window.origin)).toBe('null');
  expect(
    await frame.evaluate(() =>
      document.querySelector('script[data-nonce]')?.getAttribute('data-nonce'),
    ),
  ).toBe(nonce);

  const target = {
    type: 'etus:target',
    selector: 'body > header:nth-of-type(1)',
    textSnippet: 'Mensagem forjada',
    rect: { x: 10, y: 10, w: 120, h: 24 },
    tag: 'header',
    computed: COMPUTED,
  };
  const box = page.getByTestId('comment-composer');

  await page.evaluate((message) => window.postMessage(message, '*'), { ...target, nonce });
  await page.evaluate(
    (message) => {
      const other = document.createElement('iframe');
      document.body.appendChild(other);
      other.contentWindow?.parent.postMessage(message, '*');
      other.remove();
    },
    { ...target, nonce },
  );
  await frame.evaluate((message) => parent.postMessage(message, '*'), {
    ...target,
    nonce: 'nonce-errado',
  });
  await frame.evaluate((message) => parent.postMessage(message, '*'), {
    type: 'etus:target',
    nonce,
    selector: 42,
    rect: 'nada',
  });
  await frame.evaluate((message) => parent.postMessage(message, '*'), {
    ...target,
    nonce,
    computed: undefined,
    tag: undefined,
    rect: { x: 'a' },
  });
  await page.waitForTimeout(1_500);
  await expect(box).toHaveCount(0);

  await frame.evaluate((message) => parent.postMessage(message, '*'), { ...target, nonce });
  await expect(box).toBeVisible();
});

test('C-6: each device sets the right viewport and the zoom only scales the box', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await openWorkspace(page, { name: 'Dispositivos C-6', files: { 'index.html': landingPage() } });
  await collapseChatMenu(page);
  const frameBox = page.getByTestId('design-device-frame');
  const inner = async () =>
    (await previewFrameOf(page)).evaluate(() => `${innerWidth}x${innerHeight}`);

  for (const [device, size] of [
    ['Celular', '390x844'],
    ['Tablet', '820x1180'],
    ['Desktop', '1440x900'],
  ] as const) {
    await setDevice(page, device);
    await expect(frameBox).toHaveAttribute('data-viewport-width', size.split('x')[0]);
    await expect.poll(inner).toBe(size);
  }

  await setDevice(page, 'Celular');
  for (const [label, scale] of [
    ['50%', '0.5'],
    ['75%', '0.75'],
    ['100%', '1'],
    ['125%', '1.25'],
    ['150%', '1.5'],
  ] as const) {
    await setZoom(page, label);
    await expect(frameBox).toHaveAttribute('data-scale', scale);
    await expect.poll(inner).toBe('390x844');
    const width = await frameBox.evaluate((element) => element.getBoundingClientRect().width);
    expect(Math.abs(width - 390 * Number(scale))).toBeLessThanOrEqual(2);
  }
  await setZoom(page, 'Ajustar');
  expect(Number(await frameBox.getAttribute('data-scale'))).toBeLessThanOrEqual(1);
  await expect.poll(inner).toBe('390x844');
});
