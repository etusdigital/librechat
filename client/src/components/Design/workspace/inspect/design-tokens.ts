import type { DesignSystemDetail, TokenEntry } from '../../api/types';
import { isSafeCssValue } from '../../preview/host-protocol';

export interface TokenOption {
  label: string;
  value: string;
  swatch?: string;
}

export interface TokenSuggestions {
  colors: TokenOption[];
  fontSize: TokenOption[];
  fontWeight: TokenOption[];
  lineHeight: TokenOption[];
  letterSpacing: TokenOption[];
  space: TokenOption[];
  radius: TokenOption[];
}

const CSS_VAR = /^--[A-Za-z0-9_-]{1,100}$/;
const TOKEN_DECLARATION = /(--(?:space|radius)-[A-Za-z0-9_-]{1,60})\s*:\s*([^;{}]{1,80});/g;
const FALLBACK_SPACE = ['0', '4px', '8px', '12px', '16px', '24px', '32px', '48px'];
const FALLBACK_WEIGHTS = ['300', '400', '500', '600', '700', '800'];

export function tokenValue(cssVar: string, value: string) {
  if (!CSS_VAR.test(cssVar)) {
    return null;
  }
  const trimmed = value.trim();
  const withFallback = `var(${cssVar}, ${trimmed})`;
  if (trimmed && isSafeCssValue(trimmed) && isSafeCssValue(withFallback)) {
    return withFallback;
  }
  return `var(${cssVar})`;
}

function labelOf(cssVar: string) {
  return cssVar.replace(/^--/, '');
}

function fromEntries(entries: TokenEntry[] | undefined, withSwatch = false): TokenOption[] {
  const seen = new Set<string>();
  return (entries ?? []).flatMap((entry) => {
    const value = tokenValue(entry.cssVar, entry.value);
    if (!value || seen.has(entry.cssVar)) {
      return [];
    }
    seen.add(entry.cssVar);
    const swatch =
      withSwatch && isSafeCssValue(entry.value.trim()) ? entry.value.trim() : undefined;
    return [{ label: entry.name || labelOf(entry.cssVar), value, ...(swatch ? { swatch } : {}) }];
  });
}

export function scaleTokens(tokensCss: string | null | undefined, kind: 'space' | 'radius') {
  const options: TokenOption[] = [];
  const seen = new Set<string>();
  for (const [, cssVar, raw] of (tokensCss ?? '').matchAll(TOKEN_DECLARATION)) {
    if (!cssVar.startsWith(`--${kind}-`) || seen.has(cssVar)) {
      continue;
    }
    seen.add(cssVar);
    const value = tokenValue(cssVar, raw);
    if (value) {
      options.push({ label: labelOf(cssVar), value });
    }
  }
  return options;
}

const plain = (values: string[]): TokenOption[] => values.map((value) => ({ label: value, value }));

export function tokenSuggestions(detail: DesignSystemDetail | undefined): TokenSuggestions {
  const typography = detail?.typography;
  const space = scaleTokens(detail?.tokensCss, 'space');
  const weights = (typography?.weights ?? []).map(String);
  return {
    colors: fromEntries(detail?.colors, true),
    fontSize: fromEntries(typography?.scale),
    fontWeight: plain(weights.length ? weights : FALLBACK_WEIGHTS),
    lineHeight: fromEntries(typography?.leading),
    letterSpacing: fromEntries(typography?.tracking),
    space: space.length ? space : plain(FALLBACK_SPACE),
    radius: scaleTokens(detail?.tokensCss, 'radius'),
  };
}
