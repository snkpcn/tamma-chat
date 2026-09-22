// PRIORITY 3 (owner-specified): the SAME logical conversation through
// channel='web' and channel='line' must produce equivalent semantic/task/
// transaction results. Transport (how the message arrived, how the reply
// is rendered/delivered) may differ; business meaning must not. If web and
// LINE ever diverge here, the fix is architecture (a channel deciding
// business behavior on its own), never loosening this test.
//
// Runs the identical short conversation (select horse -> state duration ->
// state date/time -> correct duration -> confirm) through
// processThongthaiOneMindTurnAuthoritative twice, once per channel, each
// with its own independent in-memory guest_agent_state row (two different
// guests), and asserts the two runs produce identical semantic turns,
// dialog decisions, task slots, knowledge requests, and transaction
// proposal args -- with sourceChannel/idempotencyKey being the only
// fields allowed to differ (idempotencyKey is a per-task id, not a
// business value).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  processThongthaiOneMindTurnAuthoritative,
  type OneMindDependencies,
  type OneMindTurnResult,
} from '../netlify/functions/_thongthai-one-mind-orchestrator';
import type { GuestAgentStateSnapshot } from '../netlify/functions/_guest-agent-state-store';
import type { SourceResult } from '../netlify/functions/_knowledge-resolver';
import type { BrainChannel } from '../netlify/functions/_thongthai-brain-v3';

const NOW = new Date('2026-09-22T10:00:00+07:00');

function knowledgeAdapters(): OneMindDependencies['buildKnowledgeAdapters'] {
  return () => ({
    activity: {
      catalog: async (): Promise<SourceResult> => ({
        status: 'ok', sourceId: 'activity_assets', sourceType: 'activity_live', fetchedAt: NOW.toISOString(),
        data: [{ key: 'activity:horse:price', value: 500, domain: 'activity', sourceId: 'activity_assets', sourceType: 'activity_live', authoritative: true, fetchedAt: NOW.toISOString() }],
      }),
      availability: async (): Promise<SourceResult> => ({
        status: 'ok', sourceId: 'schedule_rows', sourceType: 'activity_live', fetchedAt: NOW.toISOString(),
        data: [{ key: 'activity:horse:pharadon:2026-10-03:13:00:available', value: true, domain: 'activity', sourceId: 'schedule_rows', sourceType: 'activity_live', authoritative: true, fetchedAt: NOW.toISOString() }],
      }),
    },
  });
}

async function runConversation(channel: BrainChannel, guestDbId: string, mirrorCalls: unknown[]): Promise<OneMindTurnResult[]> {
  let stateRow: GuestAgentStateSnapshot = { exists: false, state: {}, updatedAt: null };
  const deps: Partial<OneMindDependencies> = {
    resolveCanonicalGuestId: async () => guestDbId,
    guestDbIdFromAnonymousId: async () => guestDbId,
    buildKnowledgeAdapters: knowledgeAdapters(),
    mirrorActivityTaskToLegacySession: async input => { mirrorCalls.push(input); },
  };

  const messages = [
    'เอาภาราดรครับ',
    'เอา 30 นาทีครับ',
    '3 ตุลาคม เวลา 13.00',
    '2 คน',
    'จริงๆ เปลี่ยนเป็น 60 นาที',
    'ยืนยันการจอง',
  ];

  const results: OneMindTurnResult[] = [];
  let minuteOffset = 0;
  for (const message of messages) {
    minuteOffset += 1;
    const result = await processThongthaiOneMindTurnAuthoritative({
      channel, message, eventId: `${channel}-evt-${minuteOffset}`, providerUserKey: `${channel}-key`, persistState: true,
    }, deps, {
      loadSnapshot: async () => stateRow,
      compareAndSwap: async (_id, snapshot, patch) => {
        stateRow = { exists: true, state: { ...snapshot.state, ...(patch.set ?? {}) }, updatedAt: new Date(NOW.getTime() + minuteOffset * 60_000 + 1).toISOString() };
        return { status: 'applied', snapshot: stateRow };
      },
    }, new Date(NOW.getTime() + minuteOffset * 60_000));
    results.push(result);
  }
  return results;
}

