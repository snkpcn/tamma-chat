import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const db = readFileSync('netlify/functions/_member-delivery-db.ts','utf8');
const api = readFileSync('netlify/functions/customer-addresses.ts','utf8');
const store = readFileSync('netlify/functions/otop-store.ts','utf8');
const account = readFileSync('account.html','utf8');
const i18n = readFileSync('assets/scripts/account-i18n.js','utf8');
const guardSql = readFileSync(
  'supabase/migrations/20261003035447_ww2_domestic_checkout_address_guard.sql',
  'utf8',
);

test('WW-2 persistence is feature-gated and stores international location PII encrypted', () => {
  assert.match(db, /isWorldwideCapabilityEnabled\('addressV2'\)/u);
  assert.match(db, /international_address_not_enabled/u);
  assert.match(db, /organization_enc:\s*encryptPii/u);
  assert.match(db, /dependent_locality_enc:\s*encryptPii/u);
  assert.match(db, /locality_enc:\s*encryptPii/u);
  assert.match(db, /administrative_area_enc:\s*encryptPii/u);
  assert.match(db, /country_code:\s*internationalAddress!\.countryCode/u);
});

test('WW-2 address API exposes capability state without enabling it itself', () => {
  assert.match(api, /features:\s*\{[\s\S]*addressV2:\s*isWorldwideCapabilityEnabled\('addressV2'\)/u);
  assert.match(api, /invalid_international_phone/u);
  assert.match(api, /locality_required/u);
});

test('WW-2 domestic checkout rejects foreign or V2 addresses before Thailand quote', () => {
  const guardPos = db.indexOf("international_shipping_not_enabled");
  const quotePos = db.indexOf("calculateShippingQuote(subtotal, settings)");
  assert.ok(guardPos >= 0);
  assert.ok(quotePos > guardPos);
  assert.match(store, /international_shipping_not_enabled/u);
});

test('WW-2 database transaction authority independently enforces the same domestic boundary', () => {
  assert.match(guardSql, /a\.country_code <> 'TH' or a\.address_schema_version <> 1/u);
  assert.match(guardSql, /raise exception 'international_shipping_not_enabled'/u);
  assert.match(guardSql, /security definer[\s\S]*set search_path = ''/iu);
  assert.match(guardSql, /revoke all on function[\s\S]*from public, anon, authenticated/iu);
  assert.match(guardSql, /grant execute on function[\s\S]*to service_role/iu);
});

test('WW-2 account form is present but capability-gated, and preserves V2 on feature-off edits', () => {
  assert.match(account, /id="addressV2CountryWrap" class="hidden"/u);
  assert.match(account, /id="addressSchemaVersion"/u);
  assert.match(account, /data\.features\?\.addressV2===true/u);
  assert.match(account, /Number\(\$\('addressSchemaVersion'\)\?\.value\|\|1\)===2/u);
  assert.match(account, /international_address_not_enabled/u);
});

test('WW-2 new account labels exist in every five-language dictionary', () => {
  for (const key of ['country_code','organization','dependent_locality','locality','administrative_area','invalid_country_code','invalid_international_phone','locality_required','international_address_not_enabled']) {
    const matches = i18n.match(new RegExp(`${key}:`, 'g')) ?? [];
    assert.equal(matches.length, 5, `${key} should exist in all 5 account dictionaries`);
  }
});
