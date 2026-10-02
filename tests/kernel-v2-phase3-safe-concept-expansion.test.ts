import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  matchLearnedConcept,
  normalizeForConceptMatching,
  recordSemanticConceptEvidence,
  safeConceptOutcome,
  semanticConceptKeyForConfirmedMeaning,
  type StoredSemanticConcept,
} from '../netlify/functions/_semantic-concept-memory';
import { semanticTurnFromLearnedConcept } from '../netlify/functions/_thongthai-one-mind-orchestrator';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';
import type { SemanticContext } from '../netlify/functions/_semantic-interpreter';

function concept(
  conceptKey: StoredSemanticConcept['conceptKey'],
  phrase: string,
  overrides: Partial<StoredSemanticConcept> = {},
): StoredSemanticConcept {
  return {
    id:'phase3-concept-'+conceptKey,
    conceptKey,
    normalizedSignature:normalizeForConceptMatching(phrase),
    confidence:0.9,
    evidenceCount:5,
    contradictionCount:0,
    status:'active',
    ...overrides,
  };
}

test('Phase 3: canonical model meaning maps only one safe concept family at a time', () => {
  assert.equal(
    semanticConceptKeyForConfirmedMeaning({ entities:{pace:'relaxed'}, constraints:[] }),
    'pace_relaxed',
  );
  assert.equal(
    semanticConceptKeyForConfirmedMeaning({ entities:{}, constraints:['low_exertion'] }),
    'pace_relaxed',
    'production semantic supervisor emits low_exertion as a structured constraint',
  );
  assert.equal(
    semanticConceptKeyForConfirmedMeaning({ entities:{}, constraints:['consider_only'] }),
    'consider_only',
  );
  assert.equal(
    semanticConceptKeyForConfirmedMeaning({ entities:{companion:'partner'}, constraints:[] }),
    'companion_partner',
  );
  assert.equal(
    semanticConceptKeyForConfirmedMeaning({
      entities:{companion:'partner',pace:'relaxed'},
      constraints:[],
    }),
    null,
    'compound learnable meanings must not collapse into one reusable concept',
  );
});

test('Phase 3: learned outcomes are closed and cannot carry transaction authority', () => {
  const pace=safeConceptOutcome('pace_relaxed');
  assert.deepEqual(pace.entities,{pace:'relaxed'});
  assert.deepEqual(pace.constraints,[]);

  const consider=safeConceptOutcome('consider_only');
  assert.deepEqual(consider.entities,{});
  assert.deepEqual(consider.constraints,['consider_only','no_transaction']);
  assert.equal(consider.requiresUniqueContextEntity,true);

  const serialized=JSON.stringify({pace,consider});
  assert.doesNotMatch(serialized,/book|order|tool|payment|price|availability|commit_prepared/u);
});

test('Phase 3: exact replay becomes zero-call eligible after one confirmed example', () => {
  const rows=[
    concept('pace_relaxed','ไม่อยากเหนื่อยมาก',{confidence:0.7,evidenceCount:1}),
    concept('consider_only','เอาอันนี้ไว้ก่อน',{confidence:0.7,evidenceCount:1}),
  ];
  assert.equal(matchLearnedConcept('ไม่อยากเหนื่อยมากครับ',rows)?.conceptKey,'pace_relaxed');
  assert.equal(matchLearnedConcept('เอาอันนี้ไว้ก่อนนะครับ',rows)?.conceptKey,'consider_only');
});

test('Phase 3: consider-only learned meaning requires one bounded referent', () => {
  const match=matchLearnedConcept('เอาอันนี้ไว้ก่อน',[
    concept('consider_only','เอาอันนี้ไว้ก่อน',{confidence:0.7,evidenceCount:1}),
  ]);
  assert.ok(match);

  const one:SemanticContext={
    activeDomain:'activity',
    recentEntities:[
      {id:'activity_asset:horse-pharadon',type:'activity_asset',name:'ภาราดร',domain:'activity',canonical:true},
    ],
  };
  const resolved=semanticTurnFromLearnedConcept(match!,one,emptyTaskStateContainer());
  assert.ok(resolved);
  assert.equal(resolved!.action,'confirm');
  assert.equal(resolved!.speechAct,'selection');
  assert.equal(resolved!.references[0]?.resolvedEntityId,'activity_asset:horse-pharadon');
  assert.ok(resolved!.constraints.includes('no_transaction'));

  const ambiguous:SemanticContext={
    activeDomain:'activity',
    recentEntities:[
      {id:'activity_asset:horse-pharadon',type:'activity_asset',name:'ภาราดร',domain:'activity',canonical:true},
      {id:'activity_asset:horse-thongthai',type:'activity_asset',name:'ทองไทย',domain:'activity',canonical:true},
    ],
  };
  assert.equal(
    semanticTurnFromLearnedConcept(match!,ambiguous,emptyTaskStateContainer()),
    null,
    'ambiguous "this one" must fall through to the language supervisor',
  );
});

test('Phase 3: pace learned meaning is preference-only and non-transactional', () => {
  const match=matchLearnedConcept('ไม่อยากเหนื่อยมาก',[
    concept('pace_relaxed','ไม่อยากเหนื่อยมาก',{confidence:0.7,evidenceCount:1}),
  ]);
  assert.ok(match);
  const context:SemanticContext={activeDomain:'activity',recentEntities:[]};
  const turn=semanticTurnFromLearnedConcept(match!,context,emptyTaskStateContainer());
  assert.ok(turn);
  assert.equal(turn!.action,'provide_information');
  assert.equal(turn!.speechAct,'preference_update');
  assert.deepEqual(turn!.entities,{pace:'relaxed'});
  assert.equal(turn!.constraints.length,0);
});

test('Phase 3: learned consider-only semantics can never reinterpret a real commit phrase', () => {
  const row=concept('consider_only','ยังไม่จอง',{confidence:0.99,evidenceCount:10});
  assert.equal(matchLearnedConcept('จองเลย',[row]),null);
  assert.equal(matchLearnedConcept('ยืนยันจอง',[row]),null);
});

test('Phase 3: privacy gate rejects personal payload from new concept families before DB I/O', async () => {
  const beforeUrl=process.env.SUPABASE_URL;
  const beforeKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const beforeFetch=global.fetch;
  process.env.SUPABASE_URL='https://phase3-privacy.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY='test';
  let fetches=0;
  global.fetch=(async()=>{fetches+=1;return new Response('[]',{status:200});}) as typeof fetch;
  try{
    await recordSemanticConceptEvidence('pace_relaxed','ขอแบบชิลๆกับหนิง');
    await recordSemanticConceptEvidence('consider_only','เอาอันนี้ไว้ก่อนชื่อหนิง');
    assert.equal(fetches,0,'unsafe cross-customer exemplars must be rejected before any storage call');
  }finally{
    global.fetch=beforeFetch;
    if(beforeUrl===undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL=beforeUrl;
    if(beforeKey===undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY=beforeKey;
  }
});

test('Phase 3: migration only expands the existing concept-key constraint', () => {
  const sql=readFileSync(
    new URL('../supabase/migrations/20261001154119_semantic_concept_memory_expand_safe_concepts.sql',import.meta.url),
    'utf8',
  );
  assert.match(sql,/alter table public\.semantic_concept_memory/u);
  assert.match(sql,/pace_relaxed/u);
  assert.match(sql,/consider_only/u);
  const executable=sql
    .split('\n')
    .filter(line=>!line.trim().startsWith('--'))
    .join('\n');
  assert.doesNotMatch(executable,/create table|vector\(|pgvector|create extension/iu);
});
