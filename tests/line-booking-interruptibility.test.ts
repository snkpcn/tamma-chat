import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldConsumeLegacyLineBookingTurn, type LineBookingSession } from '../netlify/functions/_operations-db';
import { CONTEXT_TTL_MS } from '../netlify/functions/_conversation-context';

const NOW = new Date('2026-09-20T07:00:00.000Z');
function activitySession(updatedAt = NOW.toISOString()): LineBookingSession {
  return { service_type:'activity', resource_code:'activity-horse', requested_date:null, requested_time:null, end_date:null, party_size:null, quantity:1, special_request:null, status:'collecting', booking_code:null, updated_at:updatedAt };
}
function staySession(updatedAt = NOW.toISOString()): LineBookingSession {
  return { service_type:'stay', resource_code:null, requested_date:'2026-09-22', requested_time:null, end_date:null, party_size:null, quantity:1, special_request:null, status:'collecting', booking_code:null, updated_at:updatedAt };
}
test('legacy activity session never hijacks general conversation', () => {
  for (const message of ['หวัดดีจ้า','หลอนป่ะเนี่ย','โอเคจ้า']) assert.equal(shouldConsumeLegacyLineBookingTurn(activitySession(), message, NOW), false, message);
});
test('legacy activity session never hijacks side questions', () => {
  for (const message of ['ตัวไหนนิสัยดีกว่า','จะขี่ม้าไง','บ่ายสามได้ปะ','ราคาเท่าไหร่']) assert.equal(shouldConsumeLegacyLineBookingTurn(activitySession(), message, NOW), false, message);
});
test('legacy activity session still consumes clear slot fills', () => {
  for (const message of ['60 นาที','พรุ่งนี้ 2 คน','15:00 น.','ชื่อ สมชาย','0891234567']) assert.equal(shouldConsumeLegacyLineBookingTurn(activitySession(), message, NOW), true, message);
});
test('stale legacy booking requires explicit resume', () => {
  const old = new Date(NOW.getTime() - CONTEXT_TTL_MS - 1000).toISOString();
  assert.equal(shouldConsumeLegacyLineBookingTurn(activitySession(old), '60 นาที', NOW), false);
  assert.equal(shouldConsumeLegacyLineBookingTurn(activitySession(old), 'หวัดดีจ้า', NOW), false);
  assert.equal(shouldConsumeLegacyLineBookingTurn(activitySession(old), 'กลับมาจองม้าต่อ', NOW), true);
});
test('stay sessions have the same interruptibility rule', () => {
  assert.equal(shouldConsumeLegacyLineBookingTurn(staySession(), 'หวัดดีจ้า', NOW), false);
  assert.equal(shouldConsumeLegacyLineBookingTurn(staySession(), 'ร้านมีไรกิน', NOW), false);
  assert.equal(shouldConsumeLegacyLineBookingTurn(staySession(), 'เช็คเอาท์ 24/09', NOW), true);
  assert.equal(shouldConsumeLegacyLineBookingTurn(staySession(), 'พัก 2 คน', NOW), true);
});
test('informational activity questions never start a legacy booking', () => {
  assert.equal(shouldConsumeLegacyLineBookingTurn(null, 'จะขี่ม้าไง', NOW), false);
  assert.equal(shouldConsumeLegacyLineBookingTurn(null, 'ตัวไหนนิสัยดีกว่า', NOW), false);
  assert.equal(shouldConsumeLegacyLineBookingTurn(null, 'จองขี่ม้าพรุ่งนี้', NOW), true);
});
