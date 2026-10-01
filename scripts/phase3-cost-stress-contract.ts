import {
  buildProductionSemanticInterpreterPrompt,
  emptySemanticContext,
  type SemanticContext,
} from '../netlify/functions/_semantic-interpreter';
import { deriveDeterministicSemanticTurn } from '../netlify/functions/_deterministic-semantic-turn';
import {
  deterministicNeedsLanguageRefinement,
  isShortStandaloneConceptCandidate,
  semanticTurnFromLearnedConcept,
} from '../netlify/functions/_thongthai-one-mind-orchestrator';
import {
  matchLearnedConcept,
  normalizeForConceptMatching,
  type StoredSemanticConcept,
} from '../netlify/functions/_semantic-concept-memory';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';
import {
  aiCostPolicy,
  calculateAiCostUsd,
  estimateInputTokens,
  reserveWorstCaseCostUsd,
  usdToThb,
} from '../netlify/functions/_ai-cost-policy';

export type Phase3StressOwner='deterministic'|'learned_exact'|'learned_fuzzy'|'paid'|'budget_blocked';
export type Phase3StressRow={
  turn:number;
  message:string;
  owner:Phase3StressOwner;
  estimatedInputTokens:number;
  estimatedCostThb:number;
  learnedTier?:'exact_replay'|'fuzzy_generalized';
  learnedConcept?:string;
  transactionLike:boolean;
  accidentalLearnedTransaction:boolean;
};
export type Phase3StressReport={
  kind:'PHASE3_COST_STRESS';
  requestedTurns:number;
  sample:number;
  customerTurns:number;
  paidCalls:number;
  zeroCallTurns:number;
  zeroCallRatePct:number;
  learnedHits:number;
  learnedHitRatePct:number;
  learnedExactHits:number;
  learnedFuzzyHits:number;
  deterministicZeroCallTurns:number;
  budgetBlockedTurns:number;
  arbitraryCliffTurns:number;
  accidentalLearnedTransactions:number;
  semanticInputTokens:{average:number;p95:number;max:number};
  costThb:{averagePerConversation:number;p95PerConversation:number;maxPerConversation:number;conversationsExceedingCap:number};
  capThb:number;
  rows:Phase3StressRow[];
};

const NOW=new Date('2026-10-01T12:00:00+07:00');
const task=emptyTaskStateContainer();

const singleActivityEntity:SemanticContext={
  activeDomain:'activity',
  lastAction:'ask',
  recentEntities:[
    {id:'activity_asset:horse-pharadon',type:'activity_asset',name:'ภาราดร',domain:'activity',canonical:true},
  ],
  lastRecommendationReference:'ภาราดรเป็นตัวเลือกที่กำลังพิจารณาอยู่',
};
const empty=emptySemanticContext();

function concept(
  conceptKey:StoredSemanticConcept['conceptKey'],
  phrase:string,
  evidenceCount=5,
):StoredSemanticConcept{
  return {
    id:'stress-'+conceptKey+'-'+normalizeForConceptMatching(phrase),
    conceptKey,
    normalizedSignature:normalizeForConceptMatching(phrase),
    confidence:evidenceCount===1?0.7:0.9,
    evidenceCount,
    contradictionCount:0,
    status:'active',
  };
}

const concepts:StoredSemanticConcept[]=[
  concept('companion_partner','มากับแฟน',5),
  concept('companion_family','มากับครอบครัว',5),
  concept('pace_relaxed','ไม่อยากเหนื่อยมาก',5),
  concept('consider_only','เอาอันนี้ไว้ก่อน',5),
  // A newly-confirmed cross-vocabulary exemplar: the FIRST unseen phrasing
  // still costs one model call, then exact replay of that phrasing becomes
  // free. This is the honest Phase 3 architecture instead of an unsafe
  // synonym table/embedding guess.
  concept('companion_partner','มากับคนรู้ใจ',1),
];

