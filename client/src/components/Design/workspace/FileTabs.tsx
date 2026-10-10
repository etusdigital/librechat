import { useEffect, useRef } from 'react';
import { FolderOpen, PanelLeftClose, X } from 'lucide-react';
import type { FileEntry } from '../api/types';
import { fileKindOf, fileNameOf } from './file-kind';
import { toolbarButton } from './PreviewToolbar';
import { FILE_KIND_ICONS } from './file-icons';
import { useDesignLocalize } from '../i18n';
import { cn } from '~/utils';

export default function FileTabs({
  tabs,
  active,
  entry,
  files,
  drawerOpen,
  onSelect,
  onClose,
  onToggleDrawer,
}: {
  tabs: string[];
  active: string;
  entry: string;
  files: FileEntry[];
  drawerOpen?: boolean;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onToggleDrawer?: () => void;
}) {
  const localize = useDesignLocalize();
  const listRef = useRef<HTMLDivElement>(null);
  const mimes = new Map(files.map((file) => [file.path, file.mime]));

  useEffect(() => {
    const selected = listRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
    selected?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  return (
    <div className="flex h-10 shrink-0 items-stretch border-b border-border-light bg-presentation">
      {onToggleDrawer ? (
        <div className="flex items-center border-r border-border-light px-1">
          <button
            type="button"
            aria-pressed={drawerOpen}
            aria-label={localize(drawerOpen ? 'workspace.drawer.hide' : 'workspace.drawer.show')}
            title={localize(drawerOpen ? 'workspace.drawer.hide' : 'workspace.drawer.show')}
            onClick={onToggleDrawer}
            className={toolbarButton}
          >
            {drawerOpen ? (
              <PanelLeftClose className="size-4" aria-hidden="true" />
            ) : (
              <FolderOpen className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
      ) : null}
      <div
        ref={listRef}
        role="list"
        aria-label={localize('workspace.tabs.label')}
        className="flex min-w-0 flex-1 overflow-x-auto"
      >
        {tabs.map((path) => {
          const selected = path === active;
          const Icon = FILE_KIND_ICONS[fileKindOf(path, mimes.get(path))];
          return (
            <div
              key={path}
              role="listitem"
              className={cn(
                'group flex max-w-[14rem] shrink-0 items-center border-r border-border-light',
                selected
                  ? 'bg-surface-primary text-text-primary'
                  : 'text-text-secondary hover:bg-surface-hover',
              )}
            >
              <button
                type="button"
                aria-current={selected ? 'true' : undefined}
                title={path}
                onClick={() => onSelect(path)}
                className="flex h-full min-w-0 items-center gap-1.5 pl-3 pr-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text-primary"
              >
                <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{fileNameOf(path)}</span>
              </button>
              {path === entry ? (
                <span className="w-2" />
              ) : (
                <button
                  type="button"
                  aria-label={localize('workspace.tabs.close', { name: fileNameOf(path) })}
                  onClick={() => onClose(path)}
                  className="mr-1 flex size-6 items-center justify-center rounded text-text-secondary hover:bg-surface-active hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
