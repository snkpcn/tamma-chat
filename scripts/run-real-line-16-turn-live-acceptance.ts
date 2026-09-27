// Owner real-conversation certification: paid live smoke is intentional; no production transaction/data mutation.
// Rerun after semantic refinement + structured JSON ceiling fixes.
// Final owner acceptance rerun after state, journey, and context fixes.
// Final human-response certification after grounded response and reference fixes.
// Final rerun after open-world local-domain and bounded-reference review fixes.
process.env.THONGTHAI_SEMANTIC_CERTIFICATION_MODE = '1';

import assert from 'node:assert/strict';
import {
  interpretSemanticTurn,
  type SemanticContext,
} from '../netlify/functions/_semantic-interpreter';
import {
  processOneMindCustomerTurn,
  type OneMindCustomerTurnResult,
} from '../netlify/functions/_thongthai-one-mind-response';
import type {
  OneMindDependencies,
} from '../netlify/functions/_thongthai-one-mind-orchestrator';
import type {
  GroundedFact,
  KnowledgeSourceAdapters,
  KnowledgeSourceType,
  SourceResult,
} from '../netlify/functions/_knowledge-resolver';
import type { GuestAgentStateSnapshot } from '../netlify/functions/_guest-agent-state-store';

const NOW = new Date('2026-09-27T12:00:00+07:00');
const CANON = '73333333-3333-4333-8333-333333333333';
const GUEST = '74444444-4444-4444-8444-444444444444';

function fact(
  key:string,
  value:unknown,
  domain:GroundedFact['domain'],
  sourceId:string,
  sourceType:KnowledgeSourceType,
):GroundedFact {
  return {
    key,value,domain,sourceId,sourceType,authoritative:true,
    fetchedAt:NOW.toISOString(),
  };
}
function ok(sourceId:string,sourceType:KnowledgeSourceType,data:GroundedFact[]):SourceResult {
  return {status:'ok',sourceId,sourceType,fetchedAt:NOW.toISOString(),data};
}
function empty(sourceId:string,sourceType:KnowledgeSourceType):SourceResult {
  return {status:'empty',sourceId,sourceType,fetchedAt:NOW.toISOString()};
}

const activityFacts:GroundedFact[]=[
  fact('activity:horse_riding:name','ขี่ม้า','activity','activity-test','activity_live'),
  fact('activity:horse_riding:resourceCode','activity-horse','activity','activity-test','activity_live'),
  fact('activity:horse_riding:30min:price',300,'activity','activity-test','activity_live'),
  fact('activity:horse_riding:60min:price',550,'activity','activity-test','activity_live'),
  fact('activity_asset:horse-paradorn:name','ภาราดร','activity','activity-test','activity_live'),
  fact('activity_asset:horse-paradorn:type','horse','activity','activity-test','activity_live'),
  fact('activity_asset:horse-paradorn:activityCode','horse_riding','activity','activity-test','activity_live'),
  fact('temperament:activity_asset:horse-paradorn','calm','activity','activity-test','activity_live'),
  fact('beginnerSuitable:activity_asset:horse-paradorn',true,'activity','activity-test','activity_live'),
  fact('activity_asset:horse-thongthai:name','ทองไทย','activity','activity-test','activity_live'),
  fact('activity_asset:horse-thongthai:type','horse','activity','activity-test','activity_live'),
  fact('activity_asset:horse-thongthai:activityCode','horse_riding','activity','activity-test','activity_live'),
  fact('temperament:activity_asset:horse-thongthai','lively','activity','activity-test','activity_live'),
  fact('beginnerSuitable:activity_asset:horse-thongthai',true,'activity','activity-test','activity_live'),
  fact('activity:archery:name','ยิงธนู','activity','activity-test','activity_live'),
  fact('activity:archery:resourceCode','activity-archery','activity','activity-test','activity_live'),
];

const restaurantFacts:GroundedFact[]=[
  fact('menu:somtam-thai:name','ตำไทย','restaurant','restaurant-test','restaurant_live'),
  fact('menu:somtam-thai:price',89,'restaurant','restaurant-test','restaurant_live'),
  fact('menu:somtam-thai:ingredients',['papaya','peanut'],'restaurant','restaurant-test','restaurant_live'),
  fact('menu:grilled-chicken:name','ไก่ย่าง','restaurant','restaurant-test','restaurant_live'),
  fact('menu:grilled-chicken:price',180,'restaurant','restaurant-test','restaurant_live'),
  fact('menu:grilled-chicken:ingredients',['chicken'],'restaurant','restaurant-test','restaurant_live'),
];

