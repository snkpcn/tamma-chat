import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core=readFileSync('supabase/migrations/20261003044411_ww5_global_payment_core.sql','utf8');
const fix=readFileSync('supabase/migrations/20261003044532_ww5_apply_event_alias_fix.sql','utf8');
const indexes=readFileSync('supabase/migrations/20261003044633_ww5_payment_fk_indexes.sql','utf8');
const payments=readFileSync('netlify/functions/supabase/payment-single-channel-v1.sql','utf8');
const runtime=readFileSync('netlify/functions/_global-payments-db.ts','utf8');

test('WW-5 creates server-only provider, method, intent and event stores',()=>{
  for(const table of [
    'commerce_payment_providers',
    'commerce_market_payment_methods',
    'commerce_payment_intents',
    'commerce_payment_events',
  ]){
    assert.match(core,new RegExp(`create table if not exists public\\.${table}\\b`,'i'));
    assert.match(core,new RegExp(`alter table public\\.${table} enable row level security`,'i'));
    assert.match(core,new RegExp(`revoke all on table public\\.${table}[\\s\\S]*from public,anon,authenticated,service_role`,'i'));
    assert.match(core,new RegExp(`grant select,insert,update,delete on table public\\.${table} to service_role`,'i'));
  }
});

test('WW-5 registers current PromptPay only as legacy_v1 and seeds no global_v2 provider method',()=>{
  assert.match(core,/'legacy_promptpay_owner'/u);
  assert.match(core,/'legacy_promptpay_v1'/u);
  assert.match(core,/'promptpay_owner_qr'[\s\S]*'legacy_v1','live',true/u);
  assert.doesNotMatch(core,/values\s*\([^;]*'global_v2','live',true/iu);
});

test('WW-5 payment intents use idempotency and immutable transaction evidence',()=>{
  assert.match(core,/idempotency_key text not null unique/u);
  assert.match(core,/amount_minor bigint not null/u);
  assert.match(core,/captured_amount_minor bigint not null default 0/u);
  assert.match(core,/refunded_amount_minor bigint not null default 0/u);
  assert.match(core,/payment_intent_immutable_field/u);
  assert.match(core,/provider_intent_id_immutable/u);
  assert.match(core,/payment_intent_idempotency_conflict/u);
});

test('WW-5 provider events store digest and normalized evidence, not raw payment payloads or card secrets',()=>{
  assert.match(core,/payload_sha256 text not null/u);
  assert.match(core,/signature_verified boolean not null default false/u);
  assert.match(core,/money_semantics in \('none','intent_total','refund_delta'\)/u);
  assert.doesNotMatch(core,/\braw_payload\b|\bcard_number\b|\bpan\b|\bcvc\b|\bcvv\b|\bclient_secret\b|\bapi_key\b/iu);
});

test('WW-5 create-intent RPC requires a live global_v2 method and is service-role-only',()=>{
  assert.match(core,/execution_mode='global_v2'[\s\S]*status='live'[\s\S]*pm\.enabled/u);
  assert.match(core,/global_payment_method_not_ready/u);
  assert.match(core,/revoke all on function public\.create_commerce_payment_intent_v1[\s\S]*from public,anon,authenticated/iu);
  assert.match(core,/grant execute on function public\.create_commerce_payment_intent_v1[\s\S]*to service_role/iu);
});

test('WW-5 event application requires verified matching money evidence and bounds refunds',()=>{
  assert.match(fix,/provider_event_signature_not_verified/u);
  assert.match(fix,/provider_event_provider_mismatch/u);
  assert.match(fix,/provider_event_currency_mismatch/u);
  assert.match(fix,/provider_event_amount_mismatch/u);
  assert.match(fix,/refund_exceeds_capture/u);
  assert.match(fix,/partial_refund_must_be_less_than_capture/u);
  assert.match(fix,/full_refund_must_equal_capture/u);
  assert.match(fix,/update public\.commerce_payment_intents as target/u);
});

test('WW-5 advisor follow-up indexes cover newly introduced payment-core FKs',()=>{
  for(const name of [
    'commerce_payment_events_currency_idx',
    'commerce_payment_intents_currency_idx',
    'commerce_payment_intents_market_idx',
    'commerce_payment_intents_method_fk_idx',
  ]) assert.match(indexes,new RegExp(`create index if not exists ${name}\\b`,'i'));
});

test('WW-5 does not weaken the current THB-only PromptPay v1 contract',()=>{
  assert.match(payments,/currency text not null default 'THB' check \(currency = 'THB'\)/u);
  assert.match(payments,/method text not null default 'promptpay_owner_qr' check \(method = 'promptpay_owner_qr'\)/u);
  assert.doesNotMatch(core,/alter table public\.payment_requests[\s\S]*drop constraint.*payment_requests_(?:currency|method)_check/iu);
});

test('WW-5 runtime is feature-gated and contains no provider credentials',()=>{
  assert.match(runtime,/isWorldwideCapabilityEnabled\('globalPayments'/u);
  assert.doesNotMatch(runtime,/STRIPE|ADYEN|BRAINTREE|CLIENT_SECRET|API_SECRET|PRIVATE_KEY/iu);
});
