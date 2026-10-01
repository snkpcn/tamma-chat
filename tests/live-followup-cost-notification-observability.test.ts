// Live LINE follow-up mandate, Failure 1: the owner's expected API-cost
// notification did not appear after a real production conversation. Traced
// the real chain (LINE webhook -> conversation core -> OpenAI supervisor ->
// usage accounting -> conversation cost accumulator -> idle-cost notifier
// cron -> LINE delivery): usage accounting and cost accumulation are both
// verified correct (ai_api_cost_events/ai_response_turns rows exist with
// environment='live' in production), and the idle-notify cron IS bound and
// HAS delivered successfully for this exact conversation earlier in the
// same session (call_index 15, 20, 25) -- so the LINE binding and delivery
// mechanics are not broken outright.
//
// Found and fixed one concrete, real structural bug in the freshness check
// (sendIdleAiCostConversationSummaries in _ai-cost-notifier.ts): it fetched
// turns ascending with a bounded limit and read the LAST array entry to find
// the "most recent" turn. For a conversation_id reused across many
// hours/days (exactly this owner's own repeated live-test pattern) that
// silently returns a STALE turn once the conversation's turn count exceeds
// the limit, not the genuinely most recent one. Fixed to fetch the single
// latest turn directly, descending. Also added structured logging for every
// skip/not-bound outcome so a future silent stop is diagnosable from
// function logs alone, without DB forensics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendIdleAiCostConversationSummaries } from '../netlify/functions/_ai-cost-notifier';
import { withHarness } from './helpers/canonical-core-harness';

const NOW = new Date('2026-09-29T16:00:00.000Z');

function iso(minutesAgo: number): string {
  return new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();
}

test('F1: a genuinely idle conversation with real usage gets notified exactly once, and a second scan does not duplicate it', async () => {
  await withHarness(async harness => {
    harness.programOpsChannel('ai_cost', 'ai-cost-group-1');
    harness.programAiCostRows(
      [
        {
          conversation_id: 'conv-idle', event_id: 'evt-1', channel: 'line', model: 'gpt-5.6-sol',
          call_purpose: 'semantic-interpreter', input_tokens: 500, cached_input_tokens: 0,
          output_tokens: 80, cost_thb: 0.42, call_index_conversation: 1, latency_ms: 300,
          occurred_at: iso(20),
        },
      ],
      [
        {
          conversation_id: 'conv-idle', model_reply_used: true, grounded_knowledge_supplied: false,
          zero_cost_turn: false, final_response_source: 'openai_direct_response', occurred_at: iso(20),
        },
      ],
    );

    const firstPass = await sendIdleAiCostConversationSummaries(NOW);
    assert.equal(firstPass.length, 1, 'usage accounted and idle >=10 min must be accumulated into exactly one notification attempt');
    assert.equal(firstPass[0]!.status, 'sent', 'the configured cost notification path must actually fire, not just compute a summary');
    assert.ok(firstPass[0]!.costThb > 0, 'the accumulated conversation cost must be the real recorded amount, not zero');

    const deliveries = harness.notificationDeliveries();
    assert.equal(deliveries.filter(d => d.deliveryType === 'ai_cost_conversation').length, 1);

    const secondPass = await sendIdleAiCostConversationSummaries(NOW);
    assert.equal(secondPass[0]!.status, 'duplicate', 'a repeat scan of the same idle window must never re-send the same notification');
    assert.equal(
      harness.notificationDeliveries().filter(d => d.deliveryType === 'ai_cost_conversation').length,
      1,
      'notification is not duplicated incorrectly',
    );
  });
});

