// GATE 3 (owner-specified): stale/interrupted conversation coverage BEYOND
// activity's existing TTL unit tests (tests/task-staleness-regression.test.ts
// proves normalizeTaskStateForConversation directly). This file drives the
// real shared entry point processThongthaiChatCore end-to-end, seeding a
// realistic pre-existing task via harness.setState the same way a real
// guest_agent_state row from an earlier turn would already contain one --
// never a hand-constructed SemanticTurn.
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

test('a stale activity task never hijacks a plain greeting', async () => {
  await withHarness(async harness => {
    const gid = guestId('gate3-stale-task-greeting');
    await processThongthaiChatCore(brainRequest('มีของฝากอะไรบ้าง', gid, 'web'), 'evt-0');
    const internalId = harness.guestDbId(gid)!;
    const task = seedActivityTask(harness, internalId);

    const r = await processThongthaiChatCore(brainRequest('สวัสดี', gid, 'web'), 'evt-1');
    assert.equal(r.statusCode, 200);
    assert.doesNotMatch(msg(r.payload), /ม้า|วัน.*เวลา.*คน/u, 'a greeting must never surface the stale task\'s missing-field prompt');
    assert.match(msg(r.payload), /สวัสดี/, 'must get a real greeting');

    const state = harness.getState(internalId);
    const container = state?.state?.taskState as TaskStateContainer | undefined;
    assert.equal(container?.activeTask?.taskId, task.taskId, 'the stale task must be left untouched, not silently cleared');
  });
});

test('a stale activity task never blocks or leaks into an unrelated OTOP question', async () => {
  await withHarness(async harness => {
    const gid = guestId('gate3-stale-task-unrelated-otop');
    await processThongthaiChatCore(brainRequest('มีของฝากอะไรบ้าง', gid, 'web'), 'evt-0');
    const internalId = harness.guestDbId(gid)!;
    seedActivityTask(harness, internalId);

    const r = await processThongthaiChatCore(brainRequest('มีของฝากอันไหนดี', gid, 'web'), 'evt-1');
    assert.equal(r.statusCode, 200);
    assert.match(msg(r.payload), /น้ำผึ้งป่า|ผ้าพันคอทอมือ/, 'must answer the real otop question');
    assert.doesNotMatch(msg(r.payload), /ม้า/u, 'must not leak the stale activity task into an unrelated answer');
  });
});

test('REGRESSION: a fresh selection right after cancelling a task starts a clean new task, never resurrects the cancelled one', async () => {
  // Real bug found during Gate 3 stress testing: planDialogTurn's task-start
  // decision checked "if (!container.activeTask)" -- a bare null check. A
  // cancelled task is transitioned to status:'cancelled' but stays present
  // as container.activeTask (never nulled out), so that check was FALSE for
  // a cancelled task, and the very next unrelated-but-same-domain selection
  // got merged INTO the dead, cancelled task object instead of starting a
  // real new one -- silently resurrecting it in all but name. Fixed by
  // checking isTerminalTaskStatus too (see _dialog-manager.ts's
  // hasOpenActiveTask, reusing the SAME pattern already established
  // elsewhere in that file as `hasOpenTask`).
  await withHarness(async harness => {
    const gid = guestId('gate3-fresh-task-after-cancel');
    await processThongthaiChatCore(brainRequest('มีของฝากอะไรบ้าง', gid, 'web'), 'evt-0');
    const internalId = harness.guestDbId(gid)!;
    const originalTask = seedActivityTask(harness, internalId);

    await processThongthaiChatCore(brainRequest('ยกเลิก', gid, 'web'), 'evt-1');
    const afterCancel = (harness.getState(internalId)?.state?.taskState as TaskStateContainer | undefined)?.activeTask;
    assert.equal(afterCancel?.taskId, originalTask.taskId);
    assert.equal(afterCancel?.status, 'cancelled', 'the cancel itself must still work');

    const r = await processThongthaiChatCore(brainRequest('เอาภาราดรครับ', gid, 'web'), 'evt-2');
    assert.equal(r.statusCode, 200);
    const afterFresh = (harness.getState(internalId)?.state?.taskState as TaskStateContainer | undefined)?.activeTask;
    assert.ok(afterFresh, 'a fresh task must be created');
    assert.notEqual(afterFresh!.taskId, originalTask.taskId, 'must be a genuinely NEW task, not the cancelled one reused');
    assert.equal(afterFresh!.status, 'collecting', 'the new task must start in a normal, non-terminal state');
  });
});

test('switch A -> B -> C -> resume A: a suspended task survives more than one intervening domain hop', async () => {
  await withHarness(async harness => {
    const gid = guestId('gate3-abc-resume-a');
    await processThongthaiChatCore(brainRequest('มีของฝากอะไรบ้าง', gid, 'web'), 'evt-0');
    const internalId = harness.guestDbId(gid)!;
    const originalTask = seedActivityTask(harness, internalId);

    // A (activity, seeded) -> B (otop)
    await processThongthaiChatCore(brainRequest('มีของฝากอันไหนดี', gid, 'web'), 'evt-1');
    let container = harness.getState(internalId)?.state?.taskState as TaskStateContainer | undefined;
    assert.equal(container?.activeTask, null);
    assert.equal(container?.suspendedTask?.taskId, originalTask.taskId, 'A must be suspended, not lost, on the first switch');

    // B (otop) -> C (cafe) -- a second, unrelated hop while A stays suspended.
    await processThongthaiChatCore(brainRequest('มีลาเต้ไหม', gid, 'web'), 'evt-2');
    container = harness.getState(internalId)?.state?.taskState as TaskStateContainer | undefined;
    assert.equal(container?.suspendedTask?.taskId, originalTask.taskId, 'A must still be the suspended task after a SECOND unrelated hop');
    assert.deepEqual(container?.suspendedTask?.slots, originalTask.slots, 'A\'s business content must be unchanged by the intervening hops');

    // -> resume A
    const resumed = await processThongthaiChatCore(brainRequest('กลับมาจองม้าต่อ', gid, 'web'), 'evt-3');
    assert.equal(resumed.statusCode, 200);
    container = harness.getState(internalId)?.state?.taskState as TaskStateContainer | undefined;
    assert.equal(container?.activeTask?.taskId, originalTask.taskId, 'resume must restore the EXACT same task, not start a new one');
    assert.equal(container?.suspendedTask, null);
  });
});
