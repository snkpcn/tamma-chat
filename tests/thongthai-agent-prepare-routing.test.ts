import test from 'node:test';
import assert from 'node:assert/strict';
import { isAgentTransactionPrepareIntent } from '../netlify/functions/thongthai-chat';

test('ordinary affirmative booking request is eligible for prepare-only routing', () => {
  assert.equal(
    isAgentTransactionPrepareIntent(
      'ขอจองขี่ม้าน้องภาราดร 30 นาที วันที่ 16 ตุลาคม 2569 เวลา 10:00 จำนวน 1 คนครับ',
      'GENERAL',
    ),
    true,
  );
});

test('booking question and explicit withholding do not become prepare authorization', () => {
  assert.equal(isAgentTransactionPrepareIntent('ขี่ม้าจองได้ไหมครับ', 'GENERAL'), false);
  assert.equal(isAgentTransactionPrepareIntent('เอาภาราดรไว้ก่อน แต่ยังไม่จองครับ', 'GENERAL'), false);
});

test('explicit confirmation remains eligible to revisit a prepared draft', () => {
  assert.equal(isAgentTransactionPrepareIntent('ยืนยันจองครับ', 'GENERAL'), true);
});

test('explicit non-booking operational handoff can route prepare without a literal booking verb', () => {
  assert.equal(
    isAgentTransactionPrepareIntent(
      'ช่วยส่งคำถามให้ทีมคาเฟ่ว่าเตรียมลาเต้ 5 แก้วได้ไหมครับ',
      'BUSINESS_TRANSACTION',
    ),
    true,
  );
});

test('Phase 4 supersedes context-dependent acceptance as fresh prepare consent', () => {
  assert.equal(
    isAgentTransactionPrepareIntent('เอาตามที่คุยไว้ครับ', 'BUSINESS_TRANSACTION'),
    false,
  );
});
