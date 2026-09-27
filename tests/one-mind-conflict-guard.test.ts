// Human Core PR B item 4: "the deterministic brain cannot override a
// successful semantic result." _thongthai-one-mind-orchestrator.ts's
// transaction conflict guard used to fire whenever EITHER side's action was
// mutating, not only when BOTH were -- so a bounded deterministic lexicon
// guess (e.g. findKnownActivityAssetSelection mistaking a bare name mention
// for a selection) could silently discard an already-usable, correctly
// READ-ONLY model result, purely because the deterministic side guessed
// SOME mutation. modelRefinementIsUsable has already confirmed the model
// result is usable (finite confidence >= 0.7, domain/action known, not a
// low-confidence guess) before this guard even runs -- discarding it anyway
// is exactly "the deterministic brain overriding a successful semantic
// result." The fix requires BOTH sides to claim a mutating action before
// deterministic may win; a read-only model result now always wins over a
// disagreeing deterministic mutation guess.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  processThongthaiOneMindTurn,
  type OneMindDependencies,
} from '../netlify/functions/_thongthai-one-mind-orchestrator';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';

const NOW = new Date('2026-09-27T00:00:00.000Z');
const CANONICAL = '11111111-1111-4111-8111-111111111111';
const GUEST_DB = '22222222-2222-4222-8222-222222222222';

function baseDeps(): Partial<OneMindDependencies> {
  return {
    resolveCanonicalGuestId: async () => CANONICAL,
    guestDbIdFromAnonymousId: async () => GUEST_DB,
    loadConversationContext: async () => emptyConversationContextState(NOW),
    persistConversationContext: async () => undefined,
    loadTaskState: async () => emptyTaskStateContainer(),
    persistTaskState: async () => undefined,
    buildKnowledgeAdapters: () => ({}),
  };
}

test('a confident, read-only model result wins over a disagreeing deterministic MUTATION guess for the same message', async () => {
  // "เอาภาราดร" with no active context deterministically resolves (see
  // _deterministic-semantic-turn.ts's findKnownActivityAssetSelection) to a
  // MUTATING guess: domain:'activity', action:'confirm'. A real model,
  // reading full context the bounded lexicon cannot see, may correctly
  // determine this turn is actually something else entirely and read-only
  // -- that understanding must never be thrown away just because the
  // deterministic side guessed a mutation.
  const result = await processThongthaiOneMindTurn({
    channel: 'line',
    message: 'เอาภาราดร',
    eventId: 'conflict-guard-read-only-wins',
    providerUserKey: 'line-key',
  }, {
    ...baseDeps(),
    interpretSemanticTurn: async () => ({
      domain: 'general',
      intent: 'unrelated_read_only_question',
      action: 'ask',
      informationNeed: 'policy',
      entities: {},
      references: [],
      constraints: [],
      confidence: 0.92,
      needsClarification: false,
    }),
  }, NOW);

  assert.equal(result.semanticTurn.action, 'ask',
    'a confident read-only model result must win, never be discarded for a disagreeing deterministic mutation guess');
  assert.equal(result.semanticTurn.domain, 'general');
  assert.equal(result.semanticTurn.semanticSource, 'openai_supervisor');
});

test('the guard still protects a genuine mutation-vs-mutation conflict: deterministic wins when the model ALSO claims a disagreeing mutation', async () => {
  // Same deterministic guess as above (activity/confirm), but this time the
  // model ALSO claims a mutating action, just a different one -- this is
  // the guard's real, narrower purpose: never let the model silently
  // reinterpret an already-proven mutation into a DIFFERENT mutation.
  const result = await processThongthaiOneMindTurn({
    channel: 'line',
    message: 'เอาภาราดร',
    eventId: 'conflict-guard-mutation-vs-mutation',
    providerUserKey: 'line-key',
  }, {
    ...baseDeps(),
    interpretSemanticTurn: async () => ({
      domain: 'restaurant',
      intent: 'cancel_order',
      action: 'cancel',
      entities: {},
      references: [],
      constraints: [],
      confidence: 0.92,
      needsClarification: false,
    }),
  }, NOW);

  assert.equal(result.semanticTurn.action, 'confirm');
  assert.equal(result.semanticTurn.domain, 'activity');
  assert.equal(result.semanticTurn.semanticSource, 'deterministic_fallback');
});
