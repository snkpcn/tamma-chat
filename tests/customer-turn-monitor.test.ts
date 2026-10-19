import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const sql = (path:string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('monitor joins message costs and sources without treating missing accounting as free', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(sql('supabase/migrations/20260929003000_ai_api_cost_observability_v1.sql').split('alter table public.ops_notification_channels')[0]);
    await db.exec(sql('netlify/functions/supabase/one-mind-observability-v1.sql'));
    await db.exec(sql('supabase/migrations/20261009090000_customer_turn_monitor_v1.sql'));
    await db.exec(`
      insert into customer_turn_outcomes (channel,event_id,conversation_id,outcome,error_type,duration_ms)
      values ('line','failed','c','failed','TimeoutError',2500);
      insert into ai_response_turns
        (conversation_id,event_id,channel,final_response_source,zero_cost_turn)
      values ('c','paid','line','openai_grounded_response',false),
             ('c','free','line','deterministic_or_grounded_local',true),
             ('c','unknown','line','legacy_or_unclassified',false);
      insert into ai_api_cost_events
        (conversation_id,event_id,channel,model,call_purpose,cost_thb,call_index_turn,call_index_conversation,status)
      values ('c','paid','line','test-model','semantic',0.3,1,1,'completed'),
             ('c','paid','line','test-model','composer',0.4,2,2,'failed');
      insert into one_mind_traces
        (trace_id,channel,domain,intent,action,dialog_mode,degradation_condition,envelope,observed_at,expires_at)
      values ('paid','line','activity','price','ask','answer','source_partial',
        '{"knowledge":{"sources":[{"sourceId":"activity_live"}],"usedFactKeys":["horse:price"]},"degradation":{"reasonCodes":["source_timeout"]},"state":{"persisted":true}}',
        now(),now()+interval '1 hour');
    `);
    const { rows } = await db.query<Record<string,unknown>>('select * from thongthai_customer_turn_monitor order by event_id');
    const paid = rows.find(r => r.event_id === 'paid')!;
    assert.equal(Number(paid.cost_thb), 0.7);
    assert.equal(Number(paid.recorded_ai_calls), 2);
    assert.equal(Number(paid.failed_ai_calls), 1);
    assert.deepEqual(paid.used_fact_keys, ['horse:price']);
    assert.deepEqual(paid.failure_reasons, ['source_timeout']);
    assert.equal(rows.find(r => r.event_id === 'free')?.cost_accounting_available, true);
    assert.equal(Number(rows.find(r => r.event_id === 'free')?.cost_thb), 0);
    assert.equal(rows.find(r => r.event_id === 'unknown')?.cost_thb, null);
    assert.equal(rows.find(r => r.event_id === 'unknown')?.cost_accounting_available, false);
    const failed = rows.find(r => r.event_id === 'failed')!;
    assert.equal(failed.outcome,'failed');
    assert.equal(failed.error_type,'TimeoutError');
    assert.equal(failed.final_response_source,'backend_failure');
    assert.equal(failed.cost_thb,null);
    assert.equal(failed.cost_accounting_available,false);
    await db.exec("update one_mind_traces set observed_at=now()-interval '2 hours',expires_at=now()-interval '1 hour'");
    const expired = await db.query<{detailed_trace_available:boolean}>("select detailed_trace_available from thongthai_customer_turn_monitor where event_id='paid'");
    assert.equal(expired.rows[0].detailed_trace_available, false);
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from thongthai_customer_turn_monitor'), /permission denied/);
  } finally {
    await db.close();
  }
});
