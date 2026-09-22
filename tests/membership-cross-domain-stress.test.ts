// Gate 1 cross-domain customer-level stress: MEMBERSHIP, driven through the
// real canonical entry point processThongthaiChatCore (never hand-
// constructed SemanticTurn objects -- see tests/helpers/canonical-core-
// harness.ts). Membership is fully cut over to One-Mind's deterministic
// path (zero LLM calls for every turn below).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withHarness, guestId, brainRequest } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';

test('membership: "how do I sign up" gets sign-up instructions, not a status answer', async () => {
  await withHarness(async harness => {
    const gid = guestId('membership-how-to-signup');
    const r = await processThongthaiChatCore(brainRequest('สมัครสมาชิกยังไง', gid, 'web'), 'evt-1');
    assert.equal(r.statusCode, 200);
    assert.match(String((r.payload as { message: string }).message), /สมัครสมาชิก/);
  });
});

test('membership: "am I already a member" is answered as a real status question, not misrouted to sign-up instructions', async () => {
  // Regression test for a real bug found during Gate 1 stress testing: the
  // deterministic classifier only recognized an explicit "สถานะ"/"เช็ค"/
  // "ตรวจ"/"ดู" keyword as a status question. "ตอนนี้ผมเป็นสมาชิกหรือยัง"
  // (a completely ordinary way to ask "am I a member yet?") contained none
  // of them, so it silently got the SAME canned "here's how to sign up"
  // copy as an actual how-to-sign-up question -- never even attempting a
  // real status lookup. Fixed by recognizing "หรือยัง"/"รึยัง"/"หรือเปล่า"
  // (the ordinary Thai yet/not-yet question particles) as status markers
  // too (see _deterministic-semantic-turn.ts's MEMBERSHIP_STATUS_ACTION_MARKER).
  await withHarness(async harness => {
    const gid = guestId('membership-status-question');
    const r = await processThongthaiChatCore(brainRequest('ตอนนี้ผมเป็นสมาชิกหรือยัง', gid, 'web'), 'evt-1');
    assert.equal(r.statusCode, 200);
    const message = String((r.payload as { message: string }).message);
    assert.doesNotMatch(
      message, /พิมพ์.*สมัครสมาชิก.*แล้วทองไทยจะพาใส่ข้อมูล/u,
      'a status question must not get the generic "here\'s how to sign up" script -- it never even looked up the real status',
    );
  });
});

test('membership: a promotion side-question mid-membership-conversation is answered, then signup resumes correctly', async () => {
  await withHarness(async harness => {
    const gid = guestId('membership-promo-side-question');
    await processThongthaiChatCore(brainRequest('สมัครสมาชิกยังไง', gid, 'web'), 'evt-1');
    const promoTurn = await processThongthaiChatCore(brainRequest('มีโปรอะไร', gid, 'web'), 'evt-2');
    assert.match(String((promoTurn.payload as { message: string }).message), /โปรโมชั่น/);

    const resume = await processThongthaiChatCore(brainRequest('กลับมาสมัครต่อ', gid, 'web'), 'evt-3');
    assert.equal(resume.statusCode, 200);
    assert.match(String((resume.payload as { message: string }).message), /สมัครสมาชิก/);
  });
});
