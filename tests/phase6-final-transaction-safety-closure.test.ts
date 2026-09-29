import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planDialogTurn,
  resolveDialogDecision,
  type DialogPlan,
} from '../netlify/functions/_dialog-manager';
import {
  applyTaskStateEvent,
  createActiveTask,
  emptyTaskStateContainer,
  type TaskStateContainer,
} from '../netlify/functions/_task-state';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';
import {
  emptySemanticContext,
  parseSemanticTurnResponse,
  type SemanticContext,
  type SemanticTurn,
} from '../netlify/functions/_semantic-interpreter';
import { deriveDeterministicSemanticTurn } from '../netlify/functions/_deterministic-semantic-turn';
import {
  hasExplicitNoTransactionMarker,
  hasStandaloneTransactionRequest,
} from '../netlify/functions/_slot-parsers';
import type { KnowledgeBundle } from '../netlify/functions/_knowledge-resolver';

const NOW = new Date('2026-09-30T00:50:00+07:00');

function semantic(overrides: Partial<SemanticTurn>): SemanticTurn {
  return {
    semanticSource:'openai_supervisor',
    domain:'activity',
    intent:'phase6_final',
    action:'ask',
    entities:{},
    references:[],
    constraints:[],
    confidence:0.99,
    needsClarification:false,
    ...overrides,
  };
}

function plan(
  semanticTurn: SemanticTurn,
  taskState: TaskStateContainer = emptyTaskStateContainer(),
  channel: 'web' | 'line' = 'web',
  eventId = 'phase6-final',
): DialogPlan {
  return planDialogTurn({
    semanticTurn,
    conversationContext:emptyConversationContextState(NOW),
    taskState,
    channel,
    eventId,
  }, NOW);
}

function available(): KnowledgeBundle {
  return {
    domain:'activity',
    sources:[{need:'availability',sourceId:'schedule',sourceType:'activity_live',status:'ok'}],
    facts:[{
      key:'availability:activity-horse:2026-10-06T10:00:00+07:00:available',
      value:true,
      domain:'activity',
      sourceId:'schedule',
      sourceType:'activity_live',
      authoritative:true,
      fetchedAt:NOW.toISOString(),
    }],
    entities:[],
    missing:[],
    warnings:[],
    freshness:'live',
  };
}

test('Phase 6 final: shared transaction boundary rejects questions, deferrals and negation but accepts explicit commit', () => {
  for (const message of [
    'ยังไม่ต้องจอง',
    'เอาไว้ก่อน ยังไม่จอง',
    'ถามเรื่องจองเฉย ๆ ยังไม่ได้ให้จอง',
    'กลับมาจองม้าต่อ',
    'จองได้ไหม',
  ]) {
    assert.equal(hasStandaloneTransactionRequest(message), false, message);
  }
  assert.equal(hasStandaloneTransactionRequest('จองเลย'), true);
  assert.equal(hasStandaloneTransactionRequest('ยืนยันจอง'), true);
  assert.equal(hasExplicitNoTransactionMarker('เอาไว้ก่อน ยังไม่ต้องจอง'), true);
});

test('Phase 6 final: canonical task consent is reversible and may be explicitly re-armed', () => {
  let state: TaskStateContainer = {
    ...emptyTaskStateContainer(),
    activeTask:createActiveTask({
      type:'activity_booking',
      sourceChannel:'web',
      initialSlots:{resourceCode:'activity-horse',date:'2026-10-06',durationMinutes:60},
      requiredFields:['resourceCode','date','durationMinutes'],
      now:NOW,
    }),
  };
  state = applyTaskStateEvent(state,{kind:'mark_commitment',eventId:'mark'},NOW);
  assert.equal(state.activeTask?.commitmentIntent,true);

  state = applyTaskStateEvent(state,{kind:'clear_commitment',eventId:'clear'},NOW);
  assert.equal(state.activeTask?.commitmentIntent,false);

  state = applyTaskStateEvent(state,{kind:'mark_commitment',eventId:'remark'},NOW);
  assert.equal(state.activeTask?.commitmentIntent,true);
});

