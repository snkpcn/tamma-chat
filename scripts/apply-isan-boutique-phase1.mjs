import fs from 'node:fs';

const file = new URL('../index.html', import.meta.url);
let html = fs.readFileSync(file, 'utf8');

// Keep the document in standards mode even if an upstream binary operation
// accidentally prepends bytes before the doctype.
const doctypeIndex = html.indexOf('<!DOCTYPE html>');
if (doctypeIndex > 0) {
  html = html.slice(doctypeIndex);
}

if (!html.includes('class="isan-boutique"')) {
  html = html.replace('<html lang="th">', '<html lang="th" class="isan-boutique">');
}

const stylesheet = '<link rel="stylesheet" href="assets/styles/isan-boutique-phase1.css">';
if (!html.includes(stylesheet)) {
  html = html.replace('</head>', `${stylesheet}\n</head>`);
}
const repairStylesheet = '<link rel="stylesheet" href="assets/styles/isan-final-repair.css">';
if (!html.includes(repairStylesheet)) {
  html = html.replace(stylesheet, `${stylesheet}\n${repairStylesheet}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceImageByAlt(alt, markup) {
  const targetSrc = markup.match(/\bsrc="([^"]+)"/)?.[1];
  if (targetSrc && html.includes(`src="${targetSrc}"`)) return;
  const pattern = new RegExp(`<img\\b(?=[^>]*\\balt="${escapeRegExp(alt)}")[^>]*>`, 'u');
  if (!pattern.test(html)) {
    throw new Error(`Image not found: ${alt}`);
  }
  html = html.replace(pattern, markup);
}

const heroStart = html.indexOf('  <div class="hero-bg">');
const heroInner = html.indexOf('  <div class="hero-inner container">', heroStart);
if (heroStart < 0 || heroInner < 0) {
  throw new Error('Hero asset block not found');
}

const assetBlock = `  <div class="hero-bg">
    <picture>
      <source srcset="assets/brand/backgrounds/hero-aerial-estate-1920.avif" type="image/avif">
      <img src="assets/brand/backgrounds/hero-aerial-estate-1920.webp" width="1920" height="1080" fetchpriority="high" decoding="async" alt="ภาพมุมสูงของทำมา-ชาติและภูมิทัศน์อีสานยามเย็น" data-i18n-alt="hero_image_alt">
    </picture>
  </div>
`;

html = html.slice(0, heroStart) + assetBlock + html.slice(heroInner);

replaceImageByAlt(
  'ตำมา-ชาติ พื้นที่รับประทานอาหารกลางแจ้งยามพลบค่ำ',
  '<img src="assets/brand/backgrounds/dining-restaurant-1920.webp" width="1920" height="1080" loading="lazy" decoding="async" alt="ตำมา-ชาติ พื้นที่รับประทานอาหารกลางแจ้งยามพลบค่ำ" data-i18n-alt="dining_image_alt">',
);
replaceImageByAlt(
  'ทำมา-ชาติ เฮือนสเตย์ เรือนพักริมน้ำยามเย็น',
  '<img src="assets/brand/backgrounds/stay-guest-room-1920.webp" width="1920" height="1080" loading="lazy" decoding="async" alt="ทำมา-ชาติ เฮือนสเตย์ ห้องพักที่อบอุ่นและสงบ" data-i18n-alt="stay_image_alt">',
);
replaceImageByAlt(
  'ทำมา-ชาติ ผจญภัย เส้นทางเดินชมท้องทุ่งยามเช้า',
  '<img src="assets/brand/backgrounds/adventure-garden-1920.webp" width="1920" height="1080" loading="lazy" decoding="async" alt="ทำมา-ชาติ ผจญภัย พื้นที่กลางแจ้งและสวนอีสาน" data-i18n-alt="adventure_image_alt">',
);
replaceImageByAlt(
  'ร้านอินทนิลคอฟฟี่ ณ ทำมา-ชาติ ยามพลบค่ำ',
  '<img src="assets/brand/backgrounds/inthanin-tadtone-boutique-grade-1536.webp" width="1536" height="1152" loading="lazy" decoding="async" alt="ร้านอินทนิล สาขาตาดโตน ณ ทำมา-ชาติ" data-i18n-alt="inthanin_image_alt">',
);
replaceImageByAlt(
  'ผังพื้นที่ทำมา-ชาติจากมุมสูง แสดงจุดเชื่อมโยงประสบการณ์ต่าง ๆ',
  '<img src="assets/brand/backgrounds/ecosystem-aerial-1920.webp" width="1920" height="1080" loading="lazy" decoding="async" alt="ภาพมุมสูงของพื้นที่ทำมา-ชาติและเส้นทางรอบบึง" data-i18n-alt="ecosystem_image_alt">',
);
replaceImageByAlt(
  'สมุดบันทึกวางอยู่บนโต๊ะไม้ริมสระน้ำยามเย็น',
  '<img src="assets/brand/backgrounds/hero-lakeside-1920.webp" width="1920" height="1080" loading="lazy" decoding="async" alt="บ้านพักริมน้ำยามเย็นสำหรับเขียนบันทึกการเดินทาง" data-i18n-alt="journal_image_alt">',
);
replaceImageByAlt(
  'มุมต้อนรับอบอุ่นภายในทำมา-ชาติ เฮือนสเตย์',
  '<img src="assets/brand/backgrounds/rewards-pavilion-1920.webp" width="1920" height="1080" loading="lazy" decoding="async" alt="ศาลากลางสวนสำหรับแขกที่กลับมาเยือนทำมา-ชาติ" data-i18n-alt="rewards_image_alt">',
);
function removeImageContainer(className) {
  html = html.replace(
    new RegExp(`\\s*<div class="${escapeRegExp(className)}"[^>]*>\\s*<img\\b[^>]*>\\s*</div>`, 'u'),
    '',
  );
}

for (const className of ['jf-character', 'journal-character', 'rewards-character']) {
  removeImageContainer(className);
}

const existingCommunityGateway = html.indexOf('    <div class="community-map-gateway fade-up">');
const communityStart = existingCommunityGateway >= 0
  ? existingCommunityGateway
  : html.indexOf('    <div class="community-grid fade-up" id="communityGrid"');
const communityActions = html.indexOf('    <div class="community-actions fade-up">', communityStart);
const communityNote = html.indexOf('    <p class="community-note"', communityStart);
const communityTail = communityActions >= 0 ? communityActions : communityNote;
if (communityStart < 0 || communityTail < 0) {
  throw new Error('Community asset block not found');
}

const communityBlock = `    <div class="community-map-gateway fade-up">
      <article class="community-feature community-story-feature">
        <div class="community-feature-media">
          <img class="community-feature-bg" src="assets/brand/backgrounds/ban-khwao-silk-weaving-4k.webp" width="3840" height="2560" loading="lazy" decoding="async" alt="ช่างทอผ้าไหมบ้านเขว้ากำลังทอผ้าบนกี่" data-i18n-alt="community_silk_alt">
          <span class="community-photo-credit" data-i18n="otop_photo_credit">ภาพต้นฉบับ Nation Photo · ปรับความละเอียด 4K</span>
        </div>
        <div class="community-feature-copy">
          <img class="community-feature-logo" src="assets/brand/logos/otop-logo-brown-trimmed.webp" width="352" height="347" loading="lazy" decoding="async" alt="OTOP">
          <div class="card-kicker" data-i18n="otop_empty_kicker">ของดีชัยภูมิ · บ้านเขว้า</div>
          <h3 data-i18n="otop_empty_heading">ผ้าไหมบ้านเขว้า งานฝีมือที่ยังทอจริง</h3>
          <p data-i18n="otop_empty_body">ชาวบ้านเขว้าสืบทอดการทอผ้าไหมมัดหมี่มาเกือบ 200 ปี ตั้งแต่การสาวไหม มัดลาย ย้อมสี จนถึงทอด้วยกี่ทีละเส้น ลายหมี่คั่นขอนารีจึงไม่ใช่แค่ลวดลายสวยงาม แต่เป็นฝีมือและเรื่องราวของคนชัยภูมิที่อยู่ในผ้าทุกผืน</p>
          <div class="community-map-actions">
            <a class="btn btn-primary community-map-launch" href="otop-map.html" data-i18n="otop_ask">เปิดแผนที่ของดีอีสาน</a>
            <a class="btn btn-outline" href="otop.html" data-i18n="otop_view_journey">ดูสินค้า OTOP ชัยภูมิ</a>
          </div>
        </div>
      </article>
    </div>
    <div class="community-grid fade-up" id="communityGrid" aria-live="polite"></div>
`;

html = html.slice(0, communityStart) + communityBlock + html.slice(communityTail);

const chessSection = `<section class="section-pad" id="chess-challenge">
  <div class="container">
    <div class="tt-chess-home-wrap fade-up">
      <div class="tt-chess-home-content">
        <span class="eyebrow" data-i18n="chess_card_eyebrow">ดวลหมากรุกกับทองไทย</span>
        <h3 data-i18n="chess_card_heading">เล่นหมากรุกกับทองไทย</h3>
        <p data-i18n="chess_card_sub">เล่นสนุก ฝึกความคิด และท้าทายฝีมือกับทองไทย</p>
        <div class="tt-chess-home-badge-row" aria-hidden="true">
          <img src="assets/chess/derived/B01_badge_easy.webp" alt="">
          <img src="assets/chess/derived/B03_badge_hard.webp" alt="">
          <img src="assets/chess/derived/B04_badge_master.webp" alt="">
        </div>
      </div>
      <div class="tt-chess-home-stage">
        <div class="tt-chess-home-actions">
          <a href="chess.html" class="btn btn-primary btn-sm" data-i18n="chess_card_cta">เริ่มเล่นหมากรุก</a>
        </div>
        <div class="tt-chess-home-art">
          <img class="tt-chess-home-character" src="assets/brand/characters/thongthai-portrait-master-4k.webp" width="4096" height="4096" loading="lazy" decoding="async" alt="ทองไทยชวนเล่นหมากรุก">
        </div>
      </div>
    </div>
  </div>
</section>`;
html = html.replace(
  /<section class="section-pad" id="chess-challenge">[\s\S]*?<\/section>/u,
  chessSection,
);

html = html.replace(
  /\s*<div class="community-actions fade-up">[\s\S]*?<\/div>\s*(?=<p class="community-note")/u,
  '\n    ',
);

const journalIcon = `<div class="jf-icon-wrap" data-step="remember"><span class="jf-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v17H6.5A2.5 2.5 0 0 0 4 22V5.5Z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v17h4.5A2.5 2.5 0 0 1 20 22V5.5Z"/><path d="m15.2 14.8 3.9-3.9 1.4 1.4-3.9 3.9-2 .6.6-2Z"/></svg></span><span class="jf-num-badge"><span class="jf-num-digit">4</span><svg class="jf-num-mark" viewBox="0 0 24 24" fill="none" stroke="#F7F1E4" stroke-width="2.6" stroke-linecap="round"><path d="M7 5v6a5 5 0 0 0 10 0V5"/></svg></span></div>`;
html = html.replace(/<div class="jf-icon-wrap" data-step="remember">[^\n]+<\/div>/u, journalIcon);

const thaiJourneyLabels = new Map([
  ['flow_s1_t', 'แวะพัก'],
  ['flow_s2_t', 'เลือกสิ่งที่ชอบ'],
  ['flow_s3_t', 'ลงมือเที่ยว'],
  ['flow_s4_t', 'เก็บความทรงจำ'],
  ['flow_s5_t', 'รับสิทธิพิเศษ'],
  ['flow_s6_t', 'กลับมาอีก'],
]);
for (const [key, label] of thaiJourneyLabels) {
  html = html.replace(new RegExp(`(<h4 data-i18n="${key}">)[^<]+(</h4>)`, 'u'), `$1${label}$2`);
  html = html.replace(new RegExp(`(${key}:)"[^"]+"`, 'u'), `$1"${label}"`);
}
html = html.replace(
  /(<p data-i18n="flow_s4_d">)[^<]+(<\/p>)/u,
  '$1บันทึกทุกเรื่องราวไว้ในสมุดการเดินทาง$2',
);
html = html.replace(
  /(flow_s4_d:)"บันทึกทุกเรื่องราวไว้ใน Journey Journal"/u,
  '$1"บันทึกทุกเรื่องราวไว้ในสมุดการเดินทาง"',
);

