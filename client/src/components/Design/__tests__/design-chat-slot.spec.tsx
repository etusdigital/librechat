import { createStore, Provider as JotaiProvider } from 'jotai';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DesignMe, DesignProjectDetail } from '../api/types';
import type { ChatPanelProps } from '../chat/DesignChatAdapter';
import { readStoredConversation, storeConversation } from '../chat/project-conversation';
import { pendingBriefAtomFamily, usePendingBrief } from '../state/pending-brief';
import DesignChatSlot from '../chat/DesignChatSlot';
import { DesignApiError } from '../api/errors';
import { designApi } from '../api/client';

const mockChat = {
  panels: [] as ChatPanelProps[],
  chatConversationId: null as string | null,
  insertIntoComposer: jest.fn<Promise<boolean>, [string, File[]?]>(),
};

jest.mock('../chat/DesignChatAdapter', () => ({
  __esModule: true,
  ChatPanel: (props: ChatPanelProps) => {
    mockChat.panels.push(props);
    return <div data-testid="chat-panel" data-conversation={props.conversationId ?? ''} />;
  },
  useChatConversationId: () => mockChat.chatConversationId,
  useDesignChatActions: () => ({
    insertIntoComposer: mockChat.insertIntoComposer,
    sendMessage: jest.fn(),
  }),
  useIsResponding: () => false,
  useLastAssistantMessage: () => null,
}));

jest.mock('../api/client', () => ({
  ...jest.requireActual('../api/client'),
  designApi: {
    projectOfConversation: jest.fn(),
    bindConversation: jest.fn(),
    listProjectConversations: jest.fn(),
  },
}));

const api = designApi as unknown as Record<
  'projectOfConversation' | 'bindConversation' | 'listProjectConversations',
  jest.Mock
>;

const bound = (...ids: string[]) => ({
  items: ids.map((conversationId, index) => ({
    conversationId,
    updatedAt: new Date(Date.UTC(2026, 9, 10, 12, 0, ids.length - index)).toISOString(),
  })),
});

const me: DesignMe = {
  sub: 's',
  name: 'Ana',
  orgId: 'org_1',
  permissions: ['projects.use'],
  defaultDesignSystem: 'etus',
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
  files: [],
};

const lastPanel = () => mockChat.panels[mockChat.panels.length - 1];

function Slot({
  target = project,
  composerText = null,
  onComposerTextUsed = () => undefined,
}: {
  target?: DesignProjectDetail;
  composerText?: string | null;
  onComposerTextUsed?: () => void;
}) {
  const pendingBrief = usePendingBrief(target.projectId);
  return (
    <DesignChatSlot
      project={target}
      me={me}
      pendingBrief={pendingBrief}
      composerText={composerText}
      onComposerTextUsed={onComposerTextUsed}
    />
  );
}

function renderSlot(props: Parameters<typeof Slot>[0] = {}, brief?: string) {
  const store = createStore();
  if (brief) {
    store.set(pendingBriefAtomFamily(project.projectId), brief);
  }
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <JotaiProvider store={store}>
        <Slot {...props} />
      </JotaiProvider>
    </QueryClientProvider>,
  );
  return { ...view, store, client };
}

