import { DOMESTIC_COMMERCE_BASELINE } from './_worldwide-foundation';

export const WW1_DATA_CORE_VERSION = 'ww1-global-data-core-2026-10-03';

export const MARKET_CAPABILITIES = [
  'catalog',
  'storefront',
  'pricing',
  'payments',
  'shipping',
  'customs',
  'checkout',
  'fulfillment',
  'thongthai',
] as const;

export type MarketCapability = typeof MARKET_CAPABILITIES[number];
export type MarketCapabilityState = 'disabled' | 'shadow' | 'live';
export type MarketStatus = 'draft' | 'certification' | 'live' | 'suspended';

export type CommerceCurrency = {
  currencyCode: string;
  nameEn: string;
  symbol: string | null;
  minorUnit: number;
  active: boolean;
};

export type CommerceCountry = {
  countryCode: string;
  nameEn: string;
  defaultCurrencyCode: string;
  active: boolean;
};

export type CommerceLocale = {
  localeCode: string;
  languageCode: string;
  nameEn: string;
  rtl: boolean;
  active: boolean;
};

export type CommerceMarket = {
  marketCode: string;
  countryCode: string;
  defaultCurrencyCode: string;
  defaultLocaleCode: string;
  status: MarketStatus;
  isDomestic: boolean;
};

export type CommerceMarketLocale = {
  marketCode: string;
  localeCode: string;
  enabled: boolean;
  isDefault: boolean;
};

export type CommerceMarketCapability = {
  marketCode: string;
  capability: MarketCapability;
  state: MarketCapabilityState;
};

export type MarketDataBundle = {
  country: CommerceCountry | null;
  currency: CommerceCurrency | null;
  market: CommerceMarket | null;
  locales: CommerceLocale[];
  marketLocales: CommerceMarketLocale[];
  capabilities: CommerceMarketCapability[];
};

export type ResolvedMarketContext = {
  version: typeof WW1_DATA_CORE_VERSION;
  marketCode: string;
  countryCode: string;
  currencyCode: string;
  localeCode: string;
  status: MarketStatus;
  isDomestic: boolean;
  capabilities: Record<MarketCapability, MarketCapabilityState>;
};

export type MarketResolution =
  | { kind: 'ready'; context: ResolvedMarketContext }
  | {
      kind: 'unavailable';
      reason:
        | 'invalid_country_code'
        | 'country_not_configured'
        | 'country_inactive'
        | 'market_not_configured'
        | 'market_not_live'
        | 'currency_not_configured'
        | 'currency_inactive'
        | 'default_locale_not_configured'
        | 'invalid_market_relationship';
    };

const COUNTRY_RE = /^[A-Z]{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

export function normalizeCountryCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return COUNTRY_RE.test(code) ? code : null;
}

export function normalizeCurrencyCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return CURRENCY_RE.test(code) ? code : null;
}

export function canonicalLocaleCode(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return Intl.getCanonicalLocales(value.trim().replace(/_/g, '-'))[0] ?? null;
  } catch {
    return null;
  }
}

function primaryLanguage(value: string): string {
  return value.split('-')[0]!.toLowerCase();
}

function resolveLocale(
  requested: string | null,
  market: CommerceMarket,
  marketLocales: CommerceMarketLocale[],
  locales: CommerceLocale[],
): string | null {
  const localeByCode = new Map(locales.filter(item => item.active).map(item => [item.localeCode, item]));
  const enabled = marketLocales
    .filter(item => item.marketCode === market.marketCode && item.enabled && localeByCode.has(item.localeCode))
    .map(item => item.localeCode);

  const defaultLocale = canonicalLocaleCode(market.defaultLocaleCode);
  if (!defaultLocale || !enabled.includes(defaultLocale)) return null;

  const canonicalRequested = canonicalLocaleCode(requested);
  if (!canonicalRequested) return defaultLocale;
  if (enabled.includes(canonicalRequested)) return canonicalRequested;

  const requestedLanguage = primaryLanguage(canonicalRequested);
  const languageMatch = enabled.find(code => primaryLanguage(code) === requestedLanguage);
  return languageMatch ?? defaultLocale;
}

function capabilityMap(
  marketCode: string,
  capabilities: CommerceMarketCapability[],
): Record<MarketCapability, MarketCapabilityState> {
  const result = Object.fromEntries(
    MARKET_CAPABILITIES.map(capability => [capability, 'disabled']),
  ) as Record<MarketCapability, MarketCapabilityState>;
  for (const row of capabilities) {
    if (row.marketCode !== marketCode || !MARKET_CAPABILITIES.includes(row.capability)) continue;
    result[row.capability] = row.state;
  }
  return result;
}

export function composeMarketContext(
  countryInput: unknown,
  requestedLocale: unknown,
  bundle: MarketDataBundle,
): MarketResolution {
  const countryCode = normalizeCountryCode(countryInput);
  if (!countryCode) return { kind: 'unavailable', reason: 'invalid_country_code' };

  const country = bundle.country;
  if (!country || country.countryCode !== countryCode) {
    return { kind: 'unavailable', reason: 'country_not_configured' };
  }
  if (!country.active) return { kind: 'unavailable', reason: 'country_inactive' };

  const market = bundle.market;
  if (!market || market.countryCode !== countryCode) {
    return { kind: 'unavailable', reason: 'market_not_configured' };
  }
  if (market.status !== 'live') return { kind: 'unavailable', reason: 'market_not_live' };

  const currency = bundle.currency;
  if (!currency || currency.currencyCode !== market.defaultCurrencyCode) {
    return { kind: 'unavailable', reason: 'currency_not_configured' };
  }
  if (!currency.active) return { kind: 'unavailable', reason: 'currency_inactive' };

  if (country.defaultCurrencyCode !== currency.currencyCode) {
    return { kind: 'unavailable', reason: 'invalid_market_relationship' };
  }

  const localeCode = resolveLocale(
    canonicalLocaleCode(requestedLocale),
    market,
    bundle.marketLocales,
    bundle.locales,
  );
  if (!localeCode) {
    return { kind: 'unavailable', reason: 'default_locale_not_configured' };
  }

  return {
    kind: 'ready',
    context: {
      version: WW1_DATA_CORE_VERSION,
      marketCode: market.marketCode,
      countryCode,
      currencyCode: currency.currencyCode,
      localeCode,
      status: market.status,
      isDomestic: market.isDomestic,
      capabilities: capabilityMap(market.marketCode, bundle.capabilities),
    },
  };
}

export function isDomesticMarketContext(context: ResolvedMarketContext): boolean {
  return context.isDomestic
    && context.countryCode === DOMESTIC_COMMERCE_BASELINE.countryCode
    && context.currencyCode === DOMESTIC_COMMERCE_BASELINE.currencyCode;
}

export function isMarketCapabilityLive(
  context: ResolvedMarketContext,
  capability: MarketCapability,
): boolean {
  return context.capabilities[capability] === 'live';
}
