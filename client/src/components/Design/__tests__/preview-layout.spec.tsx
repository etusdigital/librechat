import { MemoryRouter } from 'react-router-dom';
import { RecoilRoot } from 'recoil';
import { Provider as JotaiProvider } from 'jotai';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { DesignMe, DesignProjectDetail, FileEntry } from '../api/types';
import { modePanelLayout } from '../workspace/layout';
import { DesignWorkspace } from '../workspace/DesignWorkspacePage';
import { workspaceApi } from '../api/workspace';
import { designApi } from '../api/client';

jest.mock('~/components/Chat/Menus/OpenSidebar', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../chat/DesignChatAdapter', () => ({
  __esModule: true,
  useIsResponding: () => false,
  useDesignChatActions: () => ({ insertIntoComposer: jest.fn(), sendMessage: jest.fn() }),
}));

jest.mock('../chat/DesignChatSlot', () => ({
  __esModule: true,
  default: () => <div data-testid="design-chat-slot" />,
}));

jest.mock('../api/client', () => ({
  ...jest.requireActual('../api/client'),
  designApi: {
    listFiles: jest.fn(),
    listComments: jest.fn(),
    getDesignSystem: jest.fn(),
    readFile: jest.fn(),
  },
}));

jest.mock('../api/workspace', () => ({
  ...jest.requireActual('../api/workspace'),
  workspaceApi: { listChanges: jest.fn(), previewUrl: jest.fn() },
}));

const api = designApi as unknown as Record<keyof typeof designApi, jest.Mock>;
const ws = workspaceApi as unknown as Record<keyof typeof workspaceApi, jest.Mock>;

const me: DesignMe = {
  sub: 'ana',
  name: 'Ana',
  orgId: 'org_1',
  permissions: ['projects.use'],
  defaultDesignSystem: 'etus',
};

const indexFile: FileEntry = {
  path: 'index.html',
  mime: 'text/html',
  size: 10,
  sha256: 'sha',
  version: 4,
  updatedAt: null,
  updatedBy: 'ana',
};

const project: DesignProjectDetail = {
  projectId: 'prj_abc',
  name: 'Landing Produto X',
  kind: 'prototype',
  designSystemId: 'etus',
  entryFile: 'index.html',
  templateId: null,
  tags: [],
  owner: { sub: 'ana', name: 'Ana' },
  access: 'owner',
  canWrite: true,
  createdAt: null,
  updatedAt: null,
  files: [indexFile],
};

const target = {
  type: 'etus:target',
  selector: 'body > h1:nth-of-type(1)',
  textSnippet: 'Landing',
  rect: { x: 40, y: 120, w: 300, h: 48 },
  tag: 'h1',
  computed: {
    color: 'rgb(0, 0, 0)',
    backgroundColor: 'rgba(0, 0, 0, 0)',
    fontSize: '32px',
    fontWeight: '700',
    textAlign: 'left',
    margin: '0px',
    padding: '0px',
    borderRadius: '0px',
  },
};

const sizes = { stage: { width: 1000, height: 800 }, area: 1320 };
const originalWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
const originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      if (this.dataset?.testid === 'design-preview-stage') {
        return sizes.stage.width;
      }
      return this.dataset?.testid === 'design-preview-area' ? sizes.area : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      if (this.dataset?.testid === 'design-preview-stage') {
        return sizes.stage.height;
      }
      return this.dataset?.testid === 'design-preview-area' ? sizes.stage.height : 0;
    },
  });
});

afterAll(() => {
  if (originalWidth) {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalWidth);
  }
  if (originalHeight) {
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalHeight);
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  sizes.stage = { width: 1000, height: 800 };
  sizes.area = 1320;
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: !query.includes('max-width'),
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
  api.listFiles.mockResolvedValue({ items: [indexFile] });
  api.listComments.mockResolvedValue([]);
  api.getDesignSystem.mockResolvedValue({ id: 'etus', name: 'Etus' });
  api.readFile.mockResolvedValue({
    blob: new Blob(['<h1>Landing</h1>'], { type: 'text/html' }),
    mime: 'text/html',
    etag: '"sha"',
    version: 4,
  });
  ws.listChanges.mockResolvedValue({ items: [], paths: [], projectUpdatedAt: 'p', until: 'u' });
  ws.previewUrl.mockResolvedValue({
    url: 'https://chat.test/preview/p/tok/index.html',
    expiresAt: '2999-01-01T00:00:00.000Z',
  });
});

