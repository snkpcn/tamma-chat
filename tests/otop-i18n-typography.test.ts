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
