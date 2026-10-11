import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';

export const DEVICES = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
  desktop: { width: 1440, height: 900 },
  free: null,
} as const;

export type DeviceId = keyof typeof DEVICES;

export const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 'fit'] as const;
export type ZoomLevel = (typeof ZOOM_LEVELS)[number];

export const WORKSPACE_MODES = ['view', 'comment', 'inspect', 'draw'] as const;
export type WorkspaceMode = (typeof WORKSPACE_MODES)[number];

export interface WorkspaceTabs {
  open: string[];
  active: string | null;
}

export const EMPTY_TABS: WorkspaceTabs = { open: [], active: null };

export function openTab(tabs: WorkspaceTabs, path: string): WorkspaceTabs {
  if (tabs.open.includes(path)) {
    return tabs.active === path ? tabs : { ...tabs, active: path };
  }
  return { open: [...tabs.open, path], active: path };
}

export function closeTab(tabs: WorkspaceTabs, path: string): WorkspaceTabs {
  const index = tabs.open.indexOf(path);
  if (index === -1) {
    return tabs;
  }
  const open = tabs.open.filter((tab) => tab !== path);
  if (tabs.active !== path) {
    return { ...tabs, open };
  }
  return { open, active: open[Math.min(index, open.length - 1)] ?? null };
}

export function keepExistingTabs(tabs: WorkspaceTabs, paths: string[]): WorkspaceTabs {
  const existing = new Set(paths);
  return tabs.open
    .filter((path) => !existing.has(path))
    .reduce((current, path) => closeTab(current, path), tabs);
}

export const workspaceTabsAtomFamily = atomFamily((_projectId: string) =>
  atom<WorkspaceTabs>(EMPTY_TABS),
);

export const deviceAtom = atom<DeviceId>('desktop');
export const zoomAtom = atom<ZoomLevel>('fit');
export const workspaceModeAtom = atom<WorkspaceMode>('view');
export const selectedCommentIdAtom = atom<string | null>(null);

export const WORKSPACE_PANELS = ['plan', 'jury'] as const;
export type WorkspacePanel = (typeof WORKSPACE_PANELS)[number];
export const workspacePanelAtom = atom<WorkspacePanel | null>(null);

export interface PreviewHighlight {
  id: number;
  path: string;
  selector: string;
}

export const previewHighlightAtom = atom<PreviewHighlight | null>(null);
