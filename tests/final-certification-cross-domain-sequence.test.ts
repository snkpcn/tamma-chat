// FINAL CLOSEOUT certification: the owner's literal named cross-domain
// sequence "Activity -> Restaurant -> Stay -> Activity" must never leak or
// corrupt state across the two intervening domain hops. The identical
// underlying mechanism (suspend on domain switch, exact restore on resume)
// is already proven generically by tests/gate3-stale-interrupted-
// conversations.test.ts's "switch A -> B -> C -> resume A" test (using
// otop/cafe as B/C) -- this file adds ONLY the owner's specific named
// sequence, reusing that file's exact harness conventions and reusing
// tests/gate2-line-web-domain-equivalence.test.ts's already-proven
// read-only restaurant/stay questions (neither creates its own task), so
// this is a genuinely new assertion, not a duplicate of either file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withHarness, guestId, brainRequest } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { createActiveTask, type TaskStateContainer } from '../netlify/functions/_task-state';

function msg(payload: unknown): string {
  return String((payload as { message: string }).message);
}

function seedActivityTask(harness: { getState: (id: string) => { state: Record<string, unknown> } | undefined; setState: (id: string, state: Record<string, unknown>) => void }, internalId: string): ReturnType<typeof createActiveTask> {
  const task = createActiveTask({
    type: 'activity_booking', sourceChannel: 'web',
    initialSlots: { resourceCode: 'activity-horse', horseName: 'ภาราดร', durationMinutes: 30 },
    requiredFields: ['resourceCode', 'date', 'time', 'partySize', 'durationMinutes'],
  });
  const container: TaskStateContainer = { schemaVersion: 'task-state-v1', activeTask: task, suspendedTask: null, lastSupersededTask: null, recentEventIds: [] };
  const existing = harness.getState(internalId);
  harness.setState(internalId, { ...(existing?.state ?? {}), taskState: container });
  return task;
}

test('Final certification: Activity -> Restaurant -> Stay -> Activity survives two named cross-domain hops with zero contamination', async () => {
  await withHarness(async harness => {
    const gid = guestId('final-cert-activity-restaurant-stay-activity');
    await processThongthaiChatCore(brainRequest('มีของฝากอะไรบ้าง', gid, 'web'), 'evt-0');
    const internalId = harness.guestDbId(gid)!;
    const originalTask = seedActivityTask(harness, internalId);

    // Activity (seeded A) -> Restaurant: a real, unrelated, read-only
    // restaurant question must be answered on its own real facts and must
    // never leak the activity task's business content. A pure discovery
    // side-question in another domain is architecturally a no-write turn
    // (see _dialog-manager.ts's SIDE_QUESTION_ACTIONS / isTaskSideQuestion
    // and _thongthai-one-mind-orchestrator.ts's statePersisted gating) --
    // the strongest possible non-contamination guarantee is that A's
    // persisted task state is left completely untouched, not merely
    // suspended-and-later-restored.
    const restaurantTurn = await processThongthaiChatCore(brainRequest('ร้านมีอะไรกิน', gid, 'web'), 'evt-1');
    assert.equal(restaurantTurn.statusCode, 200);
    assert.match(msg(restaurantTurn.payload), /ผัดไทย/, 'must answer the real restaurant menu question');
    assert.doesNotMatch(msg(restaurantTurn.payload), /ม้า|ภาราดร/u, 'the restaurant answer must never leak the still-active activity task');
    let container = harness.getState(internalId)?.state?.taskState as TaskStateContainer | undefined;
    assert.equal(container?.activeTask?.taskId, originalTask.taskId, 'Activity must remain untouched -- a read-only Restaurant side question is a no-write turn, not a domain takeover');
    assert.deepEqual(container?.activeTask?.slots, originalTask.slots, 'Activity\'s business content must be byte-for-byte unchanged after the Activity -> Restaurant hop');

    // Restaurant -> Stay: a second unrelated, read-only hop. Restaurant must
    // leave no residue, and Activity must still be exactly as it was.
    const stayTurn = await processThongthaiChatCore(brainRequest('เช็คอินกี่โมง', gid, 'web'), 'evt-2');
    assert.equal(stayTurn.statusCode, 200);
    assert.match(msg(stayTurn.payload), /14:00/, 'must answer the real stay check-in fact');
    assert.doesNotMatch(msg(stayTurn.payload), /ม้า|ภาราดร|ผัดไทย/u, 'the stay answer must never leak the activity task or the intervening restaurant turn');
    container = harness.getState(internalId)?.state?.taskState as TaskStateContainer | undefined;
    assert.equal(container?.activeTask?.taskId, originalTask.taskId, 'Activity must still be the SAME active task after the SECOND named hop (Restaurant -> Stay)');
    assert.deepEqual(container?.activeTask?.slots, originalTask.slots, 'Activity\'s business content (resourceCode/horseName/durationMinutes) must be byte-for-byte unchanged by both intervening hops');
    assert.equal(container?.suspendedTask, null, 'two read-only side hops must never fabricate a suspension that never needed to happen');

    // Stay -> Activity: continuing the activity conversation must still be
    // driven by the EXACT same original task, never a fresh or corrupted one.
    const resumed = await processThongthaiChatCore(brainRequest('เอาวันพรุ่งนี้บ่ายสามโมง', gid, 'web'), 'evt-3');
    assert.equal(resumed.statusCode, 200);
    container = harness.getState(internalId)?.state?.taskState as TaskStateContainer | undefined;
    assert.equal(container?.activeTask?.taskId, originalTask.taskId, 'continuing Activity after Activity -> Restaurant -> Stay -> Activity must still be the EXACT same task, not a new one');
    assert.equal(container?.activeTask?.slots.horseName, originalTask.slots.horseName, 'the originally-selected horse must survive the full named round trip');
    assert.equal(container?.activeTask?.slots.resourceCode, originalTask.slots.resourceCode);
  });
});
