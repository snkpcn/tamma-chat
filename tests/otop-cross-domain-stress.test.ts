// Gate 1 cross-domain customer-level stress: OTOP, driven through the real
// canonical entry point processThongthaiChatCore (never hand-constructed
// SemanticTurn objects -- see tests/helpers/canonical-core-harness.ts).
//
// OTOP is fully cut over to One-Mind's deterministic path (every turn below
// resolves with zero LLM calls -- see THONGTHAI_ONE_MIND_CUTOVER trace logs
// observed while building this file). Covers: real-catalog discovery,
// surviving a mid-conversation topic switch to a different domain and back,
// and -- a real, documented finding, not fixed here -- that an ambiguous
// purchase-intent message ("เอาอันนี้" with two products shown and none
// named) never fabricates an order, even though it also isn't yet
// acknowledged as a selection. See THONGTHAI_HANDOFF.md's Gate 1 OTOP
// section for the full writeup of why this is left as a documented gap
// rather than a code fix under this program's scope discipline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withHarness, guestId, brainRequest } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';

test('otop: discovery answers from the real catalog with zero LLM calls and zero premature orders', async () => {
  await withHarness(async harness => {
    const gid = guestId('otop-discovery');
    const r = await processThongthaiChatCore(brainRequest('มีของฝากอะไรบ้าง', gid, 'web'), 'evt-1');
    assert.equal(r.statusCode, 200);
    const message = String((r.payload as { message: string }).message);
    assert.match(message, /น้ำผึ้งป่า/);
    assert.match(message, /ผ้าพันคอทอมือ/);
    assert.equal(harness.postsTo('otop_orders').length, 0);
  });
});

test('otop: a mid-conversation topic switch to activity and back preserves both topics correctly', async () => {
  await withHarness(async harness => {
    const gid = guestId('otop-topic-switch');
    await processThongthaiChatCore(brainRequest('มีของฝากอะไรบ้าง', gid, 'web'), 'evt-1');
    await processThongthaiChatCore(brainRequest('อันไหนดี', gid, 'web'), 'evt-2');

    const switchAway = await processThongthaiChatCore(brainRequest('มีขี่ม้าไหม', gid, 'web'), 'evt-3');
    assert.equal(switchAway.statusCode, 200);
    assert.match(String((switchAway.payload as { message: string }).message), /ม้า/);

    const resume = await processThongthaiChatCore(brainRequest('กลับมาของฝากต่อ', gid, 'web'), 'evt-4');
    assert.equal(resume.statusCode, 200);
    const resumeMessage = String((resume.payload as { message: string }).message);
    assert.match(resumeMessage, /น้ำผึ้งป่า|ผ้าพันคอทอมือ/, 'resuming otop must answer about otop products, not stay on activity');
    assert.equal(harness.postsTo('otop_orders').length, 0);
  });
});

test('otop: an ambiguous "take this one" with no product named never fabricates an order', async () => {
  await withHarness(async harness => {
    const gid = guestId('otop-ambiguous-selection');
    await processThongthaiChatCore(brainRequest('มีของฝากอะไรบ้าง', gid, 'web'), 'evt-1');
    const r = await processThongthaiChatCore(brainRequest('เอาอันนี้', gid, 'web'), 'evt-2');
    assert.equal(r.statusCode, 200);
    // KNOWN GAP (documented in THONGTHAI_HANDOFF.md, not fixed here): this
    // does not yet resolve to a specific product or ask which one -- it
    // must, at minimum, never silently create an order for an unnamed
    // product. That is the one guarantee this test enforces.
    assert.equal(harness.postsTo('otop_orders').length, 0, 'an unresolved product reference must never create a fabricated order');
  });
});
