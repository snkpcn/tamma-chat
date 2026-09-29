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
          <img class="community-feature-character" src="assets/brand/characters/thongthai-otop-2048.webp" width="2048" height="2048" loading="lazy" decoding="async" alt="">
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
fs.writeFileSync(file, html);
