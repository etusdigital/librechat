import { Brush } from 'lucide-react';
import type { WorkspaceModeExtension } from './types';

export const drawMode: WorkspaceModeExtension = {
  mode: 'draw',
  available: false,
  bridgeMode: 'view',
  icon: Brush,
  labelKey: 'workspace.mode.draw',
};
