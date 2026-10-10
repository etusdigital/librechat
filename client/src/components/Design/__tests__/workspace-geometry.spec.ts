import { fitScale, previewGeometry } from '../workspace/preview-geometry';
import { codeLanguageOf, fileKindOf } from '../workspace/file-kind';
import { parseZoom, zoomValue } from '../workspace/PreviewToolbar';
import { clampChatWidth } from '../workspace/chat-width';
import { DEVICES, ZOOM_LEVELS } from '../state/atoms';
import { fencedCode } from '../workspace/CodeView';

const area = { width: 900, height: 700 };

describe('preview geometry', () => {
  it.each([
    ['mobile', 390, 844],
    ['tablet', 820, 1180],
    ['desktop', 1440, 900],
  ] as const)('uses the %s viewport', (device, width, height) => {
    for (const zoom of ZOOM_LEVELS) {
      expect(previewGeometry(device, zoom, area).viewport).toEqual({ width, height });
    }
  });

  it('only changes the scale when the zoom changes', () => {
    const viewports = ZOOM_LEVELS.filter((zoom) => zoom !== 'fit').map((zoom) => {
      const geometry = previewGeometry('mobile', zoom, area);
      expect(geometry.scale).toBe(zoom);
      expect(geometry.frame).toEqual({
        width: Math.round(390 * zoom),
        height: Math.round(844 * zoom),
      });
      return geometry.viewport;
    });
    expect(new Set(viewports.map((viewport) => `${viewport.width}x${viewport.height}`))).toEqual(
      new Set(['390x844']),
    );
  });

  it('fits the device into the area without scaling up', () => {
    expect(fitScale({ width: 1440, height: 900 }, area)).toBeCloseTo(900 / 1440);
    expect(fitScale({ width: 390, height: 844 }, area)).toBeCloseTo(700 / 844);
    expect(fitScale({ width: 390, height: 844 }, { width: 2000, height: 2000 })).toBe(1);
    expect(fitScale({ width: 390, height: 844 }, { width: 0, height: 0 })).toBe(1);
    const fit = previewGeometry('desktop', 'fit', area);
    expect(fit.frame.width).toBeLessThanOrEqual(area.width);
    expect(fit.frame.height).toBeLessThanOrEqual(area.height);
  });

  it('fills the area on the free device and keeps the layout size under zoom', () => {
    expect(previewGeometry('free', 'fit', area)).toEqual({
      viewport: area,
      scale: 1,
      frame: area,
    });
    expect(previewGeometry('free', 0.5, area)).toEqual({
      viewport: { width: 1800, height: 1400 },
      scale: 0.5,
      frame: area,
    });
    expect(DEVICES.free).toBeNull();
  });

  it('round-trips the zoom options of the toolbar', () => {
    for (const zoom of ZOOM_LEVELS) {
      expect(parseZoom(zoomValue(zoom))).toBe(zoom);
    }
    expect(parseZoom('3')).toBe('fit');
  });
});

describe('file kinds', () => {
  it.each([
    ['index.html', '', 'html'],
    ['docs/readme.md', '', 'markdown'],
    ['styles/app.css', 'text/css', 'code'],
    ['app.js', '', 'code'],
    ['data.json', 'application/json', 'code'],
    ['assets/logo.svg', 'image/svg+xml', 'image'],
    ['hero.webp', '', 'image'],
    ['intro.mp4', '', 'video'],
    ['theme.mp3', 'audio/mpeg', 'audio'],
    ['font.woff2', 'font/woff2', 'binary'],
    ['page', 'text/html; charset=utf-8', 'html'],
  ])('%s (%s) is %s', (path, mime, kind) => {
    expect(fileKindOf(path, mime)).toBe(kind);
  });

  it('picks the highlight language from the extension', () => {
    expect(codeLanguageOf('index.html')).toBe('xml');
    expect(codeLanguageOf('a/b.ts')).toBe('typescript');
    expect(codeLanguageOf('notes.txt')).toBe('plaintext');
    expect(codeLanguageOf('LICENSE')).toBe('plaintext');
  });

  it('fences code that already has backticks', () => {
    expect(fencedCode('a', 'css')).toBe('```css\na\n```');
    expect(fencedCode('x ```` y', 'javascript')).toBe('`````javascript\nx ```` y\n`````');
  });
});

describe('chat width', () => {
  it('stays between 320 and 560 px', () => {
    expect(clampChatWidth(100)).toBe(320);
    expect(clampChatWidth(900)).toBe(560);
    expect(clampChatWidth(447.6)).toBe(448);
    expect(clampChatWidth(Number.NaN)).toBe(440);
  });
});

describe('workspace texts', () => {
  it('resolve the flat workspace keys from the etus-design namespace', () => {
    const i18n = jest.requireActual('~/locales/i18n').default;
    expect(i18n.t('workspace.layout.tab_preview', { lng: 'pt-BR', ns: 'etus-design' })).toBe(
      'Prévia',
    );
    expect(
      i18n.t('workspace.preview.device_size', {
        lng: 'pt-BR',
        ns: 'etus-design',
        name: 'Celular',
        width: 390,
        height: 844,
      }),
    ).toBe('Celular (390 x 844)');
    expect(i18n.t('workspace.drawer.delete', { lng: 'en', ns: 'etus-design', name: 'a.css' })).toBe(
      'Delete a.css',
    );
  });
});
