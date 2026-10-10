import { ExternalLink } from 'lucide-react';
import {
  OGDialog,
  OGDialogContent,
  OGDialogDescription,
  OGDialogHeader,
  OGDialogTitle,
} from '@librechat/client';
import { CLAUDE_CODE_COMMAND, HUB_CONNECT_AGENTS_URL, HUB_MCP_URL } from './constants';
import { useDesignLocalize } from '../../i18n';
import CopyField from '../actions/CopyField';

export default function ConnectAgentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useDesignLocalize();
  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent className="flex max-h-[90vh] w-11/12 max-w-lg flex-col overflow-hidden">
        <OGDialogHeader>
          <OGDialogTitle>{localize('actions.connect_title')}</OGDialogTitle>
          <OGDialogDescription>
            {localize('actions.connect_intro', { url: HUB_MCP_URL })}
          </OGDialogDescription>
        </OGDialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto text-sm text-text-primary">
          <CopyField
            label={localize('actions.connect_claude_code')}
            value={CLAUDE_CODE_COMMAND}
            monospace
          />
          <p className="text-text-secondary">{localize('actions.connect_hub_hint')}</p>
          <p className="text-text-secondary">{localize('actions.connect_no_token')}</p>
          <a
            href={HUB_CONNECT_AGENTS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-lg bg-surface-inverted px-4 text-sm font-medium text-text-inverted transition-colors hover:bg-surface-inverted-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary focus-visible:ring-offset-2 max-sm:w-full max-sm:self-stretch"
          >
            {localize('actions.connect_open_hub')}
            <ExternalLink className="size-4" aria-hidden="true" />
            <span className="sr-only">{localize('actions.opens_new_tab')}</span>
          </a>
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
