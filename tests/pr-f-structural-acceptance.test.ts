import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyTaskStateContainer, type ActiveTask } from '../netlify/functions/_task-state';
import { computeTaskMissingFields } from '../netlify/functions/_domain-task-policy';
import { resolveRestaurantStructuredSlots } from '../netlify/functions/_dialog-manager';
import { deriveSemanticMeaning } from '../netlify/functions/_semantic-meaning';
import {
  deriveCanonicalKnowledgeScope,
  resolveCanonicalScopeAgainstFacts,
  filterFactsByCanonicalScope,
} from '../netlify/functions/_canonical-knowledge-scope';
import { renderRestaurantRecommendation } from '../netlify/functions/_human-grounded-response';
import {
  resolveRestaurantPreorderProposalArgs,
  resolveSupervisedRestaurantCutover,
} from '../netlify/functions/thongthai-chat';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';
import type { GroundedFact, KnowledgeBundle } from '../netlify/functions/_knowledge-resolver';

function semantic(overrides:Partial<SemanticTurn>={}):SemanticTurn {
  return {
    domain:'restaurant', intent:'restaurant_test', action:'ask', informationNeed:'catalog',
    entities:{}, references:[], constraints:[], confidence:.95, needsClarification:false,
    ...overrides,
  };
}
function decision(overrides:Record<string,unknown>={}) {
  return {
    mode:'answer', taskStateContainer:emptyTaskStateContainer(), knowledgeRequests:[],
    missingFields:[], responseIntent:'grounded_answer', reasons:[], ...overrides,
  } as any;
}
function result(turn:SemanticTurn, dialog=decision(), source:'openai_supervisor'|'deterministic_fallback'='openai_supervisor') {
  const owned={...turn,semanticSource:source};
  return {
    status:'legacy_required', reason:'transactional_or_task_turn',
    turn:{
      semanticTurn:owned, dialogSemanticTurn:owned, semanticMeaning:deriveSemanticMeaning(owned),
      dialogDecision:dialog, groundedKnowledge:[],
      knowledgeDegradation:{condition:'none',level:'normal',reasons:[],retryable:false},
    }, observability:{},
  } as any;
}
function active(slots:Record<string,unknown>, selectedEntities:any[]=[]):ActiveTask {
  return {
    taskId:'restaurant-1', type:'restaurant_preorder', domain:'restaurant', status:'collecting',
    slots, missingFields:[], selectedEntities, constraints:[], commitmentIntent:false,
    sourceChannel:'web', createdAt:'2026-09-27T00:00:00Z', updatedAt:'2026-09-27T00:00:00Z',
  } as ActiveTask;
}
const baseFact=(key:string,value:unknown):GroundedFact=>({
  key,value,domain:'restaurant',sourceId:'restaurant_menu_live',sourceType:'restaurant_live',
  authoritative:true,fetchedAt:'2026-09-27T00:00:00Z',
});
function bundle(facts:GroundedFact[], sources:any[]=[{need:'catalog',sourceId:'restaurant_menu_live',sourceType:'restaurant_live',status:'ok'}]):KnowledgeBundle {
  return {domain:'restaurant',sources,facts,entities:[],missing:[],warnings:[],freshness:'live'};
}
function renderer(turn:SemanticTurn,facts:GroundedFact[],sources?:any[]) {
  return renderRestaurantRecommendation({
    language:'th',semanticTurn:turn,dialogDecision:decision(),knowledgeBundles:[bundle(facts,sources)],
  });
}

test('1. supervised Restaurant terminal gate is before legacy restaurant routing and legacy LLM',()=>{
  const source=readFileSync(new URL('../netlify/functions/thongthai-chat.ts',import.meta.url),'utf8');
  const gate=source.indexOf('const supervisedRestaurant = earlyOneMind');
  const legacy=source.indexOf('const restaurantIntentClass = classifyRestaurantDietaryIntent');
  const brain=source.indexOf('firstResponse = await runThongthaiBrain');
  assert.ok(gate>0 && gate<legacy && legacy<brain);
});

test('2. supervised Restaurant cutover performs no second provider/network call',()=>{
  let calls=0; const original=globalThis.fetch;
  globalThis.fetch=(async()=>{calls+=1;throw new Error('network forbidden');}) as typeof fetch;
  try {
    assert.equal(resolveSupervisedRestaurantCutover(result(semantic()),'web','th')?.kind,'respond');
    assert.equal(calls,0);
  } finally { globalThis.fetch=original; }
});

test('3. deterministic fallback cannot compete with usable supervisor meaning',()=>{
  assert.equal(resolveSupervisedRestaurantCutover(result(semantic(),decision(),'deterministic_fallback'),'web','th'),null);
  assert.equal(resolveSupervisedRestaurantCutover(result(semantic()),'web','th')?.kind,'respond');
});