type Template={message:string;context:SemanticContext;transactionLike?:boolean};
const templates:Template[]=[
  {message:'มีม้ากี่ตัว',context:empty},
  {message:'เป็ดน้ำเท่าไหร่',context:empty},
  {message:'มากับแฟนครับ',context:empty},
  {message:'มากับแฟนสองคน',context:empty},
  {message:'มากับคนรู้ใจครับ',context:empty},
  {message:'มากับครอบครัวนะครับ',context:empty},
  {message:'ไม่อยากเหนื่อยมากครับ',context:empty},
  {message:'ไม่อยากเหนื่อยมากๆ',context:empty},
  {message:'เอาอันนี้ไว้ก่อนนะครับ',context:singleActivityEntity},
  {message:'วันนี้อยากได้อะไรเบา ๆ แต่ยังสนุกอยู่',context:empty},
  {message:'ถ้าฝนตกแล้วมีอะไรทำแทนได้บ้าง',context:empty},
  {message:'แถวนี้มีอะไรที่คนพื้นที่ชอบทำกัน',context:empty},
  {message:'ตัวที่บอกว่านิ่งกว่าเหมาะกับมือใหม่ยังไง',context:singleActivityEntity},
  {message:'พรุ่งนี้ช่วงเย็นถ้าไม่เต็มควรเริ่มกี่โมง',context:singleActivityEntity},
  {message:'กระเป๋าหายตรงลานจอดรถช่วยแนะนำหน่อย',context:empty},
  {message:'สรุปให้หน่อยว่าตอนนี้คุยอะไรไว้บ้าง',context:singleActivityEntity},
  {message:'จองเลยครับ',context:singleActivityEntity,transactionLike:true},
  {message:'ยืนยันจอง',context:singleActivityEntity,transactionLike:true},
  {message:'ยังไม่จองนะ',context:singleActivityEntity},
  {message:'เอาอันนี้ไว้ก่อน เดี๋ยวค่อยตัดสินใจ',context:singleActivityEntity},
];

function pct(value:number):number{return Math.round(value*10000)/100;}
function round(value:number,digits=4):number{
  const n=10**digits;
  return Math.round(value*n)/n;
}
function percentile(values:number[],p:number):number{
  if(!values.length)return 0;
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted[Math.max(0,Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1))]!;
}

function classify(
  entry:Template,
):{
  owner:Exclude<Phase3StressOwner,'budget_blocked'>;
  learnedTier?:'exact_replay'|'fuzzy_generalized';
  learnedConcept?:string;
}{
  const deterministic=deriveDeterministicSemanticTurn(entry.message,entry.context,task,NOW);
  if(deterministic && !deterministicNeedsLanguageRefinement(deterministic,task,entry.message)){
    return {owner:'deterministic'};
  }
  if(!deterministic && isShortStandaloneConceptCandidate(entry.message)){
    const match=matchLearnedConcept(entry.message,concepts);
    if(match){
      const turn=semanticTurnFromLearnedConcept(match,entry.context,task);
      if(turn){
        return {
          owner:match.tier==='exact_replay'?'learned_exact':'learned_fuzzy',
          learnedTier:match.tier,
          learnedConcept:match.conceptKey,
        };
      }
    }
  }
  return {owner:'paid'};
}

/**
 * Formal network-free stress model over the REAL routing gates and cost
 * arithmetic. Cost uses the canonical estimator + a deliberately conservative
 * 300 output-token synthetic usage envelope. Separately, the reservation
 * decision uses the REAL production worst-case reservation policy. The live
 * calibration runner measures actual tokens/cost; this contract answers a
 * different question: can any turn fall off an arbitrary fixed-call cliff?
 */
