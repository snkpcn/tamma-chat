import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';
import { resolveSupervisedStayCutover } from '../netlify/functions/thongthai-chat';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';

const fetchedAt='2026-09-27T00:00:00.000Z';
const catalog=[
  ['stay:baan-a:name','บ้านลมเย็น'],['stay:baan-a:bedrooms',1],['stay:baan-a:capacity',2],['stay:baan-a:price',1800],
  ['stay:baan-b:name','บ้านชมดาว'],['stay:baan-b:bedrooms',2],['stay:baan-b:capacity',5],['stay:baan-b:price',2800],
] .map(([key,value])=>({key:String(key),value,domain:'stay',sourceId:'stay_live_holdout',sourceType:'stay_live',authoritative:true,fetchedAt})) as any[];
const availability=[...catalog,{key:'availability:baan-b:2026-10-10T14:00:00+07:00:available',value:true,domain:'stay',sourceId:'stay_live_holdout',sourceType:'stay_live',authoritative:true,fetchedAt}];

function semantic(overrides:Partial<SemanticTurn>):SemanticTurn {
  return { domain:'stay', intent:'unseen_stay_paraphrase', action:'ask', informationNeed:'catalog', entities:{}, references:[], constraints:[], confidence:.91, needsClarification:false, ...overrides };
}
function bundle(facts= catalog) { return [{domain:'stay',sources:[{need:'catalog',sourceId:'stay_live_holdout',sourceType:'stay_live',status:'ok'}],facts,entities:[],missing:[],warnings:[],freshness:'live'}] as any; }
function dialog(extra:Record<string,unknown>={}) { return {mode:'answer',taskStateContainer:emptyTaskStateContainer(),knowledgeRequests:[],missingFields:[],responseIntent:'grounded_answer',reasons:[],...extra} as any; }
function owned(turn:SemanticTurn, d=dialog(), facts=catalog) {
  const value={...turn,semanticSource:'openai_supervisor'};
  return {status:'legacy_required',reason:'transactional_or_task_turn',turn:{semanticTurn:value,dialogSemanticTurn:value,dialogDecision:d,groundedKnowledge:bundle(facts),knowledgeDegradation:{condition:'none',level:'normal',reasons:[],retryable:false}},observability:{}} as any;
}
const task={...emptyTaskStateContainer(),activeTask:{taskId:'stay-gauntlet',type:'stay_booking',domain:'stay',status:'ready',slots:{resourceCode:'baan-b',date:'2026-10-10',endDate:'2026-10-12',nights:2,partySize:4},missingFields:[],selectedEntities:[{id:'stay:baan-b',type:'stay',name:'บ้านชมดาว',domain:'stay',canonical:true}],constraints:[],commitmentIntent:true,sourceChannel:'web',createdAt:fetchedAt,updatedAt:fetchedAt}} as any;
const proposal={toolName:'create_booking',validatedArgs:task.activeTask.slots,requiresExplicitConfirmation:true,customerCommitPresent:true,idempotencyKey:'stay-gauntlet'};

