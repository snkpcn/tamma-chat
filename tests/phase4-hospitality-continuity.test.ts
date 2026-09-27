import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withHarness, guestId, brainRequest } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';

function text(payload: Record<string, unknown>): string {
  return String(payload.message ?? '');
}

async function turn(gid: string, event: string, message: string) {
  return processThongthaiChatCore(brainRequest(message, gid, 'web'), event);
}

test('Phase 4 continuity: broad host opener -> สายกิจกรรม keeps the full activity path, including ATV', async () => {
  await withHarness(async harness => {
    const gid = guestId('phase4-continuity-activity');

    const first = await turn(gid, 'phase4-continuity-activity-1', 'มีอะไรแนะนำ');
    assert.equal(first.statusCode, 200);
    assert.match(text(first.payload), /สายกิจกรรม/u);

    const second = await turn(gid, 'phase4-continuity-activity-2', 'สายกิจกรรม');
    assert.equal(second.statusCode, 200);
    const answer = text(second.payload);
    assert.match(answer, /ขี่ม้า/u);
    assert.match(answer, /ATV|เอทีวี/u, 'the full activity path must not collapse into the old light-activity branch');
    assert.match(answer, /ยิงธนู/u);
    assert.equal(harness.postsTo('bookings').length, 0, 'choosing a path is discovery, never an implicit booking');
  });
});

test('Phase 4 continuity: broad host opener -> สายพัก asks useful stay context without claiming availability', async () => {
  await withHarness(async harness => {
    const gid = guestId('phase4-continuity-stay');

    await turn(gid, 'phase4-continuity-stay-1', 'มีอะไรแนะนำ');
    const second = await turn(gid, 'phase4-continuity-stay-2', 'สายพัก');
    assert.equal(second.statusCode, 200);
    const answer = text(second.payload);
    assert.match(answer, /เฮือนสเตย์|ที่พัก/u);
    assert.match(answer, /กี่คน|กี่คืน/u);
    assert.doesNotMatch(answer, /มีห้องว่าง|ว่างแน่นอน|จองได้แน่นอน/u);
    assert.equal(harness.postsTo('bookings').length, 0);
  });
});

test('Phase 4 continuity: a specific cafe question overrides a stale ecosystem choice prompt', async () => {
  await withHarness(async harness => {
    const gid = guestId('phase4-continuity-cafe');

    await turn(gid, 'phase4-continuity-cafe-1', 'มีอะไรแนะนำ');
    const second = await turn(gid, 'phase4-continuity-cafe-2', 'คาเฟ่มีลาเต้ไหม');
    assert.equal(second.statusCode, 200);
    const answer = text(second.payload);
    assert.match(answer, /ไม่มีข้อมูล.*ยืนยัน|ไม่ขอเดา/u);
    assert.doesNotMatch(answer, /65\s*บาท|07:00|18:00/u);
    assert.equal(harness.modelCallCount(), 2, 'both ordinary turns must be language-supervised once; cafe handling stays grounded afterward');
  });
});

test('Phase 4 continuity: complaint and refund still preempt an ecosystem follow-up', async () => {
  await withHarness(async harness => {
    const complaintGid = guestId('phase4-continuity-complaint');
    await turn(complaintGid, 'phase4-continuity-complaint-1', 'มีอะไรแนะนำ');
    const complaint = await turn(complaintGid, 'phase4-continuity-complaint-2', 'บริการแย่มาก');
    assert.match(text(complaint.payload), /ขอโทษ/u);
    assert.equal(harness.postsTo('ops_feedback_events').length, 1);

    const refundGid = guestId('phase4-continuity-refund');
    await turn(refundGid, 'phase4-continuity-refund-1', 'มีอะไรแนะนำ');
    const refund = await turn(refundGid, 'phase4-continuity-refund-2', 'ขอคืนเงินได้ไหม');
    assert.match(text(refund.payload), /คืนเงิน|เจ้าของ/u);
    assert.equal(harness.postsTo('ops_feedback_events').length, 2);
  });
});

test('Phase 4 continuity: explicit location/weather/booking switches never get pulled back into stale ecosystem state', async () => {
  await withHarness(async harness => {
    harness.programWeatherFetch({
      ok:true,
      body:{
        weather:[{ description:'เมฆบางส่วน' }],
        main:{ temp:30, feels_like:33, humidity:70 },
        wind:{ speed:2 },
        rain:{},
      },
    });

    const gid = guestId('phase4-continuity-switch');
    await turn(gid, 'phase4-continuity-switch-1', 'มีอะไรแนะนำ');

    const location = await turn(gid, 'phase4-continuity-switch-2', 'ทำมา-ชาติอยู่ที่ไหน');
    assert.match(text(location.payload), /maps\.app\.goo\.gl|ปักหมุด/u);

    const weather = await turn(gid, 'phase4-continuity-switch-3', 'วันนี้ฝนตกไหม');
    assert.match(text(weather.payload), /ฝน|เมฆ|30/u);

    const booking = await turn(gid, 'phase4-continuity-switch-4', 'อยากจองขี่ม้าพรุ่งนี้');
    assert.match(text(booking.payload), /จอง|ขี่ม้า|เวลา|ระยะเวลา/u);
    assert.doesNotMatch(text(booking.payload), /สายชิล|สายพัก/u);
  });
});
