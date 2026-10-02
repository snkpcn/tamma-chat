import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  classifyCommercialBoundarySemantic,
  classifyCommercialBoundaryText,
  semanticMayAuthorizeCommercialCommit,
} from '../netlify/functions/_commercial-intent-boundary';
import { isAgentTransactionPrepareIntent } from '../netlify/functions/thongthai-chat';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';
import { deriveDeterministicSemanticTurn } from '../netlify/functions/_deterministic-semantic-turn';
import { reconcileCommercialQuestionRefinement, reconcileReadOnlyActivityPreferenceRefinement } from '../netlify/functions/_thongthai-one-mind-orchestrator';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';
import { createActiveTask, emptyTaskStateContainer } from '../netlify/functions/_task-state';
import { planDialogTurn, resolveDialogDecision } from '../netlify/functions/_dialog-manager';
import { isTrustedReadOnlyCommercialClarification, readOnlyCutoverEligibility } from '../netlify/functions/_thongthai-one-mind-response';

function semantic(overrides:Partial<SemanticTurn>):SemanticTurn{
  return {
    semanticSource:'openai_supervisor',
    domain:'activity',
    intent:'phase4_test',
    action:'ask',
    speechAct:'question',
    informationNeed:'none',
    entities:{},
    references:[],
    constraints:[],
    confidence:0.98,
    needsClarification:false,
    ...overrides,
  };
}

test('Phase 4 raw commercial boundary separates questions from current-turn consent',()=>{
  for(const message of [
    'จองได้ไหมครับ',
    'สั่งได้หรือเปล่า',
    'ยืนยันการจองต้องทำยังไง',
    'ช่วยยืนยันหน่อยว่าพรุ่งนี้ห้องว่างไหม',
    'ถ้าจะจองต้องทำยังไงครับ',
  ]){
    const d=classifyCommercialBoundaryText(message,'OTHER');
    assert.equal(d.mode,'READ_ONLY',message);
    assert.equal(d.currentTurnCommit,false,message);
    assert.equal(d.prepareEligible,false,message);
    assert.equal(d.routeToOneMindBeforePrimary,true,message);
  }
});

test('Phase 4 raw commercial boundary recognizes explicit booking/order requests only',()=>{
  for(const message of [
    'ขอจองภาราดรพรุ่งนี้ห้าโมง 30 นาทีครับ',
    'จองเลยครับ',
    'ยืนยันจองครับ',
    'ขอสั่งตำลาว 1 จานครับ',
    'สั่งเลยครับ',
    'ยืนยันสั่งครับ',
  ]){
    const d=classifyCommercialBoundaryText(message,'BUSINESS_TRANSACTION');
    assert.equal(d.mode,'COMMIT',message);
    assert.equal(d.currentTurnCommit,true,message);
    assert.equal(d.prepareEligible,true,message);
  }
});

test('Phase 4 cafe staff handoff is explicit operational consent but remains prepare-only eligible',()=>{
  for(const message of [
    'ช่วยส่งคำถามให้ทีมอินทนิลว่าเตรียมลาเต้ 5 แก้วได้ไหมครับ',
    'ฝากเรื่องให้ทีมคาเฟ่ติดต่อกลับได้ไหมครับ',
  ]){
    const d=classifyCommercialBoundaryText(message,'BUSINESS_TRANSACTION');
    assert.equal(d.mode,'COMMIT',message);
    assert.equal(d.currentTurnCommit,true,message);
    assert.equal(d.prepareEligible,true,message);
  }
});

test('Phase 4 planning, resume and bare confirmation are not fresh commercial consent',()=>{
  const cases=[
    'ยืนยันครับ',
    'เอาชุดนี้เลย',
    'เอาชุดเมื่อกี้',
    'กลับไปเรื่องจองต่อครับ',
    'กลับไปเรื่องสั่งต่อครับ',
  ];
  for(const message of cases){
    const d=classifyCommercialBoundaryText(message,'OTHER');
    assert.equal(d.mode,'CONSIDER',message);
    assert.equal(d.currentTurnCommit,false,message);
    assert.equal(d.prepareEligible,false,message);
    assert.equal(d.routeToOneMindBeforePrimary,true,message);
  }
});

