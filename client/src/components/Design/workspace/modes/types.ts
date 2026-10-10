import type { LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';
import type { PreviewBridge } from '../../preview/use-preview-bridge';
import type { DesignMe, DesignProjectDetail } from '../../api/types';
import type { BridgePreviewMode, FrameMessage } from '../../preview/host-protocol';
import type { DeviceId, WorkspaceMode } from '../../state/atoms';
import type { PreviewGeometry } from '../preview-geometry';
import type { DesignTranslationKey } from '../../i18n';

export interface WorkspaceModeContext {
  project: DesignProjectDetail;
  me: DesignMe;
  path: string;
  device: DeviceId;
  geometry: PreviewGeometry;
  bridge: PreviewBridge;
}

export interface WorkspaceModeExtension {
  mode: WorkspaceMode;
  available: boolean;
  bridgeMode: BridgePreviewMode;
  icon: LucideIcon;
  labelKey: DesignTranslationKey;
  Overlay?: ComponentType<WorkspaceModeContext>;
  Panel?: ComponentType<WorkspaceModeContext>;
  opensPanelOn?: (target: FrameTarget, geometry: PreviewGeometry) => boolean;
}

export type FrameTarget = Extract<FrameMessage, { type: 'etus:target' }>;
