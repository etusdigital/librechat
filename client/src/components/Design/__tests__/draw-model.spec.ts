import type { DrawShape } from '../workspace/draw/shapes';
import type { DesignJob } from '../api/types';
import {
  captureScreenshot,
  drawApi,
  screenshotDevice,
  screenshotUrlOf,
  ScreenshotError,
} from '../workspace/draw/screenshot';
import {
  extendShape,
  isMeaningful,
  paintShapes,
  startShape,
  textShape,
  TEXT_MAX,
} from '../workspace/draw/shapes';
import { addShape, clearShapes, drawSessionKey, undoShapes } from '../workspace/draw/draw-state';
import { composedSize, composeMarkedImage, MAX_IMAGE_SIDE } from '../workspace/draw/compose';
import { cssColorOf, resolveDrawColor } from '../workspace/draw/palette';
import { drawMessage } from '../workspace/draw/DrawPanel';

jest.mock('../chat/DesignChatAdapter', () => ({
  __esModule: true,
  useDesignChatActions: () => ({ insertIntoComposer: jest.fn(), sendMessage: jest.fn() }),
}));

type Call = [string, ...unknown[]];

function recordingContext() {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) {
        return target[prop];
      }
      return (...args: unknown[]) => {
        calls.push([prop, ...args]);
      };
    },
    set(target, prop: string, value) {
      target[prop] = value;
      calls.push([`set:${prop}`, value]);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const job = (overrides: Partial<DesignJob>): DesignJob => ({
  jobId: 'job_1',
  type: 'screenshot',
  projectId: 'prj_abc',
  status: 'queued',
  output: null,
  error: null,
  costUsd: null,
  createdAt: null,
  startedAt: null,
  finishedAt: null,
  downloadUrl: null,
  downloads: [],
  ...overrides,
});

describe('draw shapes', () => {
  it('builds pen, rectangle and arrow shapes from pointer points', () => {
    const pen = extendShape(startShape('pen', 'red', { x: 1, y: 1 }), { x: 9, y: 9 });
    expect(pen).toEqual({
      kind: 'pen',
      color: 'red',
      points: [
        { x: 1, y: 1 },
        { x: 9, y: 9 },
      ],
    });
    const rect = extendShape(startShape('rect', 'red', { x: 10, y: 10 }), { x: 40, y: 30 });
    expect(rect).toEqual({
      kind: 'rect',
      color: 'red',
      from: { x: 10, y: 10 },
      to: { x: 40, y: 30 },
    });
    const arrow = extendShape(startShape('arrow', 'blue', { x: 0, y: 0 }), { x: 50, y: 0 });
    expect(arrow).toMatchObject({ kind: 'arrow', to: { x: 50, y: 0 } });
  });

  it('ignores taps that would leave an invisible mark', () => {
    expect(isMeaningful(startShape('pen', 'red', { x: 1, y: 1 }))).toBe(false);
    expect(
      isMeaningful(extendShape(startShape('rect', 'red', { x: 0, y: 0 }), { x: 2, y: 50 })),
    ).toBe(false);
    expect(
      isMeaningful(extendShape(startShape('arrow', 'red', { x: 0, y: 0 }), { x: 1, y: 1 })),
    ).toBe(false);
    expect(
      isMeaningful(extendShape(startShape('rect', 'red', { x: 0, y: 0 }), { x: 20, y: 20 })),
    ).toBe(true);
  });

  it('keeps short text only', () => {
    expect(textShape('red', { x: 1, y: 2 }, '   ')).toBeNull();
    expect(textShape('red', { x: 1, y: 2 }, ' maior ')).toEqual({
      kind: 'text',
      color: 'red',
      at: { x: 1, y: 2 },
      text: 'maior',
    });
    const long = textShape('red', { x: 0, y: 0 }, 'a'.repeat(TEXT_MAX + 20));
    expect(long?.kind === 'text' && long.text.length).toBe(TEXT_MAX);
  });

  it('paints every kind of shape with its own color', () => {
    const { ctx, calls } = recordingContext();
    const shapes: DrawShape[] = [
      {
        kind: 'pen',
        color: 'rgb(1, 1, 1)',
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 5 },
        ],
      },
      { kind: 'rect', color: 'rgb(2, 2, 2)', from: { x: 30, y: 40 }, to: { x: 10, y: 20 } },
      { kind: 'arrow', color: 'rgb(3, 3, 3)', from: { x: 0, y: 0 }, to: { x: 40, y: 0 } },
      { kind: 'text', color: 'rgb(4, 4, 4)', at: { x: 7, y: 8 }, text: 'maior' },
    ];
    paintShapes(ctx, shapes);
    const names = calls.map(([name]) => name);
    expect(names.filter((name) => name === 'save')).toHaveLength(4);
    expect(calls).toContainEqual(['strokeRect', 10, 20, 20, 20]);
    expect(calls).toContainEqual(['fillText', 'maior', 7, 8]);
    expect(names).toContain('fill');
    expect(calls.filter(([name]) => name === 'set:strokeStyle').map(([, value]) => value)).toEqual(
      expect.arrayContaining(['rgb(1, 1, 1)', 'rgb(2, 2, 2)', 'rgb(3, 3, 3)']),
    );
  });
});

