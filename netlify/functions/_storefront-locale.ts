import { canonicalLocaleCode } from './_worldwide-data-core';

export const WW3_STOREFRONT_VERSION = 'ww3-multilingual-storefront-2026-10-03';

export const STOREFRONT_LOCALES = Object.freeze({
  th: Object.freeze({ localeCode:'th', browserLocale:'th-TH', direction:'ltr' as const }),
  en: Object.freeze({ localeCode:'en', browserLocale:'en-US', direction:'ltr' as const }),
  zh: Object.freeze({ localeCode:'zh', browserLocale:'zh-CN', direction:'ltr' as const }),
  lo: Object.freeze({ localeCode:'lo', browserLocale:'lo-LA', direction:'ltr' as const }),
  vi: Object.freeze({ localeCode:'vi', browserLocale:'vi-VN', direction:'ltr' as const }),
});

export type StorefrontLanguage = keyof typeof STOREFRONT_LOCALES;

export type StorefrontLocaleContext = {
  version: typeof WW3_STOREFRONT_VERSION;
  language: StorefrontLanguage;
  locale: string;
  direction: 'ltr' | 'rtl';
  fallbackLanguages: StorefrontLanguage[];
};

function primaryLanguage(value: string): string {
  return value.split('-')[0]!.toLowerCase();
}

export function normalizeStorefrontLanguage(value: unknown): StorefrontLanguage | null {
  const canonical = canonicalLocaleCode(value);
  if (!canonical) return null;
  const language = primaryLanguage(canonical);
  return language in STOREFRONT_LOCALES ? language as StorefrontLanguage : null;
}

export function storefrontFallbackLanguages(language: StorefrontLanguage): StorefrontLanguage[] {
  if (language === 'th') return ['th'];
  if (language === 'en') return ['en'];
  return [language, 'en'];
}

export function resolveStorefrontLocale(
  requested: unknown,
  enabledLocales: readonly string[],
  defaultLocale: string,
): StorefrontLocaleContext | null {
  const normalizedEnabled = new Set(
    enabledLocales
      .map(normalizeStorefrontLanguage)
      .filter((value): value is StorefrontLanguage => value !== null),
  );
  const normalizedDefault = normalizeStorefrontLanguage(defaultLocale);
  if (!normalizedDefault || !normalizedEnabled.has(normalizedDefault)) return null;

  const requestedLanguage = normalizeStorefrontLanguage(requested);
  const language = requestedLanguage && normalizedEnabled.has(requestedLanguage)
    ? requestedLanguage
    : normalizedDefault;
  const definition = STOREFRONT_LOCALES[language];

  return {
    version: WW3_STOREFRONT_VERSION,
    language,
    locale: definition.browserLocale,
    direction: definition.direction,
    fallbackLanguages: storefrontFallbackLanguages(language),
  };
}

export function resolveStorefrontText(
  dictionaries: Partial<Record<StorefrontLanguage, Record<string, string>>>,
  key: string,
  language: StorefrontLanguage,
): string {
  for (const candidate of storefrontFallbackLanguages(language)) {
    const value = dictionaries[candidate]?.[key];
    if (value !== undefined) return value;
  }
  return key;
}
