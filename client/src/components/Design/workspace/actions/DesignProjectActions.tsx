import { useId, useState } from 'react';
import { useAtomValue } from 'jotai';
import * as Ariakit from '@ariakit/react';
import { Button, DropdownPopup } from '@librechat/client';
import { Download, History, MoreHorizontal, Plug, Share2 } from 'lucide-react';
import type { MenuItemProps } from '@librechat/client';
import type { LucideIcon } from 'lucide-react';
import type { DesignProject } from '../../api/types';
import { deviceAtom, workspaceTabsAtomFamily, type DeviceId } from '../../state/atoms';
import VersionHistoryDialog from '../versions/VersionHistoryDialog';
import ConnectAgentDialog from '../connect/ConnectAgentDialog';
import ShareDialog from '../share/ShareDialog';
import { useDesignLocalize } from '../../i18n';
import ExportMenu from '../export/ExportMenu';

export type DesignProjectDialog = 'versions' | 'export' | 'share' | 'connect';

function ActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      aria-label={label}
      aria-haspopup="dialog"
      className="max-md:size-9 max-md:px-0"
    >
      <Icon className="size-4" aria-hidden="true" />
      <span className="hidden md:inline">{label}</span>
    </Button>
  );
}

export default function DesignProjectActions({
  project,
  activePath,
  device,
  menuItems = [],
}: {
  project: DesignProject;
  activePath?: string | null;
  device?: DeviceId;
  menuItems?: MenuItemProps[];
}) {
  const localize = useDesignLocalize();
  const menuId = useId();
  const tabs = useAtomValue(workspaceTabsAtomFamily(project.projectId));
  const currentDevice = useAtomValue(deviceAtom);
  const [dialog, setDialog] = useState<DesignProjectDialog | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const path = activePath !== undefined ? activePath : (tabs.active ?? project.entryFile ?? null);
  const dialogProps = (name: DesignProjectDialog) => ({
    open: dialog === name,
    onOpenChange: (open: boolean) => setDialog(open ? name : null),
  });
  const moreLabel = localize('actions.more');

  const items: MenuItemProps[] = [
    {
      id: 'design-connect-agents',
      label: localize('actions.connect_title'),
      icon: <Plug className="icon-sm" aria-hidden="true" />,
      ariaHasPopup: 'dialog',
      onClick: () => setDialog('connect'),
    },
    ...menuItems,
  ];

  return (
    <div className="flex items-center gap-2">
      <ActionButton
        icon={History}
        label={localize('actions.versions_title')}
        onClick={() => setDialog('versions')}
      />
      <ActionButton
        icon={Download}
        label={localize('actions.export_title')}
        onClick={() => setDialog('export')}
      />
      <ActionButton
        icon={Share2}
        label={localize('actions.share_title')}
        onClick={() => setDialog('share')}
      />
      <DropdownPopup
        portal
        menuId={menuId}
        focusLoop
        unmountOnHide
        isOpen={menuOpen}
        setIsOpen={setMenuOpen}
        items={items}
        trigger={
          <Ariakit.MenuButton
            aria-label={moreLabel}
            className="inline-flex size-9 items-center justify-center rounded-lg border border-border-light text-text-primary transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </Ariakit.MenuButton>
        }
      />
      <VersionHistoryDialog project={project} path={path} {...dialogProps('versions')} />
      <ExportMenu
        project={project}
        path={path}
        device={device ?? currentDevice}
        {...dialogProps('export')}
      />
      <ShareDialog project={project} {...dialogProps('share')} />
      <ConnectAgentDialog {...dialogProps('connect')} />
    </div>
  );
}
