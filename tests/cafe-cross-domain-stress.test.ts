// Gate 1 cross-domain customer-level stress: CAFE, driven through the real
// canonical entry point processThongthaiChatCore (never hand-constructed
// SemanticTurn objects -- see tests/helpers/canonical-core-harness.ts).
//
// KNOWN GAP (documented here, not fixed under this program's scope
// discipline -- same class as stay's missing booking-task mechanism):
// _dialog-source-adapters.ts's buildRealKnowledgeSourceAdapters never
// builds an `adapters.cafe` entry at all, even though _knowledge-
// resolver.ts already has a real cafe_live source wired to look for one
// (adapters.cafe?.facts). So every cafe question -- hours, menu, price --
// honestly degrades to "no confirmed data" today, even when the answer
// exists in world_facts (see this harness's defaultCatalog, which already
// carries cafe_hours/cafe_latte_price). This is NOT a hallucination risk
// (the honest-degradation path is exactly correct GIVEN no adapter), but
// it IS a real, verified reachability gap: building the cafe knowledge
// adapter is a genuine feature addition, not a regex/classification fix,
// so it is left for a follow-up rather than attempted here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withHarness, guestId, brainRequest } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';

test('cafe: a cafe question honestly says it cannot confirm rather than inventing an answer', async () => {
  await withHarness(async harness => {
    const gid = guestId('cafe-honest-unknown');
    const r = await processThongthaiChatCore(brainRequest('มีลาเต้ไหม', gid, 'web'), 'evt-1');
    assert.equal(r.statusCode, 200);
    const message = String((r.payload as { message: string }).message);
    assert.doesNotMatch(message, /65\s*บาท|07:00|18:00/, 'must never assert a specific price/hours it has no real adapter for');
    assert.match(message, /ไม่มีข้อมูลยืนยัน|ไม่ขอเดา/, 'must honestly say it cannot confirm, never guess');
  });
});

test('cafe: a stay question mid-cafe-conversation switches domain instead of staying stuck on cafe', async () => {
  // Regression test for a real bug found during Gate 1 stress testing:
  // detectNonActivitySideQuestion's cafe branch matches on a bare "มี",
  // which reads naturally in ANY domain -- "มีห้องพักไหม" (is there a room
  // available) kept being answered as an unresolved CAFE question instead
  // of recognizing "ห้องพัก" as a clear stay-domain marker and switching.
  // Fixed by checking detectCrossDomainTopicSwitch's full per-domain
  // marker ladder BEFORE any same-domain side-question shortcut can claim
  // the turn (see _deterministic-semantic-turn.ts, deriveDeterministicSemanticTurn).
  await withHarness(async harness => {
    const gid = guestId('cafe-to-stay-topic-switch');
    await processThongthaiChatCore(brainRequest('มีลาเต้ไหม', gid, 'web'), 'evt-1');
    const r = await processThongthaiChatCore(brainRequest('มีห้องพักไหม', gid, 'web'), 'evt-2');
    assert.equal(r.statusCode, 200);
    assert.match(String((r.payload as { message: string }).message), /เฮือนสเตย์|ที่พัก/, 'must answer the real stay question, not stay stuck on cafe');
  });
});

test('cafe: switching away and explicitly returning resumes the cafe topic correctly', async () => {
  await withHarness(async harness => {
    const gid = guestId('cafe-resume-after-switch');
    await processThongthaiChatCore(brainRequest('มีลาเต้ไหม', gid, 'web'), 'evt-1');
    await processThongthaiChatCore(brainRequest('มีห้องพักไหม', gid, 'web'), 'evt-2');
    const resume = await processThongthaiChatCore(brainRequest('กลับมาถามกาแฟต่อ', gid, 'web'), 'evt-3');
    assert.equal(resume.statusCode, 200);
    // Honest "cannot confirm" is still the correct answer (no cafe adapter
    // yet) -- what this asserts is that it's answering AS cafe again, not
    // still stuck on stay.
    assert.match(String((resume.payload as { message: string }).message), /ไม่มีข้อมูลยืนยัน|ไม่ขอเดา/);
  });
});
