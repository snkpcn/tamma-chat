// Human Core PR C: CanonicalKnowledgeScope resolution + the response scope
// firewall. These are the C8-required system property tests for scope
// isolation, fail-closed behavior, SOT-driven resolution, and resilience to
// catalog reordering / new unseen activity types.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveCanonicalKnowledgeScope,
  resolveCanonicalScopeAgainstFacts,
  filterFactsByCanonicalScope,
  type CanonicalKnowledgeScope,
} from '../netlify/functions/_canonical-knowledge-scope';
import { deriveSemanticMeaning } from '../netlify/functions/_semantic-meaning';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';
import type { GroundedFact } from '../netlify/functions/_knowledge-resolver';

function turn(overrides: Partial<SemanticTurn>): SemanticTurn {
  return {
    domain: 'activity', intent: 'test', action: 'discover', entities: {}, references: [],
    constraints: [], confidence: 0.95, needsClarification: false, ...overrides,
  };
}

function fact(key: string, value: unknown): GroundedFact {
  return { key, value, domain: 'activity', sourceId: 'test', sourceType: 'activity_live', authoritative: true, fetchedAt: '2026-09-27T00:00:00.000Z' };
}

// A three-type catalog: horse (2 assets), atv (2 assets), archery (1 asset).
function catalogFacts(): GroundedFact[] {
  return [
    fact('activity:horse:name', 'ขี่ม้า'),
    fact('activity:atv:name', 'ATV'),
    fact('activity:archery:name', 'ยิงธนู'),
    fact('activity_asset:horse-pharadon:name', 'ภาราดร'),
    fact('activity_asset:horse-pharadon:activityCode', 'horse'),
    fact('activity_asset:horse-pharadon:type', 'horse'),
    fact('activity_asset:horse-thongthai:name', 'ทองไทย'),
    fact('activity_asset:horse-thongthai:activityCode', 'horse'),
    fact('activity_asset:horse-thongthai:type', 'horse'),
    fact('activity_asset:atv-1:name', 'ATV คันที่ 1'),
    fact('activity_asset:atv-1:activityCode', 'atv'),
    fact('activity_asset:atv-1:type', 'atv'),
    fact('activity_asset:atv-2:name', 'ATV คันที่ 2'),
    fact('activity_asset:atv-2:activityCode', 'atv'),
    fact('activity_asset:atv-2:type', 'atv'),
    fact('activity_asset:archery-1:name', 'เลนยิงธนู 1'),
    fact('activity_asset:archery-1:activityCode', 'archery'),
    fact('activity_asset:archery-1:type', 'archery'),
  ];
}

function assetNames(facts: readonly GroundedFact[]): string[] {
  return facts.filter(f => /^activity_asset:[^:]+:name$/.test(f.key)).map(f => String(f.value)).sort();
}

// --- 1-3: focused isolation for each activity type ---

test('C8.1 focused horse scope: no ATV/archery assets leak through', () => {
  const scope = deriveCanonicalKnowledgeScope(deriveSemanticMeaning(turn({ entities: { activityCode: 'horse' } })));
  const filtered = filterFactsByCanonicalScope(catalogFacts(), scope);
  assert.deepEqual(assetNames(filtered), ['ทองไทย', 'ภาราดร']);
});

test('C8.2 focused ATV scope: no horse/archery assets leak through', () => {
  const scope = deriveCanonicalKnowledgeScope(deriveSemanticMeaning(turn({ entities: { activityCode: 'atv' } })));
  const filtered = filterFactsByCanonicalScope(catalogFacts(), scope);
  assert.deepEqual(assetNames(filtered), ['ATV คันที่ 1', 'ATV คันที่ 2']);
});

test('C8.3 focused archery scope: no horse/ATV assets leak through', () => {
  const scope = deriveCanonicalKnowledgeScope(deriveSemanticMeaning(turn({ entities: { activityCode: 'archery' } })));
  const filtered = filterFactsByCanonicalScope(catalogFacts(), scope);
  assert.deepEqual(assetNames(filtered), ['เลนยิงธนู 1']);
});

// --- 4: domain-wide allows everything ---

test('C8.4 domain-wide activity discovery: all activity groups allowed', () => {
  const scope = deriveCanonicalKnowledgeScope(deriveSemanticMeaning(turn({ action: 'discover', informationNeed: 'catalog' })));
  assert.equal(scope.breadth, 'domain_wide');
  const filtered = filterFactsByCanonicalScope(catalogFacts(), scope);
  assert.deepEqual(assetNames(filtered), assetNames(catalogFacts()));
});

