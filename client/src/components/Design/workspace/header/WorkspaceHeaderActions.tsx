import type { DesignMe, DesignProjectDetail } from '../../api/types';
import type { DeviceId } from '../../state/atoms';

export interface WorkspaceHeaderActionsProps {
  project: DesignProjectDetail;
  me: DesignMe;
  activePath: string;
  device: DeviceId;
  compact: boolean;
}

export default function WorkspaceHeaderActions(_props: WorkspaceHeaderActionsProps) {
  return null;
}
