import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  composeGroundedDeterministicResponse,
  type ResponseComposerInput,
} from '../netlify/functions/_response-composer';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';
import type { DialogDecision } from '../netlify/functions/_dialog-manager';
import type { GroundedFact, KnowledgeBundle, KnowledgeNeed } from '../netlify/functions/_knowledge-resolver';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';

const NOW = '2026-09-29T08:00:00.000Z';

function fact(key:string, value:unknown, domain:'restaurant'|'activity'):GroundedFact {
  return {
    key,
    value,
    domain,
    sourceId:domain === 'restaurant' ? 'restaurant_menu_live' : 'activity_catalog_live',
    sourceType:domain === 'restaurant' ? 'restaurant_live' : 'activity_live',
    authoritative:true,
    fetchedAt:NOW,
    updatedAt:NOW,
  };
}

function bundle(domain:'restaurant'|'activity', facts:GroundedFact[], needs:KnowledgeNeed[]=['catalog']):KnowledgeBundle {
  return {
    domain,
    sources:needs.map(need=>({
      need,
      sourceId:domain === 'restaurant' ? 'restaurant_menu_live' : 'activity_catalog_live',
      sourceType:domain === 'restaurant' ? 'restaurant_live' : 'activity_live',
      status:'ok',
    })),
    facts,
    entities:[],
    missing:[],
    warnings:[],
    freshness:'live',
  };
}

function turn(overrides:Partial<SemanticTurn>):SemanticTurn {
  return {
    semanticSource:'openai_supervisor',
    normalizedMeaning:'',
    speechAct:'question',
    domain:'restaurant',
    intent:'ask',
    action:'ask',
    informationNeed:'catalog',
    entities:{},
    references:[],
    constraints:[],
    confidence:0.9,
    needsClarification:false,
    ...overrides,
  } as SemanticTurn;
}

function decision(domain:'restaurant'|'activity', needs:KnowledgeNeed[], entities:Record<string,unknown>={}):DialogDecision {
  return {
    mode:'query_knowledge',
    taskStateContainer:emptyTaskStateContainer(),
    knowledgeRequests:[{ domain, intent:'ask', action:'ask', entities, constraints:[], needs }],
    missingFields:[],
    responseIntent:'answer',
    reasons:[],
  };
}

function input(args:{
  channel?:'web'|'line';
  message:string;
  semanticTurn:SemanticTurn;
  domain:'restaurant'|'activity';
  needs?:KnowledgeNeed[];
  facts:GroundedFact[];
  entities?:Record<string,unknown>;
}):ResponseComposerInput {
  return {
    channel:args.channel ?? 'line',
    language:'th',
    userMessage:args.message,
    semanticTurn:args.semanticTurn,
    dialogDecision:decision(args.domain,args.needs ?? ['catalog'],args.entities ?? args.semanticTurn.entities),
    knowledgeBundles:[bundle(args.domain,args.facts,args.needs ?? ['catalog'])],
    degradation:{
      version:'test',
      condition:'none',
      level:'none',
      reasonCodes:[],
      retryable:false,
      safeToExecuteTransaction:false,
      sourceStates:[],
    },
    allowModelComposition:false,
  };
}

function menuFacts():GroundedFact[] {
  const rows = [
    { id:'tam-lao', name:'ตำลาว', price:79, shrimp:'does_not_contain', chili:true, ingredients:['มะละกอ','น้ำปลาร้า','พริก'] },
    { id:'tam-thai', name:'ตำไทย', price:89, shrimp:'contains', chili:true, ingredients:['มะละกอ','กุ้งแห้ง','ถั่ว'] },
    { id:'tam-cucumber', name:'ตำแตง', price:79, shrimp:'does_not_contain', chili:true, ingredients:['แตง','พริก'] },
    { id:'fried-fish', name:'ปลาช่อนทอดสมุนไพร', price:169, shrimp:'does_not_contain', chili:null, ingredients:['ปลาช่อน','สมุนไพร'] },
    { id:'unknown-soup', name:'แกงบ้าน', price:120, shrimp:'unknown', chili:null, ingredients:['ผัก'] },
  ] as const;
  return rows.flatMap(row=>[
    fact(`menu:${row.id}:name`, row.name, 'restaurant'),
    fact(`menu:${row.id}:price`, row.price, 'restaurant'),
    fact(`menu:${row.id}:orderable`, true, 'restaurant'),
    fact(`menu:${row.id}:availableServings`, 10, 'restaurant'),
    fact(`menu:${row.id}:ingredients`, row.ingredients, 'restaurant'),
    fact(`menu:${row.id}:allergen:shrimp`, row.shrimp, 'restaurant'),
    fact(`menu:${row.id}:safety:crossContaminationRisk`, 'unknown', 'restaurant'),
    fact(`menu:${row.id}:customization:canRemoveChili`, row.chili, 'restaurant'),
    fact(`menu:${row.id}:customization:spiceAdjustable`, row.chili !== false, 'restaurant'),
  ]);
}