// Real regression found while wiring this into the actual dialog manager
// (zero-cost-provider-outage.test.ts): a turn whose SEMANTIC LAYER ITSELF
// already resolved a specific entity reference (activity_asset:horse-
// pharadon, not merely a bare name) reaches deriveCanonicalKnowledgeScope
// with canonicalEntityIds already set but canonicalParentIds still empty
// (the parent relationship only exists in the live catalog). Without
// backfilling the parent from fetched facts, the firewall correctly kept
// the asset's OWN facts but wrongly stripped the PARENT's facts
// (activity:horse:resourceCode, :name, ...) since 'horse' was never in
// canonicalParentIds -- breaking resourceCode resolution for an already-
// resolved selection.
test('a pre-resolved entity reference (not just a bare name) still gets its parent backfilled from the live catalog, preserving parent-level facts', () => {
  const meaning = deriveSemanticMeaning(turn({
    action: 'confirm',
    references: [{ type: 'entity_selection', refersToPriorContext: false, resolvedEntityId: 'activity_asset:horse-pharadon' }],
  }));
  const scope = deriveCanonicalKnowledgeScope(meaning);
  assert.equal(scope.status, 'resolved');
  assert.deepEqual(scope.canonicalEntityIds, ['activity_asset:horse-pharadon']);
  assert.deepEqual(scope.canonicalParentIds, [], 'parent is not yet known before a catalog fetch');

  const refined = resolveCanonicalScopeAgainstFacts(scope, catalogFacts());
  assert.deepEqual(refined.canonicalParentIds, ['horse']);

  const filtered = filterFactsByCanonicalScope(catalogFacts(), refined);
  assert.ok(filtered.some(f => f.key === 'activity:horse:name'), 'the parent activity\'s own facts (e.g. resourceCode) must survive, not just the specific asset\'s facts');
  assert.deepEqual(assetNames(filtered), ['ทองไทย', 'ภาราดร']);
});

// --- 5: focused unresolved fails closed ---

test('C8.5 focused + unresolved never falls back to the broad catalog', () => {
  // A reference-based focus that never resolved to any real entity, and no
  // catalog match exists for it (e.g. the resolver couldn't canonicalize).
  const meaning = deriveSemanticMeaning(turn({
    action: 'confirm',
    entities: { horseName: 'ม้าที่ไม่มีอยู่จริง' },
  }));
  assert.equal(meaning.scopeBreadth, 'focused');
  const scope = deriveCanonicalKnowledgeScope(meaning);
  assert.equal(scope.status, 'ambiguous');
  const refined = resolveCanonicalScopeAgainstFacts(scope, catalogFacts());
  assert.equal(refined.status, 'unresolved', 'a name absent from the live catalog must never resolve to something');
  const filtered = filterFactsByCanonicalScope(catalogFacts(), refined);
  assert.deepEqual(filtered, [], 'focused + unresolved must return NO facts, never the whole catalog');
});

// --- 6: named asset infers canonical parent from SOT ---

test('C8.6 a named asset ("ภาราดร") infers its canonical parent (horse) from the live catalog, never hardcoded', () => {
  const meaning = deriveSemanticMeaning(turn({ action: 'recommend', entities: { horseName: 'ภาราดร' } }));
  const scope = deriveCanonicalKnowledgeScope(meaning);
  assert.equal(scope.status, 'ambiguous');
  assert.equal(scope.pendingFocusName, 'ภาราดร');
  const refined = resolveCanonicalScopeAgainstFacts(scope, catalogFacts());
  assert.equal(refined.status, 'resolved');
  assert.deepEqual(refined.canonicalEntityIds, ['activity_asset:horse-pharadon']);
  assert.deepEqual(refined.canonicalParentIds, ['horse']);
  const filtered = filterFactsByCanonicalScope(catalogFacts(), refined);
  assert.deepEqual(assetNames(filtered), ['ทองไทย', 'ภาราดร'], 'resolving one named horse scopes to its WHOLE parent type, both horses');
});

// --- 7: prior-context asset gets the same canonical parent scope ---

test('C8.7 a prior-context reference to a named asset resolves to the same canonical parent scope', () => {
  const meaning = deriveSemanticMeaning(turn({
    action: 'confirm',
    references: [{ type: 'entity_selection', value: 'ทองไทย', refersToPriorContext: true }],
  }));
  assert.equal(meaning.focusKind, 'prior_reference');
  const scope = deriveCanonicalKnowledgeScope(meaning);
  const refined = resolveCanonicalScopeAgainstFacts(scope, catalogFacts());
  assert.equal(refined.status, 'resolved');
  assert.deepEqual(refined.canonicalParentIds, ['horse']);
});

// --- 8: contaminated bundle firewall strips unrelated facts ---

test('C8.8 an intentionally contaminated bundle (extra unrelated facts) is still correctly firewalled', () => {
  const contaminated = [
    ...catalogFacts(),
    fact('restaurant:menu-item:price', 120),
    fact('activity_asset:atv-1:notes', 'requires helmet'),
  ];
  const scope = deriveCanonicalKnowledgeScope(deriveSemanticMeaning(turn({ entities: { activityCode: 'horse' } })));
  const filtered = filterFactsByCanonicalScope(contaminated, scope);
  assert.deepEqual(assetNames(filtered), ['ทองไทย', 'ภาราดร']);
  assert.ok(!filtered.some(f => f.key.startsWith('activity_asset:atv')), 'no ATV fact of any kind must survive the horse firewall');
});

