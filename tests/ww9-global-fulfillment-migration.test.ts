import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL('../supabase/migrations/20261003074400_ww9_global_fulfillment_tracking.sql',import.meta.url),'utf8');

test('WW-9 migration creates provider-neutral booking, packages, immutable tracking, notification outbox, and returns',()=>{
  for(const table of [
    'commerce_fulfillment_shipments',
    'commerce_fulfillment_packages',
    'commerce_fulfillment_tracking_events',
    'commerce_fulfillment_notification_outbox',
    'commerce_return_policies',
    'commerce_return_requests',
  ]) assert.equal(sql.includes('create table if not exists public.'+table),true);
});

test('WW-9 is service-role only with RLS and no carrier or foreign return policy seed',()=>{
  for(const table of [
    'commerce_fulfillment_shipments',
    'commerce_fulfillment_packages',
    'commerce_fulfillment_tracking_events',
    'commerce_fulfillment_notification_outbox',
    'commerce_return_policies',
    'commerce_return_requests',
  ]){
    assert.equal(sql.includes('alter table public.'+table+' enable row level security'),true);
    assert.equal(sql.includes('revoke all on table public.'+table+' from public,anon,authenticated,service_role'),true);
  }
  assert.doesNotMatch(sql,/insert into public\.commerce_shipping_providers/i);
  assert.doesNotMatch(sql,/insert into public\.commerce_return_policies/i);
  assert.doesNotMatch(sql,/DHL|FEDEX|UPS|POSTNORD|KERRY/i);
});

test('WW-9 booking is checkout-v2 + captured-payment + consumed-quote + global-service gated',()=>{
  assert.match(sql,/global_fulfillment_requires_checkout_v2/);
  assert.match(sql,/captured_payment_required/);
  assert.match(sql,/consumed_shipping_quote_required/);
  assert.match(sql,/global_shipping_service_not_live/);
  assert.match(sql,/provider_package_count_mismatch/);
  assert.match(sql,/legacy_domestic_static_v1/);
});

test('WW-9 tracking is immutable/idempotent and out-of-order evidence cannot rewind state',()=>{
  assert.match(sql,/unique\(shipment_id,provider_event_id\)/);
  assert.match(sql,/state_applied boolean not null default false/);
  assert.match(sql,/tracking_event_idempotency_conflict/);
  assert.match(sql,/grant select,insert on table public\.commerce_fulfillment_tracking_events to service_role/);
  assert.doesNotMatch(sql,/grant select,insert,update.*commerce_fulfillment_tracking_events/i);
});

test('WW-9 returns fail closed until an explicit live market policy exists',()=>{
  assert.match(sql,/return_policy_not_live/);
  assert.match(sql,/return_window_closed/);
  assert.match(sql,/return_resolution_not_allowed/);
  assert.match(sql,/p\.enabled and p\.status='live'/);
});