for (const channel of ['web','line'] as const) {
  test(`Phase 6 final: ${channel} revocation clears historical write consent until a fresh book/order turn`, () => {
    const started = plan(semantic({
      action:'book',
      speechAct:'transaction_request',
      entities:{resourceCode:'activity-horse',date:'2026-10-06'},
    }), emptyTaskStateContainer(), channel, `${channel}-start`);
    assert.equal(started.taskStateContainer.activeTask?.commitmentIntent,true);
    assert.equal(started.customerCommitPresent,true);

    const revoked = plan(semantic({
      action:'correct_previous',
      speechAct:'correction',
      constraints:['no_transaction'],
    }), started.taskStateContainer, channel, `${channel}-revoke`);
    assert.equal(revoked.taskStateContainer.activeTask?.commitmentIntent,false);
    assert.equal(revoked.customerCommitPresent,false);
    assert.ok(revoked.reasons.includes('transaction_commitment_revoked'));

    const laterSlotFill = plan(semantic({
      action:'provide_information',
      entities:{durationMinutes:60},
    }), revoked.taskStateContainer, channel, `${channel}-fill`);
    assert.equal(laterSlotFill.taskStateContainer.activeTask?.commitmentIntent,false);
    assert.equal(laterSlotFill.customerCommitPresent,false);
    assert.equal(resolveDialogDecision(laterSlotFill,[available()]).actionProposal,undefined,
      'a later innocent slot fill must never resurrect historical consent');

    const recommitted = plan(semantic({
      action:'book',
      speechAct:'transaction_request',
    }), laterSlotFill.taskStateContainer, channel, `${channel}-rearm`);
    assert.equal(recommitted.taskStateContainer.activeTask?.commitmentIntent,true);
    assert.equal(recommitted.customerCommitPresent,true);
    assert.equal(resolveDialogDecision(recommitted,[available()]).actionProposal?.toolName,'create_booking');
  });
}

test('Phase 6 final: provider-outage deterministic fallback can revoke an already-open task', () => {
  let taskState: TaskStateContainer = {
    ...emptyTaskStateContainer(),
    activeTask:createActiveTask({
      type:'activity_booking',
      sourceChannel:'line',
      initialSlots:{resourceCode:'activity-horse',date:'2026-10-06'},
      requiredFields:['resourceCode','date','durationMinutes'],
      now:NOW,
    }),
  };
  taskState = applyTaskStateEvent(taskState,{kind:'mark_commitment',eventId:'old-commit'},NOW);

  const turn = deriveDeterministicSemanticTurn(
    'เอาไว้ก่อนนะ ยังไม่ต้องจอง',
    {...emptySemanticContext(),activeDomain:'activity'},
    taskState,
    NOW,
  );
  assert.ok(turn);
  assert.notEqual(turn!.action,'book');
  assert.notEqual(turn!.action,'order');
  assert.ok(turn!.constraints.includes('no_transaction'));
});

test('Phase 6 final: explicit current no-transaction text overrides a model hallucinating book/transaction_request', () => {
  const raw = JSON.stringify({
    normalizedMeaning:'customer wants booking',
    reply:'',
    speechAct:'transaction_request',
    domain:'activity',
    intent:'book_activity',
    action:'book',
    informationNeed:'none',
    entities:{resourceCode:'activity-horse'},
    references:[],
    constraints:[],
    confidence:0.99,
    needsClarification:false,
  });
  const turn = parseSemanticTurnResponse(
    raw,
    emptySemanticContext(),
    'เอาภาราดรไว้ก่อน แต่ยังไม่ต้องจอง',
  );
  assert.notEqual(turn.action,'book');
  assert.notEqual(turn.speechAct,'transaction_request');
  assert.ok(turn.constraints.includes('no_transaction'));
});

test('Phase 6 final: resuming a suspended booking is not fresh consent, but resume plus explicit commit is', () => {
  const suspended = createActiveTask({
    type:'activity_booking',
    sourceChannel:'line',
    initialSlots:{resourceCode:'activity-horse',date:'2026-10-06'},
    requiredFields:['resourceCode','date','durationMinutes'],
    now:NOW,
  });
  const context: SemanticContext = {
    ...emptySemanticContext(),
    activeDomain:'restaurant',
    suspendedTask:suspended,
  };
  const raw = JSON.stringify({
    normalizedMeaning:'resume prior horse booking',
    reply:'',
    speechAct:'transaction_request',
    domain:'activity',
    intent:'resume_booking',
    action:'book',
    informationNeed:'none',
    taskDirective:'resume_suspended',
    entities:{},
    references:[],
    constraints:[],
    confidence:0.99,
    needsClarification:false,
  });

  const resumeOnly = parseSemanticTurnResponse(raw,context,'กลับไปเรื่องม้าที่ค้างไว้');
  assert.equal(resumeOnly.taskDirective,'resume_suspended');
  assert.notEqual(resumeOnly.action,'book');
  assert.notEqual(resumeOnly.speechAct,'transaction_request');

  const resumeAndCommit = parseSemanticTurnResponse(raw,context,'กลับไปเรื่องม้าที่ค้างไว้ แล้วจองเลย');
  assert.equal(resumeAndCommit.action,'book');
  assert.equal(resumeAndCommit.speechAct,'transaction_request');
});
