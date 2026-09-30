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
  '<img src="assets/brand/backgrounds/inthanin-tadtone-boutique-grade-1536.webp" width="1536" height="1152" loading="lazy" decoding="async" alt="ร้านอินทนิล สาขาตาดโตน ณ ทำมา-ชาติ">',
);
replaceImageByAlt(
  'ผังพื้นที่ทำมา-ชาติจากมุมสูง แสดงจุดเชื่อมโยงประสบการณ์ต่าง ๆ',
  '<img src="assets/brand/backgrounds/ecosystem-aerial-1920.webp" width="1920" height="1080" loading="lazy" decoding="async" alt="ภาพมุมสูงของพื้นที่ทำมา-ชาติและเส้นทางรอบบึง">',
);
replaceImageByAlt(
  'สมุดบันทึกวางอยู่บนโต๊ะไม้ริมสระน้ำยามเย็น',
  '<img src="assets/brand/backgrounds/hero-lakeside-1920.webp" width="1920" height="1080" loading="lazy" decoding="async" alt="บ้านพักริมน้ำยามเย็นสำหรับเขียนบันทึกการเดินทาง">',
);
replaceImageByAlt(
  'มุมต้อนรับอบอุ่นภายในทำมา-ชาติ เฮือนสเตย์',
  '<img src="assets/brand/backgrounds/rewards-pavilion-1920.webp" width="1920" height="1080" loading="lazy" decoding="async" alt="ศาลากลางสวนสำหรับแขกที่กลับมาเยือนทำมา-ชาติ">',
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
if (communityStart < 0 || communityActions < 0) {
  throw new Error('Community asset block not found');
}

const communityBlock = `    <div class="community-map-gateway fade-up">
      <article class="community-feature community-story-feature">
        <div class="community-feature-media">
          <img class="community-feature-bg" src="assets/brand/backgrounds/ban-khwao-silk-weaving-real.jpg" width="640" height="427" loading="lazy" decoding="async" alt="ช่างทอผ้าไหมบ้านเขว้ากำลังทอผ้าบนกี่">
          <span class="community-photo-credit">ภาพการผลิตจริง · Nation Photo</span>
        </div>
        <div class="community-feature-copy">
          <img class="community-feature-logo" src="assets/brand/logos/otop-logo-brown-1024.webp" width="1024" height="1024" loading="lazy" decoding="async" alt="OTOP">
          <div class="card-kicker">ของดีชัยภูมิ · บ้านเขว้า</div>
          <h3>ผ้าไหมบ้านเขว้า งานฝีมือที่ยังทอจริง</h3>
          <p>ชาวบ้านเขว้าสืบทอดการทอผ้าไหมมัดหมี่มาเกือบ 200 ปี ตั้งแต่การสาวไหม มัดลาย ย้อมสี จนถึงทอด้วยกี่ทีละเส้น ลายหมี่คั่นขอนารีจึงไม่ใช่แค่ลวดลายสวยงาม แต่เป็นฝีมือและเรื่องราวของคนชัยภูมิที่อยู่ในผ้าทุกผืน</p>
          <div class="community-map-actions">
            <a class="btn btn-primary community-map-launch" href="otop-map.html">เปิดแผนที่ของดีอีสาน</a>
            <a class="btn btn-outline" href="otop.html">ดูสินค้า OTOP ชัยภูมิ</a>
          </div>
        </div>
      </article>
    </div>
    <div class="community-grid fade-up" id="communityGrid" aria-live="polite"></div>
`;

html = html.slice(0, communityStart) + communityBlock + html.slice(communityActions);

const chessArt = `      <div class="tt-chess-home-art" aria-hidden="true">
        <img class="tt-chess-home-board" src="assets/chess/derived/A01_chessboard_full.webp" width="1024" height="1024" loading="lazy" decoding="async" alt="">
        <img class="tt-chess-home-character" src="assets/thongthai/thongthai-default.webp" width="512" height="512" loading="lazy" decoding="async" alt="">
      </div>`;
html = html.replace(
  /      <div class="tt-chess-home-art"[^>]*>[\s\S]*?<\/div>\s*(?:<div class="tt-chess-winner-pass">[\s\S]*?<\/div>)?/u,
  chessArt,
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
  ['Inthanin', 'กาแฟ Inthanin'],
  ['Reception', 'ต้อนรับ'],
  ['Dining', 'ร้านอาหาร'],
  ['Stay', 'บ้านพัก'],
  ['Adventure', 'กิจกรรม'],
  ['Journal', 'สมุดบันทึก'],
  ['Rewards', 'สิทธิพิเศษ'],
]);
for (const [oldLabel, newLabel] of hotspotLabels) {
  html = html.replace(`<span class="hotspot-label">${oldLabel}</span>`, `<span class="hotspot-label">${newLabel}</span>`);
}

html = html.replace(
  /<img id="fabAvatarImg"[^>]*>/u,
  '<img id="fabAvatarImg" src="assets/brand/logos/tamma-chat-logo.svg" width="1051" height="404" alt="ทำมา-ชาติ">',
);
html = html.replace(
  /<img id="headerAvatarImg"[^>]*>/u,
  '<img id="headerAvatarImg" src="assets/brand/logos/tamma-chat-logo.svg" width="1051" height="404" alt="ทำมา-ชาติ">',
);
html = html.replace(
  /function avatarSrc\(state\)\{ return THONGTHAI_CHAT_ICONS\[state\] \|\| THONGTHAI_CHAT_ICONS\.default; \}/u,
  "function avatarSrc(){ return 'assets/brand/logos/tamma-chat-logo.svg'; }",
);

html = html.replace(
  /<img\s+src="data:image\/svg\+xml;base64,[^"]+"([^>]*\balt="ทำมา-ชาติ"[^>]*)>/gu,
  '<img src="assets/brand/logos/tamma-chat-logo.svg" width="1051" height="404"$1>',
);
fs.writeFileSync(file, html);
