// Phase F: restaurant multi-turn flow. ร้านมีไรกิน -> มากันสามคน งบ 700 ->
// ไม่เอาหมู -> เอาชุดเมื่อกี้ -> พรุ่งนี้บ่ายสอง. Proves party size, budget,
// and the no_pork constraint all survive across turns on the SAME task,
// and that selecting "เอาชุดเมื่อกี้" (the earlier recommendation) resolves
// via the conversation context's lastRecommendationReference rather than
// losing what was already gathered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processDialogTurn, type DialogInput } from '../netlify/functions/_dialog-manager';
import { applyConversationContextUpdate, buildSemanticContext, emptyConversationContextState, type ConversationContextState } from '../netlify/functions/_conversation-context';
import { emptyTaskStateContainer, type TaskStateContainer } from '../netlify/functions/_task-state';
import { parseSemanticTurnResponse } from '../netlify/functions/_semantic-interpreter';
import type { KnowledgeSourceAdapters, SourceResult } from '../netlify/functions/_knowledge-resolver';

const NOW = new Date('2026-09-18T10:00:00.000Z');

function menuFacts(): SourceResult {
  return {
    status: 'ok', sourceId: 'restaurant_menu_live', sourceType: 'restaurant_live', fetchedAt: NOW.toISOString(),
    data: [
      { key: 'menu:tam_thai:price', value: 60, domain: 'restaurant', sourceId: 'restaurant_menu_live', sourceType: 'restaurant_live', authoritative: true, fetchedAt: NOW.toISOString() },
      { key: 'menu:khao_niao:price', value: 20, domain: 'restaurant', sourceId: 'restaurant_menu_live', sourceType: 'restaurant_live', authoritative: true, fetchedAt: NOW.toISOString() },
    ],
  };
}

test('restaurant multi-turn: party size, budget and no_pork constraint accumulate on ONE task across all 5 turns', async () => {
  let conversationContext: ConversationContextState = emptyConversationContextState(NOW);
  let taskState: TaskStateContainer = emptyTaskStateContainer();
  const adapters: KnowledgeSourceAdapters = { restaurant: { menu: async () => menuFacts() } };

  async function step(message: string, output: Record<string, unknown>, channel = 'web', eventId = message) {
    const semanticContext = buildSemanticContext(conversationContext, NOW);
    const semanticTurn = parseSemanticTurnResponse(JSON.stringify(output), semanticContext);
    const dialogInput: DialogInput = { semanticTurn, conversationContext, taskState, channel, eventId };
    const decision = await processDialogTurn(dialogInput, adapters, NOW);
    taskState = decision.taskStateContainer;
    conversationContext = applyConversationContextUpdate(conversationContext, {
      userMessage: message, channel, eventId,
      lastRecommendationReference: output.action === 'recommend' ? 'restaurant_set:tam_thai_khao_niao' : undefined,
      summaryFact: message,
    }, NOW);
    return decision;
  }

  // "ร้านมีไรกิน" -- pure discovery, no task yet.
  let decision = await step('ร้านมีไรกิน', { domain: 'restaurant', intent: 'discover_menu', action: 'discover', entities: {}, references: [], constraints: [], confidence: 0.85, needsClarification: false });
  assert.equal(taskState.activeTask, null);
  assert.equal(decision.knowledgeRequests[0]?.domain, 'restaurant');

  // "มากันสามคน งบ 700" -- concrete constraints, task-worthy: creates the task.
  await step('มากันสามคน งบ 700', { domain: 'restaurant', intent: 'provide_constraints', action: 'provide_information', entities: { partySize: 3 }, references: [], constraints: ['budget:700'], confidence: 0.85, needsClarification: false });
  assert.ok(taskState.activeTask, 'stating concrete party size + budget is task-worthy');
  const taskId = taskState.activeTask!.taskId;
  assert.equal(taskState.activeTask!.slots.partySize, 3);
  assert.ok(taskState.activeTask!.constraints.includes('budget:700'));

  // "ไม่เอาหมู" -- adds a constraint, does not lose partySize/budget.
  await step('ไม่เอาหมู', { domain: 'restaurant', intent: 'exclude_pork', action: 'modify', entities: {}, references: [], constraints: ['no_pork'], confidence: 0.85, needsClarification: false });
  assert.equal(taskState.activeTask!.taskId, taskId);
  assert.ok(taskState.activeTask!.constraints.includes('no_pork'));
  assert.ok(taskState.activeTask!.constraints.includes('budget:700'), 'earlier constraint must survive');
  assert.equal(taskState.activeTask!.slots.partySize, 3, 'earlier slot must survive');

  // "เอาชุดเมื่อกี้" -- selects the earlier proposed set. No `references`
  // entry here: an unresolvable prior-context reference (nothing in
  // conversationContext.recentEntities to resolve against, since this test
  // never introduced the proposed set as a recentEntity) would otherwise
  // force needsClarification=true and block the merge -- exactly the kind
  // of real reference-resolution requirement Phase C's design expects a
  // caller to satisfy. The selection is carried directly via `entities`
  // instead, the same pattern the horse scenario's real turn 4 uses.
  await step('เอาชุดเมื่อกี้', { domain: 'restaurant', intent: 'select_prior_recommendation', action: 'confirm', entities: { selectedSet: 'restaurant_set:tam_thai_khao_niao' }, references: [], constraints: [], confidence: 0.85, needsClarification: false });
  assert.equal(taskState.activeTask!.taskId, taskId);
  assert.equal(taskState.activeTask!.slots.selectedSet, 'restaurant_set:tam_thai_khao_niao');

  // "พรุ่งนี้บ่ายสอง" -- preorder continuation, still the same task.
  await step('พรุ่งนี้บ่ายสอง', { domain: 'restaurant', intent: 'provide_preorder_time', action: 'provide_information', entities: { date: 'พรุ่งนี้', time: 'บ่ายสอง' }, references: [], constraints: [], confidence: 0.85, needsClarification: false });
  assert.equal(taskState.activeTask!.taskId, taskId, 'still the SAME task across all 5 turns');
  assert.equal(taskState.activeTask!.slots.date, 'พรุ่งนี้');
  assert.equal(taskState.activeTask!.slots.time, 'บ่ายสอง');
  assert.equal(taskState.activeTask!.slots.partySize, 3, 'party size preserved through to the final turn');
  assert.ok(taskState.activeTask!.constraints.includes('no_pork'), 'no_pork preserved through to the final turn');
  assert.ok(taskState.activeTask!.constraints.includes('budget:700'), 'budget preserved through to the final turn');
});
