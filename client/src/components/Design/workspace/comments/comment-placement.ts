import type { PreviewGeometry, Size } from '../preview-geometry';
import type { Rect } from '../../api/types';

export const COMPOSER_SIZE: Size = { width: 288, height: 208 };
export const COMPOSER_GAP = 8;

export interface ComposerPlacement {
  left: number;
  top: number;
  inverseScale: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function composerPlacement(
  rect: Rect,
  geometry: PreviewGeometry,
  size: Size = COMPOSER_SIZE,
): ComposerPlacement | null {
  const { viewport, scale } = geometry;
  if (!(scale > 0)) {
    return null;
  }
  const width = size.width / scale;
  const height = size.height / scale;
  const gap = COMPOSER_GAP / scale;
  if (width > viewport.width || height > viewport.height) {
    return null;
  }
  const below = rect.y + rect.h + gap;
  const above = rect.y - gap - height;
  let top = viewport.height - height;
  if (below + height <= viewport.height) {
    top = below;
  } else if (above >= 0) {
    top = above;
  }
  return {
    left: clamp(rect.x, 0, viewport.width - width),
    top: clamp(top, 0, viewport.height - height),
    inverseScale: 1 / scale,
  };
}
