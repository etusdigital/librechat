import designPtBR from '~/locales/pt-BR/etus-design.json';
import { DESIGN_NAMESPACE, designKey } from '../i18n';
import designEn from '~/locales/en/etus-design.json';
import i18n from '~/locales/i18n';

const translate = i18n.t.bind(i18n) as unknown as (
  key: string,
  options?: Record<string, unknown>,
) => string;

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string'
      ? [[`${prefix}${key}`, value] as [string, string]]
      : flatten(value, `${prefix}${key}.`),
  );
}

describe('etus-design namespace', () => {
  it('has the same keys in pt-BR and en', () => {
    const keysOf = (tree: Tree) =>
      flatten(tree)
        .map(([key]) => key)
        .sort();
    expect(keysOf(designPtBR)).toEqual(keysOf(designEn));
  });

  it('never uses em or en dashes', () => {
    for (const [, value] of [...flatten(designPtBR), ...flatten(designEn)]) {
      expect(value).not.toMatch(/[–—]/);
    }
  });

  it('resolves the nested actions block', () => {
    expect(translate('actions.share_title', { lng: 'pt-BR', ns: DESIGN_NAMESPACE })).toBe(
      'Compartilhar',
    );
    expect(
      translate('actions.share_public_days', { lng: 'pt-BR', ns: DESIGN_NAMESPACE, count: 1 }),
    ).toBe('1 dia');
    expect(
      translate('actions.share_public_days', { lng: 'pt-BR', ns: DESIGN_NAMESPACE, count: 7 }),
    ).toBe('7 dias');
  });

  it('is registered next to translation.json without replacing it', () => {
    expect(i18n.hasResourceBundle('pt-BR', DESIGN_NAMESPACE)).toBe(true);
    expect(i18n.hasResourceBundle('en', DESIGN_NAMESPACE)).toBe(true);
    expect(i18n.hasResourceBundle('en', 'translation')).toBe(true);
    expect(translate(designKey('nav_design'), { lng: 'pt-BR' })).toBe('Design');
    expect(translate('access_denied', { lng: 'pt-BR', ns: DESIGN_NAMESPACE })).toBe(
      'Você não tem acesso ao Etus Design. Fale com a administração do hub',
    );
    expect(translate('access_reauth', { lng: 'fr', ns: DESIGN_NAMESPACE })).toBe(
      'Your session expired. Sign in again',
    );
  });
});
