// Phase B tests.
//
// ==========================================================================
// EVAL STATUS -- read before trusting a "pass" here as more than it is:
//
// STATIC/NETWORK-FREE SEMANTIC CONTRACT: PASS (this file, run by `npm test`).
//   Proves the deterministic validation/reference-resolution layer correctly
//   accepts each corpus case's simulatedModelOutput and resolves references
//   against real context. Does NOT call any model.
//
// LIVE MODEL SEMANTIC CONFORMANCE: PARTIAL LIVE CERTIFICATION IN PROGRESS.
//   Production live-provider certification now runs separately from npm test.
//   npm test intentionally remains network-free; see SEMANTIC_EVAL_STATUS and
//   the Phase 5.4/5.5 handoff checkpoints for live evidence.
// ==========================================================================
//
// What IS fully tested here (network-free):
//   1. the prompt builder (structural correctness, context grounding)
//   2. the response parser/validator/reference-resolver, fed each corpus case's
//      simulatedModelOutput
//   3. shadow comparison against the existing legacy regex routers, to
//      demonstrate concretely where the semantic approach already covers more
//      than the phrase-matching approach -- without changing production routing

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticInterpreterPrompt,
  parseSemanticTurnResponse,
  resolveReferences,
  toSemanticInterpretationMeta,
  confidenceBucket,
  emptySemanticContext,
  SEMANTIC_EVAL_STATUS,
  type SemanticContext,
} from '../netlify/functions/_semantic-interpreter';
import { legacyShadowRoute } from '../netlify/functions/_semantic-interpreter-shadow';
import { SEMANTIC_EVAL_CORPUS } from './fixtures/semantic-eval-corpus';

test('eval status is explicit: static contract is network-free and live certification is tracked separately', () => {
  assert.equal(SEMANTIC_EVAL_STATUS.staticNetworkFreeSemanticContract, 'pass_fail_in_npm_test');
  assert.equal(SEMANTIC_EVAL_STATUS.liveModelSemanticConformance, 'partial_live_certification_in_progress');
});

test(`golden eval corpus has at least 40 cases (has ${SEMANTIC_EVAL_CORPUS.length})`, () => {
  assert.ok(SEMANTIC_EVAL_CORPUS.length >= 40, `corpus too small: ${SEMANTIC_EVAL_CORPUS.length}`);
});

