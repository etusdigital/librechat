import { RecoilRoot } from 'recoil';
import { MemoryRouter } from 'react-router-dom';
import { Provider as JotaiProvider } from 'jotai';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { DesignJob, DesignMe, DesignProjectDetail, FileEntry } from '../api/types';
import type { WorkspaceModeContext } from '../workspace/modes/types';
import type { PreviewBridge } from '../preview/use-preview-bridge';
import { DesignWorkspace } from '../workspace/DesignWorkspacePage';
import { composeMarkedImage } from '../workspace/draw/compose';
import DrawOverlay from '../workspace/draw/DrawOverlay';
import { drawApi } from '../workspace/draw/screenshot';
import { workspaceApi } from '../api/workspace';
import { designApi } from '../api/client';

const mockInsertIntoComposer = jest.fn();

jest.mock('~/components/Chat/Menus/OpenSidebar', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../chat/DesignChatAdapter', () => ({
  __esModule: true,
  useIsResponding: () => false,
  useDesignChatActions: () => ({
    insertIntoComposer: mockInsertIntoComposer,
    sendMessage: jest.fn(),
  }),
}));

jest.mock('../chat/DesignChatSlot', () => ({
  __esModule: true,
  default: () => <div data-testid="design-chat-slot" />,
}));

jest.mock('../workspace/draw/compose', () => ({
  ...jest.requireActual('../workspace/draw/compose'),
  composeMarkedImage: jest.fn(),
}));

jest.mock('../api/client', () => ({
  ...jest.requireActual('../api/client'),
  designApi: {
    listFiles: jest.fn(),
    readFile: jest.fn(),
    getDesignSystem: jest.fn(),
    getJob: jest.fn(),
  },
}));

jest.mock('../api/workspace', () => ({
  ...jest.requireActual('../api/workspace'),
  workspaceApi: { listChanges: jest.fn(), previewUrl: jest.fn() },
}));

const api = designApi as unknown as Record<string, jest.Mock>;
const ws = workspaceApi as unknown as Record<string, jest.Mock>;
const compose = composeMarkedImage as jest.Mock;

const me: DesignMe = {
  sub: 's',
  name: 'Ana',
  orgId: 'org_1',
  permissions: ['projects.use'],
  defaultDesignSystem: 'etus',
};

const indexHtml: FileEntry = {
  path: 'index.html',
  mime: 'text/html',
  size: 10,
  sha256: 'sha',
  version: 1,
  updatedAt: '2026-10-01T10:00:00.000Z',
  updatedBy: 's',
};

const project: DesignProjectDetail = {
  projectId: 'prj_abc',
  name: 'Landing Produto X',
  kind: 'prototype',
  designSystemId: 'etus',
  entryFile: 'index.html',
  templateId: null,
  tags: [],
  owner: { sub: 's', name: 'Ana' },
  access: 'owner',
  canWrite: true,
  createdAt: null,
  updatedAt: null,
  files: [indexHtml],
};

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

function mockViewport(compact: boolean) {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: query.includes('max-width') ? compact : !compact,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
}

const stage = { width: 1000, height: 800 };
const originalWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
const originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
const originalGetContext = HTMLCanvasElement.prototype.getContext;
const originalFetch = global.fetch;
const fetchMock = jest.fn();

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}

beforeAll(() => {
  if (typeof window.PointerEvent === 'undefined') {
    window.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent;
  }
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return this.dataset?.testid === 'design-preview-stage' ? stage.width : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return this.dataset?.testid === 'design-preview-stage' ? stage.height : 0;
    },
  });
  HTMLCanvasElement.prototype.getContext = jest.fn(
    () =>
      new Proxy(
        {},
        {
          get: (target: Record<string, unknown>, prop: string) =>
            prop in target ? target[prop] : () => undefined,
          set: (target: Record<string, unknown>, prop: string, value) => {
            target[prop] = value;
            return true;
          },
        },
      ),
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterAll(() => {
  if (originalWidth) {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalWidth);
  }
  if (originalHeight) {
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalHeight);
  }
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

const SHOT_URL = '/preview/d/shot-token';

beforeEach(() => {
  mockViewport(false);
  api.listFiles.mockResolvedValue({ items: [indexHtml] });
  api.getDesignSystem.mockResolvedValue({ id: 'etus', name: 'Etus' });
  ws.listChanges.mockResolvedValue({ items: [], paths: [], projectUpdatedAt: 'p', until: 'u' });
  ws.previewUrl.mockResolvedValue({
    url: 'https://chat.test/preview/p/tok/index.html',
    expiresAt: '2999-01-01T00:00:00.000Z',
  });
  jest
    .spyOn(drawApi, 'requestScreenshot')
    .mockResolvedValue(
      job({ status: 'succeeded', downloadUrl: SHOT_URL, downloads: [{ url: SHOT_URL }] }),
    );
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
  compose.mockResolvedValue(new Blob(['marked'], { type: 'image/png' }));
  mockInsertIntoComposer.mockResolvedValue(true);
});

afterEach(() => {
  global.fetch = originalFetch;
});

function renderWorkspace(overrides: Partial<DesignProjectDetail> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
    logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
  });
  return render(
    <RecoilRoot>
      <QueryClientProvider client={client}>
        <JotaiProvider>
          <MemoryRouter initialEntries={['/design/prj_abc']}>
            <DesignWorkspace project={{ ...project, ...overrides }} me={me} />
          </MemoryRouter>
        </JotaiProvider>
      </QueryClientProvider>
    </RecoilRoot>,
  );
}

