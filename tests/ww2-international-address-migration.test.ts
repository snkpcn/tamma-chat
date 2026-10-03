import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  'supabase/migrations/20261003035040_ww2_international_address_v2.sql',
  'utf8',
);

test('WW-2 migration is additive and defaults all legacy addresses to Thailand V1', () => {
  assert.match(sql, /add column if not exists address_schema_version smallint not null default 1/iu);
  assert.match(sql, /add column if not exists country_code text not null default 'TH'/iu);
  assert.match(sql, /add column if not exists locality_enc text null/iu);
  assert.match(sql, /add column if not exists administrative_area_enc text null/iu);
  assert.doesNotMatch(sql, /drop table|rename column|alter column .* type/iu);
});

test('WW-2 V1 constraint preserves the complete Thailand legacy address contract', () => {
  assert.match(sql, /address_schema_version = 1/iu);
  assert.match(sql, /country_code = 'TH'/iu);
  assert.match(sql, /district_enc is not null/iu);
  assert.match(sql, /province is not null/iu);
  assert.match(sql, /postal_code_enc is not null/iu);
});

test('WW-2 V2 permits international postal/admin variance but requires a locality', () => {
  assert.match(sql, /address_schema_version = 2[\s\S]*locality_enc is not null/iu);
  assert.match(sql, /alter column postal_code_enc drop not null/iu);
  assert.match(sql, /alter column province drop not null/iu);
});

test('WW-2 keeps address PII encrypted and adds no client grants', () => {
  for (const column of [
    'organization_enc',
    'dependent_locality_enc',
    'locality_enc',
    'administrative_area_enc',
  ]) {
    assert.match(sql, new RegExp(`add column if not exists ${column} text null`, 'i'));
  }
  assert.doesNotMatch(sql, /grant\s+[^;]+\s+to\s+(?:anon|authenticated)/iu);
});
