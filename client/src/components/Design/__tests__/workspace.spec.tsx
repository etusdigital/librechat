import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { createStore, Provider as JotaiProvider } from 'jotai';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import type { DesignMe, DesignProjectDetail, FileEntry } from '../api/types';
import { DesignWorkspace } from '../workspace/DesignWorkspacePage';
import { pendingBriefAtomFamily } from '../state/pending-brief';
import { workspaceApi } from '../api/workspace';
import { DesignApiError } from '../api/errors';
import { designApi } from '../api/client';

jest.mock('~/components/Chat/Menus/OpenSidebar', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../chat/DesignChatSlot', () => ({
  __esModule: true,
  useDesignChatResponding: () => false,
  default: ({
    pendingBrief,
    composerText,
    onComposerTextUsed,
  }: {
    pendingBrief: { brief: string | null };
    composerText: string | null;
    onComposerTextUsed: () => void;
  }) => (
    <div data-testid="design-chat-slot">
      <output data-testid="pending-brief">{pendingBrief.brief ?? ''}</output>
      <output data-testid="composer-text">{composerText ?? ''}</output>
      <button type="button" aria-label="use composer text" onClick={onComposerTextUsed} />
    </div>
  ),
}));

jest.mock('../api/client', () => ({
  ...jest.requireActual('../api/client'),
  designApi: {
    listFiles: jest.fn(),
    readFile: jest.fn(),
    getDesignSystem: jest.fn(),
    updateProject: jest.fn(),
  },
}));

jest.mock('../api/workspace', () => ({
  ...jest.requireActual('../api/workspace'),
  workspaceApi: {
    listChanges: jest.fn(),
    previewUrl: jest.fn(),
    renameFile: jest.fn(),
    deleteFile: jest.fn(),
    uploadFiles: jest.fn(),
    duplicateProject: jest.fn(),
    deleteProject: jest.fn(),
  },
}));

const api = designApi as unknown as Record<keyof typeof designApi, jest.Mock>;
const ws = workspaceApi as unknown as Record<keyof typeof workspaceApi, jest.Mock>;

const me: DesignMe = {
  sub: 's',
  name: 'Ana',
  orgId: 'org_1',
  permissions: ['projects.use'],
  defaultDesignSystem: 'etus',
};

const entry = (path: string, mime: string): FileEntry => ({
  path,
  mime,
  size: 10,
  sha256: `sha-${path}`,
  version: 1,
  updatedAt: '2026-10-01T10:00:00.000Z',
  updatedBy: 's',
});

const files = [
  entry('index.html', 'text/html'),
  entry('styles.css', 'text/css'),
  entry('assets/logo.png', 'image/png'),
  entry('README.md', 'text/markdown'),
];

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
  files,
};

const PREVIEW_URL = 'https://chat.test/preview/p/tok/index.html';

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

const sizes = { width: 1000, height: 800 };
const originalWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
const originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return this.dataset?.testid === 'design-preview-stage' ? sizes.width : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return this.dataset?.testid === 'design-preview-stage' ? sizes.height : 0;
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
  mockViewport(false);
  api.listFiles.mockResolvedValue({ items: files });
  api.getDesignSystem.mockResolvedValue({ id: 'etus', name: 'Etus' });
  api.readFile.mockImplementation(async (_id: string, { path }: { path: string }) => ({
    blob: new Blob([
      path.endsWith('.md') ? '# Título\n\nTexto' : `/* ${path} */ body { color: red; }`,
    ]),
    mime: 'text/plain',
    etag: null,
    version: 1,
  }));
  ws.listChanges.mockResolvedValue({ items: [], paths: [], projectUpdatedAt: 'p', until: 'u' });
  ws.previewUrl.mockResolvedValue({ url: PREVIEW_URL, expiresAt: '2999-01-01T00:00:00.000Z' });
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderWorkspace(overrides: Partial<DesignProjectDetail> = {}, path = '/design/prj_abc') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
    logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
  });
  return render(
    <QueryClientProvider client={client}>
      <JotaiProvider>
        <MemoryRouter initialEntries={[path]}>
          <DesignWorkspace project={{ ...project, ...overrides }} me={me} />
          <LocationProbe />
        </MemoryRouter>
      </JotaiProvider>
    </QueryClientProvider>,
  );
}

