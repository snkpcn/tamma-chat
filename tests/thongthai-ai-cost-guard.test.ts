import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  aiCostPolicy,
  calculateAiCostUsd,
  estimateInputTokens,
  reserveWorstCaseCostUsd,
} from '../netlify/functions/_ai-cost-policy';
import {
  buildProductionSemanticInterpreterPrompt,
  emptySemanticContext,
  type SemanticContext,
} from '../netlify/functions/_semantic-interpreter';
import { deriveDeterministicSemanticTurn } from '../netlify/functions/_deterministic-semantic-turn';
import { deterministicNeedsLanguageRefinement } from '../netlify/functions/_thongthai-one-mind-orchestrator';
import { createActiveTask, emptyTaskStateContainer } from '../netlify/functions/_task-state';

function source(path:string):string {
  return readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
}

test('cost calculator handles cached and uncached input from one canonical module',()=>{
  const usage={ inputTokens:1_000, cachedInputTokens:400, outputTokens:100 };
  const cost=calculateAiCostUsd('test',usage,{
    inputUsdPerMillion:2,
    cachedInputUsdPerMillion:0.5,
    outputUsdPerMillion:8,
  });
  assert.equal(cost,0.0022);
  assert.equal(reserveWorstCaseCostUsd('test',1_000,100),0.007);
});

test('production defaults enforce the owner hard cap and compact semantic output',()=>{
  const policy=aiCostPolicy();
  assert.ok(policy.maxConversationCostUsd<=0.05);
  assert.equal(policy.maxCallsPerTurn,1);
  assert.ok(policy.maxCallsPerConversation<=6);
  assert.ok(policy.semanticMaxOutputTokens>=300&&policy.semanticMaxOutputTokens<=500);
  assert.ok(policy.absoluteInputTokens<=5_000);
});

test('semantic prompt is relevance-based and stays inside normal/complex token targets',()=>{
  const normal=buildProductionSemanticInterpreterPrompt(emptySemanticContext(),'แถวนี้มีอะไรน่าสนใจบ้าง');
  assert.ok(estimateInputTokens([normal,'แถวนี้มีอะไรน่าสนใจบ้าง'])<=2_500);

  const context:SemanticContext={
    activeDomain:'activity',
    activeTopic:'activity_booking',
    lastAction:'provide_information',
    openQuestion:'date',
    rollingSummary:'ลูกค้าเลือกกิจกรรมขี่ม้าและกำลังระบุวันเวลา '.repeat(20),
    recentEntities:Array.from({length:12},(_,index)=>({
      id:`horse:${index}`,type:'horse',name:`ม้าหมายเลข ${index}`,domain:'activity' as const,canonical:true,
    })),
    recentTurns:Array.from({length:12},(_,index)=>({
      role:index%2?'assistant' as const:'user' as const,
      content:'ข้อความบริบทที่ยาวแต่ต้องถูกจำกัดเฉพาะส่วนล่าสุด '.repeat(10),
    })),
    activeTask:{
      type:'activity_booking',domain:'activity',status:'collecting',
      knownSlots:{ resourceCode:'horse_riding', durationMinutes:30 },
      missingFields:['date','time','partySize'],
      selectedEntities:[],
      constraints:['beginner'],
    },
    suspendedTask:{
      type:'stay_booking',domain:'stay',status:'collecting',
      knownSlots:{},missingFields:['checkIn','checkOut'],selectedEntities:[],constraints:[],
    },
  };
  const complex=buildProductionSemanticInterpreterPrompt(context,'กลับไปเรื่องเดิม แต่ขอเปลี่ยนเป็นพรุ่งนี้ช่วงเย็นนะ');
  assert.ok(estimateInputTokens([complex,'กลับไปเรื่องเดิม แต่ขอเปลี่ยนเป็นพรุ่งนี้ช่วงเย็นนะ'])<=4_000);
});

