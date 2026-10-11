import { RecoilRoot } from 'recoil';
import { MemoryRouter } from 'react-router-dom';
import { Provider as JotaiProvider } from 'jotai';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import type { DesignComment, DesignMe, DesignProjectDetail, FileEntry } from '../api/types';
import type { FrameMessage } from '../preview/host-protocol';
import { DesignWorkspace } from '../workspace/DesignWorkspacePage';
import { workspaceApi } from '../api/workspace';
import { DesignApiError } from '../api/errors';
import { commentsApi } from '../api/comments';
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

jest.mock('../api/client', () => ({
  ...jest.requireActual('../api/client'),
  designApi: {
    listFiles: jest.fn(),
    listComments: jest.fn(),
    getDesignSystem: jest.fn(),
  },
}));

jest.mock('../api/comments', () => ({
  ...jest.requireActual('../api/comments'),
  commentsApi: { create: jest.fn(), update: jest.fn() },
}));

jest.mock('../api/workspace', () => ({
  ...jest.requireActual('../api/workspace'),
  workspaceApi: { listChanges: jest.fn(), previewUrl: jest.fn() },
}));

const api = designApi as unknown as Record<keyof typeof designApi, jest.Mock>;
const ws = workspaceApi as unknown as Record<keyof typeof workspaceApi, jest.Mock>;
const cm = commentsApi as unknown as Record<keyof typeof commentsApi, jest.Mock>;

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

const heroTarget = {
  selector: 'section.hero > h1',
  textSnippet: 'Título atual',
  rect: { x: 40, y: 120, w: 300, h: 48 },
  tag: 'h1',
};

const footerTarget = {
  selector: 'footer a:nth-of-type(2)',
  textSnippet: 'Contato',
  rect: { x: 60, y: 700, w: 80, h: 20 },
  tag: 'a',
};

const computed = {
  color: 'rgb(0, 0, 0)',
  backgroundColor: 'rgba(0, 0, 0, 0)',
  fontSize: '32px',
  fontWeight: '700',
  textAlign: 'left',
  margin: '0px',
  padding: '0px',
  borderRadius: '0px',
};

function comment(overrides: Partial<DesignComment> = {}): DesignComment {
  return {
    commentId: 'cmt_1',
    projectId: 'prj_abc',
    path: 'index.html',
    version: 4,
    anchor: { ...heroTarget, device: 'desktop' },
    body: 'deixar mais curto e direto.',
    authorSub: 'ana',
    authorName: 'Ana',
    status: 'open',
    resolvedBy: null,
    resolvedNote: null,
    sentToChatAt: null,
    createdAt: '2026-10-10T10:00:00.000Z',
    ...overrides,
  };
}

const sizes = { width: 1000, height: 800 };
const originalWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
const originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');

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

let stored: DesignComment[] = [];
let created = 0;

beforeEach(() => {
  jest.clearAllMocks();
  sizes.width = 1000;
  sizes.height = 800;
  stored = [];
  created = 0;
  mockViewport(false);
  mockInsertIntoComposer.mockResolvedValue(true);
  api.listFiles.mockResolvedValue({ items: [indexFile] });
  api.getDesignSystem.mockResolvedValue({ id: 'etus', name: 'Etus' });
  api.listComments.mockImplementation(async () => stored.map((item) => ({ ...item })));
  cm.create.mockImplementation(async (_projectId: string, input: Partial<DesignComment>) => {
    created += 1;
    const next = comment({ ...input, commentId: `cmt_${created}` });
    stored = [...stored, next];
    return next;
  });
  cm.update.mockImplementation(async (commentId: string, input: Record<string, unknown>) => {
    const current = stored.find((item) => item.commentId === commentId);
    if (!current) {
      throw new DesignApiError({ status: 404, code: 'not_found' });
    }
    const next: DesignComment = {
      ...current,
      ...(input.status ? { status: input.status as DesignComment['status'] } : {}),
      ...(input.sentToChat ? { sentToChatAt: '2026-10-10T11:00:00.000Z' } : {}),
    };
    stored = stored.map((item) => (item.commentId === commentId ? next : item));
    return next;
  });
  ws.listChanges.mockResolvedValue({ items: [], paths: [], projectUpdatedAt: 'p', until: 'u' });
  ws.previewUrl.mockResolvedValue({
    url: 'https://chat.test/preview/p/tok/index.html',
    expiresAt: '2999-01-01T00:00:00.000Z',
  });
});

