// PR A item 3: a confirmed constraint-propagation defect. The Dialog
// Manager plans knowledge/task-state from semanticTurnForDialog's
// memory-merged constraint set (current turn + durable memory, e.g. a
// remembered "shrimp_allergy"), but OneMindTurnResult returned only the
// bare, UNMERGED semanticTurn -- and that bare turn is what
// _thongthai-one-mind-response.ts fed into the actual response composer/
// renderer. So a remembered allergy could be present in state (and used to
// plan knowledge) while being completely invisible to the code that
// actually writes the customer-facing recommendation text.
//
// Compounding it: even when the memory-merged turn WAS available, the
// renderer's own noShrimp check only recognized "no_shrimp"/"avoid_shrimp"/
// "กุ้ง" -- never "shrimp_allergy", the actual canonical key
// _customer-phrase-intelligence.ts stores for an allergy statement (as
// opposed to "no_shrimp" for a stated preference). Both are fixed:
// OneMindTurnResult now also exposes dialogSemanticTurn (the authoritative,
// memory-merged turn) and _thongthai-one-mind-response.ts renders from it;
// _human-grounded-response.ts's hasFoodSafetyConstraint recognizes both
// spellings, read only from the closed constraints array (never the
// free-form normalizedMeaning text, which a paraphrase could otherwise
// trick).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withHarness, guestId, brainRequest } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';

test('a remembered shrimp allergy from an EARLIER turn is never dropped from a LATER menu recommendation', async () => {
  await withHarness(async harness => {
    const gid = guestId('restaurant-allergy-memory-propagation');

    // Turn 1: a plain allergy statement. capturePreferenceSignals persists
    // "shrimp_allergy" to durable guest_memory as a side effect of this
    // turn, independent of whatever responder answers it.
    const allergyTurn = await processThongthaiChatCore(
      brainRequest('แพ้กุ้งค่ะ', gid, 'line'),
      'restaurant-allergy-memory-turn-1',
    );
    assert.equal(allergyTurn.statusCode, 200);

    // Turn 2: a plain recommendation request that itself says nothing about
    // shrimp at all -- only durable memory carries the constraint now.
    (harness.programGeminiReply as unknown as (reply: Record<string, unknown>) => void)({
      domain: 'restaurant',
      intent: 'meal_recommendation',
      action: 'recommend',
      informationNeed: 'recommendation',
      speechAct: 'request_help',
      entities: { partySize: 2 },
      references: [],
      constraints: [],
      confidence: 0.95,
      needsClarification: false,
    });
    const recommendation = await processThongthaiChatCore(
      brainRequest('แนะนำเมนูให้หน่อยครับ', gid, 'line'),
      'restaurant-allergy-memory-turn-2',
    );
    assert.equal(recommendation.statusCode, 200);
    const message = String(recommendation.payload.message ?? '');

    assert.doesNotMatch(message, /ผัดไทย|ต้มยำกุ้ง/u,
      'a remembered shrimp allergy must exclude every shrimp dish, even though turn 2 never restated it and the current turn\'s own constraints array was empty');
  });
});