type Case={id:number; capability:string; sample:string; turn:SemanticTurn; decision?:any; facts?:any[]; expected:'respond'|'execute_booking'};
const cases:Case[]=[
  {id:1,capability:'broad accommodation discovery',sample:'มีที่นอนแบบไหนให้เลือกบ้างนะ',turn:semantic({action:'discover',informationNeed:'catalog'}),expected:'respond'},
  {id:2,capability:'one-bedroom focused discovery',sample:'ขอดูเฉพาะบ้านห้องนอนเดียว',turn:semantic({action:'discover',informationNeed:'catalog',entities:{bedrooms:1}}),expected:'respond'},
  {id:3,capability:'two-bedroom focused discovery',sample:'แบบสองห้องนอนมีตัวเลือกอะไร',turn:semantic({action:'discover',informationNeed:'catalog',entities:{bedrooms:2}}),expected:'respond'},
  {id:4,capability:'specific-house question',sample:'บ้านชมดาวรับได้กี่คน',turn:semantic({informationNeed:'capacity',entities:{resourceCode:'baan-b'}}),expected:'respond'},
  {id:5,capability:'recommendation',sample:'พวกเราสี่คนควรพักหลังไหน',turn:semantic({action:'recommend',informationNeed:'recommendation',entities:{partySize:4}}),expected:'respond'},
  {id:6,capability:'comparison',sample:'สองหลังนี้ต่างกันตรงจำนวนคนยังไง',turn:semantic({action:'compare',informationNeed:'capacity'}),expected:'respond'},
  {id:7,capability:'capacity',sample:'หลังนี้นอนได้สูงสุดเท่าไร',turn:semantic({informationNeed:'capacity',entities:{resourceCode:'baan-b'}}),expected:'respond'},
  {id:8,capability:'availability',sample:'สิบตุลาหลังชมดาวยังเหลือไหม',turn:semantic({informationNeed:'availability',entities:{resourceCode:'baan-b',date:'2026-10-10'}}),facts:availability,expected:'respond'},
  {id:9,capability:'date change',sample:'เลื่อนไปวันที่สิบเอ็ดแทนนะ',turn:semantic({action:'modify',speechAct:'correction',informationNeed:'none',entities:{date:'2026-10-11'}}),decision:dialog({taskStateContainer:task}),expected:'respond'},
  {id:10,capability:'add/remove night',sample:'ต่ออีกคืนหนึ่ง',turn:semantic({action:'modify',informationNeed:'none',entities:{nights:3}}),decision:dialog({taskStateContainer:task}),expected:'respond'},
  {id:11,capability:'party-size change',sample:'จริง ๆ ไปกันห้าคน',turn:semantic({action:'modify',informationNeed:'none',entities:{partySize:5}}),decision:dialog({taskStateContainer:task}),expected:'respond'},
  {id:12,capability:'selection',sample:'เก็บบ้านชมดาวไว้ก่อน',turn:semantic({action:'confirm',speechAct:'selection',informationNeed:'none',entities:{resourceCode:'baan-b'}}),decision:dialog({taskStateContainer:task}),expected:'respond'},
  {id:13,capability:'selection followed by question',sample:'หลังที่เลือกนี่พักห้าคนไหวไหม',turn:semantic({action:'ask',informationNeed:'capacity',references:[{type:'selected_stay',refersToPriorContext:true,resolvedEntityId:'stay:baan-b'}]}),decision:dialog({taskStateContainer:task}),expected:'respond'},
  {id:14,capability:'correction',sample:'เมื่อกี้บอกผิด เปลี่ยนเป็นอีกหลัง',turn:semantic({action:'correct_previous',speechAct:'correction',informationNeed:'none',entities:{resourceCode:'baan-a'}}),decision:dialog({taskStateContainer:task}),expected:'respond'},
  {id:15,capability:'reject previous recommendation',sample:'ไม่เอาตัวที่แนะนำแล้ว',turn:semantic({action:'correct_previous',speechAct:'correction',informationNeed:'none',constraints:['exclude_previous_recommendation']}),decision:dialog({taskStateContainer:task}),expected:'respond'},
  {id:16,capability:'prior reference',sample:'หลังเมื่อกี้ราคาเท่าไร',turn:semantic({informationNeed:'price',references:[{type:'prior_stay',refersToPriorContext:true,resolvedEntityId:'stay:baan-b'}]}),decision:dialog({taskStateContainer:task}),expected:'respond'},
  {id:17,capability:'switch topic and return',sample:'กลับมาคุยบ้านพักอันเดิมต่อ',turn:semantic({informationNeed:'capacity',references:[{type:'resumed_stay',refersToPriorContext:true,resolvedEntityId:'stay:baan-b'}],taskDirective:'resume_suspended'}),decision:dialog({taskStateContainer:task}),expected:'respond'},
  {id:18,capability:'slang/incomplete Thai',sample:'บ้านพักอะ มีไรมั่ง',turn:semantic({action:'discover',informationNeed:'catalog'}),expected:'respond'},
  {id:19,capability:'check-in question',sample:'เข้าที่พักช้าสุดกี่โมงนะ',turn:semantic({informationNeed:'policy',entities:{policyTopic:'check_in'}}),expected:'respond'},
  {id:20,capability:'check-out question',sample:'วันกลับต้องคืนบ้านตอนไหน',turn:semantic({informationNeed:'policy',entities:{policyTopic:'check_out'}}),expected:'respond'},
  {id:21,capability:'price question',sample:'บ้านชมดาวคิดคืนละเท่าไหร่',turn:semantic({informationNeed:'price',entities:{resourceCode:'baan-b'}}),expected:'respond'},
  {id:22,capability:'unknown amenity/fact',sample:'มีเครื่องทำวาฟเฟิลไหม',turn:semantic({informationNeed:'amenities',entities:{resourceCode:'baan-b'}}),expected:'respond'},
  {id:23,capability:'booking vocabulary without booking intent',sample:'ถ้าจะจอง บ้านนี้ว่างไหมก่อน',turn:semantic({action:'ask',informationNeed:'availability',entities:{resourceCode:'baan-b',date:'2026-10-10'}}),facts:availability,expected:'respond'},
  {id:24,capability:'explicit booking intent',sample:'ช่วยจองบ้านชมดาวให้หน่อย',turn:semantic({action:'book',speechAct:'transaction_request',informationNeed:'none'}),decision:dialog({taskStateContainer:task}),expected:'respond'},
  {id:25,capability:'bare acknowledgement without commitment context',sample:'โอเคจ้า',turn:semantic({action:'confirm',speechAct:'acknowledgement',informationNeed:'none'}),expected:'respond'},
  {id:26,capability:'explicit confirmation with valid transaction context',sample:'ข้อมูลครบแล้ว จองตามนี้เลย',turn:semantic({action:'book',speechAct:'transaction_request',informationNeed:'none'}),decision:dialog({mode:'propose_action',taskStateContainer:task,actionProposal:proposal}),expected:'execute_booking'},
  {id:27,capability:'ambiguous accommodation reference',sample:'เอาหลังนั้นแหละ',turn:semantic({action:'ask',informationNeed:'none',references:[{type:'ambiguous_stay',value:'หลังนั้น',refersToPriorContext:true}],needsClarification:true}),decision:dialog({mode:'clarify',responseIntent:'clarify_ambiguous_entity'}),expected:'respond'},
  {id:28,capability:'context-resolved accommodation reference',sample:'เอาหลังเดิมที่ดูไว้',turn:semantic({action:'confirm',speechAct:'selection',informationNeed:'none',references:[{type:'selected_stay',refersToPriorContext:true,resolvedEntityId:'stay:baan-b'}]}),decision:dialog({taskStateContainer:task}),expected:'respond'},
  {id:29,capability:'new unseen accommodation entity',sample:'บ้านสายหมอกที่เพิ่งเพิ่มล่ะ',turn:semantic({informationNeed:'amenities',entities:{accommodationName:'บ้านสายหมอก'}}),facts:[],expected:'respond'},
  {id:30,capability:'contaminated cross-type knowledge bundle',sample:'ขอเฉพาะหนึ่งห้องนอน',turn:semantic({action:'discover',informationNeed:'catalog',entities:{bedrooms:1}}),facts:catalog.filter(f=>f.key.includes('baan-a')),expected:'respond'},
];

