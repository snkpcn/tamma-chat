process.env.THONGTHAI_SEMANTIC_CERTIFICATION_MODE='1';

import assert from 'node:assert/strict';
import {
  emptySemanticContext,
  interpretSemanticTurn,
  type SemanticContext,
} from '../netlify/functions/_semantic-interpreter';
import {
  classifyCommercialBoundarySemantic,
  type CommercialBoundaryMode,
} from '../netlify/functions/_commercial-intent-boundary';

const empty=emptySemanticContext();
const activityPlanning:SemanticContext={
  activeDomain:'activity',
  activeTopic:'activity_booking',
  lastAction:'confirm',
  rollingSummary:'ลูกค้ากำลังพิจารณาขี่ม้า เลือกภาราดรไว้ แต่ยังไม่ได้จอง',
  lastRecommendationReference:'ภาราดรเป็นตัวเลือกที่กำลังพิจารณา',
  recentEntities:[
    {id:'activity_asset:horse-pharadon',type:'activity_asset',name:'ภาราดร',domain:'activity',canonical:true},
    {id:'activity_asset:horse-thongthai',type:'activity_asset',name:'ทองไทย',domain:'activity',canonical:true},
  ],
  recentTurns:[
    {role:'user',content:'ภาราดรน่าสนใจ'},
    {role:'assistant',content:'ได้ครับ เก็บเป็นตัวเลือกไว้ก่อน ยังไม่ได้จองครับ'},
  ],
  activeTask:{
    type:'activity_booking',
    domain:'activity',
    status:'collecting',
    knownSlots:{horseName:'ภาราดร',resourceCode:'activity-horse'},
    missingFields:['date','time','durationMinutes','partySize'],
    selectedEntities:[
      {id:'activity_asset:horse-pharadon',type:'activity_asset',name:'ภาราดร',domain:'activity',canonical:true},
    ],
    constraints:['no_transaction'],
  },
};

type Probe={
  id:string;
  message:string;
  context:SemanticContext;
  expected:CommercialBoundaryMode[];
  mustCommit:boolean;
  mustWithhold?:boolean;
};

const probes:Probe[]=[
  {id:'ask-booking-ability',message:'จองได้ไหมครับ',context:empty,expected:['READ_ONLY'],mustCommit:false},
  {id:'ask-confirm-how',message:'ยืนยันการจองต้องทำยังไงครับ',context:empty,expected:['READ_ONLY'],mustCommit:false},
  {id:'ask-order-how',message:'ถ้าจะสั่งอาหารต้องทำยังไงครับ',context:empty,expected:['READ_ONLY'],mustCommit:false},
  {id:'discover-activity',message:'มีอะไรให้เล่นบ้างครับ',context:empty,expected:['READ_ONLY'],mustCommit:false},
  {id:'ask-price',message:'ขี่ม้ากี่บาทครับ',context:empty,expected:['READ_ONLY'],mustCommit:false},

  {id:'consider-selection',message:'เอาภาราดรครับ ยังไม่จองนะ',context:activityPlanning,expected:['WITHHOLD'],mustCommit:false},
  {id:'consider-hold',message:'เอาอันนี้ไว้ก่อน เดี๋ยวค่อยตัดสินใจครับ',context:activityPlanning,expected:['WITHHOLD','CONSIDER'],mustCommit:false},
  {id:'consider-resume',message:'กลับไปเรื่องจองต่อครับ แต่ยังไม่จองนะ',context:activityPlanning,expected:['WITHHOLD','CONSIDER','MANAGE'],mustCommit:false},
  {id:'consider-correction',message:'เปลี่ยนเป็นทองไทยก่อนครับ ยังไม่จอง',context:activityPlanning,expected:['WITHHOLD','MANAGE','CONSIDER'],mustCommit:false},
  {id:'revoke-late',message:'จองเลยครับ แต่เดี๋ยวก่อน ยังไม่จอง',context:activityPlanning,expected:['MANAGE'],mustCommit:false,mustWithhold:true},

  {id:'commit-book',message:'เอาภาราดร พรุ่งนี้ห้าโมง 30 นาที จองเลยครับ',context:activityPlanning,expected:['COMMIT'],mustCommit:true},
  {id:'commit-order',message:'ขอสั่งตำลาว 1 จานครับ',context:empty,expected:['COMMIT'],mustCommit:true},

  {id:'manage-cancel',message:'ยกเลิกอันที่คุยไว้ก่อนครับ',context:activityPlanning,expected:['MANAGE'],mustCommit:false,mustWithhold:true},
  {id:'manage-correct',message:'เมื่อกี้ภาราดร เปลี่ยนเป็นทองไทยครับ',context:activityPlanning,expected:['MANAGE'],mustCommit:false,mustWithhold:true},

  {id:'incident-staff',message:'เจิดพูดไม่ดีมากครับ อยากให้ช่วยดูหน่อย',context:empty,expected:['INCIDENT'],mustCommit:false},
  {id:'incident-safety',message:'ช่วยด้วยครับ ล้มตอนเล่น ATV เจ็บอยู่',context:empty,expected:['INCIDENT'],mustCommit:false},
];

