import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ONE_MIND_RESPONSE_VERSION,
  readOnlyCutoverEligibility,
} from '../netlify/functions/_thongthai-one-mind-response';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';
import { emptyTaskStateContainer, createActiveTask } from '../netlify/functions/_task-state';
import type { OneMindTurnResult } from '../netlify/functions/_thongthai-one-mind-orchestrator';

const NOW=new Date('2026-09-18T12:00:00.000Z');

function result(overrides: Partial<OneMindTurnResult> = {}): OneMindTurnResult {
  const conversation=emptyConversationContextState(NOW);
  const tasks=emptyTaskStateContainer();
  return {
    identity:{providerUserKey:'web',canonicalAnonymousId:'a',guestDbId:'b',linked:false},
    semanticTurn:{
      domain:'restaurant',intent:'menu_question',action:'ask',entities:{},references:[],
      constraints:[],confidence:.9,needsClarification:false,
    },
    dialogPlan:{
      taskStateContainer:tasks,knowledgeRequests:[],mode:'answer',reasons:[],
      missingFields:[],customerCommitPresent:false,action:'ask',compareEntityIds:[],
    },
    dialogDecision:{
      mode:'answer',taskStateContainer:tasks,knowledgeRequests:[],missingFields:[],
      responseIntent:'grounded_answer',reasons:[],
    },
    groundedKnowledge:[],
    knowledgeDegradation:{
      version:'degradation-v1',condition:'none',level:'normal',reasonCodes:[],
      retryable:false,safeToExecuteTransaction:false,sourceStates:[],
    },
    conversationContextBefore:conversation,
    conversationContextAfter:conversation,
    taskStateBefore:tasks,
    taskStateAfter:tasks,
    trace:{
      orchestratorVersion:'one-mind-g1-v1',channel:'web',eventId:'evt',
      semantic:{semanticVersion:'semantic-v1',domain:'restaurant',intent:'menu_question',action:'ask',confidenceBucket:'high',referencesResolved:0,referencesUnresolved:0,needsClarification:false},
      dialogMode:'answer',responseIntent:'grounded_answer',reasonCodes:[],knowledgeSources:[],
      actionProposed:false,statePersisted:true,stateConflictRetries:0,
    },
    ...overrides,
  };
}

test('Phase I response bridge version is explicit', () => {
  assert.equal(ONE_MIND_RESPONSE_VERSION,'one-mind-response-v1');
});

test('initial G.2 gate allows a task-free restaurant read-only turn', () => {
  assert.deepEqual(readOnlyCutoverEligibility(result()), {eligible:true});
});

test('initial G.2 gate refuses transactional action even before an ActionProposal exists', () => {
  const r=result();
  r.semanticTurn={...r.semanticTurn,domain:'activity',action:'book',intent:'activity_booking'};
  assert.deepEqual(readOnlyCutoverEligibility(r), {eligible:false,reason:'transactional_or_task_turn'});
});

// Zero-cost architecture (Phase P): continuing an already-active task is
// safe to compose through One-Mind as long as the DialogDecision never
// reaches an ActionProposal (a real commitment) -- slot-filling, correcting
// a field, and asking one clarifying question all stay eligible so the
// canonical zero-LLM continuation flow doesn't get stuck on legacy. Only a
// turn that actually proposes/executes a transaction still requires the
// (not-yet-equivalence-tested) legacy executor.
test('initial G.2 gate allows a safe task-continuation turn (collect_field, no ActionProposal)', () => {
  const active=createActiveTask({type:'activity_booking',sourceChannel:'web',initialSlots:{resourceCode:'activity-horse'}},NOW);
  const state={...emptyTaskStateContainer(),activeTask:active};
  const r=result({
    taskStateBefore:state,
    taskStateAfter:state,
    semanticTurn:{
      domain:'activity',intent:'task_slot_update',action:'provide_information',entities:{date:'2026-09-20'},references:[],
      constraints:[],confidence:.9,needsClarification:false,
    },
    dialogDecision:{
      mode:'collect_field',taskStateContainer:state,knowledgeRequests:[],missingFields:['partySize'],
      responseIntent:'ask_missing_field',reasons:['missing_field'],
    },
  });
  assert.deepEqual(readOnlyCutoverEligibility(r), {eligible:true});
});

test('initial G.2 gate still refuses a task turn that reaches an ActionProposal', () => {
  const active=createActiveTask({type:'activity_booking',sourceChannel:'web',initialSlots:{resourceCode:'activity-horse',date:'2026-09-20',durationMinutes:60}},NOW);
  const state={...emptyTaskStateContainer(),activeTask:active};
  const r=result({
    taskStateBefore:state,
    taskStateAfter:state,
    semanticTurn:{
      domain:'activity',intent:'confirm_booking',action:'book',entities:{},references:[],
      constraints:[],confidence:.9,needsClarification:false,
    },
    dialogDecision:{
      mode:'propose_action',taskStateContainer:state,knowledgeRequests:[],missingFields:[],
      responseIntent:'propose_action',reasons:['explicit_commit_received'],
      actionProposal:{
        toolName:'create_booking',validatedArgs:{},requiresExplicitConfirmation:false,
        customerCommitPresent:true,idempotencyKey:active.taskId,
      },
    },
  });
  assert.deepEqual(readOnlyCutoverEligibility(r), {eligible:false,reason:'transactional_or_task_turn'});
});

test('initial G.2 gate deliberately leaves ecosystem and membership on legacy until equivalence is proven', () => {
  for (const domain of ['ecosystem','membership'] as const) {
    const r=result();
    r.semanticTurn={...r.semanticTurn,domain};
    assert.deepEqual(readOnlyCutoverEligibility(r), {eligible:false,reason:'domain_not_cut_over'});
  }
});

test('response bridge centralizes wording in Response Composer and contains no Thai customer copy itself', () => {
  const source=readFileSync('netlify/functions/_thongthai-one-mind-response.ts','utf8');
  assert.match(source,/composeThongthaiResponse/);
  assert.match(source,/processThongthaiOneMindTurnAuthoritative/);
  assert.doesNotMatch(source,/[ก-๙]{4,}/u);
});
