import type { WorkspaceMode } from '../../state/atoms';
import type { WorkspaceModeExtension } from './types';
import { commentMode } from './comment-mode';
import { inspectMode } from './inspect-mode';
import { drawMode } from './draw-mode';
import { viewMode } from './view-mode';

export const WORKSPACE_MODE_EXTENSIONS: readonly WorkspaceModeExtension[] = [
  viewMode,
  commentMode,
  inspectMode,
  drawMode,
];

export function availableModes(extensions = WORKSPACE_MODE_EXTENSIONS) {
  return extensions.filter((extension) => extension.available);
}

export function modeExtension(mode: WorkspaceMode, extensions = WORKSPACE_MODE_EXTENSIONS) {
  const available = availableModes(extensions);
  return available.find((extension) => extension.mode === mode) ?? viewMode;
}

export type { WorkspaceModeContext, WorkspaceModeExtension } from './types';