describe('DesignChatSlot', () => {
  beforeEach(() => {
    mockChat.panels = [];
    mockChat.chatConversationId = null;
    mockChat.insertIntoComposer.mockReset().mockResolvedValue(true);
    api.projectOfConversation.mockReset();
    api.bindConversation.mockReset().mockResolvedValue(undefined);
    api.listProjectConversations.mockReset().mockResolvedValue(bound());
    window.localStorage.clear();
  });

  it('starts a new conversation with the project line and the brief, once', async () => {
    const { store } = renderSlot({}, 'landing com preços e depoimentos');
    await screen.findByTestId('chat-panel');
    expect(lastPanel().conversationId).toBeNull();
    expect(lastPanel().firstMessage).toBe(
      '[Projeto Etus Design]: prj_abc\n\nlanding com preços e depoimentos',
    );
    expect(store.get(pendingBriefAtomFamily(project.projectId))).toBeNull();
    expect(api.projectOfConversation).not.toHaveBeenCalled();
    expect(api.listProjectConversations).toHaveBeenCalledWith('prj_abc', expect.any(AbortSignal));
  });

  it('uses the default text when there is no brief', async () => {
    renderSlot();
    await screen.findByTestId('chat-panel');
    expect(lastPanel().firstMessage).toBe(
      "[Projeto Etus Design]: prj_abc\n\nLet's work on this project.",
    );
  });

  it('binds the conversation to the project once it exists and remembers it', async () => {
    renderSlot();
    await screen.findByTestId('chat-panel');
    act(() => lastPanel().onConversationCreated?.('conv-1'));
    await waitFor(() => expect(api.bindConversation).toHaveBeenCalledWith('prj_abc', 'conv-1'));
    expect(readStoredConversation('prj_abc')).toBe('conv-1');
  });

  it('resumes the last conversation bound to the project', async () => {
    storeConversation('prj_abc', 'conv-9');
    api.projectOfConversation.mockResolvedValue({ projectId: 'prj_abc' });
    renderSlot({}, 'pedido que não deve ser reenviado');
    expect(await screen.findByRole('status')).toHaveTextContent('Opening the project conversation');
    const panel = await screen.findByTestId('chat-panel');
    expect(panel).toHaveAttribute('data-conversation', 'conv-9');
    expect(lastPanel().firstMessage).toBeNull();
    expect(api.projectOfConversation).toHaveBeenCalledWith('conv-9', expect.any(AbortSignal));
    expect(api.bindConversation).not.toHaveBeenCalled();
    expect(api.listProjectConversations).not.toHaveBeenCalled();
  });

  it('resumes on another device the most recent conversation the service knows', async () => {
    api.listProjectConversations.mockResolvedValue(bound('conv-7', 'conv-3'));
    const { store } = renderSlot({}, 'pedido que não deve ser reenviado');
    const panel = await screen.findByTestId('chat-panel');
    expect(panel).toHaveAttribute('data-conversation', 'conv-7');
    expect(lastPanel().firstMessage).toBeNull();
    expect(store.get(pendingBriefAtomFamily(project.projectId))).toBe(
      'pedido que não deve ser reenviado',
    );
    expect(readStoredConversation('prj_abc')).toBe('conv-7');
    expect(api.projectOfConversation).not.toHaveBeenCalled();
    expect(api.bindConversation).not.toHaveBeenCalled();
  });

  it('asks the service when the remembered conversation belongs to another project', async () => {
    storeConversation('prj_abc', 'conv-9');
    api.projectOfConversation.mockResolvedValue({ projectId: 'prj_other' });
    api.listProjectConversations.mockResolvedValue(bound('conv-7'));
    renderSlot();
    const panel = await screen.findByTestId('chat-panel');
    expect(panel).toHaveAttribute('data-conversation', 'conv-7');
    expect(readStoredConversation('prj_abc')).toBe('conv-7');
    expect(api.bindConversation).not.toHaveBeenCalled();
  });

  it('keeps starting a new conversation when the service has no list route', async () => {
    api.listProjectConversations.mockRejectedValue(
      new DesignApiError({ status: 404, code: 'not_found' }),
    );
    const { store } = renderSlot({}, 'landing com preços');
    await screen.findByTestId('chat-panel');
    expect(lastPanel().conversationId).toBeNull();
    expect(lastPanel().firstMessage).toBe('[Projeto Etus Design]: prj_abc\n\nlanding com preços');
    expect(store.get(pendingBriefAtomFamily(project.projectId))).toBeNull();
    expect(readStoredConversation('prj_abc')).toBeNull();
  });

  it('ignores a list answer without conversations it can use', async () => {
    api.listProjectConversations.mockResolvedValue({ items: [{ conversationId: '' }] });
    renderSlot();
    await screen.findByTestId('chat-panel');
    expect(lastPanel().conversationId).toBeNull();
    expect(lastPanel().firstMessage).toContain('[Projeto Etus Design]: prj_abc');
  });

  it('resumes the remembered conversation without binding when the service fails', async () => {
    storeConversation('prj_abc', 'conv-9');
    api.projectOfConversation.mockRejectedValue(
      new DesignApiError({ status: 503, code: 'design_unavailable' }),
    );
    renderSlot();
    const panel = await screen.findByTestId('chat-panel');
    expect(panel).toHaveAttribute('data-conversation', 'conv-9');
    expect(api.bindConversation).not.toHaveBeenCalled();
    expect(api.listProjectConversations).not.toHaveBeenCalled();
  });

  it('binds again a remembered conversation the service does not know', async () => {
    storeConversation('prj_abc', 'conv-9');
    api.projectOfConversation.mockRejectedValue(
      new DesignApiError({ status: 404, code: 'not_found' }),
    );
    renderSlot();
    const panel = await screen.findByTestId('chat-panel');
    expect(panel).toHaveAttribute('data-conversation', 'conv-9');
    await waitFor(() => expect(api.bindConversation).toHaveBeenCalledWith('prj_abc', 'conv-9'));
    expect(api.listProjectConversations).not.toHaveBeenCalled();
  });

  it('starts over when the remembered conversation belongs to another project', async () => {
    storeConversation('prj_abc', 'conv-9');
    api.projectOfConversation.mockResolvedValue({ projectId: 'prj_other' });
    renderSlot();
    await screen.findByTestId('chat-panel');
    expect(lastPanel().conversationId).toBeNull();
    expect(lastPanel().firstMessage).toContain('[Projeto Etus Design]: prj_abc');
    expect(readStoredConversation('prj_abc')).toBeNull();
    expect(api.listProjectConversations).toHaveBeenCalledTimes(1);
  });

  it('opens a new project conversation when the chat loses the current one', async () => {
    storeConversation('prj_abc', 'conv-9');
    api.projectOfConversation.mockResolvedValue({ projectId: 'prj_abc' });
    renderSlot();
    await screen.findByTestId('chat-panel');
    act(() => lastPanel().onConversationLost?.());
    await waitFor(() => expect(lastPanel().conversationId).toBeNull());
    expect(lastPanel().firstMessage).toBe(
      "[Projeto Etus Design]: prj_abc\n\nLet's work on this project.",
    );
    expect(readStoredConversation('prj_abc')).toBeNull();
  });

  it('puts the gallery request in the composer once the conversation is on screen', async () => {
    storeConversation('prj_abc', 'conv-9');
    api.projectOfConversation.mockResolvedValue({ projectId: 'prj_abc' });
    const used = jest.fn();
    const { rerender, client, store } = renderSlot({
      composerText: 'Aplique o design system Airbnb',
      onComposerTextUsed: used,
    });
    await screen.findByTestId('chat-panel');
    expect(mockChat.insertIntoComposer).not.toHaveBeenCalled();
    mockChat.chatConversationId = 'conv-9';
    rerender(
      <QueryClientProvider client={client}>
        <JotaiProvider store={store}>
          <Slot composerText="Aplique o design system Airbnb" onComposerTextUsed={used} />
        </JotaiProvider>
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(mockChat.insertIntoComposer).toHaveBeenCalledWith('Aplique o design system Airbnb'),
    );
    await waitFor(() => expect(used).toHaveBeenCalledTimes(1));
  });

  it('shows a notice instead of the chat on a read only project', () => {
    renderSlot({ target: { ...project, canWrite: false, access: 'shared' } });
    expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('design-chat-slot')).toHaveTextContent(
      'You can view this project, but not edit it.',
    );
  });
});
