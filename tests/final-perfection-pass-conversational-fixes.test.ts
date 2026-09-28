// Final conversation-perfection pass: regression tests for three real
// production failures observed in post-merge production smoke, each traced
// to root cause and fixed at the general semantic-class level (never a
// keyword patch for the exact reported sentence). All three drive the real
// processThongthaiChatCore end-to-end, forcing the genuine "model
// unavailable" condition every one of them actually failed under in
// production (a transient real provider outage on that one turn) --
// exactly the condition this repo's own deterministic-fallback layer
// (_deterministic-semantic-turn.ts) exists to cover.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withHarness, guestId, brainRequest } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';

function msg(payload: unknown): string {
  return String((payload as { message: string }).message);
}

test('Perfection pass 1: a restaurant table-status question on a cold start gets an honest "cannot confirm" answer, never the generic outage apology', async () => {
  await withHarness(async harness => {
    const gid = guestId('perfection-restaurant-table-status');
    const r = await processThongthaiChatCore(brainRequest('พรุ่งนี้หกโมงโต๊ะเต็มยัง', gid, 'web'), 'evt-0');
    assert.equal(r.statusCode, 200);
    const reply = msg(r.payload);
    assert.doesNotMatch(reply, /ตอบช้ากว่าปกติ|คิดช้ากว่าปกติ/u,
      'root cause was a missing deterministic classification for table-status questions, not a real outage -- must never collapse to the generic apology');
    assert.match(reply, /โต๊ะ/u, 'must address the actual table-availability question');
    assert.doesNotMatch(reply, /เต็มครับ|ว่างครับ|มีโต๊ะว่าง/u,
      'must never guess a full/free status -- no live table source is wired');
  });
});

test('Perfection pass 2: a conditional activity continuation preserves the already-selected entity and confirms no transaction, never the generic booking-outage apology', async () => {
  await withHarness(async harness => {
    const gid = guestId('perfection-activity-conditional');
    const turn1 = await processThongthaiChatCore(
      brainRequest('อยากขี่ม้าพรุ่งนี้ช่วงเย็น แต่ไม่เอาทองไทยนะ เอาตัวที่นิสัยนิ่งกว่า', gid, 'web'),
      'evt-0',
    );
    assert.equal(turn1.statusCode, 200);
    assert.match(msg(turn1.payload), /ภาราดร/u, 'setup: the calmer horse must actually be selected');

    const turn2 = await processThongthaiChatCore(
      brainRequest('ถ้าตัวนั้นไม่ว่าง เอาอีกตัวแทนได้ แต่ถ้าทั้งคู่ไม่ว่างไม่ต้องจองอะไร', gid, 'web', [
        { role: 'user', content: 'อยากขี่ม้าพรุ่งนี้ช่วงเย็น แต่ไม่เอาทองไทยนะ เอาตัวที่นิสัยนิ่งกว่า' },
        { role: 'assistant', content: msg(turn1.payload) },
      ]),
      'evt-1',
    );
    assert.equal(turn2.statusCode, 200);
    const reply = msg(turn2.payload);
    assert.doesNotMatch(reply, /ระบบจองของทองไทยตอบช้ากว่าปกติ/u,
      'root cause was a missing deterministic classification for this conditional shape, not a real outage');
    assert.match(reply, /ภาราดร/u, 'the already-selected horse must remain the resolved subject, never a generic "which one" clarification');
    assert.match(reply, /ยังไม่ได้ทำรายการ|ยังไม่ได้จอง/u, 'must explicitly confirm no transaction happened');

    const state = harness.getState(harness.guestDbId(gid)!)?.state?.taskState as
      { activeTask?: { slots?: Record<string, unknown> } } | undefined;
    assert.equal(state?.activeTask?.slots?.assetSelection, 'ภาราดร',
      'the conditional check must never mutate or clear the existing selection');
  });
});

