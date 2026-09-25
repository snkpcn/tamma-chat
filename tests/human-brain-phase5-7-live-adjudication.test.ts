import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
  parseSemanticTurnResponse,
  type SemanticContext,
  type SemanticTurn,
} from '../netlify/functions/_semantic-interpreter';
import { runSemanticCertification } from '../netlify/functions/_semantic-live-certification';
import { SEMANTIC_EVAL_CORPUS } from './fixtures/semantic-eval-corpus';
import { PHASE_L_SEMANTIC_CASES } from './fixtures/phase-l-semantic-cases';

function baseTurn(): SemanticTurn {
  return {
    domain:'ecosystem',
    intent:'broad_experience_discovery',
    action:'discover',
    informationNeed:'none',
    entities:{},
    references:[],
    constraints:[],
    confidence:1,
    needsClarification:false,
  };
}

function byId(id:string) {
  const item=[...SEMANTIC_EVAL_CORPUS,...PHASE_L_SEMANTIC_CASES].find(row=>row.id===id);
  assert.ok(item,`missing fixture ${id}`);
  return item;
}

test('Human Brain 5.7: malformed model JSON is semantic failure, not provider outage, and corpus continues', async () => {
  let calls=0;
  const result=await runSemanticCertification({
    start:0,
    limit:2,
    availabilityRetries:0,
    interpret:async () => {
      calls += 1;
      if (calls===1) throw new SyntaxError('bad model JSON');
      return baseTurn();
    },
  });

  assert.equal(calls,2);
  assert.equal(result.evaluated,2);
  assert.equal(result.semanticEvaluated,2);
  assert.equal(result.semanticFailed,1);
  assert.equal(result.providerFailed,0);
  assert.equal(result.availabilityComplete,true);
  assert.equal(result.failures[0]?.modelOutputError?.name,'SyntaxError');
  assert.equal(result.failures[0]?.providerError,undefined);
});

test('Human Brain 5.7: unknown internal exceptions are not mislabeled as provider outage', async () => {
  await assert.rejects(
    () => runSemanticCertification({
      start:0,
      limit:1,
      interpret:async () => { throw new Error('internal invariant'); },
    }),
    /internal invariant/,
  );
});

test('Human Brain 5.7: multi-candidate singular selection is deterministically clarified; compare may use the set', () => {
  const context:SemanticContext={
    activeDomain:'activity',
    recentEntities:[
      {id:'horse:a',type:'horse',name:'ทองไทย',domain:'activity'},
      {id:'horse:b',type:'horse',name:'ภาราดร',domain:'activity'},
    ],
  };

  const selection=parseSemanticTurnResponse(JSON.stringify({
    domain:'activity',intent:'select_horse',action:'confirm',informationNeed:'none',
    entities:{},references:[{type:'previous_selection',refersToPriorContext:true}],
    constraints:[],confidence:0.95,needsClarification:false,
  }),context);
  assert.equal(selection.needsClarification,true);
  assert.equal(selection.clarificationReason,'ambiguous_reference');

  const comparison=parseSemanticTurnResponse(JSON.stringify({
    domain:'activity',intent:'compare_horses',action:'compare',informationNeed:'none',
    entities:{},references:[{type:'entity_selection',refersToPriorContext:true}],
    constraints:[],confidence:0.95,needsClarification:false,
  }),context);
  assert.equal(comparison.needsClarification,false);
  assert.equal(comparison.references[0]?.resolvedEntityIds?.length,2);
});

test('Human Brain 5.7: live-failure gold adjudication follows one coherent semantic taxonomy', () => {
  const expectations:Record<string,[string,string,string|null]> = {
    'activity-atv-01':['activity','status','availability'],
    'membership-02':['membership','discover','catalog'],
    'cafe-02':['cafe','discover','catalog'],
    'payment-01':['payment','ask',null],
    'journey-02':['journey','ask',null],
    'restaurant-constraint-01':['restaurant','provide_information',null],
    'correction-02':['restaurant','modify',null],
    'activity-book-03':['activity','status','availability'],
    'restaurant-preorder-followup-01':['restaurant','confirm',null],
    'stay-availability-01':['stay','status','availability'],
    'stay-availability-02':['stay','recommend','recommendation'],
    'l-activity-03':['activity','ask','policy'],
    'l-activity-09':['ecosystem','recommend','recommendation'],
    'l-restaurant-01':['restaurant','status','availability'],
    'l-restaurant-02':['restaurant','recommend','recommendation'],
    'l-restaurant-04':['restaurant','recommend','ingredients'],
    'l-restaurant-06':['restaurant','modify',null],
    'l-restaurant-10':['restaurant','discover','catalog'],
    'l-stay-03':['stay','discover','catalog'],
    'l-stay-04':['stay','recommend','recommendation'],
  };

  for (const [id,[domain,action,informationNeed]] of Object.entries(expectations)) {
    const item=byId(id);
    assert.equal(item.expected.domain,domain,`${id} domain`);
    assert.equal(item.expected.action,action,`${id} action`);
    const actualNeed=typeof item.simulatedModelOutput.informationNeed==='string'
      ? item.simulatedModelOutput.informationNeed
      : null;
    assert.equal(actualNeed,informationNeed,`${id} informationNeed`);
  }
});

test('Human Brain 5.7: reference/resume fixtures no longer ask the model to guess impossible context', () => {
  const which=byId('reference-02');
  assert.equal(which.expected.needsClarification,true);

  const journey=byId('journey-01');
  assert.equal(journey.context?.activeDomain,'journey');
  assert.ok(journey.context?.recentEntities.some(entity=>entity.id==='journey:current'));

  const resume=byId('topic-switch-04');
  assert.equal(resume.context?.suspendedTask?.domain,'activity');
  assert.equal(resume.simulatedModelOutput.taskDirective,'resume_suspended');

  for (const id of ['ambiguous-vague-horse-01','ambiguous-vague-room-01']) {
    assert.equal(byId(id).expected.needsClarification,true);
  }
});

test('Human Brain 5.7: semantic-v3 prompt encodes general failure patterns, not sentence-specific patches', () => {
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.match(prompt,/question\/deictic interrogative[\s\S]*NEVER a confirmation/i);
  assert.match(prompt,/multiple equally plausible entities[\s\S]*needsClarification=true/i);
  assert.match(prompt,/question meaning outranks slot-shaped wording/i);
  assert.match(prompt,/problem ABOUT an order[\s\S]*not automatically transaction_status/i);
  assert.match(prompt,/Use catalog[\s\S]{0,180}stable category\/type\/item exists/i);
  assert.match(prompt,/operating rules\/capacity constraints[\s\S]*policy/i);
  assert.match(prompt,/journey = planning-state work[\s\S]*saving[\s\S]*viewing/i);
  assert.match(prompt,/resume_suspended/i);
});
