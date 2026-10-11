import { useState } from 'react';
import { Copy, Gavel, ListChecks, Pencil, Trash2 } from 'lucide-react';
import type { MenuItemProps } from '@librechat/client';
import type { ProjectLifecycleDialog } from './ProjectLifecycleDialogs';
import type { DesignProjectDetail } from '../../api/types';
import type { DeviceId } from '../../state/atoms';
import { JuryButton, PlanButton, useJuryToggle, usePlanToggle } from './WorkspacePanelButtons';
import { DeleteProjectDialog, DuplicateProjectDialog } from './ProjectLifecycleDialogs';
import { DesignProjectActions } from '../actions';
import { useDesignLocalize } from '../../i18n';
import { useJury } from '../jury/use-jury';

export interface WorkspaceHeaderActionsProps {
  project: DesignProjectDetail;
  activePath: string;
  device: DeviceId;
  compact?: boolean;
  onRename: () => void;
}

export default function WorkspaceHeaderActions({
  project,
  activePath,
  device,
  compact = false,
  onRename,
}: WorkspaceHeaderActionsProps) {
  const localize = useDesignLocalize();
  const jury = useJury();
  const togglePlan = usePlanToggle();
  const toggleJury = useJuryToggle();
  const [dialog, setDialog] = useState<ProjectLifecycleDialog | null>(null);
  const close = () => setDialog(null);

  const menuItems: MenuItemProps[] = [];
  if (compact) {
    menuItems.push({
      id: 'design-plan-panel',
      label: localize('plan.title'),
      icon: <ListChecks className="icon-sm" aria-hidden="true" />,
      onClick: togglePlan,
    });
    if (jury.enabled) {
      menuItems.push({
        id: 'design-jury-panel',
        label: localize('jury.button'),
        icon: <Gavel className="icon-sm" aria-hidden="true" />,
        onClick: toggleJury,
      });
    }
  }
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
      {compact ? null : (
        <div className="mr-1 flex items-center gap-2">
          <PlanButton projectId={project.projectId} />
          <JuryButton />
        </div>
      )}
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