html = html.replace(
  'grid.innerHTML = REWARD_DEFS.map(r=>{',
  'grid.innerHTML = REWARD_DEFS.map((r, index)=>{',
);
html = html.replace(
  '<span class="reward-medal">${rewardIconSvg(r.iconKey)}</span>',
  '<span class="reward-medal" aria-hidden="true">${String(index + 1).padStart(2, \'0\')}</span>',
);

const hotspotLabels = new Map([
  ['Inthanin', ['กาแฟ Inthanin', 'hotspot_inthanin_label']],
  ['Reception', ['ต้อนรับ', 'hotspot_reception_label']],
  ['Dining', ['ร้านอาหาร', 'hotspot_dining_label']],
  ['Stay', ['บ้านพัก', 'hotspot_stay_label']],
  ['Adventure', ['กิจกรรม', 'hotspot_adventure_label']],
  ['Journal', ['สมุดบันทึก', 'hotspot_journal_label']],
  ['Rewards', ['สิทธิพิเศษ', 'hotspot_return_label']],
]);
for (const [oldLabel, [newLabel, i18nKey]] of hotspotLabels) {
  html = html.replace(
    new RegExp(`<span class="hotspot-label"(?: data-i18n="[^"]+")?>${escapeRegExp(oldLabel)}</span>`, 'u'),
    `<span class="hotspot-label" data-i18n="${i18nKey}">${newLabel}</span>`,
  );
}

