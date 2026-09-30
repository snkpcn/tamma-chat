import fs from 'node:fs';

const file = new URL('../index.html', import.meta.url);
let html = fs.readFileSync(file, 'utf8');

if (!html.includes('class="isan-boutique"')) {
  html = html.replace('<html lang="th">', '<html lang="th" class="isan-boutique">');
}

const stylesheet = '<link rel="stylesheet" href="assets/styles/isan-boutique-phase1.css">';
if (!html.includes(stylesheet)) {
  html = html.replace('</head>', `${stylesheet}\n</head>`);
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
      <img src="assets/brand/backgrounds/hero-aerial-estate-1920.webp" width="1920" height="1080" fetchpriority="high" decoding="async" alt="ภาพมุมสูงของทำมา-ชาติและภูมิทัศน์อีสานยามเย็น">
    </picture>
  </div>
  <div class="hero-character" aria-hidden="true">
    <img src="assets/brand/characters/thongthai-welcome-2048.webp" width="2048" height="2048" decoding="async" alt="">
  </div>
`;

html = html.slice(0, heroStart) + assetBlock + html.slice(heroInner);

replaceImageByAlt(
  'ตำมา-ชาติ พื้นที่รับประทานอาหารกลางแจ้งยามพลบค่ำ',
  '<img src="assets/brand/backgrounds/dining-restaurant-1920.webp" width="1920" height="1080" loading="lazy" decoding="async" alt="ตำมา-ชาติ พื้นที่รับประทานอาหารกลางแจ้งยามพลบค่ำ">',
);
replaceImageByAlt(
  'ทำมา-ชาติ เฮือนสเตย์ เรือนพักริมน้ำยามเย็น',
  '<img src="assets/brand/backgrounds/stay-guest-room-1920.webp" width="1920" height="1080" loading="lazy" decoding="async" alt="ทำมา-ชาติ เฮือนสเตย์ ห้องพักที่อบอุ่นและสงบ">',
);
replaceImageByAlt(
  'ทำมา-ชาติ ผจญภัย เส้นทางเดินชมท้องทุ่งยามเช้า',
  '<img src="assets/brand/backgrounds/adventure-garden-1920.webp" width="1920" height="1080" loading="lazy" decoding="async" alt="ทำมา-ชาติ ผจญภัย พื้นที่กลางแจ้งและสวนอีสาน">',
);
replaceImageByAlt(
  'ร้านอินทนิลคอฟฟี่ ณ ทำมา-ชาติ ยามพลบค่ำ',
  '<img src="assets/brand/backgrounds/inthanin-tadtone-real-1536.webp" width="1536" height="1152" loading="lazy" decoding="async" alt="ร้านอินทนิล สาขาตาดโตน ณ ทำมา-ชาติ">',
);
replaceImageByAlt(
  'ผังพื้นที่ทำมา-ชาติจากมุมสูง แสดงจุดเชื่อมโยงประสบการณ์ต่าง ๆ',
  '<img src="assets/brand/backgrounds/ecosystem-aerial-1920.webp" width="1920" height="1080" loading="lazy" decoding="async" alt="ภาพมุมสูงของพื้นที่ทำมา-ชาติและเส้นทางรอบบึง">',
);
replaceImageByAlt(
  'ทองไทยกำลังชี้แนะเส้นทาง Journey',
  '<img src="assets/brand/characters/thongthai-map-guide-2048.webp" width="2048" height="2048" loading="lazy" decoding="async" alt="ทองไทยกำลังชี้แนะเส้นทาง Journey">',
);
replaceImageByAlt(
  'สมุดบันทึกวางอยู่บนโต๊ะไม้ริมสระน้ำยามเย็น',
  '<img src="assets/brand/backgrounds/hero-lakeside-1920.webp" width="1920" height="1080" loading="lazy" decoding="async" alt="บ้านพักริมน้ำยามเย็นสำหรับบันทึก Journey">',
);
replaceImageByAlt(
  'ทองไทยกำลังจดบันทึกลงสมุด Journey',
  '<img src="assets/brand/characters/thongthai-thinking-2048.webp" width="2048" height="2048" loading="lazy" decoding="async" alt="ทองไทยกำลังช่วยคิดและบันทึก Journey">',
);
replaceImageByAlt(
  'มุมต้อนรับอบอุ่นภายในทำมา-ชาติ เฮือนสเตย์',
  '<img src="assets/brand/backgrounds/rewards-pavilion-1920.webp" width="1920" height="1080" loading="lazy" decoding="async" alt="ศาลากลางสวนสำหรับแขกที่กลับมาเยือนทำมา-ชาติ">',
);
replaceImageByAlt(
  'ทองไทยถือของขวัญต้อนรับ',
  '<img src="assets/brand/characters/thongthai-wai-2048.webp" width="2048" height="2048" loading="lazy" decoding="async" alt="ทองไทยไหว้ต้อนรับแขกที่กลับมาเยือน">',
);

const communityStart = html.indexOf('    <div class="community-grid fade-up" id="communityGrid">');
const communityActions = html.indexOf('    <div class="community-actions fade-up">', communityStart);
if (communityStart < 0 || communityActions < 0) {
  throw new Error('Community asset block not found');
}

const communityBlock = `    <div class="community-grid fade-up" id="communityGrid">
      <div class="community-card community-empty-state community-feature" id="communityEmptyState">
        <div class="community-feature-media" aria-hidden="true">
          <img class="community-feature-bg" src="assets/brand/backgrounds/otop-craft-shop-1920.webp" width="1920" height="1080" loading="lazy" decoding="async" alt="">
        </div>
        <div class="community-feature-copy">
          <img class="community-feature-logo" src="assets/brand/logos/otop-logo-brown-1024.webp" width="1024" height="1024" loading="lazy" decoding="async" alt="OTOP">
          <div class="card-kicker" data-i18n="otop_empty_kicker">Verified community catalog</div>
          <h3 data-i18n="otop_empty_heading">กำลังเตรียมเรื่องราวจากชุมชน</h3>
          <p data-i18n="otop_empty_body">ขณะนี้ยังไม่มีสินค้า OTOP หรือกิจกรรมชุมชนที่ผ่านการยืนยันและเปิดใช้งานในระบบ รายการจะแสดงเมื่อมีข้อมูลจริงเท่านั้น</p>
        </div>
      </div>
    </div>
`;

html = html.slice(0, communityStart) + communityBlock + html.slice(communityActions);

const chessArt = `      <div class="tt-chess-home-art" aria-hidden="true">
        <img class="tt-chess-home-character" src="assets/brand/characters/thongthai-portrait-master-4k.webp" width="4096" height="4096" loading="lazy" decoding="async" alt="">
      </div>
      <div class="tt-chess-winner-pass">
        <img src="assets/chess/derived/A10_winner_pass_frame.webp" alt="Winner Pass">
      </div>`;
if (!html.includes('tt-chess-home-character')) {
  html = html.replace(
    /      <div class="tt-chess-home-art">\s*<img src="assets\/chess\/derived\/A10_winner_pass_frame\.webp" alt="Winner Pass">\s*<\/div>/u,
    chessArt,
  );
}

const journalIcon = `<div class="jf-icon-wrap" data-step="remember"><span class="jf-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v17H6.5A2.5 2.5 0 0 0 4 22V5.5Z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v17h4.5A2.5 2.5 0 0 1 20 22V5.5Z"/><path d="m15.2 14.8 3.9-3.9 1.4 1.4-3.9 3.9-2 .6.6-2Z"/></svg></span><span class="jf-num-badge"><span class="jf-num-digit">4</span><svg class="jf-num-mark" viewBox="0 0 24 24" fill="none" stroke="#F7F1E4" stroke-width="2.6" stroke-linecap="round"><path d="M7 5v6a5 5 0 0 0 10 0V5"/></svg></span></div>`;
html = html.replace(/<div class="jf-icon-wrap" data-step="remember">[^\n]+<\/div>/u, journalIcon);

const thaiJourneyLabels = new Map([
  ['flow_s1_t', 'ต้อนรับ'],
  ['flow_s2_t', 'ค้นพบ'],
  ['flow_s3_t', 'สัมผัสอีสาน'],
  ['flow_s4_t', 'บันทึกเรื่องราว'],
  ['flow_s5_t', 'สิทธิพิเศษ'],
  ['flow_s6_t', 'กลับมาเยือน'],
]);
for (const [key, label] of thaiJourneyLabels) {
  html = html.replace(new RegExp(`(<h4 data-i18n="${key}">)[^<]+(</h4>)`, 'u'), `$1${label}$2`);
  html = html.replace(new RegExp(`(${key}:)"[^"]+"`, 'u'), `$1"${label}"`);
}

