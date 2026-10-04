import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const home = readFileSync(join(import.meta.dirname, '..', 'index.html'), 'utf8');

test('Thongthai portraits follow the round concierge geometry everywhere', () => {
  assert.match(home, /\.ca-box\s*\{[^}]*border-radius:\s*50%/s);
  assert.match(home, /\.ca-box-launcher\s*\{[^}]*border-radius:\s*50%/s);
  assert.match(home, /\.ca-box-header\s*\{[^}]*border-radius:\s*50%/s);
  assert.match(home, /\.ca-box-msg\s*\{[^}]*border-radius:\s*50%/s);
  assert.doesNotMatch(home, /never a circle/);
});

test('launcher and chat header retain a restrained premium portrait rim', () => {
  assert.match(home, /\.ca-box-launcher\s*\{[^}]*box-shadow:\s*0 0 0 2px rgba\(253,251,246,\.9\)/s);
  assert.match(home, /\.ca-box-header\s*\{[^}]*box-shadow:\s*0 0 0 2px rgba\(253,251,246,\.9\)/s);
  assert.match(home, /\.ca-box\s*\{[^}]*border:\s*1px solid rgba\(156,122,69,\.28\)/s);
});
