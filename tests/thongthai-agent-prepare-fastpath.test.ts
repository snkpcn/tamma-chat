import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activityPrepareOnlyToolArgs,
  composeActivityPrepareOnlyResponse,
} from '../netlify/functions/thongthai-chat';

test('activity prepare fast path maps a complete structured draft without an LLM/tool preflight', () => {
  assert.deepEqual(activityPrepareOnlyToolArgs({
    serviceType:'activity',
    horseName:'ภาราดร',
    date:'2026-10-22',
    time:'10:00',
    durationMinutes:30,
    partySize:1,
    customerName:'TEST',
    phone:'0000000015',
  }), {
    activity_code:'horse',
    asset_name:'ภาราดร',
    date:'2026-10-22',
    time:'10:00',
    duration_minutes:30,
    party_size:1,
    customer_name:'TEST',
    phone:'0000000015',
  });
});

test('activity prepare fast path refuses incomplete drafts', () => {
  assert.equal(activityPrepareOnlyToolArgs({
    horseName:'ภาราดร',
    date:'2026-10-22',
  }), null);
});

test('prepared response is explicit that nothing was submitted and preserves exact confirmation phrase', () => {
  const response=composeActivityPrepareOnlyResponse({
    ok:true,
    prepared:true,
    exact_confirmation_phrase_th:'ยืนยันจอง',
    summary:{
      asset:'ภาราดร',
      date:'2026-10-22',
      time:'10:00',
      duration_minutes:30,
      party_size:1,
      expected_price:300,
      customer_name:'TEST',
      phone:'0000000015',
    },
  });
  assert.ok(response);
  assert.match(response.message,/ยังไม่ได้ส่งจองจริง/u);
  assert.match(response.message,/น้องภาราดร/u);
  assert.match(response.message,/ยืนยันจอง/u);
  assert.doesNotMatch(response.message,/จองสำเร็จ|ส่งคำขอจองเข้าระบบแล้ว/u);
});

test('confirmation during prepare-only Gate 0 stays pending and never claims a booking', () => {
  const response=composeActivityPrepareOnlyResponse({
    ok:true,
    prepared:true,
    exact_confirmation_phrase_th:'ยืนยันจอง',
    summary:{asset_name:'ภาราดร'},
  },true);
  assert.ok(response);
  assert.match(response.message,/ยังไม่เปิดให้ส่งคำขอจองจริง/u);
  assert.match(response.message,/ยังไม่มีการสร้างการจอง/u);
  assert.doesNotMatch(response.message,/จองสำเร็จ|ยืนยันการจองแล้ว/u);
});


test('activity prepare fast path does not require the legacy resourceCode slot', () => {
  const args=activityPrepareOnlyToolArgs({
    horseName:'ภาราดร',
    date:'2026-10-24',
    time:'10:00',
    durationMinutes:30,
    partySize:1,
    customerName:'PREPARE ONLY',
    phone:'0000000099',
  });
  assert.ok(args);
  assert.equal(args.activity_code,'horse');
  assert.equal(args.asset_name,'ภาราดร');
});
