import { isWorldwideCapabilityEnabled, type WorldwideEnv } from './_worldwide-foundation';
import {
  canonicalLocaleCode,
  composeMarketContext,
  normalizeCountryCode,
  type CommerceCountry,
  type CommerceCurrency,
  type CommerceLocale,
  type CommerceMarket,
  type CommerceMarketCapability,
  type CommerceMarketLocale,
  type MarketResolution,
} from './_worldwide-data-core';

type DbConfig = { url: string; key: string };

function config(): DbConfig | null {
  const runtime = (globalThis as typeof globalThis & {
    Netlify?: { env?: { get?: (key: string) => unknown } };
  }).Netlify?.env;
  const get = (name: string): string | undefined => {
    const value = runtime?.get?.(name);
    return typeof value === 'string' ? value : undefined;
  };
  const url = get('SUPABASE_URL');
  const key = get('SUPABASE_SERVICE_ROLE_KEY');
  return url && key ? { url: url.replace(/\/$/, ''), key } : null;
}

async function dbFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const c = config();
  if (!c) throw new Error('worldwide_data_core_not_configured');
  const response = await fetch(`${c.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: c.key,
      Authorization: `Bearer ${c.key}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`worldwide_data_core_db_${response.status}:${body.slice(0, 240)}`);
  }
  return response;
}

type CurrencyRow = {
  currency_code: string;
  name_en: string;
  symbol: string | null;
  minor_unit: number;
  active: boolean;
};
type CountryRow = {
  country_code: string;
  name_en: string;
  default_currency_code: string;
  active: boolean;
};
type LocaleRow = {
  locale_code: string;
  language_code: string;
  name_en: string;
  rtl: boolean;
  active: boolean;
};
type MarketRow = {
  market_code: string;
  country_code: string;
  settlement_currency_code: string;
  default_locale_code: string;
  status: 'draft' | 'certification' | 'live' | 'suspended';
  is_domestic: boolean;
};
type MarketLocaleRow = {
  market_code: string;
  locale_code: string;
  enabled: boolean;
  is_default: boolean;
};
type CapabilityRow = {
  market_code: string;
  capability: CommerceMarketCapability['capability'];
  state: CommerceMarketCapability['state'];
};

function country(row: CountryRow): CommerceCountry {
  return {
    countryCode: row.country_code,
    nameEn: row.name_en,
    defaultCurrencyCode: row.default_currency_code,
    active: row.active,
  };
}

function currency(row: CurrencyRow): CommerceCurrency {
  return {
    currencyCode: row.currency_code,
    nameEn: row.name_en,
    symbol: row.symbol,
    minorUnit: Number(row.minor_unit),
    active: row.active,
  };
}

function locale(row: LocaleRow): CommerceLocale {
  return {
    localeCode: canonicalLocaleCode(row.locale_code) ?? row.locale_code,
    languageCode: row.language_code,
    nameEn: row.name_en,
    rtl: row.rtl,
    active: row.active,
  };
}

function market(row: MarketRow): CommerceMarket {
  return {
    marketCode: row.market_code,
    countryCode: row.country_code,
    settlementCurrencyCode: row.settlement_currency_code,
    defaultLocaleCode: canonicalLocaleCode(row.default_locale_code) ?? row.default_locale_code,
    status: row.status,
    isDomestic: row.is_domestic,
  };
}

export type WorldwideMarketLoadResult =
  | { kind: 'disabled' }
  | MarketResolution;

export async function loadWorldwideMarketContext(
  countryInput: unknown,
  requestedLocale: unknown,
  env?: WorldwideEnv,
): Promise<WorldwideMarketLoadResult> {
  if (!isWorldwideCapabilityEnabled('dataCore', env)) return { kind: 'disabled' };

  const countryCode = normalizeCountryCode(countryInput);
  if (!countryCode) return { kind: 'unavailable', reason: 'invalid_country_code' };

  const marketRes = await dbFetch(
    'commerce_markets?country_code=eq.' + encodeURIComponent(countryCode)
    + '&select=market_code,country_code,settlement_currency_code,default_locale_code,status,is_domestic&limit=1',
  );
  const marketRows = await marketRes.json() as MarketRow[];
  const marketRow = marketRows[0];
  if (!marketRow) return { kind: 'unavailable', reason: 'market_not_configured' };

  const [countryRes, currencyRes, marketLocalesRes, capabilityRes] = await Promise.all([
    dbFetch(
      'commerce_countries?country_code=eq.' + encodeURIComponent(countryCode)
      + '&select=country_code,name_en,default_currency_code,active&limit=1',
    ),
    dbFetch(
      'commerce_currencies?currency_code=eq.' + encodeURIComponent(marketRow.settlement_currency_code)
      + '&select=currency_code,name_en,symbol,minor_unit,active&limit=1',
    ),
    dbFetch(
      'commerce_market_locales?market_code=eq.' + encodeURIComponent(marketRow.market_code)
      + '&select=market_code,locale_code,enabled,is_default',
    ),
    dbFetch(
      'commerce_market_capabilities?market_code=eq.' + encodeURIComponent(marketRow.market_code)
      + '&select=market_code,capability,state',
    ),
  ]);

  const [countryRows, currencyRows, marketLocaleRows, capabilityRows] = await Promise.all([
    countryRes.json() as Promise<CountryRow[]>,
    currencyRes.json() as Promise<CurrencyRow[]>,
    marketLocalesRes.json() as Promise<MarketLocaleRow[]>,
    capabilityRes.json() as Promise<CapabilityRow[]>,
  ]);

  const localeCodes = marketLocaleRows
    .filter(row => row.enabled)
    .map(row => row.locale_code);
  const localeRes = localeCodes.length
    ? await dbFetch(
        'commerce_locales?locale_code=in.('
        + localeCodes.map(code => encodeURIComponent(code)).join(',')
        + ')&select=locale_code,language_code,name_en,rtl,active',
      )
    : null;
  const localeRows = localeRes ? await localeRes.json() as LocaleRow[] : [];

  return composeMarketContext(countryCode, requestedLocale, {
    country: countryRows[0] ? country(countryRows[0]) : null,
    currency: currencyRows[0] ? currency(currencyRows[0]) : null,
    market: market(marketRow),
    locales: localeRows.map(locale),
    marketLocales: marketLocaleRows.map(row => ({
      marketCode: row.market_code,
      localeCode: canonicalLocaleCode(row.locale_code) ?? row.locale_code,
      enabled: row.enabled,
      isDefault: row.is_default,
    })),
    capabilities: capabilityRows.map(row => ({
      marketCode: row.market_code,
      capability: row.capability,
      state: row.state,
    })),
  });
}