test('every corpus case has a unique id', () => {
  const ids = SEMANTIC_EVAL_CORPUS.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('corpus covers every required category (formal/colloquial/typo/follow_up/correction/topic_switch/ambiguous/multi_intent)', () => {
  const categories = new Set(SEMANTIC_EVAL_CORPUS.map(c => c.category));
  for (const required of ['formal', 'colloquial', 'typo', 'follow_up', 'correction', 'topic_switch', 'ambiguous', 'multi_intent']) {
    assert.ok(categories.has(required as never), `missing category: ${required}`);
  }
});

test('corpus covers restaurant, activity, stay, and promotion domains', () => {
  const domains = new Set(SEMANTIC_EVAL_CORPUS.map(c => c.domainArea));
  for (const required of ['restaurant', 'activity', 'stay', 'promotion']) {
    assert.ok(domains.has(required as never), `missing domain coverage: ${required}`);
  }
});

// --- the deterministic validation/resolution layer, exercised against every corpus case ---

for (const evalCase of SEMANTIC_EVAL_CORPUS) {
  test(`[${evalCase.id}] "${evalCase.message}" -- validation layer accepts and correctly resolves the simulated model output`, () => {
    const context = evalCase.context ?? emptySemanticContext();
    const rawJson = JSON.stringify(evalCase.simulatedModelOutput);
    const turn = parseSemanticTurnResponse(rawJson, context);

    assert.equal(turn.domain, evalCase.expected.domain, `domain mismatch for ${evalCase.id}`);
    if (evalCase.expected.action) {
      assert.equal(turn.action, evalCase.expected.action, `action mismatch for ${evalCase.id}`);
    }
    if (evalCase.expected.needsClarification !== undefined) {
      assert.equal(turn.needsClarification, evalCase.expected.needsClarification, `needsClarification mismatch for ${evalCase.id}`);
    }
    // The parser must never invent a domain/action outside the enum, regardless
    // of what shape the simulated output takes.
    assert.ok(typeof turn.domain === 'string' && turn.domain.length > 0);
    assert.ok(typeof turn.action === 'string' && turn.action.length > 0);
  });
}

// --- semantic equivalence: broad browsing and evaluative choosing are distinct meanings ---

test('semantic equivalence group "broad_discovery": 5 bare-browsing variants all classify as ecosystem/discover', () => {
  const group = SEMANTIC_EVAL_CORPUS.filter(c => c.group === 'broad_discovery');
  assert.equal(group.length, 5);
  for (const evalCase of group) {
    const turn = parseSemanticTurnResponse(JSON.stringify(evalCase.simulatedModelOutput), emptySemanticContext());
    assert.equal(turn.domain, 'ecosystem');
    assert.equal(turn.action, 'discover');
  }
});

test('semantic equivalence group "broad_recommendation": 2 evaluative variants classify as ecosystem/recommend', () => {
  const group = SEMANTIC_EVAL_CORPUS.filter(c => c.group === 'broad_recommendation');
  assert.equal(group.length, 2);
  for (const evalCase of group) {
    const turn = parseSemanticTurnResponse(JSON.stringify(evalCase.simulatedModelOutput), emptySemanticContext());
    assert.equal(turn.domain, 'ecosystem');
    assert.equal(turn.action, 'recommend');
    assert.equal(turn.informationNeed, 'recommendation');
  }
});

test('semantic taxonomy: restaurant catalog browsing is discover while explicit recommendation stays recommend', () => {
  const catalog = SEMANTIC_EVAL_CORPUS.filter(c => c.group === 'restaurant_catalog');
  assert.equal(catalog.length, 2);
  for (const evalCase of catalog) {
    const turn = parseSemanticTurnResponse(JSON.stringify(evalCase.simulatedModelOutput), evalCase.context ?? emptySemanticContext());
    assert.equal(turn.domain, 'restaurant');
    assert.equal(turn.action, 'discover');
    assert.equal(turn.informationNeed, 'catalog');
  }

  const recommendation = SEMANTIC_EVAL_CORPUS.filter(c => c.group === 'restaurant_recommendation');
  assert.equal(recommendation.length, 1);
  const turn = parseSemanticTurnResponse(
    JSON.stringify(recommendation[0]!.simulatedModelOutput),
    recommendation[0]!.context ?? emptySemanticContext(),
  );
  assert.equal(turn.domain, 'restaurant');
  assert.equal(turn.action, 'recommend');
});

test('semantic equivalence group "stay_availability": variants classify as stay/status using relevant context', () => {
  const group = SEMANTIC_EVAL_CORPUS.filter(c => c.group === 'stay_availability');
  assert.equal(group.length, 2);
  for (const evalCase of group) {
    const turn = parseSemanticTurnResponse(
      JSON.stringify(evalCase.simulatedModelOutput),
      evalCase.context ?? emptySemanticContext(),
    );
    assert.equal(turn.domain, 'stay');
    assert.equal(turn.action, 'status');
    assert.equal(turn.informationNeed, 'availability');
  }
});

// --- reference resolution: the specific worked example from the Phase B brief ---

test('reference resolution: "ตัวไหนนิสัยดีกว่า" with horse context resolves domain=activity, comparison intent, needsClarification=false', () => {
  const horseContext: SemanticContext = {
    activeDomain: 'activity',
    recentEntities: [
      { id: 'horse:thongthai', type: 'horse', name: 'ทองไทย', domain: 'activity' },
      { id: 'horse:paradon', type: 'horse', name: 'ภาราดร', domain: 'activity' },
    ],
    lastAction: 'discover',
  };
  const simulated = { domain: 'activity', intent: 'compare_horses_by_temperament', action: 'compare', entities: {},
    references: [{ type: 'entity_selection', refersToPriorContext: true }], constraints: [], confidence: 0.8, needsClarification: false };
  const turn = parseSemanticTurnResponse(JSON.stringify(simulated), horseContext);

  assert.equal(turn.domain, 'activity');
  assert.equal(turn.action, 'compare');
  assert.equal(turn.needsClarification, false);
  assert.equal(turn.references.length, 1);
  // "ตัวไหน" names nothing specific but there are exactly 2 horses in the
  // active domain -- both are plausible referents of a comparison question.
  assert.deepEqual(turn.references[0]!.resolvedEntityIds?.sort(), ['horse:paradon', 'horse:thongthai']);
});

test('reference resolution: "เอาภาราดร" resolves to exactly the named horse, not ambiguous', () => {
  const horseContext: SemanticContext = {
    activeDomain: 'activity',
    recentEntities: [
      { id: 'horse:thongthai', type: 'horse', name: 'ทองไทย', domain: 'activity' },
      { id: 'horse:paradon', type: 'horse', name: 'ภาราดร', domain: 'activity' },
    ],
  };
  const references = resolveReferences(
    [{ type: 'entity_selection', value: 'ภาราดร', refersToPriorContext: true }],
    horseContext,
  );
  assert.equal(references[0]!.resolvedEntityId, 'horse:paradon');
  assert.equal(references[0]!.ambiguous, undefined);
});

test('reference resolution: a prior-context reference with no matching context entity forces needsClarification', () => {
  const turn = parseSemanticTurnResponse(
    JSON.stringify({ domain: 'unknown', intent: 'unclear_selection', action: 'unknown', entities: {},
      references: [{ type: 'previous_selection', value: 'อันนั้น', refersToPriorContext: true }],
      constraints: [], confidence: 0.3, needsClarification: false }), // model itself said false
    emptySemanticContext(), // but there is nothing to resolve against
  );
  // the deterministic layer overrides needsClarification when a flagged
  // reference genuinely can't be resolved, even if the model didn't flag it
  assert.equal(turn.needsClarification, true);
  assert.equal(turn.clarificationReason, 'unresolved_reference');
});

// --- prompt builder structural checks ---

test('the interpreter prompt grounds the model in given context and never asks it to invent unstated values', () => {
  const context: SemanticContext = {
    activeDomain: 'activity',
    recentEntities: [{ id: 'horse:paradon', type: 'horse', name: 'ภาราดร', domain: 'activity' }],
    lastAction: 'discover',
  };
  const prompt = buildSemanticInterpreterPrompt(context);
  assert.match(prompt, /ภาราดร/);
  assert.match(prompt, /never invent a value/i);
  assert.match(prompt, /do not require a phrase to match anything you've seen before/i);
});

test('the interpreter prompt never asks the model to expose its own reasoning/chain-of-thought', () => {
  const prompt = buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.doesNotMatch(prompt, /chain.of.thought/i);
  assert.doesNotMatch(prompt, /explain your reasoning/i);
});

test('the prompt with empty context says so explicitly rather than fabricating a fake context', () => {
  const prompt = buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.match(prompt, /CONVERSATION CONTEXT: none/);
});

// --- instrumentation / observability metadata (Phase J precursor) ---

test('toSemanticInterpretationMeta exposes only safe structured fields, never raw model text', () => {
  const turn = parseSemanticTurnResponse(
    JSON.stringify({ domain: 'activity', intent: 'select_horse', action: 'confirm', entities: { horseName: 'ภาราดร' },
      references: [{ type: 'entity_selection', value: 'ภาราดร', refersToPriorContext: true }], constraints: [], confidence: 0.92, needsClarification: false }),
    { activeDomain: 'activity', recentEntities: [{ id: 'horse:paradon', type: 'horse', name: 'ภาราดร', domain: 'activity' }] },
  );
  const meta = toSemanticInterpretationMeta(turn);
  assert.deepEqual(Object.keys(meta).sort(), [
    'action', 'confidenceBucket', 'domain', 'informationNeed', 'intent', 'needsClarification',
    'referencesResolved', 'referencesUnresolved', 'semanticVersion',
  ]);
  assert.equal(meta.confidenceBucket, 'high');
  assert.equal(meta.referencesResolved, 1);
  assert.equal(meta.referencesUnresolved, 0);
});

test('confidenceBucket thresholds', () => {
  assert.equal(confidenceBucket(0.9), 'high');
  assert.equal(confidenceBucket(0.75), 'high');
  assert.equal(confidenceBucket(0.5), 'medium');
  assert.equal(confidenceBucket(0.45), 'medium');
  assert.equal(confidenceBucket(0.2), 'low');
});

// --- shadow comparison against legacy deterministic routers (no production wiring) ---

test('shadow comparison: colloquial broad-discovery variants are all covered by the deterministic fallback matcher', () => {
  const group = SEMANTIC_EVAL_CORPUS.filter(c => c.group === 'broad_discovery');
  const legacyResults = group.map(c => ({ id: c.id, message: c.message, ...legacyShadowRoute(c.message) }));
  const legacyMissed = legacyResults.filter(r => r.legacyDomain !== 'ecosystem').map(r => r.message);
  assert.deepEqual(legacyMissed, []);
});

test('shadow comparison: legacy router has no concept of reference resolution at all (it is message-only, never sees context)', () => {
  // "ตัวไหน" alone, out of context, cannot be classified by any existing
  // legacy regex router -- there is no phrase list for "which one". This is
  // the concrete case the semantic interpreter is built to cover that no
  // amount of adding more regexes to the old system would solve well.
  const result = legacyShadowRoute('ตัวไหน');
  assert.equal(result.legacyDomain, null);
  assert.deepEqual(result.matchedBy, []);
});

test('shadow comparison: promotion discovery -- documents a real legacy-router gap on word-order variation', () => {
  // Real finding: the legacy DISCOVERY_RE in _promotion-dialog.ts matches
  // "มีโปรอะไร" (mention-then-question) but not "โปรมีไร" (question-then-mention,
  // a completely ordinary colloquial reordering). No amount of adding one more
  // literal phrase fixes this class of variation -- it's a genuine case for
  // semantic understanding, not one more regex alternative.
  const discoveryResult = legacyShadowRoute('โปรมีไร');
  assert.equal(discoveryResult.legacyDomain, null, 'documents that this phrasing is NOT currently caught by the legacy router');
});