const stayFacts:GroundedFact[]=[
  fact('stay:one-bedroom:name','บ้านหนึ่งห้องนอน','stay','stay-test','stay_live'),
  fact('stay:one-bedroom:capacity',2,'stay','stay-test','stay_live'),
  fact('stay:two-bedroom:name','บ้านสองห้องนอน','stay','stay-test','stay_live'),
  fact('stay:two-bedroom:capacity',4,'stay','stay-test','stay_live'),
];

const otopFacts:GroundedFact[]=[
  fact('otop:gift-a:name','ของฝากชุมชน','otop','otop-test','otop_live'),
  fact('otop:gift-a:price',150,'otop','otop-test','otop_live'),
  fact('otop:gift-a:stock',10,'otop','otop-test','otop_live'),
];

const promotionFacts:GroundedFact[]=[
  fact('promo:restaurant-current',{name:'โปรร้านอาหาร',requiresMembership:false},'promotion','promotion-test','promotion_runtime'),
];

const adapters:KnowledgeSourceAdapters={
  activity:{
    catalog:async()=>ok('activity-test','activity_live',activityFacts),
    availability:async()=>empty('activity-availability-test','activity_live'),
  },
  restaurant:{
    menu:async()=>ok('restaurant-test','restaurant_live',restaurantFacts),
    availability:async()=>empty('restaurant-availability-test','restaurant_live'),
  },
  stay:{
    catalog:async()=>ok('stay-test','stay_live',stayFacts),
    availability:async()=>empty('stay-availability-test','stay_live'),
  },
  promotion:{
    eligibility:async()=>ok('promotion-test','promotion_runtime',promotionFacts),
  },
  otop:{
    catalog:async()=>ok('otop-test','otop_live',otopFacts),
  },
};

let snapshot:GuestAgentStateSnapshot={exists:false,state:{},updatedAt:null};
let revision=0;
const stateDeps={
  loadSnapshot:async()=>snapshot,
  compareAndSwap:async(
    _id:string,
    current:GuestAgentStateSnapshot,
    patch:{set?:Record<string,unknown>;removeKeys?:string[]},
    at:Date=new Date(),
  )=>{
    revision+=1;
    const next={...current.state,...(patch.set??{})};
    for(const key of patch.removeKeys??[]) delete next[key];
    snapshot={
      exists:true,
      state:next,
      updatedAt:new Date(at.getTime()+revision).toISOString(),
    };
    return {status:'applied' as const,snapshot};
  },
};

const liveInterpret = (
  message:string,
  context:SemanticContext,
)=>interpretSemanticTurn(message,context,{certificationMode:true});

const deps:Partial<OneMindDependencies>={
  resolveCanonicalGuestId:async()=>CANON,
  guestDbIdFromAnonymousId:async()=>GUEST,
  interpretSemanticTurn:liveInterpret,
  buildKnowledgeAdapters:()=>adapters,
  mirrorActivityTaskToLegacySession:async()=>{},
};

type ResultRow={
  n:number;
  message:string;
  status:string;
  domain:string;
  action:string;
  need:string;
  mode:string;
  intent:string;
  clarification:boolean;
  response?:string;
  normalizedMeaning?:string;
  entities?:Record<string,unknown>;
  constraints?:string[];
  speechAct?:string;
  errors:string[];
};

