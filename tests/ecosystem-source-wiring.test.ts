import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveKnowledge } from '../netlify/functions/_knowledge-resolver';
import { buildRealKnowledgeSourceAdapters } from '../netlify/functions/_dialog-source-adapters';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { withHarness,guestId,brainRequest } from './helpers/canonical-core-harness';
import { planDialogTurn } from '../netlify/functions/_dialog-manager';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';
import { deriveDeterministicSemanticTurn } from '../netlify/functions/_deterministic-semantic-turn';
import { emptySemanticContext } from '../netlify/functions/_semantic-interpreter';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';

test('real ecosystem identity adapter supplies stable brand/business facts without a backend or mutable claims',async()=>{
  const original=global.fetch;
  global.fetch=(async()=>{throw new Error('stable identity must not query a backend');}) as typeof fetch;
  try {
    const bundle=await resolveKnowledge({domain:'ecosystem',action:'discover',intent:'discover',entities:{},constraints:[],needs:['catalog']},buildRealKnowledgeSourceAdapters('web'));
    assert.ok(bundle.facts.some(fact=>fact.value==='ทำมา-ชาติ'));
    assert.ok(bundle.facts.some(fact=>fact.value==='ขี่ม้า'));
    assert.ok(bundle.facts.some(fact=>fact.value==='ยิงธนู'));
    assert.ok(bundle.sources.every(source=>source.status==='ok'));
    assert.ok(bundle.facts.every(fact=>fact.sourceId==='canonical_ecosystem_graph' && fact.sourceType==='bible'));
    assert.doesNotMatch(JSON.stringify(bundle.facts),/price|available|inventory|opening|closed|schedule/i);
    const schedule=await resolveKnowledge({domain:'ecosystem',action:'ask',intent:'hours',entities:{},constraints:[],needs:['schedule']},buildRealKnowledgeSourceAdapters('web'));
    assert.ok(schedule.facts.some(fact=>fact.key==='organization:regularOpeningHours'));
    assert.ok(schedule.facts.every(fact=>fact.sourceType==='organization_config'),'hours must use the owner-confirmed configuration, not Bible identity');
    const policy=await resolveKnowledge({domain:'ecosystem',action:'ask',intent:'pet_policy',entities:{policyTopic:'cats'},constraints:[],needs:['stable_policy']},buildRealKnowledgeSourceAdapters('web'));
    assert.equal(policy.facts.length,0,'the identity graph is not an approved pet policy');
    assert.ok(policy.sources.every(source=>source.status==='unavailable'));
  } finally {global.fetch=original;}
});

for(const channel of ['web','line'] as const) {
  test(`${channel}: a pet permission question after hours never becomes a business catalog or a fabricated permission`,async()=>{
    await withHarness(async harness=>{
      harness.programGeminiReply({domain:'ecosystem',intent:'pet_policy',action:'ask',informationNeed:'policy',entities:{policyTopic:'cats'},references:[],constraints:[],confidence:0.96,needsClarification:false});
      const result=await processThongthaiChatCore(brainRequest('พาแมวไปได้ไหม',guestId('pet-policy-'+channel),channel,[
        {role:'user',content:'เปิดกี่โมง ปิดวันไหนบ้าง'},
        {role:'assistant',content:'ต้องการสอบถามร้านอาหาร คาเฟ่ ที่พัก หรือกิจกรรมส่วนไหนครับ'},
      ]),'pet-policy');
      const message=String((result.payload as any).message);
      assert.match(message,/สัตว์เลี้ยง/);
      assert.match(message,/ยังไม่มีข้อมูลยืนยัน|ต้องเช็ก/);
      assert.doesNotMatch(message,/ตัวเลือกที่มีตอนนี้|•|พาเข้าได้เลย|ห้ามนำ|เข้าได้ทุกพื้นที่/);
      assert.equal(harness.modelCallCount(),1,'missing policy must not pay for a second composition');
    });
  });
}

for(const domain of ['local','general','restaurant','stay','activity','cafe'] as const) {
  test(`pet policy understood as ${domain} still answers the policy question rather than catalog or generic failure`,async()=>{
    await withHarness(async harness=>{
      harness.programGeminiReply({domain,intent:'pet_access_policy',action:'ask',informationNeed:'policy',entities:{policyTopic:'cats'},references:[],constraints:[],confidence:0.96,needsClarification:false});
      const result=await processThongthaiChatCore(brainRequest('พาแมวไปได้ไหม',guestId('pet-policy-domain-'+domain)),'pet-domain-'+domain);
      const message=String((result.payload as any).message);
      assert.match(message,/สัตว์เลี้ยง/);
      assert.match(message,/ยังไม่มีข้อมูลยืนยัน/);
      assert.doesNotMatch(message,/^ได้ครับ|ตัวเลือกที่มีตอนนี้|ตอบเรื่องนี้ให้แม่นไม่ได้|•/);
    });
  });
}

test('ecosystem questions route by the semantic facet across policy topics, not by a growing phrase list',()=>{
  for(const intent of ['pet_policy','parking_policy','outside_food_policy','photography_policy']) {
    const semanticTurn:SemanticTurn={domain:'ecosystem',intent,action:'ask',informationNeed:'policy',entities:{},references:[],constraints:[],confidence:0.95,needsClarification:false};
    const plan=planDialogTurn({semanticTurn,conversationContext:emptyConversationContextState(),taskState:emptyTaskStateContainer(),channel:'web',eventId:intent});
    assert.deepEqual(plan.knowledgeRequests[0].needs,['stable_policy'],intent);
  }
  for(const facet of ['price','availability','inventory','schedule','ingredients'] as const) {
    const semanticTurn:SemanticTurn={domain:'ecosystem',intent:'ask',action:'ask',informationNeed:facet,entities:{},references:[],constraints:[],confidence:0.95,needsClarification:false};
    const plan=planDialogTurn({semanticTurn,conversationContext:emptyConversationContextState(),taskState:emptyTaskStateContainer(),channel:'web',eventId:facet});
    assert.deepEqual(plan.knowledgeRequests[0].needs,[facet]);
  }
});