test('PR E Stay human capability gauntlet covers all 30 classes with one execution only', () => {
  assert.equal(cases.length,30);
  let executions=0;
  for(const item of cases) {
    assert.equal(item.turn.domain,'stay',`${item.id} semantic domain`);
    const output=resolveSupervisedStayCutover(owned(item.turn,item.decision??dialog(),item.facts??catalog),'web','th');
    assert.ok(output,`${item.id}. ${item.capability}: terminal structured owner`);
    assert.equal(output!.kind,item.expected,`${item.id}. ${item.capability}`);
    if(output!.kind==='execute_booking') executions+=1;
    if(item.id===22 && output!.kind==='respond') assert.match(output!.response.message,/ไม่มีข้อมูล|ยังไม่มี/u);
    if(item.id===23 || item.id===24 || item.id===25) assert.equal(output!.kind,'respond','no false transaction escalation');
    if(item.id===30 && output!.kind==='respond') assert.doesNotMatch(output!.response.message,/บ้านชมดาว/u);
  }
  assert.equal(executions,1);
});

test('all non-transaction Stay gauntlet capabilities make zero additional provider calls', () => {
  let calls=0;
  const original=globalThis.fetch;
  globalThis.fetch=(async()=>{calls+=1;throw new Error('network forbidden after semantic success');}) as typeof fetch;
  try {
    for(const item of cases.filter(value=>value.expected==='respond')) resolveSupervisedStayCutover(owned(item.turn,item.decision??dialog(),item.facts??catalog),'line','th');
    assert.equal(calls,0);
  } finally { globalThis.fetch=original; }
});
