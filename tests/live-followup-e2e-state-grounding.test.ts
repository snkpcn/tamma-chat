// Live LINE follow-up mandate: end-to-end proof through the REAL core path
// (processThongthaiChatCore), not an isolated composer-level test alone.
//
// The customer discusses food (shrimp allergy, mild-spice preference) and
// horse riding only -- never accommodation, never a second day. The final
// summary turn's own scripted model reply DELIBERATELY reproduces the exact
// owner-reported hallucination ("เฮือนสเตย์" accommodation the customer
// never asked about, and an invented "วันแรก / วันที่สอง" two-day
// itinerary), modeling exactly what the real OpenAI call did in production.
// This proves the fix holds through the entire real pipeline (semantic
// interpretation -> dialog manager -> response composer -> customer-facing
// text), not merely that the composer's own unit-level helpers are correct
// in isolation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { withHarness, guestId, brainRequest } from './helpers/canonical-core-harness';

function text(payload: Record<string, unknown>): string {
  return String(payload.message ?? '');
}

test('E2E: a working-state summary reflects only grounded conversation facts, even when the real model reply itself proposes accommodation and a multi-day itinerary the customer never mentioned', async () => {
  await withHarness(async harness => {
    const gid = guestId('live-followup-e2e');
    let history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    async function turn(message: string, scriptedReply?: Record<string, unknown>): Promise<string> {
      if (scriptedReply) harness.programGeminiReply(scriptedReply);
      const r = await processThongthaiChatCore(brainRequest(message, gid, 'line', history), `e2e-${history.length}`);
      assert.equal(r.statusCode, 200);
      const message_ = text(r.payload);
      history.push({ role: 'user', content: message });
      history.push({ role: 'assistant', content: message_ });
      return message_;
    }

    await turn('ลืมที่คุยกันไปก่อนนะครับ');

    await turn('แฟนแพ้กุ้ง มีอะไรกินได้บ้าง', {
      normalizedMeaning: 'customer states shrimp allergy and asks for safe menu options',
      reply: 'แฟนแพ้กุ้งใช่ไหมครับ เดี๋ยวทองไทยเลี่ยงเมนูที่มีกุ้งให้เลยนะครับ',
      speechAct: 'statement', domain: 'restaurant', intent: 'state_dietary_constraint',
      action: 'provide_information', informationNeed: 'recommendation', entities: {},
      references: [], constraints: ['no_shrimp'], confidence: 0.92, needsClarification: false,
    });

    await turn('เอาแบบไม่เผ็ดมากด้วยนะ', {
      normalizedMeaning: 'customer states a mild-spice preference',
      reply: 'ได้ครับ เดี๋ยวเลือกเมนูที่ไม่เผ็ดมากให้นะครับ',
      speechAct: 'preference_update', domain: 'restaurant', intent: 'state_dietary_constraint',
      action: 'provide_information', informationNeed: 'none', entities: {},
      references: [], constraints: ['low_spicy'], confidence: 0.9, needsClarification: false,
    });

    await turn('โอเค เรื่องกินพักไว้ก่อน พอดีอยากพาแฟนไปขี่ม้า');

    const horseSelectionReply = await turn('ไม่เอาทองไทยนะ ขออีกตัว');
    assert.match(horseSelectionReply, /ภาราดร/u, 'setup: rejecting ทองไทย must resolve to ภาราดร');

    await turn('เอาตัวนั้นไว้ก่อน แต่ยังไม่จองนะ', {
      normalizedMeaning: 'customer tentatively keeps ภาราดร as the considered horse, explicitly not booking yet',
      reply: 'ได้ครับ เก็บ ภาราดร ไว้ก่อนนะครับ ยังไม่จองให้',
      speechAct: 'selection', domain: 'activity', intent: 'select_known_activity_asset',
      action: 'confirm', informationNeed: 'none', entities: { horseName: 'ภาราดร' },
      references: [{ type: 'entity_selection', value: 'ภาราดร', refersToPriorContext: true }],
      constraints: ['not_booking'], confidence: 0.88, needsClarification: false,
    });

    const summary = await turn('สรุปให้หน่อยว่าตอนนี้ผมสนใจอะไรไว้บ้าง แต่ยังไม่ได้จองอะไรใช่ไหม', {
      normalizedMeaning: 'customer asks for a working-state summary',
      // The exact real production hallucination this closes: the model's
      // OWN reply invents accommodation the customer never discussed and a
      // two-day itinerary the customer never described.
      reply: 'ตอนนี้สนใจอาหารและขี่ม้าครับ นอกจากนี้แนะนำที่พักทำมา-ชาติ เฮือนสเตย์ ด้วยนะครับ ถ้าจะพักหลายวัน วันแรก: ขี่ม้า วันที่สอง: ตำลาว',
      speechAct: 'question', domain: 'general', intent: 'summarize_active_task',
      action: 'ask', informationNeed: 'none', entities: {}, references: [],
      constraints: [], confidence: 0.9, needsClarification: false,
    });

    // Test A: verified organization knowledge (accommodation exists) never
    // becomes customer intent merely because it was never discussed.
    assert.doesNotMatch(summary, /เฮือนสเตย์|ที่พัก|โฮมสเตย์|hotel|accommodation/iu,
      'accommodation must never appear -- the customer never asked about it, even though the model itself proposed it');

    // Test B/C: a same-visit sequence/no stated duration never becomes an
    // invented multi-day itinerary.
    assert.doesNotMatch(summary, /วันแรก|วันที่สอง|day\s*1|day\s*2/iu,
      'no invented multi-day itinerary structure, even though the model itself proposed one');

    // Test D: the horse the customer explicitly left unbooked stays
    // tentative, never silently promoted to confirmed/booked.
    assert.match(summary, /ภาราดร/u);
    assert.match(summary, /ยังไม่ได้ยืนยันการจอง|ยังไม่ได้จองหรือส่งรายการ/u);
    assert.doesNotMatch(summary, /จองเรียบร้อย|ยืนยันการจองแล้ว|booked|confirmed/iu);

    // Test E: cross-domain state (a restaurant-domain preference/constraint
    // and an activity-domain interest) both survive together into one
    // summary, grounded only in what was actually discussed.
    assert.match(summary, /กุ้ง/u, 'the shrimp allergy/exclusion must be readable back');
    assert.match(summary, /เผ็ด/u, 'the mild-spice preference must be readable back');
    assert.match(summary, /อาหาร/u, 'food must be listed as a genuine discussed interest');
    assert.match(summary, /กิจกรรม/u, 'activity must be listed as a genuine discussed interest');
  });
});
