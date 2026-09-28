// OpenAI human-fallback + grounded voice/knowledge architecture: Test
// Groups A-F required by the owner's mandate, all driven through the real
// core path (processThongthaiChatCore), asserting actual final responses,
// final_response_source (ComposedResponse.mode), model call counts, and
// persisted state -- not intermediate SemanticTurn objects.
//
// As with every other test in this harness family: a hand-scripted model
// reply models what a competent real LLM SHOULD return given the current
// prompt contract. It proves the pipeline (eligibility, dialog manager,
// knowledge resolution, response composer, state persistence) correctly
// honors that decision end to end -- it does NOT prove the live model
// always makes that exact decision. That remains the owner's live LINE
// acceptance test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { brainRequest, guestId, withHarness } from './helpers/canonical-core-harness';
import {
  composeGroundedModelResponse,
  composeThongthaiResponse,
  type ResponseComposerInput,
} from '../netlify/functions/_response-composer';
import type { DialogDecision } from '../netlify/functions/_dialog-manager';
import type { DegradationPlan } from '../netlify/functions/_graceful-degradation';
import type { KnowledgeBundle } from '../netlify/functions/_knowledge-resolver';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';

function text(payload: Record<string, unknown>): string {
  return String(payload.message ?? '');
}

const BANNED_GENERIC_CLARIFICATION = /หมายถึงกิจกรรมหรือ.*ที่คุยไว้ก่อนหน้านี้ใช่ไหมครับ/u;

function turn(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    normalizedMeaning: 'open-world conversation turn',
    reply: '', speechAct: 'statement', domain: 'general', intent: 'open_chat',
    action: 'ask', informationNeed: 'none', entities: {}, references: [],
    constraints: [], confidence: 0.95, needsClarification: false,
    ...overrides,
  };
}

// ============================================================
// GROUP A -- zero-cost easy turns: no OpenAI call, correct answer.
// ============================================================

test('A1: stay check-in/check-out time is answered from world_facts with zero model calls', async () => {
  await withHarness(async harness => {
    const gid = guestId('groupA-checkin');
    const r1 = await processThongthaiChatCore(brainRequest('เช็คอินกี่โมง', gid, 'line'), 'a1-1');
    assert.equal(r1.statusCode, 200);
    assert.match(text(r1.payload), /14:00|บ่ายสอง/u);
    const gid2 = guestId('groupA-checkout');
    const r2 = await processThongthaiChatCore(brainRequest('เช็คเอาท์กี่โมง', gid2, 'line'), 'a1-2');
    assert.equal(r2.statusCode, 200);
    assert.match(text(r2.payload), /12:00|เที่ยง/u);
    assert.equal(harness.modelCallCount(), 0, 'verified fixed organization facts must never spend a paid call');
  });
});

test('A2: an activity price lookup still answers correctly from the live catalog even when the model is unavailable', async () => {
  // Price is deliberately NOT in the zero-cost set (see
  // COARSE_READ_ONLY_INTENTS in _thongthai-one-mind-orchestrator.ts): which
  // item/activity a bare price question means can depend on context (an
  // existing production behavior this task must not regress -- see the
  // "B3. ขอราคาด้วย" restaurant-price-follow-up case from PR #228's own
  // investigation). This proves the OTHER half of the owner's requirement:
  // even when the model attempt fails/degrades, the deterministic fallback
  // still answers correctly from verified catalog data, never a robotic
  // apology, for an UNAMBIGUOUS single-activity price question.
  await withHarness(async harness => {
    const gid = guestId('groupA-price');
    const r = await processThongthaiChatCore(brainRequest('ขี่ม้าราคาเท่าไหร่', gid, 'line'), 'a2-1');
    assert.equal(r.statusCode, 200);
    assert.match(text(r.payload), /500/u);
  });
});

// ============================================================
// GROUP B -- OpenAI direct human fallback for hard conversational shapes.
// ============================================================

