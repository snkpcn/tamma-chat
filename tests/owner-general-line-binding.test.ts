// Feedback Operations Phase 1 hotfix -- adds a real, bindable
// 'owner_general' LINE team (distinct from the pre-existing 'all'
// pseudo-team, which stays unbindable) so system/general/unknown feedback
// and the urgent-safety escalation have somewhere real to go once an
// owner actually binds it. See _ops-notifications.ts's parseTeamCode and
// FEEDBACK_BUSINESS_UNIT_TEAM, and THONGTHAI_HANDOFF.md's Feedback
// Operations Phase 1 entry for the full writeup. Until it's bound, every
// assertion here proves the system stays honest -- notification_status
// stays 'not_bound', nothing is silently claimed as sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withHarness, guestId, brainRequest } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { handleLineOpsGroupMessage } from '../netlify/functions/_ops-notifications';

function msg(payload: unknown): string {
  return String((payload as { message: string }).message);
}

async function ask(seed: string, message: string) {
  const gid = guestId(seed);
  return processThongthaiChatCore(brainRequest(message, gid, 'web'), 'evt-1');
}

// Each withHarness() call gets a fresh in-memory sequence, so a test that
// creates exactly one feedback event can always find it under this
// deterministic first id.
const FIRST_EVENT_ID = 'feedback-event-1';

const OWNER_GENERAL_ALIASES = ['owner', 'general', 'admin', 'เจ้าของ', 'ทั่วไป', 'แอดมิน', 'ผู้ดูแล'];

test('1. parseTeamCode (via the real ผูกทีม command) accepts every owner/general/admin alias', async () => {
  await withHarness(async () => {
    for (const alias of OWNER_GENERAL_ALIASES) {
      const reply = await handleLineOpsGroupMessage({
        targetType: 'group',
        targetId: `test-group-${alias}`,
        userId: 'staff-1',
        text: `ผูกทีม ${alias}`,
      });
      assert.match(reply ?? '', /ผูกกลุ่มนี้กับทีม เจ้าของ\/ทั่วไป แล้วครับ/u, `alias "${alias}" must bind to owner_general`);
    }
  });
});

test('2. Existing team codes still bind exactly as before (restaurant/activity/stay/cafe)', async () => {
  await withHarness(async () => {
    const cases: Array<[string, RegExp]> = [
      ['restaurant', /ตำมา-ชาติ \/ ร้านอาหาร/u],
      ['activity', /ทำมา-ชาติ ผจญภัย/u],
      ['stay', /ทำมา-ชาติ เฮือนสเตย์/u],
      ['cafe', /Inthanin Café/u],
    ];
    for (const [code, labelPattern] of cases) {
      const reply = await handleLineOpsGroupMessage({
        targetType: 'group',
        targetId: `test-group-${code}`,
        userId: 'staff-1',
        text: `ผูกทีม ${code}`,
      });
      assert.match(reply ?? '', labelPattern, `"${code}" must still bind to its existing team`);
    }
  });
});

test('3. Unknown/nonsense team names still reject, and "all" itself stays unbindable', async () => {
  await withHarness(async () => {
    for (const text of ['ผูกทีม blahblah123', 'ผูกทีม all', 'ผูกทีม ทั้งหมด']) {
      const reply = await handleLineOpsGroupMessage({ targetType: 'group', targetId: 'test-group-x', userId: 'staff-1', text });
      assert.match(reply ?? '', /ยังไม่รู้จักชื่อนี้ครับ/u, `"${text}" must be rejected`);
    }
  });
});

test('4. System feedback with owner_general NOT bound: event stored, notification_status honestly not_bound', async () => {
  await withHarness(async harness => {
    const r = await ask('og-system-feedback', 'ทองไทยตอบยาวไป');
    assert.equal(r.statusCode, 200);
    assert.match(msg(r.payload), /จะส่งต่อให้เจ้านายกับทีมที่เกี่ยวข้องครับ/u, 'customer sees the honest future-tense wording, never a false "already sent"');
    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1);
    assert.equal(events[0].feedback_type, 'system_feedback');
    const row = harness.feedbackEventRow(FIRST_EVENT_ID);
    assert.equal(row?.notification_status, 'not_bound', 'owner_general has no bound channel yet -- must never claim sent');
  });
});

