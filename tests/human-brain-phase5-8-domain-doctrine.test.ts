import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
  parseSemanticTurnResponse,
  type SemanticContext,
} from '../netlify/functions/_semantic-interpreter';
import { PHASE_L_SEMANTIC_CASES } from './fixtures/phase-l-semantic-cases';
import { SEMANTIC_EVAL_CORPUS } from './fixtures/semantic-eval-corpus';

function byId(id:string){
  const item=[...SEMANTIC_EVAL_CORPUS,...PHASE_L_SEMANTIC_CASES].find(row=>row.id===id);
  assert.ok(item,`missing fixture ${id}`);
  return item;
}

test('Phase 5.8 RED: cross-cutting promotion questions stay in promotion even when they name restaurant/activity/stay',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.ok(prompt.includes('promotion is cross-cutting'));
  assert.ok(prompt.includes('keep domain "promotion"'));
});

test('Phase 5.8 RED: journey means itinerary/sequence composition, ecosystem means broad browse without plan composition',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.ok(prompt.includes('journey = itinerary/plan/trip composition'));
  assert.ok(prompt.includes('Use ecosystem for broad browse/discovery/recommendation without plan'));
});

test('Phase 5.8 RED: physical product stock uses inventory, not generic availability',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.ok(prompt.includes('Use inventory for current physical-product stock/quantity existence'));
  assert.ok(prompt.includes('Use availability when the customer asks whether a table/room/activity/time/resource'));
});

test('Phase 5.8 RED: membership signup and permission-to-change are not booking/modify overreads',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.ok(prompt.includes('Membership signup uses confirm'));
  assert.ok(prompt.includes('Permission/capability questions are ask + policy'));
});

test('Phase 5.8 RED: remaining Phase-L gold is human-grounded',()=>{
  const expected:Record<string,{domain?:string;action?:string;need?:string;contextDomain?:string}> = {
    'l-stay-06':{domain:'stay',action:'modify'},
    'l-member-04':{domain:'membership',action:'ask',need:'policy'},
    'l-otop-03':{domain:'otop',action:'status',need:'inventory'},
    'l-cafe-03':{domain:'cafe',action:'discover',need:'catalog'},
    'l-cafe-04':{domain:'cafe',action:'ask'},
    'l-journey-04':{domain:'activity',action:'recommend',need:'recommendation'},
    'l-journey-06':{domain:'journey',action:'modify'},
    'l-topic-activity-01':{domain:'activity',action:'discover',contextDomain:'stay'},
    'l-promo-09':{domain:'promotion',action:'ask',need:'policy'},
  };
  for(const [id,e] of Object.entries(expected)){
    const item=byId(id);
    if(e.domain) assert.equal(item.expected.domain,e.domain,`${id} domain`);
    if(e.action) assert.equal(item.expected.action,e.action,`${id} action`);
    if(e.need) assert.equal(item.simulatedModelOutput.informationNeed,e.need,`${id} informationNeed`);
    if(e.contextDomain) assert.equal(item.context?.activeDomain,e.contextDomain,`${id} context`);
  }
});

test('Phase 5.8 RED: explicit journey planning fixtures keep journey domain while broad low-effort recommendation stays ecosystem',()=>{
  for(const id of ['l-journey-01','l-journey-02','l-journey-03','l-journey-08','l-journey-09','l-journey-10']){
    assert.equal(byId(id).expected.domain,'journey',id);
  }
  assert.equal(byId('l-activity-09').expected.domain,'ecosystem');
});


test('Phase 5.8 RED2: a topic declaration without a real question asks for clarification instead of inventing catalog intent',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.ok(prompt.includes('topic declaration without an actual question'));
  const item=byId('l-cafe-04');
  assert.equal(item.expected.action,'ask');
  assert.equal(item.expected.needsClarification,true);
});

test('Phase 5.8 RED2: conversational continue/resume request is not confirmation',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.ok(prompt.includes('continue/resume a conversation or plan'));
  assert.ok(prompt.includes('not confirmation'));
  assert.equal(byId('l-journey-07').expected.action,'ask');
});

test('Phase 5.8 RED2: membership profile readback fixture contains profile context and remains a read-only ask',()=>{
  const item=byId('membership-02');
  assert.equal(item.expected.domain,'membership');
  assert.equal(item.expected.action,'ask');
  assert.equal(item.simulatedModelOutput?.informationNeed,undefined);
  assert.equal(item.context?.activeDomain,'membership');
  assert.ok(item.context?.recentEntities.some(entity=>entity.type==='membership_profile'));
});