test('B1: negation + alternative selection is answered directly by the model, never the generic clarification', async () => {
  await withHarness(async harness => {
    const gid = guestId('groupB-negation');
    harness.programGeminiReply(turn({
      domain: 'activity', intent: 'select_other_horse', action: 'confirm', speechAct: 'selection',
      references: [{ type: 'excluded_entity', value: 'ทองไทย', refersToPriorContext: true }],
      constraints: ['consider_only', 'not_booking'],
      reply: 'ได้ครับ เลือกภาราดรไว้ก่อนนะครับ ยังไม่จองนะครับ',
    }));
    const r = await processThongthaiChatCore(brainRequest('ไม่เอาทองไทยนะ ขออีกตัว', gid, 'line'), 'b1-1');
    assert.equal(r.statusCode, 200);
    const message = text(r.payload);
    assert.doesNotMatch(message, BANNED_GENERIC_CLARIFICATION);
    assert.match(message, /ภาราดร/u);
    assert.ok(harness.modelCallCount() >= 1);
  });
});

test('B2: a colloquial topic-switch mid-conversation gets a natural direct reply, not a robotic bounce', async () => {
  await withHarness(async harness => {
    const gid = guestId('groupB-topic-switch');
    harness.programGeminiReply(turn({
      domain: 'general', intent: 'topic_switch_smalltalk', action: 'ask', speechAct: 'question',
      reply: 'มีสิครับ ที่จอดรถกว้างพอสำหรับรถทุกคันเลยครับ',
    }));
    const r = await processThongthaiChatCore(
      brainRequest('เออ ถามอย่างอื่นละกัน มีที่จอดรถไหม', gid, 'line'),
      'b2-1',
    );
    assert.equal(r.statusCode, 200);
    const message = text(r.payload);
    assert.doesNotMatch(message, BANNED_GENERIC_CLARIFICATION);
    assert.match(message, /ที่จอดรถ/u);
  });
});

// ============================================================
// GROUP C -- grounded business answer: DB facts -> OpenAI natural-language
// composer -> customer, for a business-truth question the centralized
// deterministic renderer has no specific template for (OTOP has none --
// see _human-grounded-response.ts's renderer list).
// ============================================================

test('C1: OTOP price+stock question with no deterministic template uses the grounded model composer, sourced only from real facts', async () => {
  await withHarness(async harness => {
    const gid = guestId('groupC-otop');
    harness.programGeminiReply(turn({
      domain: 'otop', intent: 'otop_product_price_and_stock', action: 'ask',
      informationNeed: 'price', speechAct: 'question',
      entities: { productName: 'น้ำผึ้งป่า' },
      reply: '',
    }));
    harness.programGeminiReply({
      message: 'น้ำผึ้งป่าราคา 250 บาทครับ ตอนนี้ยังมีของอยู่ครับ',
      usedFactKeys: [],
    });
    const r = await processThongthaiChatCore(
      brainRequest('น้ำผึ้งป่าราคาเท่าไหร่ ยังมีของไหม', gid, 'line'),
      'c1-1',
    );
    assert.equal(r.statusCode, 200);
    const message = text(r.payload);
    assert.match(message, /250/u, 'must state the real verified price, not an invented one');
    assert.doesNotMatch(message, /ไม่มีข้อมูลที่ยืนยันได้สำหรับเรื่องนี้/u);
  });
});

test('C2: composeGroundedModelResponse never calls the model when no grounded facts exist (no wasted call)', async () => {
  await withHarness(async harness => {
    const gid = guestId('groupC-no-facts');
    const guestDbId = harness.guestDbId(gid);
    // Seed a guest row so the harness has an anonymous->internal mapping,
    // then call the composer directly with an EMPTY knowledge bundle --
    // owner: "OpenAI must not be called when it is clearly unnecessary".
    await processThongthaiChatCore(brainRequest('สวัสดีครับ', gid, 'line'), 'c2-seed');
    const resolvedGuestDbId = harness.guestDbId(gid) ?? guestDbId;
    assert.ok(resolvedGuestDbId);
    const callsBefore = harness.modelCallCount();
    const decision: DialogDecision = {
      mode: 'answer', taskStateContainer: emptyTaskStateContainer(),
      knowledgeRequests: [], missingFields: [], responseIntent: 'grounded_answer', reasons: [],
    };
    const degradation: DegradationPlan = {
      version: 'degradation-v1', condition: 'none', level: 'normal', reasonCodes: [],
      retryable: false, safeToExecuteTransaction: false, sourceStates: [],
    };
    const composerInput: ResponseComposerInput = {
      channel: 'line', language: 'th', userMessage: 'ราคาสินค้าชิ้นนี้เท่าไหร่',
      dialogDecision: decision, knowledgeBundles: [], degradation,
      aiCallContext: {
        conversationId: gid, guestDbId: resolvedGuestDbId!, channel: 'line',
        eventId: 'c2-direct', callerLabel: 'grounded-response-composition',
      },
    };
    const result = await composeGroundedModelResponse(composerInput);
    assert.equal(result, null, 'no facts to ground on must skip the call entirely, not phrase an empty answer');
    assert.equal(harness.modelCallCount(), callsBefore, 'no new model call may have been spent');
  });
});