test('Perfection pass 2b: the SAME conditional continuation resolves from a prior RECOMMENDATION (no task ever opened), not only from an active task\'s own slot', async () => {
  await withHarness(async harness => {
    const gid = guestId('perfection-activity-conditional-no-task');
    await processThongthaiChatCore(brainRequest('สวัสดี', gid, 'web'), 'evt-seed');
    const guestDbId = harness.guestDbId(gid)!;
    // Models the real production shape this case actually failed under: a
    // prior turn resolved by the REAL model as a plain recommendation
    // ("เอาตัวที่นิสัยนิ่งกว่า" -> "ภาราดร ตรงกว่าครับ") never opens a
    // booking task -- see deriveDeterministicSemanticTurn's new no-active-
    // task branch in _deterministic-semantic-turn.ts. Seeding
    // conversationContext directly (rather than a first real turn) isolates
    // this exact branch instead of depending on how turn 1 was classified.
    const context = {
      ...emptyConversationContextState(),
      activeDomain: 'activity' as const,
      // Mirrors the real production shape: the recommendation turn grounded
      // BOTH horse catalog rows, while the assistant's bounded recommendation
      // evidence uniquely named ภาราดร.
      recentEntities: [
        {
          id: 'activity_asset:horse-pharadon', type: 'activity_asset', name: 'ภาราดร',
          domain: 'activity' as const, source: 'conversation' as const, canonical: true,
          observedAt: new Date().toISOString(),
        },
        {
          id: 'activity_asset:horse-thongthai', type: 'activity_asset', name: 'ทองไทย',
          domain: 'activity' as const, source: 'conversation' as const, canonical: true,
          observedAt: new Date().toISOString(),
        },
      ],
      lastRecommendationReference: 'ถ้าเอาตามเงื่อนไขที่บอก ตอนนี้ ภาราดร ตรงกว่าครับ',
    };
    const existing = harness.getState(guestDbId);
    harness.setState(guestDbId, { ...(existing?.state ?? {}), conversationContext: context });

    const r = await processThongthaiChatCore(
      brainRequest('ถ้าตัวนั้นไม่ว่าง เอาอีกตัวแทนได้ แต่ถ้าทั้งคู่ไม่ว่างไม่ต้องจองอะไร', gid, 'web'),
      'evt-0',
    );
    assert.equal(r.statusCode, 200);
    const reply = msg(r.payload);
    assert.doesNotMatch(reply, /ระบบจองของทองไทยตอบช้ากว่าปกติ/u,
      'no active task existed, but the entity was still uniquely resolvable from recentEntities -- must never collapse to the generic outage apology');
    assert.match(reply, /ภาราดร/u, 'the recently-recommended horse must remain the resolved subject');
    assert.match(reply, /ยังไม่ได้ทำรายการ|ยังไม่ได้จอง/u, 'must explicitly confirm no transaction happened');
  });
});

test('Perfection pass 3: a promotion follow-up reference is never misrouted into a broad, unrelated ecosystem catalog dump', async () => {
  await withHarness(async harness => {
    const gid = guestId('perfection-promotion-followup');
    const turn1 = await processThongthaiChatCore(brainRequest('ตอนนี้มีโปรอะไรใช้ได้บ้าง', gid, 'web'), 'evt-0');
    assert.equal(turn1.statusCode, 200);

    const turn2 = await processThongthaiChatCore(
      brainRequest('อันเมื่อกี้ใช้กับกิจกรรมได้ไหม', gid, 'web', [
        { role: 'user', content: 'ตอนนี้มีโปรอะไรใช้ได้บ้าง' },
        { role: 'assistant', content: msg(turn1.payload) },
      ]),
      'evt-1',
    );
    assert.equal(turn2.statusCode, 200);
    const reply = msg(turn2.payload);
    // The real, reported defect: this exact follow-up used to reset to the
    // broad "here's everything we offer" ecosystem catalog message, discarding
    // the promotion referent entirely. Whether the system can fully resolve
    // the reference under a real outage is a separate, harder question (see
    // THONGTHAI_HANDOFF.md's final-perfection-pass entry) -- what must never
    // happen, under any provider condition, is silently answering a
    // different, unrelated question.
    assert.doesNotMatch(reply, /🍽️ กิน|🌿 กิจกรรม|🏡 พัก|☕ แวะพัก/u,
      'a promotion follow-up must never silently reset to the broad ecosystem catalog dump');
    assert.doesNotMatch(reply, /คิดช้ากว่าปกติ|ตอบช้ากว่าปกติ|ระบบตอบช้า/u,
      'an already-established promotion follow-up must not collapse to a generic provider apology');
    assert.match(reply, /โปร/u,
      'the reply must stay anchored to the promotion topic');
  });
});


test('Perfection pass 4: active-task conditional fallback is exact and must keep the selected horse without model clarification', async () => {
  await withHarness(async harness => {
    const gid = guestId('conditional-active-task-exact');
    await processThongthaiChatCore(brainRequest('อยากขี่ม้าพรุ่งนี้ช่วงเย็น แต่ไม่เอาทองไทยนะ เอาตัวที่นิสัยนิ่งกว่า', gid, 'web'), 'evt-1');
    const r = await processThongthaiChatCore(
      brainRequest('ถ้าตัวนั้นไม่ว่าง เอาอีกตัวแทนได้ แต่ถ้าทั้งคู่ไม่ว่างไม่ต้องจองอะไร', gid, 'web'),
      'evt-2',
    );
    const reply = String((r.payload as { message:string }).message);
    assert.match(reply, /ภาราดร/u);
    assert.doesNotMatch(reply, /หมายถึงกิจกรรมหรือม้าตัวที่คุยไว้ก่อนหน้านี้/u);
    assert.equal(harness.postsTo('bookings').length, 0);
  });
});

test('Perfection pass 5: restaurant allergy recommendation explicitly echoes the verified excluded allergen', async () => {
  await withHarness(async () => {
    const gid = guestId('restaurant-explicit-allergen-echo');
    const r = await processThongthaiChatCore(
      brainRequest('ถ้ามากัน 4 คน มีเด็ก 1 คน แล้วมีคนแพ้กุ้ง ควรกินอะไรดี', gid, 'web'),
      'evt-1',
    );
    const reply = String((r.payload as { message:string }).message);
    assert.match(reply, /ไม่มีกุ้ง/u);
  });
});
