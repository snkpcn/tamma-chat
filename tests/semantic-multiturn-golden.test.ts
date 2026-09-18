// Phase C's required multi-turn golden test: the exact horse-booking scenario
// from the brief, driven end-to-end through the real reducer
// (applyConversationContextUpdate) and the real Phase B validation layer
// (parseSemanticTurnResponse), turn by turn. Network-free -- see
// tests/fixtures/semantic-multiturn-scenarios.ts's header.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyConversationContextUpdate,
  buildSemanticContext,
  emptyConversationContextState,
} from '../netlify/functions/_conversation-context';
import { parseSemanticTurnResponse } from '../netlify/functions/_semantic-interpreter';
import { HORSE_BOOKING_SCENARIO } from './fixtures/semantic-multiturn-scenarios';

test('horse-booking golden scenario: 6 turns, continuity holds, reference resolution works, no fake availability/booking claimed', () => {
  let state = emptyConversationContextState();

  for (const [index, step] of HORSE_BOOKING_SCENARIO.entries()) {
    // 1. Build the SemanticContext exactly the way a real request would --
    //    from whatever the conversation-context reducer has accumulated so far.
    const context = buildSemanticContext(state);

    // 2. Feed this step's simulated model output through the REAL validation/
    //    reference-resolution layer, grounded in that real context.
    const turn = parseSemanticTurnResponse(JSON.stringify(step.simulatedModelOutput), context);
    assert.equal(turn.domain, step.expected.domain, `turn ${index + 1} ("${step.message}") domain mismatch`);
    if (step.expected.action) {
      assert.equal(turn.action, step.expected.action, `turn ${index + 1} ("${step.message}") action mismatch`);
    }

    // 3. Apply this turn's context update -- the state a later phase's Dialog
    //    Manager would have produced from this SemanticTurn.
    state = applyConversationContextUpdate(state, {
      ...step.contextUpdate,
      channel: step.channel,
      eventId: step.eventId,
      userMessage: step.message,
    });
  }

  // Continuity assertions on the FINAL state, proving the whole chain held:
  assert.equal(state.activeDomain, 'activity', 'domain must still be activity after 6 turns');
  assert.equal(state.currentTaskReference, 'activity_booking:horse:paradon', 'the selected horse/task must survive every later turn');
  assert.ok(state.recentEntities.some(e => e.name === 'ภาราดร'), 'ภาราดร must still be a known entity at the end');
  assert.ok(state.recentTurns.some(t => t.channel === 'web'), 'the scenario must include the original web turns');
  assert.ok(state.recentTurns.some(t => t.channel === 'line'), 'the scenario must include the later LINE turns (cross-channel mid-flow)');
  assert.match(state.rollingSummary, /ภาราดร/);
  assert.match(state.rollingSummary, /tomorrow|พรุ่งนี้|2 people/);

  // Explicit negative assertion matching the brief: Phase C must not fake
  // availability or claim a booking anywhere in this scenario.
  assert.equal(state.lastToolResultSummary, null, 'no tool was actually called in this scenario -- Phase C does not execute bookings');
  assert.notEqual(state.lastAction, 'book', 'the final turn only asked about a time slot -- it must not have been recorded as an actual booking action');
});

test('golden scenario turn 2 ("ม้าล่ะ") correctly introduces both horses as conversation-scoped (non-canonical) entities', () => {
  let state = emptyConversationContextState();
  const step1 = HORSE_BOOKING_SCENARIO[0]!;
  state = applyConversationContextUpdate(state, { ...step1.contextUpdate, channel: step1.channel, eventId: step1.eventId, userMessage: step1.message });
  const step2 = HORSE_BOOKING_SCENARIO[1]!;
  state = applyConversationContextUpdate(state, { ...step2.contextUpdate, channel: step2.channel, eventId: step2.eventId, userMessage: step2.message });

  assert.equal(state.recentEntities.length, 2);
  for (const entity of state.recentEntities) {
    assert.equal(entity.canonical, false, `${entity.name} must be honestly represented as non-canonical -- no real operational id exists for it yet at Phase C`);
    assert.equal(entity.source, 'conversation');
    assert.match(entity.id, /^conv:/, 'a non-canonical entity must use a conversation-scoped id, never a fabricated operational-looking id');
  }
});

test('golden scenario turn 3 ("ตัวไหนนิสัยดีกว่า") resolves the reference to BOTH horses, not a guess at one', () => {
  let state = emptyConversationContextState();
  for (const step of HORSE_BOOKING_SCENARIO.slice(0, 2)) {
    state = applyConversationContextUpdate(state, { ...step.contextUpdate, channel: step.channel, eventId: step.eventId, userMessage: step.message });
  }
  const context = buildSemanticContext(state);
  const step3 = HORSE_BOOKING_SCENARIO[2]!;
  const turn = parseSemanticTurnResponse(JSON.stringify(step3.simulatedModelOutput), context);
  assert.equal(turn.references.length, 1);
  assert.deepEqual(turn.references[0]!.resolvedEntityIds?.sort(), ['conv:horse:paradon', 'conv:horse:thongthai']);
  assert.equal(turn.needsClarification, false);
});

test('golden scenario turn 4 ("เอาภาราดร") resolves unambiguously to exactly ภาราดร, not both', () => {
  let state = emptyConversationContextState();
  for (const step of HORSE_BOOKING_SCENARIO.slice(0, 3)) {
    state = applyConversationContextUpdate(state, { ...step.contextUpdate, channel: step.channel, eventId: step.eventId, userMessage: step.message });
  }
  const context = buildSemanticContext(state);
  const step4 = HORSE_BOOKING_SCENARIO[3]!;
  const turn = parseSemanticTurnResponse(JSON.stringify(step4.simulatedModelOutput), context);
  assert.equal(turn.references[0]!.resolvedEntityId, 'conv:horse:paradon');
  assert.equal(turn.references[0]!.ambiguous, undefined);
});

test('replaying the whole scenario with duplicated eventIds (simulating retried webhook delivery) produces the SAME final state', () => {
  function run(withDuplicates: boolean): ReturnType<typeof emptyConversationContextState> {
    let state = emptyConversationContextState();
    for (const step of HORSE_BOOKING_SCENARIO) {
      state = applyConversationContextUpdate(state, { ...step.contextUpdate, channel: step.channel, eventId: step.eventId, userMessage: step.message });
      if (withDuplicates) {
        // redeliver the same event -- must be a no-op
        state = applyConversationContextUpdate(state, { ...step.contextUpdate, channel: step.channel, eventId: step.eventId, userMessage: step.message });
      }
    }
    return state;
  }
  const clean = run(false);
  const withRetries = run(true);
  assert.deepEqual(withRetries.recentTurns, clean.recentTurns);
  assert.deepEqual(withRetries.recentEntities, clean.recentEntities);
  assert.equal(withRetries.currentTaskReference, clean.currentTaskReference);
});