describe('draw session history', () => {
  const rect: DrawShape = { kind: 'rect', color: 'red', from: { x: 0, y: 0 }, to: { x: 9, y: 9 } };
  const arrow: DrawShape = {
    kind: 'arrow',
    color: 'red',
    from: { x: 0, y: 0 },
    to: { x: 9, y: 0 },
  };

  it('undoes additions and a clear, one step at a time', () => {
    let session = { key: 'k', shapes: [] as DrawShape[], past: [] as DrawShape[][] };
    session = addShape(addShape(session, rect), arrow);
    expect(session.shapes).toEqual([rect, arrow]);
    session = clearShapes(session);
    expect(session.shapes).toEqual([]);
    session = undoShapes(session);
    expect(session.shapes).toEqual([rect, arrow]);
    session = undoShapes(undoShapes(session));
    expect(session.shapes).toEqual([]);
    expect(undoShapes(session)).toBe(session);
    expect(clearShapes(session)).toBe(session);
  });

  it('scopes marks to the project, file and viewport', () => {
    expect(drawSessionKey('prj_abc', 'index.html', { width: 390, height: 844 })).toBe(
      'prj_abc|index.html|390x844',
    );
  });
});

describe('draw message and colors', () => {
  it('puts the person text before the file reference', () => {
    expect(drawMessage('  aumentar o título ', 'Veja o arquivo index.html.')).toBe(
      'aumentar o título\n\nVeja o arquivo index.html.',
    );
    expect(drawMessage('   ', 'Veja o arquivo index.html.')).toBe('Veja o arquivo index.html.');
  });

  it('reads theme colors from the CSS variables', () => {
    expect(cssColorOf('239 68 68')).toBe('rgb(239, 68, 68)');
    expect(cssColorOf(' #3be476 ')).toBe('#3be476');
    const root = document.createElement('div');
    root.style.setProperty('--red-500', '1 2 3');
    document.body.appendChild(root);
    expect(resolveDrawColor('red', root)).toBe('rgb(1, 2, 3)');
    expect(resolveDrawColor('blue', root)).toBe('rgb(59, 130, 246)');
    expect(resolveDrawColor('unknown', null)).toBe('rgb(239, 68, 68)');
    root.remove();
  });
});