// Keep the Thai page readable even before the translation runtime hydrates.
// Do not mix Journey / Journal into the default Thai markup or fallbacks.
const thaiFallbackCopy = new Map([
  ['เริ่มต้น Journey แรกของคุณ', 'เริ่มเก็บความทรงจำครั้งแรก'],
  ['ทองไทยกำลังวาง Journey ของคุณ', 'ทองไทยกำลังจัดแผนเที่ยวให้คุณ'],
  ['ตรวจสอบ Journey', 'ตรวจสอบแผนเที่ยว'],
  ['Journey ที่แนะนำสำหรับคุณ', 'แผนเที่ยวที่แนะนำสำหรับคุณ'],
  ['บันทึก Journey', 'บันทึกแผนเที่ยว'],
  ['เพิ่มลง Journal', 'เพิ่มลงสมุดบันทึก'],
  ['ดู Journey ของฉัน', 'ดูบันทึกของฉัน'],
  ['บันทึก Journey ที่วางแผนไว้', 'บันทึกแผนเที่ยวที่วางไว้'],
]);
for (const [oldCopy, newCopy] of thaiFallbackCopy) {
  html = html.replaceAll(oldCopy, newCopy);
}
// Keep the internal hotspot key in English so it continues to resolve the
// translated hotspot_journal_* strings. Only the visible/accessible copy is Thai.
html = html
  .replace('data-name="สมุดบันทึก" data-title="สมุดบันทึก"', 'data-name="Journal" data-title="สมุดบันทึก"')
  .replace('aria-label="Journal"', 'aria-label="สมุดบันทึก"');

