import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const sql = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const CLAIM = 'supabase/migrations/20261020120000_customer_turn_claim_v1.sql';
const CONTEXT = 'supabase/migrations/20261020130000_customer_turn_monitor_context_persisted.sql';

/** A database at the state production has before either migration, with
 *  real rows in it. */
async function preClaimDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(sql('supabase/migrations/20260929003000_ai_api_cost_observability_v1.sql').split('alter table public.ops_notification_channels')[0]);
  await db.exec(sql('netlify/functions/supabase/one-mind-observability-v1.sql'));
  await db.exec(sql('supabase/migrations/20261009090000_customer_turn_monitor_v1.sql'));
  await db.exec(`
    insert into customer_turn_outcomes (channel,event_id,conversation_id,outcome,error_type,duration_ms)
    values ('line','e1','c','completed',null,900),('line','e2','c','failed','TimeoutError',2500);
    insert into one_mind_traces (trace_id,channel,domain,intent,action,dialog_mode,degradation_condition,envelope,observed_at,expires_at)
    values ('e1','line','activity','price','ask','answer','none',
      '{"state":{"persisted":false,"contextPersisted":true}}',now(),now()+interval '1 hour');
  `);
  return db;
}

async function monitorColumns(db: PGlite): Promise<string[]> {
  const { rows } = await db.query<{ column_name: string }>(
    `select column_name from information_schema.columns
     where table_name='thongthai_customer_turn_monitor' order by ordinal_position`,
  );
  return rows.map(row => row.column_name);
}

async function rowCounts(db: PGlite) {
  const { rows } = await db.query<{ outcomes: number; traces: number }>(
    'select (select count(*) from customer_turn_outcomes)::int as outcomes, (select count(*) from one_mind_traces)::int as traces',
  );
  return rows[0];
}

test('in order, the context migration applies on live data, keeps every column and is re-runnable', async () => {
  const db = await preClaimDb();
  try {
    await db.exec(sql(CLAIM));
    const claimColumns = await monitorColumns(db);
    const before = await rowCounts(db);

    await db.exec(sql(CONTEXT));
    const columns = await monitorColumns(db);
    assert.deepEqual(columns.slice(0, -1), claimColumns, 'every existing column keeps its name and position');
    assert.equal(columns.at(-1), 'context_persisted');
    assert.deepEqual(await rowCounts(db), before, 'a view-only migration must not touch rows');

    await db.exec(sql(CONTEXT));
    assert.deepEqual(await monitorColumns(db), columns, 'applying it again is a no-op');

    const { rows } = await db.query<{ event_id: string; state_persisted: unknown; context_persisted: unknown }>(
      'select event_id,state_persisted,context_persisted from thongthai_customer_turn_monitor order by event_id',
    );
    assert.deepEqual(rows.map(row => [row.event_id, row.state_persisted, row.context_persisted]), [
      ['e1', false, true],
      ['e2', null, null],
    ]);
  } finally {
    await db.close();
  }
});

test('out of order, the context migration refuses to run and names the migration to apply first', async () => {
  const db = await preClaimDb();
  try {
    const columnsBefore = await monitorColumns(db);
    await assert.rejects(
      db.exec(sql(CONTEXT)),
      /Apply supabase\/migrations\/20261020120000_customer_turn_claim_v1\.sql before 20261020130000/u,
    );
    assert.deepEqual(await monitorColumns(db), columnsBefore, 'a refused run must leave the view untouched');

    // Recovery is simply the right order. Without the guard the claim
    // migration would fail here with "cannot drop columns from view".
    await db.exec(sql(CLAIM));
    await db.exec(sql(CONTEXT));
    assert.equal((await monitorColumns(db)).at(-1), 'context_persisted');
  } finally {
    await db.close();
  }
});

test('re-running the claim migration after the context migration fails, as its header warns', async () => {
  const db = await preClaimDb();
  try {
    await db.exec(sql(CLAIM));
    await db.exec(sql(CONTEXT));
    await assert.rejects(db.exec(sql(CLAIM)), /cannot drop columns from view/u);
    assert.match(sql(CLAIM), /DO NOT RE-RUN this file after\s+-- 20261020130000_customer_turn_monitor_context_persisted\.sql/u);
  } finally {
    await db.close();
  }
});
