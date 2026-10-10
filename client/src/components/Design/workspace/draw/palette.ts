import type { DesignTranslationKey } from '../../i18n';

export interface DrawColor {
  id: string;
  variable: string;
  fallback: string;
  labelKey: DesignTranslationKey;
}

export const DRAW_COLORS: readonly DrawColor[] = [
  { id: 'red', variable: '--red-500', fallback: '239 68 68', labelKey: 'draw.color_red' },
  { id: 'amber', variable: '--amber-500', fallback: '245 158 11', labelKey: 'draw.color_amber' },
  { id: 'green', variable: '--green-500', fallback: '16 185 129', labelKey: 'draw.color_green' },
  { id: 'blue', variable: '--blue-500', fallback: '59 130 246', labelKey: 'draw.color_blue' },
  { id: 'black', variable: '--gray-900', fallback: '13 13 13', labelKey: 'draw.color_black' },
];

export const DEFAULT_DRAW_COLOR = DRAW_COLORS[0].id;

const RGB_CHANNELS = /^\d{1,3}\s+\d{1,3}\s+\d{1,3}$/;

export function cssColorOf(value: string): string {
  const trimmed = value.trim();
  return RGB_CHANNELS.test(trimmed) ? `rgb(${trimmed.split(/\s+/).join(', ')})` : trimmed;
}

export function resolveDrawColor(
  id: string,
  root: Element | null = typeof document === 'undefined' ? null : document.documentElement,
): string {
  const color = DRAW_COLORS.find((entry) => entry.id === id) ?? DRAW_COLORS[0];
  const themed = root ? getComputedStyle(root).getPropertyValue(color.variable) : '';
  return cssColorOf(themed.trim() === '' ? color.fallback : themed);
}
