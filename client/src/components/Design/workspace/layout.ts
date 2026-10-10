export const COMPACT_LAYOUT_QUERY = '(max-width: 767px)';
export const MODE_PANEL_WIDTH_PX = 320;
export const MIN_DOCKED_PREVIEW_WIDTH_PX = 480;

export type ModePanelLayout = 'stacked' | 'side' | 'drawer';

export function modePanelLayout(compact: boolean, areaWidth: number): ModePanelLayout {
  if (compact) {
    return 'stacked';
  }
  if (areaWidth <= 0 || areaWidth >= MODE_PANEL_WIDTH_PX + MIN_DOCKED_PREVIEW_WIDTH_PX) {
    return 'side';
  }
  return 'drawer';
}
