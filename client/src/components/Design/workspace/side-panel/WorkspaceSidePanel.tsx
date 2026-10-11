import { X } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { ModePanelLayout } from '../layout';
import { toolbarButton } from '../PreviewToolbar';
import { useDesignLocalize } from '../../i18n';
import { cn } from '~/utils';

export default function WorkspaceSidePanel({
  id,
  title,
  layout,
  onClose,
  children,
}: {
  id: string;
  title: string;
  layout: ModePanelLayout;
  onClose: () => void;
  children: ReactNode;
}) {
  const localize = useDesignLocalize();
  const titleId = `${id}-title`;
  const closeLabel = localize('workspace.panel.close', { name: title });

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (layout === 'drawer' && event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <aside
      id={id}
      aria-labelledby={titleId}
      data-testid="design-side-panel"
      data-layout={layout}
      onKeyDown={onKeyDown}
      className={cn(
        'flex min-h-0 flex-col overflow-hidden bg-presentation',
        layout === 'stacked' && 'max-h-[50%] shrink-0 border-t border-border-light',
        layout === 'side' && 'w-80 shrink-0 border-l border-border-light',
        layout === 'drawer' &&
          'absolute inset-y-0 right-0 z-20 w-80 max-w-[calc(100%-3rem)] border-l border-border-light shadow-xl',
      )}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border-light px-3 py-1.5">
        <h2
          id={titleId}
          className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary"
        >
          {title}
        </h2>
        <button
          type="button"
          aria-label={closeLabel}
          title={closeLabel}
          onClick={onClose}
          className={toolbarButton}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div
        tabIndex={0}
        data-testid="design-side-panel-body"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text-primary"
      >
        {children}
      </div>
    </aside>
  );
}
