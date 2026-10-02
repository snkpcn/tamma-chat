import test from 'node:test';
import assert from 'node:assert/strict';

import { emptySemanticContext, parseSemanticTurnResponse } from '../netlify/functions/_semantic-interpreter';
import {
  isTrustedBoundedActivityPreferenceRecommendation,
  isTrustedBoundedCorrectionContinuation,
  readOnlyCutoverEligibility,
} from '../netlify/functions/_thongthai-one-mind-response';
import { deriveDeterministicSemanticTurn } from '../netlify/functions/_deterministic-semantic-turn';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';
import { renderActivityRecommendation } from '../netlify/functions/_human-grounded-response';

test('compound calm-horse + rain recommendation repairs structured activity domain and does not clarify', () => {
  const turn=parseSemanticTurnResponse(JSON.stringify({
    normalizedMeaning:'สนใจขี่ม้าช่วงเย็น โดยไม่เลือกทองไทย ต้องการม้าที่นิสัยนิ่งกว่า และขอกิจกรรมทดแทนหากฝนตก',
    reply:'หมายถึง calm ที่คุยไว้ก่อนหน้านี้ใช่ไหมครับ',
    speechAct:'question',
    domain:'unknown',
    intent:'request_calm_horse_and_rainy_day_alternatives',
    action:'recommend',
    informationNeed:'recommendation',
    entities:{
      activityCode:'horse_riding',
      preferredHorseTrait:'calm',
      weatherCondition:'rain',
    },
    references:[],
    constraints:['exclude_thongthai','calm_horse','evening','rain_fallback'],
    confidence:0.98,
    needsClarification:true,
  }),emptySemanticContext(),'อยากขี่ม้าพรุ่งนี้ช่วงเย็น แต่ไม่เอาทองไทยนะ เอาตัวที่นิสัยนิ่งกว่า แล้วถ้าฝนตกมีอะไรให้ทำแทนได้บ้าง');

  assert.equal(turn.domain,'activity');
  assert.equal(turn.action,'recommend');
  assert.equal(turn.informationNeed,'recommendation');
  assert.equal(turn.needsClarification,false);
  assert.equal(turn.reply,undefined,'stale unknown-domain clarification reply must be discarded');
});

test('grounded activity recommendation surfaces the verified calm horse and preserves rain fallback', () => {
  const semanticTurn=parseSemanticTurnResponse(JSON.stringify({
    normalizedMeaning:'ต้องการม้าที่นิสัยนิ่งกว่า ไม่เอาทองไทย และขอทางเลือกถ้าฝนตก',
    speechAct:'question',
    domain:'activity',
    intent:'request_calm_horse_and_rainy_day_alternatives',
    action:'recommend',
    informationNeed:'recommendation',
    entities:{activityCode:'horse_riding',preferredHorseTrait:'calm',weatherCondition:'rain'},
    references:[],
    constraints:['exclude_thongthai','calm_horse','rain_fallback'],
    confidence:0.99,
    needsClarification:false,
  }),emptySemanticContext(),'');

  const facts=[
    {key:'activity_asset:horse-paradorn:name',value:'ภาราดร'},
    {key:'activity_asset:horse-paradorn:type',value:'horse'},
    {key:'activity_asset:horse-paradorn:activityCode',value:'horse_riding'},
    {key:'temperament:activity_asset:horse-paradorn',value:'calm'},
    {key:'activity_asset:horse-thongthai:name',value:'ทองไทย'},
    {key:'activity_asset:horse-thongthai:type',value:'horse'},
    {key:'activity_asset:horse-thongthai:activityCode',value:'horse_riding'},
    {key:'temperament:activity_asset:horse-thongthai',value:'lively'},
    {key:'activity:archery:name',value:'ยิงธนู'},
  ].map((fact,index)=>({
    ...fact,
    domain:'activity' as const,
    sourceId:'test-source',
    sourceType:'activity_live' as const,
    authoritative:true,
    fetchedAt:new Date(0).toISOString(),
  }));

  const rendered=renderActivityRecommendation({
    channel:'line',
    language:'th',
    userMessage:'compound test',
    semanticTurn,
    dialogDecision:{
      mode:'query_knowledge',
      taskStateContainer:{
        schemaVersion:'task-state-v1',
        activeTask:null,suspendedTask:null,lastSupersededTask:null,recentEventIds:[],
      },
      knowledgeRequests:[{
        domain:'activity',
        needs:['entity_details','catalog'],
        entities:semanticTurn.entities,
        constraints:semanticTurn.constraints,
      }],
      missingFields:[],
      responseIntent:'grounded_answer',
      reasons:[],
    },
    knowledgeBundles:[{
      domain:'activity',
      facts,
      sources:[{
        need:'catalog',
        status:'ok',
        sourceId:'test-source',
        sourceType:'activity_live',
        fetchedAt:new Date(0).toISOString(),
        data:facts,
      }],
      degradation:'none',
    }],
    degradation:{mode:'none',reason:null},
    operationalOutcome:null,
  } as any);

  assert.ok(rendered);
  assert.match(rendered.message,/ภาราดร/u);
  assert.match(rendered.message,/ฝน/u);
  assert.doesNotMatch(rendered.message,/หมายถึง calm/u);
});