test('Phase 4 same-turn latest consent signal wins',()=>{
  const revoked=classifyCommercialBoundaryText('จองเลยครับ แต่เดี๋ยวก่อน ยังไม่จอง','BUSINESS_TRANSACTION');
  assert.equal(revoked.mode,'WITHHOLD');
  assert.equal(revoked.currentTurnCommit,false);

  const recommitted=classifyCommercialBoundaryText('ยังไม่จอง... เอางี้ จองเลยครับ','BUSINESS_TRANSACTION');
  assert.equal(recommitted.mode,'COMMIT');
  assert.equal(recommitted.currentTurnCommit,true);

  const alternative=classifyCommercialBoundaryText('ไม่จองอันนี้ แต่จองอีกอันครับ','BUSINESS_TRANSACTION');
  assert.equal(alternative.mode,'COMMIT');
  assert.equal(alternative.currentTurnCommit,true);
});

test('Phase 4 cancellation/abandonment manages state and never creates fresh consent',()=>{
  for(const message of ['ยกเลิกก่อนครับ','ไม่เอาแล้ว','ไม่จองแล้วครับ']){
    const d=classifyCommercialBoundaryText(message,'OTHER');
    assert.ok(['MANAGE','WITHHOLD'].includes(d.mode),message);
    assert.equal(d.currentTurnCommit,false,message);
    assert.equal(d.prepareEligible,false,message);
  }
});

test('Phase 4 explicit promotion redemption is COMMIT but never Agent prepare eligible',()=>{
  const d=classifyCommercialBoundaryText('ใช้โปรนี้ครับ','OTHER');
  assert.equal(d.mode,'COMMIT');
  assert.equal(d.currentTurnCommit,true);
  assert.equal(d.prepareEligible,false);
});

test('Phase 4 semantic contract maps human conversational modes to one commercial boundary',()=>{
  const ask=classifyCommercialBoundarySemantic(semantic({
    action:'ask',speechAct:'question',informationNeed:'price',
  }));
  assert.equal(ask.mode,'READ_ONLY');

  const discover=classifyCommercialBoundarySemantic(semantic({
    action:'discover',speechAct:'question',informationNeed:'catalog',
  }));
  assert.equal(discover.mode,'READ_ONLY');

  const consider=classifyCommercialBoundarySemantic(semantic({
    action:'confirm',speechAct:'selection',entities:{horseName:'ภาราดร'},
  }));
  assert.equal(consider.mode,'CONSIDER');

  const commit=classifyCommercialBoundarySemantic(semantic({
    action:'book',speechAct:'transaction_request',
  }));
  assert.equal(commit.mode,'COMMIT');
  assert.equal(semanticMayAuthorizeCommercialCommit(semantic({
    action:'book',speechAct:'transaction_request',
  })),true);

  const incident=classifyCommercialBoundarySemantic(semantic({
    domain:'incident',action:'ask',speechAct:'incident_report',
  }));
  assert.equal(incident.mode,'INCIDENT');

  const manage=classifyCommercialBoundarySemantic(semantic({
    action:'cancel',speechAct:'task_control',
  }));
  assert.equal(manage.mode,'MANAGE');
});

test('Phase 4 semantic no-transaction constraint defeats contradictory model commit label',()=>{
  const malformed=semantic({
    action:'book',
    speechAct:'transaction_request',
    constraints:['no_transaction'],
  });
  const d=classifyCommercialBoundarySemantic(malformed);
  assert.equal(d.mode,'WITHHOLD');
  assert.equal(d.currentTurnCommit,false);
  assert.equal(semanticMayAuthorizeCommercialCommit(malformed),false);
});