function renderWorkspace() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
    logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
  });
  return render(
    <RecoilRoot>
      <QueryClientProvider client={client}>
        <JotaiProvider>
          <MemoryRouter initialEntries={['/design/prj_abc']}>
            <DesignWorkspace project={project} me={me} />
          </MemoryRouter>
        </JotaiProvider>
      </QueryClientProvider>
    </RecoilRoot>,
  );
}

async function frameReady(mode: string) {
  const frame = (await screen.findByTitle('Preview of index.html')) as HTMLIFrameElement;
  await userEvent.click(screen.getByRole('button', { name: mode }));
  return frame;
}

function fromFrame(frame: HTMLIFrameElement, data: Record<string, unknown>) {
  const nonce = new URL(frame.getAttribute('src') ?? '').searchParams.get('bridge') ?? '';
  const event = new MessageEvent('message', { data: { ...data, nonce }, origin: 'null' });
  Object.defineProperty(event, 'source', { value: frame.contentWindow });
  act(() => {
    window.dispatchEvent(event);
  });
}

describe('mode panel layout', () => {
  it('stacks on the phone, docks with room for the preview and becomes a drawer without it', () => {
    expect(modePanelLayout(true, 390)).toBe('stacked');
    expect(modePanelLayout(false, 0)).toBe('side');
    expect(modePanelLayout(false, 800)).toBe('side');
    expect(modePanelLayout(false, 799)).toBe('drawer');
    expect(modePanelLayout(false, 479)).toBe('drawer');
  });

  it('docks the panel beside the preview when the area has room', async () => {
    renderWorkspace();
    await frameReady('Comment');
    const panel = await screen.findByTestId('design-mode-panel');
    expect(panel).toHaveAttribute('data-layout', 'side');
    expect(panel).toBeVisible();
    expect(screen.queryByTestId('design-mode-panel-toggle')).not.toBeInTheDocument();
  });

  it('turns the panel into a drawer that opens and closes from the toolbar', async () => {
    sizes.area = 640;
    sizes.stage = { width: 600, height: 700 };
    renderWorkspace();
    await frameReady('Comment');
    const panel = await screen.findByTestId('design-mode-panel');
    await waitFor(() => expect(panel).toHaveAttribute('data-layout', 'drawer'));
    expect(panel).not.toBeVisible();
    const toggle = screen.getByRole('button', { name: 'Show the panel (Comment)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', panel.id);
    await userEvent.click(toggle);
    expect(panel).toBeVisible();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const close = screen.getAllByRole('button', { name: 'Hide the panel (Comment)' });
    await userEvent.click(close[close.length - 1]);
    expect(panel).not.toBeVisible();
  });

  it('keeps the comment drawer closed while the comment box fits in the preview', async () => {
    sizes.area = 640;
    sizes.stage = { width: 600, height: 700 };
    renderWorkspace();
    const frame = await frameReady('Comment');
    fromFrame(frame, { type: 'etus:ready', title: 'Landing', docHeight: 1200 });
    fromFrame(frame, target);
    await screen.findByTestId('comment-anchored-composer');
    expect(screen.getByTestId('design-mode-panel')).not.toBeVisible();
  });

  it('opens the comment drawer when the comment box does not fit in the preview', async () => {
    sizes.area = 400;
    sizes.stage = { width: 200, height: 160 };
    renderWorkspace();
    const frame = await frameReady('Comment');
    fromFrame(frame, { type: 'etus:ready', title: 'Landing', docHeight: 1200 });
    fromFrame(frame, target);
    await waitFor(() => expect(screen.getByTestId('design-mode-panel')).toBeVisible());
    expect(screen.queryByTestId('comment-anchored-composer')).not.toBeInTheDocument();
  });

  it('opens the edit drawer when an element is picked and closes it on a mode change', async () => {
    sizes.area = 640;
    sizes.stage = { width: 600, height: 700 };
    renderWorkspace();
    const frame = await frameReady('Edit');
    fromFrame(frame, { type: 'etus:ready', title: 'Landing', docHeight: 1200 });
    expect(screen.getByTestId('design-mode-panel')).not.toBeVisible();
    fromFrame(frame, target);
    await waitFor(() => expect(screen.getByTestId('design-mode-panel')).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }));
    await waitFor(() => expect(screen.getByTestId('design-mode-panel')).not.toBeVisible());
  });

  it('collapses and shows the chat menu from the workspace header', async () => {
    renderWorkspace();
    const hide = await screen.findByRole('button', { name: 'Hide the chat menu' });
    expect(hide).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(hide);
    const show = await screen.findByRole('button', { name: 'Show the chat menu' });
    expect(show).toHaveAttribute('aria-expanded', 'false');
  });
});