const messages=[
  'อยากขี่ม้าพรุ่งนี้ช่วงเย็น แต่ไม่เอาทองไทยนะ เอาตัวที่นิสัยนิ่งกว่า แล้วถ้าฝนตกมีอะไรให้ทำแทนได้บ้าง',
  'เมื่อกี้บอกว่าเอาภาราดร เปลี่ยนใจละ เอาทองไทยเหมือนเดิม แต่เวลาเดิมนะ',
  'พรุ่งนี้โต๊ะว่างไหม 4 คน ช่วงประมาณหกโมงกว่า ๆ ถ้าเต็มแนะนำเวลาใกล้เคียงให้หน่อย',
  'ไม่กินกุ้ง แล้วก็ไม่ชอบเผ็ดมาก ช่วยแนะนำของกินสำหรับ 3 คน งบประมาณพันนึง แต่ยังไม่ต้องสั่งนะ',
  'ถ้าพักสองคืนแล้ววันแรกอยากขี่ม้า วันที่สองอยากกินข้าวแล้วซื้อของฝาก ช่วยจัดให้คร่าว ๆ ได้ไหม',
  'เอาอันเดิม แต่เปลี่ยนเป็นพรุ่งนี้',
  'ตัวไหนนะที่เมื่อกี้มึงบอกว่านิ่งกว่า เอาตัวนั้นแหละ',
  'ขอเช็กราคาก่อน ยังไม่จองนะ ถ้าถูกกว่าที่คิดค่อยว่ากัน',
  'เมื่อกี้ถามเรื่องห้องอยู่ แต่ช่างมันก่อน มีโปรกินข้าวอะไรตอนนี้บ้าง',
  'เอาโปรร้านอาหารที่คุ้มสุด แต่ไม่เอาแบบต้องสมัครสมาชิกเพิ่มนะ',
  'ถ้าจะพาเด็ก 2 คน ผู้ใหญ่ 3 คน ไปช่วงบ่าย มีอะไรทำได้บ้างที่ไม่หนักเกิน',
  'เมื่อกี้บอก 5 คน ผิด จริง ๆ 4 คน แล้วมีเด็ก 1 คน',
  'ยังไม่ต้องทำรายการอะไรทั้งนั้น แค่อยากรู้ว่าพรุ่งนี้ม้าตัวไหนว่างช่วง 16:30',
  'ถ้าภาราดรไม่ว่าง เอาทองไทยแทนได้ แต่ถ้าทั้งคู่ไม่ว่างไม่ต้องจองอะไร',
  'อยากได้ห้องที่เหมาะกับ 3 คน แต่ก่อนตอบเช็กก่อนว่ามีห้องว่างจริงไหม',
  'ช่วยสรุปให้หน่อยว่าตอนนี้กูเลือกอะไรไปแล้วบ้าง แต่ห้ามกดยืนยันหรือจองให้',
] as const;

function hasAny(text:string,terms:string[]):boolean {
  const lower=text.toLowerCase();
  return terms.some(term=>lower.includes(term.toLowerCase()));
}