export function runPhase3CostStress(requestedTurns:number,sample=0):Phase3StressReport{
  const policy=aiCostPolicy();
  const capThb=policy.maxConversationCostUsd*usdToThb(1);
  const rows:Phase3StressRow[]=[];
  const inputTokens:number[]=[];
  let cumulativeCostUsd=0;
  let callCount=0;
  let budgetBlockedTurns=0;
  let arbitraryCliffTurns=0;
  let accidentalLearnedTransactions=0;
  const reserveUsd=reserveWorstCaseCostUsd(
    'gpt-5.6-terra',
    policy.absoluteInputTokens,
    policy.semanticMaxOutputTokens,
  );

  for(let turn=0;turn<requestedTurns;turn+=1){
    const entry=templates[(turn+sample*7)%templates.length]!;
    const classified=classify(entry);
    let owner:Phase3StressOwner=classified.owner;
    let estimatedInputTokens=0;
    let estimatedCostThb=0;
    let accidentalLearnedTransaction=false;

    if(classified.owner==='paid'){
      const prompt=buildProductionSemanticInterpreterPrompt(entry.context,entry.message);
      estimatedInputTokens=estimateInputTokens([prompt,entry.message]);
      inputTokens.push(estimatedInputTokens);

      const wouldExceedCallCeiling=callCount>=policy.maxCallsPerConversation;
      const wouldExceedBudget=cumulativeCostUsd+reserveUsd>policy.maxConversationCostUsd+Number.EPSILON;
      if(wouldExceedCallCeiling||wouldExceedBudget){
        owner='budget_blocked';
        budgetBlockedTurns+=1;
        // "Arbitrary" means a fixed call ceiling rejected the turn even though
        // the monetary safety reservation would still fit.
        if(wouldExceedCallCeiling&&!wouldExceedBudget) arbitraryCliffTurns+=1;
      }else{
        const syntheticCostUsd=calculateAiCostUsd('gpt-5.6-terra',{
          inputTokens:estimatedInputTokens,
          cachedInputTokens:0,
          outputTokens:300,
        });
        cumulativeCostUsd+=syntheticCostUsd;
        estimatedCostThb=usdToThb(syntheticCostUsd);
        callCount+=1;
      }
    }

    if(
      entry.transactionLike
      && (owner==='learned_exact'||owner==='learned_fuzzy')
    ){
      accidentalLearnedTransaction=true;
      accidentalLearnedTransactions+=1;
    }

    rows.push({
      turn:turn+1,message:entry.message,owner,estimatedInputTokens,
      estimatedCostThb:round(estimatedCostThb,4),
      ...(classified.learnedTier?{learnedTier:classified.learnedTier}:{}),
      ...(classified.learnedConcept?{learnedConcept:classified.learnedConcept}:{}),
      transactionLike:Boolean(entry.transactionLike),
      accidentalLearnedTransaction,
    });
  }

  const learnedExactHits=rows.filter(row=>row.owner==='learned_exact').length;
  const learnedFuzzyHits=rows.filter(row=>row.owner==='learned_fuzzy').length;
  const learnedHits=learnedExactHits+learnedFuzzyHits;
  const deterministicZeroCallTurns=rows.filter(row=>row.owner==='deterministic').length;
  const zeroCallTurns=deterministicZeroCallTurns+learnedHits;
  const conversationCostThb=usdToThb(cumulativeCostUsd);

  return {
    kind:'PHASE3_COST_STRESS',
    requestedTurns,
    sample,
    customerTurns:rows.length,
    paidCalls:rows.filter(row=>row.owner==='paid').length,
    zeroCallTurns,
    zeroCallRatePct:pct(zeroCallTurns/rows.length),
    learnedHits,
    learnedHitRatePct:pct(learnedHits/rows.length),
    learnedExactHits,
    learnedFuzzyHits,
    deterministicZeroCallTurns,
    budgetBlockedTurns,
    arbitraryCliffTurns,
    accidentalLearnedTransactions,
    semanticInputTokens:{
      average:round(inputTokens.length?inputTokens.reduce((a,b)=>a+b,0)/inputTokens.length:0,2),
      p95:percentile(inputTokens,0.95),
      max:Math.max(...inputTokens,0),
    },
    costThb:{
      averagePerConversation:round(conversationCostThb,4),
      p95PerConversation:round(conversationCostThb,4),
      maxPerConversation:round(conversationCostThb,4),
      conversationsExceedingCap:conversationCostThb>capThb+1e-9?1:0,
    },
    capThb:round(capThb,4),
    rows,
  };
}

export function runPhase3CostStressSuite(){
  const reports:Phase3StressReport[]=[];
  for(const turns of [20,50,100]){
    for(let sample=0;sample<5;sample+=1) reports.push(runPhase3CostStress(turns,sample));
  }
  const byLength=[20,50,100].map(turns=>{
    const set=reports.filter(report=>report.requestedTurns===turns);
    const costs=set.map(report=>report.costThb.maxPerConversation);
    return {
      turns,
      samples:set.length,
      paidCalls:set.reduce((sum,row)=>sum+row.paidCalls,0),
      zeroCallRatePct:round(set.reduce((sum,row)=>sum+row.zeroCallRatePct,0)/set.length,2),
      learnedHitRatePct:round(set.reduce((sum,row)=>sum+row.learnedHitRatePct,0)/set.length,2),
      budgetBlockedTurns:set.reduce((sum,row)=>sum+row.budgetBlockedTurns,0),
      arbitraryCliffTurns:set.reduce((sum,row)=>sum+row.arbitraryCliffTurns,0),
      accidentalLearnedTransactions:set.reduce((sum,row)=>sum+row.accidentalLearnedTransactions,0),
      costThb:{
        average:round(costs.reduce((a,b)=>a+b,0)/costs.length,4),
        p95:round(percentile(costs,0.95),4),
        max:round(Math.max(...costs),4),
        conversationsExceedingCap:set.filter(row=>row.costThb.conversationsExceedingCap>0).length,
      },
      inputTokens:{
        average:round(set.reduce((sum,row)=>sum+row.semanticInputTokens.average,0)/set.length,2),
        p95:Math.max(...set.map(row=>row.semanticInputTokens.p95)),
        max:Math.max(...set.map(row=>row.semanticInputTokens.max)),
      },
    };
  });
  return {kind:'PHASE3_COST_STRESS_SUITE',reports,byLength};
}
