import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderNotConfiguredError } from '../netlify/functions/_thongthai-model-provider';
import {
  processThongthaiOneMindTurnAuthoritative,
  type OneMindDependencies,
  type OneMindTurnResult,
} from '../netlify/functions/_thongthai-one-mind-orchestrator';
import type { GuestAgentStateSnapshot } from '../netlify/functions/_guest-agent-state-store';
import type { KnowledgeSourceAdapters, SourceResult } from '../netlify/functions/_knowledge-resolver';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';

const NOW=new Date('2026-09-27T03:00:00+07:00');
const CANON='11111111-1111-4111-8111-111111111111';
const GUEST='22222222-2222-4222-8222-222222222222';

function semantic(overrides:Partial<SemanticTurn>):SemanticTurn {
  return {
    semanticSource:'openai_supervisor',domain:'general',intent:'phase6_e2e',
    action:'ask',entities:{},references:[],constraints:[],confidence:0.98,
    needsClarification:false,...overrides,
  };
}
function ok(sourceId:string,sourceType:SourceResult['sourceType'],data:Extract<SourceResult,{status:'ok'}>['data']):SourceResult {
  return {status:'ok',sourceId,sourceType,fetchedAt:NOW.toISOString(),data};
}
function fact(key:string,value:unknown,domain:'activity'|'stay'|'restaurant',sourceId:string,sourceType:'activity_live'|'stay_live'|'restaurant_live') {
  return {key,value,domain,sourceId,sourceType,authoritative:true,fetchedAt:NOW.toISOString()} as const;
}

function conversation(
  channel:'web'|'line',
  adapters:KnowledgeSourceAdapters,
  meanings:Record<string,SemanticTurn>,
) {
  let snapshot:GuestAgentStateSnapshot={exists:false,state:{},updatedAt:null};
  let offset=0;
  const deps:Partial<OneMindDependencies>={
    resolveCanonicalGuestId:async()=>CANON,
    guestDbIdFromAnonymousId:async()=>GUEST,
    interpretSemanticTurn:async message=>{
      const turn=meanings[message];
      if(!turn) throw new Error(`missing scripted semantic turn: ${message}`);
      return turn;
    },
    buildKnowledgeAdapters:()=>adapters,
    mirrorActivityTaskToLegacySession:async()=>{},
  };
  return async(message:string):Promise<OneMindTurnResult>=>{
    offset+=1;
    return processThongthaiOneMindTurnAuthoritative({
      channel,message,eventId:`${channel}-phase6-${offset}`,providerUserKey:`${channel}-key`,persistState:true,
    },deps,{
      loadSnapshot:async()=>snapshot,
      compareAndSwap:async(_id,current,patch)=>{
        const next={...current.state,...(patch.set??{})};
        for(const key of patch.removeKeys??[]) delete next[key];
        snapshot={exists:true,state:next,updatedAt:new Date(NOW.getTime()+offset*1000).toISOString()};
        return {status:'applied',snapshot};
      },
    },new Date(NOW.getTime()+offset*1000));
  };
}

