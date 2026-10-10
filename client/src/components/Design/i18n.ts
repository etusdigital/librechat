import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { i18n as I18n, TOptions } from 'i18next';
import designPtBR from '~/locales/pt-BR/etus-design.json';
import designEn from '~/locales/en/etus-design.json';

export const DESIGN_NAMESPACE = 'etus-design';

type LeafKeys<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : LeafKeys<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type DesignTranslationKey = LeafKeys<typeof designEn>;

const DESIGN_RESOURCES: Record<string, typeof designEn> = {
  en: designEn,
  'pt-BR': designPtBR,
};

export function addDesignLocales(i18n: I18n) {
  for (const [locale, resource] of Object.entries(DESIGN_RESOURCES)) {
    i18n.addResourceBundle(locale, DESIGN_NAMESPACE, resource, true, true);
  }
}

export function designKey(key: DesignTranslationKey) {
  return `${DESIGN_NAMESPACE}:${key}`;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function useDesignLocalize() {
  const { t } = useTranslation();
  return useCallback(
    (key: DesignTranslationKey, options?: TOptions) =>
      (t as unknown as Translate)(key, { ...options, ns: DESIGN_NAMESPACE }),
    [t],
  );
}

export type DesignLocalize = ReturnType<typeof useDesignLocalize>;
