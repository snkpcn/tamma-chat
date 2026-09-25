import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
  type SemanticTurn,
} from '../netlify/functions/_semantic-interpreter';
import { runSemanticCertification } from '../netlify/functions/_semantic-live-certification';
import { SEMANTIC_EVAL_CORPUS } from './fixtures/semantic-eval-corpus';
import { resumableCertificationState } from '../scripts/_semantic-certification-resume';

function caseById(id:string){
  const item=SEMANTIC_EVAL_CORPUS.find(candidate=>candidate.id===id);
  assert.ok(item,`missing corpus case ${id}`);
  return item;
}

test('Phase 5.5 semantic doctrine distinguishes ecosystem breadth, catalog lookup, recommendation, and contextless ambiguity',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());

  assert.match(prompt,/broad cross-ecosystem/i);
  assert.match(prompt,/do not narrow.*activity/i);
  assert.match(prompt,/catalog.*recommend/i);
  assert.match(prompt,/no relevant context.*unknown/i);
});

test('Phase 5.5 adjudicates legacy gold by meaning rather than preserving stale labels',()=>{
  const restaurant1=caseById('restaurant-01');
  const restaurant2=caseById('restaurant-02');
  const stay2=caseById('stay-02');

  assert.equal(restaurant1.expected.domain,'restaurant');
  assert.equal(restaurant1.expected.action,'discover');
  assert.equal(restaurant1.simulatedModelOutput.informationNeed,'catalog');

  assert.equal(restaurant2.expected.domain,'restaurant');
  assert.equal(restaurant2.expected.action,'discover');
  assert.equal(restaurant2.simulatedModelOutput.informationNeed,'catalog');

  assert.equal(stay2.expected.domain,'unknown');
  assert.equal(stay2.expected.action,'status');
  assert.equal(stay2.expected.needsClarification,true);
  assert.equal(stay2.simulatedModelOutput.informationNeed,'availability');
});

test('Phase 5.5 certification can pace calls instead of bursting the free provider quota',async()=>{
  const starts:number[]=[];
  const turn:SemanticTurn={
    domain:'ecosystem',
    intent:'broad_experience_discovery',
    action:'discover',
    informationNeed:'none',
    entities:{},
    references:[],
    constraints:[],
    confidence:0.95,
    needsClarification:false,
  };

  const result=await runSemanticCertification({
    profile:'full',
    start:0,
    limit:3,
    interCaseDelayMs:25,
    interpret:async()=>{
      starts.push(Date.now());
      return turn;
    },
  });

  assert.equal(result.providerFailed,0);
  assert.equal(starts.length,3);
  assert.ok(starts[1]! - starts[0]! >= 20,`first spacing was ${starts[1]! - starts[0]!}ms`);
  assert.ok(starts[2]! - starts[1]! >= 20,`second spacing was ${starts[2]! - starts[1]!}ms`);
});

test('Phase 5.5 resumes only contiguous semantic coverage and drops the provider-failed boundary case',()=>{
  const carried=resumableCertificationState({
    kind:'LIVE_MODEL_SEMANTIC_CERTIFICATION',
    status:'incomplete_provider',
    contractHash:'abc123',
    totalCorpusCases:158,
    evaluated:17,
    semanticEvaluated:16,
    pass:15,
    semanticFailed:1,
    providerFailed:1,
    failures:[
      {id:'discover-01',category:'formal',expected:{domain:'ecosystem',action:'discover',needsClarification:null,informationNeed:null},actual:{domain:'activity',action:'discover',needsClarification:false,informationNeed:'catalog',confidence:1}},
      {id:'promotion-01',category:'colloquial',expected:{domain:'promotion',action:'discover',needsClarification:null,informationNeed:null},actual:{domain:'error',action:'error',needsClarification:true,informationNeed:'none',confidence:0},providerError:{name:'LLMAvailabilityError',attempts:[]}},
    ],
  },'abc123');

  assert.ok(carried);
  assert.equal(carried.start,16);
  assert.equal(carried.pass,15);
  assert.equal(carried.semanticFailed,1);
  assert.equal(carried.failures.length,1);
  assert.equal(carried.failures[0]?.id,'discover-01');
});

test('Phase 5.5 production cert runner carries a contract hash and uses a bounded inter-case pace',()=>{
  const script=readFileSync(new URL('../scripts/write-semantic-certification-artifact.ts',import.meta.url),'utf8');
  assert.match(script,/contractHash/);
  assert.match(script,/resumableCertificationState/);
  assert.match(script,/interCaseDelayMs/);
});