function inspectTurn(n:number,result:OneMindCustomerTurnResult):string[] {
  const t=result.turn.semanticTurn;
  const errors:string[]=[];
  const packed=JSON.stringify(t);
  const task=result.turn.taskStateAfter.activeTask;
  const response=result.status==='composed' ? result.response.message : '';

  if(['book','order'].includes(t.action)) errors.push(`unexpected transaction action=${t.action}`);
  if(result.turn.dialogDecision.actionProposal) errors.push('unexpected actionProposal');
  if(result.status==='composed' && /ขอรายละเอียดเพิ่มอีกนิด|ช่วยบอกรายละเอียดเพิ่ม|ช่วยบอกเพิ่มอีกนิด/u.test(response)){
    errors.push('generic clarification fallback leaked into sufficient-context acceptance');
  }
  if(result.status==='composed' && /จองเรียบร้อย|ยืนยันการจองแล้ว|ส่งรายการเข้าระบบแล้ว|สั่งเรียบร้อย/u.test(response)){
    errors.push('response falsely implies completed transaction');
  }

  switch(n){
    case 1:
      if(t.domain!=='activity') errors.push(`domain=${t.domain}`);
      if(!hasAny(packed,['ฝน','rain'])) errors.push('rain contingency lost');
      if(!packed.includes('ทองไทย')) errors.push('Thongthai exclusion lost');
      if(result.status==='composed' && !response.includes('ภาราดร')) errors.push('response did not surface the verified calmer horse');
      if(result.status==='composed' && !hasAny(response,['ฝน','rain'])) errors.push('response dropped rain fallback clause');
      break;
    case 2:
      if(t.domain!=='activity') errors.push(`domain=${t.domain}`);
      if(!packed.includes('ทองไทย')) errors.push('current replacement horse lost');
      if(task?.slots.horseName && task.slots.horseName!=='ทองไทย') errors.push(`stale horse slot=${String(task.slots.horseName)}`);
      if(task?.selectedEntities.some(e=>e.name==='ภาราดร')
          && !task.selectedEntities.some(e=>e.name==='ทองไทย')) errors.push('stale selected entity ภาราดร survived correction');
      if(result.status==='composed' && !response.includes('ทองไทย')) errors.push('response failed to acknowledge corrected horse');
      break;
    case 3:
      if(t.domain!=='restaurant') errors.push(`domain=${t.domain}`);
      if(t.informationNeed!=='availability') errors.push(`need=${t.informationNeed}`);
      if(Number(t.entities.partySize)!==4) errors.push(`partySize=${String(t.entities.partySize)}`);
      if(result.turn.dialogDecision.mode==='collect_field') errors.push('availability hijacked into slot collection');
      break;
    case 4:
      if(t.domain!=='restaurant') errors.push(`domain=${t.domain}`);
      if(t.action!=='recommend') errors.push(`action=${t.action}`);
      if(!hasAny(JSON.stringify(t.constraints),['no_shrimp','shrimp','กุ้ง'])) errors.push('no-shrimp constraint lost');
      if(!hasAny(JSON.stringify(t.constraints),['no_spicy','spicy','เผ็ด'])) errors.push('low-spice constraint lost');
      if(result.status==='composed' && /กุ้งทอด/u.test(response)) errors.push('response violated shrimp constraint');
      if(result.status==='composed' && !hasAny(response,['ตำไทย','ไก่ย่าง'])) errors.push('response did not make a grounded meal recommendation');
      break;
    case 5:
      if(t.domain!=='journey') errors.push(`domain=${t.domain}`);
      if(result.status==='composed' && !/วันแรก|วันที่สอง/u.test(response)) errors.push('journey response did not compose a multi-day plan');
      if(result.status==='composed' && !hasAny(response,['ขี่ม้า','ของฝาก'])) errors.push('journey response dropped requested plan components');
      break;
    case 6:
      if(t.domain==='unknown') errors.push('prior plan reference became unknown');
      if(t.needsClarification) errors.push('prior plan reference unnecessarily clarified');
      break;
    case 7:
      if(t.domain!=='activity') errors.push(`domain=${t.domain}`);
      if(result.turn.dialogDecision.mode==='collect_field') errors.push('reference hijacked into missing-slot collection');
      if(result.status==='composed' && /30\s*\/\s*60\s*\/\s*90|30\s*นาที.*60\s*นาที/u.test(response)) errors.push('response regressed to duration prompt');
      if(result.status==='composed' && !response.includes('ภาราดร')) errors.push('response failed to resolve prior calmer-horse reference');
      break;
    case 8:
      if(t.domain!=='activity') errors.push(`domain=${t.domain}`);
      if(t.informationNeed!=='price') errors.push(`need=${t.informationNeed}`);
      if(result.turn.dialogDecision.mode==='collect_field') errors.push('price query hijacked into slot collection');
      break;
    case 9:
      if(t.domain!=='promotion' && t.domain!=='restaurant') errors.push(`domain=${t.domain}`);
      if(result.turn.dialogDecision.mode==='collect_field') errors.push('topic switch hijacked by old task');
      break;
    case 10:
      if(t.domain!=='promotion') errors.push(`domain=${t.domain}`);
      if(t.action!=='recommend') errors.push(`action=${t.action}`);
      if(!hasAny(JSON.stringify(t.constraints),['membership','สมาชิก'])) errors.push('membership constraint lost');
      if(result.status==='composed' && !response.includes('โปรร้านอาหาร')) errors.push('response failed to surface verified eligible promotion');
      break;
    case 11:
      if(!['activity','ecosystem'].includes(t.domain)) errors.push(`domain=${t.domain}`);
      if(t.action!=='recommend') errors.push(`action=${t.action}`);
      if(result.turn.dialogDecision.mode==='collect_field') errors.push('recommendation hijacked into task collection');
      break;
    case 12:
      if(t.speechAct!=='correction' && t.action!=='correct_previous') errors.push(`not correction: speechAct=${t.speechAct} action=${t.action}`);
      if(result.turn.dialogDecision.actionProposal) errors.push('correction proposed transaction');
      break;
    case 13:
      if(t.domain!=='activity') errors.push(`domain=${t.domain}`);
      if(t.informationNeed!=='availability') errors.push(`need=${t.informationNeed}`);
      if(result.turn.dialogDecision.mode==='collect_field') errors.push('availability query asked booking slot');
      if(result.status==='composed' && /30\s*\/\s*60\s*\/\s*90|เลือก.*นาที/u.test(response)) errors.push('availability response asked for booking duration');
      break;
    case 14:
      if(t.domain!=='activity') errors.push(`domain=${t.domain}`);
      if(t.informationNeed!=='availability' && t.action!=='status') errors.push(`conditional fallback not availability/status: action=${t.action} need=${t.informationNeed}`);
      if(['confirm','book','order'].includes(t.action)) errors.push(`conditional fallback mutated selection: ${t.action}`);
      if(result.status==='composed' && /ล็อกตัวเลือก|เลือกภาราดรให้แล้ว|จอง.*ภาราดร/u.test(response)) errors.push('conditional response prematurely selected/booked primary horse');
      break;
    case 15:
      if(t.domain!=='stay') errors.push(`domain=${t.domain}`);
      if(t.informationNeed!=='availability') errors.push(`need=${t.informationNeed}`);
      if(result.turn.dialogDecision.mode==='collect_field') errors.push('room availability hijacked into booking');
      break;
    case 16:
      if(t.intent!=='summarize_active_task' && !hasAny(t.normalizedMeaning??'', ['สรุป','summary'])) errors.push(`summary intent=${t.intent}`);
      if(result.turn.dialogDecision.actionProposal) errors.push('summary proposed transaction');
      if(result.status==='composed' && !/ยังไม่ได้ยืนยันการจอง|ยังไม่ได้จอง|ไม่ได้ยืนยัน/u.test(response)) errors.push('summary response omitted explicit no-transaction status');
      break;
  }
  return errors;
}

