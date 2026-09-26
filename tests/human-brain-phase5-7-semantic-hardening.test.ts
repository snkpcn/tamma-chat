import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
  parseSemanticTurnResponse,
  type SemanticContext,
} from '../netlify/functions/_semantic-interpreter';
import {
  computeInterCaseWaitMs,
  runSemanticCertification,
} from '../netlify/functions/_semantic-live-certification';
import { SEMANTIC_EVAL_CORPUS } from './fixtures/semantic-eval-corpus';
import { PHASE_L_SEMANTIC_CASES } from './fixtures/phase-l-semantic-cases';

function byId(id:string){
  const item=[...SEMANTIC_EVAL_CORPUS,...PHASE_L_SEMANTIC_CASES].find(row=>row.id===id);
  assert.ok(item,`missing fixture ${id}`);
  return item;
}

test('Phase 5.7: quota pacing subtracts provider call time instead of doubling it',()=>{
  assert.equal(computeInterCaseWaitMs(4250,0),4250);
  assert.equal(computeInterCaseWaitMs(4250,2000),2250);
  assert.equal(computeInterCaseWaitMs(4250,4250),0);
  assert.equal(computeInterCaseWaitMs(4250,6000),0);
});

test('Phase 5.7 RED: malformed model JSON is a semantic/model-output failure, not provider unavailability',async()=>{
  const result=await runSemanticCertification({
    start:0,
    limit:1,
    availabilityRetries:0,
    interpret:async()=>{ throw new SyntaxError('bad json'); },
  });
  assert.equal(result.providerFailed,0);
  assert.equal(result.semanticFailed,1);
  assert.equal(result.semanticEvaluated,1);
  assert.equal(result.failures[0]?.semanticError?.name,'SyntaxError');
  assert.equal(result.failures[0]?.providerError,undefined);
});

test('Phase 5.7 RED: ambiguous prior-context selection is mechanically marked ambiguous and requires clarification',()=>{
  const context:SemanticContext={
    activeDomain:'activity',
    recentEntities:[
      {id:'horse:thongthai',type:'horse',name:'ทองไทย',domain:'activity'},
      {id:'horse:paradon',type:'horse',name:'ภาราดร',domain:'activity'},
    ],
    lastAction:'discover',
  };
  const turn=parseSemanticTurnResponse(JSON.stringify({
    domain:'activity',
    intent:'select_horse_vague',
    action:'confirm',
    informationNeed:'none',
    entities:{},
    references:[{type:'previous_selection',refersToPriorContext:true}],
    constraints:[],
    confidence:0.95,
    needsClarification:false,
  }),context);
  assert.equal(turn.references[0]?.resolvedEntityIds?.length,2);
  assert.equal(turn.needsClarification,true);
});

test('Phase 5.7 RED: a closed read-only informationNeed outranks provide_information label drift',()=>{
  const turn=parseSemanticTurnResponse(JSON.stringify({
    domain:'activity',
    intent:'check_specific_time_availability',
    action:'provide_information',
    informationNeed:'availability',
    entities:{time:'15:00'},
    references:[],
    constraints:[],
    confidence:0.95,
    needsClarification:false,
  }),emptySemanticContext());
  assert.equal(turn.action,'status');
});

test('Phase 5.7 RED: semantic doctrine distinguishes capacity policy, catalog existence, support vagueness, and journey save',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.match(prompt,/Capacity\/policy and live availability are different meanings/i);
  assert.match(prompt,/Catalog existence and live availability are different meanings/i);
  assert.match(prompt,/vague help request with no business object or domain belongs to support/i);
  assert.match(prompt,/Saving\/storing the current journey or plan is journey state management/i);
  assert.match(prompt,/NOT a booking/i);
});

test('Phase 5.7 RED: semantic doctrine distinguishes profile/status from benefits catalog and correction from intentional modify',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.match(prompt,/Membership profile\/record\/status and membership benefits\/catalog are different meanings/i);
  assert.match(prompt,/correct_previous means the customer says an earlier value\/selection was mistaken or wrong/i);
  assert.match(prompt,/modify means an intentional/i);
});

test('Phase 5.7 RED: corpus gold matches the human semantic-v3 distinctions',()=>{
  const expectations:Record<string,{domain?:string;action?:string;need?:string;contextDomain?:string}> = {
    'reference-01':{domain:'activity',action:'discover',need:'catalog'},
    'activity-atv-01':{domain:'activity',action:'status',need:'availability'},
    'cafe-02':{domain:'cafe',action:'discover',need:'catalog'},
    'payment-01':{domain:'payment',action:'ask'},
    'journey-02':{domain:'journey',action:'ask'},
    'support-02':{domain:'support',action:'ask'},
    'restaurant-constraint-01':{domain:'restaurant',action:'provide_information',contextDomain:'restaurant'},
    'correction-02':{domain:'restaurant',action:'modify'},
    'activity-book-03':{domain:'activity',action:'status',need:'availability'},
    'restaurant-preorder-followup-01':{domain:'restaurant',action:'confirm'},
    'stay-availability-01':{domain:'stay',action:'status',need:'availability'},
    'stay-availability-02':{domain:'stay',action:'recommend',need:'recommendation'},
    'l-activity-09':{domain:'ecosystem',action:'recommend',need:'recommendation'},
    'l-restaurant-01':{domain:'restaurant',action:'status',need:'availability'},
    'l-restaurant-02':{domain:'restaurant',action:'recommend',contextDomain:'restaurant'},
    'l-restaurant-04':{domain:'restaurant',action:'recommend',need:'ingredients'},
    'l-restaurant-06':{domain:'restaurant',action:'modify'},
    'l-restaurant-10':{domain:'restaurant',action:'discover',need:'catalog'},
    'l-stay-03':{domain:'stay',action:'discover',need:'catalog'},
  };
  for(const [id,expected] of Object.entries(expectations)){
    const item=byId(id);
    if(expected.domain) assert.equal(item.expected.domain,expected.domain,`${id} domain`);
    if(expected.action) assert.equal(item.expected.action,expected.action,`${id} action`);
    if(expected.need) assert.equal(item.simulatedModelOutput.informationNeed,expected.need,`${id} informationNeed`);
    if(expected.contextDomain) assert.equal(item.context?.activeDomain,expected.contextDomain,`${id} context`);
  }
});

test('Phase 5.7 RED: resume-horse fixture contains real suspended task evidence rather than asking model to hallucinate it',()=>{
  const item=byId('topic-switch-04');
  assert.equal(item.context?.activeDomain,'restaurant');
  assert.equal(item.context?.suspendedTask?.domain,'activity');
  assert.equal(item.context?.suspendedTask?.type,'activity_booking');
});
