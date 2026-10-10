import { useEffect } from 'react';
import { RecoilRoot, useRecoilState, useSetRecoilState } from 'recoil';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import {
  RouterProvider,
  createBrowserRouter,
  createMemoryRouter,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import type { ReactNode } from 'react';
import type { DesignChatActions } from '../chat/DesignChatAdapter';
import { ChatPanel, useDesignChatActions, useIsResponding } from '../chat/DesignChatAdapter';
import store from '~/store';

const mockFiles = { handleFiles: jest.fn<Promise<boolean>, [File[]]>() };

jest.mock('~/routes/ChatRoute', () => ({
  __esModule: true,
  default: () => <MockChatRoute />,
}));

jest.mock('~/hooks/Files', () => ({
  __esModule: true,
  useFileHandlingNoChatContext: () => ({ handleFiles: mockFiles.handleFiles }),
}));

function MockChatRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  return (
    <div>
      <output data-testid="inner-location">{`${location.pathname}${location.search}`}</output>
      <output data-testid="inner-params">{JSON.stringify(params)}</output>
      <button
        type="button"
        aria-label="created"
        onClick={() => navigate('/c/conv-1', { replace: true })}
      />
      <button type="button" aria-label="new chat" onClick={() => navigate('/c/new')} />
      <button type="button" aria-label="agents" onClick={() => navigate('/agents')} />
    </div>
  );
}

function Composer({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [prompt, setPrompt] = useRecoilState(store.activePromptByIndex(0));
  useEffect(() => {
    const textarea = document.getElementById('prompt-textarea') as HTMLTextAreaElement | null;
    if (!prompt || !textarea) {
      return;
    }
    const { value, selectionStart, selectionEnd } = textarea;
    textarea.value = `${value.slice(0, selectionStart)}${prompt}${value.slice(selectionEnd)}`;
    setPrompt(undefined);
  }, [prompt, setPrompt]);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const textarea = document.getElementById('prompt-textarea') as HTMLTextAreaElement;
        onSubmit(textarea.value);
        textarea.value = '';
      }}
    >
      <textarea id="prompt-textarea" defaultValue="" />
    </form>
  );
}

function MirrorChatSettings() {
  const setConversation = useSetRecoilState(store.conversationByIndex(0));
  return (
    <button
      type="button"
      aria-label="mirror"
      onClick={() => {
        window.history.replaceState({}, '', '/design/prj_abc?agent_id=agent_etus_design');
        setConversation({ conversationId: 'new', endpoint: 'agents', title: null } as never);
      }}
    />
  );
}

function Responding({ value }: { value: boolean }) {
  const set = useSetRecoilState(store.isSubmittingFamily(0));
  useEffect(() => set(value), [set, value]);
  return null;
}

function setup({ responding = false }: { responding?: boolean } = {}) {
  const submitted: string[] = [];
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RecoilRoot>
      <Responding value={responding} />
      <Composer onSubmit={(text) => submitted.push(text)} />
      {children}
    </RecoilRoot>
  );
  const hook = renderHook(
    () => ({ actions: useDesignChatActions(), responding: useIsResponding() }),
    { wrapper },
  );
  const textarea = () => document.getElementById('prompt-textarea') as HTMLTextAreaElement;
  const actions = (): DesignChatActions => hook.result.current.actions;
  return { hook, submitted, textarea, actions };
}

describe('useDesignChatActions', () => {
  beforeEach(() => mockFiles.handleFiles.mockReset().mockResolvedValue(true));

  it('inserts text into an empty composer', async () => {
    const { actions, textarea } = setup();
    const inserted = actions().insertIntoComposer('Aplique o design system Etus');
    await waitFor(() => expect(textarea().value).toBe('Aplique o design system Etus'));
    await expect(inserted).resolves.toBe(true);
  });

  it('keeps the draft and adds the text after it', async () => {
    const { actions, textarea } = setup();
    textarea().value = 'meu rascunho';
    textarea().setSelectionRange(2, 2);
    const inserted = actions().insertIntoComposer('Aplique o design system Etus');
    await waitFor(() =>
      expect(textarea().value).toBe('meu rascunho\n\nAplique o design system Etus'),
    );
    await expect(inserted).resolves.toBe(true);
  });

  it('attaches files through the chat upload', async () => {
    const { actions, textarea } = setup();
    const png = new File(['x'], 'marcacoes.png', { type: 'image/png' });
    const inserted = actions().insertIntoComposer('Veja as marcações na imagem', [png]);
    await waitFor(() => expect(mockFiles.handleFiles).toHaveBeenCalledWith([png]));
    expect(textarea().value).toBe('Veja as marcações na imagem');
    await expect(inserted).resolves.toBe(true);
  });

  it('sends through the composer form when it is empty', async () => {
    const { actions, submitted } = setup();
    const sent = actions().sendMessage('Adicionar seção de FAQ');
    await waitFor(() => expect(submitted).toEqual(['Adicionar seção de FAQ']));
    await expect(sent).resolves.toBe(true);
  });

  it('does not send over a draft', async () => {
    const { actions, submitted, textarea } = setup();
    textarea().value = 'meu rascunho';
    await expect(actions().sendMessage('Adicionar seção de FAQ')).resolves.toBe(false);
    expect(submitted).toEqual([]);
    expect(textarea().value).toBe('meu rascunho');
  });

  it('does not send while the agent responds', async () => {
    const { actions, submitted, hook } = setup({ responding: true });
    await waitFor(() => expect(hook.result.current.responding).toBe(true));
    await expect(actions().sendMessage('Adicionar seção de FAQ')).resolves.toBe(false);
    expect(submitted).toEqual([]);
  });
});

