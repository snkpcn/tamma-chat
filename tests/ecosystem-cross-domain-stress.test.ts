// Gate 1 cross-domain customer-level stress: GENERAL ECOSYSTEM (broad,
// pre-domain discovery), driven through the real canonical entry point
// processThongthaiChatCore (never hand-constructed SemanticTurn objects --
// see tests/helpers/canonical-core-harness.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withHarness, guestId, brainRequest } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';

test('ecosystem: a first-visit discovery question surfaces every business category, never forces one domain early', async () => {
  await withHarness(async harness => {
    const gid = guestId('ecosystem-first-visit');
    const r = await processThongthaiChatCore(brainRequest('มาครั้งแรกมีอะไรแนะนำ', gid, 'web'), 'evt-1');
    assert.equal(r.statusCode, 200);
    const message = String((r.payload as { message: string }).message);
    // Must mention at least restaurant, activity, and stay -- never collapse
    // a genuinely broad "what's here" question into a single business unit.
    assert.match(message, /กิน|ตำมา-ชาติ|อาหาร/);
    assert.match(message, /กิจกรรม|ขี่ม้า/);
    assert.match(message, /พัก|เฮือนสเตย์/);
  });
});

test('ecosystem: refining context (companion, time budget, mobility) never fabricates a specific recommendation without the model, and never writes a transaction', async () => {
  await withHarness(async harness => {
    const gid = guestId('ecosystem-refine-context');
    await processThongthaiChatCore(brainRequest('มาครั้งแรกมีอะไรแนะนำ', gid, 'web'), 'evt-1');

    // These refinement turns need real contextual synthesis (companion type
    // + time budget + mobility preference -> a combined suggestion) --
    // legitimately an LLM-judgment task, not something the deterministic
    // layer should guess at. With no scripted model reply, the safe default
    // must be an honest non-answer, never an invented specific plan.
    for (const [i, message] of ['พาแฟนมา', 'มีเวลา 3 ชั่วโมง', 'ไม่อยากเดินเยอะ'].entries()) {
      const r = await processThongthaiChatCore(brainRequest(message, gid, 'web'), `evt-${i + 2}`);
      assert.equal(r.statusCode, 200);
      assert.doesNotMatch(
        String((r.payload as { message: string }).message), /บาท|นาที|โมง.*ครับ.*แนะนำ/,
        `turn "${message}" must never fabricate a specific plan/price without real model input`,
      );
    }
    assert.equal(harness.postsTo('bookings').length, 0);
    assert.equal(harness.postsTo('restaurant_preorders_rpc').length, 0);
    assert.equal(harness.postsTo('otop_orders').length, 0);
  });
});

test('ecosystem: with a real model turn available, refined context produces an honest, grounded synthesis (proves the mechanism, not prompt quality)', async () => {
  await withHarness(async harness => {
    const gid = guestId('ecosystem-refine-with-model');
    await processThongthaiChatCore(brainRequest('มาครั้งแรกมีอะไรแนะนำ', gid, 'web'), 'evt-1');

    // This turn makes THREE model calls before the real reply is used: two
    // semantic-interpreter passes (One-Mind's own shadow pass, discarded
    // whenever the domain isn't cut over -- see
    // THONGTHAI_ONE_MIND_LEGACY_REQUIRED in the observability trace -- plus
    // a second one from elsewhere in the legacy routing for this message
    // shape) and then the real legacy brain call this response actually
    // comes from. The scripted-reply queue is FIFO across every caller, so
    // two throwaway replies must be queued first (verified empirically by
    // tracing THONGTHAI_MODEL_PROVIDER_SUCCESS log lines -- do not assume a
    // fixed call count for a different message without re-checking).
    harness.programGeminiReply({ message: 'shadow-pass-placeholder-1', intent: 'conversation' });
    harness.programGeminiReply({ message: 'shadow-pass-placeholder-2', intent: 'conversation' });
    harness.programGeminiReply({
      message: 'พาแฟนมา 3 ชั่วโมง ไม่อยากเดินเยอะ ทองไทยแนะนำนั่งชิลที่ Inthanin แล้วต่อด้วยมื้ออาหารที่ตำมา-ชาติครับ',
      intent: 'recommendation',
    });
    const r = await processThongthaiChatCore(brainRequest('ไม่อยากเดินเยอะ พาแฟนมา มีเวลา 3 ชั่วโมง', gid, 'web'), 'evt-2');
    assert.equal(r.statusCode, 200);
    assert.match(String((r.payload as { message: string }).message), /Inthanin|ตำมา-ชาติ/);
    assert.equal(harness.postsTo('bookings').length, 0, 'a suggestion alone must never create a transaction');
  });
});
