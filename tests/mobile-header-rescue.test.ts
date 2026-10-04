import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(import.meta.dirname, '..');
const home = readFileSync(join(root, 'assets/styles/pre-worldwide-production.css'), 'utf8');
const mapCss = readFileSync(join(root, 'assets/styles/site-visual-system.css'), 'utf8');
const mapPageCss = readFileSync(join(root, 'assets/styles/otop-map.css'), 'utf8');
const mapHtml = readFileSync(join(root, 'otop-map.html'), 'utf8');
const headers = readFileSync(join(root, '_headers'), 'utf8');

test('mobile home header cannot resurrect or overlap the desktop planner CTA', () => {
  assert.match(home, /MOBILE HEADER COLLISION GUARD/);
  assert.match(home, /\.site-header\s+\.header-inner\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/s);
  assert.match(home, /\.site-header\s+\.hdr-cta\s*\{[^}]*display:\s*none\s*!important/s);
  assert.match(home, /\.site-header\s+\.header-actions\s*\{[^}]*justify-content:\s*flex-end/s);
});

test('mobile OTOP header has one brand row and one deterministic auth row', () => {
  assert.match(mapHtml, /<div class="map-header-actions">[\s\S]*?<div class="site-lang-picker">[\s\S]*?<nav class="account-nav"/);
  assert.match(mapCss, /\.site-page--map\s+\.map-header-actions\s*\{[^}]*display:\s*contents/s);
  assert.match(mapCss, /\.site-page--map\s+\.account-nav\s*\{[^}]*grid-row:\s*2[^}]*flex-wrap:\s*nowrap/s);
  assert.match(mapCss, /\.site-page--map\s+\.account-nav\s+\.account-link\s*\{[^}]*flex:\s*1\s+1\s+0[^}]*white-space:\s*normal/s);
});

test('mobile map heading remains readable at the 320px floor', () => {
  assert.match(mapPageCss, /\.map-card-head h1\s*\{[^}]*font-size:\s*clamp\(29px,\s*8\.4vw,\s*36px\)[^}]*line-height:\s*1\.25/s);
  assert.match(mapPageCss, /@media\s*\(max-width:\s*390px\)[\s\S]*?\.map-card-head h1\s*\{[^}]*font-size:\s*29px/s);
});

test('a fresh HTML deploy cannot be paired with stale responsive CSS', () => {
  assert.match(headers, /\/assets\/styles\/\*\n\s+Cache-Control: no-cache, max-age=0, must-revalidate/);
  assert.doesNotMatch(headers, /\/assets\/styles\/\*[\s\S]{0,120}stale-while-revalidate/);
  assert.match(mapHtml, /otop-map\.css\?v=20261004-mobile-rescue/);
  assert.match(mapHtml, /site-visual-system\.css\?v=20261004-mobile-rescue/);
});