describe('ChatPanel', () => {
  function renderPanel(props: Parameters<typeof ChatPanel>[0]) {
    const outer = createMemoryRouter(
      [
        {
          path: '/design/:projectId',
          element: <ChatPanel {...props} />,
        },
        { path: '*', element: <output data-testid="outer-left" /> },
      ],
      { initialEntries: ['/design/prj_abc'] },
    );
    render(
      <RecoilRoot>
        <RouterProvider router={outer} />
      </RecoilRoot>,
    );
    return outer;
  }

  it('opens the agent with the first message inside its own router', () => {
    const outer = renderPanel({ firstMessage: '[Projeto Etus Design]: prj_abc\n\noi' });
    const inner = new URL(screen.getByTestId('inner-location').textContent ?? '', 'http://t');
    expect(inner.pathname).toBe('/c/new');
    expect(inner.searchParams.get('agent_id')).toBe('agent_etus_design');
    expect(inner.searchParams.get('prompt')).toBe('[Projeto Etus Design]: prj_abc\n\noi');
    expect(inner.searchParams.get('submit')).toBe('true');
    expect(outer.state.location.pathname).toBe('/design/prj_abc');
  });

  it('reports the created conversation and then a lost one', () => {
    const created = jest.fn();
    const lost = jest.fn();
    const outer = renderPanel({
      firstMessage: 'oi',
      onConversationCreated: created,
      onConversationLost: lost,
    });
    act(() => screen.getByRole('button', { name: 'created' }).click());
    expect(created).toHaveBeenCalledWith('conv-1');
    expect(outer.state.location.pathname).toBe('/design/prj_abc');
    act(() => screen.getByRole('button', { name: 'new chat' }).click());
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('reopens an existing conversation without reporting it again', () => {
    const created = jest.fn();
    renderPanel({ conversationId: 'conv-1', onConversationCreated: created });
    expect(screen.getByTestId('inner-location')).toHaveTextContent('/c/conv-1');
    expect(JSON.parse(screen.getByTestId('inner-params').textContent ?? '')).toEqual({
      conversationId: 'conv-1',
    });
    act(() => screen.getByRole('button', { name: 'created' }).click());
    expect(created).not.toHaveBeenCalled();
  });

  it('hands navigation outside the chat to the page router', async () => {
    const outer = renderPanel({ firstMessage: 'oi' });
    act(() => screen.getByRole('button', { name: 'agents' }).click());
    await waitFor(() => expect(outer.state.location.pathname).toBe('/agents'));
    expect(screen.getByTestId('outer-left')).toBeInTheDocument();
  });

  it('hides the new chat button and the model selector of the chat header', () => {
    renderPanel({ firstMessage: 'oi' });
    const container = document.querySelector('[data-etus-design-chat]');
    expect(container?.className).toContain('[&_[data-testid=header-new-chat-button]]:hidden');
    expect(container?.className).toContain('[&_[data-testid=model-selector-button]]:hidden');
  });

  it('keeps the page url when the chat mirrors its settings into the address bar', async () => {
    window.history.replaceState({ idx: 3 }, '', '/design/prj_abc?applyDesignSystem=airbnb');
    const router = createBrowserRouter([
      {
        path: '/design/:projectId',
        element: (
          <>
            <ChatPanel firstMessage="oi" />
            <MirrorChatSettings />
          </>
        ),
      },
    ]);
    render(
      <RecoilRoot>
        <RouterProvider router={router} />
      </RecoilRoot>,
    );
    act(() => screen.getByRole('button', { name: 'mirror' }).click());
    await waitFor(() => expect(window.location.search).toBe('?applyDesignSystem=airbnb'));
    expect(window.location.pathname).toBe('/design/prj_abc');
    expect(router.state.location.search).toBe('?applyDesignSystem=airbnb');
  });
});