for(const channel of ['web','line'] as const) {
  test(`${channel}: model-understood ecosystem discovery has verified identity even if final model composition fails`,async()=>{
    await withHarness(async harness=>{
      harness.programGeminiReply({domain:'ecosystem',intent:'discover_activities',action:'discover',informationNeed:'catalog',entities:{},references:[],constraints:[],confidence:0.96,needsClarification:false});
      const result=await processThongthaiChatCore(brainRequest('ทำมา-ชาติคืออะไร มีอะไรให้เที่ยวบ้าง?',guestId('ecosystem-wiring-'+channel),channel),'ecosystem-wiring');
      const message=String((result.payload as any).message);
      assert.match(message,/ทำมา-ชาติ/);
      assert.match(message,/ขี่ม้า|ATV|ยิงธนู/);
      assert.match(message,/ร้าน|restaurant|ตำมา-ชาติ/);
      assert.doesNotMatch(message,/ยังเช็ก.*ไม่ได้|ยืนยันไม่ได้|ติดต่อทีมงานโดยตรง/);
    });
  });
}

test('ecosystem opening-hours question answers from owner-confirmed hours without paying for prose composition',async()=>{
  await withHarness(async harness=>{
    harness.programGeminiReply({domain:'ecosystem',intent:'ask_opening_hours_and_closed_days',action:'ask',informationNeed:'schedule',entities:{},references:[],constraints:[],confidence:0.96,needsClarification:false});
    const result=await processThongthaiChatCore(brainRequest('เปิดกี่โมง ปิดวันไหนบ้าง',guestId('ecosystem-hours-wiring')),'hours-wiring');
    const message=String((result.payload as any).message);
    assert.match(message,/เวลาเปิด|วันหยุด|ตารางเวลา/);
    assert.doesNotMatch(message,/รายการล่าสุด|ขี่ม้า|ยังไม่มีตารางเวลา/);
    assert.match(message,/ทุกวัน 06:00–18:00/);
    assert.match(message,/ไม่มีวันหยุดประจำสัปดาห์/);
    assert.equal(harness.modelCallCount(),0,'owner-confirmed regular hours require no model call');
  });
});

test('overall venue hours cannot answer an individual business unit or imply pet permission',async()=>{
  const adapters=buildRealKnowledgeSourceAdapters('web');
  const request={domain:'ecosystem' as const,action:'ask' as const,intent:'hours',entities:{businessUnit:'inthanin'},constraints:[],needs:['schedule' as const]};
  const scoped=await resolveKnowledge(request,adapters);
  assert.equal(scoped.facts.length,0);
  const restaurant=await resolveKnowledge({...request,domain:'restaurant',entities:{}},adapters);
  assert.equal(restaurant.facts.length,0);
  const identity=await resolveKnowledge({...request,entities:{},needs:['catalog']},adapters);
  assert.ok(identity.facts.some(fact=>String(fact.value).includes('กิน • เที่ยว • เล่น • พัก')));
  assert.ok(identity.facts.some(fact=>fact.value==='ตาดโตน • ชัยภูมิ'));
  assert.doesNotMatch(JSON.stringify(identity.facts),/06:00|18:00|petsAllowed/);
});

for(const domain of ['ecosystem','local','general'] as const) {
  test(`LINE hours understood as ${domain} use the same venue schedule`,async()=>{
    await withHarness(async harness=>{
      harness.programGeminiReply({domain,intent:'business_hours',action:'ask',informationNeed:'schedule',entities:{},references:[],constraints:[],confidence:0.96,needsClarification:false});
      const result=await processThongthaiChatCore(brainRequest('ขอรายละเอียดช่วงเวลาที่ให้บริการตามปกติ',guestId('hours-'+domain),'line'),'hours-'+domain);
      assert.match(String((result.payload as any).message),/ทุกวัน 06:00–18:00/);
      assert.equal(harness.modelCallCount(),1);
    });
  });
}

for (const message of ['เปิดกี่โมง ปิดวันไหนบ้าง','ทำมา-ชาติเปิดกี่โมง ปิดวันไหนบ้าง']) {
  test(`regular venue schedule works with no model response: ${message}`,async()=>{
    await withHarness(async harness=>{
      const result=await processThongthaiChatCore(brainRequest(message,guestId('hours-no-model')),'hours-no-model');
      assert.match(String((result.payload as any).message),/ทุกวัน 06:00–18:00/);
      assert.equal(harness.modelCallCount(),0);
    });
  });
}
for (const message of ['ร้านอาหารเปิดกี่โมง','อินทนิลเปิดกี่โมง','พรุ่งนี้ทำมา-ชาติเปิดกี่โมง','ทำมา-ชาติเปิดกี่โมงช่วงสงกรานต์','เปิดกี่โมง พาหมาไปได้ไหม','เปิดกี่โมง และจองโต๊ะให้หน่อย']) {
  test(`overall regular schedule cannot answer a different scope: ${message}`,()=>{
    const result=deriveDeterministicSemanticTurn(message,emptySemanticContext(),emptyTaskStateContainer());
    assert.notEqual(result?.intent,'organization_regular_hours_lookup');
  });
}