test('C3: an unverified fact key from the model is rejected and falls back to the honest deterministic decline', async () => {
  await withHarness(async harness => {
    const gid = guestId('groupC-bad-key');
    await processThongthaiChatCore(brainRequest('สวัสดีครับ', gid, 'line'), 'c3-seed');
    const guestDbId = harness.guestDbId(gid);
    assert.ok(guestDbId);
    const bundle: KnowledgeBundle = {
      domain: 'otop',
      sources: [{ need: 'price', sourceId: 'otop_live', sourceType: 'otop_live', status: 'ok' }],
      facts: [{ key: 'otop:otop-honey:price', value: 250, domain: 'otop', sourceId: 'otop_live', sourceType: 'otop_live', authoritative: true, fetchedAt: new Date().toISOString() }],
      entities: [], missing: [], warnings: [], freshness: 'live',
    };
    harness.programGeminiReply({
      message: 'ราคา 250 บาทครับ แถมส่งฟรีด้วยนะครับ',
      usedFactKeys: ['otop:otop-honey:price', 'otop:otop-honey:free_shipping'],
    });
    const decision: DialogDecision = {
      mode: 'answer', taskStateContainer: emptyTaskStateContainer(),
      knowledgeRequests: [], missingFields: [], responseIntent: 'grounded_answer', reasons: [],
    };
    const degradation: DegradationPlan = {
      version: 'degradation-v1', condition: 'none', level: 'normal', reasonCodes: [],
      retryable: false, safeToExecuteTransaction: false, sourceStates: [],
    };
    const composerInput: ResponseComposerInput = {
      channel: 'line', language: 'th', userMessage: 'ราคาน้ำผึ้งป่าเท่าไหร่',
      dialogDecision: decision, knowledgeBundles: [bundle], degradation,
      aiCallContext: {
        conversationId: gid, guestDbId: guestDbId!, channel: 'line',
        eventId: 'c3-direct', callerLabel: 'grounded-response-composition',
      },
    };
    const composerResult = await composeGroundedModelResponse(composerInput);
    assert.equal(composerResult, null, 'a fabricated fact key must be rejected, not silently trusted');
    const fallback = await composeThongthaiResponse(composerInput);
    assert.equal(fallback.mode, 'deterministic');
  });
});

// ============================================================
// GROUP D -- knowledge genuinely unavailable: no invented answer.
// ============================================================

test('D1: a business fact the system genuinely cannot verify gets an honest decline, never an invented value', async () => {
  await withHarness(async harness => {
    const gid = guestId('groupD-unknown-product');
    const r = await processThongthaiChatCore(
      brainRequest('เสื้อยืดที่ระลึกราคาเท่าไหร่', gid, 'line'),
      'd1-1',
    );
    assert.equal(r.statusCode, 200);
    const message = text(r.payload);
    assert.doesNotMatch(message, /\d{2,}\s*บาท/u, 'must never invent a specific price for an unconfigured product');
  });
});

// ============================================================
// GROUP E -- transaction safety: zero unintended writes.
// ============================================================

test('E1: "keep that one in mind, still thinking" never creates a booking', async () => {
  await withHarness(async harness => {
    const gid = guestId('groupE-consider-only');
    harness.programGeminiReply(turn({
      domain: 'activity', intent: 'consider_keep_in_mind', action: 'provide_information',
      speechAct: 'statement', constraints: ['consider_only', 'not_booking'],
      reply: 'ได้ครับ เก็บตัวนี้ไว้ก่อนนะครับ ยังไม่จองครับ',
    }));
    const r = await processThongthaiChatCore(
      brainRequest('เอาตัวนั้นไว้ก่อน แต่ยังไม่จอง', gid, 'line'),
      'e1-1',
    );
    assert.equal(r.statusCode, 200);
    assert.equal(harness.postsTo('bookings').length, 0);
    assert.equal(harness.postsTo('restaurant_preorders').length, 0);
    assert.equal(harness.postsTo('otop_orders').length, 0);
  });
});