test('F2: a conversation with a turn in the last 10 minutes is correctly treated as still active and skipped, even for a long-lived conversation_id with many prior turns', async () => {
  await withHarness(async harness => {
    harness.programOpsChannel('ai_cost', 'ai-cost-group-1');
    // Models the owner's own real usage pattern: the SAME conversation_id
    // reused across many separate turns over hours. Real production
    // regression this proves fixed: the freshness check must read the
    // ACTUAL latest turn, not a stale one a bounded ascending scan would
    // have returned once the turn count grew.
    const oldTurns = Array.from({ length: 12 }, (_, i) => ({
      conversation_id: 'conv-long-lived', model_reply_used: false, grounded_knowledge_supplied: false,
      zero_cost_turn: true, final_response_source: 'deterministic_or_grounded_local',
      occurred_at: iso(300 - i), // spread across several hours in the past
    }));
    harness.programAiCostRows(
      [
        {
          conversation_id: 'conv-long-lived', event_id: 'evt-old', channel: 'line', model: 'gpt-5.6-sol',
          call_purpose: 'semantic-interpreter', input_tokens: 500, cached_input_tokens: 0,
          output_tokens: 80, cost_thb: 0.42, call_index_conversation: 1, latency_ms: 300,
          occurred_at: iso(180),
        },
      ],
      [
        ...oldTurns,
        // The genuinely latest turn: inside the 10-minute idle window, so
        // this conversation must be treated as still active right now.
        {
          conversation_id: 'conv-long-lived', model_reply_used: false, grounded_knowledge_supplied: false,
          zero_cost_turn: true, final_response_source: 'deterministic_or_grounded_local',
          occurred_at: iso(3),
        },
      ],
    );

    const results = await sendIdleAiCostConversationSummaries(NOW);
    assert.equal(results.length, 0, 'a conversation with real recent activity must never be reported idle');
    assert.equal(harness.notificationDeliveries().filter(d => d.deliveryType === 'ai_cost_conversation').length, 0);
  });
});

test('F3: a not-bound ai_cost team never throws (customer traffic is never affected) but is distinguishable from a genuine send', async () => {
  await withHarness(async harness => {
    // Deliberately never call programOpsChannel -- the team is unbound.
    harness.programAiCostRows(
      [
        {
          conversation_id: 'conv-unbound', event_id: 'evt-1', channel: 'line', model: 'gpt-5.6-sol',
          call_purpose: 'semantic-interpreter', input_tokens: 500, cached_input_tokens: 0,
          output_tokens: 80, cost_thb: 0.42, call_index_conversation: 1, latency_ms: 300,
          occurred_at: iso(20),
        },
      ],
      [
        {
          conversation_id: 'conv-unbound', model_reply_used: true, grounded_knowledge_supplied: false,
          zero_cost_turn: false, final_response_source: 'openai_direct_response', occurred_at: iso(20),
        },
      ],
    );
    const results = await sendIdleAiCostConversationSummaries(NOW);
    assert.equal(results.length, 1);
    assert.equal(results[0]!.status, 'not_bound');
  });
});


test('F4: reused conversation_id is partitioned at a reset call index so a new idle session reports only its own cost', async () => {
  await withHarness(async harness => {
    harness.programOpsChannel('ai_cost', 'ai-cost-group-1');
    harness.programAiCostRows([
      {
        conversation_id:'conv-reused',event_id:'old-1',channel:'line',model:'gpt-5.6-sol',
        call_purpose:'semantic-interpreter',input_tokens:100,cached_input_tokens:0,output_tokens:20,
        cost_thb:1.25,call_index_conversation:1,occurred_at:iso(120),
      },
      {
        conversation_id:'conv-reused',event_id:'old-2',channel:'line',model:'gpt-5.6-sol',
        call_purpose:'grounded-response-composition',input_tokens:200,cached_input_tokens:0,output_tokens:30,
        cost_thb:2.75,call_index_conversation:2,occurred_at:iso(119),
      },
      {
        conversation_id:'conv-reused',event_id:'new-1',channel:'line',model:'gpt-5.6-sol',
        call_purpose:'semantic-interpreter',input_tokens:100,cached_input_tokens:0,output_tokens:20,
        cost_thb:0.20,call_index_conversation:1,occurred_at:iso(20),
      },
      {
        conversation_id:'conv-reused',event_id:'new-2',channel:'line',model:'gpt-5.6-sol',
        call_purpose:'semantic-interpreter',input_tokens:100,cached_input_tokens:0,output_tokens:20,
        cost_thb:0.30,call_index_conversation:2,occurred_at:iso(19),
      },
    ],[
      {
        conversation_id:'conv-reused',model_reply_used:true,grounded_knowledge_supplied:false,
        zero_cost_turn:false,final_response_source:'openai_direct_response',occurred_at:iso(19),
      },
    ]);

    const results=await sendIdleAiCostConversationSummaries(NOW);
    assert.equal(results.length,1);
    assert.equal(results[0]!.status,'sent');
    assert.equal(results[0]!.costThb,0.5,'the new session must not inherit prior sessions from the same stable conversation_id');
    assert.equal(harness.notificationDeliveries().filter(d=>d.deliveryType==='ai_cost_conversation').length,1);
  });
});

