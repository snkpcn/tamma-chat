import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendIdleAiCostConversationSummaries } from '../netlify/functions/_ai-cost-notifier';
import { withHarness } from './helpers/canonical-core-harness';

const NOW = new Date('2026-10-03T03:00:00.000+07:00');
const iso = (minutesAgo:number) => new Date(NOW.getTime()-minutesAgo*60_000).toISOString();

test('Agent and semantic call-index resets inside one active conversation stay in one cost summary', async () => {
  await withHarness(async harness => {
    harness.programOpsChannel('ai_cost','ai-cost-group-1');
    harness.programAiCostRows([
      {conversation_id:'conv',event_id:'a1',channel:'line',model:'gpt-5.6-terra',call_purpose:'agent_primary_turn_aggregate',input_tokens:24995,cached_input_tokens:12048,output_tokens:265,cost_thb:1.3665,call_index_conversation:1,occurred_at:iso(12)},
      {conversation_id:'conv',event_id:'a2',channel:'line',model:'gpt-5.6-terra',call_purpose:'agent_primary_turn_aggregate',input_tokens:27325,cached_input_tokens:26100,output_tokens:344,cost_thb:0.4468,call_index_conversation:2,occurred_at:iso(11)},
      {conversation_id:'conv',event_id:'a3',channel:'line',model:'gpt-5.6-terra',call_purpose:'agent_primary_turn_aggregate',input_tokens:29637,cached_input_tokens:28566,output_tokens:410,cost_thb:0.4792,call_index_conversation:3,occurred_at:iso(10)},
      {conversation_id:'conv',event_id:'s1',channel:'line',model:'gpt-5.6-terra',call_purpose:'semantic-interpreter',input_tokens:2540,cached_input_tokens:0,output_tokens:251,cost_thb:0.2913,call_index_conversation:1,occurred_at:iso(9)},
      {conversation_id:'conv',event_id:'s2',channel:'line',model:'gpt-5.6-terra',call_purpose:'semantic-interpreter',input_tokens:2885,cached_input_tokens:0,output_tokens:345,cost_thb:0.3568,call_index_conversation:2,occurred_at:iso(8)},
      {conversation_id:'conv',event_id:'s3',channel:'line',model:'gpt-5.6-terra',call_purpose:'semantic-interpreter',input_tokens:2670,cached_input_tokens:0,output_tokens:100,cost_thb:0.2354,call_index_conversation:3,occurred_at:iso(7)},
    ],[
      {conversation_id:'conv',event_id:'a1',channel:'line',model_reply_used:true,grounded_knowledge_supplied:true,zero_cost_turn:false,final_response_source:'thongthai_agent_primary',occurred_at:iso(12)},
      {conversation_id:'conv',event_id:'s3',channel:'line',model_reply_used:false,grounded_knowledge_supplied:false,zero_cost_turn:false,final_response_source:'deterministic_or_grounded_local',occurred_at:iso(7)},
    ]);

    const results=await sendIdleAiCostConversationSummaries(NOW);
    assert.equal(results.length,1);
    assert.equal(results[0]!.status,'sent');
    assert.ok(Math.abs(results[0]!.costThb-3.176)<1e-9);
    const delivery=harness.postsTo('ops_notification_deliveries').find(row=>row.delivery_type==='ai_cost_conversation');
    assert.equal((delivery?.payload as any)?.calls,6);
  });
});