test('4. only explicit order plus customer-commit proposal may execute',()=>{
  const slots={items:[{name:'ส้มตำ',quantity:2}],date:'2026-10-10',time:'18:00',customerName:'นุ๊ก',phone:'0610169999'};
  const task=active(slots,[{id:'menu:somtum',type:'menu',name:'ส้มตำ',domain:'restaurant',canonical:true}]);
  task.commitmentIntent=true; task.status='ready'; task.missingFields=[];
  const container={...emptyTaskStateContainer(),activeTask:task};
  const proposal={toolName:'create_restaurant_preorder',validatedArgs:slots,requiresExplicitConfirmation:true,customerCommitPresent:true,idempotencyKey:'restaurant-1'};
  const selection=resolveSupervisedRestaurantCutover(result(
    semantic({action:'confirm',speechAct:'selection',informationNeed:'none'}),
    decision({taskStateContainer:container,actionProposal:proposal}),
  ),'web','th');
  assert.equal(selection?.kind,'respond');

  const committed=resolveSupervisedRestaurantCutover(result(
    semantic({action:'order',speechAct:'transaction_request',informationNeed:'none'}),
    decision({mode:'propose_action',taskStateContainer:container,actionProposal:proposal}),
  ),'web','th');
  assert.equal(committed?.kind,'execute_preorder');
});

test('5. Restaurant executor boundary is structured-only and proposal sanitizer drops invalid lines',()=>{
  assert.equal(resolveRestaurantPreorderProposalArgs.length,1);
  const args=resolveRestaurantPreorderProposalArgs({validatedArgs:{
    items:[{name:'ส้มตำ',quantity:2},{name:'ลาบ',quantity:0},{name:'',quantity:1}],
    date:'2026-10-10',time:'18:00',customerName:' นุ๊ก ',phone:' 0610169999 ',
  }});
  assert.deepEqual(args.items,[{name:'ส้มตำ',quantity:2}]);
  assert.equal(args.customerName,'นุ๊ก');
  const source=readFileSync(new URL('../netlify/functions/thongthai-chat.ts',import.meta.url),'utf8');
  const start=source.indexOf('async function executeDeterministicRestaurantPreorder');
  const end=source.indexOf('async function executeDeterministicStayBooking',start);
  const executable=source.slice(start,end).replace(/\/\/.*$/gmu,'');
  assert.doesNotMatch(executable,/request\.message|parseRestaurantPreorderTurn|restaurantMenuAdvice|classifyRestaurant/u);
});

test('6. restaurant preorder policy requires explicit structured items and quantity',()=>{
  const common={date:'2026-10-10',time:'18:00',customerName:'นุ๊ก',phone:'0610169999'};
  assert.ok(computeTaskMissingFields(active(common)).includes('items'));
  assert.ok(computeTaskMissingFields(active({...common,items:[{name:'ส้มตำ'}]})).includes('items'));
  assert.ok(!computeTaskMissingFields(active({...common,items:[{name:'ส้มตำ',quantity:1}]})).includes('items'));
});

test('7. structured slot resolver never invents quantity',()=>{
  const selected=[{id:'menu:somtum',type:'menu',name:'ส้มตำ',domain:'restaurant',canonical:true}];
  assert.deepEqual(resolveRestaurantStructuredSlots(active({},selected)),{});
  assert.deepEqual(resolveRestaurantStructuredSlots(active({quantity:2},selected)),{items:[{name:'ส้มตำ',quantity:2}]});
  assert.deepEqual(resolveRestaurantStructuredSlots(active({itemName:'ลาบ',quantity:3})),{items:[{name:'ลาบ',quantity:3}]});
});

test('8. focused Restaurant scope resolves exact menu item and filters sibling menu facts',()=>{
  const turn=semantic({informationNeed:'price',entities:{itemName:'ส้มตำ'}});
  const initial=deriveCanonicalKnowledgeScope(deriveSemanticMeaning(turn));
  assert.equal(initial.status,'ambiguous');
  const facts=[
    baseFact('menu:a:name','ส้มตำ'),baseFact('menu:a:category','ส้มตำ'),
    baseFact('menu:a:price',80),baseFact('menu:b:name','ลาบ'),baseFact('menu:b:category','ลาบ'),
    baseFact('menu:b:price',120),
  ];
  const resolved=resolveCanonicalScopeAgainstFacts(initial,facts);
  assert.equal(resolved.status,'resolved');
  assert.deepEqual(resolved.canonicalEntityIds,['menu:a']);
  const filtered=filterFactsByCanonicalScope(facts,resolved);
  assert.ok(filtered.some(f=>f.key==='menu:a:price'));
  assert.ok(!filtered.some(f=>f.key==='menu:b:price'));
});