test('Phase 6 E2E restaurant: browse, preferences, availability and just-asking remain non-transactional until explicit order',async()=>{
  const messages={
    'ร้านมีอะไรน่ากิน':semantic({domain:'restaurant',intent:'browse_menu',action:'discover',informationNeed:'catalog',speechAct:'question'}),
    'แม่แพ้กุ้ง แล้วไม่เผ็ดนะ':semantic({domain:'restaurant',intent:'update_diet',action:'provide_information',speechAct:'preference_update',constraints:['no_shrimp','no_spicy']}),
    'พรุ่งนี้หกโมงมีโต๊ะไหม':semantic({domain:'restaurant',intent:'ask_table_availability',action:'status',informationNeed:'availability',speechAct:'question',entities:{date:'2026-09-28',time:'18:00'}}),
    'ถามเฉย ๆ ยังไม่ได้ให้จอง':semantic({domain:'restaurant',intent:'not_booking',action:'correct_previous',speechAct:'correction',entities:{}}),
    'สั่งตำไทยหนึ่งที่ พรุ่งนี้หกโมง ชื่อสมชาย 0812345678':semantic({
      domain:'restaurant',intent:'submit_preorder',action:'order',speechAct:'transaction_request',
      entities:{items:[{name:'ตำไทย',quantity:1}],date:'2026-09-28',time:'18:00',customerName:'สมชาย',phone:'0812345678'},
    }),
  };
  const adapters:KnowledgeSourceAdapters={
    restaurant:{
      menu:async()=>ok('menu','restaurant_live',[fact('menu:tamthai:name','ตำไทย','restaurant','menu','restaurant_live'),
        fact('menu:tamthai:orderable',true,'restaurant','menu','restaurant_live'),
        fact('menu:tamthai:availableServings',10,'restaurant','menu','restaurant_live')]),
      availability:async()=>({status:'empty',sourceId:'tables',sourceType:'restaurant_live',fetchedAt:NOW.toISOString()}),
    },
  };
  const run=conversation('web',adapters,messages);
  const turns=[] as OneMindTurnResult[];
  for(const message of Object.keys(messages)) turns.push(await run(message));
  for(const turn of turns.slice(0,-1)) assert.equal(turn.dialogDecision.actionProposal,undefined);
  assert.equal(turns[1]!.taskStateAfter.activeTask,null,'preference memory is not an order task');
  assert.equal(turns[2]!.taskStateAfter.activeTask,null,'availability question is not a booking');
  assert.equal(turns[3]!.taskStateAfter.activeTask,null,'just-asking correction cannot manufacture an order task');
  const final=turns.at(-1)!;
  assert.equal(final.semanticTurn.action,'order');
  assert.deepEqual(final.taskStateAfter.activeTask?.missingFields,[],
    JSON.stringify({slots:final.taskStateAfter.activeTask?.slots,decision:final.dialogDecision}));
  assert.equal(final.taskStateAfter.activeTask?.commitmentIntent,true);
  assert.equal(final.dialogDecision.actionProposal?.toolName,'create_restaurant_preorder',
    JSON.stringify({semantic:final.semanticTurn,task:final.taskStateAfter.activeTask,decision:final.dialogDecision}));
  assert.equal(final.dialogDecision.actionProposal?.requiresExplicitConfirmation,true);
});

test('Phase 6 E2E horse: selection, side B, side C and resume preserve the exact task; booking appears only at the end',async()=>{
  const messages={
    'เอาภาราดรครับ':semantic({domain:'activity',intent:'select_horse',action:'confirm',speechAct:'selection',entities:{resourceCode:'activity-horse',horseName:'ภาราดร'}}),
    'ร้านมีอะไรกิน':semantic({domain:'restaurant',intent:'browse_menu',action:'discover',informationNeed:'catalog',speechAct:'question'}),
    'แถวนี้มีร้านขายยาไหม':semantic({domain:'local',intent:'ask_pharmacy',action:'ask',speechAct:'question'}),
    'กลับไปเรื่องม้าที่ค้างไว้':semantic({domain:'activity',intent:'resume_horse',action:'ask',speechAct:'request',taskDirective:'resume_suspended'}),
    'วันที่ 6 ตุลาคม เอา 60 นาที':semantic({domain:'activity',intent:'provide_schedule',action:'provide_information',entities:{date:'2026-10-06',durationMinutes:60}}),
    'จองเลยตอน 11 โมง สองคน':semantic({domain:'activity',intent:'book_horse',action:'book',speechAct:'transaction_request',entities:{time:'11:00',partySize:2}}),
  };
  const adapters:KnowledgeSourceAdapters={
    activity:{
      catalog:async()=>ok('activity_catalog','activity_live',[
        fact('activity:horse:resourceCode','activity-horse','activity','activity_catalog','activity_live'),
        fact('activity:horse:30min:price',300,'activity','activity_catalog','activity_live'),
        fact('activity:horse:60min:price',500,'activity','activity_catalog','activity_live'),
      ]),
      availability:async()=>ok('schedule','activity_live',[
        fact('availability:activity-horse:2026-10-06T11:00:00+07:00:available',true,'activity','schedule','activity_live'),
      ]),
    },
    restaurant:{menu:async()=>({status:'empty',sourceId:'menu',sourceType:'restaurant_live',fetchedAt:NOW.toISOString()})},
  };
  const run=conversation('line',adapters,messages);
  const selected=await run('เอาภาราดรครับ');
  const sideB=await run('ร้านมีอะไรกิน');
  const sideC=await run('แถวนี้มีร้านขายยาไหม');
  const resumed=await run('กลับไปเรื่องม้าที่ค้างไว้');
  const filled=await run('วันที่ 6 ตุลาคม เอา 60 นาที');
  const booked=await run('จองเลยตอน 11 โมง สองคน');
  assert.equal(selected.dialogDecision.actionProposal,undefined);
  assert.equal(sideB.taskStateAfter.suspendedTask?.slots.horseName,'ภาราดร');
  assert.equal(sideC.taskStateAfter.suspendedTask?.slots.horseName,'ภาราดร');
  assert.equal(resumed.taskStateAfter.activeTask?.slots.horseName,'ภาราดร');
  assert.equal(filled.taskStateAfter.activeTask?.slots.durationMinutes,60);
  assert.equal(booked.dialogDecision.actionProposal?.toolName,'create_booking');
  assert.equal(booked.dialogDecision.actionProposal?.validatedArgs.horseName,'ภาราดร');
  assert.equal(booked.dialogDecision.actionProposal?.validatedArgs.durationMinutes,60);
});

