import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
  SEMANTIC_INTERPRETER_VERSION,
} from '../netlify/functions/_semantic-interpreter';
import { SEMANTIC_EVAL_CORPUS } from './fixtures/semantic-eval-corpus';
import { PHASE_L_SEMANTIC_CASES } from './fixtures/phase-l-semantic-cases';

test('semantic-v9 version is explicit',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION,'semantic-v9');
});

test('semantic-v9 doctrine locks the remaining live semantic boundaries without sentence matching',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  const required=[
    'An explicit transaction request remains book/order even when a required item or slot is still missing',
    'A requested adjustment because the customer dislikes the current result is modify, not correct_previous',
    'Simultaneous capacity without a date/time/current-state predicate is policy, not live availability',
    'Physical-effort constraints alone do not make an open ecosystem recommendation an activity request',
    'A promotion asking whether the referenced offer is still active or valid now is status + availability',
    'A bare item-existence question with no current-state, stock, or time predicate is discover + catalog',
    'A request for one activity with sequencing merely as a constraint remains activity, not journey',
  ];
  for(const rule of required) assert.ok(prompt.includes(rule),rule);
});

test('semantic-v9 honestly adjudicates two ambiguous gold labels instead of forcing the old score',()=>{
  const cases=[...SEMANTIC_EVAL_CORPUS,...PHASE_L_SEMANTIC_CASES];

  const couple=cases.find(item=>item.id==='discover-07');
  assert.ok(couple);
  assert.equal(couple.expected.domain,'ecosystem');
  assert.equal(couple.expected.action,'recommend');
  assert.equal(couple.simulatedModelOutput?.informationNeed,'recommendation');

  const permission=cases.find(item=>item.id==='modify-01');
  assert.ok(permission);
  assert.equal(permission.expected.domain,'activity');
  assert.equal(permission.expected.action,'ask');
  assert.equal(permission.simulatedModelOutput?.informationNeed,'policy');
});
