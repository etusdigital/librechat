import { useCallback, useMemo } from 'react';
import {
  useDesignChatActions,
  useIsResponding,
  useLastAssistantMessage,
} from '../../chat/DesignChatAdapter';
import { parseNextSteps } from './parse-next-steps';
import { useDesignLocalize } from '../../i18n';

export default function NextStepChips({ conversationId }: { conversationId: string | null }) {
  const localize = useDesignLocalize();
  const lastMessage = useLastAssistantMessage(conversationId);
  const responding = useIsResponding();
  const { insertIntoComposer, sendMessage } = useDesignChatActions();
  const steps = useMemo(() => parseNextSteps(lastMessage?.text), [lastMessage?.text]);

  const choose = useCallback(
    async (step: string) => {
      if (await sendMessage(step)) {
        return;
      }
      await insertIntoComposer(step);
    },
    [insertIntoComposer, sendMessage],
  );

  if (steps.length === 0) {
    return null;
  }

  return (
    <nav
      aria-label={localize('chat.next_steps_label')}
      data-testid="design-next-steps"
      className="shrink-0 border-t border-border-light px-3 py-2"
    >
      <ul className="flex gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible md:pb-0">
        {steps.map((step) => (
          <li key={step} className="flex min-w-0 shrink-0 md:shrink">
            <button
              type="button"
              disabled={responding}
              onClick={() => {
                choose(step);
              }}
              className="max-w-[80vw] rounded-2xl border border-border-medium bg-surface-primary px-3 py-1.5 text-left text-sm text-text-primary transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary disabled:cursor-not-allowed disabled:opacity-50 md:max-w-full"
            >
              {step}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
