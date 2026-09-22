import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyGuestAgentStatePatch } from '../netlify/functions/_guest-agent-state-store';

test('CAS patch merges sibling agent-state keys without deleting unrelated state', () => {
  const next=applyGuestAgentStatePatch({
    legacy:'keep',
    conversationContext:{old:true},
    taskState:{old:true},
  },{
    set:{conversationContext:{new:true}},
  });
  assert.deepEqual(next,{
    legacy:'keep',
    conversationContext:{new:true},
    taskState:{old:true},
  });
});

test('CAS patch supports explicit key removal without affecting siblings', () => {
  const next=applyGuestAgentStatePatch({
    unresolved_need:'old',
    pendingPromotionRedemption:{id:1},
    taskState:{keep:true},
  },{
    set:{last_intent:'information'},
    removeKeys:['unresolved_need','pendingPromotionRedemption'],
  });
  assert.deepEqual(next,{taskState:{keep:true},last_intent:'information'});
});

test('shared store uses updated_at compare-and-swap rather than unconditional PATCH', () => {
  const source=readFileSync('netlify/functions/_guest-agent-state-store.ts','utf8');
  assert.match(source,/updated_at=eq\./);
  assert.match(source,/status:'conflict'/);
  assert.doesNotMatch(source,/method:'PATCH'[\s\S]{0,500}guest_id=eq\.\$\{eq\(guestDbId\)\}[^\n]*select=state,updated_at(?![\s\S]*updated_at=eq)/);
});

test('conversation/task/legacy brain state writers all use the shared CAS store', () => {
  const conversation=readFileSync('netlify/functions/_conversation-context.ts','utf8');
  const task=readFileSync('netlify/functions/_task-state.ts','utf8');
  const runtime=readFileSync('netlify/functions/_thongthai-runtime-v3.ts','utf8');
  for(const [name,source] of [['conversation',conversation],['task',task],['runtime',runtime]] as const){
    assert.match(source,/patchGuestAgentState/, `${name} writer must use shared CAS store`);
  }
  assert.doesNotMatch(task,/guest_agent_state\?on_conflict=guest_id/);
  assert.doesNotMatch(conversation,/guest_agent_state\?on_conflict=guest_id/);
  assert.doesNotMatch(runtime,/guest_agent_state\?on_conflict=guest_id/);
});

test('the superseded pre-v3 brain runtime file was deleted, not merely stopped being imported', () => {
  assert.throws(() => readFileSync('netlify/functions/_thongthai-runtime.ts', 'utf8'));
});

test('account-merge (LINE-link) state writer also uses the shared CAS store, not a raw upsert', () => {
  const runtime = readFileSync('netlify/functions/_thongthai-runtime-v3.ts', 'utf8');
  const mergeFn = runtime.slice(runtime.indexOf('export async function mergeBrainGuestData'));
  assert.match(mergeFn, /patchGuestAgentState\(targetGuestDbId/, 'merge must write guest_agent_state through the CAS store');
  assert.doesNotMatch(mergeFn, /guest_agent_state\?on_conflict=guest_id/, 'merge must not fall back to a raw upsert that can race a concurrent CAS write');
});

test('line-link.ts imports mergeBrainGuestData from the canonical v3 runtime, not the deleted pre-v3 file', () => {
  const source = readFileSync('netlify/functions/line-link.ts', 'utf8');
  assert.match(source, /mergeBrainGuestData.*from '\.\/_thongthai-runtime-v3'/s);
});

test('G.2 cutover is an explicit OFF-by-default env gate and legacy fallthrough remains present', () => {
  const source=readFileSync('netlify/functions/thongthai-chat.ts','utf8');
  assert.match(source,/THONGTHAI_ONE_MIND_CUTOVER === '1'/);
  assert.match(source,/processOneMindCustomerTurn/);
  assert.match(source,/THONGTHAI_ONE_MIND_LEGACY_REQUIRED/);
  assert.match(source,/loadBrainRuntime/,'legacy runtime must remain for strangler fallback');
  assert.match(source,/runThongthaiBrain/,'legacy brain must remain until equivalence cleanup');
});

test('LINE channel adapter remains transport-only for One-Mind and keeps its legacy transaction safety net', () => {
  const source=readFileSync('netlify/functions/_line-webhook-core.ts','utf8');
  assert.doesNotMatch(source,/processOneMindCustomerTurn|composeThongthaiResponse/);
  assert.match(source,/handleLineMembershipMessage/);
  assert.match(source,/handleLineBookingMessage/);
  assert.match(source,/event\.message\.id/);
});
