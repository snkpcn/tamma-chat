// Phase F: the canonical horse-booking scenario driven end-to-end through
// the REAL pipeline -- Phase B's parseSemanticTurnResponse (reference
// resolution against REAL conversation context), Phase C's
// applyConversationContextUpdate, and Phase F's processDialogTurn -- for
// all 7 turns, extending Phase C/D's 6-turn fixture with an explicit
// "จองเลย" commit turn. Mock adapters only (network-free).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processDialogTurn, type DialogInput } from '../netlify/functions/_dialog-manager';
import { applyConversationContextUpdate, buildSemanticContext, emptyConversationContextState, type ConversationContextState } from '../netlify/functions/_conversation-context';
import { emptyTaskStateContainer, type TaskStateContainer } from '../netlify/functions/_task-state';
import { parseSemanticTurnResponse } from '../netlify/functions/_semantic-interpreter';
import { HORSE_BOOKING_SCENARIO } from './fixtures/semantic-multiturn-scenarios';
import type { KnowledgeSourceAdapters, SourceResult } from '../netlify/functions/_knowledge-resolver';

const NOW = new Date('2026-09-18T10:00:00.000Z');

function activityCatalogFacts(): SourceResult {
  return {
    status: 'ok', sourceId: 'activity_assets', sourceType: 'activity_live', fetchedAt: NOW.toISOString(),
    data: [
      { key: 'activity_asset:horse:thongthai:name', value: 'ทองไทย', domain: 'activity', sourceId: 'activity_assets', sourceType: 'activity_live', authoritative: true, fetchedAt: NOW.toISOString() },
      { key: 'activity_asset:horse:paradon:name', value: 'ภาราดร', domain: 'activity', sourceId: 'activity_assets', sourceType: 'activity_live', authoritative: true, fetchedAt: NOW.toISOString() },
      { key: 'activity:horse:60min:price', value: 450, domain: 'activity', sourceId: 'activity_assets', sourceType: 'activity_live', authoritative: true, fetchedAt: NOW.toISOString() },
      // Deliberately NO temperament fact -- this source never provided one.
    ],
  };
}
function availabilityFacts(available: boolean): SourceResult {
  return {
    status: 'ok', sourceId: 'schedule_rows', sourceType: 'activity_live', fetchedAt: NOW.toISOString(),
    data: [{ key: 'activity:activity-horse:2026-09-19:15:00:available', value: available, domain: 'activity', sourceId: 'schedule_rows', sourceType: 'activity_live', authoritative: true, fetchedAt: NOW.toISOString() }],
  };
}

