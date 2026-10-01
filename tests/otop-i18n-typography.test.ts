import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PUBLIC_PAGES = [
  'index.html',
  'account.html',
  'chess.html',
  'menu.html',
  'otop-map.html',
  'otop.html',
];

test('all public pages use the shared sitewide typography lock', () => {
  for (const path of PUBLIC_PAGES) {
    const html = readFileSync(path, 'utf8');
    assert.match(html, /assets\/styles\/site-typography\.css/, path);
    assert.doesNotMatch(html, /Noto Serif|Georgia|Segoe UI|BlinkMacSystemFont|font-family:\s*-apple-system/i, path);
  }

  const css = readFileSync('assets/styles/site-typography.css', 'utf8');
  assert.match(css, /--site-font-th:"IBM Plex Sans Thai"/);
  assert.match(css, /--site-font-latin:"Noto Sans"/);
  assert.match(css, /html\[lang="th"\]/);
  assert.match(css, /html\[lang="en"\],html\[lang="vi"\]/);
  assert.match(css, /html\[lang="zh"\]/);
  assert.match(css, /html\[lang="lo"\]/);
});

test('OTOP map and store share the same five-language preference as the homepage', () => {
  const runtime = readFileSync('assets/scripts/otop-i18n.js', 'utf8');
  const mapHtml = readFileSync('otop-map.html', 'utf8');
  const storeHtml = readFileSync('otop.html', 'utf8');
  const mapScript = readFileSync('assets/scripts/otop-map.js', 'utf8');

  assert.match(runtime, /thammachat-lang-v1/);
  assert.match(runtime, /\['th','en','zh','lo','vi'\]/);
  assert.match(runtime, /provinceIds:Object\.keys\(PROVINCES_TH\)/);
  assert.match(mapHtml, /assets\/scripts\/otop-i18n\.js/);
  assert.match(storeHtml, /assets\/scripts\/otop-i18n\.js/);
  assert.match(mapScript, /mountSwitcher/);
  assert.match(storeHtml, /mountSwitcher/);
  assert.match(storeHtml, /I18N\.onChange/);
});

test('OTOP five-language runtime contains all supported language dictionaries', () => {
  const runtime = readFileSync('assets/scripts/otop-i18n.js', 'utf8');
  for (const lang of ['th', 'en', 'zh', 'lo', 'vi']) {
    assert.match(runtime, new RegExp('\\n    ' + lang + ':\\{'), lang);
  }
});
