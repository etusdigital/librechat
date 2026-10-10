import { MessageSquarePlus } from 'lucide-react';
import type { WorkspaceModeExtension } from './types';
import CommentOverlay from '../comments/CommentOverlay';
import CommentPanel from '../comments/CommentPanel';
import { composerPlacement } from '../comments/comment-placement';

export const commentMode: WorkspaceModeExtension = {
  mode: 'comment',
  available: true,
  bridgeMode: 'comment',
  icon: MessageSquarePlus,
  labelKey: 'workspace.mode.comment',
  Overlay: CommentOverlay,
  Panel: CommentPanel,
  opensPanelOn: (target, geometry) => composerPlacement(target.rect, geometry) == null,
};
