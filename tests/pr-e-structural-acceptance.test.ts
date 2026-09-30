import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';
import { deterministicNeedsLanguageRefinement } from '../netlify/functions/_thongthai-one-mind-orchestrator';
import {
  resolveStayBookingProposalArgs,
  resolveDeterministicStayTransactionCutover,
  resolveSupervisedStayCutover,
} from '../netlify/functions/thongthai-chat';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';

function semantic(overrides:Partial<SemanticTurn>={}):SemanticTurn {
  return { domain:'stay', intent:'stay_holdout', action:'ask', informationNeed:'policy', entities:{policyTopic:'check_in'}, references:[], constraints:[], confidence:.93, needsClarification:false, ...overrides };
}
function decision(overrides:Record<string, unknown>={}) {
  return { mode:'answer', taskStateContainer:emptyTaskStateContainer(), knowledgeRequests:[], missingFields:[], responseIntent:'grounded_answer', reasons:[], ...overrides } as any;
}
function result(turn:SemanticTurn, dialog=decision(), source:'openai_supervisor'|'deterministic_fallback'='openai_supervisor') {
  const owned={...turn,semanticSource:source};
  return { status:'legacy_required', reason:'transactional_or_task_turn', turn:{ semanticTurn:owned, dialogSemanticTurn:owned, dialogDecision:dialog, groundedKnowledge:[], knowledgeDegradation:{condition:'none',level:'normal',reasons:[],retryable:false} }, observability:{} } as any;
}

test('A/B/I: supervised Stay terminates before legacy responders/runThongthaiBrain and performs no second provider call', () => {
  let calls=0;
  const original=globalThis.fetch;
  globalThis.fetch=(async()=>{ calls+=1; throw new Error('provider unreachable'); }) as typeof fetch;
  try {
    assert.equal(resolveSupervisedStayCutover(result(semantic()),'web','th')?.kind,'respond');
    assert.equal(calls,0);
  } finally { globalThis.fetch=original; }
  const source=readFileSync(new URL('../netlify/functions/thongthai-chat.ts',import.meta.url),'utf8');
  const gate=source.indexOf('const supervisedStay = earlyOneMind');
  const legacy=source.indexOf('const homestayFacts = homestayFactsResponse');
  const brain=source.indexOf('firstResponse = await runThongthaiBrain');
  assert.ok(gate>0 && gate<legacy && legacy<brain);
});

test('C: deterministic Stay meaning is outage fallback and cannot compete with usable OpenAI meaning', () => {
  const coarse=semantic({intent:'stay_read_only_inquiry',informationNeed:'catalog'});
  assert.equal(deterministicNeedsLanguageRefinement(coarse,emptyTaskStateContainer(),'หาที่นอนชิล ๆ สักหลัง'),true);
  assert.equal(resolveSupervisedStayCutover(result(coarse,decision(),'deterministic_fallback'),'web','th'),null);
  assert.equal(resolveSupervisedStayCutover(result(coarse),'web','th')?.kind,'respond');
});

test('D/E: Stay response uses structured policy meaning and focused scope is load-bearing', () => {
  const a=resolveSupervisedStayCutover(result(semantic({normalizedMeaning:'irrelevant one'})),'web','th');
  const b=resolveSupervisedStayCutover(result(semantic({normalizedMeaning:'completely different text'})),'web','th');
  assert.equal(a?.kind,'respond'); assert.equal(b?.kind,'respond');
  if(a?.kind==='respond'&&b?.kind==='respond') assert.equal(a.response.message,b.response.message);
  assert.match(a?.kind==='respond'?a.response.message:'',/14:00/u);
});

test('F: Stay proposal args and executor boundary are structured-only', () => {
  assert.equal(resolveStayBookingProposalArgs.length,2);
  const args=resolveStayBookingProposalArgs({validatedArgs:{date:'2026-10-10',endDate:'2026-10-12',partySize:4}}, {selectedEntities:[{id:'stay:baan-b',name:'บ้านชมดาว'}]});
  assert.deepEqual(args,{date:'2026-10-10',endDate:'2026-10-12',partySize:4,resourceCode:'baan-b',accommodationName:'บ้านชมดาว'});
  const source=readFileSync(new URL('../netlify/functions/thongthai-chat.ts',import.meta.url),'utf8');
  const start=source.indexOf('async function executeDeterministicStayBooking');
  const end=source.indexOf('// Service Mind --',start);
  const executable=source.slice(start,end).replace(/\/\/.*$/gmu,'');
  assert.doesNotMatch(executable,/request\.message|extract(?:Date|Time|Party)|hasCommitMarker|homestayFactsResponse/u);
});

