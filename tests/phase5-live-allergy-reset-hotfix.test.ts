// Phase 5 hotfix regression tests for a real live-LINE failure observed
// after PR #235 (Phase 4 dynamic backoffice knowledge gateway) and #236
// (Phase 5 human final response authority) shipped: a customer explicitly
// reset the conversation ("ลืมที่คุยกันไปก่อนนะครับ") and then asked a
// clear, self-contained restaurant allergy question -- the system asked a
// fabricated "do you mean the menu we discussed before?" clarification
// instead of answering directly.
//
// Root cause (two structural bugs, not a phrase patch):
//   1. A "let's start over" acknowledgment never actually cleared the
//      persisted conversationContext (routing memory) -- see
//      deterministicConversationResetResponse in thongthai-chat.ts.
//   2. _dialog-manager.ts's isAmbiguous() short-circuited to a fabricated
//      "ที่คุยไว้ก่อนหน้านี้" (what we discussed before) clarification
//      whenever needsClarification was true, even when the turn carried a
//      concrete, answerable informationNeed and ZERO actual reference to
//      anything prior -- see isAmbiguous's own comment.
// Also closed along the way (found while reproducing the live failure
// through the real core path):
//   3. RESTAURANT_RECOMMEND_REQUEST_MARKER was missing "กินอะไรได้บ้าง"
//      (only "มีอะไร..." matched), so a message naming an allergy without
//      "มี" got only a short acknowledgment, never a real recommendation.
//   4. "เด็ก"/"ผู้สูงอายุ" personalized food questions fell into local-
//      concierge's generic food_culture blurb instead of deferring to the
//      real restaurant SOT advisor.
//   5. No deterministic path answered "is this ONE named dish safe given
//      my allergy" -- adviseRestaurantMenu's new item_safety_check mode.
//
// All tests drive the real processThongthaiChatCore end-to-end (never a
// hand-constructed SemanticTurn), under this repo's forced-provider-
// outage test convention (no OPENAI_API_KEY in this sandbox) -- matching
// tests/final-perfection-pass-conversational-fixes.test.ts's own
// established pattern.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withHarness, guestId, brainRequest } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { emptyConversationContextState, type ConversationContextState } from '../netlify/functions/_conversation-context';

function msg(payload: unknown): string {
  return String((payload as { message: string }).message);
}

const STALE_CONTEXT_CLARIFICATION = /ที่คุยไว้ก่อนหน้านี้ใช่ไหมครับ/u;
// "ทองไทย" deliberately excluded -- it's also the bot's own name and
// appears in nearly every reply ("ทองไทยแนะนำ...") regardless of topic.
const NO_ACTIVITY_MENTION = /ขี่ม้า|เอาม้า|ATV|เอทีวี|ยิงธนู|เรือถีบ|เป็ดน้ำ|ภาราดร/u;
const RAW_DUMP_MARKERS = /[{}[\]]"[a-zA-Z_]+":|SELECT\s|FROM\s+\w+_\w+|guest_agent_state|activity_assets|null,null|undefined/u;

test('TEST 1 -- exact live failure: reset then a clear allergy question gets a direct answer, never the stale-context clarification', async () => {
  await withHarness(async () => {
    const gid = guestId('hotfix-t1-reset-then-allergy');
    const reset = await processThongthaiChatCore(brainRequest('ลืมที่คุยกันไปก่อนนะครับ', gid, 'web'), 'evt-0');
    assert.equal(reset.statusCode, 200);

    const r = await processThongthaiChatCore(brainRequest('แฟนแพ้กุ้ง มีอะไรกินได้บ้าง', gid, 'web'), 'evt-1');
    assert.equal(r.statusCode, 200);
    const reply = msg(r.payload);
    assert.doesNotMatch(reply, STALE_CONTEXT_CLARIFICATION, 'must never ask "do you mean what we discussed before"');
    assert.doesNotMatch(reply, NO_ACTIVITY_MENTION, 'must never pull in activity/horse/boat context');
    assert.match(reply, /กุ้ง/u, 'must actually address the shrimp allergy');
    assert.ok(reply.length < 500, 'must stay concise, not an ingredient dump');
  });
});

test('TEST 2 -- no reset needed: a fresh, self-contained allergy question gets a direct answer', async () => {
  await withHarness(async () => {
    const gid = guestId('hotfix-t2-fresh-allergy');
    const r = await processThongthaiChatCore(brainRequest('แฟนแพ้กุ้ง มีอะไรกินได้บ้าง', gid, 'web'), 'evt-0');
    assert.equal(r.statusCode, 200);
    const reply = msg(r.payload);
    assert.doesNotMatch(reply, STALE_CONTEXT_CLARIFICATION);
    assert.match(reply, /กุ้ง/u);
  });
});