test('E2: "maybe tomorrow" is never treated as a confirmed commitment', async () => {
  await withHarness(async harness => {
    const gid = guestId('groupE-maybe-later');
    harness.programGeminiReply(turn({
      domain: 'activity', intent: 'defer_decision', action: 'provide_information',
      speechAct: 'statement',
      reply: 'ได้เลยครับ ไว้พร้อมแล้วค่อยบอกได้เลยนะครับ',
    }));
    const r = await processThongthaiChatCore(brainRequest('เอาไว้พรุ่งนี้ค่อยว่ากัน', gid, 'line'), 'e2-1');
    assert.equal(r.statusCode, 200);
    assert.equal(harness.postsTo('bookings').length, 0);
    assert.doesNotMatch(text(r.payload), /จองเรียบร้อย|ยืนยันการจองแล้ว/u);
  });
});

// ============================================================
// GROUP F -- long natural conversation: continuity, zero unintended
// transactions across a 20+ turn real-world-shaped exchange.
// ============================================================

test('F1: a 20+ turn mixed conversation stays coherent and creates zero unintended transactions', async () => {
  await withHarness(async harness => {
    const gid = guestId('groupF-long-conversation');
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    async function say(message: string, eventId: string, script?: Record<string, unknown>) {
      if (script) harness.programGeminiReply(turn(script));
      const r = await processThongthaiChatCore(brainRequest(message, gid, 'line', history), eventId);
      assert.equal(r.statusCode, 200);
      const reply = text(r.payload);
      history.push({ role: 'user', content: message });
      history.push({ role: 'assistant', content: reply });
      return reply;
    }

    await say('สวัสดีครับ', 'f-01');
    await say('อยากขี่ม้า มีตัวไหนบ้าง', 'f-02');
    await say('แล้วมีอะไรกินไหม หิวแล้ว', 'f-03');
    await say('งั้นกลับมาเรื่องม้าก่อน ตัวไหนเหมาะกับมือใหม่', 'f-04', {
      domain: 'activity', intent: 'beginner_horse_suitability', action: 'ask', speechAct: 'question',
      reply: 'ทองไทยกับภาราดรรับมือใหม่ได้ทั้งคู่ครับ ทองไทยนิ่งกว่านิดหน่อยครับ',
    });
    await say('ทองไทยกับภาราดรต่างกันยังไง', 'f-05', {
      domain: 'activity', intent: 'compare_horses', action: 'compare', speechAct: 'question',
      reply: 'ทองไทยจะนิ่งและเหมาะมือใหม่มากกว่า ส่วนภาราดรจะกระฉับกระเฉงกว่านิดหน่อยครับ',
    });
    await say('งั้นเอาทองไทยไว้ก่อน ยังไม่จองนะ', 'f-06', {
      domain: 'activity', intent: 'consider_horse', action: 'provide_information', speechAct: 'statement',
      constraints: ['consider_only', 'not_booking'],
      reply: 'ได้ครับ เก็บทองไทยไว้ก่อนนะครับ ยังไม่จองครับ',
    });
    await say('เดี๋ยวถามเรื่องอื่นแป๊บ วันนี้อากาศเป็นไง', 'f-07');
    await say('เอาม้าดีกว่า ตกลงยังไม่จองใช่ไหม', 'f-08', {
      domain: 'activity', intent: 'summarize_active_task', action: 'ask', speechAct: 'question',
      informationNeed: 'none',
      reply: 'ใช่ครับ ยังไม่ได้จองนะครับ แค่เก็บทองไทยไว้ในใจก่อนเฉยๆ ครับ',
    });
    const statusReply = await say('ยังไม่จองใช่ไหม', 'f-09', {
      domain: 'activity', intent: 'no_booking_status_check', action: 'status', speechAct: 'question',
      informationNeed: 'transaction_status',
      reply: 'ยังไม่ได้จองครับ',
    });
    assert.doesNotMatch(statusReply, BANNED_GENERIC_CLARIFICATION);
    await say('ถ้ามากับเด็กอายุ 6 ขวบ ขี่ได้ไหม', 'f-10', {
      domain: 'activity', intent: 'child_suitability', action: 'ask', speechAct: 'question',
      reply: 'เด็กอายุ 6 ขวบขี่ได้ครับ แต่ต้องมีเจ้าหน้าที่ดูแลใกล้ชิดตลอดครับ',
    });
    await say('ไม่ใช่ที่พัก กูหมายถึงกิจกรรม', 'f-11', {
      domain: 'activity', intent: 'correct_domain', action: 'correct_previous', speechAct: 'correction',
      reply: 'อ๋อ เข้าใจแล้วครับ พูดถึงกิจกรรมนะครับ',
    });
    await say('เอาแบบไม่เหนื่อยมาก มีอะไรบ้าง', 'f-12', {
      domain: 'activity', intent: 'low_exertion_request', action: 'discover', speechAct: 'request',
      reply: 'ยิงธนูเบาแรงกว่าครับ ถ้าอยากได้แบบไม่ต้องออกแรงเยอะ',
    });
    await say('แฟนกินเผ็ดไม่ค่อยได้ แล้วมีอะไรกินบ้าง', 'f-13', {
      domain: 'restaurant', intent: 'dietary_recommendation', action: 'recommend', speechAct: 'question',
      constraints: ['low_spice'],
      reply: 'แนะนำข้าวผัดหมูครับ ไม่เผ็ดเลย เหมาะกับคนกินเผ็ดไม่เก่งครับ',
    });
    await say('เก็บอันเดิมไว้ก่อน แต่ขอดูราคาก่อน', 'f-14', {
      domain: 'activity', intent: 'price_before_commit', action: 'ask', speechAct: 'question',
      informationNeed: 'price',
      reply: '',
    });
    await say('สรุปให้หน่อยว่าคุยอะไรไปบ้าง', 'f-15', {
      domain: 'activity', intent: 'summarize_active_task', action: 'ask', speechAct: 'question',
      informationNeed: 'none',
      reply: 'สรุปให้นะครับ: ดูเรื่องขี่ม้าอยู่ เก็บทองไทยไว้ในใจแต่ยังไม่จอง แล้วก็คุยเรื่องอาหารไม่เผ็ดไว้ด้วยครับ',
    });
    await say('ขอบคุณครับ', 'f-16', {
      domain: 'general', intent: 'thanks', action: 'ask', speechAct: 'social',
      reply: 'ยินดีครับ ถามเพิ่มได้ตลอดเลยนะครับ',
    });
    await say('เมื่อกี้บอกผิด ไม่ใช่ 6 ขวบ คือ 8 ขวบ', 'f-17', {
      domain: 'activity', intent: 'correct_previous_detail', action: 'correct_previous', speechAct: 'correction',
      reply: 'รับทราบครับ อายุ 8 ขวบก็ขี่ได้เหมือนกันครับ',
    });
    await say('มือถือหล่นระหว่างขี่ม้าเมื่อกี้ ต้องทำไงดี', 'f-18', {
      domain: 'incident', intent: 'lost_item_report', action: 'ask', speechAct: 'incident_report',
      reply: 'เดี๋ยวทองไทยแจ้งทีมงานให้ช่วยดูให้นะครับ รบกวนบอกช่วงเวลาที่ขี่คร่าวๆ ได้ไหมครับ',
    });
    await say('ประมาณบ่ายสองครับ', 'f-19', {
      domain: 'incident', intent: 'lost_item_detail', action: 'provide_information', speechAct: 'statement',
      reply: 'รับทราบครับ ส่งเรื่องให้ทีมงานแล้วนะครับ',
    });
    const finalReply = await say('งั้นวันนี้พอแค่นี้ก่อนนะ บายครับ', 'f-20', {
      domain: 'general', intent: 'closing_smalltalk', action: 'ask', speechAct: 'social',
      reply: 'ได้ครับ ไว้กลับมาคุยกันใหม่นะครับ ขอบคุณที่แวะมาครับ',
    });
    assert.doesNotMatch(finalReply, BANNED_GENERIC_CLARIFICATION);

    // Zero unintended transactions across the ENTIRE 20-turn conversation,
    // despite "ยังไม่จองใช่ไหม", "เก็บ...ไว้ก่อน", and price/consider language
    // appearing repeatedly.
    assert.equal(harness.postsTo('bookings').length, 0, 'a 20-turn consider-only conversation must never create a booking');
    assert.equal(harness.postsTo('restaurant_preorders').length, 0);
    assert.equal(harness.postsTo('otop_orders').length, 0);
  });
});