test('F5: two separate ledger sessions may end at the same call index without suppressing the later cost notification as duplicate', async () => {
  await withHarness(async harness => {
    harness.programOpsChannel('ai_cost', 'ai-cost-group-1');
    const session1=[
      {
        conversation_id:'conv-same-count',event_id:'s1-1',channel:'line',model:'gpt-5.6-sol',
        call_purpose:'semantic-interpreter',input_tokens:100,cached_input_tokens:0,output_tokens:20,
        cost_thb:0.20,call_index_conversation:1,occurred_at:iso(80),
      },
      {
        conversation_id:'conv-same-count',event_id:'s1-2',channel:'line',model:'gpt-5.6-sol',
        call_purpose:'semantic-interpreter',input_tokens:100,cached_input_tokens:0,output_tokens:20,
        cost_thb:0.30,call_index_conversation:2,occurred_at:iso(79),
      },
    ];
    harness.programAiCostRows(session1,[]);
    const first=await sendIdleAiCostConversationSummaries(NOW);
    assert.equal(first[0]!.status,'sent');

    const session2=[
      {
        conversation_id:'conv-same-count',event_id:'s2-1',channel:'line',model:'gpt-5.6-sol',
        call_purpose:'semantic-interpreter',input_tokens:100,cached_input_tokens:0,output_tokens:20,
        cost_thb:0.25,call_index_conversation:1,occurred_at:iso(20),
      },
      {
        conversation_id:'conv-same-count',event_id:'s2-2',channel:'line',model:'gpt-5.6-sol',
        call_purpose:'semantic-interpreter',input_tokens:100,cached_input_tokens:0,output_tokens:20,
        cost_thb:0.35,call_index_conversation:2,occurred_at:iso(19),
      },
    ];
    harness.programAiCostRows([...session1,...session2],[]);
    const second=await sendIdleAiCostConversationSummaries(NOW);
    assert.equal(second[0]!.status,'sent','a later reset session with the same max call index must get a distinct delivery');
    assert.equal(second[0]!.costThb,0.6);
    assert.equal(harness.notificationDeliveries().filter(d=>d.deliveryType==='ai_cost_conversation').length,2);

    const repeat=await sendIdleAiCostConversationSummaries(NOW);
    assert.equal(repeat[0]!.status,'duplicate','re-scanning the same latest session must remain idempotent');
    assert.equal(harness.notificationDeliveries().filter(d=>d.deliveryType==='ai_cost_conversation').length,2);
  });
});

