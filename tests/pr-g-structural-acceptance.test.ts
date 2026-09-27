import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyTaskStateContainer, type ActiveTask } from '../netlify/functions/_task-state';
import { computeTaskMissingFields } from '../netlify/functions/_domain-task-policy';
import {
  resolveDialogDecision,
  resolvePromotionStructuredSlots,
  type DialogPlan,
} from '../netlify/functions/_dialog-manager';
import { deriveSemanticMeaning } from '../netlify/functions/_semantic-meaning';
import {
  deriveCanonicalKnowledgeScope,
  resolveCanonicalScopeAgainstFacts,
  filterFactsByCanonicalScope,
} from '../netlify/functions/_canonical-knowledge-scope';
import { renderPromotionRecommendation } from '../netlify/functions/_human-grounded-response';
import {
  resolvePromotionRedemptionProposalArgs,
  resolveSupervisedPromotionCutover,
} from '../netlify/functions/thongthai-chat';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';
import type { GroundedFact, KnowledgeBundle } from '../netlify/functions/_knowledge-resolver';

function semantic(overrides:Partial<SemanticTurn>={}):SemanticTurn {
  return {
    domain:'promotion',intent:'promotion_test',action:'ask',informationNeed:'catalog',
    entities:{},references:[],constraints:[],confidence:.96,needsClarification:false,
    ...overrides,
  };
}
function active(slots:Record<string,unknown>, selectedEntities:any[]=[]):ActiveTask {
  return {
    taskId:'promo-task-1',type:'promotion_redemption',domain:'promotion',status:'collecting',
    slots,missingFields:[],selectedEntities,constraints:[],commitmentIntent:false,
    sourceChannel:'web',createdAt:'2026-09-28T00:00:00Z',updatedAt:'2026-09-28T00:00:00Z',
  } as ActiveTask;
}
function decision(overrides:Record<string,unknown>={}) {
  return {
    mode:'answer',taskStateContainer:emptyTaskStateContainer(),knowledgeRequests:[],
    missingFields:[],responseIntent:'grounded_answer',reasons:[],...overrides,
  } as any;
}
function oneMind(
  turn:SemanticTurn,
  dialog=decision(),
  source:'openai_supervisor'|'deterministic_fallback'='openai_supervisor',
  bundles:KnowledgeBundle[]=[],
) {
  const owned={...turn,semanticSource:source};
  return {
    status:'legacy_required',reason:'transactional_or_task_turn',
    turn:{
      semanticTurn:owned,dialogSemanticTurn:owned,semanticMeaning:deriveSemanticMeaning(owned),
      dialogDecision:dialog,groundedKnowledge:bundles,
      knowledgeDegradation:{condition:'none',level:'normal',reasons:[],retryable:false},
    },
    observability:{},
  } as any;
}
const fact=(key:string,value:unknown):GroundedFact=>({
  key,value,domain:'promotion',sourceId:'promotions_active',sourceType:'promotion_runtime',
  authoritative:true,fetchedAt:'2026-09-28T00:00:00Z',
});
function bundle(
  rows:GroundedFact[],
  status:'ok'|'empty'|'unavailable'='ok',
):KnowledgeBundle {
  return {
    domain:'promotion',
    sources:[{need:'promotion_eligibility',sourceId:'promotions_active',sourceType:'promotion_runtime',status}],
    facts:rows,entities:[],missing:[],warnings:[],freshness:'live',
  } as KnowledgeBundle;
}
function livePromo(id='p1',name='โปรกินข้าวลด 10%',eligible=true):GroundedFact[] {
  return [
    fact(`promo:${id}:name`,name),
    fact(`promo:${id}:campaignCode`,`PROMO-${id}`),
    fact(`promo:${id}:promoTotal`,99),
    fact(`promo:${id}:normalTotal`,110),
    fact(`promo:${id}:requiresDateTime`,false),
    fact(`promo:${id}:requiresMembership`,false),
    fact(`promo:${id}:eligible`,eligible),
  ];
}

