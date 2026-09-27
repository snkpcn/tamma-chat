// FROZEN PHASE 3 HOLDOUT.
// Created after Phase 3 implementation was green at
// 7bf382b23f3e9059e0512440848f102d28d90894.
// Do not tune production code against these individual cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getGroundedFactValue,
  pickByPrecedence,
  resolveKnowledge,
  type GroundedFact,
  type KnowledgeRequest,
  type SourceResult,
} from '../netlify/functions/_knowledge-resolver';

const NOW=new Date('2026-09-26T20:00:00.000Z');
function f(overrides:Partial<GroundedFact>):GroundedFact {
  return {
    key:'holdout:key',
    value:'x',
    domain:'activity',
    sourceId:'activity_live',
    sourceType:'activity_live',
    authoritative:true,
    fetchedAt:NOW.toISOString(),
    ...overrides,
  };
}
function req(needs:KnowledgeRequest['needs']):KnowledgeRequest {
  return {domain:'activity',intent:'frozen_holdout',action:'ask',entities:{},constraints:[],needs};
}

test('Phase 3 frozen holdout: a plausible static price cannot impersonate live activity truth', async () => {
  const forged=f({key:'activity:horse:price',value:399,sourceType:'bible',sourceId:'marketing_copy'});
  const source:SourceResult={status:'ok',data:[forged],sourceId:'marketing_copy',sourceType:'bible',fetchedAt:NOW.toISOString()};
  const bundle=await resolveKnowledge(req(['price']),{activity:{catalog:async()=>source}},NOW);
  assert.equal(bundle.facts.length,0);
  assert.ok(bundle.missing.includes('price'));
  assert.deepEqual(getGroundedFactValue(bundle,'activity:horse:price'),{status:'unverified'});
});

test('Phase 3 frozen holdout: live organization fact wins regardless of stale-memory order', () => {
  const old=f({key:'membership:status',value:'active',sourceType:'conversation_memory',sourceId:'old_turn',authoritative:false,stale:true});
  const current=f({key:'membership:status',value:'paused',domain:'membership',sourceType:'membership_operational',sourceId:'memberships'});
  assert.equal(pickByPrecedence([old,current])?.value,'paused');
  assert.equal(pickByPrecedence([current,old])?.value,'paused');
});

test('Phase 3 frozen holdout: explicit authoritative zero is known, not guessed absent', async () => {
  const zero=f({key:'activity:atv:assetCount',value:0});
  const source:SourceResult={status:'ok',data:[zero],sourceId:'activity_live',sourceType:'activity_live',fetchedAt:NOW.toISOString()};
  const bundle=await resolveKnowledge(req(['inventory']),{activity:{catalog:async()=>source}},NOW);
  const resolved=getGroundedFactValue(bundle,zero.key);
  assert.equal(resolved.status,'known');
  assert.equal(resolved.status==='known'&&resolved.value,0);
  assert.equal(bundle.sources[0]?.status,'ok');
});

test('Phase 3 frozen holdout: failed live source remains unavailable and never becomes none', async () => {
  const source:SourceResult={status:'unavailable',sourceId:'activity_live',sourceType:'activity_live',fetchedAt:NOW.toISOString(),error:'timeout'};
  const bundle=await resolveKnowledge(req(['availability']),{activity:{availability:async()=>source}},NOW);
  assert.equal(bundle.sources[0]?.status,'unavailable');
  assert.equal(bundle.sources[0]?.reason,'source_unavailable');
  assert.ok(bundle.missing.includes('availability'));
  assert.equal(bundle.facts.length,0);
});
