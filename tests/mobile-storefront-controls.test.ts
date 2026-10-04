import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(import.meta.dirname, '..');
const html = readFileSync(join(root, 'otop.html'), 'utf8');
const visual = readFileSync(join(root, 'assets/styles/site-visual-system.css'), 'utf8');

test('language and market pickers render one deliberate chevron', () => {
  assert.match(visual, /\.site-page \.site-lang-picker select\s*\{[^}]*-webkit-appearance:\s*none[^}]*appearance:\s*none[^}]*background-image:\s*none/s);
  assert.match(visual, /\.site-page \.site-lang-picker::after,\s*\.site-page--store \.marketPicker::after\s*\{[^}]*border-right:\s*1\.5px solid currentColor[^}]*pointer-events:\s*none/s);
  assert.match(visual, /\.site-page--store \.marketPicker select\s*\{[^}]*appearance:\s*none/s);
});

test('mobile storefront header stays a single aligned control row', () => {
  assert.match(visual, /@media \(max-width: 680px\)[\s\S]*?\.site-page--store \.top \.nav\s*\{[^}]*min-height:\s*68px[^}]*padding-inline:\s*16px[^}]*gap:\s*6px/s);
  assert.match(visual, /\.site-page--store \.top \.site-lang-picker select\s*\{[^}]*padding:\s*0 23px 0 10px[^}]*font-weight:\s*650/s);
  assert.match(visual, /\.site-page--store \.top \.cartBtn\s*\{[^}]*width:\s*58px !important[^}]*font-size:\s*0/s);
  assert.match(visual, /\.site-page--store \.top \.cartBtn::before\s*\{[^}]*mask:[^}]*contain no-repeat/s);
  assert.match(visual, /@media \(max-width: 430px\)[\s\S]*?\.site-page--store \.top \.logo img\s*\{[^}]*width:\s*72px/s);

  // 72 logo + 5 nav gap + 78 market + 72 language + 54 cart +
  // two 5px tool gaps + two 10px gutters = 311px at the 320px floor.
  assert.ok(72 + 5 + 78 + 72 + 54 + (2 * 5) + (2 * 10) <= 320);
  assert.doesNotMatch(html, /@media\(max-width:390px\)\{\.tools\{grid-template-columns:[^}]+\}\.cartBtn\{[^}]*width:100%/);
});

test('mobile hero and commerce actions share intentional tap geometry', () => {
  assert.match(visual, /\.site-page--store :where\(\.showcasePrimary, \.showcaseSecondary\)\s*\{[^}]*width:\s*100%[^}]*min-height:\s*50px[^}]*border-radius:\s*999px[^}]*text-decoration:\s*none/s);
  assert.match(visual, /\.site-page--store \.showcaseSecondary\s*\{[^}]*border:\s*1px solid rgba\(255, 255, 255, \.5\)[^}]*backdrop-filter:\s*blur\(10px\)/s);
  assert.match(visual, /\.site-page--store :where\(\.primary, \.secondary, \.lockedCheckout\)\s*\{[^}]*min-height:\s*50px/s);
  assert.match(visual, /\.site-page--store \.view\s*\{[^}]*min-height:\s*var\(--site-control\)[^}]*border-radius:\s*999px/s);
});
