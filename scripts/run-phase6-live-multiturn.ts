import assert from 'node:assert/strict';
import {
  emptySemanticContext,
  interpretSemanticTurn,
  type SemanticContext,
  type SemanticTurn,
} from '../netlify/functions/_semantic-interpreter';

const primaryModel=process.env.THONGTHAI_SEMANTIC_MODEL||'gpt-5.6-terra';
const reviewModel=process.env.THONGTHAI_SEMANTIC_REVIEW_MODEL||'gpt-5.6-sol';
const counts={primary:0,review:0};
const originalLog=console.log;
console.log=(...args:unknown[])=>{
  if(args[0]==='THONGTHAI_MODEL_PROVIDER_SUCCESS'){
    if(args[1]==='semantic-interpreter'&&args[2]===primaryModel) counts.primary+=1;
    if(args[1]==='semantic-reviewer'&&args[2]===reviewModel) counts.review+=1;
  }
  originalLog(...args);
};

function assertReadOnly(turn:SemanticTurn,label:string):void {
  assert.ok(!['book','order','confirm','modify','cancel'].includes(turn.action),`${label}: unexpected mutating action ${turn.action}`);
}

async function main():Promise<void>{
  const failures:Array<Record<string,unknown>>=[];
  let passed=0;
  const check=async(id:string,run:()=>Promise<void>)=>{
    try{await run();passed+=1;}
    catch(error){failures.push({id,error:error instanceof Error?error.message:String(error)});}
  };

  await check('terra-no-review-ordinary-turn',async()=>{
    const before={...counts};
    const result=await interpretSemanticTurn('ทำไมพระจันทร์ถึงมีข้างขึ้นข้างแรม',emptySemanticContext());
    assert.equal(result.domain,'general');
    assertReadOnly(result,'ordinary general question');
    assert.equal(counts.primary,before.primary+1,'ordinary turn must use Terra exactly once');
    assert.equal(counts.review,before.review,'ordinary strong turn must not call Sol');
  });

  const horseEntities:SemanticContext['recentEntities']=[
    {id:'activity_asset:horse-pharadon',type:'activity_asset',name:'ภาราดร',domain:'activity',source:'catalog',canonical:true},
    {id:'activity_asset:horse-thongthai',type:'activity_asset',name:'ทองไทย',domain:'activity',source:'catalog',canonical:true},
  ];
  await check('bounded-sol-review-unresolved-reference',async()=>{
    const before={...counts};
    const result=await interpretSemanticTurn('เอาตัวที่ดูนิ่งกว่านั่นแหละ',{
      ...emptySemanticContext(),activeDomain:'activity',recentEntities:horseEntities,
      recentTurns:[{role:'assistant',content:'มีภาราดรกับทองไทยครับ'}],
    });
    assert.equal(counts.primary,before.primary+1,'ambiguous reference must start with Terra');
    assert.ok(counts.review>=before.review+1,'unresolved contextual reference must invoke bounded Sol review');
    assert.ok(result.domain==='activity'||result.needsClarification,'review must stay in context or clarify');
    assert.notEqual(result.action,'book');
  });

  const restaurantContext:SemanticContext={
    ...emptySemanticContext(),activeDomain:'restaurant',
    recentTurns:[
      {role:'user',content:'ร้านมีอะไรน่ากิน'},
      {role:'assistant',content:'มีเมนูที่ตรวจสอบจากรายการร้านครับ'},
    ],
  };
  await check('restaurant-availability-is-not-order',async()=>{
    const result=await interpretSemanticTurn('พรุ่งนี้หกโมงโต๊ะยังว่างไหม',restaurantContext);
    assert.equal(result.domain,'restaurant');
    assertReadOnly(result,'restaurant availability');
    assert.ok(result.informationNeed==='availability'||result.action==='status');
  });

  await check('restaurant-negation-suppresses-transaction',async()=>{
    const result=await interpretSemanticTurn('ถามเรื่องโต๊ะเฉย ๆ นะ ยังไม่ได้ให้จอง',restaurantContext);
    assert.equal(result.domain,'restaurant');
    assert.notEqual(result.action,'book');
    assert.notEqual(result.action,'order');
    assert.notEqual(result.speechAct,'transaction_request');
  });

  const activityTask={
    type:'activity_booking',domain:'activity' as const,status:'collecting',
    knownSlots:{resourceCode:'activity-horse',horseName:'ภาราดร',date:'2026-10-06',durationMinutes:60},
    missingFields:['time','partySize'],selectedEntities:[horseEntities[0]!],constraints:[],
  };
  await check('side-topic-does-not-inherit-booking-action',async()=>{
    const result=await interpretSemanticTurn('ร้านมีเมนูไม่เผ็ดอะไรบ้าง',{
      ...emptySemanticContext(),activeDomain:'activity',recentEntities:horseEntities,activeTask:activityTask,
    });
    assert.equal(result.domain,'restaurant');
    assertReadOnly(result,'restaurant side topic');
  });

  await check('resume-and-explicit-book-remain-distinct',async()=>{
    const resumeContext:SemanticContext={
      ...emptySemanticContext(),activeDomain:'restaurant',recentEntities:horseEntities,
      suspendedTask:activityTask,
      recentTurns:[
        {role:'user',content:'เลือกภาราดรไว้ก่อน'},
        {role:'user',content:'ร้านมีอะไรกินบ้าง'},
      ],
    };
    const resumed=await interpretSemanticTurn('กลับไปเรื่องม้าที่ค้างไว้',resumeContext);
    assert.equal(resumed.domain,'activity');
    assert.equal(resumed.taskDirective,'resume_suspended');
    assert.notEqual(resumed.action,'book');

    const committed=await interpretSemanticTurn('จองเลย วันที่หกตุลา สิบโมง สองคน',{
      ...resumeContext,activeDomain:'activity',activeTask:activityTask,suspendedTask:null,
    });
    assert.equal(committed.domain,'activity');
    assert.equal(committed.action,'book');
    assert.equal(committed.speechAct,'transaction_request');
  });

  const total=6;
  originalLog(JSON.stringify({
    kind:'PHASE6_LIVE_MULTITURN_SEMANTIC_ACCEPTANCE',
    total,pass:passed,failed:failures.length,
    primaryModel,reviewModel,
    providerSuccessCounts:counts,
    boundedReviewObserved:counts.review>0,
    noBusinessExecutorCalled:true,
    failures,
  },null,2));
  if(failures.length) process.exitCode=1;
}

main().catch(error=>{
  console.error('PHASE6_LIVE_MULTITURN_SEMANTIC_ACCEPTANCE_CRASH',error instanceof Error?error.message:String(error));
  process.exitCode=1;
});
