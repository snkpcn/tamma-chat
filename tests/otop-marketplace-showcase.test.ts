import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../otop.html', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../assets/brand/otop/hero/hero-video-manifest.json', import.meta.url), 'utf8'));

test('OTOP marketplace opens with the locked owner-selected hero film', () => {
  assert.ok(html.includes('id="showcase"'));
  assert.ok(html.includes('id="showcaseVideo"'));
  assert.ok(html.includes('min-height:100svh'));
  assert.ok(html.includes(manifest.variants.desktop.url));
  assert.ok(html.includes(manifest.variants.mobile.url));
  assert.equal(manifest.policy.contentLocked, true);
  assert.equal(manifest.policy.allowRegeneration, false);
  assert.equal(manifest.variants.desktop.durationSeconds, manifest.source.durationSeconds);
  assert.equal(manifest.variants.mobile.durationSeconds, manifest.source.durationSeconds);
});

test('showcase respects reduced motion and has a non-video fallback', () => {
  assert.ok(html.includes(manifest.poster.url));
  assert.ok(html.includes('prefers-reduced-motion:reduce'));
  assert.ok(html.includes("const reduce=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches"));
});

test('mobile commerce keeps imagery dominant and removes the two-row hero navigation', () => {
  assert.ok(html.includes('.nav{display:flex;align-items:center;padding:9px 14px;min-height:56px'));
  assert.ok(html.includes('.provinceField,.searchField{display:none}'));
  assert.ok(html.includes('.categoryGrid{grid-template-columns:1fr;gap:34px}'));
  assert.ok(html.includes('.categoryGrid .featureCard .photo,.categoryGrid .card:not(.featureCard) .photo{aspect-ratio:1/1'));
});

test('product media is full-screen and thumbnails no longer overlay the image', () => {
  assert.ok(html.includes('.productPanel{position:absolute;inset:0;width:100%;height:100%;max-height:none'));
  assert.ok(html.includes('.detailMain>img.productImg{width:100%;height:100%;object-fit:contain}'));
  assert.ok(html.includes('.detailThumbs{position:static;'));
  assert.ok(html.includes('.detailMedia{height:88dvh;min-height:620px'));
});

test('product detail remains story-first after showcase redesign', () => {
  assert.ok(html.includes("tr('product_story')"));
  assert.ok(html.includes("tr('value_piece')"));
  assert.ok(html.includes("item(tr('process'),s.craftProcess,true)"));
  assert.ok(html.includes("item(tr('why_here'),s.whyHere,true)"));
});

test('luxury commerce hotfix adds smart header, merchandising rail and localized distinct categories', () => {
  assert.ok(html.includes('function initSmartHeader()'));
  assert.ok(html.includes("header.classList.add('is-hidden')"));
  assert.ok(html.includes('id="merchRail"'));
  assert.ok(html.includes("tr('curated')"));
  assert.ok(html.includes("titleKey:'category_wear'"));
  assert.ok(html.includes("titleKey:'category_food'"));
  assert.ok(html.includes("titleKey:'category_home'"));
  assert.ok(html.includes('Number(p.completedUnits||0)>0'));
});

test('Thai typography uses the locked sitewide IBM Plex Sans Thai family without display-font drift', () => {
  assert.ok(html.includes('assets/styles/site-typography.css'));
  assert.ok(html.includes('--font-display:var(--site-font-th)'));
  assert.ok(html.includes('--font-body:var(--site-font-th)'));
  assert.equal(html.includes('Noto Serif Thai'), false);
  assert.equal(html.includes('font-family:Georgia'), false);
  assert.ok(html.includes("tr('curated')"));
});

test('cart header may hide over the hero but remains pinned once commerce begins', () => {
  assert.ok(html.includes("header.classList.toggle('is-commerce',!overHero)"));
  assert.ok(html.includes("if(overHero){"));
  assert.ok(html.includes("else{header.classList.remove('is-hidden')}"));
  assert.ok(html.includes('.top.is-commerce'));
  assert.ok(html.includes('id="cartBtn"'));
});

test('hero gives restrained credit to the original film source and featured silk craft', () => {
  assert.ok(html.includes('@banklocalwisdom9238'));
  assert.ok(html.includes('https://youtu.be/v3hPPvDiGzM?si=ZOkUb-QSdnANjAbI'));
  assert.ok(html.includes('ศูนย์ส่งเสริมผ้าไหม จ.ชัยภูมิ'));
  assert.ok(html.includes('.showcaseNote a{'));
  assert.ok(html.includes('font-size:8px'));
});
