import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withHarness, guestId, brainRequest } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';

function text(payload: unknown): string {
  return String((payload as { message?: unknown }).message ?? '');
}

test('OWNER LIVE #249: exact LINE continuity sequence survives provider outage without restaurant clarification loop or unintended booking', async () => {
  await withHarness(async harness => {
    const gid = guestId('owner-live-249-exact-sequence');
    let event = 0;
    const send = async (message:string) => {
      event += 1;
      const result = await processThongthaiChatCore(
        brainRequest(message, gid, 'line'),
        `owner249-${event}`,
      );
      assert.equal(result.statusCode, 200, message);
      return text(result.payload);
    };

    await send('ลืมที่คุยกันไปก่อนนะครับ');
    const food = await send('แฟนแพ้กุ้ง แล้วกินเผ็ดไม่ได้ มีอะไรกินได้บ้าง');
    assert.match(food,/กุ้ง/u);
    const snack = await send('แล้วถ้าเป็นของกินเล่นล่ะ');
    assert.doesNotMatch(snack,/หมายถึง.*ที่คุยไว้ก่อนหน้านี้/u);

    const activities = await send('เปลี่ยนเรื่องก่อน มีอะไรให้เล่นบ้าง');
    assert.doesNotMatch(activities,/หมายถึง.*ร้านอาหาร/u);

    const compare = await send('ทองไทยกับภาราดรต่างกันยังไง');
    assert.match(compare,/ทองไทย/u);
    assert.match(compare,/ภาราดร/u);

    const beginner = await send('ถ้าไม่เคยขี่มาก่อน สองตัวนี้ตัวไหนเหมาะกว่ากัน');
    assert.doesNotMatch(beginner,/หมายถึง.*ร้านอาหาร|หมายถึงเมนู|เรื่องร้านอาหาร/u,
      'bounded two-horse comparison must not be stolen by stale restaurant context');
    assert.match(beginner,/ทองไทย|ภาราดร|ม้า/u);

    const held = await send('งั้นเอาภาราดรไว้ก่อน แต่ยังไม่จองนะ');
    assert.doesNotMatch(held,/หมายถึง.*ภาราดร.*ใช่ไหม/u,
      'an explicit named hold is already a complete selection, not a clarification question');
    assert.equal(harness.postsTo('bookings').length,0);

    const duration = await send('เอา 60 นาที');
    assert.doesNotMatch(duration,/หมายถึงเมนู|เรื่องร้านอาหาร|ที่คุยไว้ก่อนหน้านี้/u,
      'duration-only follow-up must continue the held horse, not stale restaurant state');
    assert.match(duration,/60 นาที.*ไม่มี|ไม่มี.*60 นาที/u,
      'an unsupported horse duration must be rejected against the live catalog');
    assert.match(duration,/30 นาที/u);
    assert.match(duration,/45 นาที/u);

    const guestDbId = harness.guestDbId(gid)!;
    const afterDuration = harness.getState(guestDbId)?.state?.taskState as {
      activeTask?: { domain?: string; slots?: Record<string,unknown>; commitmentIntent?: boolean };
    } | undefined;
    assert.equal(afterDuration?.activeTask?.domain,'activity');
    assert.equal(afterDuration?.activeTask?.slots?.horseName,'ภาราดร');
    assert.equal(afterDuration?.activeTask?.slots?.durationMinutes,undefined);
    assert.equal(afterDuration?.activeTask?.commitmentIntent,false);
    assert.equal(harness.postsTo('bookings').length,0);

    const supportedDuration=await send('งั้นขอ 45 นาที แต่ยังไม่จองนะครับ');
    assert.doesNotMatch(supportedDuration,/60 นาที.*ไม่มี/u);
    const afterSupportedDuration=harness.getState(guestDbId)?.state?.taskState as {
      activeTask?: { domain?: string; slots?: Record<string,unknown>; commitmentIntent?: boolean };
    } | undefined;
    assert.equal(afterSupportedDuration?.activeTask?.slots?.durationMinutes,45);
    assert.equal(afterSupportedDuration?.activeTask?.commitmentIntent,false);
    assert.equal(harness.postsTo('bookings').length,0);

    const summary = await send('ตอนนี้ที่คุยไว้มีอะไรบ้าง');
    assert.match(summary,/ภาราดร/u);
    assert.match(summary,/45/u);
    assert.doesNotMatch(summary,/จองแล้ว|ยืนยันการจองแล้ว|ส่งคำขอจอง/u);

    await send('พักเรื่องม้าไว้ก่อน ขอโปรร้านอาหารที่คุ้มสุด แต่ไม่เอาแบบต้องสมัครสมาชิกเพิ่ม');
    await send('มีโปรไหม');

    const resumed = await send('กลับไปเรื่องม้าที่ค้างไว้');
    assert.doesNotMatch(resumed,/ตอนนี้มีม้า 2 ตัว/u,
      'resume must restore the held task rather than restart generic horse discovery');

    const afterResume = harness.getState(guestDbId)?.state?.taskState as {
      activeTask?: { domain?: string; slots?: Record<string,unknown>; commitmentIntent?: boolean };
      suspendedTask?: { domain?: string };
    } | undefined;
    assert.equal(afterResume?.activeTask?.domain,'activity');
    assert.equal(afterResume?.activeTask?.slots?.horseName,'ภาราดร');
    assert.equal(afterResume?.activeTask?.slots?.durationMinutes,45);
    assert.equal(afterResume?.activeTask?.commitmentIntent,false);

    await send('ตัวที่เลือกไว้วันที่ 6 ว่างไหม แต่ยังไม่จองนะ');
    await send('ถ้าวันนั้นไม่ว่างก็เอาไว้ก่อน ยังไม่ต้องทำอะไร');
    assert.equal(harness.postsTo('bookings').length,0);

    const bookingSummary = await send('สรุปให้หน่อยว่าตอนนี้ผมตกลงจองอะไรไปแล้วหรือยัง');
    assert.match(bookingSummary,/ยัง.*ไม่.*จอง|ไม่ได้.*จอง|ยังไม่ได้/u);
    assert.doesNotMatch(bookingSummary,/จองแล้ว|ยืนยันการจองแล้ว|ส่งคำขอจอง/u);

    const close = await send('โอเค ยังไม่จองครับ เดี๋ยวตัดสินใจแล้วจะบอกอีกที');
    assert.doesNotMatch(close,/หมายถึง.*ภาราดร.*ใช่ไหม/u);
    assert.equal(harness.postsTo('bookings').length,0);
  });
});

