process.env.THONGTHAI_SEMANTIC_CERTIFICATION_MODE='1';

import assert from 'node:assert/strict';
import {
  emptySemanticContext,
  interpretSemanticTurn,
  type SemanticContext,
} from '../netlify/functions/_semantic-interpreter';
import {
  calculateAiCostUsd,
  estimateInputTokens,
  usdToThb,
} from '../netlify/functions/_ai-cost-policy';

type Capture={
  probe:string;
  model:string;
  estimatedInputTokens:number;
  actualInputTokens:number;
  cachedInputTokens:number;
  outputTokens:number;
  costUsd:number;
  costThb:number;
};

const empty=emptySemanticContext();
const activeActivity:SemanticContext={
  activeDomain:'activity',
  activeTopic:'activity_booking',
  lastAction:'confirm',
  rollingSummary:'ลูกค้าสนใจขี่ม้า เลือกภาราดรไว้พิจารณา แต่ยังไม่ได้จอง',
  lastRecommendationReference:'ภาราดรเหมาะกับเงื่อนไขที่ถามมากกว่าตามข้อมูลที่ยืนยันได้',
  recentEntities:[
    {id:'activity_asset:horse-pharadon',type:'activity_asset',name:'ภาราดร',domain:'activity',canonical:true},
    {id:'activity_asset:horse-thongthai',type:'activity_asset',name:'ทองไทย',domain:'activity',canonical:true},
  ],
  recentTurns:[
    {role:'user',content:'อยากขี่ม้า แต่ยังไม่จองนะ'},
    {role:'assistant',content:'ได้ครับ ลองดูตัวเลือกก่อนได้ครับ'},
    {role:'user',content:'ภาราดรน่าสนใจ'},
    {role:'assistant',content:'ได้ครับ เก็บเป็นตัวเลือกไว้ก่อนครับ'},
  ],
  activeTask:{
    type:'activity_booking',domain:'activity',status:'collecting',
    knownSlots:{horseName:'ภาราดร',resourceCode:'activity-horse'},
    missingFields:['date','time','durationMinutes','partySize'],
    selectedEntities:[
      {id:'activity_asset:horse-pharadon',type:'activity_asset',name:'ภาราดร',domain:'activity',canonical:true},
    ],
    constraints:['no_transaction'],
  },
};
const complex:SemanticContext={
  activeDomain:'restaurant',
  activeTopic:'restaurant:menu:recommendation',
  lastAction:'recommend',
  openQuestion:'เวลาที่ต้องการรับอาหาร',
  rollingSummary:'ลูกค้ามากับแฟน ต้องการทริปชิล ไม่เผ็ด แพ้กุ้ง กำลังเปรียบเทียบอาหารและกิจกรรม แล้วพักเรื่องม้าไว้ก่อน '.repeat(4),
  lastRecommendationReference:'ตำไทยกับไก่ย่างเป็นตัวเลือกที่สอดคล้องกับข้อจำกัดที่ยืนยันได้',
  recentEntities:[
    {id:'menu:somtam-thai',type:'menu_item',name:'ตำไทย',domain:'restaurant',canonical:true},
    {id:'menu:grilled-chicken',type:'menu_item',name:'ไก่ย่าง',domain:'restaurant',canonical:true},
    {id:'activity_asset:horse-pharadon',type:'activity_asset',name:'ภาราดร',domain:'activity',canonical:true},
    {id:'activity_asset:horse-thongthai',type:'activity_asset',name:'ทองไทย',domain:'activity',canonical:true},
  ],
  recentTurns:[
    {role:'user',content:'แฟนแพ้กุ้ง แล้วไม่กินเผ็ดมาก'},
    {role:'assistant',content:'รับทราบครับ ผมจะยึดข้อจำกัดนี้เวลาช่วยเลือกอาหาร'},
    {role:'user',content:'เอาเรื่องม้าไว้ก่อน มาดูอาหาร'},
    {role:'assistant',content:'ได้ครับ พักเรื่องม้าไว้ก่อน'},
    {role:'user',content:'อยากได้อะไรที่กินง่ายสองคน'},
    {role:'assistant',content:'จะยึดข้อมูลเมนูจริงกับข้อจำกัดที่แจ้งครับ'},
  ],
  activeTask:null,
  suspendedTask:{
    type:'activity_booking',domain:'activity',status:'collecting',
    knownSlots:{horseName:'ภาราดร',resourceCode:'activity-horse'},
    missingFields:['date','time','durationMinutes','partySize'],
    selectedEntities:[
      {id:'activity_asset:horse-pharadon',type:'activity_asset',name:'ภาราดร',domain:'activity',canonical:true},
    ],
    constraints:['no_transaction'],
  },
};