test('Phase 6 E2E stay: catalog and availability never book; selection/correction preserve state; explicit booking alone proposes',async()=>{
  const messages={
    'มีบ้านสองห้องนอนไหม':semantic({domain:'stay',intent:'browse_two_bed',action:'discover',informationNeed:'catalog',speechAct:'question'}),
    'พรุ่งนี้ว่างไหม':semantic({domain:'stay',intent:'ask_stay_availability',action:'status',informationNeed:'availability',speechAct:'question',entities:{date:'2026-09-28'}}),
    'เอาบ้านริมน้ำ วันที่ 28':semantic({domain:'stay',intent:'select_stay',action:'confirm',speechAct:'selection',entities:{resourceCode:'stay:river-house',date:'2026-09-28',endDate:'2026-09-29',partySize:2}}),
    'ไม่ใช่สองคน เปลี่ยนเป็นสามคน':semantic({domain:'stay',intent:'correct_party',action:'correct_previous',speechAct:'correction',entities:{partySize:3}}),
    'จองหลังนี้เลย':semantic({domain:'stay',intent:'book_stay',action:'book',speechAct:'transaction_request',entities:{}}),
  };
  const adapters:KnowledgeSourceAdapters={
    stay:{
      catalog:async()=>ok('stay_catalog','stay_live',[fact('stay:river-house:name','บ้านริมน้ำ','stay','stay_catalog','stay_live')]),
      availability:async()=>ok('stay_schedule','stay_live',[fact('availability:stay:river-house:2026-09-28T12:00:00+07:00:available',true,'stay','stay_schedule','stay_live')]),
    },
  };
  const run=conversation('web',adapters,messages);
  const browse=await run('มีบ้านสองห้องนอนไหม');
  const availability=await run('พรุ่งนี้ว่างไหม');
  const selected=await run('เอาบ้านริมน้ำ วันที่ 28');
  const corrected=await run('ไม่ใช่สองคน เปลี่ยนเป็นสามคน');
  const booked=await run('จองหลังนี้เลย');
  assert.equal(browse.taskStateAfter.activeTask,null);
  assert.equal(availability.taskStateAfter.activeTask,null);
  assert.equal(selected.dialogDecision.actionProposal,undefined);
  assert.equal(corrected.taskStateAfter.activeTask?.slots.partySize,3);
  assert.equal(corrected.taskStateAfter.activeTask?.slots.resourceCode,'stay:river-house');
  assert.equal(booked.dialogDecision.actionProposal?.toolName,'create_booking');
  assert.equal(booked.dialogDecision.actionProposal?.validatedArgs.partySize,3);
});

test('Phase 6 E2E open-world incident/local/general turns never create business state or proposals',async()=>{
  const cases=[
    ['น่าจะลืมกระเป๋าไว้เมื่อเช้า',semantic({domain:'incident',intent:'lost_item',action:'ask',speechAct:'incident_report'})],
    ['แถวนี้มีหมาจรเยอะปะ',semantic({domain:'local',intent:'ask_local_animals',action:'ask',speechAct:'question'})],
    ['ดาวเสาร์มีวงแหวนทำไมอะ',semantic({domain:'general',intent:'general_question',action:'ask',speechAct:'question'})],
    ['ไวไฟต่อมะติดอะ ช่วยหน่อย',semantic({domain:'support',intent:'wifi_help',action:'ask',speechAct:'request_help'})],
  ] as const;
  for(const channel of ['web','line'] as const) {
    const meanings=Object.fromEntries(cases) as Record<string,SemanticTurn>;
    const run=conversation(channel,{},meanings);
    for(const [message] of cases) {
      const result=await run(message);
      assert.equal(result.taskStateAfter.activeTask,null,`${channel}: ${message}`);
      assert.equal(result.dialogDecision.actionProposal,undefined,`${channel}: ${message}`);
    }
  }
});


