import type { DeviceId, ZoomLevel } from '../state/atoms';
import { DEVICES } from '../state/atoms';

export interface Size {
  width: number;
  height: number;
}

export interface PreviewGeometry {
  viewport: Size;
  scale: number;
  frame: Size;
}

const MIN_SCALE = 0.05;

export function fitScale(viewport: Size, area: Size) {
  if (viewport.width <= 0 || viewport.height <= 0 || area.width <= 0 || area.height <= 0) {
    return 1;
  }
  const scale = Math.min(area.width / viewport.width, area.height / viewport.height, 1);
  return Math.max(scale, MIN_SCALE);
}

export function previewGeometry(device: DeviceId, zoom: ZoomLevel, area: Size): PreviewGeometry {
  const preset = DEVICES[device];
  if (!preset) {
    const scale = zoom === 'fit' ? 1 : zoom;
    const viewport = {
      width: Math.max(Math.round(area.width / scale), 1),
      height: Math.max(Math.round(area.height / scale), 1),
    };
    return { viewport, scale, frame: { width: area.width, height: area.height } };
  }
  const viewport = { width: preset.width, height: preset.height };
  const scale = zoom === 'fit' ? fitScale(viewport, area) : zoom;
  return {
    viewport,
    scale,
    frame: {
      width: Math.round(viewport.width * scale),
      height: Math.round(viewport.height * scale),
    },
  };
}