test('canonical horse-booking scenario, all 7 turns, through the REAL Dialog Manager pipeline', async () => {
  let conversationContext: ConversationContextState = emptyConversationContextState(NOW);
  let taskState: TaskStateContainer = emptyTaskStateContainer();
  const adapters: KnowledgeSourceAdapters = {
    activity: { catalog: async () => activityCatalogFacts(), availability: async () => availabilityFacts(true) },
  };

  // Turns 1-3: มีไรทำมั่ง / ม้าล่ะ / ตัวไหนนิสัยดีกว่า -- no task yet.
  for (const [index, step] of HORSE_BOOKING_SCENARIO.slice(0, 3).entries()) {
    const semanticContext = buildSemanticContext(conversationContext, NOW);
    const semanticTurn = parseSemanticTurnResponse(JSON.stringify(step.simulatedModelOutput), semanticContext);
    const dialogInput: DialogInput = { semanticTurn, conversationContext, taskState, channel: step.channel, eventId: step.eventId };
    const decision = await processDialogTurn(dialogInput, adapters, NOW);
    taskState = decision.taskStateContainer;
    assert.equal(taskState.activeTask, null, `turn ${index + 1} ("${step.message}") must not create a task`);
    conversationContext = applyConversationContextUpdate(conversationContext, { ...step.contextUpdate, channel: step.channel, eventId: step.eventId, userMessage: step.message }, NOW);
  }

  // Turn 3's own decision (recomputed once more here to assert the
  // anti-hallucination outcome directly): no verified temperament fact
  // exists anywhere in the activity source -> the Dialog Manager must not
  // authorize the comparison.
  const step3 = HORSE_BOOKING_SCENARIO[2]!;
  const contextBeforeStep3 = applyConversationContextUpdate(
    applyConversationContextUpdate(emptyConversationContextState(NOW), { ...HORSE_BOOKING_SCENARIO[0]!.contextUpdate, channel: HORSE_BOOKING_SCENARIO[0]!.channel, eventId: HORSE_BOOKING_SCENARIO[0]!.eventId, userMessage: HORSE_BOOKING_SCENARIO[0]!.message }, NOW),
    { ...HORSE_BOOKING_SCENARIO[1]!.contextUpdate, channel: HORSE_BOOKING_SCENARIO[1]!.channel, eventId: HORSE_BOOKING_SCENARIO[1]!.eventId, userMessage: HORSE_BOOKING_SCENARIO[1]!.message }, NOW,
  );
  const step3Context = buildSemanticContext(contextBeforeStep3, NOW);
  const step3Turn = parseSemanticTurnResponse(JSON.stringify({ ...step3.simulatedModelOutput, entities: { compareAttribute: 'temperament' } }), step3Context);
  const step3Decision = await processDialogTurn({ semanticTurn: step3Turn, conversationContext: contextBeforeStep3, taskState: emptyTaskStateContainer(), channel: step3.channel, eventId: step3.eventId }, adapters, NOW);
  assert.equal(step3Decision.responseIntent, 'cannot_verify_comparison');
  assert.equal(step3Decision.actionProposal, undefined);

  // Turn 4: เอาภาราดร -- creates the task, selects the canonical horse.
  const step4 = HORSE_BOOKING_SCENARIO[3]!;
  const context4 = buildSemanticContext(conversationContext, NOW);
  const turn4 = parseSemanticTurnResponse(JSON.stringify({ ...step4.simulatedModelOutput, entities: { resourceCode: 'activity-horse', horseName: 'ภาราดร' } }), context4);
  let decision = await processDialogTurn({ semanticTurn: turn4, conversationContext, taskState, channel: step4.channel, eventId: step4.eventId }, adapters, NOW);
  taskState = decision.taskStateContainer;
  assert.ok(taskState.activeTask, 'the task must exist after the horse is selected');
  assert.equal(taskState.activeTask!.slots.horseName, 'ภาราดร');
  assert.equal(taskState.activeTask!.selectedEntities.some(e => e.name === 'ภาราดร'), true);
  const taskId = taskState.activeTask!.taskId;
  assert.notEqual(decision.mode, 'propose_action', 'selecting a horse is NOT a booking commitment');
  conversationContext = applyConversationContextUpdate(conversationContext, { ...step4.contextUpdate, channel: step4.channel, eventId: step4.eventId, userMessage: step4.message }, NOW);

  // Turn 5: พรุ่งนี้สองคน -- same task, date+partySize merged.
  const step5 = HORSE_BOOKING_SCENARIO[4]!;
  const context5 = buildSemanticContext(conversationContext, NOW);
  const turn5 = parseSemanticTurnResponse(JSON.stringify(step5.simulatedModelOutput), context5);
  decision = await processDialogTurn({ semanticTurn: turn5, conversationContext, taskState, channel: step5.channel, eventId: step5.eventId }, adapters, NOW);
  taskState = decision.taskStateContainer;
  assert.equal(taskState.activeTask!.taskId, taskId);
  assert.equal(taskState.activeTask!.slots.date, 'พรุ่งนี้');
  assert.equal(taskState.activeTask!.slots.partySize, 2);
  conversationContext = applyConversationContextUpdate(conversationContext, { ...step5.contextUpdate, channel: step5.channel, eventId: step5.eventId, userMessage: step5.message }, NOW);

  // Turn 6: บ่ายสามได้ปะ -- durationMinutes still missing per real policy,
  // so the Dialog Manager must ask for it rather than silently proceeding,
  // AND no booking is created merely because most fields are present.
  const step6 = HORSE_BOOKING_SCENARIO[5]!;
  const context6 = buildSemanticContext(conversationContext, NOW);
  const turn6 = parseSemanticTurnResponse(JSON.stringify(step6.simulatedModelOutput), context6);
  decision = await processDialogTurn({ semanticTurn: turn6, conversationContext, taskState, channel: step6.channel, eventId: step6.eventId }, adapters, NOW);
  taskState = decision.taskStateContainer;
  assert.equal(taskState.activeTask!.taskId, taskId);
  assert.equal(taskState.activeTask!.slots.time, 'บ่ายสาม');
  assert.deepEqual(taskState.activeTask!.missingFields, ['durationMinutes']);
  assert.equal(decision.mode, 'collect_field', 'duration is still missing -- must collect it, not book');
  assert.notEqual(decision.mode, 'propose_action');
  conversationContext = applyConversationContextUpdate(conversationContext, { ...step6.contextUpdate, channel: step6.channel, eventId: step6.eventId, userMessage: step6.message }, NOW);

  // Fill the duration (a realistic follow-up the customer would give when
  // asked), THEN turn 7: "จองเลย" -- only NOW may a proposal be produced.
  const durationTurn = parseSemanticTurnResponse(JSON.stringify({ domain: 'activity', intent: 'provide_duration', action: 'provide_information', entities: { durationMinutes: 60 }, references: [], constraints: [], confidence: 0.9, needsClarification: false }), buildSemanticContext(conversationContext, NOW));
  decision = await processDialogTurn({ semanticTurn: durationTurn, conversationContext, taskState, channel: 'line', eventId: 'horse-scenario-6b' }, adapters, NOW);
  taskState = decision.taskStateContainer;
  assert.deepEqual(taskState.activeTask!.missingFields, []);
  assert.notEqual(decision.mode, 'propose_action', 'all fields present is still not the same as an explicit commit');

  const bookTurn = parseSemanticTurnResponse(JSON.stringify({ domain: 'activity', intent: 'confirm_booking', action: 'book', entities: {}, references: [], constraints: [], confidence: 0.92, needsClarification: false }), buildSemanticContext(conversationContext, NOW));
  decision = await processDialogTurn({ semanticTurn: bookTurn, conversationContext, taskState, channel: 'line', eventId: 'horse-scenario-7' }, adapters, NOW);
  assert.equal(decision.mode, 'propose_action', 'only an explicit "จองเลย" with all fields present and verified availability may propose an action');
  assert.equal(decision.actionProposal?.toolName, 'create_booking');
  assert.equal(decision.actionProposal?.customerCommitPresent, true);
  assert.equal(decision.taskStateContainer.activeTask!.taskId, taskId, 'still the SAME task from turn 4, never recreated');
});