test('TEST 3 -- stale activity/horse context (no explicit reset) must not pollute a later food-allergy answer', async () => {
  await withHarness(async () => {
    const gid = guestId('hotfix-t3-stale-activity-no-reset');
    const t1 = await processThongthaiChatCore(brainRequest('อยากขี่ม้า เอาภาราดร', gid, 'web'), 'evt-0');
    assert.equal(t1.statusCode, 200);

    const r = await processThongthaiChatCore(brainRequest('แฟนแพ้กุ้ง มีอะไรกินได้บ้าง', gid, 'web'), 'evt-1');
    assert.equal(r.statusCode, 200);
    const reply = msg(r.payload);
    assert.doesNotMatch(reply, STALE_CONTEXT_CLARIFICATION);
    assert.doesNotMatch(reply, NO_ACTIVITY_MENTION, 'must never mention the earlier horse selection');
    assert.match(reply, /กุ้ง/u);
  });
});

test('TEST 4 -- a specific named menu item\'s allergy safety is answered from real structured data, no dump, no hallucinated claim', async () => {
  await withHarness(async () => {
    // The mandate's own example names "ตำไทย", which isn't in this repo's
    // seeded test fixture menu -- substituted with two items the harness
    // actually seeds (see canonical-core-harness.ts) so this genuinely
    // exercises the real adviseRestaurantMenu data path instead of
    // asserting against a menu item that can't exist in this sandbox.
    const unsafeGid = guestId('hotfix-t4-unsafe-item');
    const unsafe = await processThongthaiChatCore(brainRequest('แพ้กุ้ง ต้มยำกุ้งกินได้ไหม', unsafeGid, 'web'), 'evt-0');
    assert.equal(unsafe.statusCode, 200);
    const unsafeReply = msg(unsafe.payload);
    assert.match(unsafeReply, /ต้มยำกุ้ง/u, 'must answer about the specific named dish');
    assert.match(unsafeReply, /เลี่ยง/u, 'must recommend avoiding a dish that actually contains the allergen');
    assert.doesNotMatch(unsafeReply, RAW_DUMP_MARKERS);

    const safeGid = guestId('hotfix-t4-safe-item');
    const safe = await processThongthaiChatCore(brainRequest('แพ้กุ้ง ข้าวผัดหมูกินได้ไหม', safeGid, 'web'), 'evt-0');
    assert.equal(safe.statusCode, 200);
    const safeReply = msg(safe.payload);
    assert.match(safeReply, /ข้าวผัดหมู/u);
    assert.doesNotMatch(safeReply, /100%|มั่นใจ|รับประกัน/u, 'must never claim absolute/hallucinated safety');
    assert.match(safeReply, /แพ้รุนแรง|พนักงาน|ครัว/u, 'must still mention staff/kitchen confirmation for a severe allergy');
  });
});

test('TEST 5 -- a broad allergy recommendation request gets real menu options, not a bare acknowledgment', async () => {
  await withHarness(async () => {
    const gid = guestId('hotfix-t5-broad-allergy');
    const r = await processThongthaiChatCore(brainRequest('แพ้กุ้ง กินอะไรได้บ้าง', gid, 'web'), 'evt-0');
    assert.equal(r.statusCode, 200);
    const reply = msg(r.payload);
    assert.match(reply, /บาท/u, 'must recommend real, verified menu options with real prices');
    assert.doesNotMatch(reply, /ต้มยำกุ้ง/u, 'must never recommend a dish that actually contains the stated allergen');
  });
});

test('TEST 6 -- a short local confirmation resolves the immediately previous clarification only, never jumps domains', async () => {
  await withHarness(async () => {
    const gid = guestId('hotfix-t6-short-confirmation');
    const ask1 = await processThongthaiChatCore(brainRequest('มาครั้งแรก มีอะไรแนะนำบ้าง', gid, 'web'), 'evt-0');
    assert.equal(ask1.statusCode, 200);
    const askReply = msg(ask1.payload);
    assert.match(askReply, /สายชิล/u, 'setup: the ecosystem-path clarification must actually have been asked');

    const answer = await processThongthaiChatCore(brainRequest('ชิล ๆ', gid, 'web', [
      { role: 'user', content: 'มาครั้งแรก มีอะไรแนะนำบ้าง' },
      { role: 'assistant', content: askReply },
    ]), 'evt-1');
    assert.equal(answer.statusCode, 200);
    const answerReply = msg(answer.payload);
    assert.match(answerReply, /คาเฟ่|ถ่ายรูป/u, 'must resolve to the chill path the customer just picked');
    assert.doesNotMatch(answerReply, NO_ACTIVITY_MENTION, 'must never jump to an unrelated domain');
  });
});

