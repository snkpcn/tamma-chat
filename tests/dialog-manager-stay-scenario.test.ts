// Phase F: stay availability -> booking-intent flow. "มีห้องพรุ่งนี้ไหม" is
// an availability INQUIRY, not automatically a booking. Then "สองคน คืนเดียว"
// continues context, "เอาหลังที่แนะนำ" selects a verified resource, and only
// "จองเลย" may produce an action proposal once fields are valid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processDialogTurn, type DialogInput } from '../netlify/functions/_dialog-manager';
import { applyConversationContextUpdate, buildSemanticContext, emptyConversationContextState, type ConversationContextState } from '../netlify/functions/_conversation-context';
import { emptyTaskStateContainer, type TaskStateContainer } from '../netlify/functions/_task-state';
import { parseSemanticTurnResponse } from '../netlify/functions/_semantic-interpreter';
import type { KnowledgeSourceAdapters, SourceResult } from '../netlify/functions/_knowledge-resolver';

const NOW = new Date('2026-09-18T10:00:00.000Z');

function stayAvailability(): SourceResult {
  return {
    status: 'ok', sourceId: 'service_resources_stay', sourceType: 'stay_live', fetchedAt: NOW.toISOString(),
    data: [{ key: 'stay:room-a:2026-09-19:available', value: true, domain: 'stay', sourceId: 'service_resources_stay', sourceType: 'stay_live', authoritative: true, fetchedAt: NOW.toISOString() }],
  };
}

test('stay flow: availability inquiry is NOT a booking; only an explicit "จองเลย" with valid fields proposes an action', async () => {
  let conversationContext: ConversationContextState = emptyConversationContextState(NOW);
  let taskState: TaskStateContainer = emptyTaskStateContainer();
  const adapters: KnowledgeSourceAdapters = { stay: { availability: async () => stayAvailability(), catalog: async () => stayAvailability() } };

  async function step(message: string, output: Record<string, unknown>) {
    const semanticContext = buildSemanticContext(conversationContext, NOW);
    const semanticTurn = parseSemanticTurnResponse(JSON.stringify(output), semanticContext);
    const dialogInput: DialogInput = { semanticTurn, conversationContext, taskState, channel: 'web', eventId: message };
    const decision = await processDialogTurn(dialogInput, adapters, NOW);
    taskState = decision.taskStateContainer;
    conversationContext = applyConversationContextUpdate(conversationContext, { userMessage: message, channel: 'web', eventId: message, summaryFact: message }, NOW);
    return decision;
  }

  // "มีห้องพรุ่งนี้ไหม" -- an inquiry (ask), not task-worthy by itself.
  let decision = await step('มีห้องพรุ่งนี้ไหม', { domain: 'stay', intent: 'check_availability', action: 'ask', entities: {}, references: [], constraints: [], confidence: 0.85, needsClarification: false });
  assert.equal(taskState.activeTask, null, 'an availability question alone must not create a booking task');
  assert.notEqual(decision.mode, 'propose_action');

  // "สองคน คืนเดียว" -- provide_information IS task-worthy; creates the task.
  await step('สองคน คืนเดียว', { domain: 'stay', intent: 'provide_stay_details', action: 'provide_information', entities: { partySize: 2, quantity: 1 }, references: [], constraints: [], confidence: 0.85, needsClarification: false });
  assert.ok(taskState.activeTask, 'concrete party size/duration is task-worthy');
  const taskId = taskState.activeTask!.taskId;
  assert.equal(taskState.activeTask!.slots.partySize, 2);

  // "เอาหลังที่แนะนำ" -- selects a verified resource.
  await step('เอาหลังที่แนะนำ', { domain: 'stay', intent: 'select_recommended_room', action: 'confirm', entities: { resourceCode: 'stay:room-a', date: '2026-09-19' }, references: [], constraints: [], confidence: 0.85, needsClarification: false });
  assert.equal(taskState.activeTask!.taskId, taskId);
  assert.equal(taskState.activeTask!.slots.resourceCode, 'stay:room-a');
  assert.deepEqual(taskState.activeTask!.missingFields, [], 'date is the only real requirement for stay, and it is now present');

  // Even with all fields present, no explicit commit yet -- must not propose.
  const preCommit = await processDialogTurn({ semanticTurn: parseSemanticTurnResponse(JSON.stringify({ domain: 'stay', intent: 'ask_price', action: 'ask', entities: {}, references: [], constraints: [], confidence: 0.85, needsClarification: false }), buildSemanticContext(conversationContext, NOW)), conversationContext, taskState, channel: 'web', eventId: 'stay-ask-price' }, adapters, NOW);
  assert.notEqual(preCommit.mode, 'propose_action', 'fields complete is not the same as an explicit booking commitment');

  // "จองเลย" -- only now may a proposal be produced.
  const bookDecision = await step('จองเลย', { domain: 'stay', intent: 'confirm_booking', action: 'book', entities: {}, references: [], constraints: [], confidence: 0.9, needsClarification: false });
  assert.equal(bookDecision.mode, 'propose_action');
  assert.equal(bookDecision.actionProposal?.toolName, 'create_booking');
  assert.equal(bookDecision.taskStateContainer.activeTask!.taskId, taskId, 'still the SAME task, never recreated');
});