test('F6: an idle deterministic-only conversation is reported with an exact zero cost instead of disappearing', async () => {
  await withHarness(async harness => {
    harness.programOpsChannel('ai_cost', 'ai-cost-group-1');
    harness.programAiCostRows([], [
      {
        conversation_id:'conv-zero-cost',event_id:'zero-turn-1',channel:'web',
        model_reply_used:false,grounded_knowledge_supplied:true,zero_cost_turn:true,
        final_response_source:'grounded_deterministic_fallback',occurred_at:iso(20),
      },
    ]);

    const results=await sendIdleAiCostConversationSummaries(NOW);
    assert.equal(results.length,1);
    assert.equal(results[0]!.status,'sent');
    assert.equal(results[0]!.costThb,0);
    const delivery=harness.postsTo('ops_notification_deliveries').find(row=>row.delivery_type==='ai_cost_conversation');
    assert.deepEqual(delivery?.payload && (delivery.payload as any).channels,[
      {channel:'web',cost:0,calls:0,turns:1},
    ]);
    const push=harness.postsTo('line_push')[0] as {messages?:Array<{text?:string}>}|undefined;
    const text=push?.messages?.[0]?.text??'';
    assert.match(text,/ต้นทุนจริงต่อบทสนทนา/u);
    assert.match(text,/สรุป: ไม่เสียค่า AI/u);
    assert.match(text,/ช่องทางลูกค้า: เว็บไซต์/u);
    assert.match(text,/ต้นทุนรวม: 0\.00 บาท/u);
    assert.match(text,/ตอบจากข้อมูล\/กติกาในระบบโดยไม่เรียก OpenAI: 1 ข้อความ/u);
    assert.doesNotMatch(text,/Zero-cost turns|OpenAI calls|Channels \(/u,'owner LINE notification must not expose unreadable engineering labels');
  });
});

test('F7: one cross-channel conversation reports a per-channel cost breakdown', async () => {
  await withHarness(async harness => {
    harness.programOpsChannel('ai_cost', 'ai-cost-group-1');
    harness.programAiCostRows([
      {
        conversation_id:'conv-cross-channel',event_id:'web-1',channel:'web',model:'gpt-5.6-sol',
        call_purpose:'semantic-interpreter',input_tokens:100,cached_input_tokens:0,output_tokens:20,
        cost_thb:0.2,call_index_conversation:1,occurred_at:iso(22),
      },
      {
        conversation_id:'conv-cross-channel',event_id:'line-1',channel:'line',model:'gpt-5.6-sol',
        call_purpose:'grounded-response-composition',input_tokens:200,cached_input_tokens:0,output_tokens:30,
        cost_thb:0.3,call_index_conversation:2,occurred_at:iso(21),
      },
    ],[
      {conversation_id:'conv-cross-channel',event_id:'web-1',channel:'web',model_reply_used:true,grounded_knowledge_supplied:false,zero_cost_turn:false,occurred_at:iso(22)},
      {conversation_id:'conv-cross-channel',event_id:'line-1',channel:'line',model_reply_used:true,grounded_knowledge_supplied:true,zero_cost_turn:false,occurred_at:iso(21)},
    ]);

    const results=await sendIdleAiCostConversationSummaries(NOW);
    assert.equal(results[0]!.costThb,0.5);
    const delivery=harness.postsTo('ops_notification_deliveries').find(row=>row.delivery_type==='ai_cost_conversation');
    assert.deepEqual(delivery?.payload && (delivery.payload as any).channels,[
      {channel:'line',cost:0.3,calls:1,turns:1},
      {channel:'web',cost:0.2,calls:1,turns:1},
    ]);
    const push=harness.postsTo('line_push')[0] as {messages?:Array<{text?:string}>}|undefined;
    const text=push?.messages?.[0]?.text??'';
    assert.match(text,/• LINE — 0\.30 บาท/u);
    assert.match(text,/• เว็บไซต์ — 0\.20 บาท/u);
    assert.match(text,/ต้นทุนเกิดจาก/u);
    assert.match(text,/ทำความเข้าใจข้อความลูกค้า: 1 ครั้ง — 0\.20 บาท/u);
    assert.match(text,/เรียบเรียงคำตอบจากข้อมูลที่ตรวจสอบแล้ว: 1 ครั้ง — 0\.30 บาท/u);
  });
});
