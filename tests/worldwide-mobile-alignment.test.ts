import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(import.meta.dirname, '..');
const visual = readFileSync(join(root, 'assets/styles/site-visual-system.css'), 'utf8');
const home = readFileSync(join(root, 'assets/styles/pre-worldwide-production.css'), 'utf8');
const mapHtml = readFileSync(join(root, 'otop-map.html'), 'utf8');
const otopI18n = readFileSync(join(root, 'assets/scripts/otop-i18n.js'), 'utf8');
const firstWave = readFileSync(join(root, 'assets/scripts/first-wave-language-packs.js'), 'utf8');

test('all public mobile surfaces use one 20px logical content rail', () => {
  assert.match(visual, /WORLDWIDE MOBILE ALIGNMENT LOCK/);
  assert.match(visual, /--site-gutter:\s*20px/);
  assert.match(visual, /text-align:\s*start/);
  assert.match(visual, /padding-inline:\s*var\(--site-gutter\)/);

  for (const page of ['map', 'store', 'menu', 'account', 'chess']) {
    assert.match(visual, new RegExp(`\\.site-page--${page}`));
  }

  assert.match(home, /--site-mobile-gutter:\s*20px/);
  assert.match(home, /padding-inline:\s*var\(--site-mobile-gutter\)/);
});

test('mobile map header and content resolve to the same logical start edge', () => {
  assert.match(visual, /\.site-page--map\s+\.brand-lockup\s*\{[^}]*justify-self:\s*start/s);
  assert.match(visual, /\.site-page--map\s+\.account-nav\s*\{[^}]*justify-content:\s*flex-start/s);
  assert.match(visual, /\.site-page--map\s+\.map-legend\s*\{[^}]*justify-content:\s*flex-start/s);
  assert.match(visual, /\.site-page--map\s+\.province-index,[^}]*\.map-footer\s*\{[^}]*padding-inline:\s*var\(--site-gutter\)/s);
});

test('translated mobile hero copy never switches between centered and edge alignment', () => {
  assert.match(visual, /\.site-page--menu\s+\.hero\s*\{[^}]*text-align:\s*start/s);
  assert.match(visual, /\.site-page--chess\s+\.tt-chess-hero\s*\{[^}]*text-align:\s*start/s);
  assert.match(visual, /\.site-page--store\s+\.showcaseNote\s*\{[^}]*text-align:\s*start/s);
  assert.match(visual, /\.site-page--account\s+:where\(\.hero,\s*\.panel\)\s*\{[^}]*text-align:\s*start/s);
});

test('OTOP map title and metadata follow all seven site languages', () => {
  assert.match(mapHtml, /data-otop-i18n-content="map_meta_desc"/);
  assert.match(otopI18n, /document\.title\s*=\s*t\('map_page_title'\)/);
  assert.match(otopI18n, /\[data-otop-i18n-content\]/);
  assert.equal((otopI18n.match(/map_page_title:/g) || []).length, 5);
  assert.equal((firstWave.match(/"map_page_title"/g) || []).length, 2);
});