test('1. supervised Promotion terminal gate precedes legacy continuation/discovery and legacy LLM',()=>{
  const source=readFileSync(new URL('../netlify/functions/thongthai-chat.ts',import.meta.url),'utf8');
  const gate=source.indexOf('const supervisedPromotion=earlyOneMind');
  const continuation=source.indexOf('const promotionContinuation = await promotionContinuationResponse');
  const discovery=source.indexOf('const promotionDiscovery = await promotionDiscoveryFallbackResponse');
  const brain=source.indexOf('firstResponse = await runThongthaiBrain');
  assert.ok(gate>0 && gate<continuation && continuation<discovery && discovery<brain);
});

test('2. supervised Promotion cutover performs no provider/network call',()=>{
  let calls=0;
  const original=globalThis.fetch;
  globalThis.fetch=(async()=>{calls+=1;throw new Error('network forbidden');}) as typeof fetch;
  try {
    assert.equal(resolveSupervisedPromotionCutover(oneMind(semantic()),'web','th')?.kind,'respond');
    assert.equal(calls,0);
  } finally { globalThis.fetch=original; }
});

test('3. provider-outage/deterministic Promotion remains fallback-only',()=>{
  assert.equal(resolveSupervisedPromotionCutover(
    oneMind(semantic(),decision(),'deterministic_fallback'),'web','th',
  ),null);
});

test('4. selecting a Promotion is planning, never redemption even if task/proposal exist',()=>{
  const slots={campaignId:'p1',promotionName:'โปรกินข้าวลด 10%',requiresDateTime:false,customerName:'นุ๊ก'};
  const task=active(slots,[{id:'promo:p1',type:'promo',name:'โปรกินข้าวลด 10%',domain:'promotion',canonical:true}]);
  task.status='ready'; task.commitmentIntent=true;
  const container={...emptyTaskStateContainer(),activeTask:task};
  const proposal={
    toolName:'redeem_promotion',validatedArgs:slots,requiresExplicitConfirmation:true,
    customerCommitPresent:true,idempotencyKey:task.taskId,
  };
  const selected=resolveSupervisedPromotionCutover(oneMind(
    semantic({action:'confirm',speechAct:'selection',informationNeed:'none',entities:{promotionName:'โปรกินข้าวลด 10%'}}),
    decision({mode:'propose_action',taskStateContainer:container,actionProposal:proposal}),
  ),'web','th');
  assert.equal(selected?.kind,'respond');
});

test('5. only explicit supervised redemption proposal may execute',()=>{
  const slots={campaignId:'p1',campaignCode:'PROMO-p1',title:'โปรกินข้าวลด 10%',requiresDateTime:false,customerName:'นุ๊ก'};
  const task=active(slots);
  task.status='ready'; task.commitmentIntent=true;
  const container={...emptyTaskStateContainer(),activeTask:task};
  const proposal={
    toolName:'redeem_promotion',validatedArgs:slots,requiresExplicitConfirmation:true,
    customerCommitPresent:true,idempotencyKey:task.taskId,
  };
  const committed=resolveSupervisedPromotionCutover(oneMind(
    semantic({action:'order',speechAct:'transaction_request',informationNeed:'none',entities:{campaignId:'p1'}}),
    decision({mode:'propose_action',taskStateContainer:container,actionProposal:proposal}),
  ),'web','th');
  assert.equal(committed?.kind,'execute_redemption');
});

test('6. redemption proposal args are structured-only and normalized',()=>{
  const args=resolvePromotionRedemptionProposalArgs({validatedArgs:{
    campaignId:' promo:p1 ',campaignCode:' PROMO-p1 ',title:' โปรกินข้าวลด 10% ',
    requiresDateTime:false,customerName:' นุ๊ก ',phone:' 0610169999 ',
  }});
  assert.equal(args.campaignId,'p1');
  assert.equal(args.campaignCode,'PROMO-p1');
  assert.equal(args.title,'โปรกินข้าวลด 10%');
  assert.equal(args.customerName,'นุ๊ก');
  assert.equal(args.phone,'0610169999');
});

