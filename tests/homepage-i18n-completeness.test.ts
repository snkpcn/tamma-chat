import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('English homepage has i18n wiring for every previously leaked visible Thai block', () => {
  const required = [
    'data-i18n="brand_sub"',
    'data-i18n="exp_tag_dining"',
    'data-i18n="exp_tag_stay"',
    'data-i18n="exp_tag_adventure"',
    'data-i18n="hotspot_inthanin_label"',
    'data-i18n="hotspot_reception_label"',
    'data-i18n="hotspot_dining_label"',
    'data-i18n="hotspot_stay_label"',
    'data-i18n="hotspot_adventure_label"',
    'data-i18n="hotspot_journal_label"',
    'data-i18n="hotspot_return_label"',
    'data-i18n="otop_photo_credit"',
    'data-i18n="otop_empty_kicker"',
    'data-i18n="otop_empty_heading"',
    'data-i18n="otop_empty_body"',
    'class="btn btn-primary community-map-launch" href="otop-map.html" data-i18n="otop_ask"',
    'class="btn btn-outline" href="otop.html" data-i18n="otop_view_journey"',
    'id="rewardsHeadline" data-i18n="rewards_headline_zero"',
    'data-i18n="footer_copyright"',
  ];
  for (const marker of required) assert.ok(html.includes(marker), marker);
});

test('English translation dictionary contains no Thai script', () => {
  const start = html.indexOf('\nen: {');
  const end = html.indexOf('\nzh: {', start);
  assert.ok(start >= 0 && end > start);
  const englishBlock = html.slice(start, end);
  assert.doesNotMatch(englishBlock, /[ก-๙]/);
});

test('English strings exist for the homepage blocks seen in the mobile recording', () => {
  const expected = [
    'brand_sub:"Living stories of Isan"',
    'hotspot_inthanin_label:"Coffee at Inthanin"',
    'hotspot_reception_label:"Welcome"',
    'hotspot_dining_label:"Dining"',
    'hotspot_stay_label:"Stay"',
    'hotspot_adventure_label:"Activities"',
    'hotspot_journal_label:"Travel Notes"',
    'hotspot_return_label:"Member Benefits"',
    'otop_empty_heading:"Ban Khwao Silk, Still Woven by Hand"',
    'otop_ask:"Open the Isan Craft Map"',
    'otop_view_journey:"Shop Chaiyaphum OTOP"',
    'otop_photo_credit:"Original photo: Nation Photo · Enhanced to 4K"',
  ];
  for (const value of expected) assert.ok(html.includes(value), value);
});

test('document title follows the selected language', () => {
  assert.ok(html.includes("document.title = t('page_title')"));
  assert.ok(html.includes('page_title:"Thammachat — Experiences of Isan"'));
});


test('all homepage i18n attributes exist in every language dictionary', () => {
  const keys = new Set<string>();
  for (const match of html.matchAll(/data-i18n(?:-html|-placeholder|-aria|-alt)?="([^"]+)"/g)) keys.add(match[1]);

  const markers = ['\nth: {','\nen: {','\nzh: {','\nlo: {','\nvi: {'];
  const blocks = new Map<string,string>();
  for (let i = 0; i < markers.length; i += 1) {
    const start = html.indexOf(markers[i], html.indexOf('const TRANSLATIONS'));
    const end = i + 1 < markers.length
      ? html.indexOf(markers[i + 1], start)
      : html.indexOf('\n};', start);
    assert.ok(start >= 0 && end > start, `missing dictionary block ${markers[i]}`);
    blocks.set(markers[i].slice(1,3), html.slice(start, end));
  }

  for (const [lang, block] of blocks) {
    for (const key of keys) {
      assert.match(block, new RegExp(`\\b${key}:`), `${lang} missing homepage i18n key ${key}`);
    }
  }
});

test('non-Thai homepage dictionaries contain no accidental Thai-script leakage', () => {
  const blocks = [
    ['en','\nen: {','\nzh: {'],
    ['zh','\nzh: {','\nlo: {'],
    ['lo','\nlo: {','\nvi: {'],
    ['vi','\nvi: {','\n};'],
  ] as const;

  for (const [lang,startMarker,endMarker] of blocks) {
    const start = html.indexOf(startMarker, html.indexOf('const TRANSLATIONS'));
    const end = html.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0 && end > start, `missing ${lang} dictionary`);
    const block = html.slice(start, end).replaceAll('฿','');
    assert.doesNotMatch(block, /[ก-๙]/, `${lang} dictionary contains Thai-script leakage`);
  }
});

test('homepage translates accessibility labels and image alt text with the selected language', () => {
  assert.ok(html.includes("document.querySelectorAll('[data-i18n-aria]')"));
  assert.ok(html.includes("document.querySelectorAll('[data-i18n-alt]')"));
  for (const key of [
    'brand_home_aria','main_nav_aria','menu_open_aria','menu_close_aria',
    'hero_image_alt','inthanin_image_alt','dining_image_alt','stay_image_alt',
    'adventure_image_alt','ecosystem_image_alt','community_silk_alt',
    'journal_image_alt','rewards_image_alt','footer_social_aria',
    'thongthai_alt','chat_close_aria','chat_send_aria'
  ]) {
    assert.ok(html.includes(key), key);
  }
});
