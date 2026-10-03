import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path:string) => readFileSync(path,'utf8');
const pages = ['index.html','account.html','chess.html','menu.html','otop-map.html','otop.html'];

test('WW-3 global locale kernel parses as standalone browser JavaScript', () => {
  const source = read('assets/scripts/global-locale.js');
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /thammachat-lang-v1/u);
  assert.match(source, /navigator\.languages/u);
  assert.match(source, /URLSearchParams\(location\.search\)\.get\('lang'\)/u);
  assert.match(source, /\[normalized, 'en'\]/u);
  assert.doesNotMatch(source, /currency|countryCode|marketCode/u);
});

test('WW-3 all six public surfaces load the locale kernel before their page language runtime', () => {
  for (const path of pages) {
    const html = read(path);
    const kernel = html.indexOf('assets/scripts/global-locale.js');
    assert.ok(kernel >= 0, `${path} missing global locale kernel`);
    const runtimeMarkers = path === 'index.html'
      ? ['const LANG_STORAGE_KEY']
      : path === 'chess.html'
        ? ['const LANG_STORAGE_KEY']
        : path === 'account.html'
          ? ['assets/scripts/account-i18n.js']
          : path === 'menu.html'
            ? ['assets/scripts/menu-i18n.js']
            : ['assets/scripts/otop-i18n.js'];
    for (const marker of runtimeMarkers) {
      const runtime = html.indexOf(marker);
      assert.ok(runtime > kernel, `${path} must load global locale kernel before ${marker}`);
    }
  }
});

test('WW-3 every public language engine consumes the same global kernel', () => {
  const sources = [
    read('index.html'),
    read('chess.html'),
    read('assets/scripts/account-i18n.js'),
    read('assets/scripts/menu-i18n.js'),
    read('assets/scripts/otop-i18n.js'),
  ];
  for (const source of sources) {
    assert.match(source, /ThammachatLocale/u);
    assert.match(source, /thammachat-lang-v1/u);
  }
});

test('WW-3 UI fallback is English-first for non-Thai surfaces', () => {
  const home = read('index.html');
  const chess = read('chess.html');
  const account = read('assets/scripts/account-i18n.js');
  const menu = read('assets/scripts/menu-i18n.js');
  const otop = read('assets/scripts/otop-i18n.js');
  for (const [name,source] of [['home',home],['chess',chess],['account',account],['menu',menu],['otop',otop]] as const) {
    assert.match(source, /ThammachatLocale\.translate/u, `${name} should use kernel translation fallback`);
  }
});

test('WW-3 OTOP structured content falls back to English before Thai source content', () => {
  const products = read('assets/scripts/otop-product-translations.js');
  const provinces = read('assets/scripts/otop-province-translations.js');
  assert.match(products, /const english = T\.en\?\.\[id\] \|\| \{\}/u);
  assert.match(products, /return \{ \.\.\.fallback, \.\.\.english, \.\.\.row \}/u);
  assert.match(provinces, /const english = DATA\.en\?\.\[provinceId\] \|\| \{\}/u);
  assert.match(provinces, /return \{ \.\.\.fallback, \.\.\.english, \.\.\.row \}/u);
});

test('WW-3 language preference never authorizes or mutates commerce decisions', () => {
  const kernel = read('assets/scripts/global-locale.js');
  const server = read('netlify/functions/_storefront-locale.ts');
  assert.doesNotMatch(kernel, /THB|USD|shipping|checkout|payment/iu);
  assert.doesNotMatch(server, /shipping|checkout|payment|price|countryCode|currencyCode/iu);
});