test('7. Promotion executor never parses request.message or uses legacy raw-text promotion matchers',()=>{
  const source=readFileSync(new URL('../netlify/functions/thongthai-chat.ts',import.meta.url),'utf8');
  const start=source.indexOf('async function executeDeterministicPromotionRedemption');
  const end=source.indexOf('async function executeDeterministicStayBooking',start);
  assert.ok(start>0&&end>start);
  const body=source.slice(start,end).replace(/\/\/.*$/gmu,'');
  assert.doesNotMatch(body,/request\.message|parseRestaurantPreorderTurn|decidePromotionFallback|matchPromotionByText|isPromotionAcceptIntent/u);
});

test('8. promotion task requires verified campaign identity plus business-required fields',()=>{
  assert.ok(computeTaskMissingFields(active({customerName:'นุ๊ก',requiresDateTime:false})).includes('campaignId'));
  assert.deepEqual(computeTaskMissingFields(active({
    campaignId:'p1',customerName:'นุ๊ก',requiresDateTime:false,
  })),[]);
  const dateRequired=computeTaskMissingFields(active({
    campaignId:'p1',customerName:'นุ๊ก',requiresDateTime:true,
  }));
  assert.ok(dateRequired.includes('date'));
  assert.ok(dateRequired.includes('time'));
});

test('9. structured Promotion policy resolves one verified eligible campaign and copies canonical live facts',()=>{
  const task=active({promotionName:'โปรกินข้าวลด 10%',customerName:'นุ๊ก'});
  const patch=resolvePromotionStructuredSlots(task,[bundle(livePromo())]);
  assert.equal(patch.campaignId,'p1');
  assert.equal(patch.campaignCode,'PROMO-p1');
  assert.equal(patch.promotionName,'โปรกินข้าวลด 10%');
  assert.equal(patch.promoTotal,99);
  assert.equal(patch.requiresDateTime,false);
});

test('10. structured Promotion policy fails closed for unverified, ineligible, or ambiguous identity',()=>{
  assert.deepEqual(resolvePromotionStructuredSlots(
    active({promotionName:'ไม่มีโปรนี้'}),[bundle(livePromo())],
  ),{});
  const duplicate=[...livePromo('p1','โปรเดียวกัน'),...livePromo('p2','โปรเดียวกัน')];
  assert.deepEqual(resolvePromotionStructuredSlots(
    active({promotionName:'โปรเดียวกัน'}),[bundle(duplicate)],
  ),{});
  assert.deepEqual(resolvePromotionStructuredSlots(
    active({campaignId:'p1'}),[bundle(livePromo('p1','โปรหนึ่ง',false))],
  ),{});
});

test('11. Dialog Decision cannot propose redemption from campaignId alone without live eligible proof',()=>{
  const task=active({campaignId:'p1',customerName:'นุ๊ก',requiresDateTime:false});
  task.commitmentIntent=true; task.status='ready'; task.missingFields=[];
  const state={...emptyTaskStateContainer(),activeTask:task};
  const plan:DialogPlan={
    taskStateContainer:state,
    knowledgeRequests:[{domain:'promotion',intent:'redeem',action:'order',entities:{campaignId:'p1'},constraints:[],needs:['promotion_eligibility']} as any],
    mode:'query_knowledge',reasons:['explicit_commit_received'] as any,
    missingFields:[],customerCommitPresent:true,action:'order',compareEntityIds:[],
  };
  const withoutProof=resolveDialogDecision(plan,[bundle([])]);
  assert.equal(withoutProof.actionProposal,undefined);
  assert.ok(withoutProof.reasons.includes('knowledge_unverified' as any));

  const withProof=resolveDialogDecision(plan,[bundle(livePromo())]);
  assert.equal(withProof.actionProposal?.toolName,'redeem_promotion');
  assert.equal(withProof.actionProposal?.customerCommitPresent,true);
});

