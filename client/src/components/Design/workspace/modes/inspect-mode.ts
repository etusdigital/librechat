import { PencilLine } from 'lucide-react';
import type { WorkspaceModeExtension } from './types';

export const inspectMode: WorkspaceModeExtension = {
  mode: 'inspect',
  available: false,
  bridgeMode: 'inspect',
  icon: PencilLine,
  labelKey: 'workspace.mode.inspect',
};
