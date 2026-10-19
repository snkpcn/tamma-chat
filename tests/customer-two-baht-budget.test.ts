import test from 'node:test';
import assert from 'node:assert/strict';
import { reserveAiCall, finalizeAiCall, touchAiConversation, AiBudgetBlockedError } from '../netlify/functions/_ai-cost-ledger';
import { aiCostPolicy, usdToThbRate } from '../netlify/functions/_ai-cost-policy';
import { runThongthaiAgentShadowTurn } from '../netlify/functions/_thongthai-agent-session';

test('real persistent reservations stop within two baht and block unknown Agent charges', async () => {
  const keys = ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','THONGTHAI_MAX_CONVERSATION_AI_COST_THB',
    'THONGTHAI_MAX_CONVERSATION_AI_COST_USD','THONGTHAI_TEST_BYPASS_COST_CAP'] as const;
  const before = Object.fromEntries(keys.map(key => [key,process.env[key]]));
  const original = global.fetch;
  let row:{state:Record<string,unknown>;updated_at:string}|null = null;
  let providerCalls = 0;
  process.env.SUPABASE_URL = 'https://budget.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
  process.env.THONGTHAI_MAX_CONVERSATION_AI_COST_THB = '99';
  delete process.env.THONGTHAI_MAX_CONVERSATION_AI_COST_USD;
  delete process.env.THONGTHAI_TEST_BYPASS_COST_CAP;
  global.fetch = (async (input,init) => {
    if (!String(input).startsWith('https://budget.test/')) {
      providerCalls++;
      throw new Error('Unexpected paid provider request');
    }
    if (String(input).includes('ai_api_cost_events')) return new Response('',{status:201});
    if (!init?.method || init.method === 'GET') return new Response(JSON.stringify(row ? [row] : []));
    row = JSON.parse(String(init.body));
    return new Response(JSON.stringify([row]));
  }) as typeof fetch;
  try {
    assert.equal(aiCostPolicy().maxConversationCostUsd * usdToThbRate(), 2);
    let blocked = false;
    for (let index = 0; index < 100; index++) {
      try {
        const reservation = await reserveAiCall({
          conversationId:'c',guestDbId:'g',channel:'line',eventId:`e${index}`,callerLabel:'semantic-interpreter',
        }, 'gpt-5.6-terra', ['ราคาและเวลาขี่ม้า'], 700);
        assert.equal(reservation.kind, 'reserved');
        if (reservation.kind === 'reserved') {
          await finalizeAiCall(reservation, {inputTokens:1000,cachedInputTokens:0,outputTokens:500}, '{}', true);
        }
      } catch (error) {
        assert.ok(error instanceof AiBudgetBlockedError && error.reason === 'budget');
        blocked = true;
        break;
      }
    }
    assert.equal(blocked, true);
    const ledger = row!.state.aiCostLedger as {cumulativeCostUsd:number;reservedCostUsd:number};
    assert.ok((ledger.cumulativeCostUsd + ledger.reservedCostUsd) * usdToThbRate() <= 2);
    const base = Date.now();
    await touchAiConversation({
      conversationId:'c',guestDbId:'g',channel:'line',eventId:'free',callerLabel:'customer_activity',
    },new Date(base + 29*60_000));
    await assert.rejects(reserveAiCall({
      conversationId:'c',guestDbId:'g',channel:'line',eventId:'after-free',callerLabel:'semantic-interpreter',
    },'gpt-5.6-terra',['test'],700,new Date(base+40*60_000)),
    error => error instanceof AiBudgetBlockedError && error.reason === 'budget');
    row!.state.thongthaiProductionAgentSession = {
      lastConversationId:'c',lastUsedAt:new Date().toISOString(),
      cumulativeCostThb:0,costAccountingIncomplete:true,
    };
    await assert.rejects(reserveAiCall({
      conversationId:'c',guestDbId:'g',channel:'web',eventId:'pending',callerLabel:'semantic-interpreter',
    },'gpt-5.6-terra',['test'],700), error => error instanceof AiBudgetBlockedError && error.reason === 'ledger_unavailable');
    row = null;
    // Shadow and primary share this same preflight; shadow needs no real
    // production Agent ID and still must never submit a paid request.
    await assert.rejects(runThongthaiAgentShadowTurn({
      conversationId:'fresh',guestDbId:'g',channel:'line',eventId:'agent',message:'แนะนำทริปให้หน่อย',
    }), /safe per-turn reserve/);
    assert.equal(providerCalls, 0);
  } finally {
    global.fetch = original;
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
});
