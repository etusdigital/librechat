import { Eye } from 'lucide-react';
import type { WorkspaceModeExtension } from './types';

export const viewMode: WorkspaceModeExtension = {
  mode: 'view',
  available: true,
  bridgeMode: 'view',
  icon: Eye,
  labelKey: 'workspace.mode.view',
};