function isTransientProviderError(error:unknown):boolean{
  const message=error instanceof Error?error.message:String(error);
  return /(?:^|\s)(?:429|5\d\d)(?:\s|$)|OpenAI\s+(?:429|5\d\d)|provider.*(?:429|5\d\d)/iu.test(message);
}

async function interpretWithTransientRetry(
  message:string,
  context:SemanticContext,
){
  let last:unknown;
  for(let attempt=1;attempt<=3;attempt+=1){
    try{
      return await interpretSemanticTurn(message,context,{certificationMode:true});
    }catch(error){
      last=error;
      if(!isTransientProviderError(error)||attempt===3) throw error;
      console.log('PHASE4_LIVE_TRANSIENT_RETRY',JSON.stringify({
        attempt,
        error:error instanceof Error?error.message:String(error),
      }));
      await new Promise(resolve=>setTimeout(resolve,attempt*1200));
    }
  }
  throw last;
}

async function main(){
  assert.ok(process.env.OPENAI_API_KEY,'OPENAI_API_KEY required');
  const results:any[]=[];
  for(const probe of probes){
    const turn=await interpretWithTransientRetry(
      probe.message,
      probe.context,
    );
    const boundary=classifyCommercialBoundarySemantic(turn);
    const pass=probe.expected.includes(boundary.mode)
      && boundary.currentTurnCommit===probe.mustCommit
      && (probe.mustWithhold !== true || boundary.withholdsExecution === true)
      && (probe.mustCommit || !boundary.prepareEligible || boundary.mode!=='COMMIT');
    const row={
      id:probe.id,
      message:probe.message,
      semantic:{
        source:turn.semanticSource,
        domain:turn.domain,
        action:turn.action,
        speechAct:turn.speechAct??null,
        informationNeed:turn.informationNeed??'none',
        constraints:turn.constraints,
        confidence:turn.confidence,
        needsClarification:turn.needsClarification,
      },
      boundary,
      expected:probe.expected,
      mustCommit:probe.mustCommit,
      mustWithhold:probe.mustWithhold??false,
      pass,
    };
    results.push(row);
    console.log(JSON.stringify(row));
  }

  const failed=results.filter(row=>!row.pass);
  const summary={
    kind:'PHASE4_LIVE_HUMAN_INTENT',
    total:results.length,
    passed:results.length-failed.length,
    failed:failed.length,
    falseCommitNonCommitCases:results.filter(row=>!row.mustCommit&&row.boundary.currentTurnCommit).length,
    missedCommitCases:results.filter(row=>row.mustCommit&&!row.boundary.currentTurnCommit).length,
    failures:failed.map(row=>({
      id:row.id,
      expected:row.expected,
      actual:row.boundary.mode,
      semantic:row.semantic,
    })),
  };
  console.log(JSON.stringify(summary,null,2));
  assert.equal(summary.falseCommitNonCommitCases,0,'non-commit human intent crossed the commercial boundary');
  assert.equal(summary.missedCommitCases,0,'explicit commit was lost');
  assert.equal(summary.failed,0,'Phase 4 live human-intent matrix failed');
}

main().catch(error=>{
  console.error('PHASE4_LIVE_HUMAN_INTENT_FAILED',error instanceof Error?error.message:String(error));
  process.exit(1);
});
