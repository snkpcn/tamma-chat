import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PHASE7_MESSAGES,
  evaluatePhase7Turn,
  phase7ContractIsComplete,
} from '../scripts/phase7-production-certification-contract';

test('Phase 7 production contract covers every turn and never contains transaction authorization', () => {
  assert.equal(PHASE7_MESSAGES.length, 16);
  assert.equal(phase7ContractIsComplete(), true);
  for (const message of PHASE7_MESSAGES) {
    assert.doesNotMatch(message, /จองเลย|ยืนยันจอง|ชำระเลย|สั่งเลย/u);
  }
});

test('Phase 7 turn 14 accepts an honest live-source-unavailable answer', () => {
  const result = evaluatePhase7Turn({
    turnIndex: 13,
    httpStatus: 200,
    intent: 'information',
    message: 'ตอนนี้ยังเช็กคิวสดของ ภาราดร ให้ยืนยันไม่ได้ครับ และยังไม่ได้ทำรายการหรือจองอะไรให้',
  });
  assert.equal(result.pass, true);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.forbidden, []);
});

test('Phase 7 turn 14 accepts a bounded date/time question, not one magic availability phrase',()=>{
  const result=evaluatePhase7Turn({
    turnIndex:13,httpStatus:200,intent:'information',
    message:'ได้ครับ จะให้เช็กคิวว่างวันไหนและเวลาไหนครับ ตอนนี้ยังไม่ได้จอง',
  });
  assert.equal(result.pass,true);
});

test('Phase 7 turn 14 rejects a slot recap that ignores the availability question',()=>{
  const result=evaluatePhase7Turn({
    turnIndex:13,httpStatus:200,intent:'information',
    message:'เลือกไว้เป็น ภาราดร แล้วครับ • ระยะเวลา 45 นาที\nตอนนี้ยังไม่ได้จองหรือส่งรายการครับ',
  });
  assert.equal(result.pass,false);
  assert.ok(result.missing.some(item=>item.startsWith('meaning_not_satisfied:availability-only')));
});

test('Phase 7 turn 14 still rejects a generic outage, false booking intent, and missing no-transaction boundary', () => {
  const generic = evaluatePhase7Turn({
    turnIndex: 13,
    httpStatus: 200,
    intent: 'information',
    message: 'ระบบตอบช้าครับ ลองใหม่อีกครั้ง',
  });
  assert.equal(generic.pass, false);
  assert.ok(generic.forbidden.length > 0);

  const booking = evaluatePhase7Turn({
    turnIndex: 13,
    httpStatus: 200,
    intent: 'booking',
    message: 'ตอนนี้ยังเช็กคิวสดของ ภาราดร ให้ยืนยันไม่ได้ครับ และยังไม่ได้จองครับ',
  });
  assert.equal(booking.pass, false);
  assert.ok(booking.forbidden.includes('public intent=booking'));

  const missingBoundary = evaluatePhase7Turn({
    turnIndex: 13,
    httpStatus: 200,
    intent: 'information',
    message: 'ตอนนี้ยังเช็กคิวสดของ ภาราดร ให้ยืนยันไม่ได้ครับ',
  });
  assert.equal(missingBoundary.pass, false);
  assert.ok(missingBoundary.missing.length > 0);
});