test('Phase 4 production prepare routing no longer treats commercial questions or bare confirm as transaction intent',()=>{
  assert.equal(isAgentTransactionPrepareIntent('จองได้ไหมครับ','BUSINESS_TRANSACTION'),false);
  assert.equal(isAgentTransactionPrepareIntent('ยืนยันการจองต้องทำยังไง','BUSINESS_TRANSACTION'),false);
  assert.equal(isAgentTransactionPrepareIntent('ยืนยันครับ','OTHER'),false);
  assert.equal(isAgentTransactionPrepareIntent('เอาชุดนี้เลย','OTHER'),false);
  assert.equal(isAgentTransactionPrepareIntent('ยืนยันจองครับ','BUSINESS_TRANSACTION'),true);
  assert.equal(isAgentTransactionPrepareIntent('ขอสั่งอาหารครับ','BUSINESS_TRANSACTION'),true);
});

test('Phase 4 boundary-sensitive non-commit turns bypass 100% read-only Agent and reach One-Mind',()=>{
  const source=readFileSync(
    new URL('../netlify/functions/thongthai-chat.ts',import.meta.url),
    'utf8',
  );
  assert.match(source,/const commercialBoundary = classifyCommercialBoundaryText/u);
  assert.match(source,/const explicitTransactionIntent = commercialBoundary\.currentTurnCommit/u);
  assert.match(source,/const transactionPrepareIntent = commercialBoundary\.prepareEligible/u);
  assert.match(source,/const phase4CommercialBoundaryEligible =\s*commercialBoundary\.routeToOneMindBeforePrimary/u);
  assert.match(source,/!phase4CommercialBoundaryEligible/u);
});


test('Phase 4 semantic manage intent can independently veto execution',()=>{
  const cancel=classifyCommercialBoundarySemantic(semantic({
    action:'cancel',
    speechAct:'task_control',
    constraints:['no_transaction'],
  }));
  assert.equal(cancel.mode,'MANAGE');
  assert.equal(cancel.currentTurnCommit,false);
  assert.equal(cancel.withholdsExecution,true);

  const correction=classifyCommercialBoundarySemantic(semantic({
    action:'correct_previous',
    speechAct:'correction',
    entities:{horseName:'ทองไทย'},
    constraints:['no_transaction'],
  }));
  assert.equal(correction.mode,'MANAGE');
  assert.equal(correction.withholdsExecution,true);
});


test('Phase 4 compound horse preference fallback preserves exclusion/calm/rain structure',()=>{
  const message='อยากขี่ม้าพรุ่งนี้ช่วงเย็น แต่ไม่เอาทองไทยนะ เอาตัวที่นิสัยนิ่งกว่า แล้วถ้าฝนตกมีอะไรให้ทำแทนได้บ้าง';
  const deterministic=deriveDeterministicSemanticTurn(
    message,
    emptyConversationContextState(new Date('2026-10-02T08:00:00+07:00')) as any,
    emptyTaskStateContainer(),
    new Date('2026-10-02T08:00:00+07:00'),
  );
  assert.ok(deterministic);
  assert.equal(deterministic!.domain,'activity');
  assert.equal(deterministic!.action,'recommend');
  assert.equal(deterministic!.informationNeed,'recommendation');
  assert.equal(deterministic!.entities.excludedHorse,'ทองไทย');
  assert.equal(deterministic!.entities.preferredHorseTrait,'calm');
  assert.equal(deterministic!.entities.weatherCondition,'rain');
  assert.ok(deterministic!.constraints.includes('exclude_thongthai'));
  assert.ok(deterministic!.constraints.includes('preferred_horse_trait:calm'));
  assert.ok(deterministic!.constraints.includes('weather_fallback_requested'));
});

