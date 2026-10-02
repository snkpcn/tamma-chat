import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const coreSql = readFileSync(
  resolve(root, 'supabase/migrations/20261002205229_ww1_global_data_core.sql'),
  'utf8',
);
const indexSql = readFileSync(
  resolve(root, 'supabase/migrations/20261002205312_ww1_global_data_core_indexes.sql'),
  'utf8',
);

const TABLES = [
  'commerce_currencies',
  'commerce_countries',
  'commerce_locales',
  'commerce_markets',
  'commerce_market_locales',
  'commerce_market_capabilities',
];

test('WW-1 migration contains the six canonical commerce core tables', () => {
  for (const table of TABLES) {
    assert.match(coreSql, new RegExp(`create table if not exists public\\.${table}\\b`, 'i'));
  }
});

test('WW-1 commerce core tables are RLS-on and server-role-only', () => {
  for (const table of TABLES) {
    assert.match(coreSql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(
      coreSql,
      new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated, service_role`, 'i'),
    );
    assert.match(
      coreSql,
      new RegExp(`grant select, insert, update, delete on table public\\.${table} to service_role`, 'i'),
    );
  }
  assert.doesNotMatch(coreSql, /grant\s+[^;]+\s+to\s+(?:anon|authenticated)\s*;/iu);
});

test('WW-1 migration seeds only the certified Thailand baseline and existing five locales', () => {
  assert.match(coreSql, /'THB', 'Thai Baht'/u);
  assert.match(coreSql, /'TH', 'Thailand', 'THB'/u);
  for (const locale of ['th', 'en', 'zh', 'lo', 'vi']) {
    assert.match(coreSql, new RegExp(`\\('${locale}', '${locale}'`));
  }
  assert.match(coreSql, /'TH', 'TH', 'THB', 'th', 'live', true/u);
  assert.match(coreSql, /'TH', 'customs', 'disabled'/u);
});

test('WW-1 follow-up migration covers advisor-identified foreign-key indexes', () => {
  for (const index of [
    'commerce_countries_default_currency_idx',
    'commerce_market_locales_locale_idx',
    'commerce_markets_default_currency_idx',
    'commerce_markets_default_locale_idx',
  ]) {
    assert.match(indexSql, new RegExp(`create index if not exists ${index}\\b`, 'i'));
  }
});
