import type { SourceElement } from '../vendor/open-design/source-patches';
import type { InspectPatch } from '../preview/host-protocol';
import type { DesignSystemDetail } from '../api/types';
import {
  editsToPatches,
  isBaseStale,
  liveCommandsFor,
  newEdit,
  reconcileFramePatches,
  setEditStyle,
  setEditText,
  shaOfEtag,
} from '../workspace/inspect/inspect-session';
import { scaleTokens, tokenSuggestions, tokenValue } from '../workspace/inspect/design-tokens';
import { WORKSPACE_MODE_EXTENSIONS, availableModes } from '../workspace/modes';
import { buildHostMessage } from '../preview/host-protocol';

const SHA = 'a'.repeat(64);
const element: SourceElement = {
  tag: 'h1',
  text: 'Título',
  snippet: 'Título',
  textEditable: true,
  styles: { color: '#111' },
};
const create = () => newEdit('h1', element);

describe('inspect session', () => {
  it('keeps only the changes that differ from the source', () => {
    let edits = setEditText([], 'h1', create, 'Novo');
    edits = setEditStyle(edits, 'h1', create, 'font-size', ' 48px ');
    expect(edits).toEqual([
      {
        selector: 'h1',
        expectedText: 'Título',
        original: { text: 'Título', styles: { color: '#111' } },
        text: 'Novo',
        styles: { 'font-size': '48px' },
      },
    ]);
    edits = setEditText(edits, 'h1', create, 'Título');
    edits = setEditStyle(edits, 'h1', create, 'font-size', '');
    expect(edits).toEqual([]);
    expect(setEditStyle([], 'h1', create, 'color', '#111')).toEqual([]);
    expect(setEditStyle([], 'h1', create, 'color', '')[0].styles).toEqual({ color: '' });
  });

  it('turns edits into source patches and valid live commands', () => {
    const edits = setEditStyle(setEditText([], 'h1', create, 'Novo'), 'h1', create, 'color', '');
    expect(editsToPatches(edits)).toEqual([
      { selector: 'h1', expectedText: 'Título', text: 'Novo', styles: { color: '' } },
    ]);
    const commands = liveCommandsFor(edits);
    expect(commands).toEqual([
      { type: 'etus:inspect-set', selector: 'h1', text: 'Novo', styles: { color: '' } },
    ]);
    commands.forEach((command) =>
      expect(() => buildHostMessage(command, 'n'.repeat(24))).not.toThrow(),
    );
  });

  describe('reconcileFramePatches', () => {
    const edits = setEditStyle(
      setEditStyle(setEditText([], 'h1', create, 'Novo'), 'h1', create, 'color', 'red'),
      'h1',
      create,
      'font-size',
      '1',
    );

    it('keeps the host edits when the preview does not answer', () => {
      expect(reconcileFramePatches(edits, null)).toEqual({ edits, ignored: 0 });
    });

    it('never adds what the preview reports beyond what the host sent', () => {
      const forged: InspectPatch[] = [
        { selector: 'h1', text: 'Novo', styles: { color: 'red', 'background-color': 'black' } },
        { selector: 'body > footer:nth-of-type(1)', text: 'injected' },
        { selector: '#cta', styles: { opacity: '0' } },
      ];
      const result = reconcileFramePatches(edits, forged);
      expect(result.ignored).toBe(2);
      expect(result.edits).toHaveLength(1);
      expect(result.edits[0].text).toBe('Novo');
      expect(result.edits[0].styles).toEqual({ color: 'red' });
    });

    it('drops values the preview did not apply and text the preview refused', () => {
      const result = reconcileFramePatches(edits, [
        { selector: 'h1', text: 'Outro', styles: { color: 'blue', 'font-size': '1' } },
      ]);
      expect(result.edits[0].text).toBeUndefined();
      expect(result.edits[0].styles).toEqual({ 'font-size': '1' });
      expect(reconcileFramePatches(edits, [{ selector: 'h1', styles: {} }]).edits).toEqual([]);
    });
  });

  it('reads the sha from an ETag and detects a stale base', () => {
    expect(shaOfEtag(`"${SHA}"`)).toBe(SHA);
    expect(shaOfEtag(`W/"${SHA.toUpperCase()}"`)).toBe(SHA);
    expect(shaOfEtag('"nope"')).toBeNull();
    expect(shaOfEtag(null)).toBeNull();
    const base = { source: '', etag: `"${SHA}"`, sha256: SHA, version: 1 };
    expect(isBaseStale(base, SHA)).toBe(false);
    expect(isBaseStale(base, 'b'.repeat(64))).toBe(true);
    expect(isBaseStale(null, 'b'.repeat(64))).toBe(false);
    expect(isBaseStale(base, undefined)).toBe(false);
  });
});

