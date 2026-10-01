import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('all public pages use the shared typography contract', () => {
  const pages = ['index.html','account.html','chess.html','menu.html','otop-map.html','otop.html'];
  for (const page of pages) {
    const html = read(page);
    assert.match(html, /assets\/styles\/site-typography\.css/, `${page} must load shared typography`);
    assert.doesNotMatch(html, /Noto Serif Thai|font-family\s*:\s*Georgia|-apple-system|BlinkMacSystemFont|"Segoe UI"/,
      `${page} must not reintroduce a competing public-page font stack`);
  }

  const css = read('assets/styles/site-typography.css');
  assert.match(css, /--site-font-th:\s*"IBM Plex Sans Thai"/);
  assert.match(css, /--site-font-en:\s*"Noto Sans"/);
  assert.match(css, /html\[lang="th"\][\s\S]*--font-display:\s*var\(--site-font-th\)/);
  assert.match(css, /html\[lang="en"\][\s\S]*--font-display:\s*var\(--site-font-en\)/);
});

test('OTOP map and store share the existing five-language preference', () => {
  const i18n = read('assets/scripts/otop-i18n.js');
  assert.match(i18n, /thammachat-lang-v1/);
  assert.match(i18n, /\['th','en','zh','lo','vi'\]/);
  for (const province of ['chaiyaphum','khonkaen','buriram','surin','sisaket','nakhonratchasima','roiet','mahasarakham','kalasin','sakonnakhon','nakhonphanom','mukdahan','yasothon','amnatcharoen','ubonratchathani','udonthani','nongkhai','buengkan','loei','nongbualamphu']) {
    assert.match(i18n, new RegExp(`\\b${province}:`));
  }

  const map = read('otop-map.html');
  const store = read('otop.html');
  for (const page of [map, store]) {
    assert.match(page, /assets\/scripts\/otop-i18n\.js/);
    assert.match(page, /data-otop-lang-select/);
    for (const lang of ['th','en','zh','lo','vi']) {
      assert.match(page, new RegExp(`<option value="${lang}"`));
    }
  }
});

