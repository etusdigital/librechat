import { MessageSquarePlus } from 'lucide-react';
import type { WorkspaceModeExtension } from './types';

export const commentMode: WorkspaceModeExtension = {
  mode: 'comment',
  available: false,
  bridgeMode: 'comment',
  icon: MessageSquarePlus,
  labelKey: 'workspace.mode.comment',
};