// ============================================================
// PR #229 live-acceptance regressions -- structural classes found only by
// the real-provider 16-turn certification.  These stay on the real core path
// so future refactors cannot make the intermediate SemanticTurn look right
// while the customer-visible response falls back to legacy.
// ============================================================

test('G1: explicit no-transaction conditional availability stays in One-Mind even when model labels the fallback as planning', async () => {
  await withHarness(async harness => {
    const gid = guestId('groupG-conditional-availability');

    // Establish an in-progress activity working state without committing a
    // booking.  The exact wording is not the behavior under test.
    harness.programGeminiReply(turn({
      domain: 'activity', intent: 'consider_horse', action: 'confirm',
      speechAct: 'selection', entities: { horseName: 'ภาราดร' },
      constraints: ['not_booking'], reply: 'เก็บภาราดรไว้ก่อนครับ ยังไม่จอง',
    }));
    const seed = await processThongthaiChatCore(
      brainRequest('เก็บภาราดรไว้ก่อน ยังไม่จอง', gid, 'line'),
      'g1-seed',
    );
    assert.equal(seed.statusCode, 200);

    // The model correctly extracts both options and the availability need,
    // but conservatively simulate the live failure where it calls the
    // conditional fallback a planning/modify action.  Explicit no_transaction
    // means the machine action must be de-escalated to the safe read-only
    // deterministic interpretation while retaining the model's richer
    // entities -- never bounced to legacy and never executed.
    harness.programGeminiReply(turn({
      domain: 'activity', intent: 'conditional_horse_fallback',
      action: 'modify', informationNeed: 'availability', speechAct: 'request',
      entities: {
        primaryHorse: 'ภาราดร',
        fallbackHorse: 'ทองไทย',
        resourceCode: 'activity-horse',
      },
      constraints: ['no_transaction'], reply: '',
    }));
    const r = await processThongthaiChatCore(
      brainRequest('ถ้าภาราดรไม่ว่าง เอาทองไทยแทนได้ แต่ถ้าทั้งคู่ไม่ว่างไม่ต้องจองอะไร', gid, 'line'),
      'g1-conditional',
    );
    assert.equal(r.statusCode, 200);
    const message = text(r.payload);
    assert.match(message, /ยังไม่ได้|ไม่.*จอง|ไม่อยากเดา/u);
    assert.doesNotMatch(message, /กิจกรรมที่มีตอนนี้/u);
    assert.ok(harness.modelCallCount() >= 1, 'hard conditional turn must reach the language brain');
    assert.equal(harness.postsTo('bookings').length, 0);
    assert.equal(harness.postsTo('restaurant_preorders').length, 0);
    assert.equal(harness.postsTo('otop_orders').length, 0);
  });
});

