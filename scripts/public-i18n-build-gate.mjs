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


const publicSurfaces = [
  ['account.html', ['id="accountLanguage"', 'assets/scripts/account-i18n.js', 'data-account-i18n=']],
  ['chess.html', ['id="ttChessLanguage"', 'thammachat-lang-v1', 'data-tt-i18n=']],
  ['menu.html', ['id="menuLanguage"', 'assets/scripts/menu-i18n.js', 'MenuI18n.name(item.name)']],
  ['otop-map.html', ['data-otop-lang-select', 'assets/scripts/otop-i18n.js']],
  ['otop.html', ['data-otop-lang-select', 'assets/scripts/otop-i18n.js']],
];
for (const [path, tokens] of publicSurfaces) {
  const source = fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  for (const token of tokens) {
    if (!source.includes(token)) {
      console.error('PUBLIC_I18N_BUILD_GATE_FAILED:', path, 'missing:', token);
      process.exit(1);
    }
  }
}
for (const path of ['assets/scripts/account-i18n.js','assets/scripts/menu-i18n.js','chess.html','index.html','assets/scripts/otop-i18n.js']) {
  const source = fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  if (!source.includes('thammachat-lang-v1')) {
    console.error('PUBLIC_I18N_BUILD_GATE_FAILED:', path, 'does not use the shared language preference');
    process.exit(1);
  }
}