const probes:Array<{label:string;message:string;context:SemanticContext}>=[
  {label:'empty-social',message:'วันนี้เหนื่อยนิดหน่อย แต่ยังอยากหาอะไรทำชิล ๆ',context:empty},
  {label:'empty-companion',message:'มากับคนรู้ใจครับ',context:empty},
  {label:'empty-pace',message:'วันนี้ขอแบบสบาย ๆ ไม่อยากเหนื่อยมาก',context:empty},
  {label:'empty-discovery',message:'แถวนี้มีอะไรที่คนพื้นที่ชอบทำกันบ้าง',context:empty},
  {label:'empty-typo',message:'มีไรกินแบบไม่เผ้ดมากมั้ง',context:empty},
  {label:'empty-local',message:'ถ้ามีเวลาแค่ครึ่งวันควรเริ่มตรงไหนก่อน',context:empty},
  {label:'activity-reference',message:'เอาตัวที่เมื่อกี้บอกว่านิ่งกว่าไว้ก่อน แต่ยังไม่จอง',context:activeActivity},
  {label:'activity-correction',message:'เมื่อกี้บอกภาราดร เปลี่ยนใจละ เอาทองไทย แต่เวลาเดิมนะ',context:activeActivity},
  {label:'activity-question',message:'ถ้าฝนตกแล้วขี่ไม่ได้ มีอะไรเบา ๆ แทนได้บ้าง',context:activeActivity},
  {label:'activity-consider',message:'เอาอันนี้ไว้ก่อน เดี๋ยวค่อยตัดสินใจ',context:activeActivity},
  {label:'activity-price-side',message:'ขอเช็กราคาก่อน ยังไม่จอง ถ้าโอเคค่อยว่ากัน',context:activeActivity},
  {label:'activity-summary',message:'สรุปหน่อยว่าตอนนี้เลือกอะไรไว้ แต่ห้ามจองให้',context:activeActivity},
  {label:'complex-topic-switch',message:'เรื่องอาหารไว้ก่อน กลับไปม้าตัวเดิม แล้วขอแบบไม่เหนื่อยมากนะ',context:complex},
  {label:'complex-reference',message:'อันที่เมื่อกี้แนะนำไว้ยังโอเคกับคนแพ้กุ้งอยู่ใช่ไหม',context:complex},
  {label:'complex-correction',message:'เมื่อกี้บอกสามคนผิด จริง ๆ สี่คน แล้วมีเด็กหนึ่ง',context:complex},
  {label:'complex-consider',message:'ตำไทยน่าสนใจ เอาไว้ก่อน ยังไม่ต้องสั่ง',context:complex},
  {label:'complex-resume',message:'กลับไปเรื่องที่พักก่อน แล้วค่อยกลับมาอาหาร',context:complex},
  {label:'complex-openworld',message:'ถ้ามากับผู้ใหญ่ที่เดินไม่เยอะ อยากให้วันนี้ไม่รีบ ควรจัดจังหวะยังไง',context:complex},
  {label:'complex-ellipsis',message:'เอาอันเดิม แต่เปลี่ยนเป็นพรุ่งนี้',context:complex},
  {label:'complex-no-transaction',message:'ยังไม่ต้องทำรายการอะไรนะ แค่ช่วยคิดตัวเลือกให้ก่อน',context:complex},
];

const captures:Capture[]=[];
let currentProbe='unknown';
const realFetch=global.fetch;

function requestTexts(body:any):string[]{
  const texts:string[]=[String(body?.instructions??'')];
  for(const item of body?.input??[]){
    for(const part of item?.content??[]){
      if(typeof part?.text==='string') texts.push(part.text);
    }
  }
  return texts;
}

