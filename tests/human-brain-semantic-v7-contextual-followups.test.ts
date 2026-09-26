import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
  parseSemanticTurnResponse,
  SEMANTIC_INTERPRETER_VERSION,
  type SemanticContext,
} from '../netlify/functions/_semantic-interpreter';

test('semantic-v13 version is explicit',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION,'semantic-v13');
});

test('semantic-v13 doctrine keeps bare topic narrowing as catalog, candidate-time questions as availability, and direct comparisons as compare',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.ok(prompt.includes('NO date/time/current-state/stock predicate'));
  assert.ok(prompt.includes('discover + catalog'));
  assert.ok(prompt.includes('OFFER a candidate value while asking whether it works/is okay/available'));
  assert.ok(prompt.includes('status question with informationNeed=availability'));
  assert.ok(prompt.includes('Comparative attribute questions'));
  assert.ok(prompt.includes('stay compare'));
});

test('explicit structured entity name disambiguates one selection among multiple recent entities',()=>{
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
    intent:'select_horse',
    action:'confirm',
    informationNeed:'none',
    entities:{horseName:'ภาราดร'},
    references:[{type:'entity_selection',refersToPriorContext:true}],
    constraints:[],
    confidence:0.95,
    needsClarification:true,
  }),context);
  assert.equal(turn.action,'confirm');
  assert.equal(turn.references[0]?.resolvedEntityId,'horse:paradon');
  assert.notEqual(turn.references[0]?.ambiguous,true);
});

test('generic multi-candidate selection without a named match still asks and clarifies',()=>{
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
    intent:'which_horse',
    action:'confirm',
    informationNeed:'none',
    entities:{},
    references:[{type:'entity_selection',refersToPriorContext:true}],
    constraints:[],
    confidence:0.95,
    needsClarification:false,
  }),context);
  assert.equal(turn.action,'ask');
  assert.equal(turn.needsClarification,true);
});
