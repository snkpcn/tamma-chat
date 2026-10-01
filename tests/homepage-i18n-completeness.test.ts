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
  assert.ok(html.includes('page_title:"Tamma-Chat — Experiences of Isan"'));
});