async function enterDrawMode() {
  await screen.findByTitle('Preview of index.html');
  await userEvent.click(screen.getByRole('button', { name: 'Draw' }));
  return screen.getByTestId('design-draw-canvas');
}

function drag(canvas: HTMLElement, from: [number, number], to: [number, number]) {
  fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: from[0], clientY: from[1] });
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: (from[0] + to[0]) / 2, clientY: to[1] });
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: to[0], clientY: to[1] });
  fireEvent.pointerUp(canvas, { pointerId: 1, clientX: to[0], clientY: to[1] });
}

const panel = () => within(screen.getByTestId('design-draw-panel'));

describe('draw mode (C9)', () => {
  it('turns on the Draw mode with a canvas over the device viewport and a side panel', async () => {
    renderWorkspace();
    const canvas = await enterDrawMode();
    expect(screen.getByRole('button', { name: 'Draw' })).toHaveAttribute('aria-pressed', 'true');
    expect(
      within(screen.getByTestId('design-device-viewport')).getByTestId('design-draw-canvas'),
    ).toBe(canvas);
    expect(canvas).toHaveAttribute('aria-label', 'Drawing area over the preview');
    expect(Number(canvas.getAttribute('width'))).toBeGreaterThanOrEqual(1440 * 0.5);
    expect(panel().getByRole('button', { name: 'Pen' })).toHaveAttribute('aria-pressed', 'true');
    for (const name of ['Rectangle', 'Arrow', 'Text', 'Undo', 'Clear drawing']) {
      expect(panel().getByRole('button', { name })).toBeInTheDocument();
    }
    expect(panel().getAllByRole('radio')).toHaveLength(5);
    expect(panel().getByText(/top of the page on the Desktop device/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(screen.queryByTestId('design-draw-canvas')).not.toBeInTheDocument();
    expect(screen.queryByTestId('design-draw-panel')).not.toBeInTheDocument();
  });

  it('draws with pen, rectangle, arrow and text, then undoes and clears', async () => {
    renderWorkspace();
    const canvas = await enterDrawMode();
    expect(panel().getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(panel().getByRole('button', { name: 'Send to chat' })).toBeDisabled();

    drag(canvas, [10, 10], [60, 40]);
    expect(canvas).toHaveAttribute('data-shapes', '1');
    await userEvent.click(panel().getByRole('button', { name: 'Rectangle' }));
    drag(canvas, [100, 100], [200, 160]);
    await userEvent.click(panel().getByRole('button', { name: 'Arrow' }));
    drag(canvas, [300, 300], [302, 301]);
    expect(canvas).toHaveAttribute('data-shapes', '2');
    drag(canvas, [300, 300], [380, 260]);
    expect(canvas).toHaveAttribute('data-shapes', '3');

    await userEvent.click(panel().getByRole('button', { name: 'Text' }));
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 2, clientX: 50, clientY: 400 });
    const input = await screen.findByRole('textbox', { name: 'Markup text' });
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveAttribute('maxlength', '80');
    await userEvent.type(input, 'maior{Enter}');
    expect(canvas).toHaveAttribute('data-shapes', '4');
    expect(screen.queryByRole('textbox', { name: 'Markup text' })).not.toBeInTheDocument();

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 3, clientX: 60, clientY: 500 });
    await userEvent.type(await screen.findByRole('textbox', { name: 'Markup text' }), 'x{Escape}');
    expect(canvas).toHaveAttribute('data-shapes', '4');

    await userEvent.click(panel().getByRole('button', { name: 'Undo' }));
    expect(canvas).toHaveAttribute('data-shapes', '3');
    await userEvent.click(panel().getByRole('button', { name: 'Clear drawing' }));
    expect(canvas).toHaveAttribute('data-shapes', '0');
    await userEvent.click(panel().getByRole('button', { name: 'Undo' }));
    expect(canvas).toHaveAttribute('data-shapes', '3');

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(canvas).toHaveAttribute('data-shapes', '2');
  });

  it('picks a theme color for the next marks', async () => {
    renderWorkspace();
    await enterDrawMode();
    const blue = panel().getByRole('radio', { name: 'Blue' });
    expect(panel().getByRole('radio', { name: 'Red' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(blue);
    expect(blue).toHaveAttribute('aria-checked', 'true');
    expect(panel().getByRole('radio', { name: 'Red' })).toHaveAttribute('aria-checked', 'false');
  });

  it('keeps the marks when zooming and drops them when the device changes', async () => {
    renderWorkspace();
    const canvas = await enterDrawMode();
    drag(canvas, [10, 10], [60, 40]);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Zoom' }), '0.75');
    expect(screen.getByTestId('design-draw-canvas')).toHaveAttribute('data-shapes', '1');
    await userEvent.click(screen.getByRole('button', { name: 'Mobile (390 x 844)' }));
    expect(screen.getByTestId('design-draw-canvas')).toHaveAttribute('data-shapes', '0');
    expect(screen.getByTestId('design-draw-canvas')).toHaveAttribute('width', '390');
  });

  it('sends the screenshot with the marks and the written text to the composer', async () => {
    jest.spyOn(drawApi, 'requestScreenshot').mockResolvedValue(job({}));
    api.getJob
      .mockResolvedValueOnce(job({ status: 'running' }))
      .mockResolvedValueOnce(
        job({ status: 'succeeded', downloadUrl: SHOT_URL, downloads: [{ url: SHOT_URL }] }),
      );
    renderWorkspace();
    const canvas = await enterDrawMode();
    await userEvent.click(screen.getByRole('button', { name: 'Tablet (820 x 1180)' }));
    drag(canvas, [10, 10], [60, 40]);
    await userEvent.type(
      panel().getByRole('textbox', { name: 'What do you want to change?' }),
      'make the heading bigger',
    );
    await userEvent.click(panel().getByRole('button', { name: 'Send to chat' }));
    expect(await panel().findByText(/Creating the preview image/)).toBeInTheDocument();
    expect(panel().getByRole('button', { name: 'Send to chat' })).toBeDisabled();
    await waitFor(() => expect(mockInsertIntoComposer).toHaveBeenCalledTimes(1), {
      timeout: 5000,
    });

    expect(drawApi.requestScreenshot).toHaveBeenCalledWith('prj_abc', {
      path: 'index.html',
      devices: ['tablet'],
      fullPage: false,
    });
    expect(api.getJob).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3080${SHOT_URL}`,
      expect.objectContaining({ credentials: 'omit' }),
    );
    const [screenshot, shapes, viewport] = compose.mock.calls[0];
    expect(screenshot).toBeInstanceOf(Blob);
    expect(shapes).toHaveLength(1);
    expect(viewport).toEqual({ width: 820, height: 1180 });

    const [text, files] = mockInsertIntoComposer.mock.calls[0];
    expect(text).toBe(
      'make the heading bigger\n\nSee the markup in the image and adjust the file index.html.',
    );
    expect(files).toHaveLength(1);
    expect(files[0]).toBeInstanceOf(File);
    expect(files[0].name).toBe('markup-tablet.png');
    expect(files[0].type).toBe('image/png');

    expect(await panel().findByText(/Image attached to the chat/)).toBeInTheDocument();
    expect(screen.getByTestId('design-draw-canvas')).toHaveAttribute('data-shapes', '0');
    expect(panel().getByRole('textbox', { name: 'What do you want to change?' })).toHaveValue('');
  });

  it('uses only the reference line when nothing was written', async () => {
    renderWorkspace();
    const canvas = await enterDrawMode();
    drag(canvas, [10, 10], [60, 40]);
    await userEvent.click(panel().getByRole('button', { name: 'Send to chat' }));
    await waitFor(() => expect(mockInsertIntoComposer).toHaveBeenCalled());
    expect(mockInsertIntoComposer.mock.calls[0][0]).toBe(
      'See the markup in the image and adjust the file index.html.',
    );
    expect(drawApi.requestScreenshot).toHaveBeenCalledWith(
      'prj_abc',
      expect.objectContaining({ devices: ['desktop'] }),
    );
  });

  it('switches to the Chat tab on phones after attaching the image', async () => {
    mockViewport(true);
    renderWorkspace();
    await userEvent.click(screen.getByRole('tab', { name: /Preview/ }));
    const canvas = await enterDrawMode();
    drag(canvas, [10, 10], [60, 40]);
    await userEvent.click(panel().getByRole('button', { name: 'Send to chat' }));
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /Chat/ })).toHaveAttribute('aria-selected', 'true'),
    );
    expect(drawApi.requestScreenshot).toHaveBeenCalledWith(
      'prj_abc',
      expect.objectContaining({ devices: ['mobile'] }),
    );
    expect(screen.getByTestId('design-chat-slot')).toBeVisible();
  });

  it('shows an error and keeps the marks when the screenshot job fails', async () => {
    jest
      .spyOn(drawApi, 'requestScreenshot')
      .mockResolvedValue(job({ status: 'failed', error: { code: 'renderer_unavailable' } }));
    renderWorkspace();
    const canvas = await enterDrawMode();
    drag(canvas, [10, 10], [60, 40]);
    await userEvent.click(panel().getByRole('button', { name: 'Send to chat' }));
    expect(await panel().findByRole('alert')).toHaveTextContent(
      'Could not create the preview image. Try again.',
    );
    expect(mockInsertIntoComposer).not.toHaveBeenCalled();
    expect(canvas).toHaveAttribute('data-shapes', '1');
    expect(panel().getByRole('button', { name: 'Send to chat' })).toBeEnabled();
  });

  it('shows an error when the composer refuses the image', async () => {
    mockInsertIntoComposer.mockResolvedValue(false);
    renderWorkspace();
    const canvas = await enterDrawMode();
    drag(canvas, [10, 10], [60, 40]);
    await userEvent.click(panel().getByRole('button', { name: 'Send to chat' }));
    expect(await panel().findByRole('alert')).toHaveTextContent(
      'Could not attach the image to the chat. Try again.',
    );
    expect(canvas).toHaveAttribute('data-shapes', '1');
  });

  it('does not offer to send when the person can only read the project', async () => {
    renderWorkspace({ canWrite: false, access: 'shared' });
    await enterDrawMode();
    expect(panel().queryByRole('button', { name: 'Send to chat' })).not.toBeInTheDocument();
    expect(panel().getByText(/only people who can edit the project/)).toBeInTheDocument();
  });

  it('explains which device the image uses on the free size', async () => {
    renderWorkspace();
    await enterDrawMode();
    await userEvent.click(screen.getByRole('button', { name: 'Free' }));
    expect(panel().getByText(/closest device: Tablet/)).toBeInTheDocument();
  });
});

describe('DrawOverlay', () => {
  const bridge = (ready: PreviewBridge['ready']): PreviewBridge =>
    ({
      ready,
      reload: jest.fn(),
      send: jest.fn(),
      subscribe: jest.fn(),
      lastError: null,
      nonce: 'n'.repeat(24),
      src: null,
      frameRef: { current: null },
    }) as unknown as PreviewBridge;

  const context = (preview: PreviewBridge): WorkspaceModeContext => ({
    project,
    me,
    path: 'index.html',
    device: 'mobile',
    geometry: {
      viewport: { width: 390, height: 844 },
      scale: 1,
      frame: { width: 390, height: 844 },
    },
    bridge: preview,
  });

  it('reloads a preview that was already shown, so the marks match the top of the page', () => {
    const loaded = bridge({
      type: 'etus:ready',
      nonce: 'n'.repeat(24),
      title: 't',
      docHeight: 2000,
    });
    render(
      <JotaiProvider>
        <DrawOverlay {...context(loaded)} />
      </JotaiProvider>,
    );
    expect(loaded.reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload a preview that is still loading', () => {
    const loading = bridge(null);
    render(
      <JotaiProvider>
        <DrawOverlay {...context(loading)} />
      </JotaiProvider>,
    );
    expect(loading.reload).not.toHaveBeenCalled();
  });

  it('maps pointer positions from the scaled box to viewport coordinates', () => {
    render(
      <JotaiProvider>
        <DrawOverlay {...context(bridge(null))} />
      </JotaiProvider>,
    );
    const canvas = screen.getByTestId('design-draw-canvas');
    jest.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 50,
      width: 195,
      height: 422,
    } as DOMRect);
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 105, clientY: 55 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 600, clientY: 55 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    expect(canvas).toHaveAttribute('data-shapes', '1');
  });
});