test('OTOP dynamic UI rerenders on language changes', () => {
  const mapJs = read('assets/scripts/otop-map.js');
  assert.match(mapJs, /otop:i18n-ready/);
  assert.match(mapJs, /otop:i18n-change/);
  assert.match(mapJs, /provinceName\(province\.provinceId\)/);
  assert.match(mapJs, /OTOP_PROVINCE_TRANSLATIONS/);
  assert.match(read('otop-map.html'), /assets\/scripts\/otop-province-translations\.js/);

  const store = read('otop.html');
  assert.match(store, /assets\/scripts\/otop-product-translations\.js/);
  assert.match(store, /localizedProduct\(/);
  assert.match(store, /otop:i18n-change/);
  assert.match(store, /otop:i18n-ready/);
  assert.match(store, /currentLocale\(\)/);
  assert.doesNotMatch(store, /toLocaleString\('th-TH'\)/);
});

test('all ten currently live Chaiyaphum story records have four non-Thai translations', () => {
  const translations = read('assets/scripts/otop-product-translations.js');
  for (const lang of ['en','zh','lo','vi']) {
    const start = translations.indexOf(`${lang}: {`);
    assert.notEqual(start, -1, `missing ${lang} product translations`);
  }
  for (let i = 1; i <= 10; i += 1) {
    const id = `chaiyaphum-otop-${String(i).padStart(3, '0')}`;
    const occurrences = translations.split(id).length - 1;
    assert.equal(occurrences, 4, `${id} must be translated into en/zh/lo/vi`);
  }
});


test('OTOP store remains one valid HTML document after localization wiring', () => {
  const store = read('otop.html');
  assert.equal((store.match(/<!doctype html>/gi) || []).length, 1);
  assert.equal((store.match(/<\/html>/gi) || []).length, 1);
  assert.equal((store.match(/<\/body>/gi) || []).length, 1);
  assert.equal((store.match(/const currentLang/g) || []).length, 1);
});


test('all 20 province stories have four non-Thai translations', () => {
  const translations = read('assets/scripts/otop-province-translations.js');
  const provinces = ['chaiyaphum','khonkaen','buriram','surin','sisaket','nakhonratchasima','roiet','mahasarakham','kalasin','sakonnakhon','nakhonphanom','mukdahan','yasothon','amnatcharoen','ubonratchathani','udonthani','nongkhai','buengkan','loei','nongbualamphu'];
  for (const province of provinces) {
    const occurrences = translations.split(`${province}:{title:`).length - 1;
    assert.equal(occurrences, 4, `${province} must have EN/ZH/LO/VI story copy`);
  }
});


test('OTOP store has exactly one language selector and every static i18n key exists in all five dictionaries', () => {
  const map = read('otop-map.html');
  const store = read('otop.html');
  const i18n = read('assets/scripts/otop-i18n.js');

  assert.equal((store.match(/id="storeLanguage"/g) || []).length, 1, 'storeLanguage id must be unique');
  assert.equal((map.match(/id="mapLanguage"/g) || []).length, 1, 'mapLanguage id must be unique');

  const attrKeys = new Set<string>();
  for (const html of [map, store]) {
    for (const match of html.matchAll(/data-otop-i18n(?:-placeholder|-aria)?="([^"]+)"/g)) {
      attrKeys.add(match[1]);
    }
  }
  for (const required of [
    'film_credit_craft','film_source_aria','shop_nav_aria','home_aria',
    'choose_province_aria','open_cart_aria','catalog_sort_aria','category_nav_aria',
    'product_close_aria','quantity_aria','qty_decrease','qty_increase','drawer_aria',
    'map_legend_aria','map_svg_aria','member_nav_aria'
  ]) attrKeys.add(required);

  const markers = ['    th:{','    en:{','    zh:{','    lo:{','    vi:{'];
  const blocks = new Map<string,string>();
  for (let i = 0; i < markers.length; i += 1) {
    const lang = markers[i].trim().slice(0,2);
    const start = i18n.indexOf(markers[i]);
    const end = i + 1 < markers.length ? i18n.indexOf(markers[i + 1]) : i18n.indexOf('  };', start);
    assert.ok(start >= 0 && end > start, `missing dictionary block for ${markers[i]}`);
    blocks.set(lang, i18n.slice(start, end));
  }

  for (const [lang, block] of blocks) {
    for (const key of attrKeys) {
      assert.match(block, new RegExp(`\\b${key}:`), `${lang} missing i18n key ${key}`);
    }
  }
});

test('OTOP language hotfix covers visible credit and localized metadata', () => {
  const store = read('otop.html');
  const mapJs = read('assets/scripts/otop-map.js');
  assert.match(store, /data-otop-i18n="film_credit_craft"/);
  assert.match(store, /store_meta_desc/);
  assert.match(mapJs, /map_meta_desc/);
  assert.doesNotMatch(store, /id="storeLanguage"[^]*id="storeLanguage"/);
});


test('non-Thai OTOP dictionaries contain no accidental Thai-script leakage', () => {
  const i18n = read('assets/scripts/otop-i18n.js');
  const markers = [
    ['en','    en:{','    zh:{'],
    ['zh','    zh:{','    lo:{'],
    ['lo','    lo:{','    vi:{'],
    ['vi','    vi:{','  };'],
  ] as const;
  for (const [lang,startMarker,endMarker] of markers) {
    const start = i18n.indexOf(startMarker);
    const end = i18n.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0 && end > start, `missing OTOP ${lang} dictionary`);
    const block = i18n.slice(start, end).replaceAll('฿','');
    assert.doesNotMatch(block, /[ก-๙]/, `${lang} OTOP dictionary contains Thai-script leakage`);
  }

  const mapJs = read('assets/scripts/otop-map.js');
  assert.doesNotMatch(mapJs, /zh:'[^']*[ก-๙]/);
  assert.doesNotMatch(mapJs, /lo:'[^']*[ก-๙]/);
});