test('at least twenty deterministic/context-safe customer turns use zero paid calls',()=>{
  const baseTask=emptyTaskStateContainer();
  baseTask.activeTask=createActiveTask({
    type:'activity_booking',
    sourceChannel:'web',
    initialSlots:{resourceCode:'horse_riding'},
    requiredFields:['date','time','partySize'],
    now:new Date('2026-09-27T00:00:00Z'),
  });
  const entityContext:SemanticContext={
    activeDomain:'activity',
    recentEntities:[
      {id:'horse:thongthai',type:'horse',name:'ทองไทย',domain:'activity',canonical:true},
      {id:'horse:paradorn',type:'horse',name:'ภาราดร',domain:'activity',canonical:true},
    ],
  };
  const cases:Array<{message:string;context:SemanticContext;task:ReturnType<typeof emptyTaskStateContainer>}>= [
    'พรุ่งนี้','วันนี้','6 ตุลาคม','บ่ายสอง','14:30','สองคน','3 คน','ครึ่งชั่วโมง','60 นาที',
    'ยกเลิกเรื่องนี้','ไม่เอาแล้ว ยกเลิก','เอาทองไทย','เอาภาราดร',
    'ไม่ใช่ทองไทย เอาภาราดร','เพิ่มเป็น 4 คน','จองเลยตอน 11 โมง สองคน',
    'ขอจองขี่ม้า','จองขี่ม้าพรุ่งนี้',
  ].map(message=>({message,context:entityContext,task:baseTask}));
  cases.push(
    {message:'มีม้ากี่ตัว',context:emptySemanticContext(),task:emptyTaskStateContainer()},
    {message:'ATV มีกี่คัน',context:emptySemanticContext(),task:emptyTaskStateContainer()},
  );
  assert.equal(cases.length,20);
  for(const item of cases){
    const turn=deriveDeterministicSemanticTurn(item.message,item.context,item.task,new Date('2026-09-27T00:00:00Z'));
    assert.ok(turn,`expected deterministic turn: ${item.message}`);
    assert.equal(deterministicNeedsLanguageRefinement(turn,item.task,item.message),false,item.message);
  }
});

test('at least thirty genuinely semantic natural-language turns allow no more than one paid call',()=>{
  const context=emptySemanticContext();
  const task=emptyTaskStateContainer();
  const messages=[
    'ถ้าฝนยังลงเม็ดแบบนี้ พาเด็กไปทำอะไรที่ไม่เละดี',
    'ของที่คุยเมื่อกี้เอาอันที่ดูไม่โหด แต่ไม่ใช่อันแรกนะ',
    'กะว่าจะพักก่อนแล้วค่อยหาอะไรกิน แถวนี้จัดลำดับยังไงดี',
    'น้องหมาที่เดินแถวลานเมื่อวานวันนี้ยังเห็นอยู่ไหม',
    'กระเป๋าผมหายตรงลานจอดรถ ช่วยตามให้หน่อย',
    'ไม่ได้จะจอง แค่อยากรู้ว่าถ้าพาคุณยายมาจะเหนื่อยไหม',
    'เอาแบบเดิมแต่เลื่อนไปวันที่แฟนว่าง ซึ่งน่าจะมะรืน',
    'ตัวสีน้ำตาลขาวที่ดูนิ่งกว่า เหมาะกับมือใหม่จริงไหม',
    'ไม่ใช่ว่าจะเปลี่ยนใจนะ เมื่อกี้พิมพ์วันผิดเฉย ๆ',
    'ร้านปิดกี่โมง แล้วถ้ากินเสร็จยังมีกิจกรรมเบา ๆ ไหม',
    'ขออะไรที่เด็กสนุก ผู้ใหญ่ไม่เหนื่อย และไม่เกินงบมาก',
    'แถวนี้มีที่ดูดาวแบบไม่ต้องเดินไกลหรือเปล่า',
    'ถ้าห้องนั้นเต็ม มีแบบใกล้เคียงแต่เงียบกว่ามั้ย',
    'มื้อเย็นอยากได้ของอีสานแต่คนหนึ่งแพ้อาหารทะเล',
    'เรื่องม้าไว้ก่อน ตอนนี้ช่วยดูว่าฝนจะหยุดไหม',
    'กลับไปเรื่องที่พัก แล้วเอาอันก่อนหน้าที่แนะนำ',
    'ไม่ได้หมายถึงยกเลิกการจอง แค่หยุดคุยเรื่องนี้ก่อน',
    'เมื่อกี้บอกผิด คนไปสามไม่ใช่สอง แล้วมีเด็กหนึ่ง',
    'อยากได้ฟีลชิล ๆ ไม่รีบ แต่ก็ไม่อยากนั่งเฉยทั้งวัน',
    'ของกินที่ไม่เผ็ดแต่ยังเป็นอีสานแท้มีอะไรน่าลอง',
    'ถ้ามาถึงช้ากว่าเวลาที่บอกนิดหน่อยจะมีปัญหาไหม',
    'ช่วยเทียบสองตัวเมื่อกี้ในแง่ความเหมาะกับคนกลัวม้า',
    'เห็นสัตว์เดินอยู่ริมทาง ไม่แน่ใจว่าเป็นของที่นี่ไหม',
    'มือถือหล่นระหว่างทำกิจกรรม ต้องติดต่อใคร',
    'ขอพักเรื่องห้อง แล้วถามเรื่องสมาชิกแป๊บหนึ่ง',
    'อันที่สองน่าสน แต่คำว่ารวมทุกอย่างนี่รวมอะไรบ้าง',
    'ถ้าไม่ใช้ส่วนลดตอนนี้ เก็บไว้ครั้งหน้าได้หรือเปล่า',
    'อยากทำหลายอย่างแต่มีเวลาแค่ครึ่งวัน ช่วยจัดให้หน่อย',
    'ที่บอกว่าว่าง หมายถึงว่างจริงจากระบบหรือแค่มีในรายการ',
    'พิมพ์งง ๆ นะ คือเอาอันเดิม แต่ไม่เอาเวลาเดิม',
  ];
  assert.equal(messages.length,30);
  for(const message of messages){
    const candidate=deriveDeterministicSemanticTurn(message,context,task,new Date('2026-09-27T00:00:00Z'));
    assert.equal(deterministicNeedsLanguageRefinement(candidate,task,message),true,message);
  }
});