test('Phase 4 read-only activity preference reconciliation keeps rich model structure but removes false selection authority',()=>{
  const deterministic=semantic({
    domain:'activity',
    intent:'activity_preference_recommendation_fallback',
    action:'recommend',
    speechAct:'question',
    informationNeed:'recommendation',
    entities:{
      activityCode:'horse',
      excludedHorse:'ทองไทย',
      preferredHorseTrait:'calm',
      weatherCondition:'rain',
    },
    constraints:['exclude_thongthai','preferred_horse_trait:calm','weather_fallback_requested'],
    confidence:0.86,
  });
  const model=semantic({
    domain:'activity',
    intent:'recommend_calm_horse_with_rain_fallback',
    action:'confirm',
    speechAct:'selection',
    informationNeed:'recommendation',
    entities:{
      activityCode:'horse',
      preferredHorseTrait:'calm',
      weatherCondition:'rain',
    },
    constraints:['exclude_thongthai','weather_fallback_requested'],
    confidence:0.94,
  });

  const reconciled=reconcileReadOnlyActivityPreferenceRefinement(model,deterministic);
  assert.equal(reconciled.action,'recommend');
  assert.equal(reconciled.speechAct,'question');
  assert.equal(reconciled.informationNeed,'recommendation');
  assert.equal(reconciled.entities.excludedHorse,'ทองไทย');
  assert.equal(reconciled.entities.preferredHorseTrait,'calm');
  assert.ok(reconciled.constraints.includes('exclude_thongthai'));
  assert.equal(classifyCommercialBoundarySemantic(reconciled).currentTurnCommit,false);
});

test('Phase 4 activity preference reconciliation never de-escalates an explicit transaction request',()=>{
  const deterministic=semantic({
    domain:'activity',
    intent:'activity_preference_recommendation_fallback',
    action:'recommend',
    speechAct:'question',
    informationNeed:'recommendation',
    entities:{activityCode:'horse',preferredHorseTrait:'calm'},
    constraints:['preferred_horse_trait:calm'],
    confidence:0.86,
  });
  const explicit=semantic({
    domain:'activity',
    intent:'book_calm_horse',
    action:'book',
    speechAct:'transaction_request',
    entities:{activityCode:'horse',preferredHorseTrait:'calm'},
    constraints:[],
    confidence:0.99,
  });
  const reconciled=reconcileReadOnlyActivityPreferenceRefinement(explicit,deterministic);
  assert.equal(reconciled.action,'book');
  assert.equal(reconciled.speechAct,'transaction_request');
  assert.equal(classifyCommercialBoundarySemantic(reconciled).currentTurnCommit,true);
});


test('Phase 4 Dialog Manager: no_transaction defeats contradictory book label and clears stale commitment',()=>{
  const now=new Date('2026-10-02T08:00:00+07:00');
  const active={
    ...createActiveTask({
      type:'stay_booking',
      sourceChannel:'line',
      initialSlots:{
        resourceCode:'stay-villa-2br',
        date:'2026-10-03',
        endDate:'2026-10-05',
        partySize:3,
      },
      requiredFields:['resourceCode','date','endDate','partySize'],
      now,
    }),
    status:'ready' as const,
    missingFields:[],
    commitmentIntent:true,
  };
  const taskState={...emptyTaskStateContainer(),activeTask:active};

  const malformed=semantic({
    domain:'stay',
    intent:'summarize_active_task',
    action:'book',
    speechAct:'transaction_request',
    entities:{
      partySize:3,
      activityCode:'horse',
      horsePreferences:['ภาราดร','ทองไทย'],
    },
    constraints:['no_transaction'],
  });

  const plan=planDialogTurn({
    semanticTurn:malformed,
    conversationContext:emptyConversationContextState(now),
    taskState,
    channel:'line',
    eventId:'phase4-summary-no-transaction',
  },now);

  assert.equal(plan.customerCommitPresent,false);
  assert.equal(plan.taskStateContainer.activeTask?.commitmentIntent,false);
  assert.equal(plan.mode,'answer');
  assert.ok(plan.reasons.includes('transaction_commitment_revoked'));
  assert.ok(plan.reasons.includes('task_summary_requested'));

  const decision=resolveDialogDecision(plan,[]);
  assert.equal(decision.actionProposal,undefined);
  assert.equal(decision.responseIntent,'active_task_summary');
});

test('Phase 4 Dialog Manager: contradictory book + no_transaction cannot manufacture a fresh task',()=>{
  const now=new Date('2026-10-02T08:00:00+07:00');
  const malformed=semantic({
    domain:'activity',
    intent:'summary_or_consider',
    action:'book',
    speechAct:'transaction_request',
    entities:{activityCode:'horse'},
    constraints:['no_transaction'],
  });
  const plan=planDialogTurn({
    semanticTurn:malformed,
    conversationContext:emptyConversationContextState(now),
    taskState:emptyTaskStateContainer(),
    channel:'web',
    eventId:'phase4-no-fresh-task',
  },now);

  assert.equal(plan.customerCommitPresent,false);
  assert.equal(plan.taskStateContainer.activeTask,null);
  assert.equal(resolveDialogDecision(plan,[]).actionProposal,undefined);
});