test('G/H: selection is planning; only explicit_transaction plus gate-issued proposal executes', () => {
  const selection=resolveSupervisedStayCutover(result(semantic({action:'confirm',speechAct:'selection',informationNeed:'none',entities:{resourceCode:'baan-b'}})),'web','th');
  assert.equal(selection?.kind,'respond');
  const task={...emptyTaskStateContainer(),activeTask:{taskId:'stay-1',type:'stay_booking',domain:'stay',status:'ready',slots:{resourceCode:'baan-b',date:'2026-10-10',endDate:'2026-10-12',partySize:4},missingFields:[],selectedEntities:[{id:'stay:baan-b',type:'stay',name:'บ้านชมดาว',domain:'stay',canonical:true}],constraints:[],commitmentIntent:true,sourceChannel:'web',createdAt:'2026-09-27T00:00:00Z',updatedAt:'2026-09-27T00:00:00Z'}} as any;
  const proposal={toolName:'create_booking',validatedArgs:task.activeTask.slots,requiresExplicitConfirmation:true,customerCommitPresent:true,idempotencyKey:'stay-1'};
  const bare=resolveSupervisedStayCutover(result(semantic({action:'confirm',speechAct:'acknowledgement',informationNeed:'none'}),decision({taskStateContainer:task,actionProposal:proposal})),'web','th');
  assert.equal(bare?.kind,'respond','bare acknowledgement remains non-transactional even if stale proposal-like state is injected');
  const committed=resolveSupervisedStayCutover(result(semantic({action:'book',speechAct:'transaction_request',informationNeed:'none'}),decision({mode:'propose_action',taskStateContainer:task,actionProposal:proposal})),'web','th');
  assert.equal(committed?.kind,'execute_booking');
});

test('provider outage executes only a complete Dialog-Manager-authorized Stay proposal', () => {
  const task={...emptyTaskStateContainer(),activeTask:{taskId:'stay-outage-1',type:'stay_booking',domain:'stay',status:'ready',slots:{resourceCode:'stay-varee',date:'2026-10-02',endDate:'2026-10-03',partySize:2,quantity:1},missingFields:[],selectedEntities:[{id:'stay:stay-varee',type:'stay',name:'วารี',domain:'stay',canonical:true}],constraints:[],commitmentIntent:true,sourceChannel:'line',createdAt:'2026-09-30T00:00:00Z',updatedAt:'2026-09-30T00:00:00Z'}} as any;
  const proposal={toolName:'create_booking',validatedArgs:task.activeTask.slots,requiresExplicitConfirmation:true,customerCommitPresent:true,idempotencyKey:'stay-outage-1'};
  const committed=result(
    semantic({action:'book',speechAct:'transaction_request',informationNeed:'none'}),
    decision({mode:'propose_action',taskStateContainer:task,actionProposal:proposal}),
    'deterministic_fallback',
  );
  const execution=resolveDeterministicStayTransactionCutover(committed);
  assert.equal(execution?.kind,'execute_booking');
  assert.equal(execution?.args.resourceCode,'stay-varee');

  const noProposal=result(
    semantic({action:'book',speechAct:'transaction_request',informationNeed:'none'}),
    decision({taskStateContainer:task}),
    'deterministic_fallback',
  );
  assert.equal(resolveDeterministicStayTransactionCutover(noProposal),null);

  const acknowledgement=result(
    semantic({action:'confirm',speechAct:'acknowledgement',informationNeed:'none'}),
    decision({mode:'propose_action',taskStateContainer:task,actionProposal:proposal}),
    'deterministic_fallback',
  );
  assert.equal(resolveDeterministicStayTransactionCutover(acknowledgement),null);

  const readOnly=result(
    semantic({action:'ask',informationNeed:'availability'}),
    decision({taskStateContainer:task}),
    'deterministic_fallback',
  );
  assert.equal(resolveDeterministicStayTransactionCutover(readOnly),null);
});