function activityFacts():GroundedFact[] {
  return [
    fact('activity:horse:name','ขี่ม้า','activity'),
    fact('activity:horse:30min:price',300,'activity'),
    fact('activity:horse:45min:price',500,'activity'),
    fact('activity:pedal_boat:name','ปั่นเรือเป็ดน้ำ','activity'),
    fact('activity:pedal_boat:30min:price',50,'activity'),
    fact('activity:pedal_boat:60min:price',100,'activity'),
    fact('activity:pedal_boat:inventoryTotal',2,'activity'),
  ];
}

function assertNoRawDump(message:string):void {
  assert.doesNotMatch(message,/canRemoveChili|allergens|may_contain|cross_contamination_risk|service_resources|activity_offerings|\{|\}/u);
  assert.doesNotMatch(message,/จากข้อมูลที่ยืนยัน|field|restaurant_menu_intelligence_profiles/u);
}

test('Phase 5 allergy recommendation is concise and not an ingredient dump', () => {
  const response = composeGroundedDeterministicResponse(input({
    message:'แฟนแพ้กุ้ง มีอะไรกินได้บ้าง',
    domain:'restaurant',
    needs:['catalog','ingredients'],
    facts:menuFacts(),
    semanticTurn:turn({
      domain:'restaurant',
      action:'recommend',
      informationNeed:'ingredients',
      constraints:['shrimp_allergy'],
    }),
  }));
  assert.ok(response);
  assert.match(response!.message,/ตำลาว|ตำแตง|ปลาช่อนทอด/u);
  assert.match(response!.message,/แพ้รุนแรง|ครัวร่วม/u);
  assert.doesNotMatch(response!.message,/มะละกอ|กุ้งแห้ง/u);
  assertNoRawDump(response!.message);
});

test('Phase 5 specific shrimp allergy question warns instead of listing ingredients', () => {
  const response = composeGroundedDeterministicResponse(input({
    message:'แพ้กุ้ง ตำไทยกินได้ไหม',
    domain:'restaurant',
    needs:['catalog','ingredients'],
    facts:menuFacts(),
    entities:{ itemName:'ตำไทย' },
    semanticTurn:turn({
      domain:'restaurant',
      action:'ask',
      informationNeed:'ingredients',
      entities:{ itemName:'ตำไทย' },
      constraints:['shrimp_allergy'],
    }),
  }));
  assert.ok(response);
  assert.match(response!.message,/ไม่แนะนำ|มี กุ้ง|มีกุ้ง/u);
  assert.doesNotMatch(response!.message,/กุ้งแห้ง,|มะละกอ/u);
  assertNoRawDump(response!.message);
});

test('Phase 5 spicy customization uses canRemoveChili separate from recipe ingredients', () => {
  const can = composeGroundedDeterministicResponse(input({
    message:'ตำลาวไม่ใส่พริกได้ไหม',
    domain:'restaurant',
    needs:['catalog'],
    facts:menuFacts(),
    entities:{ itemName:'ตำลาว' },
    semanticTurn:turn({
      domain:'restaurant',
      action:'ask',
      informationNeed:'suitability',
      entities:{ itemName:'ตำลาว' },
      constraints:['no_spicy'],
    }),
  }));
  assert.ok(can);
  assert.match(can!.message,/ไม่ใส่พริกได้/u);
  assert.doesNotMatch(can!.message,/สูตรมีพริก|ส่วนผสม/u);
  assertNoRawDump(can!.message);

  const facts = menuFacts().map(item => item.key === 'menu:tam-lao:customization:canRemoveChili'
    ? { ...item, value:false }
    : item);
  const cannot = composeGroundedDeterministicResponse(input({
    message:'ตำลาวไม่ใส่พริกได้ไหม',
    domain:'restaurant',
    needs:['catalog'],
    facts,
    entities:{ itemName:'ตำลาว' },
    semanticTurn:turn({
      domain:'restaurant',
      action:'ask',
      informationNeed:'suitability',
      entities:{ itemName:'ตำลาว' },
      constraints:['no_spicy'],
    }),
  }));
  assert.ok(cannot);
  assert.match(cannot!.message,/ยังไม่ได้เปิดให้ทำแบบไม่ใส่พริก|ไม่ได้เปิด/u);
  assert.doesNotMatch(cannot!.message,/สูตรมีพริก|ส่วนผสม/u);
});

