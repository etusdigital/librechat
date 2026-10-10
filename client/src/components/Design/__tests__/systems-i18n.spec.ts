import { DESIGN_NAMESPACE } from '../i18n';
import i18n from '~/locales/i18n';

const translate = i18n.t.bind(i18n) as unknown as (
  key: string,
  options?: Record<string, unknown>,
) => string;

describe('systems block of the etus-design namespace', () => {
  it('resolves the nested gallery texts in pt-BR', () => {
    expect(translate('systems.badge_company_default', { lng: 'pt-BR', ns: DESIGN_NAMESPACE })).toBe(
      'Padrão da empresa',
    );
    expect(
      translate('systems.badge_inspired', { lng: 'pt-BR', ns: DESIGN_NAMESPACE, brand: 'Airbnb' }),
    ).toBe('Inspirado em Airbnb');
    expect(translate('systems.empty', { lng: 'pt-BR', ns: DESIGN_NAMESPACE })).toBe(
      'Nenhum design system encontrado para essa busca',
    );
  });
});
