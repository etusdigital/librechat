import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Constants, ContentTypes } from 'librechat-data-provider';
import { useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil';
import {
  RouterProvider,
  createMemoryRouter,
  useLocation,
  useNavigate,
  UNSAFE_LocationContext as LocationContext,
} from 'react-router-dom';
import type { TMessage } from 'librechat-data-provider';
import { useLatestMessage } from '~/hooks/Messages/useLatestMessage';
import { useFileHandlingNoChatContext } from '~/hooks';
import ChatRoute from '~/routes/ChatRoute';
import { mainTextareaId } from '~/common';
import { cn } from '~/utils';
import store from '~/store';

export const DESIGN_AGENT_ID = 'agent_etus_design';
const CHAT_INDEX = 0;
const PROJECT_LINK_LABEL = 'Projeto Etus Design';
const HIDDEN_CHAT_CONTROLS =
  '[&_[data-testid=header-new-chat-button]]:hidden [&_[data-testid=model-selector-button]]:hidden';

export function projectLinkLine(projectId: string): string {
  return `[${PROJECT_LINK_LABEL}]: ${projectId}`;
}

export function withProjectLink(projectId: string, text: string): string {
  return `${projectLinkLine(projectId)}\n\n${text}`;
}

function conversationIdFromPath(pathname: string): string | null {
  const match = /^\/c\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function initialEntry(agentId: string, conversationId?: string, firstMessage?: string): string {
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

export type ChatPanelProps = {
  agentId?: string;
  conversationId?: string;
  firstMessage?: string;
  onConversationCreated?: (conversationId: string) => void;
  className?: string;
};

export const ChatPanel = memo(function ChatPanel({
  agentId = DESIGN_AGENT_ID,
  conversationId,
  firstMessage,
  onConversationCreated,
  className,
}: ChatPanelProps) {
  const navigateOuter = useNavigate();
  const navigateOuterRef = useRef(navigateOuter);
  navigateOuterRef.current = navigateOuter;
  const onCreatedRef = useRef(onConversationCreated);
  onCreatedRef.current = onConversationCreated;
  const leave = useCallback((to: string) => navigateOuterRef.current(to), []);

  const [router] = useState(() =>
    createMemoryRouter(
      [
        { path: '/c/:conversationId?', element: <ChatRoute /> },
        { path: '*', element: <LeaveEmbeddedChat navigateOuter={leave} /> },
      ],
      { initialEntries: [initialEntry(agentId, conversationId, firstMessage)] },
    ),
  );

  useEffect(() => {
    let known = conversationId ?? null;
    return router.subscribe((state) => {
      const id = conversationIdFromPath(state.location.pathname);
      if (id && id !== Constants.NEW_CONVO && id !== known) {
        known = id;
        onCreatedRef.current?.(id);
      }
    });
  }, [router, conversationId]);

  useEffect(() => () => router.dispose(), [router]);

  return (
    <div className={cn(HIDDEN_CHAT_CONTROLS, className)} data-etus-design-chat="">
      <LocationContext.Provider value={null as never}>
        <RouterProvider router={router} />
      </LocationContext.Provider>
    </div>
  );
});

export function useIsResponding(): boolean {
  return useRecoilValue(store.isSubmittingFamily(CHAT_INDEX));
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
  const message = useLatestMessage(CHAT_INDEX, conversationId ?? null);
  return useMemo(() => {
    if (!message || message.isCreatedByUser) {
      return null;
    }
    return { text: messageText(message) };
  }, [message]);
}

function waitFor(check: () => boolean, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const started = performance.now();
    const tick = () => {
      if (check()) {
        resolve(true);
      } else if (performance.now() - started > timeoutMs) {
        resolve(false);
      } else {
        requestAnimationFrame(tick);
      }
    };
    tick();
  });
}

function composerTextarea(): HTMLTextAreaElement | null {
  return document.getElementById(mainTextareaId) as HTMLTextAreaElement | null;
}

export function useDesignChatActions() {
  const setActivePrompt = useSetRecoilState(store.activePromptByIndex(CHAT_INDEX));
  const [files, setFiles] = useRecoilState(store.filesByIndex(CHAT_INDEX));
  const conversation = useRecoilValue(store.conversationByIndex(CHAT_INDEX));
  const isResponding = useIsResponding();
  const [, setFilesLoading] = useState(false);
  const { handleFiles } = useFileHandlingNoChatContext(undefined, {
    files,
    setFiles,
    setFilesLoading,
    conversation,
  });

  const insertIntoComposer = useCallback(
    async (text: string, attachments?: File[]): Promise<boolean> => {
      if (text !== '') {
        setActivePrompt(text);
      }
      if (attachments == null || attachments.length === 0) {
        return true;
      }
      setFilesLoading(true);
      return handleFiles(attachments);
    },
    [setActivePrompt, handleFiles],
  );

  const sendMessage = useCallback(
    async (text: string): Promise<boolean> => {
      const textarea = composerTextarea();
      if (!textarea || isResponding || textarea.value.trim() !== '') {
        return false;
      }
      setActivePrompt(text);
      const staged = await waitFor(() => composerTextarea()?.value === text);
      const form = composerTextarea()?.form;
      if (!staged || !form) {
        return false;
      }
      form.requestSubmit();
      return true;
    },
    [isResponding, setActivePrompt],
  );

  return { insertIntoComposer, sendMessage };
}
