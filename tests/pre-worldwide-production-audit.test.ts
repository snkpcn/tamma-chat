import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

function languageBlock(source: string, lang: string, next?: string) {
  const start = source.indexOf(`\n${lang}: {`);
  assert.notEqual(start, -1, `missing ${lang} translation block`);
  const end = next ? source.indexOf(`\n${next}: {`, start) : source.indexOf('\n};', start);
  assert.notEqual(end, -1, `missing end of ${lang} translation block`);
  return source.slice(start, end);
}

test('main-site English UI dictionary contains no Thai-script leakage', () => {
  const html = read('index.html');
  const en = languageBlock(html, 'en', 'zh');
  assert.doesNotMatch(en, /[ก-๙]/);
  assert.doesNotMatch(en, /Tamma-Chart|Tamma-Chat|Tammachat/);
  assert.match(en, /Thammachat/);
});

test('main-site OTOP gateway and ecosystem visible copy are bound to i18n', () => {
  const html = read('index.html');
  for (const key of [
    'hotspot_inthanin_label','hotspot_reception_label','hotspot_dining_label',
    'hotspot_stay_label','hotspot_adventure_label','hotspot_journal_label',
    'hotspot_return_label','otop_photo_credit','otop_empty_kicker',
    'otop_empty_heading','otop_empty_body','otop_ask','otop_view_journey',
  ]) {
    assert.match(html, new RegExp(`data-i18n="${key}"`), `missing i18n binding for ${key}`);
  }
  assert.match(html, /data-i18n-alt="community_silk_alt"/);
});

test('OTOP store has one language selector and uses the production layout contract', () => {
  const html = read('otop.html');
  assert.equal((html.match(/id="storeLanguage"/g) || []).length, 1);
  assert.match(html, /assets\/styles\/pre-worldwide-production\.css/);
  assert.match(html, /assets\/scripts\/otop-i18n\.js/);
  assert.match(html, /assets\/scripts\/otop-product-translations\.js/);
});

test('production layout removes catalog asymmetry and keeps mobile on one visual rail', () => {
  const css = read('assets/styles/pre-worldwide-production.css');
  assert.match(css, /Kill the old featured-card asymmetry/);
  assert.match(css, /\.categoryGrid \.card\.featureCard,[\s\S]*grid-column:\s*auto/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*\.categoryGrid \{[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(css, /\.cardFoot \{[\s\S]*display:\s*block/);
  assert.match(css, /Horizontal movement is intentional only for curated/);
  assert.match(css, /\.community-feature-copy \{[\s\S]*text-align:\s*left !important/);
});

test('English OTOP map/store/product translations contain no Thai-script copy', () => {
  const ui = read('assets/scripts/otop-i18n.js');
  const uiEnStart = ui.indexOf('\n    en:{');
  const uiZhStart = ui.indexOf('\n    zh:{', uiEnStart);
  assert.notEqual(uiEnStart, -1);
  assert.notEqual(uiZhStart, -1);
  const uiEn = ui.slice(uiEnStart, uiZhStart);
  assert.doesNotMatch(uiEn.replaceAll('฿',''), /[ก-๙]/);

  for (const path of ['assets/scripts/otop-product-translations.js','assets/scripts/otop-province-translations.js']) {
    const source = read(path);
    const start = source.indexOf('\n    en:');
    const end = source.indexOf('\n    zh:', start);
    assert.notEqual(start, -1, `missing EN block in ${path}`);
    assert.notEqual(end, -1, `missing ZH block in ${path}`);
    assert.doesNotMatch(source.slice(start, end).replaceAll('฿',''), /[ก-๙]/, `Thai leaked into EN block in ${path}`);
  }
});

test('main and OTOP share the exact same five-language preference contract', () => {
  const main = read('index.html');
  const otop = read('assets/scripts/otop-i18n.js');
  assert.match(main, /thammachat-lang-v1/);
  assert.match(otop, /thammachat-lang-v1/);
  assert.match(main, /\['th','en','zh','lo','vi'\]/);
  assert.match(otop, /\['th','en','zh','lo','vi'\]/);
});
