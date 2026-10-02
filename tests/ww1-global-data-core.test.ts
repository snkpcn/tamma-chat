import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MARKET_CAPABILITIES,
  canonicalLocaleCode,
  composeMarketContext,
  isDomesticMarketContext,
  isMarketCapabilityLive,
  normalizeCountryCode,
  normalizeCurrencyCode,
  type MarketDataBundle,
} from '../netlify/functions/_worldwide-data-core';

const thaiBundle: MarketDataBundle = {
  country: {
    countryCode: 'TH',
    nameEn: 'Thailand',
    defaultCurrencyCode: 'THB',
    active: true,
  },
  currency: {
    currencyCode: 'THB',
    nameEn: 'Thai Baht',
    symbol: '฿',
    minorUnit: 2,
    active: true,
  },
  market: {
    marketCode: 'TH',
    countryCode: 'TH',
    settlementCurrencyCode: 'THB',
    defaultLocaleCode: 'th',
    status: 'live',
    isDomestic: true,
  },
  locales: [
    { localeCode: 'th', languageCode: 'th', nameEn: 'Thai', rtl: false, active: true },
    { localeCode: 'en', languageCode: 'en', nameEn: 'English', rtl: false, active: true },
    { localeCode: 'zh', languageCode: 'zh', nameEn: 'Chinese', rtl: false, active: true },
    { localeCode: 'lo', languageCode: 'lo', nameEn: 'Lao', rtl: false, active: true },
    { localeCode: 'vi', languageCode: 'vi', nameEn: 'Vietnamese', rtl: false, active: true },
  ],
  marketLocales: [
    { marketCode: 'TH', localeCode: 'th', enabled: true, isDefault: true },
    { marketCode: 'TH', localeCode: 'en', enabled: true, isDefault: false },
    { marketCode: 'TH', localeCode: 'zh', enabled: true, isDefault: false },
    { marketCode: 'TH', localeCode: 'lo', enabled: true, isDefault: false },
    { marketCode: 'TH', localeCode: 'vi', enabled: true, isDefault: false },
  ],
  capabilities: MARKET_CAPABILITIES.map(capability => ({
    marketCode: 'TH',
    capability,
    state: capability === 'customs' ? 'disabled' as const : 'live' as const,
  })),
};

test('WW-1 normalizes ISO-like country/currency identifiers fail-closed', () => {
  assert.equal(normalizeCountryCode(' th '), 'TH');
  assert.equal(normalizeCountryCode('THA'), null);
  assert.equal(normalizeCountryCode('1H'), null);
  assert.equal(normalizeCurrencyCode(' thb '), 'THB');
  assert.equal(normalizeCurrencyCode('บาท'), null);
});

test('WW-1 canonicalizes BCP47-style locale tags without tying them to currency', () => {
  assert.equal(canonicalLocaleCode('en_us'), 'en-US');
  assert.equal(canonicalLocaleCode('ZH-cn'), 'zh-CN');
  assert.equal(canonicalLocaleCode('not a locale'), null);
});

test('WW-1 resolves the existing Thailand market as domestic TH/THB', () => {
  const result = composeMarketContext('th', 'en-US', thaiBundle);
  assert.equal(result.kind, 'ready');
  if (result.kind !== 'ready') return;
  assert.equal(result.context.marketCode, 'TH');
  assert.equal(result.context.countryCode, 'TH');
  assert.equal(result.context.currencyCode, 'THB');
  assert.equal(result.context.localeCode, 'en');
  assert.equal(result.context.status, 'live');
  assert.equal(isDomesticMarketContext(result.context), true);
  assert.equal(isMarketCapabilityLive(result.context, 'checkout'), true);
  assert.equal(isMarketCapabilityLive(result.context, 'customs'), false);
});

test('WW-1 falls back to the market default locale for unsupported requested locale', () => {
  const result = composeMarketContext('TH', 'sv-SE', thaiBundle);
  assert.equal(result.kind, 'ready');
  if (result.kind === 'ready') assert.equal(result.context.localeCode, 'th');
});

test('WW-1 rejects a configured country whose market is not live', () => {
  const result = composeMarketContext('TH', 'th', {
    ...thaiBundle,
    market: { ...thaiBundle.market!, status: 'certification' },
  });
  assert.deepEqual(result, { kind: 'unavailable', reason: 'market_not_live' });
});

test('WW-1 rejects broken country/currency relationships instead of guessing', () => {
  const result = composeMarketContext('TH', 'th', {
    ...thaiBundle,
    country: { ...thaiBundle.country!, defaultCurrencyCode: 'USD' },
  });
  assert.deepEqual(result, { kind: 'unavailable', reason: 'invalid_market_relationship' });
});

test('WW-1 rejects missing default locale instead of silently inventing one', () => {
  const result = composeMarketContext('TH', 'en', {
    ...thaiBundle,
    marketLocales: thaiBundle.marketLocales.filter(row => row.localeCode !== 'th'),
  });
  assert.deepEqual(result, { kind: 'unavailable', reason: 'default_locale_not_configured' });
});

test('WW-1 missing capability rows always default to disabled', () => {
  const result = composeMarketContext('TH', 'th', {
    ...thaiBundle,
    capabilities: [{ marketCode: 'TH', capability: 'catalog', state: 'live' }],
  });
  assert.equal(result.kind, 'ready');
  if (result.kind !== 'ready') return;
  assert.equal(result.context.capabilities.catalog, 'live');
  assert.equal(result.context.capabilities.checkout, 'disabled');
  assert.equal(result.context.capabilities.payments, 'disabled');
});