test('12. focused Promotion scope resolves exact live name and filters sibling campaign facts',()=>{
  const initial=deriveCanonicalKnowledgeScope(deriveSemanticMeaning(
    semantic({action:'ask',informationNeed:'price',entities:{promotionName:'โปรหนึ่ง'}}),
  ));
  assert.equal(initial.status,'ambiguous');
  const facts=[...livePromo('p1','โปรหนึ่ง'),...livePromo('p2','โปรสอง')];
  const resolved=resolveCanonicalScopeAgainstFacts(initial,facts);
  assert.equal(resolved.status,'resolved');
  assert.deepEqual(resolved.canonicalEntityIds,['promo:p1']);
  const filtered=filterFactsByCanonicalScope(facts,resolved);
  assert.ok(filtered.some(row=>row.key==='promo:p1:promoTotal'));
  assert.ok(!filtered.some(row=>row.key.startsWith('promo:p2:')));
});

test('13. unresolved focused Promotion scope is empty and never leaks another campaign',()=>{
  const initial=deriveCanonicalKnowledgeScope(deriveSemanticMeaning(
    semantic({action:'ask',informationNeed:'price',entities:{promotionName:'โปรไม่มีจริง'}}),
  ));
  const facts=[...livePromo('p1','โปรหนึ่ง'),...livePromo('p2','โปรสอง')];
  const resolved=resolveCanonicalScopeAgainstFacts(initial,facts);
  assert.equal(resolved.status,'unresolved');
  assert.deepEqual(filterFactsByCanonicalScope(facts,resolved),[]);
});

test('14. grounded Promotion renderer lists only verified eligible rows and preserves membership constraint',()=>{
  const rows=[
    ...livePromo('p1','โปรใช้ได้'),
    ...livePromo('p2','โปรปิด',false),
    fact('promo:p3:name','โปรสมาชิกใหม่'),
    fact('promo:p3:eligible',true),
    fact('promo:p3:requiresMembership',true),
  ];
  const out=renderPromotionRecommendation({
    language:'th',
    semanticTurn:semantic({action:'recommend',informationNeed:'recommendation',constraints:['no_new_membership']}),
    dialogDecision:decision(),
    knowledgeBundles:[bundle(rows)],
  });
  assert.ok(out);
  assert.match(out!.message,/โปรใช้ได้/u);
  assert.doesNotMatch(out!.message,/โปรปิด|โปรสมาชิกใหม่/u);
});

test('15. Promotion source unavailable is UNKNOWN, verified empty is honestly empty',()=>{
  const unavailable=renderPromotionRecommendation({
    language:'th',semanticTurn:semantic({action:'discover'}),
    dialogDecision:decision(),knowledgeBundles:[bundle([],'unavailable')],
  });
  assert.ok(unavailable);
  assert.match(unavailable!.message,/ยังเช็กโปรโมชั่นล่าสุดไม่ได้|ไม่ขอเดา/u);

  const empty=renderPromotionRecommendation({
    language:'th',semanticTurn:semantic({action:'discover'}),
    dialogDecision:decision(),knowledgeBundles:[bundle([],'empty')],
  });
  assert.ok(empty);
  assert.match(empty!.message,/ยังไม่มีโปรโมชั่น/u);
});

test('16. live Promotion adapter exposes the mutable fields used by scope/render/redemption verification',()=>{
  const source=readFileSync(new URL('../netlify/functions/_dialog-source-adapters.ts',import.meta.url),'utf8');
  for(const marker of [
    'campaignCode','promoTotal','normalTotal','discountPct','requiresDateTime',
    'requiresMembership','redemptionCount','maxRedemptions','eligible',
  ]) assert.match(source,new RegExp(marker));
});