// --- 9: arbitrary intent spelling does not change scope behavior ---

test('C8.9 an arbitrary/unrecognized intent label never changes scope behavior', () => {
  const a = deriveCanonicalKnowledgeScope(deriveSemanticMeaning(turn({ intent: 'xyz_totally_made_up_intent_123', entities: { activityCode: 'horse' } })));
  const b = deriveCanonicalKnowledgeScope(deriveSemanticMeaning(turn({ intent: 'another_random_label', entities: { activityCode: 'horse' } })));
  assert.deepEqual(a, b);
});

// --- 10: arbitrary free-form normalizedMeaning does not change scope behavior ---

test('C8.10 free-form normalizedMeaning text never changes scope behavior, even when it mentions other activity types', () => {
  const withoutText = deriveCanonicalKnowledgeScope(deriveSemanticMeaning(turn({ entities: { activityCode: 'horse' } })));
  const withMisleadingText = deriveCanonicalKnowledgeScope(deriveSemanticMeaning(turn({
    entities: { activityCode: 'horse' },
    normalizedMeaning: 'the customer is asking about ATV and archery availability',
  })));
  assert.deepEqual(withoutText, withMisleadingText);
});

// --- 11: shuffled catalog order gives the same result ---

test('C8.11 shuffled catalog fact order produces the identical scoped result', () => {
  const shuffled = [...catalogFacts()].reverse();
  const scope = deriveCanonicalKnowledgeScope(deriveSemanticMeaning(turn({ entities: { activityCode: 'atv' } })));
  assert.deepEqual(assetNames(filterFactsByCanonicalScope(shuffled, scope)), ['ATV คันที่ 1', 'ATV คันที่ 2']);
});

// --- 12: a NEW fake activity type keeps existing focused scopes isolated ---

test('C8.12 adding a brand-new fake activity type to the catalog does not leak into an existing focused scope, with no renderer/keyword change', () => {
  const withNewType: GroundedFact[] = [
    ...catalogFacts(),
    fact('activity:zipline:name', 'ซิปไลน์'),
    fact('activity_asset:zipline-1:name', 'ซิปไลน์สาย 1'),
    fact('activity_asset:zipline-1:activityCode', 'zipline'),
    fact('activity_asset:zipline-1:type', 'zipline'),
  ];
  const horseScope = deriveCanonicalKnowledgeScope(deriveSemanticMeaning(turn({ entities: { activityCode: 'horse' } })));
  const filtered = filterFactsByCanonicalScope(withNewType, horseScope);
  assert.deepEqual(assetNames(filtered), ['ทองไทย', 'ภาราดร'], 'the new zipline type must not appear in a horse-focused scope');

  const ziplineScope = deriveCanonicalKnowledgeScope(deriveSemanticMeaning(turn({ entities: { activityCode: 'zipline' } })));
  const ziplineFiltered = filterFactsByCanonicalScope(withNewType, ziplineScope);
  assert.deepEqual(assetNames(ziplineFiltered), ['ซิปไลน์สาย 1'], 'the new type itself IS correctly scoped once its own activityCode is stated -- no code change was needed for this to work');
});

// --- 13: selection is still not a transaction (already covered by PR A/B, reasserted here for this contract) ---

test('C8.13 a focused entity selection carries no transaction commitment of its own', () => {
  const meaning = deriveSemanticMeaning(turn({ action: 'confirm', speechAct: 'selection', entities: { horseName: 'ภาราดร' } }));
  assert.equal(meaning.commitmentLevel, 'planning');
  assert.notEqual(meaning.commitmentLevel, 'explicit_transaction');
});

// --- domain not yet canonicalized: firewall is a no-op (never makes an un-migrated domain stricter) ---

test('a focused turn in a domain this contract has not canonicalized yet firewalls as a no-op', () => {
  const meaning = deriveSemanticMeaning(turn({
    domain: 'otop', action: 'confirm',
    references: [{ type: 'entity_selection', refersToPriorContext: false, resolvedEntityId: 'otop:gift-a' }],
  }));
  assert.equal(meaning.scopeBreadth, 'focused');
  const scope: CanonicalKnowledgeScope = deriveCanonicalKnowledgeScope(meaning);
  assert.equal(scope.status, 'unresolved');
  const facts = [fact('otop:gift-a:name', 'ของฝาก A'), fact('otop:gift-b:name', 'ของฝาก B')];
  assert.deepEqual(filterFactsByCanonicalScope(facts, scope), facts);
});