test('Phase 5 low-spice recommendation gives a small useful set', () => {
  const response = composeGroundedDeterministicResponse(input({
    message:'ไม่กินเผ็ดเลย มีอะไรแนะนำบ้าง',
    domain:'restaurant',
    needs:['catalog'],
    facts:menuFacts(),
    semanticTurn:turn({
      domain:'restaurant',
      action:'recommend',
      informationNeed:'recommendation',
      constraints:['no_spicy'],
    }),
  }));
  assert.ok(response);
  assert.match(response!.message,/ตำลาว|ตำแตง/u);
  assert.doesNotMatch(response!.message,/แกงบ้าน/u);
  assertNoRawDump(response!.message);
  assert.ok(response!.message.split('\n').length <= 5);
});

test('Phase 5 activity price answers are concise and data-backed', () => {
  const horse = composeGroundedDeterministicResponse(input({
    message:'ขี่ม้ากี่บาท',
    domain:'activity',
    needs:['catalog','price'],
    facts:activityFacts(),
    entities:{ activityCode:'horse' },
    semanticTurn:turn({
      domain:'activity',
      action:'ask',
      informationNeed:'price',
      entities:{ activityCode:'horse' },
    }),
  }));
  assert.ok(horse);
  assert.match(horse!.message,/30 นาที 300 บาท/u);
  assert.match(horse!.message,/45 นาที 500 บาท/u);
  assertNoRawDump(horse!.message);

  const pedal = composeGroundedDeterministicResponse(input({
    message:'เป็ดน้ำเท่าไหร่',
    domain:'activity',
    needs:['catalog','price','inventory'],
    facts:activityFacts(),
    semanticTurn:turn({
      domain:'activity',
      action:'ask',
      informationNeed:'price',
      entities:{ activityCode:'pedal_boat' },
    }),
  }));
  assert.ok(pedal);
  assert.match(pedal!.message,/30 นาที 50 บาท/u);
  assert.match(pedal!.message,/1 ชั่วโมง 100 บาท/u);
  assert.match(pedal!.message,/เรือเป็ด 2 ลำ/u);
  assert.doesNotMatch(pedal!.message,/เป็ด 2 ตัว/u);
  assertNoRawDump(pedal!.message);
});

test('Phase 5 web and LINE share final response behavior without model calls', () => {
  const base = {
    message:'เป็ดน้ำเท่าไหร่',
    domain:'activity' as const,
    needs:['catalog','price','inventory'] as KnowledgeNeed[],
    facts:activityFacts(),
    semanticTurn:turn({
      domain:'activity',
      action:'ask',
      informationNeed:'price',
      entities:{ activityCode:'pedal_boat' },
    }),
  };
  const web = composeGroundedDeterministicResponse(input({ ...base, channel:'web' }));
  const line = composeGroundedDeterministicResponse(input({ ...base, channel:'line' }));
  assert.ok(web);
  assert.ok(line);
  assert.equal(web!.mode, 'deterministic');
  assert.equal(line!.mode, 'deterministic');
  assert.equal(web!.message, line!.message);
});

test('Phase 5 unknown facts are natural and do not expose internals', () => {
  const response = composeGroundedDeterministicResponse(input({
    message:'มีบริการรับส่งสนามบินไหม',
    domain:'activity',
    needs:['catalog'],
    facts:[],
    semanticTurn:turn({
      domain:'activity',
      action:'ask',
      informationNeed:'policy',
      entities:{ serviceName:'บริการรับส่งสนามบิน' },
    }),
  }));
  assert.equal(response, null);
});