test('Phase 4 structural English commercial boundary separates questions, planning and withholding',()=>{
  for(const message of [
    'How do I confirm a booking?',
    'Can I book this?',
    'What is the ordering process?',
  ]){
    const d=classifyCommercialBoundaryText(message,'OTHER');
    assert.equal(d.mode,'READ_ONLY',message);
    assert.equal(d.currentTurnCommit,false,message);
    assert.equal(d.routeToOneMindBeforePrimary,true,message);
  }

  const bareConfirm=classifyCommercialBoundaryText('confirm','OTHER');
  assert.equal(bareConfirm.mode,'CONSIDER');
  assert.equal(bareConfirm.currentTurnCommit,false);

  const resume=classifyCommercialBoundaryText('continue booking','OTHER');
  assert.equal(resume.mode,'CONSIDER');
  assert.equal(resume.currentTurnCommit,false);

  const withhold=classifyCommercialBoundaryText("don't book yet",'OTHER');
  assert.equal(withhold.mode,'WITHHOLD');
  assert.equal(withhold.currentTurnCommit,false);
  assert.equal(withhold.withholdsExecution,true);

  const cancel=classifyCommercialBoundaryText('cancel this booking','OTHER');
  assert.equal(cancel.mode,'MANAGE');
  assert.equal(cancel.currentTurnCommit,false);
});

test('Phase 4 structural English cafe handoff remains explicit prepare-capable operational consent',()=>{
  const d=classifyCommercialBoundaryText(
    'Can you send a question to the cafe team about five lattes?',
    'OTHER',
  );
  assert.equal(d.mode,'COMMIT');
  assert.equal(d.currentTurnCommit,true);
  assert.equal(d.prepareEligible,true);
});


test('Phase 4 commercial question reconciliation de-escalates an English false model commit',()=>{
  const model=semantic({
    domain:'unknown',
    intent:'book_unspecified',
    action:'book',
    speechAct:'transaction_request',
    informationNeed:'availability',
    confidence:0.93,
    needsClarification:true,
    clarificationReason:'item not specified',
  });
  const reconciled=reconcileCommercialQuestionRefinement(model,'Can I book this?');
  assert.equal(reconciled.domain,'support');
  assert.equal(reconciled.action,'ask');
  assert.equal(reconciled.speechAct,'question');
  assert.equal(reconciled.informationNeed,'policy');
  assert.equal(reconciled.needsClarification,false);
  assert.ok(reconciled.constraints.includes('no_transaction'));
  assert.equal(classifyCommercialBoundarySemantic(reconciled).currentTurnCommit,false);
});

test('Phase 4 commercial question reconciliation preserves known domain/entities while stripping commit authority',()=>{
  const model=semantic({
    domain:'activity',
    intent:'book_named_horse',
    action:'book',
    speechAct:'transaction_request',
    informationNeed:'availability',
    entities:{horseName:'ภาราดร',date:'2026-10-03'},
    references:[],
    confidence:0.96,
    needsClarification:false,
  });
  const reconciled=reconcileCommercialQuestionRefinement(model,'ภาราดรจองได้ไหมครับ');
  assert.equal(reconciled.domain,'activity');
  assert.equal(reconciled.entities.horseName,'ภาราดร');
  assert.equal(reconciled.entities.date,'2026-10-03');
  assert.equal(reconciled.action,'ask');
  assert.equal(reconciled.speechAct,'question');
  assert.equal(reconciled.informationNeed,'availability');
  assert.ok(reconciled.constraints.includes('no_transaction'));
  assert.equal(classifyCommercialBoundarySemantic(reconciled).mode,'WITHHOLD');
});