function renderWorkspace(overrides: Partial<DesignProjectDetail> = {}, viewer: DesignMe = me) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
    logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
  });
  return render(
    <RecoilRoot>
      <QueryClientProvider client={client}>
        <JotaiProvider>
          <MemoryRouter initialEntries={['/design/prj_abc']}>
            <DesignWorkspace project={{ ...project, ...overrides }} me={viewer} />
          </MemoryRouter>
        </JotaiProvider>
      </QueryClientProvider>
    </RecoilRoot>,
  );
}

async function previewFrame() {
  return (await screen.findByTitle('Preview of index.html')) as HTMLIFrameElement;
}

function nonceOf(frame: HTMLIFrameElement) {
  return new URL(frame.getAttribute('src') ?? '').searchParams.get('bridge') ?? '';
}

function fromFrame(
  frame: HTMLIFrameElement,
  data: Record<string, unknown>,
  init: { origin?: string; nonce?: string } = {},
) {
  const event = new MessageEvent('message', {
    data: { ...data, nonce: init.nonce ?? nonceOf(frame) },
    origin: init.origin ?? 'null',
  });
  Object.defineProperty(event, 'source', { value: frame.contentWindow });
  act(() => {
    window.dispatchEvent(event);
  });
}

async function enterCommentMode() {
  const frame = await previewFrame();
  const postMessage = jest.spyOn(frame.contentWindow as Window, 'postMessage');
  await userEvent.click(screen.getByRole('button', { name: 'Comment' }));
  fromFrame(frame, { type: 'etus:ready', title: 'Landing', docHeight: 1200 });
  return { frame, postMessage };
}

function sentCommands(postMessage: jest.SpyInstance) {
  return postMessage.mock.calls.map(([message]) => message as FrameMessage);
}

async function commentOn(frame: HTMLIFrameElement, target: typeof heroTarget, body: string) {
  fromFrame(frame, { type: 'etus:target', ...target, computed });
  const composer = await screen.findByTestId('comment-composer');
  const field = within(composer).getByRole('textbox');
  await waitFor(() => expect(field).toHaveFocus());
  await userEvent.type(field, body);
  await userEvent.click(within(composer).getByRole('button', { name: 'Comment' }));
  await waitFor(() => expect(screen.queryByTestId('comment-composer')).not.toBeInTheDocument());
}

function panel() {
  return screen.getByTestId('comment-panel');
}

