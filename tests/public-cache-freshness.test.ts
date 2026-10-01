import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const headers=readFileSync('_headers','utf8');
const mustRevalidate='Cache-Control: no-cache, max-age=0, must-revalidate';

test('public HTML and OTOP language assets cannot stay stale across deploys',()=>{
  for(const path of [
    '/',
    '/index.html',
    '/account.html',
    '/chess.html',
    '/menu.html',
    '/otop-map.html',
    '/otop.html',
    '/assets/scripts/otop-i18n.js',
    '/assets/scripts/otop-product-translations.js',
    '/assets/scripts/otop-province-translations.js',
  ]){
    const start=headers.indexOf(path+'\n');
    assert.ok(start>=0,`missing freshness header for ${path}`);
    assert.equal(headers.slice(start, start+180).includes(mustRevalidate),true,`missing no-cache policy for ${path}`);
  }
});
