import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
  SEMANTIC_INTERPRETER_VERSION,
} from '../netlify/functions/_semantic-interpreter';
import { SEMANTIC_EVAL_CORPUS } from './fixtures/semantic-eval-corpus';
import { PHASE_L_SEMANTIC_CASES } from './fixtures/phase-l-semantic-cases';

test('semantic-v17 version is explicit',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION,'semantic-v17');
});

test('semantic-v17 doctrine separates the boundary pairs exposed by full semantic-v8 live certification',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  const required=[
    'A bare request to see what exists remains discover even when it includes traveler context',
    'Explicit transaction commitment keeps book/order ownership even when required item or slot details are still missing',
    'A request phrased as asking whether a change is allowed is ask + policy',
    'Dissatisfaction with a current choice followed by a requested replacement is modify',
    'Simultaneous capacity is a policy question, not live availability',
    'Generic low-effort or relaxed experience requests stay ecosystem unless a specific business category is named',
    'A selected promotion asking whether it is still active or usable is status + availability',
    'Bare catalog existence wording does not mean current stock',
    'one requested experience plus a timing anchor does not become a journey',
  ];
  for(const rule of required) assert.ok(prompt.includes(rule),rule);
});

test('semantic-v17 honestly adjudicates one contradictory modify gold and preserves the other live-v8 golds',()=>{
  const cases=[...SEMANTIC_EVAL_CORPUS,...PHASE_L_SEMANTIC_CASES];
  const byId=(id:string)=>{
    const item=cases.find(candidate=>candidate.id===id);
    assert.ok(item,`missing ${id}`);
    return item;
  };

  const permission=byId('modify-01');
  assert.equal(permission.message,'ขอเปลี่ยนเวลาจองม้าได้ไหม');
  assert.equal(permission.expected.domain,'activity');
  assert.equal(permission.expected.action,'ask');
  assert.equal(permission.simulatedModelOutput?.informationNeed,'policy');

  const unchanged:Record<string,{domain:string;action:string;informationNeed?:string}>={
    'discover-07':{domain:'ecosystem',action:'discover'},
    'otop-02':{domain:'otop',action:'order'},
    'correction-02':{domain:'restaurant',action:'modify'},
    'l-activity-03':{domain:'activity',action:'ask',informationNeed:'policy'},
    'l-activity-09':{domain:'ecosystem',action:'recommend',informationNeed:'recommendation'},
    'l-promo-04':{domain:'promotion',action:'status',informationNeed:'availability'},
    'l-cafe-03':{domain:'cafe',action:'discover',informationNeed:'catalog'},
    'l-journey-04':{domain:'activity',action:'recommend',informationNeed:'recommendation'},
  };
  for(const [id,gold] of Object.entries(unchanged)){
    const item=byId(id);
    assert.equal(item.expected.domain,gold.domain,`${id} domain`);
    assert.equal(item.expected.action,gold.action,`${id} action`);
    if(gold.informationNeed!==undefined){
      assert.equal(item.simulatedModelOutput?.informationNeed,gold.informationNeed,`${id} informationNeed`);
    }
  }
});