test('Phase 5.8: bounded JSON syntax recovery accepts one wrapped object and harmless trailing comma',()=>{
  const wrapped='result follows: {"domain":"activity","intent":"ask_policy","action":"ask","informationNeed":"policy","entities":{},"references":[],"constraints":[],"confidence":0.9,"needsClarification":false,} end';
  const turn=parseSemanticTurnResponse(wrapped,emptySemanticContext());
  assert.equal(turn.domain,'activity');
  assert.equal(turn.action,'ask');
  assert.equal(turn.informationNeed,'policy');
});

test('Phase 5.8: unresolved selection with zero usable context cannot retain a hallucinated business domain',()=>{
  const turn=parseSemanticTurnResponse(JSON.stringify({
    domain:'ecosystem',
    intent:'select_that',
    action:'confirm',
    informationNeed:'none',
    entities:{},
    references:[{type:'previous_selection',value:'that',refersToPriorContext:true}],
    constraints:[],
    confidence:0.9,
    needsClarification:false,
  }),emptySemanticContext());
  assert.equal(turn.domain,'unknown');
  assert.equal(turn.needsClarification,true);
});

test('Phase 5.8: multi-candidate identity lookup is ask, not catalog discovery',()=>{
  const context:SemanticContext={
    activeDomain:'activity',
    recentEntities:[
      {id:'horse:a',type:'horse',name:'A',domain:'activity'},
      {id:'horse:b',type:'horse',name:'B',domain:'activity'},
    ],
  };
  const turn=parseSemanticTurnResponse(JSON.stringify({
    domain:'activity',
    intent:'which_horse',
    action:'discover',
    informationNeed:'catalog',
    entities:{},
    references:[{type:'entity_selection',refersToPriorContext:true}],
    constraints:[],
    confidence:0.9,
    needsClarification:false,
  }),context);
  assert.equal(turn.action,'ask');
  assert.equal(turn.needsClarification,false);
});

test('Phase 5.8: explicit prior selection plus supplied slots remains confirm while preserving slots',()=>{
  const context:SemanticContext={
    activeDomain:'restaurant',
    recentEntities:[{id:'set:1',type:'proposed_set',name:'ชุดหนึ่ง',domain:'restaurant'}],
  };
  const turn=parseSemanticTurnResponse(JSON.stringify({
    domain:'restaurant',
    intent:'select_set_with_time',
    action:'provide_information',
    informationNeed:'none',
    entities:{date:'พรุ่งนี้',time:'12:00'},
    references:[{type:'previous_selection',value:'ชุดหนึ่ง',refersToPriorContext:true}],
    constraints:[],
    confidence:0.9,
    needsClarification:false,
  }),context);
  assert.equal(turn.action,'confirm');
  assert.equal(turn.entities.date,'พรุ่งนี้');
  assert.equal(turn.entities.time,'12:00');
});

test('Phase 5.8: resume_suspended directive cannot be interpreted as confirmation',()=>{
  const context:SemanticContext={
    activeDomain:'restaurant',
    recentEntities:[],
    suspendedTask:{
      type:'activity_booking',
      domain:'activity',
      status:'collecting',
      knownSlots:{},
      missingFields:['date'],
      selectedEntities:[],
      constraints:[],
    },
  };
  const turn=parseSemanticTurnResponse(JSON.stringify({
    domain:'activity',
    intent:'resume_activity',
    action:'confirm',
    taskDirective:'resume_suspended',
    informationNeed:'none',
    entities:{},
    references:[],
    constraints:[],
    confidence:0.9,
    needsClarification:false,
  }),context);
  assert.equal(turn.action,'ask');
  assert.equal(turn.taskDirective,'resume_suspended');
});

test('Phase 5.8: live-v3 adjudications keep intentional changes as modify and vague support as ask+clarify',()=>{
  assert.equal(byId('correction-05').expected.action,'modify');
  assert.equal(byId('l-activity-05').expected.action,'modify');
  assert.equal(byId('l-stay-06').expected.action,'modify');
  assert.equal(byId('l-support-01').expected.action,'ask');
  assert.equal(byId('l-support-01').expected.needsClarification,true);
});
