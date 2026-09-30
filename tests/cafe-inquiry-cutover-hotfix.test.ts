import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTaskMissingFields } from '../netlify/functions/_domain-task-policy';
import { deriveSemanticMeaning } from '../netlify/functions/_semantic-meaning';
import {
  buildProductionSemanticInterpreterPrompt,
  emptySemanticContext,
  parseSemanticTurnResponse,
  type SemanticTurn,
} from '../netlify/functions/_semantic-interpreter';
import { hasStandaloneTransactionRequest } from '../netlify/functions/_slot-parsers';
import { emptyTaskStateContainer, type ActiveTask } from '../netlify/functions/_task-state';
import { resolveSupervisedCafeCutover } from '../netlify/functions/thongthai-chat';

function semantic(overrides:Partial<SemanticTurn>={}):SemanticTurn {
  return {
    domain:'cafe',intent:'submit_cafe_inquiry',action:'order',speechAct:'transaction_request',
    informationNeed:'none',entities:{question:'ขอสั่งกาแฟ 5 แก้ว วันที่ 2 ตุลาคม เวลา 09:00'},
    references:[],constraints:[],confidence:.96,needsClarification:false,
    ...overrides,
  };
}

function active(slots:Record<string,unknown>):ActiveTask {
  return {
    taskId:'cafe-1',type:'cafe_inquiry',domain:'cafe',status:'ready',slots,missingFields:[],
    selectedEntities:[],constraints:[],commitmentIntent:true,sourceChannel:'line',
    createdAt:'2026-09-30T00:00:00Z',updatedAt:'2026-09-30T00:00:00Z',
  } as ActiveTask;
}

function oneMind(turn:SemanticTurn,task:ActiveTask) {
  const owned={...turn,semanticSource:'openai_supervisor' as const};
  const container={...emptyTaskStateContainer(),activeTask:task};
  return {
    status:'legacy_required',reason:'transactional_or_task_turn',
    turn:{
      semanticTurn:owned,dialogSemanticTurn:owned,semanticMeaning:deriveSemanticMeaning(owned),
      dialogDecision:{
        mode:'propose_action',taskStateContainer:container,knowledgeRequests:[],missingFields:[],
        responseIntent:'propose_action',reasons:[],
        actionProposal:{
          toolName:'create_cafe_inquiry',validatedArgs:task.slots,requiresExplicitConfirmation:true,
          customerCommitPresent:true,idempotencyKey:task.taskId,
        },
      },
      groundedKnowledge:[],
      knowledgeDegradation:{condition:'none',level:'normal',reasons:[],retryable:false},
    },observability:{},
  } as any;
}

test('explicit Cafe inquiry submission is transactional but remains an inquiry, not a fact lookup',()=>{
  const productionPrompt=buildProductionSemanticInterpreterPrompt(
    emptySemanticContext(),
    'ยืนยันสั่งกาแฟ 5 แก้ว กรุณาส่งเรื่องให้ทีมคาเฟ่ติดต่อกลับ',
  );
  assert.match(productionPrompt,/Cafe has no verified menu\/price\/hours\/inventory or direct checkout/);
  assert.match(productionPrompt,/entities\.question/);

  const modelOutput=JSON.stringify({
    normalizedMeaning:'send this preorder question to the cafe team',speechAct:'transaction_request',
    domain:'cafe',intent:'submit_cafe_preorder_inquiry',action:'order',informationNeed:'availability',
    entities:{
      question:'ขอสั่งกาแฟ 5 แก้ว วันที่ 2 ตุลาคม เวลา 09:00',
      customerName:'ทดสอบ E2E',phone:'0800000004',
    },references:[],constraints:[],confidence:.96,needsClarification:false,
  });
  const turn=parseSemanticTurnResponse(
    modelOutput,emptySemanticContext(),
    'ยืนยันสั่งกาแฟ 5 แก้ว ส่งเรื่องให้ทีมคาเฟ่ติดต่อกลับ ชื่อทดสอบ E2E โทร 0800000004',
  );
  assert.equal(turn.action,'order');
  assert.equal(turn.informationNeed,'none');
  assert.equal(turn.entities.question,'ขอสั่งกาแฟ 5 แก้ว วันที่ 2 ตุลาคม เวลา 09:00');
  assert.equal(hasStandaloneTransactionRequest('ยืนยันสั่งกาแฟ แล้วให้ทีมติดต่อกลับ'),true);
  assert.equal(hasStandaloneTransactionRequest('กลับมาสั่งต่อครับ'),false);
});

