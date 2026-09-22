// PRIORITY 5 (owner-specified, docs+tests only, no production DB
// mutation): restaurant preorder staff notification currently differs
// from booking/otop_order/cafe_inquiry, which all fire via a genuine DB
// trigger (booking_allocations/otop_order_items/cafe_inquiries INSERT ->
// enqueue_tamma_ops_notification() -> net.http_post to this endpoint --
// verified directly against the live tamma-customer-data schema with
// read-only SQL, see THONGTHAI_HANDOFF.md's Priority 5 section for the
// exact queries and the prepared-but-not-applied migration). Restaurant
// preorders instead notify via an inline call
// (_restaurant-sot.ts's createRestaurantPreorder calling
// notifyRestaurantPreorderTeam directly) with no DB trigger, so a
// restaurant_preorders row created any other way gets no automatic staff
// notification.
//
// This test proves the SAFE, forward-compatible half of closing that gap:
// ops-notify.ts (the endpoint the DB trigger will eventually call) now
// accepts entity='restaurant_preorder' and routes it to the EXISTING
// notifyRestaurantPreorderTeam (reused, never re-implemented), so the
// endpoint is ready before the migration lands. Nothing currently calls
// it with this entity in production (no trigger exists yet), so this is
// safe, inert-until-migrated preparation, not a behavior change to any
// live path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handler } from '../netlify/functions/ops-notify';

const PREORDER_ID = '55555555-5555-4555-8555-555555555555';

test('ops-notify.ts source: restaurant_preorder is wired to the EXISTING notifyRestaurantPreorderTeam, never a second implementation', () => {
  const source = readFileSync('netlify/functions/ops-notify.ts', 'utf8');
  assert.match(source, /import\s*\{\s*notifyRestaurantPreorderTeam\s*\}\s*from\s*'\.\/_restaurant-sot'/);
  assert.match(source, /restaurant_preorder/);
  assert.match(source, /notifyRestaurantPreorderTeam\(body\.id\)/);
});

test('the webhook secret gate still rejects an unauthorized caller, regardless of entity (the secret is an opaque hash with no test-known plaintext, so this is as far as a request can be driven without it -- entity-routing correctness is instead proven structurally above)', async () => {
  const result = await handler({
    httpMethod: 'POST',
    headers: { 'x-ops-notification-secret': 'definitely-the-wrong-secret' },
    body: JSON.stringify({ entity: 'restaurant_preorder', id: PREORDER_ID }),
  } as never, {} as never, undefined as never);
  assert.equal((result as { statusCode: number }).statusCode, 401, 'the secret check must run before entity routing is ever reached');
});
