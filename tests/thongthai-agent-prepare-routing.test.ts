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

test('routing-only business classification never becomes commercial authority by itself', () => {
  assert.equal(isAgentTransactionPrepareIntent('เอาตามที่คุยไว้ครับ', 'BUSINESS_TRANSACTION'), false);
  assert.equal(isAgentTransactionPrepareIntent('จองห้องได้ไหมครับ', 'BUSINESS_TRANSACTION'), false);
  assert.equal(isAgentTransactionPrepareIntent('สั่งอาหารได้ไหมครับ', 'BUSINESS_TRANSACTION'), false);
  assert.equal(isAgentTransactionPrepareIntent('เอาชุดนี้ครับ', 'BUSINESS_TRANSACTION'), false);
});

test('explicit current-turn commercial requests remain eligible for prepare-only routing', () => {
  assert.equal(isAgentTransactionPrepareIntent('ขอจองที่พักวันที่ 16 ตุลาคมครับ', 'BUSINESS_TRANSACTION'), true);
  assert.equal(isAgentTransactionPrepareIntent('สั่งอาหารชุดนี้ 1 ชุดครับ', 'BUSINESS_TRANSACTION'), true);
});

test('cafe staff handoff needs an explicit send request, not an availability question', () => {
  assert.equal(isAgentTransactionPrepareIntent('ส่งคำถามนี้ให้ทีมเลยครับ', 'BUSINESS_TRANSACTION'), true);
  assert.equal(isAgentTransactionPrepareIntent('ส่งคำถามนี้ให้ทีมได้ไหมครับ', 'BUSINESS_TRANSACTION'), false);
});
