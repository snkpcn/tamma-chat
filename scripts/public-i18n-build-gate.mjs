import fs from 'node:fs';

const file = new URL('../index.html', import.meta.url);
const html = fs.readFileSync(file, 'utf8');

const required = [
  'data-i18n="otop_photo_credit"',
  'data-i18n-alt="community_silk_alt"',
  'data-i18n="otop_empty_kicker"',
  'data-i18n="otop_empty_heading"',
  'data-i18n="otop_empty_body"',
  'data-i18n="otop_ask"',
  'data-i18n="otop_view_journey"',
  'data-i18n="hotspot_inthanin_label"',
  'data-i18n="hotspot_reception_label"',
  'data-i18n="hotspot_dining_label"',
  'data-i18n="hotspot_stay_label"',
  'data-i18n="hotspot_adventure_label"',
  'data-i18n="hotspot_journal_label"',
  'data-i18n="hotspot_return_label"',
  'data-i18n-alt="hero_image_alt"',
  'data-i18n-alt="inthanin_image_alt"',
  'data-i18n-alt="dining_image_alt"',
  'data-i18n-alt="stay_image_alt"',
  'data-i18n-alt="adventure_image_alt"',
  'data-i18n-alt="ecosystem_image_alt"',
  'data-i18n-alt="journal_image_alt"',
  'data-i18n-alt="rewards_image_alt"',
];

const missing = required.filter(token => !html.includes(token));
if (missing.length) {
  console.error('PUBLIC_I18N_BUILD_GATE_FAILED');
  for (const token of missing) console.error('missing:', token);
  process.exit(1);
}

const communityStart = html.indexOf('<article class="community-feature community-story-feature">');
const communityEnd = html.indexOf('</article>', communityStart);
if (communityStart < 0 || communityEnd < 0) {
  console.error('PUBLIC_I18N_BUILD_GATE_FAILED: community story card missing');
  process.exit(1);
}
const community = html.slice(communityStart, communityEnd);
for (const key of ['otop_empty_kicker','otop_empty_heading','otop_empty_body','otop_ask','otop_view_journey']) {
  if (!community.includes(`data-i18n="${key}"`)) {
    console.error('PUBLIC_I18N_BUILD_GATE_FAILED: community key stripped:', key);
    process.exit(1);
  }
}

console.log('PUBLIC_I18N_BUILD_GATE_OK');
