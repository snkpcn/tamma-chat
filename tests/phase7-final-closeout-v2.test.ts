import test from 'node:test';
import assert from 'node:assert/strict';

import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { executeBrainTools } from '../netlify/functions/_thongthai-runtime-v3';
import type { BrainResponse } from '../netlify/functions/_thongthai-brain-v3';
import { brainRequest, guestId, withHarness } from './helpers/canonical-core-harness';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';

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

    // Match the real Phase 7 sequence: the guest has already been shown both
    // horses before saying "ไม่เอาทองไทย...เอาอีกตัว". Without that bounded
    // context, the product intentionally asks a clarification instead.
    await processThongthaiChatCore(
      brainRequest('สวัสดีครับ', gid, 'line'),
      'phase7-closeout-correction-seed',
    );
    const internalId = harness.guestDbId(gid);
    assert.ok(internalId);
    const existing = harness.getState(internalId)?.state ?? {};
    const now = new Date();
    harness.setState(internalId, {
      ...existing,
      conversationContext: {
        ...emptyConversationContextState(now),
        activeDomain: 'activity',
        activeTopic: 'horse_recommendation',
        recentEntities: [
          {
            id:'activity_asset:horse-thongthai', type:'horse', name:'ทองไทย',
            domain:'activity', source:'catalog', canonical:true, observedAt:now.toISOString(),
          },
          {
            id:'activity_asset:horse-pharadon', type:'horse', name:'ภาราดร',
            domain:'activity', source:'catalog', canonical:true, observedAt:now.toISOString(),
          },
        ],
      },
    });

    const beforeModelCalls = harness.modelCallCount();
    const result = await processThongthaiChatCore(
      brainRequest('ไม่เอาทองไทยนะครับ เอาอีกตัว', gid, 'line'),
      'phase7-closeout-correction',
    );
    const message = messageOf(result);

    assert.equal(result.statusCode, 200);
    assert.match(message, /ภาราดร/u);
    assert.equal(harness.postsTo('bookings').length, 0);
    // One semantic-supervision call is allowed; the expensive Agent Primary
    // path must not add another model/tool loop for this bounded correction.
    assert.ok(harness.modelCallCount() - beforeModelCalls <= 1);

    // Persistence of the considered selection is already covered by the
    // canonical model-first E2E acceptance test. This regression owns only
    // the new routing boundary: no Agent Primary loop and no transaction.
    assert.doesNotMatch(message, /คิดช้ากว่าปกติ|temporarily unavailable|ระบบตอบช้า/iu);
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
