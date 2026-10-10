import { FolderOpen, MessagesSquare, MonitorSmartphone } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { DesignTranslationKey } from '../i18n';
import { useDesignLocalize } from '../i18n';
import { cn } from '~/utils';

export type MobileTab = 'chat' | 'preview' | 'files';

export const MOBILE_TAB_PANEL_IDS: Record<MobileTab, string> = {
  chat: 'design-panel-chat',
  preview: 'design-panel-workspace',
  files: 'design-panel-files',
};

const TABS: { id: MobileTab; icon: LucideIcon; labelKey: DesignTranslationKey }[] = [
  { id: 'chat', icon: MessagesSquare, labelKey: 'workspace.layout.tab_chat' },
  { id: 'preview', icon: MonitorSmartphone, labelKey: 'workspace.layout.tab_preview' },
  { id: 'files', icon: FolderOpen, labelKey: 'workspace.layout.tab_files' },
];

export default function MobileTabBar({
  active,
  previewUpdated,
  onChange,
}: {
  active: MobileTab;
  previewUpdated: boolean;
  onChange: (tab: MobileTab) => void;
}) {
  const localize = useDesignLocalize();
  return (
    <div
      role="tablist"
      aria-label={localize('workspace.layout.tabs')}
      className="grid shrink-0 grid-cols-3 border-t border-border-light bg-presentation pb-[env(safe-area-inset-bottom)]"
    >
      {TABS.map(({ id, icon: Icon, labelKey }) => {
        const selected = active === id;
        const badge = id === 'preview' && previewUpdated && !selected;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={`design-tab-${id}`}
            aria-selected={selected}
            aria-controls={MOBILE_TAB_PANEL_IDS[id]}
            onClick={() => onChange(id)}
            className={cn(
              'relative flex h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text-primary',
              selected ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary',
            )}
          >
            <span className="relative">
              <Icon className="size-5" aria-hidden="true" />
              {badge ? (
                <span
                  data-testid="design-preview-updated"
                  className="absolute -right-1 -top-0.5 size-2 rounded-full bg-surface-submit"
                />
              ) : null}
            </span>
            {localize(labelKey)}
            {badge ? (
              <span className="sr-only">{localize('workspace.layout.preview_updated')}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
