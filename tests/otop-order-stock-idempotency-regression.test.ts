import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../netlify/functions/_operations-db.ts', import.meta.url), 'utf8');
const start = source.indexOf('export async function createOtopOrder');
const end = source.indexOf('\nexport async function authUserFromBearer', start);
const createOtopOrderSource = source.slice(start, end);

test('createOtopOrder relies on canonical item trigger for stock and never decrements stock twice', () => {
  assert.ok(start >= 0 && end > start);
  assert.match(createOtopOrderSource, /otop_order_items_stock_guard/);
  assert.doesNotMatch(createOtopOrderSource, /otop_products\?id=eq\.\$\{product\.id\}&stock_qty=eq/);
  assert.doesNotMatch(createOtopOrderSource, /stock_qty:\s*product\.stock_qty\s*-\s*quantity/);
});

test('createOtopOrder persists and replays checkout idempotency keys', () => {
  assert.match(createOtopOrderSource, /checkoutIdempotencyKey/);
  assert.match(createOtopOrderSource, /checkout_idempotency_key/);
  assert.match(createOtopOrderSource, /const replay = await loadReplay\(\)/);
});
