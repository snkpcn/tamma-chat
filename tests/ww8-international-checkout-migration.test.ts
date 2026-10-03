import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const core=readFileSync('supabase/migrations/20261003061720_ww8_international_checkout_core.sql','utf8');
const fix=readFileSync('supabase/migrations/20261003062059_ww8_cart_quote_binding_alias_fix.sql','utf8');
const endpoint=readFileSync('netlify/functions/international-checkout.ts','utf8');
const runtime=readFileSync('netlify/functions/_international-checkout-db.ts','utf8');

test('WW-8 cart-bound shipping quote table is server-only',()=>{
  assert.match(core,/create table if not exists public\.commerce_shipping_quote_cart_bindings/u);
  assert.match(core,/alter table public\.commerce_shipping_quote_cart_bindings enable row level security/u);
  assert.match(core,/revoke all on table public\.commerce_shipping_quote_cart_bindings from public,anon,authenticated,service_role/u);
  assert.match(core,/grant select,insert,update,delete on table public\.commerce_shipping_quote_cart_bindings to service_role/u);
});

test('WW-8 orders carry explicit checkout-v2 transaction evidence',()=>{
  for(const field of [
    'checkout_version','destination_country_code','shipping_quote_id','customs_snapshot_id',
    'payment_intent_id','subtotal_minor','shipping_fee_minor','total_minor',
    'shipping_address_snapshot_v2','checkout_request_items','payment_provider_code',
    'payment_method_code','duty_terms_code','duty_disclosure_key','duties_acknowledged_at',
  ]) assert.match(core,new RegExp(`add column if not exists ${field}\\b`,'i'));
  assert.match(core,/checkout_version<>2 or \([\s\S]*pricing_source='multi_currency_v1'/u);
});

test('WW-8 exact global line prices are linked to approved price revisions',()=>{
  assert.match(core,/add column if not exists unit_price_minor bigint/u);
  assert.match(core,/add column if not exists line_total_minor bigint/u);
  assert.match(core,/commerce_product_prices cp[\s\S]*cp\.currency_code=v_quote\.currency_code[\s\S]*cp\.active/u);
  assert.match(core,/priceRevisionId/u);
});

test('WW-8 legacy PromptPay trigger skips checkout v2 instead of accepting foreign currency',()=>{
  assert.match(core,/if new\.checkout_version=2 then return new; end if;[\s\S]*new\.currency_code<>'THB'/u);
  assert.match(core,/create_payment_for_otop_order/u);
  assert.match(core,/sync_otop_payment_amount/u);
});

test('WW-8 cart quote requires verified product shipping profiles and records exact cart binding',()=>{
  assert.match(core,/commerce_product_shipping_profiles/u);
  assert.match(core,/shipping_profile_required/u);
  assert.match(core,/shipping_cart_requires_manual_packaging/u);
  assert.match(fix,/commerce_shipping_quote_cart_bindings/u);
  assert.match(fix,/shipping_quote_cart_binding_conflict/u);
  assert.match(fix,/on conflict on constraint commerce_shipping_quote_cart_bindings_pkey/u);
});

test('WW-8 checkout validates market, quote, customs, address, duties disclosure and global payment method',()=>{
  for(const code of [
    'shipping_quote_already_consumed','shipping_quote_expired','shipping_quote_cart_mismatch',
    'international_market_not_live','checkout_capability_not_live','customs_not_eligible',
    'customs_documents_not_automated','landed_cost_not_supported',
    'international_shipping_address_mismatch','price_not_available','payment_method_not_ready',
  ]) assert.match(core,new RegExp(code));
  assert.match(core,/a\.address_schema_version=2/u);
  assert.match(core,/m\.status='live' and not m\.is_domestic/u);
  assert.match(core,/pm\.execution_mode='global_v2'/u);
});

test('WW-8 recipient-on-import checkout requires customer acknowledgement and does not invent landed cost',()=>{
  assert.match(core,/duties_acknowledgement_required/u);
  assert.match(core,/duty_tax_mode<>'recipient_on_import'/u);
  assert.match(core,/importer_responsibility<>'customer'/u);
  assert.doesNotMatch(core,/duty_amount|tax_amount|landed_cost_minor/iu);
});

test('WW-8 creates global payment intent and consumes shipping quote atomically',()=>{
  assert.match(core,/create_commerce_payment_intent_v1/u);
  assert.match(core,/update public\.otop_orders set payment_intent_id/u);
  assert.match(core,/update public\.commerce_shipping_quotes set status='consumed'/u);
  assert.match(core,/global_checkout_payment_intent_mismatch/u);
  assert.match(core,/global_checkout_shipping_quote_mismatch/u);
  assert.match(core,/global_checkout_customs_snapshot_mismatch/u);
});

test('WW-8 order confirmation checks captured global payment for v2 but keeps legacy verification for v1',()=>{
  assert.match(core,/if new\.checkout_version=2 then[\s\S]*commerce_payment_intents/u);
  assert.match(core,/global_payment_not_captured/u);
  assert.match(core,/payment_requests[\s\S]*payment_not_verified/u);
});

test('WW-8 endpoint is authenticated and runtime is capability-gated',()=>{
  assert.match(endpoint,/authUserFromBearer/u);
  assert.match(endpoint,/authentication_required/u);
  assert.match(runtime,/assertInternationalCheckoutEnabled/u);
  assert.doesNotMatch(runtime,/STRIPE|ADYEN|PRIVATE_KEY|CLIENT_SECRET/iu);
});

test('WW-8 checkout/cart quote RPCs are service-role-only',()=>{
  for(const name of ['create_commerce_cart_shipping_quote_v1','create_member_otop_order_v2']){
    assert.match(core,new RegExp(`revoke all on function public\\.${name}[\\s\\S]*from public,anon,authenticated`,'i'));
    assert.match(core,new RegExp(`grant execute on function public\\.${name}[\\s\\S]*to service_role`,'i'));
  }
});
