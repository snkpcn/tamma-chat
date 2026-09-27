import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
  SEMANTIC_INTERPRETER_VERSION,
  parseSemanticTurnResponse,
} from '../netlify/functions/_semantic-interpreter';
import { SEMANTIC_EVAL_CORPUS } from './fixtures/semantic-eval-corpus';

function byId(id: string) {
  const item = SEMANTIC_EVAL_CORPUS.find((row) => row.id === id);
  assert.ok(item, `missing fixture ${id}`);
  return item;
}

test('semantic-v29 keeps the five live-failure gold decisions unchanged', () => {
  assert.deepEqual(byId('discover-05').expected, { domain: 'ecosystem', action: 'recommend' });
  assert.deepEqual(byId('discover-06').expected, { domain: 'ecosystem', action: 'recommend' });
  assert.deepEqual(byId('multi-intent-01').expected, { domain: 'restaurant', action: 'discover' });
  assert.deepEqual(byId('correction-03').expected, { domain: 'activity', action: 'correct_previous' });
  assert.deepEqual(byId('informational-02').expected, { domain: 'activity', action: 'discover' });
});

test('semantic-v29 terminal audit distinguishes requested judgment from neutral browse', () => {
  const prompt = buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g, ' ');
  assert.ok(prompt.includes('the unknown answer itself is qualified as desirable, worthwhile, appealing, or good'));
  assert.ok(prompt.includes('sentence-final evaluative wording modifies the requested choice'));
});

test('semantic-v29 terminal audit preserves primary domain and explicit category ownership', () => {
  const prompt = buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g, ' ');
  assert.ok(prompt.includes('A secondary coordinated request does not widen a specific primary domain to ecosystem'));
  assert.ok(prompt.includes('an explicit canonical category noun owns its category domain even inside a general location frame'));
});

test('semantic-v29 terminal audit separates repair from intentional change', () => {
  const prompt = buildSemanticInterpreterPrompt(emptySemanticContext()).replace(/\s+/g, ' ');
  assert.ok(prompt.includes('rejects an earlier value as wrong and supplies its replacement'));
  assert.ok(prompt.includes('correct_previous, not modify'));
});

test('semantic-v29 version is explicit', () => {
  assert.equal(SEMANTIC_INTERPRETER_VERSION, 'semantic-v30');
});


test('incident_report with unknown domain is repaired to incident without hiding clarification', () => {
  const turn = parseSemanticTurnResponse(JSON.stringify({
    normalizedMeaning:'lost pet nearby',
    speechAct:'incident_report',
    domain:'unknown',
    intent:'report_missing_pet',
    action:'provide_information',
    informationNeed:'none',
    entities:{},
    references:[],
    constraints:[],
    confidence:0.96,
    needsClarification:true,
    clarificationReason:'exact_location_missing',
  }), emptySemanticContext());
  assert.equal(turn.domain, 'incident');
  assert.equal(turn.speechAct, 'incident_report');
  assert.equal(turn.needsClarification, true);
});


test('self-directed pause with stray suspend directive stays a statement when no task exists', () => {
  const turn = parseSemanticTurnResponse(JSON.stringify({
    normalizedMeaning:'partner is tired and customer will pause briefly',
    speechAct:'request',
    domain:'general',
    intent:'pause_briefly',
    action:'provide_information',
    informationNeed:'none',
    taskDirective:'suspend_active',
    entities:{},
    references:[],
    constraints:[],
    confidence:0.96,
    needsClarification:false,
  }), emptySemanticContext());
  assert.equal(turn.domain, 'general');
  assert.equal(turn.speechAct, 'statement');
  assert.equal(turn.taskDirective, undefined);
});

test('incident domain survives an unresolved deictic reference while clarification remains true', () => {
  const turn = parseSemanticTurnResponse(JSON.stringify({
    normalizedMeaning:'pet is missing around there',
    speechAct:'incident_report',
    domain:'unknown',
    intent:'report_missing_pet',
    action:'provide_information',
    informationNeed:'none',
    entities:{},
    references:[{type:'location_reference',value:'there',refersToPriorContext:true}],
    constraints:[],
    confidence:0.96,
    needsClarification:false,
  }), emptySemanticContext());
  assert.equal(turn.domain, 'incident');
  assert.equal(turn.speechAct, 'incident_report');
  assert.equal(turn.needsClarification, true);
});


test('generic previous-plan reference is backed by bounded conversation evidence without inventing an entity id', () => {
  const context = {
    ...emptySemanticContext(),
    activeDomain:'journey' as const,
    recentTurns:[
      {role:'user' as const,content:'ช่วยจัดทริปคร่าว ๆ'},
      {role:'assistant' as const,content:'วันแรกขี่ม้า วันที่สองกินข้าวแล้วซื้อของฝาก'},
    ],
    lastRecommendationReference:'วันแรกขี่ม้า วันที่สองกินข้าวแล้วซื้อของฝาก',
  };
  const turn = parseSemanticTurnResponse(JSON.stringify({
    normalizedMeaning:'keep the previous plan but move it to tomorrow',
    speechAct:'correction',
    domain:'journey',
    intent:'modify_previous_plan_date',
    action:'modify',
    informationNeed:'none',
    entities:{date:'2026-09-28'},
    references:[{type:'previous_plan',value:'previous plan',refersToPriorContext:true}],
    constraints:[],
    confidence:0.97,
    needsClarification:false,
  }), context);
  assert.equal(turn.domain,'journey');
  assert.equal(turn.needsClarification,false);
  assert.equal(turn.references[0]?.resolvedFromConversation,true);
  assert.equal(turn.references[0]?.resolvedEntityId,undefined);
});


test('local-area question keeps local domain when the deictic place reference needs clarification', () => {
  const turn = parseSemanticTurnResponse(JSON.stringify({
    normalizedMeaning:'asking about animals in the surrounding area',
    speechAct:'question',
    domain:'local',
    intent:'ask_local_conditions',
    action:'ask',
    informationNeed:'none',
    entities:{},
    references:[{type:'location_reference',value:'around there',refersToPriorContext:true}],
    constraints:[],
    confidence:0.95,
    needsClarification:false,
  }), emptySemanticContext());
  assert.equal(turn.domain, 'local');
  assert.equal(turn.speechAct, 'question');
  assert.equal(turn.needsClarification, true);
});
