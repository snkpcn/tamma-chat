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

const heroStart = html.indexOf('  <div class="hero-bg">');
const heroInner = html.indexOf('  <div class="hero-inner container">', heroStart);
if (heroStart < 0 || heroInner < 0) {
  throw new Error('Hero asset block not found');
}

const assetBlock = `  <div class="hero-bg">
    <picture>
      <source srcset="assets/brand/backgrounds/hero-lakeside-1920.avif" type="image/avif">
      <img src="assets/brand/backgrounds/hero-lakeside-1920.webp" width="1920" height="1080" fetchpriority="high" decoding="async" alt="บรรยากาศชนบทอีสานริมน้ำยามเย็น">
    </picture>
  </div>
  <div class="hero-character" aria-hidden="true">
    <img src="assets/brand/characters/thongthai-welcome-2048.webp" width="2048" height="2048" decoding="async" alt="">
  </div>
`;

html = html.slice(0, heroStart) + assetBlock + html.slice(heroInner);
fs.writeFileSync(file, html);