test('Phase 4 commercial reconciliation never de-escalates a real non-question commit',()=>{
  const model=semantic({
    domain:'activity',
    intent:'book_service',
    action:'book',
    speechAct:'transaction_request',
    informationNeed:'none',
    confidence:0.99,
  });
  const reconciled=reconcileCommercialQuestionRefinement(model,'จองเลยครับ');
  assert.equal(reconciled.action,'book');
  assert.equal(reconciled.speechAct,'transaction_request');
  assert.equal(classifyCommercialBoundarySemantic(reconciled).currentTurnCommit,true);
});

test('Phase 4 commercial reconciliation is a no-op for model results that are already read-only',()=>{
  const model=semantic({
    domain:'support',
    intent:'booking_confirmation_process',
    action:'ask',
    speechAct:'question',
    informationNeed:'policy',
    confidence:0.98,
    needsClarification:false,
  });
  assert.deepEqual(
    reconcileCommercialQuestionRefinement(model,'How do I confirm a booking?'),
    model,
  );
});


test('Phase 4 trusted unknown-domain availability clarification is eligible before legacy fallback',()=>{
  const semanticTurn=semantic({
    domain:'unknown',
    intent:'check_availability',
    action:'status',
    speechAct:'question',
    informationNeed:'availability',
    entities:{date:'2026-10-03'},
    needsClarification:true,
    clarificationReason:'service unspecified',
  });
  const turn:any={
    semanticTurn,
    dialogSemanticTurn:semanticTurn,
    dialogDecision:{
      mode:'clarify',
      responseIntent:'clarify_ambiguous_entity',
      reasons:['ambiguous_entity'],
      missingFields:[],
      actionProposal:undefined,
      taskStateContainer:emptyTaskStateContainer(),
    },
    taskStateBefore:emptyTaskStateContainer(),
    taskStateAfter:emptyTaskStateContainer(),
    groundedKnowledge:[],
  };

  const message='ช่วยยืนยันหน่อยว่าพรุ่งนี้ว่างไหมครับ';
  assert.equal(isTrustedReadOnlyCommercialClarification(turn,message),true);
  assert.deepEqual(
    readOnlyCutoverEligibility(turn,{requireSemanticSupervisor:true,message}),
    {eligible:true},
  );
});

test('Phase 4 commercial clarification exception cannot admit commit-shaped or non-commercial unknown turns',()=>{
  const commit=semantic({
    domain:'unknown',
    intent:'book_unspecified',
    action:'book',
    speechAct:'transaction_request',
    informationNeed:'none',
    needsClarification:true,
  });
  const turn:any={
    semanticTurn:commit,
    dialogSemanticTurn:commit,
    dialogDecision:{
      mode:'clarify',
      responseIntent:'clarify_ambiguous_entity',
      reasons:['ambiguous_entity'],
      missingFields:[],
      actionProposal:undefined,
      taskStateContainer:emptyTaskStateContainer(),
    },
    taskStateBefore:emptyTaskStateContainer(),
    taskStateAfter:emptyTaskStateContainer(),
    groundedKnowledge:[],
  };
  assert.equal(isTrustedReadOnlyCommercialClarification(turn,'จองเลยครับ'),false);
  const rejected=readOnlyCutoverEligibility(
    turn,{requireSemanticSupervisor:true,message:'จองเลยครับ'},
  );
  assert.equal(rejected.eligible,false);
  if (!rejected.eligible) {
    assert.ok(
      rejected.reason === 'transactional_or_task_turn' || rejected.reason === 'domain_not_cut_over',
      'either rejection reason is fail-closed; the critical contract is that the turn is not eligible',
    );
  }
});


test('Phase 4 One-Mind fast-paths explicit WITHHOLD before model reply reuse',()=>{
  const source=readFileSync(
    new URL('../netlify/functions/_thongthai-one-mind-response.ts',import.meta.url),
    'utf8',
  );
  assert.match(source,/const explicitCommercialWithhold/u);
  assert.match(source,/classifyCommercialBoundaryText\(input\.message,'OTHER'\)\.mode === 'WITHHOLD'/u);
  assert.match(source,/\|\| explicitCommercialWithhold/u);
});
