import { Brush } from 'lucide-react';
import type { WorkspaceModeExtension } from './types';
import DrawOverlay from '../draw/DrawOverlay';
import DrawPanel from '../draw/DrawPanel';

export const drawMode: WorkspaceModeExtension = {
  mode: 'draw',
  available: true,
  bridgeMode: 'view',
  icon: Brush,
  labelKey: 'workspace.mode.draw',
  Overlay: DrawOverlay,
  Panel: DrawPanel,
};