describe('design system tokens', () => {
  it('uses the token with its value as fallback', () => {
    expect(tokenValue('--accent', '#3be476')).toBe('var(--accent, #3be476)');
    expect(tokenValue('--accent', 'url(x)')).toBe('var(--accent)');
    expect(tokenValue('--accent', 'red; x: y')).toBe('var(--accent)');
    expect(tokenValue('accent', '#fff')).toBeNull();
    expect(tokenValue('--a) url(x', '#fff')).toBeNull();
  });

  it('reads spacing and radius tokens from tokens.css', () => {
    const css = ':root { --space-1: 4px; --space-2: 8px; --radius-sm: 10px; --space-1: 99px; }';
    expect(scaleTokens(css, 'space')).toEqual([
      { label: 'space-1', value: 'var(--space-1, 4px)' },
      { label: 'space-2', value: 'var(--space-2, 8px)' },
    ]);
    expect(scaleTokens(css, 'radius')).toEqual([
      { label: 'radius-sm', value: 'var(--radius-sm, 10px)' },
    ]);
  });

  it('builds suggestions from the design system and safe swatches only', () => {
    const detail = {
      colors: [
        { name: 'accent', cssVar: '--accent', value: '#3be476' },
        { name: 'evil', cssVar: '--evil', value: 'url(https://evil.test/a.png)' },
        { name: 'bad var', cssVar: 'not-a-var', value: '#000' },
      ],
      typography: {
        families: [],
        weights: [400, 700],
        scale: [{ name: 'text-lg', cssVar: '--text-lg', value: '18px' }],
        leading: [{ name: 'leading-body', cssVar: '--leading-body', value: '1.5' }],
        tracking: [],
      },
      tokensCss: ':root { --space-4: 16px; --radius-md: 12px; }',
    } as unknown as DesignSystemDetail;
    const suggestions = tokenSuggestions(detail);
    expect(suggestions.colors).toEqual([
      { label: 'accent', value: 'var(--accent, #3be476)', swatch: '#3be476' },
      { label: 'evil', value: 'var(--evil)' },
    ]);
    expect(suggestions.fontSize).toEqual([{ label: 'text-lg', value: 'var(--text-lg, 18px)' }]);
    expect(suggestions.fontWeight.map((option) => option.value)).toEqual(['400', '700']);
    expect(suggestions.lineHeight[0].value).toBe('var(--leading-body, 1.5)');
    expect(suggestions.space).toEqual([{ label: 'space-4', value: 'var(--space-4, 16px)' }]);
    expect(suggestions.radius).toEqual([{ label: 'radius-md', value: 'var(--radius-md, 12px)' }]);
  });

  it('falls back to a plain scale without a design system', () => {
    const suggestions = tokenSuggestions(undefined);
    expect(suggestions.colors).toEqual([]);
    expect(suggestions.space[0]).toEqual({ label: '0', value: '0' });
    expect(suggestions.fontWeight.length).toBeGreaterThan(0);
  });
});

describe('inspect mode', () => {
  it('is available with its panel', () => {
    const inspect = WORKSPACE_MODE_EXTENSIONS.find((extension) => extension.mode === 'inspect');
    expect(inspect?.available).toBe(true);
    expect(inspect?.bridgeMode).toBe('inspect');
    expect(inspect?.Panel).toBeDefined();
    expect(availableModes().map((extension) => extension.mode)).toContain('inspect');
  });
});