describe('comment mode (C-5)', () => {
  it('creates two anchored comments and puts the request in the composer', async () => {
    renderWorkspace();
    const { frame, postMessage } = await enterCommentMode();
    expect(sentCommands(postMessage)).toContainEqual(
      expect.objectContaining({ type: 'etus:mode', mode: 'comment' }),
    );

    fromFrame(frame, { type: 'etus:target', ...heroTarget, computed });
    const anchored = await screen.findByTestId('comment-anchored-composer');
    expect(anchored).toContainElement(screen.getByTestId('comment-composer'));
    expect(screen.getByTestId('comment-target-marker')).toHaveStyle({
      left: '40px',
      top: '120px',
      width: '300px',
      height: '48px',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await commentOn(frame, heroTarget, 'deixar mais curto e direto.');
    await commentOn(frame, footerTarget, 'trocar por WhatsApp.');

    expect(cm.create).toHaveBeenNthCalledWith(1, 'prj_abc', {
      path: 'index.html',
      version: 4,
      body: 'deixar mais curto e direto.',
      anchor: {
        selector: heroTarget.selector,
        textSnippet: heroTarget.textSnippet,
        rect: heroTarget.rect,
        device: 'desktop',
      },
    });
    expect(Object.keys(cm.create.mock.calls[0][1].anchor)).not.toContain('tag');
    expect(await within(panel()).findAllByTestId('comment-item')).toHaveLength(2);
    expect(within(panel()).getByRole('button', { name: 'Open (2)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await userEvent.click(within(panel()).getByRole('button', { name: 'Send to chat (2)' }));

    await waitFor(() => expect(mockInsertIntoComposer).toHaveBeenCalledTimes(1));
    expect(mockInsertIntoComposer).toHaveBeenCalledWith(
      [
        'Update the file index.html (version 4) according to these comments:',
        '1. [section.hero > h1] "Título atual": deixar mais curto e direto.',
        '2. [footer a:nth-of-type(2)] "Contato": trocar por WhatsApp.',
        'When you are done, mark each comment as resolved.',
      ].join('\n'),
    );
    await waitFor(() => expect(cm.update).toHaveBeenCalledTimes(2));
    expect(cm.update).toHaveBeenCalledWith('cmt_1', { sentToChat: true });
    expect(cm.update).toHaveBeenCalledWith('cmt_2', { sentToChat: true });
    expect(
      await within(panel()).findByText(
        'The request is in the chat. Review it and send it to the agent.',
      ),
    ).toBeInTheDocument();
    expect(within(panel()).getAllByText('Sent to chat')).toHaveLength(2);
    expect(within(panel()).getByRole('button', { name: 'Send to chat (0)' })).toBeDisabled();
  });

  it('only sends the checked comments', async () => {
    stored = [
      comment(),
      comment({ commentId: 'cmt_2', anchor: { ...footerTarget, device: 'desktop' }, body: 'b' }),
    ];
    renderWorkspace();
    await enterCommentMode();
    await userEvent.click(
      await within(panel()).findByRole('checkbox', {
        name: 'Include comment 1 in the chat request',
      }),
    );
    await userEvent.click(within(panel()).getByRole('button', { name: 'Send to chat (1)' }));
    await waitFor(() => expect(mockInsertIntoComposer).toHaveBeenCalled());
    expect(mockInsertIntoComposer.mock.calls[0][0]).toContain(
      '1. [footer a:nth-of-type(2)] "Contato": b',
    );
    expect(mockInsertIntoComposer.mock.calls[0][0]).not.toContain('section.hero');
  });

  it('switches to the chat tab on mobile after sending', async () => {
    mockViewport(true);
    stored = [comment({ anchor: { ...heroTarget, device: 'mobile' } })];
    renderWorkspace();
    await userEvent.click(screen.getByRole('tab', { name: 'Preview' }));
    await enterCommentMode();
    await userEvent.click(await within(panel()).findByRole('button', { name: 'Send to chat (1)' }));
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true'),
    );
    expect(screen.getByTestId('design-chat-slot')).toBeVisible();
  });

  it('keeps the comments unsent when the composer is not available', async () => {
    mockInsertIntoComposer.mockResolvedValue(false);
    stored = [comment()];
    renderWorkspace();
    await enterCommentMode();
    await userEvent.click(await within(panel()).findByRole('button', { name: 'Send to chat (1)' }));
    expect(
      await within(panel()).findByText('Could not put the request in the chat. Try again.'),
    ).toBeInTheDocument();
    expect(cm.update).not.toHaveBeenCalled();
  });

  it('ignores targets with a wrong nonce or origin', async () => {
    renderWorkspace();
    const { frame } = await enterCommentMode();
    fromFrame(frame, { type: 'etus:target', ...heroTarget, computed }, { nonce: 'x'.repeat(32) });
    fromFrame(frame, { type: 'etus:target', ...heroTarget, computed }, { origin: 'https://evil' });
    fromFrame(frame, { type: 'etus:target', ...heroTarget });
    await screen.findByTestId('comment-panel');
    expect(screen.queryByTestId('comment-composer')).not.toBeInTheDocument();
  });

  it('closes the composer with Escape and when leaving the mode', async () => {
    renderWorkspace();
    const { frame } = await enterCommentMode();
    fromFrame(frame, { type: 'etus:target', ...heroTarget, computed });
    const field = within(await screen.findByTestId('comment-composer')).getByRole('textbox');
    await userEvent.type(field, 'rascunho{Escape}');
    expect(screen.queryByTestId('comment-composer')).not.toBeInTheDocument();

    fromFrame(frame, { type: 'etus:target', ...heroTarget, computed });
    await screen.findByTestId('comment-composer');
    await userEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(screen.queryByTestId('comment-composer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('comment-panel')).not.toBeInTheDocument();
  });

  it('moves the composer to the panel when it does not fit over the preview', async () => {
    sizes.width = 200;
    sizes.height = 150;
    renderWorkspace();
    const { frame } = await enterCommentMode();
    fromFrame(frame, { type: 'etus:target', ...heroTarget, computed });
    const composer = await screen.findByTestId('comment-composer');
    expect(panel()).toContainElement(composer);
    expect(screen.queryByTestId('comment-anchored-composer')).not.toBeInTheDocument();
    expect(screen.getByTestId('comment-target-marker')).toBeInTheDocument();
  });

  it('explains a version that no longer exists', async () => {
    cm.create.mockRejectedValue(new DesignApiError({ status: 404, code: 'version_not_found' }));
    renderWorkspace();
    const { frame } = await enterCommentMode();
    fromFrame(frame, { type: 'etus:target', ...heroTarget, computed });
    const composer = await screen.findByTestId('comment-composer');
    await userEvent.type(within(composer).getByRole('textbox'), 'mais curto');
    await userEvent.click(within(composer).getByRole('button', { name: 'Comment' }));
    expect(
      await within(composer).findByText(
        'This file changed. Refresh the preview and comment again.',
      ),
    ).toBeInTheDocument();
    expect(within(composer).getByRole('textbox')).toHaveValue('mais curto');
  });
});

describe('comment panel', () => {
  it('highlights the comment and switches to its device', async () => {
    stored = [comment({ anchor: { ...heroTarget, device: 'mobile' } })];
    renderWorkspace();
    const { postMessage } = await enterCommentMode();
    await userEvent.click(
      await within(panel()).findByRole('button', { name: /^Comment 1 Título atual/ }),
    );
    expect(screen.getByTestId('design-device-frame')).toHaveAttribute('data-device', 'mobile');
    await waitFor(() =>
      expect(sentCommands(postMessage)).toContainEqual(
        expect.objectContaining({ type: 'etus:highlight', selector: 'section.hero > h1' }),
      ),
    );
  });

  it('lists resolved comments and reopens them', async () => {
    stored = [
      comment({ status: 'resolved', resolvedBy: 'agent', resolvedNote: 'Feito no título' }),
      comment({ commentId: 'cmt_2', body: 'outro' }),
    ];
    renderWorkspace();
    await enterCommentMode();
    await userEvent.click(await within(panel()).findByRole('button', { name: 'Resolved (1)' }));
    const items = within(panel()).getAllByTestId('comment-item');
    expect(items).toHaveLength(1);
    expect(within(items[0]).getByText('Note: Feito no título')).toBeInTheDocument();
    expect(within(items[0]).queryByRole('checkbox')).not.toBeInTheDocument();
    await userEvent.click(within(items[0]).getByRole('button', { name: 'Reopen comment 1' }));
    await waitFor(() => expect(cm.update).toHaveBeenCalledWith('cmt_1', { status: 'open' }));
    expect(await within(panel()).findByText('No resolved comments on this file.')).toBeVisible();
    await userEvent.click(within(panel()).getByRole('button', { name: 'Open (2)' }));
    await userEvent.click(within(panel()).getByRole('button', { name: 'Resolve comment 2' }));
    await waitFor(() => expect(cm.update).toHaveBeenCalledWith('cmt_2', { status: 'resolved' }));
  });

  it('lets a project editor resolve comments from other people', async () => {
    stored = [comment({ authorSub: 'bia', authorName: 'Bia' })];
    renderWorkspace();
    await enterCommentMode();
    expect(
      await within(panel()).findByRole('button', { name: 'Resolve comment 1' }),
    ).toBeInTheDocument();
    expect(within(panel()).getByText('Bia, version 4, Desktop')).toBeInTheDocument();
  });

  it('on a read only project, only the author changes status and nothing goes to the chat', async () => {
    stored = [
      comment({ authorSub: 'bia', authorName: 'Bia' }),
      comment({ commentId: 'cmt_2', authorSub: 'ana', body: 'meu' }),
    ];
    renderWorkspace({ canWrite: false, access: 'shared' });
    await enterCommentMode();
    const items = await within(panel()).findAllByTestId('comment-item');
    expect(within(items[0]).queryByRole('button', { name: /Resolve/ })).not.toBeInTheDocument();
    expect(within(items[1]).getByRole('button', { name: 'Resolve comment 2' })).toBeVisible();
    expect(within(panel()).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(panel()).queryByRole('button', { name: /Send to chat/ })).not.toBeInTheDocument();
    expect(
      within(panel()).getByText(
        'Click a point or element in the preview to leave a comment. People who edit the project see your comments.',
      ),
    ).toBeInTheDocument();
  });

  it('shows the loading, error and empty states', async () => {
    api.listComments.mockRejectedValueOnce(new DesignApiError({ status: 500, code: 'boom' }));
    renderWorkspace();
    await enterCommentMode();
    expect(await within(panel()).findByText('Could not load the comments.')).toBeVisible();
    await userEvent.click(within(panel()).getByRole('button', { name: 'Try again' }));
    expect(await within(panel()).findByText('No open comments on this file.')).toBeVisible();
  });
});