test('bounded active-task horse correction stays inside One Mind without creating transaction permission', () => {
  const active={
    taskId:'task-activity-1',
    type:'activity_booking',
    domain:'activity',
    status:'collecting',
    slots:{horseName:'ภาราดร',time:'18:00'},
    missingFields:['date','durationMinutes','partySize','customerName','phone'],
    selectedEntities:[],
    constraints:[],
    commitmentIntent:false,
    sourceChannel:'line',
    createdAt:new Date(0).toISOString(),
    updatedAt:new Date(0).toISOString(),
  };
  const after={...active,slots:{...active.slots,horseName:'ทองไทย'}};
  const semantic={
    semanticSource:'deterministic_fallback',
    normalizedMeaning:'เปลี่ยนตัวเลือกจากภาราดรเป็นทองไทย เวลาเดิม',
    speechAct:'correction',
    domain:'activity',
    intent:'select_known_activity_asset',
    action:'correct_previous',
    informationNeed:'none',
    entities:{horseName:'ทองไทย'},
    references:[],
    constraints:[],
    confidence:0.99,
    needsClarification:false,
  };
  const turn:any={
    semanticTurn:semantic,
    dialogSemanticTurn:semantic,
    taskStateBefore:{
      schemaVersion:'task-state-v1',activeTask:active,suspendedTask:null,lastSupersededTask:null,recentEventIds:[],
    },
    taskStateAfter:{
      schemaVersion:'task-state-v1',activeTask:after,suspendedTask:null,lastSupersededTask:null,recentEventIds:[],
    },
    dialogDecision:{
      mode:'query_knowledge',
      taskStateContainer:{
        schemaVersion:'task-state-v1',activeTask:after,suspendedTask:null,lastSupersededTask:null,recentEventIds:[],
      },
      knowledgeRequests:[],
      missingFields:after.missingFields,
      responseIntent:'grounded_answer',
      reasons:[],
    },
    groundedKnowledge:[],
  };

  assert.equal(isTrustedBoundedCorrectionContinuation(turn),true);
  assert.deepEqual(
    readOnlyCutoverEligibility(turn,{requireSemanticSupervisor:true,message:'เมื่อกี้บอกว่าเอาภาราดร เปลี่ยนใจละ เอาทองไทยเหมือนเดิม แต่เวลาเดิมนะ'}),
    {eligible:true},
  );
  assert.equal(turn.dialogDecision.actionProposal,undefined);
});


test('provider-unusable fallback preserves horse exclusion + calm preference + rain fallback and stays read-only',()=>{
  const message='อยากขี่ม้าพรุ่งนี้ช่วงเย็น แต่ไม่เอาทองไทยนะ เอาตัวที่นิสัยนิ่งกว่า แล้วถ้าฝนตกมีอะไรให้ทำแทนได้บ้าง';
  const semantic=deriveDeterministicSemanticTurn(
    message,
    emptySemanticContext(),
    emptyTaskStateContainer(),
    new Date('2026-10-02T08:00:00+07:00'),
  );
  assert.ok(semantic);
  assert.equal(semantic!.domain,'activity');
  assert.equal(semantic!.intent,'activity_preference_recommendation_fallback');
  assert.equal(semantic!.action,'recommend');
  assert.equal(semantic!.informationNeed,'recommendation');
  assert.equal(semantic!.entities.activityCode,'horse');
  assert.equal(semantic!.entities.excludedHorse,'ทองไทย');
  assert.equal(semantic!.entities.preferredHorseTrait,'calm');
  assert.equal(semantic!.entities.weatherCondition,'rain');
  assert.ok(semantic!.constraints.includes('exclude_thongthai'));
  assert.ok(semantic!.constraints.includes('preferred_horse_trait:calm'));
  assert.ok(semantic!.constraints.includes('weather_fallback_requested'));

  const container=emptyTaskStateContainer();
  const turn:any={
    semanticTurn:{...semantic,semanticSource:'deterministic_fallback'},
    dialogSemanticTurn:{...semantic,semanticSource:'deterministic_fallback'},
    taskStateBefore:container,
    taskStateAfter:container,
    dialogDecision:{
      mode:'query_knowledge',
      taskStateContainer:container,
      knowledgeRequests:[],
      missingFields:[],
      responseIntent:'grounded_answer',
      reasons:[],
    },
    groundedKnowledge:[],
  };
  assert.equal(isTrustedBoundedActivityPreferenceRecommendation(turn),true);
  assert.deepEqual(
    readOnlyCutoverEligibility(turn,{requireSemanticSupervisor:true,message}),
    {eligible:true},
  );
  assert.equal(turn.dialogDecision.actionProposal,undefined);
});