const hotspotLabels = new Map([
  ['Inthanin', 'กาแฟ Inthanin'],
  ['Reception', 'ต้อนรับ'],
  ['Dining', 'ร้านอาหาร'],
  ['Stay', 'บ้านพัก'],
  ['Adventure', 'กิจกรรม'],
  ['Journal', 'สมุด Journey'],
  ['Rewards', 'สิทธิพิเศษ'],
]);
for (const [oldLabel, newLabel] of hotspotLabels) {
  html = html.replace(`<span class="hotspot-label">${oldLabel}</span>`, `<span class="hotspot-label">${newLabel}</span>`);
}

html = html.replace(
  /<img id="fabAvatarImg"[^>]*>/u,
  '<img id="fabAvatarImg" src="assets/brand/characters/thongthai-portrait-master-4k.webp" width="4096" height="4096" alt="ทองไทย">',
);
html = html.replace(
  /<img id="headerAvatarImg"[^>]*>/u,
  '<img id="headerAvatarImg" src="assets/brand/characters/thongthai-portrait-master-4k.webp" width="4096" height="4096" alt="ทองไทย">',
);
html = html.replace(
  /function avatarSrc\(state\)\{ return THONGTHAI_CHAT_ICONS\[state\] \|\| THONGTHAI_CHAT_ICONS\.default; \}/u,
  "function avatarSrc(){ return 'assets/brand/characters/thongthai-portrait-master-4k.webp'; }",
);
fs.writeFileSync(file, html);