test('9. unresolved focused Restaurant scope fails closed instead of leaking sibling menu facts',()=>{
  const turn=semantic({informationNeed:'ingredients',entities:{itemName:'เมนูที่ไม่มีจริง'}});
  const initial=deriveCanonicalKnowledgeScope(deriveSemanticMeaning(turn));
  const facts=[baseFact('menu:a:name','ส้มตำ'),baseFact('menu:a:ingredients',['มะละกอ'])];
  const resolved=resolveCanonicalScopeAgainstFacts(initial,facts);
  assert.equal(resolved.status,'unresolved');
  assert.deepEqual(filterFactsByCanonicalScope(facts,resolved),[]);
});

test('10. catalog renderer shows only verified orderable menu rows',()=>{
  const facts=[
    baseFact('menu:a:name','ส้มตำ'),baseFact('menu:a:price',80),baseFact('menu:a:orderable',true),
    baseFact('menu:b:name','ลาบ'),baseFact('menu:b:price',120),baseFact('menu:b:orderable',false),
  ];
  const out=renderer(semantic({action:'discover',informationNeed:'catalog'}),facts);
  assert.ok(out); assert.match(out!.message,/ส้มตำ/u); assert.doesNotMatch(out!.message,/ลาบ/u);
});

test('11. ingredients renderer never substitutes a sibling item',()=>{
  const facts=[
    baseFact('menu:a:name','ส้มตำ'),baseFact('menu:a:ingredients',['มะละกอ','พริก']),
  ];
  const out=renderer(semantic({action:'ask',informationNeed:'ingredients',entities:{itemName:'ส้มตำ'}}),facts);
  assert.ok(out); assert.match(out!.message,/มะละกอ/u);
});

test('12. allergy recommendation excludes shrimp and unverified-ingredient rows',()=>{
  const facts=[
    baseFact('menu:a:name','ส้มตำไทย'),baseFact('menu:a:price',80),baseFact('menu:a:orderable',true),baseFact('menu:a:availableServings',5),baseFact('menu:a:ingredients',['มะละกอ']),
    baseFact('menu:b:name','ยำกุ้ง'),baseFact('menu:b:price',160),baseFact('menu:b:orderable',true),baseFact('menu:b:availableServings',5),baseFact('menu:b:ingredients',['กุ้ง']),
    baseFact('menu:c:name','เมนูลึกลับ'),baseFact('menu:c:price',90),baseFact('menu:c:orderable',true),baseFact('menu:c:availableServings',5),
  ];
  const out=renderer(semantic({action:'recommend',informationNeed:'recommendation',constraints:['shrimp_allergy']}),facts);
  assert.ok(out); assert.match(out!.message,/ส้มตำไทย/u); assert.doesNotMatch(out!.message,/ยำกุ้ง|เมนูลึกลับ/u);
});

test('13. recommendation excludes orderable=false and zero-serving rows',()=>{
  const facts=[
    baseFact('menu:a:name','พร้อมขาย'),baseFact('menu:a:price',100),baseFact('menu:a:orderable',true),baseFact('menu:a:availableServings',2),
    baseFact('menu:b:name','ปิดขาย'),baseFact('menu:b:price',100),baseFact('menu:b:orderable',false),baseFact('menu:b:availableServings',9),
    baseFact('menu:c:name','หมด'),baseFact('menu:c:price',100),baseFact('menu:c:orderable',true),baseFact('menu:c:availableServings',0),
  ];
  const out=renderer(semantic({action:'recommend',informationNeed:'recommendation'}),facts);
  assert.ok(out); assert.match(out!.message,/พร้อมขาย/u); assert.doesNotMatch(out!.message,/ปิดขาย|หมด/u);
});

test('14. table availability with no live source answers unknown, never guesses full/free',()=>{
  const out=renderer(
    semantic({action:'ask',informationNeed:'availability'}),
    [],
    [{need:'availability',sourceId:'restaurant_availability',sourceType:'restaurant_live',status:'unavailable',reason:'no_source_registered'}],
  );
  assert.ok(out); assert.match(out!.message,/ยังไม่มีข้อมูลโต๊ะว่างแบบสด/u); assert.match(out!.message,/ไม่ขอเดา/u);
});

test('15. adapter structurally exposes the live fields Restaurant rendering depends on',()=>{
  const source=readFileSync(new URL('../netlify/functions/_dialog-source-adapters.ts',import.meta.url),'utf8');
  for(const marker of ['ingredient_names','available_servings','is_orderable','category_name','source_updated_at']) assert.match(source,new RegExp(marker));
});

test('16. newly-created Restaurant planning state is no longer forced back to legacy advisor',()=>{
  const source=readFileSync(new URL('../netlify/functions/_thongthai-one-mind-response.ts',import.meta.url),'utf8');
  assert.doesNotMatch(source,/newly-created restaurant preorder[\s\S]{0,500}eligible:false/u);
  assert.match(source,/Restaurant now owns its bounded preorder planning/u);
});
