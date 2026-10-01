import test from 'node:test';
import assert from 'node:assert/strict';

import {
  THONGTHAI_PREPARE_ONLY_TRANSACTION_TOOLS,
  currentTurnExplicitlyConfirmsPreparedBooking,
  currentTurnExplicitlyConfirmsCafeInquiry,
  executeThongthaiTransactionTool,
} from '../netlify/functions/_thongthai-agent-transactions';

const commitTools = [
  'commit_prepared_activity_booking',
  'commit_prepared_stay_booking',
  'commit_prepared_restaurant_preorder',
  'commit_prepared_otop_order',
  'commit_prepared_cafe_inquiry',
] as const;

test('prepare-only surface never exposes a commit tool for any vertical', () => {
  const names = new Set(THONGTHAI_PREPARE_ONLY_TRANSACTION_TOOLS.map(tool => tool.name));
  for (const name of commitTools) assert.equal(names.has(name), false, name);
});

test('confirmation mixed with a correction cannot commit the stale draft', () => {
  assert.equal(currentTurnExplicitlyConfirmsPreparedBooking('ยืนยันจอง แต่ขอแก้เป็น 45 นาที'), false);
  assert.equal(currentTurnExplicitlyConfirmsPreparedBooking('ยืนยันสั่ง แต่เปลี่ยนจำนวนเป็น 2 ชิ้น'), false);
  assert.equal(currentTurnExplicitlyConfirmsCafeInquiry('ยืนยันส่งคำถาม แต่ขอแก้เป็นรับ 10:00'), false);
});

test('prepare-only runtime hard-blocks all five commit tools before business writes', async () => {
  for (const name of commitTools) {
    const raw = await executeThongthaiTransactionTool(
      name,
      { confirmation_id:'phase2-safety-id' },
      {
        guestDbId:'phase2-safety-db',
        channel:'web',
        environment:'live',
        eventId:'phase2-safety-event',
        message:name === 'commit_prepared_cafe_inquiry' ? 'ยืนยันส่งคำถาม' : 'ยืนยันจอง',
        transactionMode:'prepare',
      },
    );
    const result = JSON.parse(raw) as Record<string,unknown>;
    assert.equal(result.ok, false, name);
    assert.equal(result.error, 'transaction_commit_disabled', name);
    assert.equal(result.prepared_only, true, name);
  }
});
