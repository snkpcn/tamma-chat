import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
  parseSemanticTurnResponse,
  SEMANTIC_INTERPRETER_VERSION,
} from '../netlify/functions/_semantic-interpreter';
import { SEMANTIC_EVAL_CORPUS } from './fixtures/semantic-eval-corpus';

function byId(id:string){
  const item=SEMANTIC_EVAL_CORPUS.find(row=>row.id===id);
  assert.ok(item,`missing fixture ${id}`);
  return item;
}

test('semantic-v28 preserves the three semantic-v24 live-failure gold meanings',()=>{
  assert.deepEqual(byId('discover-07').expected,{domain:'ecosystem',action:'discover'});
  assert.deepEqual(byId('otop-02').expected,{domain:'otop',action:'order'});
  assert.deepEqual(byId('restaurant-constraint-01').expected,{domain:'restaurant',action:'provide_information'});
});

test('semantic-v28 makes explicit transaction commitment outrank catalog browsing',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('Explicit transaction commitment outranks catalog browsing'));
  assert.ok(p.includes('Missing product or slot details are follow-up fields; they do not downgrade order or book intent to discover'));
});

test('semantic-v28 makes constraint-only continuation provide information',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('A CURRENT turn that only supplies constraints, preferences, quantities, party details, budget, or other requested facts without asking for a new action is provide_information'));
  assert.ok(p.includes('Do not turn constraint-only continuation into recommend merely because those facts could personalize a recommendation'));
});

test('semantic-v28 requires an evaluative request beyond companion metadata',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('Ignore companion or traveler metadata when deciding whether a broad request is discover or recommend'));
  assert.ok(p.includes('If the remaining request is neutral browsing, keep discover'));
});

test('semantic-v28 version is explicit',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION, 'semantic-v31');
});


test('resume_suspended cannot manufacture transaction consent from stale booking context',()=>{
  const context={
    ...emptySemanticContext(),
    activeDomain:'restaurant' as const,
    suspendedTask:{
      type:'activity_booking',
      domain:'activity' as const,
      status:'collecting',
      knownSlots:{horseName:'ภาราดร'},
      missingFields:['date','time','partySize'],
      selectedEntities:[],
      constraints:[],
    },
  };
  const modelOutput=JSON.stringify({
    normalizedMeaning:'กลับไปทำรายการจองม้าที่พักไว้',
    reply:'',
    speechAct:'transaction_request',
    domain:'activity',
    intent:'resume_booking',
    action:'book',
    informationNeed:'none',
    taskDirective:'resume_suspended',
    entities:{},
    references:[],
    constraints:[],
    confidence:0.98,
    needsClarification:false,
  });

  for(const message of ['กลับไปเรื่องม้าที่ค้างไว้','กลับมาจองม้าต่อก่อน']) {
    const turn=parseSemanticTurnResponse(modelOutput,context,message);
    assert.equal(turn.taskDirective,'resume_suspended');
    assert.notEqual(turn.action,'book');
    assert.notEqual(turn.speechAct,'transaction_request');
  }

  const committed=parseSemanticTurnResponse(modelOutput,context,'กลับไปเรื่องม้าที่ค้างไว้ แล้วจองเลย');
  assert.equal(committed.action,'book');
  assert.equal(committed.speechAct,'transaction_request');
});
