import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import useSidebarToggle from '~/hooks/Nav/useSidebarToggle';
import useSidebarState from '~/hooks/Nav/useSidebarState';
import { useDesignLocalize } from '../../i18n';

export default function ChatSidebarToggle({ className }: { className?: string }) {
  const localize = useDesignLocalize();
  const { expanded } = useSidebarState();
  const { setSidebarOpen } = useSidebarToggle();
  const label = localize(
    expanded ? 'workspace.header.sidebar_hide' : 'workspace.header.sidebar_show',
  );
  const Icon = expanded ? PanelLeftClose : PanelLeftOpen;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      aria-controls="chat-history-nav"
      data-testid="design-chat-sidebar-toggle"
      onClick={() => setSidebarOpen(!expanded)}
      className={className}
    >
      <Icon className="size-5" aria-hidden="true" />
    </button>
  );
}
