import test from 'node:test';
import assert from 'node:assert/strict';

import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { brainRequest, guestId, withHarness } from './helpers/canonical-core-harness';

test('Phase 7: food-allergy recommendation stays grounded before Agent Primary', async () => {
  const keys = [
    'THONGTHAI_AGENT_PRIMARY_ENABLED',
    'THONGTHAI_AGENT_PRIMARY_CHANNELS',
    'THONGTHAI_AGENT_PRIMARY_PERCENT',
    'THONGTHAI_AGENT_PRIMARY_PERCENT_LINE',
  ] as const;
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.THONGTHAI_AGENT_PRIMARY_ENABLED = '1';
  process.env.THONGTHAI_AGENT_PRIMARY_CHANNELS = 'web,line,facebook';
  process.env.THONGTHAI_AGENT_PRIMARY_PERCENT = '100';
  process.env.THONGTHAI_AGENT_PRIMARY_PERCENT_LINE = '100';

  try {
    await withHarness(async harness => {
      const gid = guestId('phase7-final-allergy-gate');
      const result = await processThongthaiChatCore(
        brainRequest('แฟนแพ้กุ้ง มีอะไรกินได้บ้าง', gid, 'line'),
        'phase7-final-allergy-gate-event',
      );
      const message = String(result.payload.message ?? '');

      assert.equal(result.statusCode, 200);
      assert.match(message, /กุ้ง/u);
      assert.doesNotMatch(message, /ต้มยำกุ้ง|ผัดไทยกุ้ง/u);
      assert.equal(harness.modelCallCount(), 0);
      assert.equal(harness.postsTo('bookings').length, 0);
    });
  } finally {
    for (const key of keys) {
      const value = before[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
