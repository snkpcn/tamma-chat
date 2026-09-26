import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
  SEMANTIC_INTERPRETER_VERSION,
} from '../netlify/functions/_semantic-interpreter';
import { SEMANTIC_EVAL_CORPUS } from './fixtures/semantic-eval-corpus';

function byId(id:string){
  const item=SEMANTIC_EVAL_CORPUS.find(row=>row.id===id);
  assert.ok(item,`missing fixture ${id}`);
  return item;
}

test('semantic-v28 version is explicit',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION, 'semantic-v30');
});

test('semantic-v28 preserves the four v19 chunk-1 gold meanings',()=>{
  const expected:Record<string,{domain:string;action:string;informationNeed:string}>={
    'discover-05':{domain:'ecosystem',action:'recommend',informationNeed:'recommendation'},
    'discover-06':{domain:'ecosystem',action:'recommend',informationNeed:'recommendation'},
    'stay-01':{domain:'stay',action:'status',informationNeed:'availability'},
    'membership-02':{domain:'membership',action:'ask',informationNeed:'none'},
  };
  for(const [id,gold] of Object.entries(expected)){
    const item=byId(id);
    assert.equal(item.expected.domain,gold.domain,`${id} domain`);
    assert.equal(item.expected.action,gold.action,`${id} action`);
    assert.equal(item.simulatedModelOutput?.informationNeed,gold.informationNeed,`${id} informationNeed`);
  }
});

test('semantic-v28 decision ladder blocks discover/catalog as a generic default',()=>{
  const p=buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g,' ');
  assert.ok(p.includes('Do not default to discover + catalog merely because a request is short, asks what is available, or asks to view information'));
  assert.ok(p.includes('FIRST classify evaluative choice requests as recommend'));
  assert.ok(p.includes('SECOND classify bare existence of a reservable resource as status + availability'));
  assert.ok(p.includes('THIRD classify readback of one existing personal profile, saved artifact, or existing record as ask + none'));
  assert.ok(p.includes('ONLY AFTER those checks may a true browse-what-exists request become discover + catalog'));
});
