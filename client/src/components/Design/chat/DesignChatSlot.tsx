import { MessagesSquare } from 'lucide-react';
import type { DesignMe, DesignProjectDetail } from '../api/types';
import { useDesignLocalize } from '../i18n';

export interface DesignChatSlotProps {
  project: DesignProjectDetail;
  me: DesignMe;
  composerText: string | null;
  onComposerTextUsed: () => void;
}

export function useDesignChatResponding() {
  return false;
}

export default function DesignChatSlot(_props: DesignChatSlotProps) {
  const localize = useDesignLocalize();
  return (
    <div
      data-testid="design-chat-slot"
      className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <MessagesSquare className="size-8 text-text-tertiary" aria-hidden="true" />
      <p className="max-w-xs text-sm text-text-secondary">
        {localize('workspace.chat.placeholder')}
      </p>
    </div>
  );
}
