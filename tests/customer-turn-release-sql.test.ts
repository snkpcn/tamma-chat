import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const release = read('supabase/releases/20261022_fast_accurate_bilingual.sql');
const chain = [
  '20261009090000_customer_turn_monitor_v1.sql',
  '20261018120000_web_search_cost_provider.sql',
  '20261020120000_customer_turn_claim_v1.sql',
  '20261020130000_customer_turn_monitor_context_persisted.sql',
  '20261021120000_line_customer_deliveries.sql',
];

for (const existing of [0, 3, 5]) test(`release SQL handles ${existing} existing steps, preserves rows and can run twice`, async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(read('supabase/migrations/20260929003000_ai_api_cost_observability_v1.sql').split('alter table public.ops_notification_channels')[0]);
    await db.exec(read('netlify/functions/supabase/one-mind-observability-v1.sql'));
    for (const name of chain.slice(0, existing)) await db.exec(read(`supabase/migrations/${name}`));
    if (existing) await db.exec("insert into public.customer_turn_outcomes(channel,event_id,outcome,duration_ms) values ('web','existing-release-test','completed',1)");
    await db.exec(release);
    await db.exec(release);
    const checks = await db.query<{name: string; ready: boolean}>(read('supabase/checks/customer-turn-production-readiness.sql'));
    assert.equal(checks.rows.length, 10);
    assert.ok(checks.rows.every(r => r.ready), JSON.stringify(checks.rows));
    if (existing) assert.equal((await db.query("select event_id from public.customer_turn_outcomes where event_id='existing-release-test'")).rows.length, 1);
  } finally { await db.close(); }
});

test('release SQL stops before schema changes when its base tables are missing', async () => {
  const db = new PGlite();
  try {
    await assert.rejects(db.exec(release), /Missing base tables/);
    await db.exec('rollback');
    const result = await db.query<{table_name: string | null}>("select to_regclass('public.customer_turn_outcomes')::text as table_name");
    assert.equal(result.rows[0].table_name, null);
  } finally { await db.close(); }
});

test('release SQL contains the exact reviewed migration sources', () => {
  for (const name of chain) assert.ok(release.includes(read(`supabase/migrations/${name}`)), name);
});
