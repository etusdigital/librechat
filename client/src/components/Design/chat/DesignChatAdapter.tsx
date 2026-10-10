import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Constants, ContentTypes } from 'librechat-data-provider';
import { useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil';
import {
  RouterProvider,
  createMemoryRouter,
  useLocation,
  useNavigate,
  UNSAFE_RouteContext as RouteContext,
  UNSAFE_LocationContext as LocationContext,
} from 'react-router-dom';
import type { TMessage } from 'librechat-data-provider';
import { useLatestMessage } from '~/hooks/Messages/useLatestMessage';
import { useFileHandlingNoChatContext } from '~/hooks/Files';
import { draftInsertion } from './project-link';
import { mainTextareaId } from '~/common/types';
import ChatRoute from '~/routes/ChatRoute';
import { cn } from '~/utils';
import store from '~/store';

export const DESIGN_AGENT_ID = 'agent_etus_design';
export const DESIGN_CHAT_INDEX = 0;
export const HIDDEN_CHAT_CONTROL_TEST_IDS = ['header-new-chat-button', 'model-selector-button'];
const HIDDEN_CHAT_CONTROLS =
  '[&_[data-testid=header-new-chat-button]]:hidden [&_[data-testid=model-selector-button]]:hidden';
const COMPOSER_WAIT_MS = 4000;
const ROOT_ROUTE_CONTEXT = { outlet: null, matches: [], isDataRoute: false };

export function conversationIdFromPath(pathname: string): string | null {
  const match = /^\/c\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

export function initialChatEntry(
  agentId: string,
  conversationId?: string | null,
  firstMessage?: string | null,
): string {
  if (conversationId) {
    return `/c/${encodeURIComponent(conversationId)}`;
  }
  const params = new URLSearchParams({ agent_id: agentId });
  if (firstMessage) {
    params.set('prompt', firstMessage);
    params.set('submit', 'true');
  }
  return `/c/${Constants.NEW_CONVO}?${params.toString()}`;
}

function LeaveEmbeddedChat({ navigateOuter }: { navigateOuter: (to: string) => void }) {
  const location = useLocation();
  useEffect(() => {
    navigateOuter(`${location.pathname}${location.search}`);
  }, [location.pathname, location.search, navigateOuter]);
  return null;
}

const currentHref = () =>
  `${window.location.pathname}${window.location.search}${window.location.hash}`;

function useKeepPageUrl() {
  const location = useLocation();
  const conversation = useRecoilValue(store.conversationByIndex(DESIGN_CHAT_INDEX));
  const page = useRef<{ href: string; state: unknown } | null>(null);

  useEffect(() => {
    page.current = {
      href: `${location.pathname}${location.search}${location.hash}`,
      state: window.history.state,
    };
  }, [location.hash, location.pathname, location.search]);

  useEffect(() => {
    const saved = page.current;
    if (saved && currentHref() !== saved.href) {
      window.history.replaceState(saved.state, '', saved.href);
    }
  }, [conversation]);
}

export interface ChatPanelProps {
  agentId?: string;
  conversationId?: string | null;
  firstMessage?: string | null;
  onConversationCreated?: (conversationId: string) => void;
  onConversationLost?: () => void;
  className?: string;
}

export const ChatPanel = memo(function ChatPanel({
  agentId = DESIGN_AGENT_ID,
  conversationId,
  firstMessage,
  onConversationCreated,
  onConversationLost,
  className,
}: ChatPanelProps) {
  const navigateOuter = useNavigate();
  const navigateOuterRef = useRef(navigateOuter);
  navigateOuterRef.current = navigateOuter;
  const onCreatedRef = useRef(onConversationCreated);
  onCreatedRef.current = onConversationCreated;
  const onLostRef = useRef(onConversationLost);
  onLostRef.current = onConversationLost;
  const leave = useCallback((to: string) => navigateOuterRef.current(to), []);
  useKeepPageUrl();

  const [router] = useState(() =>
    createMemoryRouter(
      [
        { path: '/c/:conversationId?', element: <ChatRoute /> },
        { path: '*', element: <LeaveEmbeddedChat navigateOuter={leave} /> },
      ],
      { initialEntries: [initialChatEntry(agentId, conversationId, firstMessage)] },
    ),
  );

  useEffect(() => {
    let known = conversationId ?? null;
    return router.subscribe((state) => {
      const id = conversationIdFromPath(state.location.pathname);
      if (id === Constants.NEW_CONVO) {
        if (known) {
          known = null;
          onLostRef.current?.();
        }
        return;
      }
      if (id && id !== known) {
        known = id;
        onCreatedRef.current?.(id);
      }
    });
  }, [router, conversationId]);

  useEffect(() => () => router.dispose(), [router]);

  return (
    <div className={cn(HIDDEN_CHAT_CONTROLS, className)} data-etus-design-chat="">
      <LocationContext.Provider value={null as never}>
        <RouteContext.Provider value={ROOT_ROUTE_CONTEXT}>
          <RouterProvider router={router} />
        </RouteContext.Provider>
      </LocationContext.Provider>
    </div>
  );
});

export function useIsResponding(): boolean {
  return useRecoilValue(store.isSubmittingFamily(DESIGN_CHAT_INDEX));
}

export function useChatConversationId(): string | null {
  const conversation = useRecoilValue(store.conversationByIndex(DESIGN_CHAT_INDEX));
  return conversation?.conversationId ?? null;
}

export function messageText(message: TMessage): string {
  if (Array.isArray(message.content) && message.content.length > 0) {
    return message.content
      .map((part) => {
        if (part?.type !== ContentTypes.TEXT) {
          return '';
        }
        return typeof part.text === 'string' ? part.text : (part.text?.value ?? '');
      })
      .filter((text) => text !== '')
      .join('\n');
  }
  return message.text ?? '';
}

export function useLastAssistantMessage(conversationId?: string | null): { text: string } | null {
  const message = useLatestMessage(DESIGN_CHAT_INDEX, conversationId ?? null);
  return useMemo(() => {
    if (!conversationId || !message || message.isCreatedByUser) {
      return null;
    }
    return { text: messageText(message) };
  }, [conversationId, message]);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 16);
    }
  });
}