describe('screenshot of the preview', () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('maps the current device, and the free size to the closest one', () => {
    expect(screenshotDevice('mobile', { width: 390, height: 844 })).toBe('mobile');
    expect(screenshotDevice('tablet', { width: 820, height: 1180 })).toBe('tablet');
    expect(screenshotDevice('free', { width: 500, height: 700 })).toBe('mobile');
    expect(screenshotDevice('free', { width: 900, height: 700 })).toBe('tablet');
    expect(screenshotDevice('free', { width: 1300, height: 700 })).toBe('desktop');
  });

  it('requests a job, waits for it and downloads the PNG without credentials', async () => {
    const request = jest.spyOn(drawApi, 'requestScreenshot').mockResolvedValue(job({}));
    const getJob = jest
      .spyOn(drawApi, 'getJob')
      .mockResolvedValueOnce(job({ status: 'running' }))
      .mockResolvedValueOnce(
        job({
          status: 'succeeded',
          downloadUrl: '/preview/d/tok',
          downloads: [{ url: '/preview/d/tok', fileName: 'screenshot-mobile.png' }],
        }),
      );
    const blob = await captureScreenshot({
      projectId: 'prj_abc',
      path: 'index.html',
      device: 'mobile',
      pollMs: 1,
    });
    expect(request).toHaveBeenCalledWith('prj_abc', {
      path: 'index.html',
      devices: ['mobile'],
      fullPage: false,
    });
    expect(getJob).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3080/preview/d/tok',
      expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' }),
    );
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(4);
  });

  it('fails with the job error code', async () => {
    jest
      .spyOn(drawApi, 'requestScreenshot')
      .mockResolvedValue(job({ status: 'failed', error: { code: 'renderer_unavailable' } }));
    await expect(
      captureScreenshot({ projectId: 'prj_abc', path: 'index.html', device: 'desktop' }),
    ).rejects.toEqual(new ScreenshotError('renderer_unavailable'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives up after the deadline', async () => {
    jest.spyOn(drawApi, 'requestScreenshot').mockResolvedValue(job({ status: 'queued' }));
    jest.spyOn(drawApi, 'getJob').mockResolvedValue(job({ status: 'running' }));
    let clock = 0;
    const promise = captureScreenshot({
      projectId: 'prj_abc',
      path: 'index.html',
      device: 'desktop',
      pollMs: 1,
      timeoutMs: 3,
      now: () => clock++,
    });
    await expect(promise).rejects.toMatchObject({ code: 'screenshot_timeout' });
  });

  it('stops polling when aborted', async () => {
    jest.spyOn(drawApi, 'requestScreenshot').mockResolvedValue(job({ status: 'queued' }));
    const controller = new AbortController();
    const promise = captureScreenshot({
      projectId: 'prj_abc',
      path: 'index.html',
      device: 'desktop',
      pollMs: 10_000,
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('only downloads http(s) links', () => {
    expect(screenshotUrlOf(job({ downloadUrl: 'javascript:alert(1)' }))).toBeNull();
    expect(screenshotUrlOf(job({}))).toBeNull();
    expect(screenshotUrlOf(job({ downloads: [{ url: 'https://chat.test/preview/d/a' }] }))).toBe(
      'https://chat.test/preview/d/a',
    );
  });

  it('rejects a failed download', async () => {
    jest
      .spyOn(drawApi, 'requestScreenshot')
      .mockResolvedValue(job({ status: 'succeeded', downloadUrl: '/preview/d/tok' }));
    fetchMock.mockResolvedValue({ ok: false, status: 403 });
    await expect(
      captureScreenshot({ projectId: 'prj_abc', path: 'index.html', device: 'desktop' }),
    ).rejects.toMatchObject({ code: 'screenshot_download_failed' });
  });
});

describe('marked image composition', () => {
  it('draws the screenshot and scales the marks to the device pixel ratio', async () => {
    const { ctx, calls } = recordingContext();
    const canvas = {
      getContext: () => ctx,
      toBlob: (callback: (blob: Blob | null) => void, type: string) =>
        callback(new Blob(['png'], { type })),
    } as unknown as HTMLCanvasElement;
    const createCanvas = jest.fn(() => canvas);
    const close = jest.fn();
    const source = {} as CanvasImageSource;
    const blob = await composeMarkedImage(
      new Blob(['shot']),
      [{ kind: 'rect', color: 'red', from: { x: 10, y: 10 }, to: { x: 50, y: 40 } }],
      { width: 390, height: 844 },
      {
        loadImage: async () => ({ width: 1170, height: 2532, source, close }),
        createCanvas,
      },
    );
    const { factor, width, height } = composedSize({ width: 1170, height: 2532 });
    expect(Math.max(width, height)).toBe(MAX_IMAGE_SIDE);
    expect(createCanvas).toHaveBeenCalledWith({ width, height });
    expect(calls).toContainEqual(['drawImage', source, 0, 0, width, height]);
    expect(calls).toContainEqual(['setTransform', 3 * factor, 0, 0, 3 * factor, 0, 0]);
    expect(calls).toContainEqual(['strokeRect', 10, 10, 40, 30]);
    expect(close).toHaveBeenCalled();
    expect(blob.type).toBe('image/png');
  });

  it('keeps small screenshots at full size', () => {
    expect(composedSize({ width: 1440, height: 900 })).toEqual({
      factor: 1,
      width: 1440,
      height: 900,
    });
  });

  it('fails clearly when the screenshot is not an image', async () => {
    await expect(
      composeMarkedImage(
        new Blob(['x']),
        [],
        { width: 1, height: 1 },
        {
          loadImage: async () => {
            throw new Error('decode');
          },
          createCanvas: jest.fn(),
        },
      ),
    ).rejects.toMatchObject({ name: 'ComposeError' });
  });
});
