// Phase F: preserves the ORIGINAL production bug regression from Phase C's
// acceptance testing -- repeated "มีโปรอะไร" must never be misread as a
// customer name, an acceptance, or redemption input on the second asking.
// The new semantic/dialog architecture prevents this structurally: a
// repeated 'discover' action never creates or advances a task (see
// "discovery must not create fake tasks"), so there is no draft/pending
// redemption state for a second discovery message to corrupt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processDialogTurn, type DialogInput } from '../netlify/functions/_dialog-manager';
import { applyConversationContextUpdate, buildSemanticContext, emptyConversationContextState, type ConversationContextState } from '../netlify/functions/_conversation-context';
import { emptyTaskStateContainer, type TaskStateContainer } from '../netlify/functions/_task-state';
import { parseSemanticTurnResponse } from '../netlify/functions/_semantic-interpreter';
import type { KnowledgeSourceAdapters, SourceResult } from '../netlify/functions/_knowledge-resolver';

const NOW = new Date('2026-09-18T10:00:00.000Z');

function activePromoFacts(): SourceResult {
  return {
    status: 'ok', sourceId: 'promotions_active', sourceType: 'promotion_runtime', fetchedAt: NOW.toISOString(),
    data: [{ key: 'promo:PROMO1', value: { campaignCode: 'PROMO1', title: 'ตำไทย + ข้าวเหนียว', promoTotal: 99 }, domain: 'promotion', sourceId: 'promotions_active', sourceType: 'promotion_runtime', authoritative: true, fetchedAt: NOW.toISOString() }],
  };
}

test('repeated "มีโปรอะไร" never gets misread as a customer name / acceptance / redemption input', async () => {
  let conversationContext: ConversationContextState = emptyConversationContextState(NOW);
  let taskState: TaskStateContainer = emptyTaskStateContainer();
  const adapters: KnowledgeSourceAdapters = { promotion: { eligibility: async () => activePromoFacts() } };

  async function ask(eventId: string) {
    const semanticContext = buildSemanticContext(conversationContext, NOW);
    const semanticTurn = parseSemanticTurnResponse(JSON.stringify({ domain: 'promotion', intent: 'discover_promotions', action: 'discover', entities: {}, references: [], constraints: [], confidence: 0.85, needsClarification: false }), semanticContext);
    const dialogInput: DialogInput = { semanticTurn, conversationContext, taskState, channel: 'line', eventId };
    const decision = await processDialogTurn(dialogInput, adapters, NOW);
    taskState = decision.taskStateContainer;
    conversationContext = applyConversationContextUpdate(conversationContext, { userMessage: 'มีโปรอะไร', channel: 'line', eventId, summaryFact: 'customer asked what promotions exist' }, NOW);
    return decision;
  }

  const first = await ask('promo-ask-1');
  assert.equal(taskState.activeTask, null, 'discovery must never create a task');
  assert.notEqual(first.mode, 'propose_action');
  assert.notEqual(first.mode, 'collect_field', 'a bare discovery question must never look like it is collecting redemption fields');

  // Ask again -- simulating the exact original bug scenario.
  const second = await ask('promo-ask-2');
  assert.equal(taskState.activeTask, null, 'the SECOND discovery message must ALSO never create a task -- this is exactly the original bug: a repeated discovery message being fed into a pending redemption draft as if it were a customer name');
  assert.notEqual(second.mode, 'propose_action');
  assert.notEqual(second.mode, 'collect_field');
  assert.deepEqual(second.knowledgeRequests, first.knowledgeRequests, 'both askings plan the identical, correct knowledge request -- no drift into name-collection mode');
});

test('an explicit accept phrase after discovery DOES create the redemption task -- discovery alone never does, but genuine acceptance still works', async () => {
  let conversationContext: ConversationContextState = emptyConversationContextState(NOW);
  let taskState: TaskStateContainer = emptyTaskStateContainer();
  const adapters: KnowledgeSourceAdapters = { promotion: { eligibility: async () => activePromoFacts() } };

  const discoverTurn = parseSemanticTurnResponse(JSON.stringify({ domain: 'promotion', intent: 'discover_promotions', action: 'discover', entities: {}, references: [], constraints: [], confidence: 0.85, needsClarification: false }), buildSemanticContext(conversationContext, NOW));
  let decision = await processDialogTurn({ semanticTurn: discoverTurn, conversationContext, taskState, channel: 'line', eventId: 'promo-discover' }, adapters, NOW);
  taskState = decision.taskStateContainer;
  conversationContext = applyConversationContextUpdate(conversationContext, { userMessage: 'มีโปรอะไร', channel: 'line', eventId: 'promo-discover', summaryFact: 'asked about promotions' }, NOW);
  assert.equal(taskState.activeTask, null);

  const acceptTurn = parseSemanticTurnResponse(JSON.stringify({ domain: 'promotion', intent: 'accept_promotion', action: 'confirm', entities: { campaignId: 'c1', campaignCode: 'PROMO1', title: 'ตำไทย + ข้าวเหนียว', promoTotal: 99, requiresDateTime: true, items: [] }, references: [], constraints: [], confidence: 0.9, needsClarification: false }), buildSemanticContext(conversationContext, NOW));
  decision = await processDialogTurn({ semanticTurn: acceptTurn, conversationContext, taskState, channel: 'line', eventId: 'promo-accept' }, adapters, NOW);
  assert.ok(decision.taskStateContainer.activeTask, 'an explicit accept phrase must still start the redemption task');
  assert.equal(decision.taskStateContainer.activeTask!.type, 'promotion_redemption');
});