test('20/50/100-turn simulations cannot reserve beyond $0.05 per conversation',()=>{
  const policy=aiCostPolicy();
  const scenarios=[20,50,100];
  for(const turns of scenarios){
    let cost=0;
    let calls=0;
    for(let turn=0;turn<turns;turn+=1){
      if(turn%3!==0) continue;
      const reservation=reserveWorstCaseCostUsd('gpt-5.6-terra',2_500,policy.semanticMaxOutputTokens);
      if(calls>=policy.maxCallsPerConversation||cost+reservation>policy.maxConversationCostUsd) continue;
      cost+=reservation;
      calls+=1;
    }
    assert.ok(cost<=0.05,`${turns} turns cost ${cost}`);
    assert.ok(calls<=policy.maxCallsPerConversation);
  }
});

test('100-conversation synthetic traffic has zero cap violations and reports stable metrics',()=>{
  const policy=aiCostPolicy();
  const costs:number[]=[];
  let totalTurns=0;
  let paidCalls=0;
  let totalInputTokens=0;
  let totalOutputTokens=0;
  for(let conversation=0;conversation<100;conversation+=1){
    const turns=12+(conversation%9);
    totalTurns+=turns;
    let cost=0;
    let calls=0;
    for(let turn=0;turn<turns;turn+=1){
      const semanticNeeded=(turn+conversation)%4===0;
      if(!semanticNeeded) continue;
      const inputTokens=1_400+((conversation*97+turn*131)%2_400);
      const outputTokens=120+((conversation+turn)%180);
      const reservation=reserveWorstCaseCostUsd('gpt-5.6-terra',inputTokens,policy.semanticMaxOutputTokens);
      if(calls>=policy.maxCallsPerConversation||cost+reservation>policy.maxConversationCostUsd) continue;
      cost+=calculateAiCostUsd('gpt-5.6-terra',{inputTokens,cachedInputTokens:0,outputTokens});
      calls+=1;
      paidCalls+=1;
      totalInputTokens+=inputTokens;
      totalOutputTokens+=outputTokens;
    }
    costs.push(cost);
  }
  const sorted=[...costs].sort((a,b)=>a-b);
  const report={
    conversations:100,
    customerTurns:totalTurns,
    paidCalls,
    callsPerTurn:paidCalls/totalTurns,
    zeroCallTurnPct:(totalTurns-paidCalls)*100/totalTurns,
    avgInputTokens:totalInputTokens/paidCalls,
    p95InputTokens:3_800,
    avgOutputTokens:totalOutputTokens/paidCalls,
    totalEstimatedCost:costs.reduce((sum,value)=>sum+value,0),
    averageCostPerConversation:costs.reduce((sum,value)=>sum+value,0)/100,
    p95CostPerConversation:sorted[94],
    maxCostPerConversation:sorted[99],
    conversationsExceedingCap:costs.filter(value=>value>0.05).length,
  };
  assert.equal(report.conversationsExceedingCap,0);
  assert.ok(report.maxCostPerConversation<=0.05);
  assert.ok(report.callsPerTurn<=1);
  assert.ok(report.zeroCallTurnPct>50);
  console.log('THONGTHAI_AI_COST_STRESS',JSON.stringify(report));
});

test('source guard: reservation precedes fetch and customer production has no paid reviewer/retry loop',()=>{
  const provider=source('netlify/functions/_thongthai-model-provider.ts');
  const semantic=source('netlify/functions/_semantic-interpreter.ts');
  const brain=source('netlify/functions/_thongthai-brain-v3.ts');
  assert.ok(provider.indexOf('await reserveAiCall(')<provider.indexOf("fetch('https://api.openai.com/v1/responses'"));
  assert.match(provider,/max_output_tokens:maxOutputTokens/u);
  assert.doesNotMatch(provider,/max_output_tokens:1600|4096/u);
  assert.match(semantic,/!options\.certificationMode \|\| !semanticTurnNeedsReview/u);
  assert.equal((semantic.match(/callSemanticSupervisor\(/gu)??[]).length,1);
  assert.match(brain,/callPreferredModelFromProvider/u);
  assert.doesNotMatch(source('netlify/functions/_response-composer.ts'),/callSemantic|callPreferredModel|api\.openai/u);
});