test('5. Unknown/general complaint with owner_general NOT bound: event stored, notification_status honestly not_bound', async () => {
  await withHarness(async harness => {
    const r = await ask('og-general-complaint', 'บริการแย่มาก');
    assert.equal(r.statusCode, 200);
    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1);
    assert.equal(events[0].feedback_type, 'complaint');
    assert.equal(events[0].business_unit, 'unknown', 'a bare complaint with no business-unit keyword stays unknown');
    assert.equal(events[0].route_target, 'owner_general');
    const row = harness.feedbackEventRow(FIRST_EVENT_ID);
    assert.equal(row?.notification_status, 'not_bound');
  });
});

// NOTE: as of the "Post-PR67 Polish" round, safety_issue ALWAYS escalates
// to owner_general (not only 'urgent' severity -- see _ops-notifications.ts's
// needsOwnerEscalation), and the customer-facing wording now names
// PRECISELY which target(s) actually sent instead of one collapsed
// "already routed" line for any partial success. Tests 6-7 below were
// updated for that more honest, more precise wording; their own intent
// (never claim an unbound escalation succeeded) is unchanged.
test('6. Urgent safety with activity bound but owner_general NOT bound: primary sends, escalation honestly recorded as not_bound', async () => {
  await withHarness(async harness => {
    harness.programOpsChannel('activity');
    // "บาดเจ็บ" is the actual URGENT_SAFETY_MARKER (an in-progress injury,
    // not just a scary-looking condition) -- see
    // _service-mind-feedback-intent.ts. A message like "พื้นลื่นมาก...
    // น่ากลัว" reaches SAFETY_CONCERN_MARKER's 'high' severity instead,
    // which (since PR66-production-precedence) ALSO escalates now, since
    // every safety_issue does regardless of severity.
    const r = await ask('og-urgent-safety-partial', 'ขี่ม้าแล้วบาดเจ็บ');
    assert.equal(r.statusCode, 200);
    assert.match(
      msg(r.payload),
      /ส่งให้ทีมกิจกรรมแล้วครับ ส่วนแจ้งเจ้าของยังไม่สำเร็จ/u,
      'primary (activity) team is bound and sent; owner_general escalation is honestly reported as not yet sent, never faked',
    );
    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1);
    assert.equal(events[0].feedback_type, 'safety_issue');
    assert.equal(events[0].business_unit, 'activity');
    const row = harness.feedbackEventRow(FIRST_EVENT_ID);
    assert.equal(row?.notification_status, 'sent', 'the primary activity send succeeded and must be reported as such');
    const targets = (row?.internal_notes as { notification_targets?: Array<{ team: string; status: string }> } | undefined)?.notification_targets ?? [];
    assert.deepEqual(targets.find(t => t.team === 'activity')?.status, 'sent');
    assert.deepEqual(targets.find(t => t.team === 'owner_general')?.status, 'not_bound', 'the SEPARATE owner_general escalation attempt must be honestly recorded as not_bound, never silently dropped or claimed as sent');
  });
});

test('7. After owner_general is bound in the mock: system feedback sends there, and urgent safety escalates to both activity + owner_general', async () => {
  await withHarness(async harness => {
    harness.programOpsChannel('owner_general');
    const systemReply = await ask('og-system-bound', 'ทองไทยตอบยาวไป');
    assert.equal(systemReply.statusCode, 200);
    assert.match(msg(systemReply.payload), /ส่งเรื่องให้ทีมที่เกี่ยวข้องแล้วครับ/u, 'system feedback now sends for real once owner_general is bound');
    const systemRow = harness.feedbackEventRow(FIRST_EVENT_ID);
    assert.equal(systemRow?.notification_status, 'sent');
  });

  await withHarness(async harness => {
    harness.programOpsChannel('activity');
    harness.programOpsChannel('owner_general');
    const safetyReply = await ask('og-urgent-both-bound', 'ขี่ม้าแล้วบาดเจ็บ');
    assert.equal(safetyReply.statusCode, 200);
    assert.match(
      msg(safetyReply.payload),
      /ส่งให้ทีมกิจกรรมและเจ้าของตรวจสอบแล้วครับ/u,
      'both the primary activity team and the owner_general escalation sent -- the reply says both, not one generic line',
    );
    const row = harness.feedbackEventRow(FIRST_EVENT_ID);
    assert.equal(row?.notification_status, 'sent', 'primary send still succeeds');
    const targets = (row?.internal_notes as { notification_targets?: Array<{ team: string; status: string }> } | undefined)?.notification_targets ?? [];
    assert.deepEqual(targets.find(t => t.team === 'owner_general')?.status, 'sent', 'once owner_general is ALSO bound, the escalation succeeds too');
  });
});