test('Phase 6 metamorphic E2E: explicit restaurant-order paraphrases keep transaction intent after grounded browsing',async()=>{
  const browse='ขอดูเมนูหน่อย';
  const variants=[
    'ขอสั่งตำไทยหนึ่งจาน ส่งพรุ่งนี้หกโมง ชื่อสมชาย 0812345678',
    'สั่งตำไทย 1 ที่ พรุ่งนี้เวลา 18:00 สมชาย 0812345678',
    'ยืนยันการสั่งตำไทยหนึ่งที่ พรุ่งนี้หกโมง ลูกค้าชื่อสมชาย เบอร์ 0812345678',
  ];
  const adapters:KnowledgeSourceAdapters={
    restaurant:{menu:async()=>ok('menu','restaurant_live',[
      fact('menu:tamthai:name','ตำไทย','restaurant','menu','restaurant_live'),
        fact('menu:tamthai:orderable',true,'restaurant','menu','restaurant_live'),
        fact('menu:tamthai:availableServings',10,'restaurant','menu','restaurant_live'),
    ])},
  };
  for(const [index,message] of variants.entries()) {
    const meanings:Record<string,SemanticTurn>={
      [browse]:semantic({domain:'restaurant',intent:'browse_menu',action:'discover',informationNeed:'catalog',speechAct:'question'}),
      [message]:semantic({
        domain:'restaurant',intent:`order_paraphrase_${index}`,action:'order',speechAct:'transaction_request',
        entities:{items:[{name:'ตำไทย',quantity:1}],date:'2026-09-28',time:'18:00',customerName:'สมชาย',phone:'0812345678'},
      }),
    };
    const run=conversation(index%2===0?'web':'line',adapters,meanings);
    const browsed=await run(browse);
    const ordered=await run(message);
    assert.equal(browsed.dialogDecision.actionProposal,undefined);
    assert.equal(ordered.semanticTurn.action,'order',message);
    assert.equal(ordered.dialogDecision.actionProposal?.toolName,'create_restaurant_preorder',message);
    assert.equal(ordered.dialogDecision.actionProposal?.requiresExplicitConfirmation,true,message);
  }
});

test('Phase 6 E2E provider outage cannot mutate or advance an existing committed task',async()=>{
  let snapshot:GuestAgentStateSnapshot={exists:false,state:{},updatedAt:null};
  let offset=0;
  let outage=false;
  const first='จองขี่ม้าภาราดร วันที่ 6 ตุลาคม 60 นาที สองคน';
  const deps:Partial<OneMindDependencies>={
    resolveCanonicalGuestId:async()=>CANON,
    guestDbIdFromAnonymousId:async()=>GUEST,
    interpretSemanticTurn:async message=>{
      if(outage) throw new ProviderNotConfiguredError();
      assert.equal(message,first);
      return semantic({
        domain:'activity',intent:'book_horse',action:'book',speechAct:'transaction_request',
        entities:{resourceCode:'activity-horse',horseName:'ภาราดร',date:'2026-10-06',durationMinutes:60,partySize:2},
      });
    },
    buildKnowledgeAdapters:()=>({
      activity:{catalog:async()=>ok('activity_catalog','activity_live',[
        fact('activity:horse:resourceCode','activity-horse','activity','activity_catalog','activity_live'),
      ])},
    }),
    mirrorActivityTaskToLegacySession:async()=>{},
  };
  const run=async(message:string)=>{
    offset+=1;
    return processThongthaiOneMindTurnAuthoritative({
      channel:'web',message,eventId:`phase6-outage-${offset}`,providerUserKey:'outage-key',persistState:true,
    },deps,{
      loadSnapshot:async()=>snapshot,
      compareAndSwap:async(_id,current,patch)=>{
        const next={...current.state,...(patch.set??{})};
        for(const key of patch.removeKeys??[]) delete next[key];
        snapshot={exists:true,state:next,updatedAt:new Date(NOW.getTime()+offset*1000).toISOString()};
        return {status:'applied',snapshot};
      },
    },new Date(NOW.getTime()+offset*1000));
  };
  const started=await run(first);
  const before=structuredClone(started.taskStateAfter);
  assert.equal(before.activeTask?.commitmentIntent,true);
  outage=true;
  const failed=await run('เอ่อ เรื่องเมื่อกี้นั่นแหละ');
  assert.deepEqual(failed.taskStateAfter,before);
  assert.equal(failed.dialogDecision.actionProposal,undefined);
  assert.equal(failed.semanticTurn.semanticSource,'provider_unavailable');
});
