import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticInterpreterPrompt,
  buildProductionSemanticInterpreterPrompt,
  emptySemanticContext,
  SEMANTIC_INTERPRETER_VERSION,
} from '../netlify/functions/_semantic-interpreter';

test('semantic-v28 locks short topic follow-up vs invented availability',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.equal(SEMANTIC_INTERPRETER_VERSION, 'semantic-v31');
  assert.ok(prompt.includes('bare topic/resource follow-up does NOT imply current'));
  assert.ok(prompt.includes('do not invent status + availability'));
});

test('semantic-v28 locks exact named selection among multiple recent candidates',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.ok(prompt.includes('explicitly NAMES one exact recent entity'));
  assert.ok(prompt.includes('that is confirm'));
  assert.ok(prompt.includes('reference value'));
});

test('semantic-v28 distinguishes candidate-slot question from slot supply',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.ok(prompt.includes('candidate slot value phrased as a QUESTION'));
  assert.ok(prompt.includes('status + availability'));
  assert.ok(prompt.includes('It is NOT provide_information'));
});

test('semantic-v28 explicit attribute comparison outranks recommendation',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.ok(prompt.includes('Explicit attribute comparison outranks recommendation'));
  assert.ok(prompt.includes('use compare'));
  assert.ok(prompt.includes('Use recommend when they ask what they SHOULD choose'));
});


test('semantic-v31 production prompt gives bounded per-entity evidence for descriptive reference resolution',()=>{
  const context={
    activeDomain:'activity' as const,
    recentEntities:[
      {id:'horse-a',type:'horse',name:'ทองไทย',domain:'activity' as const,source:'conversation' as const,canonical:false},
      {id:'horse-b',type:'horse',name:'ภาราดร',domain:'activity' as const,source:'conversation' as const,canonical:false},
    ],
    recentTurns:[{role:'assistant' as const,content:'ทองไทยเป็นม้าสีทอง ส่วนภาราดรเป็นม้าสีน้ำตาลขาว'}],
  };
  const prompt=buildProductionSemanticInterpreterPrompt(context,'ตัวน้ำตาลขาวนั่นแหละ เอาตัวนั้น');
  assert.match(prompt,/recentEntityEvidence/u);
  assert.match(prompt,/ทองไทยเป็นม้าสีทอง/u);
  assert.match(prompt,/ภาราดรเป็นม้าสีน้ำตาลขาว/u);
  assert.match(prompt,/references MUST use that entity's exact name as reference\.value/u);
  assert.match(prompt,/returning all candidate IDs is NOT a resolved selection/u);
});