html = html.replace(
  /<img id="fabAvatarImg"[^>]*>/u,
  '<img id="fabAvatarImg" src="assets/brand/characters/thongthai-portrait-master-4k.webp" width="4096" height="4096" alt="ทองไทย">',
);
html = html.replace(
  /<img id="headerAvatarImg"[^>]*>/u,
  '<img id="headerAvatarImg" src="assets/brand/characters/thongthai-portrait-master-4k.webp" width="4096" height="4096" alt="ทองไทย">',
);

// The original document embedded several multi-megabyte portraits directly in
// JavaScript. Apart from making the page unnecessarily heavy, one damaged
// base64 string can prevent every interaction on the page from initialising.
// Keep one current, externally cached Thongthai portrait for every chat state.
const avatarMapStart = html.indexOf('const THONGTHAI_CHAT_ICONS = {');
const avatarFunctionStart = html.indexOf('function avatarSrc', avatarMapStart);
if (avatarMapStart >= 0 && avatarFunctionStart >= 0) {
  const avatarFunctionEnd = html.indexOf('\n', avatarFunctionStart);
  const avatarBlock = `const THONGTHAI_CHAT_PORTRAIT = 'assets/brand/characters/thongthai-portrait-master-4k.webp';
function avatarSrc(){ return THONGTHAI_CHAT_PORTRAIT; }`;
  html = html.slice(0, avatarMapStart) + avatarBlock + html.slice(avatarFunctionEnd);
} else if (!html.includes('const THONGTHAI_CHAT_PORTRAIT =')) {
  throw new Error('Thongthai chat portrait block not found');
}

html = html.replace(
  /<img\s+src="data:image\/svg\+xml;base64,[^"]+"([^>]*\balt="ทำมา-ชาติ"[^>]*)>/gu,
  '<img src="assets/brand/logos/tamma-chat-logo.svg" width="1051" height="404"$1>',
);
fs.writeFileSync(file, html);