test('explicit Cafe staff handoff repairs a live-model read-only misclassification',()=>{
  const message='ยืนยันสั่งกาแฟ 5 แก้ว วันที่ 2 ตุลาคม 2569 เวลา 09:00 กรุณาส่งเรื่องให้ทีม Inthanin Café ติดต่อกลับ ชื่อทดสอบ E2E โทร 0800000004';
  const modelOutput=JSON.stringify({
    normalizedMeaning:'ask about cafe preorder availability',
    reply:'ขออภัย ยังไม่มีข้อมูลจากร้าน',
    speechAct:'request',domain:'cafe',intent:'cafe_read_only_inquiry',action:'ask',
    informationNeed:'availability',entities:{customerName:'ทดสอบ E2E',phone:'0800000004'},
    references:[],constraints:[],confidence:.95,needsClarification:true,
    clarificationReason:'source unavailable',
  });
  const turn=parseSemanticTurnResponse(modelOutput,emptySemanticContext(),message);
  assert.equal(turn.action,'order');
  assert.equal(turn.speechAct,'transaction_request');
  assert.equal(turn.informationNeed,'none');
  assert.equal(turn.entities.question,message);
  assert.equal(turn.entities.customerName,'ทดสอบ E2E');
  assert.equal(turn.entities.phone,'0800000004');
  assert.equal(turn.needsClarification,false);
  assert.equal(turn.clarificationReason,undefined);
  assert.equal(turn.reply,undefined);
});

test('Cafe handoff repair does not authorize ordinary or explicitly withheld questions',()=>{
  const readOnlyModel={
    normalizedMeaning:'ask about cafe menu',speechAct:'question',domain:'cafe',
    intent:'cafe_read_only_inquiry',action:'ask',informationNeed:'catalog',entities:{},
    references:[],constraints:[],confidence:.95,needsClarification:false,
  };
  const ordinary=parseSemanticTurnResponse(
    JSON.stringify(readOnlyModel),emptySemanticContext(),'คาเฟ่มีลาเต้ไหม',
  );
  assert.notEqual(ordinary.action,'order');
  assert.equal(ordinary.informationNeed,'catalog');

  const handoffWithoutOrder=parseSemanticTurnResponse(
    JSON.stringify(readOnlyModel),emptySemanticContext(),'ช่วยส่งเรื่องให้ทีมคาเฟ่ติดต่อกลับ',
  );
  assert.notEqual(handoffWithoutOrder.action,'order');

  const withheld=parseSemanticTurnResponse(
    JSON.stringify(readOnlyModel),emptySemanticContext(),
    'ยังไม่สั่ง แค่ถามว่ามีลาเต้ไหม กรุณาส่งเรื่องให้ทีมคาเฟ่ติดต่อกลับ',
  );
  assert.notEqual(withheld.action,'order');
  assert.ok(withheld.constraints.includes('no_transaction'));
});

test('Cafe inquiry policy requires a concrete question and keeps contact fields optional',()=>{
  assert.deepEqual(computeTaskMissingFields(active({})) ,['question']);
  assert.deepEqual(computeTaskMissingFields(active({question:'สอบถามพรีออเดอร์กาแฟ'})),[]);
});

test('supervised Cafe cutover executes only a validated explicit inquiry proposal',()=>{
  const slots={question:'ขอสั่งกาแฟ 5 แก้ว วันที่ 2 ตุลาคม เวลา 09:00',customerName:' ทดสอบ E2E ',phone:' 0800000004 '};
  const committed=resolveSupervisedCafeCutover(oneMind(semantic({entities:slots}),active(slots)),'line','th');
  assert.equal(committed?.kind,'execute_inquiry');
  assert.deepEqual(committed?.kind==='execute_inquiry'?committed.args:null,{
    question:'ขอสั่งกาแฟ 5 แก้ว วันที่ 2 ตุลาคม เวลา 09:00',
    customerName:'ทดสอบ E2E',phone:'0800000004',
  });

  const readOnly=resolveSupervisedCafeCutover(
    oneMind(semantic({action:'ask',speechAct:'question'}),active(slots)),
    'line','th',
  );
  assert.equal(readOnly?.kind,'respond');
});