test('web and LINE produce equivalent semantic turns, task slots, dialog decisions, and transaction args for the identical conversation', async () => {
  const webMirrorCalls: unknown[] = [];
  const lineMirrorCalls: unknown[] = [];

  const [webResults, lineResults] = await Promise.all([
    runConversation('web', 'web-guest-1', webMirrorCalls),
    runConversation('line', 'line-guest-1', lineMirrorCalls),
  ]);

  assert.equal(webResults.length, lineResults.length);

  for (let i = 0; i < webResults.length; i += 1) {
    const web = webResults[i]!;
    const line = lineResults[i]!;
    const label = `turn ${i + 1}`;

    // Semantic meaning: identical domain/intent/action/entities -- the
    // channel must never change WHAT the customer is understood to mean.
    assert.deepEqual(web.semanticTurn.domain, line.semanticTurn.domain, label);
    assert.deepEqual(web.semanticTurn.intent, line.semanticTurn.intent, label);
    assert.deepEqual(web.semanticTurn.action, line.semanticTurn.action, label);
    assert.deepEqual(web.semanticTurn.entities, line.semanticTurn.entities, label);

    // Dialog decision: identical mode/missingFields/responseIntent/knowledge requests.
    assert.equal(web.dialogDecision.mode, line.dialogDecision.mode, label);
    assert.deepEqual(web.dialogDecision.missingFields, line.dialogDecision.missingFields, label);
    assert.equal(web.dialogDecision.responseIntent, line.dialogDecision.responseIntent, label);
    assert.deepEqual(
      web.dialogDecision.knowledgeRequests.map(r => ({ domain: r.domain, needs: r.needs })),
      line.dialogDecision.knowledgeRequests.map(r => ({ domain: r.domain, needs: r.needs })),
      label,
    );

    // Task slot VALUES: identical business content. sourceChannel is the
    // one field expected to genuinely differ (it records which channel
    // this task came from, not a business value about the booking).
    const webTask = web.taskStateAfter.activeTask;
    const lineTask = line.taskStateAfter.activeTask;
    assert.equal(Boolean(webTask), Boolean(lineTask), label);
    if (webTask && lineTask) {
      assert.equal(webTask.type, lineTask.type, label);
      assert.equal(webTask.status, lineTask.status, label);
      assert.deepEqual(webTask.slots, lineTask.slots, `${label}: task slots must carry identical business content regardless of channel`);
      assert.deepEqual(webTask.missingFields, lineTask.missingFields, label);
      assert.equal(webTask.sourceChannel, 'web', label);
      assert.equal(lineTask.sourceChannel, 'line', label);
    }
  }

  // Transaction args: the FINAL turn's proposal must carry identical
  // business arguments regardless of channel (idempotencyKey is a
  // per-task id, not a business value, so it's excluded from the
  // equality check but asserted present on both).
  const webFinal = webResults[webResults.length - 1]!;
  const lineFinal = lineResults[lineResults.length - 1]!;
  assert.ok(webFinal.dialogDecision.actionProposal, 'web must reach a transaction proposal');
  assert.ok(lineFinal.dialogDecision.actionProposal, 'LINE must reach a transaction proposal');
  assert.equal(webFinal.dialogDecision.actionProposal!.toolName, lineFinal.dialogDecision.actionProposal!.toolName);
  assert.deepEqual(webFinal.dialogDecision.actionProposal!.validatedArgs, lineFinal.dialogDecision.actionProposal!.validatedArgs, 'the same conversation must produce the same booking arguments regardless of which channel it came through');
  assert.equal(webFinal.dialogDecision.actionProposal!.customerCommitPresent, lineFinal.dialogDecision.actionProposal!.customerCommitPresent);
  assert.ok(webFinal.dialogDecision.actionProposal!.idempotencyKey, 'idempotency semantics must be present on both channels');
  assert.ok(lineFinal.dialogDecision.actionProposal!.idempotencyKey, 'idempotency semantics must be present on both channels');

  // Channel ownership of the LINE-only legacy-session mirror: this is the
  // one place channel SHOULD change behavior (transport-adjacent execution
  // plumbing, not business meaning) -- web must never trigger it.
  assert.equal(webMirrorCalls.length, 0, 'web must never own the LINE-only legacy execution adapter as a side effect');
  assert.ok(lineMirrorCalls.length > 0, 'LINE should mirror its activity task at least once across this conversation');
});
