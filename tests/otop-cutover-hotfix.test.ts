import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveSemanticMeaning } from '../netlify/functions/_semantic-meaning';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';
import { emptyTaskStateContainer, type ActiveTask } from '../netlify/functions/_task-state';
import { computeTaskMissingFields } from '../netlify/functions/_domain-task-policy';
import { resolveOtopStructuredSlots } from '../netlify/functions/_dialog-manager';
import { resolveSupervisedOtopCutover } from '../netlify/functions/thongthai-chat';

function semantic(overrides:Partial<SemanticTurn>={}):SemanticTurn {
  return {
    semanticSource:'openai_supervisor',domain:'otop',intent:'place_order',action:'order',
    speechAct:'transaction_request',informationNeed:'none',
    entities:{sku:'OTOP-NB-003',quantity:1,customerName:'ทดสอบ E2E',phone:'0800000005',fulfillmentType:'pickup'},
    references:[],constraints:[],confidence:.97,needsClarification:false,...overrides,
  };
}

function active(slots:Record<string,unknown>):ActiveTask {
  return {
    taskId:'otop-1',type:'otop_order',domain:'otop',status:'ready',slots,missingFields:[],
    selectedEntities:[],constraints:[],commitmentIntent:true,sourceChannel:'line',
    createdAt:'2026-09-30T00:00:00Z',updatedAt:'2026-09-30T00:00:00Z',
  } as ActiveTask;
}

function oneMind(turn:SemanticTurn,slots:Record<string,unknown>,toolName='create_otop_order') {
  const container={...emptyTaskStateContainer(),activeTask:active(slots)};
  return {
    status:'legacy_required',reason:'transactional_or_task_turn',
    turn:{
      semanticTurn:turn,dialogSemanticTurn:turn,semanticMeaning:deriveSemanticMeaning(turn),
      dialogDecision:{
        mode:'propose_action',taskStateContainer:container,knowledgeRequests:[],missingFields:[],
        responseIntent:'propose_action',reasons:[],
        actionProposal:{
          toolName,validatedArgs:slots,requiresExplicitConfirmation:true,
          customerCommitPresent:true,idempotencyKey:'otop-1',
        },
      },
      groundedKnowledge:[],
      knowledgeDegradation:{condition:'none',level:'normal',reasons:[],retryable:false},
    },observability:{},
  } as any;
}

test('validated supervised OTOP proposal reaches the terminal order executor',()=>{
  const slots={
    sku:' OTOP-NB-003 ',quantity:1,customerName:' ทดสอบ E2E ',phone:' 0800000005 ',
    fulfillmentType:'pickup',
  };
  const decision=resolveSupervisedOtopCutover(oneMind(semantic(),slots),'line','th');
  assert.equal(decision?.kind,'execute_order');
  assert.deepEqual(decision?.kind==='execute_order'?decision.args:null,{
    sku:'OTOP-NB-003',quantity:1,customerName:'ทดสอบ E2E',phone:'0800000005',
    fulfillmentType:'pickup',
  });
});

test('production-shaped confirm action executes when Dialog Manager proves current customer commit',()=>{
  const slots={sku:'OTOP-NB-003',quantity:1,fulfillmentType:'pickup'};
  const turn=semantic({action:'confirm',intent:'confirm_product_order',speechAct:'selection'});
  const decision=resolveSupervisedOtopCutover(oneMind(turn,slots),'line','th');
  assert.equal(decision?.kind,'execute_order');
});

test('OTOP policy requires canonical SKU and quantity before proposing an order',()=>{
  assert.deepEqual(computeTaskMissingFields(active({})),['sku','quantity']);
  assert.deepEqual(computeTaskMissingFields(active({sku:'OTOP-NB-003',quantity:1})),[]);
});

test('OTOP product name resolves to exactly one LIVE catalog SKU with sufficient stock',()=>{
  const task=active({productName:'กล้วยกรอบแก้วตรานกกระจิบ',quantity:1});
  const bundle={
    domain:'otop',sourceId:'otop_products_live',sourceType:'otop_live',status:'ok',
    freshness:{fetchedAt:'2026-09-30T00:00:00Z'},
    facts:[
      {key:'otop:OTOP-NB-003:name',value:'กล้วยกรอบแก้วตรานกกระจิบ',domain:'otop'},
      {key:'otop:OTOP-NB-003:stock',value:30,domain:'otop'},
      {key:'otop:OTOP-BK-001:name',value:'ผ้าไหมมัดหมี่ บ้านเขว้า',domain:'otop'},
      {key:'otop:OTOP-BK-001:stock',value:10,domain:'otop'},
    ],
  } as any;
  assert.deepEqual(resolveOtopStructuredSlots(task,[bundle]),{
    sku:'OTOP-NB-003',productName:'กล้วยกรอบแก้วตรานกกระจิบ',
  });

  const insufficient=active({productName:'กล้วยกรอบแก้วตรานกกระจิบ',quantity:31});
  assert.deepEqual(resolveOtopStructuredSlots(insufficient,[bundle]),{});

  const declaredSku=active({productSku:'OTOP-NB-003',quantity:1});
  assert.deepEqual(resolveOtopStructuredSlots(declaredSku,[bundle]),{
    sku:'OTOP-NB-003',productName:'กล้วยกรอบแก้วตรานกกระจิบ',
  });
});

test('OTOP cutover never executes an unvalidated or noncommitted proposal',()=>{
  const slots={sku:'OTOP-NB-003',quantity:1};
  const wrongTool=resolveSupervisedOtopCutover(oneMind(semantic(),slots,'create_restaurant_preorder'),'line','th');
  assert.equal(wrongTool?.kind,'respond');

  const noCommit=oneMind(semantic(),slots);
  noCommit.turn.dialogDecision.actionProposal.customerCommitPresent=false;
  const withheld=resolveSupervisedOtopCutover(noCommit,'line','th');
  assert.equal(withheld?.kind,'respond');
});