async function main():Promise<void>{
  if(!process.env.OPENAI_API_KEY){
    console.error('REAL_LINE_LIVE_NOT_RUN: OPENAI_API_KEY is required');
    process.exitCode=2;
    return;
  }
  const rows:ResultRow[]=[];
  for(let index=0;index<messages.length;index+=1){
    const message=messages[index]!;
    const n=index+1;
    const at=new Date(NOW.getTime()+index*60_000);
    try{
      const result=await processOneMindCustomerTurn({
        channel:'line',language:'th',message,eventId:`real-line-live-${n}`,
        providerUserKey:'line-live-cert',canonicalAnonymousId:CANON,guestDbId:GUEST,
        persistState:true,environment:'test',
      },deps,stateDeps,at,{requireSemanticSupervisor:true});
      const errors=inspectTurn(n,result);
      if(result.status!=='composed') errors.push(`customer path fell through to legacy: ${result.reason}`);
      rows.push({
        n,message,status:result.status,
        domain:result.turn.semanticTurn.domain,
        action:result.turn.semanticTurn.action,
        need:result.turn.semanticTurn.informationNeed??'none',
        mode:result.turn.dialogDecision.mode,
        intent:result.turn.semanticTurn.intent,
        clarification:result.turn.semanticTurn.needsClarification,
        response:result.status==='composed' ? result.response.message.slice(0,240) : undefined,
        normalizedMeaning:result.turn.semanticTurn.normalizedMeaning,
        entities:result.turn.semanticTurn.entities,
        constraints:result.turn.semanticTurn.constraints,
        speechAct:result.turn.semanticTurn.speechAct,
        errors,
      });
    }catch(error){
      rows.push({
        n,message,status:'crash',domain:'-',action:'-',need:'-',mode:'-',intent:'-',
        clarification:false,
        errors:[error instanceof Error?error.message:String(error)],
      });
    }
  }
  const failures=rows.filter(row=>row.errors.length);
  console.log(JSON.stringify({
    kind:'REAL_LINE_16_TURN_LIVE_ACCEPTANCE',
    total:rows.length,
    pass:rows.length-failures.length,
    failed:failures.length,
    passPct:Number(((rows.length-failures.length)*100/rows.length).toFixed(2)),
    failures:failures.map(row=>({n:row.n,message:row.message,errors:row.errors,domain:row.domain,action:row.action,need:row.need,mode:row.mode,intent:row.intent,speechAct:row.speechAct,normalizedMeaning:row.normalizedMeaning,entities:row.entities,constraints:row.constraints,response:row.response})),
    rows,
    noTransactionProposals:rows.every(row=>!row.errors.includes('unexpected actionProposal')),
  },null,2));
  assert.equal(failures.length,0,'real LINE 16-turn live acceptance must be 100%');
}

main().catch(error=>{
  console.error('REAL_LINE_16_TURN_LIVE_ACCEPTANCE_CRASH',error instanceof Error?error.message:String(error));
  process.exitCode=1;
});
