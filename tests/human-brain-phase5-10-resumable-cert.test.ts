import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseSemanticTurnResponse,
  type SemanticContext,
  SEMANTIC_INTERPRETER_VERSION,
} from '../netlify/functions/_semantic-interpreter';

test('Phase 5.10: ambiguous multi-candidate confirmation is normalized to ask',()=>{
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
    needsClarification:true,
  }),context);
  assert.equal(turn.action,'ask');
  assert.equal(turn.references[0]?.resolvedEntityIds?.length,2);
});

test('Phase 5.10: semantic version advances for final live re-certification',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION,'semantic-v13');
});

test('Phase 5.10: certification runner resumes only same-version incomplete provider artifacts',()=>{
  const script=readFileSync(new URL('../scripts/write-semantic-certification-artifact.ts',import.meta.url),'utf8');
  assert.match(script,/PRODUCTION_CERT_URL='https:\/\/tamma-chat\.netlify\.app\/semantic-certification-result\.json'/);
  assert.match(script,/artifact\.semanticVersion!==SEMANTIC_INTERPRETER_VERSION/);
  assert.match(script,/\['incomplete_provider','incomplete_chunk'\]\.includes/);
  assert.match(script,/artifact\.availabilityComplete===true/);
  assert.match(script,/resumeStart/);
  assert.match(script,/failure=>!failure\.providerError/);
});

test('Phase 5.10: provider-failed case is excluded from durable resume prefix',()=>{
  const script=readFileSync(new URL('../scripts/write-semantic-certification-artifact.ts',import.meta.url),'utf8');
  assert.match(script,/resumeStart=initialStart\+newSemanticEvaluated/);
  assert.match(script,/semanticEvaluated===totalCorpusCases/);
  assert.match(script,/evaluated=semanticEvaluated\+providerFailed/);
});
