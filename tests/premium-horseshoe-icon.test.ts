import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(import.meta.dirname, '..');
const home = readFileSync(join(root, 'index.html'), 'utf8');
const icon = readFileSync(join(root, 'assets/icons/horseshoe-premium.svg'), 'utf8');

test('active planner choices use the premium horseshoe asset instead of a U glyph', () => {
  assert.match(home, /\.p-opt\.is-on::before\s*\{[^}]*width:\s*18px[^}]*height:\s*18px/s);
  assert.match(home, /background-image:url\("assets\/icons\/horseshoe-premium\.svg"\)/);
  assert.doesNotMatch(home, /\.p-opt\.is-on::before[\s\S]{0,400}M7 5v6a5 5 0 0 0 10 0V5/);
});

test('horseshoe has a forged silhouette and six restrained nail holes', () => {
  assert.match(icon, /viewBox="0 0 24 24"/);
  assert.match(icon, /fill-rule="evenodd"/);
  assert.match(icon, /C3\.08 5\.22 2\.55 7\.9 2\.55 10\.7/);
  assert.equal((icon.match(/\.83\.83 0 1 0/g) || []).length, 6);
});
