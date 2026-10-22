import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { checkCustomerTurnHostedReadiness } from '../scripts/check-customer-turn-hosted-readiness.mjs';
const sql = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('production preflight detects missing migrations and passes the ordered migration chain', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(sql('supabase/migrations/20260929003000_ai_api_cost_observability_v1.sql').split('alter table public.ops_notification_channels')[0]);
    await db.exec(sql('netlify/functions/supabase/one-mind-observability-v1.sql'));
    await db.exec(sql('supabase/migrations/20261009090000_customer_turn_monitor_v1.sql'));
    const preflight = sql('supabase/checks/customer-turn-production-readiness.sql');
    const before = await db.query<{name: string; ready: boolean}>(preflight);
    assert.ok(before.rows.some(row => !row.ready));
    for (const migration of [
      '20261018120000_web_search_cost_provider.sql',
      '20261020120000_customer_turn_claim_v1.sql',
      '20261020130000_customer_turn_monitor_context_persisted.sql',
      '20261021120000_line_customer_deliveries.sql',
    ]) await db.exec(sql(`supabase/migrations/${migration}`));
    const after = await db.query<{name: string; ready: boolean}>(preflight);
    assert.equal(after.rows.length, 10);
    assert.ok(after.rows.every(row => row.ready), JSON.stringify(after.rows));
    // Execute the build's actual selected columns against the migrated schema,
    // so an incorrectly named column cannot silently block every deployment.
    const hosted = await checkCustomerTurnHostedReadiness({ baseUrl: 'https://fixture.supabase.co', serviceRoleKey: 'test',
      fetchImpl: async (input: string) => {
        const url = new URL(input);
        const table = url.pathname.split('/').at(-1)!;
        const columns = url.searchParams.get('select')!;
        assert.match(table, /^[a-z_]+$/);
        assert.match(columns, /^[a-z_,]+$/);
        const result = await db.query(`select ${columns} from public.${table} limit 0`);
        return new Response(JSON.stringify(result.rows));
      },
    });
    assert.ok(hosted.every(check => check.pass), JSON.stringify(hosted));
    await db.exec('grant select on public.line_customer_deliveries to authenticated');
    const leaked = await db.query<{name: string; ready: boolean}>(preflight);
    assert.equal(leaked.rows.find(row => row.name === 'private_tables_and_view_access')?.ready, false);
  } finally { await db.close(); }
});
