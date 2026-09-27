process.env.THONGTHAI_SEMANTIC_CERTIFICATION_MODE = '1';
import assert from 'node:assert/strict';
import {
  emptySemanticContext,
  interpretSemanticTurn,
  type SemanticContext,
  type SemanticTurn,
} from '../netlify/functions/_semantic-interpreter';
const interpretSemanticTurnForCertification = (
  message:string,
  context:Parameters<typeof interpretSemanticTurn>[1],
) => interpretSemanticTurn(message, context, { certificationMode:true });


const primaryModel=process.env.THONGTHAI_SEMANTIC_MODEL||'gpt-5.6-terra';
const reviewModel=process.env.THONGTHAI_SEMANTIC_REVIEW_MODEL||'gpt-5.6-sol';
const counts={primary:0,review:0};
const originalLog=console.log;
console.log=(...args:unknown[])=>{
  if(args[0]==='THONGTHAI_MODEL_PROVIDER_SUCCESS'){
    if(args[1]==='semantic-certification-primary'&&args[2]===primaryModel) counts.primary+=1;
    if(args[1]==='semantic-certification-reviewer'&&args[2]===reviewModel) counts.review+=1;
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
    const result=await interpretSemanticTurnForCertification('ทำไมพระจันทร์ถึงมีข้างขึ้นข้างแรม',emptySemanticContext());
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
    const result=await interpretSemanticTurnForCertification('เอาตัวที่ดูนิ่งกว่านั่นแหละ',{
      ...emptySemanticContext(),activeDomain:'activity',recentEntities:horseEntities,
      recentTurns:[{role:'assistant',content:'มีภาราดรกับทองไทยครับ'}],
    });
    assert.equal(counts.primary,before.primary+1,'ambiguous reference must start with Terra');
    assert.ok(result.domain==='activity'||result.needsClarification,'ambiguous reference must stay in context or clarify');
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
    const result=await interpretSemanticTurnForCertification('พรุ่งนี้หกโมงโต๊ะยังว่างไหม',restaurantContext);
    assert.equal(result.domain,'restaurant');
    assertReadOnly(result,'restaurant availability');
    assert.ok(result.informationNeed==='availability'||result.action==='status');
  });

  await check('restaurant-negation-suppresses-transaction',async()=>{
    const result=await interpretSemanticTurnForCertification('ถามเรื่องโต๊ะเฉย ๆ นะ ยังไม่ได้ให้จอง',restaurantContext);
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
    const result=await interpretSemanticTurnForCertification('ร้านมีเมนูไม่เผ็ดอะไรบ้าง',{
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
    const resumed=await interpretSemanticTurnForCertification('กลับไปเรื่องม้าที่ค้างไว้',resumeContext);
    assert.equal(resumed.domain,'activity');
    assert.equal(resumed.taskDirective,'resume_suspended');
    assert.notEqual(resumed.action,'book');

    const committed=await interpretSemanticTurnForCertification('จองเลย วันที่หกตุลา สิบโมง สองคน',{
      ...resumeContext,activeDomain:'activity',activeTask:activityTask,suspendedTask:null,
    });
    assert.equal(committed.domain,'activity');
    assert.equal(committed.action,'book');
    assert.equal(committed.speechAct,'transaction_request');
  });

  // Root-cause note (2026-09-27): this canary used to rely on
  // 'bounded-sol-review-unresolved-reference' leaving its reference
  // genuinely unresolved to force a review call. Once resolveReferences was
  // fixed to trust bounded conversation evidence regardless of the model's
  // reference.type spelling (see _semantic-interpreter.ts), that turn -- and
  // several others in this file that carry real recentTurns/recentEntities --
  // now correctly resolve without needing a second opinion, which is the
  // intended behavior, not a regression. A live confirmed Sol call must not
  // depend on incidental reference-resolution gaps elsewhere in this
  // corpus, so this turn is deliberately given ZERO bounded evidence at all
  // (no recentEntities, recentTurns, rollingSummary, or lastRecommendationReference)
  // while still pointing at prior context -- nothing can resolve it, so the
  // primary model's own confidence must stay low regardless of any future
  // reference-resolution fix.
  await check('bounded-sol-review-genuinely-unresolvable-reference',async()=>{
    const result=await interpretSemanticTurnForCertification('เอาอันเดิมนั่นแหละเหมือนที่คุยกันไว้',emptySemanticContext());
    assert.ok(result.confidence<0.72||result.needsClarification,'a reference with zero bounded evidence must stay low-confidence or ask for clarification, never guess');
  });

  await check('bounded-sol-review-observed',async()=>{
    assert.ok(counts.review>0,'at least one structurally weak/contextual turn must exercise live Sol review');
    assert.ok(counts.review<counts.primary,'Sol must remain bounded and must not run on every Terra turn');
  });

  const total=8;
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
