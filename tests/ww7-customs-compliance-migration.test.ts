import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core=readFileSync('supabase/migrations/20261003053617_ww7_customs_compliance_core.sql','utf8');
const fix=readFileSync('supabase/migrations/20261003053715_ww7_customs_snapshot_idempotency_fix.sql','utf8');
const bridge=readFileSync('netlify/functions/_thongthai-worldwide-bridge.ts','utf8');

test('WW-7 creates server-only customs profile/rule/policy/snapshot stores',()=>{
  for(const table of [
    'commerce_product_customs_profiles',
    'commerce_customs_destination_rules',
    'commerce_customs_market_policies',
    'commerce_customs_compliance_snapshots',
  ]){
    assert.match(core,new RegExp(`create table if not exists public\\.${table}\\b`,'i'));
    assert.match(core,new RegExp(`alter table public\\.${table} enable row level security`,'i'));
    assert.match(core,new RegExp(`revoke all on table public\\.${table} from public,anon,authenticated,service_role`,'i'));
    assert.match(core,new RegExp(`grant select,insert,update,delete on table public\\.${table} to service_role`,'i'));
  }
});

test('WW-7 does not infer customs facts from OTOP story/category data',()=>{
  assert.doesNotMatch(core,/metadata\s*->|materialOrIngredient|category|productName|storyVerified/iu);
  const profileInsert=core.match(/insert into public\.commerce_product_customs_profiles[\s\S]{0,1200}?on conflict\(product_id\)/iu)?.[0]??'';
  assert.match(profileInsert,/\bvalues\s*\(/iu);
  assert.doesNotMatch(profileInsert,/\bselect\b[\s\S]*\bfrom public\.otop_products\b/iu);
  assert.doesNotMatch(core,/insert into public\.commerce_customs_destination_rules\b/iu);
});

test('WW-7 classification and origin require explicit verified profile data',()=>{
  assert.match(core,/classification_code text not null[\s\S]*'\^\[0-9\]\{6,12\}\$'/u);
  assert.match(core,/verification_status in \('draft','verified','rejected'\)/u);
  assert.match(core,/origin_country_code text not null/u);
  assert.match(core,/customs_profile_not_verified/u);
});

test('WW-7 no destination rule never becomes allowed',()=>{
  assert.match(core,/decision in \('allowed','review_required','prohibited'\)/u);
  assert.match(core,/destination_rule_not_live/u);
  assert.match(core,/v_decision:='review_required'/u);
  assert.match(core,/v_decision:='prohibited'/u);
});

test('WW-7 duty/tax remains explicitly uncalculated and market policy is separate',()=>{
  assert.match(core,/duty_tax_mode in \('not_configured','recipient_on_import','prepaid_assessment'\)/u);
  assert.match(core,/duty_tax_status text not null default 'not_calculated'/u);
  assert.doesNotMatch(core,/duty_amount|tax_amount|vat_amount|landed_cost/iu);
});

test('WW-7 idempotency follow-up binds key to the exact request item list',()=>{
  assert.match(fix,/request_items jsonb not null/u);
  assert.match(fix,/v_existing\.request_items<>p_items/u);
  assert.match(fix,/customs_snapshot_idempotency_conflict/u);
});

test('WW-7 profile and snapshot RPCs are service-role-only with empty search path',()=>{
  for(const source of [core,fix]){
    assert.match(source,/security definer set search_path=''/iu);
  }
  assert.match(core,/revoke all on function public\.set_commerce_product_customs_profile_v1[\s\S]*from public,anon,authenticated/iu);
  assert.match(fix,/revoke all on function public\.create_commerce_customs_snapshot_v1[\s\S]*from public,anon,authenticated/iu);
});

test('WW-7 Thongthai customs lane names only authoritative WW compliance sources',()=>{
  assert.match(bridge,/WW customs profiles \+ explicit destination rules \+ compliance snapshots/u);
});
