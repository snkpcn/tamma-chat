import test from 'node:test';
import assert from 'node:assert/strict';

import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { executeBrainTools } from '../netlify/functions/_thongthai-runtime-v3';
import type { BrainResponse } from '../netlify/functions/_thongthai-brain-v3';
import { brainRequest, guestId, withHarness } from './helpers/canonical-core-harness';

function messageOf(result: Awaited<ReturnType<typeof processThongthaiChatCore>>): string {
  return String((result.payload as Record<string, unknown>).message ?? '');
}

test('Phase 7 closeout: contextual two-horse comparison is zero-model and grounded', async () => {
  await withHarness(async harness => {
    const gid = guestId('phase7-closeout-compare');
    const history = [
      { role:'user' as const, content:'มีม้าให้เลือกกี่ตัวครับ' },
      { role:'assistant' as const, content:'มี 2 ตัวครับ น้องทองไทย และน้องภาราดร' },
    ];
    const result = await processThongthaiChatCore(
      brainRequest('สองตัวนี้ต่างกันยังไงครับ', gid, 'line', history),
      'phase7-closeout-compare',
    );
    const message = messageOf(result);

    assert.equal(result.statusCode, 200);
    assert.match(message, /ทองไทย/u);
    assert.match(message, /ภาราดร/u);
    assert.match(message, /นิ่ม|กระด้าง/u);
    assert.equal(harness.modelCallCount(), 0);
    assert.equal(harness.postsTo('bookings').length, 0);
  });
});

test('Phase 7 closeout: reject-one-pick-the-other correction never enters Agent Primary', async () => {
  await withHarness(async harness => {
    const gid = guestId('phase7-closeout-correction');
    const result = await processThongthaiChatCore(
      brainRequest('ไม่เอาทองไทยนะครับ เอาอีกตัว', gid, 'line'),
      'phase7-closeout-correction',
    );
    const message = messageOf(result);

    assert.equal(result.statusCode, 200);
    assert.match(message, /ภาราดร/u);
    assert.match(message, /ยังไม่ได้จอง|ไม่ได้จอง/u);
    assert.equal(harness.modelCallCount(), 0);
    assert.equal(harness.postsTo('bookings').length, 0);

    const internalId = harness.guestDbId(gid);
    assert.ok(internalId);
    const taskState = harness.getState(internalId)?.state?.taskState as {
      activeTask?: { slots?: Record<string, unknown>; commitmentIntent?: boolean };
    } | undefined;
    assert.equal(taskState?.activeTask?.slots?.horseName, 'ภาราดร');
    assert.equal(taskState?.activeTask?.slots?.assetSelection, 'ภาราดร');
    assert.notEqual(taskState?.activeTask?.commitmentIntent, true);
  });
});

test('Phase 7 closeout: no-booking status readback uses guest booking truth, not catalog state', async () => {
  await withHarness(async harness => {
    const gid = guestId('phase7-closeout-status');
    const result = await processThongthaiChatCore(
      brainRequest('ตอนนี้ยังไม่ได้จองอะไรใช่ไหมครับ', gid, 'line'),
      'phase7-closeout-status',
    );
    const message = messageOf(result);

    assert.equal(result.statusCode, 200);
    assert.match(message, /ยังไม่มีรายการจอง|ยังไม่ได้จอง/u);
    assert.doesNotMatch(message, /ไม่มีตัวเลือกที่ตรง|แคตตาล็อก|catalog/iu);
    assert.equal(harness.modelCallCount(), 0);
    assert.equal(harness.postsTo('bookings').length, 0);
  });
});

test('TEST transaction environment propagates into durable booking writes', async () => {
  await withHarness(async harness => {
    const gid = guestId('phase7-test-environment');
    const request = {
      ...brainRequest('E2E TEST booking', gid, 'web'),
      environment:'test' as const,
    };
    const firstResponse: BrainResponse = {
      message:'',
      intent:'information',
      contextUpdates:{},
      journeyAction:{type:'none',journey:null},
      suggestedActions:[],
      responseStyle:'direct',
      semanticMemoryUpdates:[],
      toolCalls:[],
    };

    const results = await executeBrainTools(
      gid,
      'web',
      [{
        name:'create_booking',
        args:{
          serviceType:'stay',
          resourceCode:'stay-hueun',
          date:'2026-10-17',
          endDate:'2026-10-18',
          partySize:2,
          quantity:1,
          customerName:'E2E TEST',
        },
      }],
      firstResponse,
      request,
    );

    assert.equal(results[0]?.ok, true);
    const booking = harness.postsTo('bookings')[0];
    assert.ok(booking);
    assert.equal(booking.environment, 'test');
    const account = harness.postsTo('customer_accounts').find(row => row.guest_id === gid);
    assert.equal(account?.is_test, true);
  });
});