test('Phase 6 production-smoke repair: bad model output cannot promote selection to booking, stale horse context cannot steal an explicit food switch, and unsupported duration stays uncommitted', async () => {
  await withHarness(async harness => {
    const gid = guestId('phase6-production-smoke-repair');
    let event = 0;
    const send = async (message:string) => {
      event += 1;
      const result = await processThongthaiChatCore(
        brainRequest(message, gid, 'line'),
        `phase6-production-smoke-${event}`,
      );
      assert.equal(result.statusCode,200,message);
      return result.payload as Record<string,unknown>;
    };

    await send('ลืมที่คุยกันไปก่อนนะครับ');
    await send('มีม้าให้เลือกกี่ตัวครับ');
    await send('สองตัวนี้ต่างกันยังไงครับ');

    harness.programGeminiReply({
      normalizedMeaning:'customer books the remaining horse',
      reply:'ผมล็อกตัวเลือกภาราดรไว้ให้แล้วครับ ขอวันที่ เวลา และระยะเวลาครับ',
      speechAct:'transaction_request',domain:'activity',intent:'book_other_horse',
      action:'book',informationNeed:'none',entities:{resourceCode:'activity-horse',horseName:'ภาราดร'},
      references:[],constraints:[],confidence:0.99,needsClarification:false,
    });
    const selected = await send('ไม่เอาทองไทยนะครับ เอาอีกตัว');
    assert.notEqual(selected.intent,'booking','public intent must not claim a booking flow for a current selection');
    assert.doesNotMatch(text(selected),/ล็อก.*(?:จอง|ตัวเลือก)|ขอวันที่.*เวลา.*ระยะเวลา/u);
    assert.equal(harness.postsTo('bookings').length,0);

    const held = await send('เอาภาราดรไว้ก่อน แต่ยังไม่จองครับ');
    assert.doesNotMatch(text(held),/จองเรียบร้อย|ยืนยันการจองแล้ว/u);

    const unsupported = await send('เอา 60 นาทีครับ');
    assert.match(text(unsupported),/60 นาที.*ไม่มี|ไม่มี.*60 นาที/u);
    assert.match(text(unsupported),/30 นาที/u);
    assert.match(text(unsupported),/45 นาที/u);

    const guestDbId = harness.guestDbId(gid)!;
    const afterDuration = harness.getState(guestDbId)?.state?.taskState as {
      activeTask?: { slots?: Record<string,unknown>; commitmentIntent?: boolean };
    } | undefined;
    assert.equal(afterDuration?.activeTask?.slots?.horseName,'ภาราดร');
    assert.equal(afterDuration?.activeTask?.slots?.durationMinutes,undefined);
    assert.equal(afterDuration?.activeTask?.commitmentIntent,false);

    const supported = await send('งั้นขอ 45 นาที แต่ยังไม่จองนะครับ');
    assert.match(text(supported),/45\s*นาที/u);
    assert.doesNotMatch(text(supported),/ระบบจอง.*ตอบช้า|คิดช้ากว่าปกติ|ลองส่งอีกครั้ง/u,
      'a provider outage must not replace an exact no-booking duration update with a generic apology');

    const foodSwitch = await send('ขอถามเรื่องอาหารก่อนครับ');
    assert.doesNotMatch(text(foodSwitch),/หมายถึง.*ภาราดร|กำลังช่วยจอง/u);

    await send('แฟนแพ้กุ้งครับ');
    await send('ผมกินเผ็ดไม่เก่งด้วยครับ');
    // Phase 7 final boundary: this explicit "ตามที่บอกไป" restaurant
    // follow-up is now owned by the grounded deterministic fast path. That is
    // intentionally STRONGER than the old bad-model-output test: known live
    // menu facts + already-durable constraints must not spend a semantic/model
    // call at all. Leaving a scripted model completion queued here would make
    // the test harness feed that stale completion to the NEXT (horse-resume)
    // turn, which is not production behavior and falsely looks like restaurant
    // context stole the resume.
    const modelCallsBeforeMenu = harness.modelCallCount();
    const menu = await send('มีเมนูไหนเหมาะกับที่บอกไปบ้างครับ');
    assert.equal(
      harness.modelCallCount(),
      modelCallsBeforeMenu,
      'explicit prior-constraint menu follow-up must stay zero-model and grounded',
    );
    assert.match(text(menu),/ข้าวผัดหมู/u,'grounded response must select the catalog item compatible with remembered constraints');
    assert.match(text(menu),/กุ้ง/u,'response must explicitly apply the remembered shrimp constraint');
    assert.match(text(menu),/เผ็ด/u,'response must explicitly apply the remembered mild-spice preference');

    const resumed = await send('กลับมาเรื่องม้าที่เลือกไว้เมื่อกี้ครับ');
    assert.match(text(resumed),/ภาราดร/u);
    assert.match(text(resumed),/45\s*นาที/u,
      'an explicit resume must read back the restored duration as well as the horse');
    assert.doesNotMatch(text(resumed),/กำลังช่วยจอง/u);

    // Production Turn 14 exposed a language-supervisor omission: the model
    // kept the selected horse/duration and no-booking constraint, but dropped
    // the customer's availability information need. Program that exact shape
    // so the deterministic current-turn proof must restore the read-only need
    // before response composition.
    harness.programGeminiReply({
      normalizedMeaning:'customer keeps the current horse plan without booking',
      reply:'เลือกไว้เป็นภาราดร 45 นาทีครับ ยังไม่จอง',
      speechAct:'correction',domain:'activity',intent:'keep_current_plan',
      action:'correct_previous',informationNeed:'none',
      entities:{horseName:'ภาราดร',durationMinutes:45},references:[],
      constraints:['no_transaction'],confidence:0.99,needsClarification:false,
    });
    const availability = await send('เช็กว่างเฉย ๆ ได้ไหมครับ ยังไม่จอง');
    assert.match(text(availability),/ว่าง|คิว/u,
      'the final response must answer the availability request, not merely repeat selected slots');
    assert.match(text(availability),/ยัง.*ไม่.*จอง|ไม่ได้.*จอง/u,
      'the read-only availability answer must preserve the current no-booking consequence');
    assert.doesNotMatch(text(availability),/จองเรียบร้อย|ยืนยันการจองแล้ว|ส่งคำขอจอง/u);
    assert.equal(harness.postsTo('bookings').length,0);
  });
});
