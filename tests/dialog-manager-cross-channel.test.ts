// Phase F: proves the SERVER (not LINE's chatHistory array) supplies
// continuity. Same canonical guest: turn 1 on web, turn 2 on LINE with
// chatHistory: [] (LINE's real, still-unfixed production behavior -- see
// THONGTHAI_HANDOFF.md's "Known gap" note). The new Dialog Manager pipeline
// must still understand turn 2 as a continuation, driven entirely by
// server-loaded conversationContext/taskState, never by a channel-supplied
// history array. This is the concrete proof Phase G needs before it can
// simplify the channel adapters with confidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processDialogTurn, type DialogInput } from '../netlify/functions/_dialog-manager';
import { applyConversationContextUpdate, buildSemanticContext, emptyConversationContextState, type ConversationContextState } from '../netlify/functions/_conversation-context';
import { emptyTaskStateContainer, type TaskStateContainer } from '../netlify/functions/_task-state';
import { parseSemanticTurnResponse } from '../netlify/functions/_semantic-interpreter';
import type { KnowledgeSourceAdapters } from '../netlify/functions/_knowledge-resolver';

const NOW = new Date('2026-09-18T10:00:00.000Z');

test('same canonical guest: web turn 1 then LINE turn 2 (chatHistory: []) -- server context alone makes turn 2 coherent', async () => {
  let conversationContext: ConversationContextState = emptyConversationContextState(NOW);
  let taskState: TaskStateContainer = emptyTaskStateContainer();
  const adapters: KnowledgeSourceAdapters = {};

  // Turn 1, WEB channel: "อยากขี่ม้า" -- domain narrows to activity, no chatHistory needed (fresh channel each time anyway).
  const turn1Context = buildSemanticContext(conversationContext, NOW);
  const turn1 = parseSemanticTurnResponse(JSON.stringify({ domain: 'activity', intent: 'want_horse_riding', action: 'ask', entities: {}, references: [], constraints: [], confidence: 0.85, needsClarification: false }), turn1Context);
  const decision1 = await processDialogTurn({ semanticTurn: turn1, conversationContext, taskState, channel: 'web', eventId: 'cross-channel-1' }, adapters, NOW);
  taskState = decision1.taskStateContainer;
  conversationContext = applyConversationContextUpdate(conversationContext, {
    userMessage: 'อยากขี่ม้า', channel: 'web', eventId: 'cross-channel-1',
    activeDomain: 'activity', activeTopic: 'horse riding', summaryFact: 'customer wants to ride a horse',
  }, NOW);

  // Turn 2, LINE channel, chatHistory: [] (this test never even constructs
  // one -- proving the pipeline needs none of it): "พรุ่งนี้สองคน". This is
  // only coherent as "2 people, tomorrow, FOR THE HORSE RIDING" if the
  // server's own conversationContext -- not any channel-supplied array --
  // is what supplies that continuity.
  const turn2Context = buildSemanticContext(conversationContext, NOW);
  assert.equal(turn2Context.activeDomain, 'activity', 'the server context alone must already know we are mid-activity-discussion before turn 2 is even interpreted');
  // No `references` entry: an unresolvable prior-context reference (this
  // test never registered a recentEntity to resolve against) would force
  // needsClarification=true and block the merge -- the continuity being
  // tested here is domain/topic continuity via conversationContext, not
  // entity-reference resolution, so entities alone carry the turn's data.
  const turn2 = parseSemanticTurnResponse(JSON.stringify({ domain: 'activity', intent: 'provide_booking_slot_info', action: 'provide_information', entities: { date: 'พรุ่งนี้', partySize: 2 }, references: [], constraints: [], confidence: 0.85, needsClarification: false }), turn2Context);
  const decision2 = await processDialogTurn({ semanticTurn: turn2, conversationContext, taskState, channel: 'line', eventId: 'cross-channel-2' }, adapters, NOW);

  assert.ok(decision2.taskStateContainer.activeTask, 'turn 2 must be understood as continuing the activity topic, not as an unrelated fresh message');
  assert.equal(decision2.taskStateContainer.activeTask!.domain, 'activity');
  assert.equal(decision2.taskStateContainer.activeTask!.slots.date, 'พรุ่งนี้');
  assert.equal(decision2.taskStateContainer.activeTask!.slots.partySize, 2);
  assert.equal(decision2.taskStateContainer.activeTask!.sourceChannel, 'line', 'the task itself correctly records which channel this turn arrived on, even though continuity came from the server');
});
