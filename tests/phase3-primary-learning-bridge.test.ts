import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Phase 3 does not bypass the 100% primary Agent for preference/state turns',()=>{
  const source=readFileSync(
    new URL('../netlify/functions/thongthai-chat.ts',import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source,/phase3SemanticLearningEligible/u);
  assert.doesNotMatch(source,/isPhase3SemanticLearningCandidate/u);
  assert.match(
    source,
    /const readOnlyPrimaryAgentEligible = shouldUseThongthaiAgentPrimary\(/u,
    'ordinary primary-Agent eligibility must not be disabled by a phrase-level learning shortcut',
  );
});

test('learned semantic output remains an accepted fallback outcome after primary-Agent routing',()=>{
  const source=readFileSync(
    new URL('../netlify/functions/thongthai-chat.ts',import.meta.url),
    'utf8',
  );
  assert.match(
    source,
    /semanticSource === 'semantic_concept_memory'/u,
    'semantic concept memory may remain a safe fallback capability without preempting Agent continuity',
  );
});

test('Phase 3 fallback learning cannot gain transaction authority',()=>{
  const source=readFileSync(
    new URL('../netlify/functions/_semantic-concept-memory.ts',import.meta.url),
    'utf8',
  );
  assert.match(source,/consider_only/u);
  assert.match(source,/no_transaction/u);
  assert.doesNotMatch(source,/commit_prepared_|create_booking|create_restaurant_preorder|create_otop_order/u);
});
