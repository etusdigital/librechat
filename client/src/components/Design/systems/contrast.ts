import type { TokenEntry } from '../api/types';

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export type ContrastLevel = 'aa' | 'large' | 'fail';

export interface ContrastPair {
  foreground: TokenEntry;
  background: TokenEntry;
  ratio: number;
  level: ContrastLevel;
}

export const AA_NORMAL_TEXT = 4.5;
export const AA_LARGE_TEXT = 3;
const MAX_PAIRS = 16;

const BACKGROUND_NAMES = ['bg', 'background', 'surface', 'surface-warm', 'paper', 'canvas'];
const TEXT_NAMES = ['fg', 'fg-2', 'text', 'foreground', 'ink', 'muted', 'meta'];
const ACCENT_NAMES = ['accent', 'link', 'success', 'warn', 'warning', 'danger', 'error', 'info'];
const KEYWORDS: Record<string, Rgba> = {
  white: { r: 255, g: 255, b: 255, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  transparent: { r: 0, g: 0, b: 0, a: 0 },
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function parseHex(value: string): Rgba | null {
  const hex = value.slice(1);
  if (!/^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) {
    return null;
  }
  const full =
    hex.length <= 4
      ? hex
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : hex;
  const channel = (index: number) => parseInt(full.slice(index * 2, index * 2 + 2), 16);
  return {
    r: channel(0),
    g: channel(1),
    b: channel(2),
    a: full.length === 8 ? channel(3) / 255 : 1,
  };
}

function argumentsOf(value: string, names: string[]): string[] | null {
  const match = new RegExp(`^(?:${names.join('|')})\\((.*)\\)$`, 'i').exec(value);
  if (!match) {
    return null;
  }
  const [channels, alpha] = match[1].split('/').map((part) => part.trim());
  const parts = channels.split(/[\s,]+/).filter(Boolean);
  if (alpha !== undefined) {
    parts.push(alpha);
  }
  return parts.length === 3 || parts.length === 4 ? parts : null;
}

function alphaOf(raw: string | undefined): number | null {
  if (raw === undefined) {
    return 1;
  }
  const amount = parseFloat(raw);
  if (Number.isNaN(amount)) {
    return null;
  }
  return clamp(raw.endsWith('%') ? amount / 100 : amount, 0, 1);
}

function parseRgb(value: string): Rgba | null {
  const parts = argumentsOf(value, ['rgb', 'rgba']);
  if (!parts) {
    return null;
  }
  const channels = parts.slice(0, 3).map((part) => {
    const amount = parseFloat(part);
    return part.endsWith('%') ? (amount / 100) * 255 : amount;
  });
  const a = alphaOf(parts[3]);
  if (channels.some(Number.isNaN) || a === null) {
    return null;
  }
  const [r, g, b] = channels.map((channel) => clamp(channel, 0, 255));
  return { r, g, b, a };
}

function parseHsl(value: string): Rgba | null {
  const parts = argumentsOf(value, ['hsl', 'hsla']);
  if (!parts) {
    return null;
  }
  const hue = parseFloat(parts[0].replace(/deg$/i, ''));
  const saturation = parseFloat(parts[1]) / 100;
  const lightness = parseFloat(parts[2]) / 100;
  const a = alphaOf(parts[3]);
  if ([hue, saturation, lightness].some(Number.isNaN) || a === null) {
    return null;
  }
  const s = clamp(saturation, 0, 1);
  const l = clamp(lightness, 0, 1);
  const k = (n: number) => (n + (((hue % 360) + 360) % 360) / 30) % 12;
  const f = (n: number) =>
    l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255, a };
}

export function parseColor(raw: string): Rgba | null {
  const value = raw.trim().toLowerCase();
  if (KEYWORDS[value]) {
    return KEYWORDS[value];
  }
  if (value.startsWith('#')) {
    return parseHex(value);
  }
  return parseRgb(value) ?? parseHsl(value);
}

function blend(top: Rgba, bottom: Rgba): Rgba {
  const mix = (front: number, back: number) => front * top.a + back * (1 - top.a);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

export function relativeLuminance({ r, g, b }: Rgba) {
  const linear = (channel: number) => {
    const srgb = channel / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrastRatio(foreground: Rgba, background: Rgba) {
  const base = blend(background, KEYWORDS.white);
  const top = blend(foreground, base);
  const [light, dark] = [relativeLuminance(top), relativeLuminance(base)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

export function contrastLevel(ratio: number): ContrastLevel {
  if (ratio >= AA_NORMAL_TEXT) {
    return 'aa';
  }
  return ratio >= AA_LARGE_TEXT ? 'large' : 'fail';
}

export function formatRatio(ratio: number, locale?: string) {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.floor(ratio * 100) / 100);
}

function surfaceNameOf(name: string) {
  if (name.endsWith('-on')) {
    return name.slice(0, -3);
  }
  return name.startsWith('on-') ? name.slice(3) : null;
}

function candidatePairs(colors: TokenEntry[]): [TokenEntry, TokenEntry][] {
  const byName = new Map(colors.map((color) => [color.name, color]));
  const pick = (names: string[]) =>
    names.map((name) => byName.get(name)).filter((color): color is TokenEntry => Boolean(color));
  const backgrounds = pick(BACKGROUND_NAMES).slice(0, 2);
  const pairs: [TokenEntry, TokenEntry][] = [];
  for (const background of backgrounds) {
    for (const text of pick(TEXT_NAMES)) {
      pairs.push([text, background]);
    }
  }
  for (const color of colors) {
    const background = byName.get(surfaceNameOf(color.name) ?? '');
    if (background) {
      pairs.push([color, background]);
    }
  }
  if (backgrounds[0]) {
    for (const accent of pick(ACCENT_NAMES)) {
      pairs.push([accent, backgrounds[0]]);
    }
  }
  return pairs;
}

function extremePair(colors: TokenEntry[]): [TokenEntry, TokenEntry][] {
  const opaque = colors
    .map((color) => ({ color, rgba: parseColor(color.value) }))
    .filter((entry): entry is { color: TokenEntry; rgba: Rgba } => entry.rgba?.a === 1)
    .sort((a, b) => relativeLuminance(a.rgba) - relativeLuminance(b.rgba));
  if (opaque.length < 2) {
    return [];
  }
  return [[opaque[0].color, opaque[opaque.length - 1].color]];
}

export function contrastPairsOf(colors: TokenEntry[]): ContrastPair[] {
  const declared = candidatePairs(colors);
  const candidates = declared.length > 0 ? declared : extremePair(colors);
  const seen = new Set<string>();
  const pairs: ContrastPair[] = [];
  for (const [foreground, background] of candidates) {
    const fg = parseColor(foreground.value);
    const bg = parseColor(background.value);
    const key = `${foreground.value.toLowerCase()}|${background.value.toLowerCase()}`;
    if (!fg || !bg || seen.has(key) || pairs.length >= MAX_PAIRS) {
      continue;
    }
    seen.add(key);
    const ratio = contrastRatio(fg, bg);
    pairs.push({ foreground, background, ratio, level: contrastLevel(ratio) });
  }
  return pairs;
}
