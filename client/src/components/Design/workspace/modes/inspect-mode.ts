import { PencilLine } from 'lucide-react';
import type { WorkspaceModeExtension } from './types';
import InspectPanel from '../inspect/InspectPanel';

export const inspectMode: WorkspaceModeExtension = {
  mode: 'inspect',
  available: true,
  bridgeMode: 'inspect',
  icon: PencilLine,
  labelKey: 'workspace.mode.inspect',
  Panel: InspectPanel,
};