function openTab(name: string) {
  return within(screen.getByRole('list', { name: 'Open files' })).getByRole('button', { name });
}

async function previewFrame() {
  return (await screen.findByTitle('Preview of index.html')) as HTMLIFrameElement;
}

describe('workspace preview (C-6)', () => {
  it('loads the entry file in a sandboxed iframe with the bridge nonce', async () => {
    renderWorkspace();
    const frame = await previewFrame();
    expect(ws.previewUrl).toHaveBeenCalledWith('prj_abc', 'index.html');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-forms allow-popups');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.getAttribute('src')).toMatch(
      new RegExp(`^${PREVIEW_URL.replace(/\./g, '\\.')}\\?bridge=[A-Za-z0-9_-]{16,128}$`),
    );
    expect(screen.getByRole('link', { name: 'Open in a new tab' })).toHaveAttribute(
      'href',
      PREVIEW_URL,
    );
  });

  it.each([
    ['Mobile (390 x 844)', 'mobile', 390, 844],
    ['Tablet (820 x 1180)', 'tablet', 820, 1180],
    ['Desktop (1440 x 900)', 'desktop', 1440, 900],
  ])('applies the %s viewport', async (label, device, width, height) => {
    renderWorkspace();
    const frame = await previewFrame();
    await userEvent.click(screen.getByRole('button', { name: label }));
    const box = screen.getByTestId('design-device-frame');
    expect(box).toHaveAttribute('data-device', device);
    expect(frame).toHaveAttribute('width', String(width));
    expect(frame).toHaveAttribute('height', String(height));
    expect(screen.getByTestId('design-device-viewport')).toHaveStyle({
      width: `${width}px`,
      height: `${height}px`,
    });
    expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
  });

  it('fills the stage on the free device', async () => {
    renderWorkspace();
    const frame = await previewFrame();
    await userEvent.click(screen.getByRole('button', { name: 'Free' }));
    expect(frame).toHaveAttribute('width', '1000');
    expect(frame).toHaveAttribute('height', '800');
  });

  it('zooms by scaling the frame without changing the layout inside it', async () => {
    renderWorkspace();
    const frame = await previewFrame();
    await userEvent.click(screen.getByRole('button', { name: 'Mobile (390 x 844)' }));
    const zoom = screen.getByRole('combobox', { name: 'Zoom' });
    const viewport = screen.getByTestId('design-device-viewport');
    const box = screen.getByTestId('design-device-frame');

    for (const [value, scale] of [
      ['0.5', 0.5],
      ['0.75', 0.75],
      ['1', 1],
      ['1.25', 1.25],
      ['1.5', 1.5],
    ] as const) {
      await userEvent.selectOptions(zoom, value);
      expect(frame).toHaveAttribute('width', '390');
      expect(frame).toHaveAttribute('height', '844');
      expect(viewport).toHaveStyle({ width: '390px', height: '844px' });
      expect(box).toHaveAttribute('data-scale', String(scale));
      expect(box).toHaveStyle({
        width: `${Math.round(390 * scale)}px`,
        height: `${Math.round(844 * scale)}px`,
      });
      expect(viewport.style.transform).toBe(scale === 1 ? '' : `scale(${scale})`);
    }

    await userEvent.selectOptions(zoom, 'fit');
    expect(box).toHaveAttribute('data-scale', String(800 / 844));
    expect(frame).toHaveAttribute('width', '390');
  });

  it('reloads the frame with a new nonce when asked', async () => {
    renderWorkspace();
    const first = (await previewFrame()).getAttribute('src');
    await userEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
    const second = (await previewFrame()).getAttribute('src');
    expect(second).not.toBe(first);
    expect(ws.previewUrl).toHaveBeenCalledTimes(1);
  });

  it('asks for a new preview url when the current one is about to expire', async () => {
    ws.previewUrl
      .mockResolvedValueOnce({ url: PREVIEW_URL, expiresAt: new Date().toISOString() })
      .mockResolvedValue({
        url: 'https://chat.test/preview/p/tok2/index.html',
        expiresAt: '2999-01-01T00:00:00.000Z',
      });
    renderWorkspace();
    await previewFrame();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
    await waitFor(() =>
      expect(screen.getByTitle('Preview of index.html').getAttribute('src')).toContain('tok2'),
    );
  });

  it('shows an error with retry when the preview url fails', async () => {
    ws.previewUrl
      .mockRejectedValueOnce(new DesignApiError({ status: 404, code: 'file_not_found' }))
      .mockResolvedValue({
        url: PREVIEW_URL,
        expiresAt: '2999-01-01T00:00:00.000Z',
      });
    renderWorkspace();
    expect(await screen.findByText('Could not load the preview.')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await previewFrame()).toBeInTheDocument();
  });
});

