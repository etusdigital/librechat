const { chromium } = require('playwright');
const MARKER = 'ETUS_A0_MARKER_7f3c';
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const requests = [];
  context.on('request', (req) => {
    const body = req.postData() || '';
    requests.push({
      method: req.method(),
      url: req.url(),
      bodyBytes: body.length,
      markerInBody: body.includes(MARKER),
      markerInUrl: req.url().includes(MARKER),
    });
  });
  context.on('response', (res) => {
    const r = requests.find((x) => x.url === res.url() && x.status === undefined);
    if (r) r.status = res.status();
  });
  const page = await context.newPage();
  await page.goto(process.argv[2]);
  await page.waitForTimeout(9000);
  const img = await page.evaluate(() => window.__img);
  const previewUrl = await page.evaluate(() => window.__previewUrl);
  const frames = page.frames().map((f) => f.url());
  let frameHasMarker = false;
  for (const f of page.frames()) {
    try {
      frameHasMarker = frameHasMarker || (await f.content()).includes(MARKER);
    } catch {}
  }
  console.log(
    JSON.stringify(
      {
        previewUrl,
        img,
        frames,
        frameHasMarker,
        anyRequestCarriesMarker: requests.some((r) => r.markerInBody || r.markerInUrl),
        requests,
      },
      null,
      2,
    ),
  );
  await browser.close();
})();