global.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const response=await realFetch(input,init);
  if(String(input).includes('api.openai.com/v1/responses') && response.ok){
    try{
      const body=JSON.parse(String(init?.body??'{}'));
      const data=await response.clone().json() as any;
      const actualInputTokens=Number(data?.usage?.input_tokens)||0;
      const cachedInputTokens=Number(data?.usage?.input_tokens_details?.cached_tokens)||0;
      const outputTokens=Number(data?.usage?.output_tokens)||0;
      const model=String(body?.model??'unknown');
      const estimatedInputTokens=estimateInputTokens(requestTexts(body));
      const costUsd=calculateAiCostUsd(model,{inputTokens:actualInputTokens,cachedInputTokens,outputTokens});
      captures.push({
        probe:currentProbe,model,estimatedInputTokens,actualInputTokens,cachedInputTokens,outputTokens,
        costUsd,costThb:usdToThb(costUsd),
      });
    }catch(error){
      console.error('PHASE3_COST_CAPTURE_ERROR',error instanceof Error?error.message:String(error));
    }
  }
  return response;
}) as typeof fetch;

function percentile(values:number[],p:number):number{
  if(!values.length) return 0;
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(sorted.length*p)-1))]!;
}
function average(values:number[]):number{
  return values.length?values.reduce((a,b)=>a+b,0)/values.length:0;
}
function round(n:number,d=4):number{
  const m=10**d; return Math.round(n*m)/m;
}

async function main(){
  assert.ok(process.env.OPENAI_API_KEY,'OPENAI_API_KEY is required');
  const interpretations:any[]=[];
  for(const probe of probes){
    currentProbe=probe.label;
    const turn=await interpretSemanticTurn(probe.message,probe.context,{certificationMode:true});
    interpretations.push({
      label:probe.label,domain:turn.domain,action:turn.action,
      confidence:turn.confidence,needsClarification:turn.needsClarification,
    });
  }

  const ratios=captures
    .filter(row=>row.estimatedInputTokens>0)
    .map(row=>row.actualInputTokens/row.estimatedInputTokens);
  const report={
    kind:'PHASE3_LIVE_COST_CALIBRATION',
    probes:probes.length,
    apiCalls:captures.length,
    primaryCalls:captures.filter(row=>row.model.includes('terra')).length,
    reviewCalls:captures.filter(row=>row.model.includes('sol')).length,
    inputTokens:{
      average:round(average(captures.map(row=>row.actualInputTokens)),2),
      p95:percentile(captures.map(row=>row.actualInputTokens),0.95),
      max:Math.max(...captures.map(row=>row.actualInputTokens),0),
    },
    outputTokens:{
      average:round(average(captures.map(row=>row.outputTokens)),2),
      p95:percentile(captures.map(row=>row.outputTokens),0.95),
      max:Math.max(...captures.map(row=>row.outputTokens),0),
    },
    estimatorRatioActualOverEstimate:{
      average:round(average(ratios),4),
      p95:round(percentile(ratios,0.95),4),
      max:round(Math.max(...ratios,0),4),
      underestimates:captures.filter(row=>row.actualInputTokens>row.estimatedInputTokens).length,
    },
    costThb:{
      total:round(captures.reduce((sum,row)=>sum+row.costThb,0),4),
      averagePerApiCall:round(average(captures.map(row=>row.costThb)),4),
      p95PerApiCall:round(percentile(captures.map(row=>row.costThb),0.95),4),
      maxPerApiCall:round(Math.max(...captures.map(row=>row.costThb),0),4),
    },
    interpretations,
    calls:captures,
  };
  console.log(JSON.stringify(report,null,2));

  assert.equal(
    report.estimatorRatioActualOverEstimate.underestimates,0,
    'canonical token estimator must not under-estimate any live calibration call',
  );
}

main().catch(error=>{
  console.error('PHASE3_LIVE_COST_CALIBRATION_FAILED',error instanceof Error?error.message:String(error));
  process.exitCode=1;
}).finally(()=>{global.fetch=realFetch;});