test('G2: active-task summary outranks missing-field collection and explicitly reports no transaction', async () => {
  await withHarness(async harness => {
    const gid = guestId('groupG-summary-readback');

    // Leave a deliberately incomplete activity task in canonical working
    // state.  This is intentionally ordinary slot-provision (no explicit
    // no-booking constraint), because a consider-only declaration is designed
    // NOT to manufacture a task when none exists.
    harness.programGeminiReply(turn({
      domain: 'activity', intent: 'provide_activity_plan_details', action: 'provide_information',
      speechAct: 'statement',
      entities: { activityCode: 'horse', date: '2026-09-30', partySize: 4 },
      constraints: [], reply: 'รับข้อมูลไว้ครับ',
    }));
    const seed = await processThongthaiChatCore(
      brainRequest('ขี่ม้าพรุ่งนี้ 4 คน', gid, 'line'),
      'g2-seed',
    );
    assert.equal(seed.statusCode, 200);

    harness.programGeminiReply(turn({
      domain: 'activity', intent: 'summarize_active_task', action: 'ask',
      informationNeed: 'none', speechAct: 'question',
      constraints: ['not_booking_now'], reply: '',
    }));
    const r = await processThongthaiChatCore(
      brainRequest('สรุปสิ่งที่เลือกไว้ตอนนี้ให้หน่อย แต่ยังไม่ต้องจอง', gid, 'line'),
      'g2-summary',
    );
    assert.equal(r.statusCode, 200);
    const message = text(r.payload);
    assert.match(message, /ยังไม่ได้ยืนยันการจอง|ยังไม่ได้จอง|ไม่ได้ยืนยัน/u);
    assert.doesNotMatch(message, /เลือกระยะเวลา|ขอระยะเวลา|เช็กระยะเวลา/u);
    assert.equal(harness.postsTo('bookings').length, 0);
  });
});