test('TEST 7 -- raw dump guard: no JSON, internal field/table names, or repeated boilerplate in any of the above replies', async () => {
  await withHarness(async () => {
    const gid = guestId('hotfix-t7-raw-dump-guard');
    const r = await processThongthaiChatCore(brainRequest('แฟนแพ้กุ้ง มีอะไรกินได้บ้าง', gid, 'web'), 'evt-0');
    const reply = msg(r.payload);
    assert.doesNotMatch(reply, RAW_DUMP_MARKERS);
    const boilerplateCount = (reply.match(/จากข้อมูลที่ยืนยัน/gu) ?? []).length;
    assert.ok(boilerplateCount <= 1, 'must never repeat the same verified-data disclaimer multiple times in one reply');
  });
});

test('reset really resets: persisted routing/discourse memory is actually cleared, not just acknowledged', async () => {
  await withHarness(async harness => {
    const gid = guestId('hotfix-reset-clears-state');
    await processThongthaiChatCore(brainRequest('สวัสดี', gid, 'web'), 'evt-seed');
    const guestDbId = harness.guestDbId(gid)!;
    // Directly seed a non-empty routing-memory state (the exact shape a
    // real prior turn would leave behind: an active domain plus a
    // recently-seen entity) rather than depending on whether THIS
    // sandbox's forced provider outage happens to persist it -- this
    // isolates deterministicConversationResetResponse's own behavior.
    const seeded: ConversationContextState = {
      ...emptyConversationContextState(),
      activeDomain: 'activity',
      recentEntities: [{
        id: 'activity_asset:horse-pharadon', type: 'activity_asset', name: 'ภาราดร',
        domain: 'activity', source: 'conversation', canonical: true,
      }],
    };
    const existing = harness.getState(guestDbId);
    harness.setState(guestDbId, {
      ...(existing?.state ?? {}),
      conversationContext: seeded,
      aiCostLedger: {
        version:'ai-cost-ledger-v1',
        conversationId:gid,
        startedAt:new Date().toISOString(),
        lastActivityAt:new Date().toISOString(),
        cumulativeCostUsd:0.12,
        reservedCostUsd:0,
        callCount:4,
        events:[],
      },
    });

    const reset = await processThongthaiChatCore(brainRequest('เริ่มใหม่ครับ', gid, 'web'), 'evt-1');
    assert.equal(reset.statusCode, 200);
    const afterState = harness.getState(guestDbId)?.state;
    const after = afterState?.conversationContext as { activeDomain?: string | null; recentEntities?: unknown[] } | undefined;
    assert.equal(after?.activeDomain ?? null, null, 'reset must actually clear the persisted active domain, not just say it will');
    assert.equal((after?.recentEntities ?? []).length, 0, 'reset must actually clear persisted recent entities');
    assert.equal(afterState?.aiCostLedger, undefined,
      'an explicit start-over must also start a fresh per-conversation AI budget instead of inheriting the previous session spend');
  });
});

test('reset never touches a real active booking task (conversational reset is not an implicit transaction cancellation)', async () => {
  await withHarness(async harness => {
    const gid = guestId('hotfix-reset-preserves-task');
    await processThongthaiChatCore(brainRequest('อยากขี่ม้า', gid, 'web'), 'evt-0');
    const guestDbId = harness.guestDbId(gid)!;
    const beforeTask = harness.getState(guestDbId)?.state?.taskState as { activeTask?: { status?: string } } | undefined;
    assert.ok(beforeTask?.activeTask, 'setup: a real active task must exist before the reset');

    await processThongthaiChatCore(brainRequest('ลืมที่คุยกันไปก่อนนะครับ', gid, 'web'), 'evt-1');
    const afterTask = harness.getState(guestDbId)?.state?.taskState as { activeTask?: { status?: string } } | undefined;
    assert.deepEqual(afterTask, beforeTask, 'a conversational reset must never silently cancel a real in-progress task');
    assert.equal(harness.postsTo('bookings').length, 0);
  });
});
