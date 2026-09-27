import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSemanticTurnResponse,
  type SemanticContext,
} from '../netlify/functions/_semantic-interpreter';
import { deriveSemanticMeaning } from '../netlify/functions/_semantic-meaning';
import {
  deriveCanonicalKnowledgeScope,
  resolveCanonicalScopeAgainstFacts,
  filterFactsByCanonicalScope,
} from '../netlify/functions/_canonical-knowledge-scope';
import {
  reconcileActivitySemanticEntityNames,
} from '../netlify/functions/_thongthai-one-mind-orchestrator';
import type { GroundedFact, KnowledgeBundle } from '../netlify/functions/_knowledge-resolver';

const NOW='2026-09-28T00:00:00.000Z';
const fact=(key:string,value:unknown):GroundedFact=>({
  key,value,domain:'activity',sourceId:'activity-test',sourceType:'activity_live',
  authoritative:true,fetchedAt:NOW,
});

test('PR G cert: live activity entity aliases normalize into one canonical schema',()=>{
  const turn=parseSemanticTurnResponse(JSON.stringify({
    domain:'activity',intent:'compound_activity',action:'status',
    speechAct:'question',informationNeed:'availability',
    entities:{
      activityCode:'horse',
      excludedHorseName:'Thongthai',
      horseTemperament:'calm',
      primaryHorseName:'ภาราดร',
      fallbackHorseName:'ทองไทย',
    },
    references:[],constraints:['exclude_thongthai','prefer_calm_horse'],
    confidence:.98,needsClarification:false,
  }),{activeDomain:null,recentEntities:[]} as SemanticContext);
  assert.equal(turn.entities.excludedHorse,'Thongthai');
  assert.equal(turn.entities.preferredHorseTrait,'calm');
  assert.equal(turn.entities.primaryHorse,'ภาราดร');
  assert.equal(turn.entities.fallbackHorse,'ทองไทย');
});

test('PR G cert: semantic activity type resolves to a differently named live parent through asset relationships',()=>{
  const facts:GroundedFact[]=[
    fact('activity:horse_riding:name','ขี่ม้า'),
    fact('activity_asset:horse-paradorn:name','ภาราดร'),
    fact('activity_asset:horse-paradorn:type','horse'),
    fact('activity_asset:horse-paradorn:activityCode','horse_riding'),
    fact('activity_asset:horse-thongthai:name','ทองไทย'),
    fact('activity_asset:horse-thongthai:type','horse'),
    fact('activity_asset:horse-thongthai:activityCode','horse_riding'),
    fact('activity:archery:name','ยิงธนู'),
    fact('activity_asset:archery-1:name','ช่องยิงธนู 1'),
    fact('activity_asset:archery-1:type','archery'),
    fact('activity_asset:archery-1:activityCode','archery'),
  ];
  const meaning=deriveSemanticMeaning({
    domain:'activity',intent:'availability_with_preference',action:'status',
    informationNeed:'availability',entities:{activityCode:'horse'},
    references:[],constraints:['prefer_calm_horse'],confidence:.98,needsClarification:false,
  });
  const initial=deriveCanonicalKnowledgeScope(meaning);
  assert.deepEqual(initial.canonicalParentIds,['horse']);
  const resolved=resolveCanonicalScopeAgainstFacts(initial,facts);
  assert.deepEqual(resolved.canonicalParentIds,['horse_riding']);
  const filtered=filterFactsByCanonicalScope(facts,resolved);
  assert.ok(filtered.some(row=>row.key==='activity_asset:horse-paradorn:name'));
  assert.ok(filtered.some(row=>row.key==='activity_asset:horse-thongthai:name'));
  assert.ok(filtered.some(row=>row.key==='activity:horse_riding:name'));
  assert.ok(!filtered.some(row=>row.key.includes('archery')));
});

test('PR G cert: model transliteration reconciles to canonical live asset name without a hardcoded name map',()=>{
  const bundle:KnowledgeBundle={
    domain:'activity',
    sources:[{need:'catalog',sourceId:'activity-test',sourceType:'activity_live',status:'ok'}],
    facts:[
      fact('activity_asset:horse-bluefox:name','บลูฟ็อกซ์'),
      fact('activity_asset:horse-bluefox:type','horse'),
      fact('activity_asset:horse-bluefox:activityCode','horse_riding'),
    ],
    entities:[],missing:[],warnings:[],freshness:'live',
  };
  const turn={
    domain:'activity' as const,intent:'activity_selection',action:'status' as const,
    informationNeed:'availability' as const,
    entities:{excludedHorse:'BlueFox'},references:[],constraints:[],
    confidence:.95,needsClarification:false,
  };
  const reconciled=reconcileActivitySemanticEntityNames(turn,[bundle]);
  assert.equal(reconciled.entities.excludedHorse,'บลูฟ็อกซ์');
});

test('PR G cert: ambiguous asset-code aliases are never guessed',()=>{
  const bundle:KnowledgeBundle={
    domain:'activity',
    sources:[{need:'catalog',sourceId:'activity-test',sourceType:'activity_live',status:'ok'}],
    facts:[
      fact('activity_asset:horse-alpha:name','อัลฟา 1'),
      fact('activity_asset:pony-alpha:name','อัลฟา 2'),
    ],
    entities:[],missing:[],warnings:[],freshness:'live',
  };
  const turn={
    domain:'activity' as const,intent:'activity_selection',action:'status' as const,
    informationNeed:'availability' as const,
    entities:{excludedHorse:'alpha'},references:[],constraints:[],
    confidence:.95,needsClarification:false,
  };
  const reconciled=reconcileActivitySemanticEntityNames(turn,[bundle]);
  assert.equal(reconciled.entities.excludedHorse,'alpha');
});
