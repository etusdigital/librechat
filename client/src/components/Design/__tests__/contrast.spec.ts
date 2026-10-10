import type { TokenEntry } from '../api/types';
import {
  contrastLevel,
  contrastPairsOf,
  contrastRatio,
  formatRatio,
  parseColor,
} from '../systems/contrast';

const token = (name: string, value: string): TokenEntry => ({
  name,
  cssVar: `--${name}`,
  value,
});

const ratioOf = (fg: string, bg: string) => {
  const front = parseColor(fg);
  const back = parseColor(bg);
  if (!front || !back) {
    throw new Error('unparseable color');
  }
  return contrastRatio(front, back);
};

describe('parseColor', () => {
  it('reads hex, rgb, hsl and keywords', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#3BE476')).toEqual({ r: 59, g: 228, b: 118, a: 1 });
    expect(parseColor('#00000080')?.a).toBeCloseTo(0.5, 2);
    expect(parseColor('rgb(59, 228, 118)')).toEqual({ r: 59, g: 228, b: 118, a: 1 });
    expect(parseColor('rgb(59 228 118 / 50%)')).toEqual({ r: 59, g: 228, b: 118, a: 0.5 });
    expect(parseColor('rgba(0,0,0,0.25)')?.a).toBe(0.25);
    const red = parseColor('hsl(0 100% 50%)');
    expect(red?.r).toBeCloseTo(255);
    expect(red?.g).toBeCloseTo(0);
    expect(parseColor('White')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });

  it('gives up on values it cannot compute', () => {
    expect(parseColor('color-mix(in oklab, #ff385c, black 8%)')).toBeNull();
    expect(parseColor('oklch(0.7 0.1 200)')).toBeNull();
    expect(parseColor('#12')).toBeNull();
    expect(parseColor('var(--accent)')).toBeNull();
  });
});

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(ratioOf('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(ratioOf('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(ratioOf('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(ratioOf('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(ratioOf('#ffffff', '#ffffff')).toBe(1);
  });

  it('blends translucent text over the background', () => {
    expect(ratioOf('rgba(0, 0, 0, 0)', '#ffffff')).toBe(1);
    expect(ratioOf('rgba(0, 0, 0, 0.5)', '#ffffff')).toBeLessThan(ratioOf('#000', '#fff'));
  });

  it('never rounds a failing ratio up to the threshold', () => {
    expect(contrastLevel(ratioOf('#777777', '#ffffff'))).toBe('large');
    expect(contrastLevel(ratioOf('#767676', '#ffffff'))).toBe('aa');
    expect(contrastLevel(3)).toBe('large');
    expect(contrastLevel(2.99)).toBe('fail');
    expect(formatRatio(4.4999, 'en')).toBe('4.49');
    expect(formatRatio(21, 'pt-BR')).toBe('21,00');
  });
});

describe('contrastPairsOf', () => {
  const airbnb = [
    token('bg', '#ffffff'),
    token('surface', '#ffffff'),
    token('fg', '#222222'),
    token('meta', '#929292'),
    token('accent', '#ff385c'),
    token('accent-on', '#ffffff'),
    token('accent-hover', 'color-mix(in oklab, #ff385c, black 8%)'),
    token('border', '#dddddd'),
  ];

  it('pairs text with backgrounds, on-colors with their base and accents with the page', () => {
    const pairs = contrastPairsOf(airbnb).map(
      (pair) => `${pair.foreground.name}/${pair.background.name}:${pair.level}`,
    );
    expect(pairs).toEqual([
      'fg/bg:aa',
      'meta/bg:large',
      'accent-on/accent:large',
      'accent/bg:large',
    ]);
  });

  it('skips duplicates and values it cannot compute', () => {
    const pairs = contrastPairsOf([...airbnb, token('fg-2', 'oklch(0.3 0 0)')]);
    expect(pairs.some((pair) => pair.background.name === 'surface')).toBe(false);
    expect(pairs.some((pair) => pair.foreground.name === 'fg-2')).toBe(false);
  });

  it('falls back to the darkest and lightest colors without conventional names', () => {
    const pairs = contrastPairsOf([
      token('brand-green', '#3be476'),
      token('grey-950', '#151514'),
      token('grey-50', '#fbfaf9'),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].foreground.name).toBe('grey-950');
    expect(pairs[0].background.name).toBe('grey-50');
    expect(pairs[0].level).toBe('aa');
  });

  it('returns nothing when no pair can be computed', () => {
    expect(contrastPairsOf([])).toEqual([]);
    expect(contrastPairsOf([token('accent', '#ff385c')])).toEqual([]);
  });
});
