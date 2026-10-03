import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeStorefrontLanguage,
  resolveStorefrontLocale,
  resolveStorefrontText,
  storefrontFallbackLanguages,
} from '../netlify/functions/_storefront-locale';

test('WW-3 accepts full browser locale tags but resolves to current storefront language keys', () => {
  assert.equal(normalizeStorefrontLanguage('en-US'), 'en');
  assert.equal(normalizeStorefrontLanguage('zh-Hant-TW'), 'zh');
  assert.equal(normalizeStorefrontLanguage('lo_LA'), 'lo');
  assert.equal(normalizeStorefrontLanguage('sv-SE'), null);
});

test('WW-3 only resolves locales enabled for the market', () => {
  const result = resolveStorefrontLocale('zh-CN', ['th','en'], 'th');
  assert.equal(result?.language, 'th');
  assert.equal(result?.locale, 'th-TH');
});

test('WW-3 preserves requested locale when enabled and never changes market/currency state', () => {
  const result = resolveStorefrontLocale('vi-VN', ['th','en','vi'], 'th');
  assert.deepEqual(result, {
    version: 'ww3-multilingual-storefront-2026-10-03',
    language: 'vi',
    locale: 'vi-VN',
    direction: 'ltr',
    fallbackLanguages: ['vi','en'],
  });
  assert.equal('countryCode' in (result ?? {}), false);
  assert.equal('currencyCode' in (result ?? {}), false);
});

test('WW-3 non-Thai fallback goes to English, never silently back to Thai', () => {
  assert.deepEqual(storefrontFallbackLanguages('zh'), ['zh','en']);
  assert.deepEqual(storefrontFallbackLanguages('th'), ['th']);
  const dictionaries = {
    th: { title: 'ภาษาไทย' },
    en: { title: 'English fallback' },
    zh: {},
  };
  assert.equal(resolveStorefrontText(dictionaries, 'title', 'zh'), 'English fallback');
  assert.equal(resolveStorefrontText({ th:{ title:'ภาษาไทย' } }, 'title', 'zh'), 'title');
});

test('WW-3 fails closed when market default locale is invalid or not enabled', () => {
  assert.equal(resolveStorefrontLocale('en', ['en'], 'th'), null);
  assert.equal(resolveStorefrontLocale('en', ['th','en'], 'xx'), null);
});