async function waitFor(check: () => boolean, timeoutMs = COMPOSER_WAIT_MS): Promise<boolean> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) {
      return false;
    }
    await nextFrame();
  }
  return true;
}

export function composerTextarea(): HTMLTextAreaElement | null {
  const element = document.getElementById(mainTextareaId);
  return element instanceof HTMLTextAreaElement ? element : null;
}

export interface DesignChatActions {
  insertIntoComposer: (text: string, files?: File[]) => Promise<boolean>;
  sendMessage: (text: string) => Promise<boolean>;
}

export function useDesignChatActions(): DesignChatActions {
  const setActivePrompt = useSetRecoilState(store.activePromptByIndex(DESIGN_CHAT_INDEX));
  const [files, setFiles] = useRecoilState(store.filesByIndex(DESIGN_CHAT_INDEX));
  const conversation = useRecoilValue(store.conversationByIndex(DESIGN_CHAT_INDEX));
  const isResponding = useIsResponding();
  const [, setFilesLoading] = useState(false);
  const { handleFiles } = useFileHandlingNoChatContext(undefined, {
    files,
    setFiles,
    setFilesLoading,
    conversation,
  });

  const stage = useCallback(
    async (textarea: HTMLTextAreaElement, text: string): Promise<boolean> => {
      const draft = textarea.value;
      const insertion = draftInsertion(draft, text);
      const expected = draft.trim() === '' ? text : `${draft}${insertion}`;
      textarea.setSelectionRange(draft.length, draft.length);
      setActivePrompt(draft.trim() === '' ? text : insertion);
      return waitFor(() => composerTextarea()?.value === expected);
    },
    [setActivePrompt],
  );

  const insertIntoComposer = useCallback(
    async (text: string, attachments?: File[]): Promise<boolean> => {
      if (!(await waitFor(() => composerTextarea() != null))) {
        return false;
      }
      const textarea = composerTextarea();
      if (!textarea) {
        return false;
      }
      if (text.trim() !== '' && !(await stage(textarea, text))) {
        return false;
      }
      if (!attachments || attachments.length === 0) {
        return true;
      }
      setFilesLoading(true);
      return handleFiles(attachments);
    },
    [handleFiles, stage],
  );

  const sendMessage = useCallback(
    async (text: string): Promise<boolean> => {
      const textarea = composerTextarea();
      if (!textarea || isResponding || textarea.value.trim() !== '' || text.trim() === '') {
        return false;
      }
      if (!(await stage(textarea, text))) {
        return false;
      }
      const form = composerTextarea()?.form;
      if (!form) {
        return false;
      }
      form.requestSubmit();
      return true;
    },
    [isResponding, stage],
  );

  return useMemo(() => ({ insertIntoComposer, sendMessage }), [insertIntoComposer, sendMessage]);
}
