import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(import.meta.dirname, '..');
const visualStylesheet = 'assets/styles/site-visual-system.css';
const pages = [
  ['otop-map.html', 'site-page--map'],
  ['otop.html', 'site-page--store'],
  ['menu.html', 'site-page--menu'],
  ['account.html', 'site-page--account'],
  ['chess.html', 'site-page--chess'],
] as const;

function source(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

test('every public surface loads the final visual system last', () => {
  for (const [page, pageClass] of pages) {
    const html = source(page);
    const stylesheets = [...html.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"/g)]
      .map((match) => match[1]);

    assert.equal(stylesheets.at(-1), visualStylesheet, `${page} must load the visual system last`);
    assert.match(html, new RegExp(`<body[^>]*class="[^"]*site-page[^"]*${pageClass}`));
  }

  const home = source('index.html');
  const homeStylesheets = [...home.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"/g)]
    .map((match) => match[1]);
  assert.equal(homeStylesheets.at(-1), 'assets/styles/pre-worldwide-production.css');
  assert.match(source('assets/styles/pre-worldwide-production.css'), /SITEWIDE HOME VISUAL AUDIT/);
});

test('visual system locks shared controls, focus and responsive behavior', () => {
  const css = source(visualStylesheet);

  assert.match(css, /--site-control:\s*44px/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /overflow-x:\s*clip/);
  assert.match(css, /@media\s*\(max-width:\s*680px\)/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);

  for (const pageClass of ['site-page--home', ...pages.map(([, pageClass]) => pageClass)]) {
    assert.match(css, new RegExp(`\\.${pageClass.replaceAll('-', '\\-')}`));
  }
});

test('long Japanese, Korean and Lao labels wrap safely', () => {
  const css = source(visualStylesheet);

  for (const lang of ['ja', 'ko', 'lo']) {
    assert.match(css, new RegExp(`html\\[lang="${lang}"\\]`));
  }
  assert.match(css, /overflow-wrap:\s*anywhere/);
});

test('new navigation icons are decorative and stale reward styling is gone', () => {
  for (const page of ['menu.html', 'account.html']) {
    const html = source(page);
    const svgs = [...html.matchAll(/<svg\b[^>]*>/g)].map((match) => match[0]);
    assert.ok(svgs.length > 0, `${page} should include an icon`);
    assert.ok(svgs.every((svg) => svg.includes('aria-hidden="true"')));
  }

  assert.doesNotMatch(source('assets/styles/isan-final-repair.css'), /tt-chess-winner-pass/);
});