describe('workspace files', () => {
  it('opens files from the drawer as tabs and shows code, reading and media views', async () => {
    const createObjectURL = jest.fn(() => 'blob:logo');
    const revokeObjectURL = jest.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    renderWorkspace();
    await previewFrame();
    await userEvent.click(screen.getByRole('button', { name: 'Show files' }));
    const drawer = screen.getByRole('navigation', { name: 'Project files' });

    await userEvent.click(within(drawer).getByRole('button', { name: 'styles.css' }));
    expect(openTab('styles.css')).toHaveAttribute('aria-current', 'true');
    expect(await screen.findByRole('region', { name: 'Code of styles.css' })).toHaveTextContent(
      'body { color: red; }',
    );

    await userEvent.click(within(drawer).getByRole('button', { name: 'README.md' }));
    expect(await screen.findByRole('heading', { name: 'Título' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Code' }));
    expect(await screen.findByRole('region', { name: 'Code of README.md' })).toBeVisible();

    await userEvent.click(within(drawer).getByRole('button', { name: 'logo.png' }));
    expect(await screen.findByRole('img', { name: 'logo.png' })).toHaveAttribute(
      'src',
      'blob:logo',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Close logo.png' }));
    expect(
      within(screen.getByRole('list', { name: 'Open files' })).queryByRole('button', {
        name: 'logo.png',
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close index.html' })).not.toBeInTheDocument();
  });

  it('switches an html file between preview and code', async () => {
    renderWorkspace();
    await previewFrame();
    await userEvent.click(screen.getByRole('button', { name: 'Code' }));
    expect(await screen.findByRole('region', { name: 'Code of index.html' })).toBeVisible();
    expect(screen.queryByTitle('Preview of index.html')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await previewFrame()).toBeInTheDocument();
  });

  it('renames and deletes files after confirmation', async () => {
    ws.renameFile.mockResolvedValue(entry('main.css', 'text/css'));
    ws.deleteFile.mockResolvedValue(undefined);
    renderWorkspace();
    await previewFrame();
    await userEvent.click(screen.getByRole('button', { name: 'Show files' }));

    await userEvent.click(screen.getByRole('button', { name: 'Rename styles.css' }));
    const input = screen.getByRole('textbox', { name: 'New file path' });
    await userEvent.clear(input);
    await userEvent.type(input, 'main.css{Enter}');
    await waitFor(() =>
      expect(ws.renameFile).toHaveBeenCalledWith('prj_abc', { from: 'styles.css', to: 'main.css' }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Delete styles.css' }));
    expect(screen.getByText(/Delete styles\.css and all of its versions/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(ws.deleteFile).toHaveBeenCalledWith('prj_abc', 'styles.css'));
    expect(screen.queryByRole('button', { name: 'Delete index.html' })).not.toBeInTheDocument();
  });

  it('uploads the picked files', async () => {
    ws.uploadFiles.mockResolvedValue({ items: [] });
    renderWorkspace();
    await previewFrame();
    await userEvent.click(screen.getByRole('button', { name: 'Show files' }));
    const picked = new File(['x'], 'photo.png', { type: 'image/png' });
    await userEvent.upload(screen.getByTestId('design-file-upload-input'), picked);
    await waitFor(() => expect(ws.uploadFiles).toHaveBeenCalledWith('prj_abc', [picked]));
  });

  it('hides write actions from people who can only read', async () => {
    renderWorkspace({ canWrite: false });
    await previewFrame();
    await userEvent.click(screen.getByRole('button', { name: 'Show files' }));
    expect(screen.queryByRole('button', { name: 'Upload files' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Rename/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rename project' })).not.toBeInTheDocument();
  });

  it('renames the project from the header', async () => {
    api.updateProject.mockResolvedValue({ ...project, name: 'Novo nome' });
    renderWorkspace();
    await userEvent.click(screen.getByRole('button', { name: 'Rename project' }));
    const input = screen.getByRole('textbox', { name: 'Project name' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Novo nome{Enter}');
    await waitFor(() =>
      expect(api.updateProject).toHaveBeenCalledWith('prj_abc', { name: 'Novo nome' }),
    );
  });

  it('links the design system to the gallery in the context of the project', async () => {
    renderWorkspace();
    expect(await screen.findByRole('link', { name: 'Design system: Etus' })).toHaveAttribute(
      'href',
      '/design/systems?project=prj_abc',
    );
  });

  it('hands the brief of a new project from the home dialog to the chat slot', async () => {
    const store = createStore();
    store.set(pendingBriefAtomFamily('prj_abc'), 'landing para pequenas empresas');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <JotaiProvider store={store}>
          <MemoryRouter initialEntries={['/design/prj_abc']}>
            <DesignWorkspace project={project} me={me} />
          </MemoryRouter>
        </JotaiProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('pending-brief')).toHaveTextContent('landing para pequenas empresas');
  });

  it('hands the apply request from the gallery to the chat and clears the url', async () => {
    api.getDesignSystem.mockImplementation(async (id: string) =>
      id === 'airbnb' ? { id: 'airbnb', name: 'Airbnb' } : { id: 'etus', name: 'Etus' },
    );
    renderWorkspace({}, '/design/prj_abc?applyDesignSystem=airbnb&tab=x');
    await waitFor(() =>
      expect(screen.getByTestId('composer-text')).toHaveTextContent(
        'Apply the design system Airbnb',
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/design\/prj_abc\?tab=x$/),
    );
    await userEvent.click(screen.getByRole('button', { name: 'use composer text' }));
    await waitFor(() => expect(screen.getByTestId('composer-text')).toBeEmptyDOMElement());
    expect(api.getDesignSystem).toHaveBeenCalledWith('airbnb', expect.anything());
  });
});

describe('workspace header actions', () => {
  it('shows the versions, export and share actions of the project', async () => {
    renderWorkspace();
    const actions = screen.getByTestId('design-workspace-actions');
    expect(within(actions).getByRole('button', { name: 'Versions' })).toBeVisible();
    expect(within(actions).getByRole('button', { name: 'Export' })).toBeVisible();
    expect(within(actions).getByRole('button', { name: 'Share' })).toBeVisible();
  });

  it('duplicates the project and opens the copy', async () => {
    ws.duplicateProject.mockResolvedValue({ ...project, projectId: 'prj_copy' });
    renderWorkspace();
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Duplicate project' });
    const name = within(dialog).getByRole('textbox', { name: 'Name of the copy' });
    expect(name).toHaveValue('Copy of Landing Produto X');
    await userEvent.clear(name);
    await userEvent.type(name, 'Landing B');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(ws.duplicateProject).toHaveBeenCalledWith('prj_abc', 'Landing B'));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/design/prj_copy'),
    );
  });

  it('deletes the project only after the name is typed', async () => {
    ws.deleteProject.mockResolvedValue(undefined);
    renderWorkspace();
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete project' });
    const confirm = within(dialog).getByRole('button', { name: 'Delete project' });
    expect(confirm).toBeDisabled();
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Project name to confirm' }),
      'Landing Produto',
    );
    expect(confirm).toBeDisabled();
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Project name to confirm' }),
      ' X',
    );
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(ws.deleteProject).toHaveBeenCalledWith('prj_abc', 'Landing Produto X'),
    );
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/design$/));
  });

  it('renames the project from the menu, which is how phones reach it', async () => {
    mockViewport(true);
    api.updateProject.mockResolvedValue({ ...project, name: 'Landing curta' });
    renderWorkspace();
    expect(screen.getByRole('button', { name: 'Rename project' })).toHaveClass('max-md:hidden');
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename project' }));
    const input = await screen.findByRole('textbox', { name: 'Project name' });
    await waitFor(() => expect(input).toHaveFocus());
    await userEvent.clear(input);
    await userEvent.type(input, 'Landing curta{Enter}');
    await waitFor(() =>
      expect(api.updateProject).toHaveBeenCalledWith('prj_abc', { name: 'Landing curta' }),
    );
  });

  it('does not offer to delete a project the person can only read', async () => {
    renderWorkspace({ canWrite: false });
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Duplicate' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Rename project' })).not.toBeInTheDocument();
  });
});

describe('workspace layout (C-11)', () => {
  it('shows chat and workspace side by side on larger screens', async () => {
    renderWorkspace();
    await previewFrame();
    expect(screen.getByTestId('design-workspace')).toHaveAttribute('data-layout', 'split');
    expect(screen.queryByRole('tablist', { name: 'Project sections' })).not.toBeInTheDocument();
    const chat = screen.getByRole('region', { name: 'Chat with the agent' });
    expect(chat).toBeVisible();
    expect(chat).toHaveStyle({ width: '440px' });
    expect(screen.getByRole('region', { name: 'Workspace' })).toBeVisible();
    expect(within(chat).getByTestId('design-chat-slot')).toBeVisible();
  });

  it('resizes the chat between 320 and 560 px with the keyboard', async () => {
    renderWorkspace();
    await previewFrame();
    const handle = screen.getByRole('separator', { name: 'Resize the chat' });
    const chat = screen.getByRole('region', { name: 'Chat with the agent' });
    handle.focus();
    await userEvent.keyboard('{End}');
    expect(chat).toHaveStyle({ width: '560px' });
    await userEvent.keyboard('{ArrowRight}');
    expect(chat).toHaveStyle({ width: '560px' });
    await userEvent.keyboard('{Home}');
    expect(chat).toHaveStyle({ width: '320px' });
    await userEvent.keyboard('{ArrowRight}');
    expect(handle).toHaveAttribute('aria-valuenow', '336');
  });

  it('uses three tabs on phones and keeps the chat mounted while hidden', async () => {
    mockViewport(true);
    renderWorkspace();
    expect(screen.getByTestId('design-workspace')).toHaveAttribute('data-layout', 'compact');
    const tabs = screen.getByRole('tablist', { name: 'Project sections' });
    const [chatTab, previewTab, filesTab] = within(tabs).getAllByRole('tab');
    expect(chatTab).toHaveTextContent('Chat');
    expect(previewTab).toHaveTextContent('Preview');
    expect(filesTab).toHaveTextContent('Files');
    expect(chatTab).toHaveAttribute('aria-selected', 'true');

    const slot = screen.getByTestId('design-chat-slot');
    expect(slot).toBeVisible();
    expect(screen.getByRole('tabpanel', { name: 'Chat' })).toBeVisible();

    await userEvent.click(previewTab);
    expect(screen.getByTestId('design-chat-slot')).toBe(slot);
    expect(slot).not.toBeVisible();
    expect(await previewFrame()).toBeVisible();
    expect(screen.getByTestId('design-device-frame')).toHaveAttribute('data-device', 'mobile');

    await userEvent.click(filesTab);
    const drawer = screen.getByRole('navigation', { name: 'Project files' });
    expect(drawer).toBeVisible();
    await userEvent.click(within(drawer).getByRole('button', { name: 'styles.css' }));
    expect(previewTab).toHaveAttribute('aria-selected', 'true');
    expect(openTab('styles.css')).toHaveAttribute('aria-current', 'true');

    await userEvent.click(chatTab);
    expect(screen.getByTestId('design-chat-slot')).toBe(slot);
    expect(slot).toBeVisible();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('marks the preview tab when the project changes while the chat is open', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    try {
      mockViewport(true);
      ws.listChanges
        .mockResolvedValueOnce({
          items: [entry('index.html', 'text/html')],
          paths: ['index.html'],
          projectUpdatedAt: 'p',
          until: 'u1',
        })
        .mockResolvedValue({
          items: [{ ...entry('index.html', 'text/html'), sha256: 'new' }],
          paths: ['index.html'],
          projectUpdatedAt: 'p',
          until: 'u2',
        });
      renderWorkspace();
      await waitFor(() => expect(ws.listChanges).toHaveBeenCalledTimes(1));
      await act(async () => {
        jest.advanceTimersByTime(20_000);
      });
      expect(await screen.findByTestId('design-preview-updated')).toBeInTheDocument();
      expect(screen.getAllByText('The preview was updated').length).toBeGreaterThan(0);
      await userEvent.click(screen.getByRole('tab', { name: /Preview/ }));
      expect(screen.queryByTestId('design-preview-updated')).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });
});
