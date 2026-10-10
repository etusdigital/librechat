import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye } from 'lucide-react';
import { Skeleton } from '@librechat/client';
import type { DesignMe, DesignProjectDetail } from '../api/types';
import type { PendingBrief } from '../state/pending-brief';
import {
  forgetConversation,
  useBindProjectConversation,
  useProjectConversation,
} from './project-conversation';
import { ChatPanel, useChatConversationId, useDesignChatActions } from './DesignChatAdapter';
import NextStepChips from '../workspace/next-steps/NextStepChips';
import { projectFirstMessage } from './project-link';
import { useDesignLocalize } from '../i18n';

export interface DesignChatSlotProps {
  project: DesignProjectDetail;
  me: DesignMe;
  pendingBrief: PendingBrief;
  composerText: string | null;
  onComposerTextUsed: () => void;
}

interface ChatSession {
  key: number;
  conversationId: string | null;
  firstMessage: string | null;
}

const SLOT_CLASS = 'flex h-full min-h-0 flex-1 flex-col';

function ChatLoading() {
  const localize = useDesignLocalize();
  return (
    <div role="status" aria-live="polite" className="flex flex-1 flex-col gap-3 p-4">
      <span className="sr-only">{localize('chat.loading')}</span>
      <Skeleton className="h-5 w-2/3" aria-hidden="true" />
      <Skeleton className="h-4 w-1/2" aria-hidden="true" />
      <Skeleton className="mt-auto h-12 w-full rounded-2xl" aria-hidden="true" />
    </div>
  );
}

function ReadOnlyChat() {
  const localize = useDesignLocalize();
  return (
    <div
      data-testid="design-chat-slot"
      className={`${SLOT_CLASS} items-center justify-center gap-3 p-6 text-center`}
    >
      <Eye className="size-8 text-text-tertiary" aria-hidden="true" />
      <p className="max-w-xs text-sm text-text-secondary">{localize('chat.read_only')}</p>
    </div>
  );
}

function useComposerText(
  conversationId: string | null,
  composerText: string | null,
  onComposerTextUsed: () => void,
) {
  const chatConversationId = useChatConversationId();
  const { insertIntoComposer } = useDesignChatActions();
  const inFlight = useRef<string | null>(null);
  const ready = conversationId != null && chatConversationId === conversationId;

  useEffect(() => {
    if (!composerText || !ready || inFlight.current === composerText) {
      return;
    }
    inFlight.current = composerText;
    insertIntoComposer(composerText).then((inserted) => {
      inFlight.current = null;
      if (inserted) {
        onComposerTextUsed();
      }
    });
  }, [composerText, insertIntoComposer, onComposerTextUsed, ready]);
}

function ProjectChat({
  project,
  pendingBrief,
  composerText,
  onComposerTextUsed,
}: DesignChatSlotProps) {
  const localize = useDesignLocalize();
  const projectId = project.projectId;
  const resolution = useProjectConversation(projectId);
  const bind = useBindProjectConversation(projectId);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const started = useRef(false);
  const { consume } = pendingBrief;
  const defaultText = localize('chat.first_message_default');

  useEffect(() => {
    if (started.current || resolution.status !== 'ready') {
      return;
    }
    started.current = true;
    if (resolution.conversationId) {
      setConversationId(resolution.conversationId);
      setSession({ key: 0, conversationId: resolution.conversationId, firstMessage: null });
      if (resolution.needsBinding) {
        bind(resolution.conversationId);
      }
      return;
    }
    const brief = consume();
    setSession({
      key: 0,
      conversationId: null,
      firstMessage: projectFirstMessage(projectId, brief ?? defaultText),
    });
  }, [bind, consume, defaultText, projectId, resolution]);

  const onConversationCreated = useCallback(
    (id: string) => {
      setConversationId(id);
      bind(id);
    },
    [bind],
  );

  const onConversationLost = useCallback(() => {
    forgetConversation(projectId);
    setConversationId(null);
    setSession((current) => ({
      key: (current?.key ?? 0) + 1,
      conversationId: null,
      firstMessage: projectFirstMessage(projectId, defaultText),
    }));
  }, [defaultText, projectId]);

  useComposerText(conversationId, composerText, onComposerTextUsed);

  return (
    <div data-testid="design-chat-slot" className={SLOT_CLASS}>
      {session ? (
        <ChatPanel
          key={session.key}
          conversationId={session.conversationId}
          firstMessage={session.firstMessage}
          onConversationCreated={onConversationCreated}
          onConversationLost={onConversationLost}
          className="relative flex min-h-0 w-full flex-1 flex-col"
        />
      ) : (
        <ChatLoading />
      )}
      <NextStepChips conversationId={conversationId} />
    </div>
  );
}

export default function DesignChatSlot(props: DesignChatSlotProps) {
  if (!props.project.canWrite) {
    return <ReadOnlyChat />;
  }
  return <ProjectChat {...props} />;
}
