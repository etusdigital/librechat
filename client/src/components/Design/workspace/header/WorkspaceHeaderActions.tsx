import { useState } from 'react';
import { Copy, Pencil, Trash2 } from 'lucide-react';
import type { MenuItemProps } from '@librechat/client';
import type { ProjectLifecycleDialog } from './ProjectLifecycleDialogs';
import type { DesignProjectDetail } from '../../api/types';
import type { DeviceId } from '../../state/atoms';
import { DeleteProjectDialog, DuplicateProjectDialog } from './ProjectLifecycleDialogs';
import { DesignProjectActions } from '../actions';
import { useDesignLocalize } from '../../i18n';

export interface WorkspaceHeaderActionsProps {
  project: DesignProjectDetail;
  activePath: string;
  device: DeviceId;
  onRename: () => void;
}

export default function WorkspaceHeaderActions({
  project,
  activePath,
  device,
  onRename,
}: WorkspaceHeaderActionsProps) {
  const localize = useDesignLocalize();
  const [dialog, setDialog] = useState<ProjectLifecycleDialog | null>(null);
  const close = () => setDialog(null);

  const menuItems: MenuItemProps[] = [];
  if (project.canWrite) {
    menuItems.push({
      id: 'design-rename-project',
      label: localize('workspace.header.rename'),
      icon: <Pencil className="icon-sm" aria-hidden="true" />,
      onClick: onRename,
    });
  }
  menuItems.push({
    id: 'design-duplicate-project',
    label: localize('workspace.header.duplicate'),
    icon: <Copy className="icon-sm" aria-hidden="true" />,
    ariaHasPopup: 'dialog',
    onClick: () => setDialog('duplicate'),
  });
  if (project.canWrite) {
    menuItems.push({
      id: 'design-delete-project',
      label: localize('workspace.header.delete'),
      icon: <Trash2 className="icon-sm" aria-hidden="true" />,
      ariaHasPopup: 'dialog',
      onClick: () => setDialog('delete'),
    });
  }

  return (
    <>
      <DesignProjectActions
        project={project}
        activePath={activePath}
        device={device}
        menuItems={menuItems}
      />
      {dialog === 'duplicate' ? <DuplicateProjectDialog project={project} onClose={close} /> : null}
      {dialog === 'delete' ? <DeleteProjectDialog project={project} onClose={close} /> : null}
    </>
  );
}
