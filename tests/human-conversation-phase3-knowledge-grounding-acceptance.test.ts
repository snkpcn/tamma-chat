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

const NOW=new Date('2026-09-26T19:00:00.000Z');

function request(overrides:Partial<KnowledgeRequest>={}):KnowledgeRequest {
  return {
    domain:'activity',
    intent:'phase3_acceptance',
    action:'ask',
    entities:{},
    constraints:[],
    needs:['price'],
    ...overrides,
  };
}
function fact(overrides:Partial<GroundedFact>={}):GroundedFact {
  return {
    key:'activity:horse:30min:price',
    value:500,
    domain:'activity',
    sourceId:'activity_catalog_live',
    sourceType:'activity_live',
    authoritative:true,
    fetchedAt:NOW.toISOString(),
    ...overrides,
  };
}
function result(data:GroundedFact[], overrides:Partial<Extract<SourceResult,{status:'ok'}>>={}):SourceResult {
  return {
    status:'ok',
    data,
    sourceId:'activity_catalog_live',
    sourceType:'activity_live',
    fetchedAt:NOW.toISOString(),
    ...overrides,
  };
}

test('Phase 3 acceptance: a non-authoritative adapter value can never become business truth', async () => {
  const bundle=await resolveKnowledge(request(), {
    activity:{ catalog:async () => result([fact({ authoritative:false, value:999 })]) },
  }, NOW);
  assert.deepEqual(getGroundedFactValue(bundle,'activity:horse:30min:price'),{status:'unverified'});
  assert.ok(bundle.missing.includes('price'));
  assert.ok(bundle.warnings.some(warning => warning.includes('non_authoritative')));
});

test('Phase 3 acceptance: a source-type mismatch cannot masquerade as a live source', async () => {
  const bundle=await resolveKnowledge(request(), {
    activity:{ catalog:async () => result(
      [fact({ sourceType:'bible', sourceId:'static_copy' })],
      { sourceType:'bible', sourceId:'static_copy' },
    ) },
  }, NOW);
  assert.equal(bundle.facts.length,0);
  assert.equal(bundle.sources[0]?.status,'unavailable');
  assert.ok(bundle.missing.includes('price'));
});

test('Phase 3 acceptance: wrong-domain facts are quarantined instead of leaking across businesses', async () => {
  const bundle=await resolveKnowledge(request(), {
    activity:{ catalog:async () => result([
      fact({ domain:'restaurant', key:'menu:ghost:price', value:65 }),
    ]) },
  }, NOW);
  assert.deepEqual(getGroundedFactValue(bundle,'menu:ghost:price'),{status:'unverified'});
  assert.ok(bundle.missing.includes('price'));
});

test('Phase 3 acceptance: stale live facts cannot answer current price or availability', async () => {
  const stale=fact({ value:450, stale:true });
  assert.equal(pickByPrecedence([stale]),null);

  const bundle=await resolveKnowledge(request(), {
    activity:{ catalog:async () => result([stale]) },
  }, NOW);
  assert.deepEqual(getGroundedFactValue(bundle,stale.key),{status:'unverified'});
  assert.ok(bundle.missing.includes('price'));
});

test('Phase 3 acceptance: current authoritative live truth outranks stale memory', () => {
  const memory=fact({
    value:450,
    sourceType:'conversation_memory',
    sourceId:'old_summary',
    authoritative:false,
    stale:true,
  });
  const live=fact({ value:500 });
  assert.equal(pickByPrecedence([memory,live])?.value,500);
  assert.equal(pickByPrecedence([live,memory])?.value,500);
});

test('Phase 3 acceptance: model-interpreted entity values never turn into facts without a source', async () => {
  const bundle=await resolveKnowledge(request({
    entities:{ activityCode:'horse', price:1, available:true },
    needs:['price','availability'],
  }), {}, NOW);
  assert.equal(bundle.facts.length,0);
  assert.deepEqual(getGroundedFactValue(bundle,'price'),{status:'unverified'});
  assert.ok(bundle.sources.every(source => source.status==='unavailable'));
  assert.ok(bundle.sources.every(source => source.reason==='no_source_registered'));
});

test('Phase 3 acceptance: unavailable is not rewritten as authoritative empty', async () => {
  const unavailable:SourceResult={
    status:'unavailable',
    sourceId:'activity_catalog_live',
    sourceType:'activity_live',
    fetchedAt:NOW.toISOString(),
    error:'timeout',
  };
  const bundle=await resolveKnowledge(request(), {
    activity:{ catalog:async () => unavailable },
  }, NOW);
  assert.equal(bundle.sources[0]?.status,'unavailable');
  assert.ok(bundle.missing.includes('price'));
  assert.equal(bundle.facts.length,0);
});
