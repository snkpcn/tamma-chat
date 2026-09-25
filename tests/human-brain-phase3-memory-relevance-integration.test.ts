import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  processThongthaiOneMindTurn,
  type OneMindDependencies,
} from '../netlify/functions/_thongthai-one-mind-orchestrator';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';
import { buildOneMindTraceEnvelope } from '../netlify/functions/_one-mind-observability';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';

const NOW = new Date('2026-09-26T01:00:00.000Z');
const CANONICAL = '11111111-1111-4111-8111-111111111111';
const GUEST_DB = '22222222-2222-4222-8222-222222222222';

const durableMemory = {
  travelerType: 'couple',
  pace: 'relaxed',
  interests: ['food','coffee'],
  constraints: ['no_chicken','no_shrimp','no_spicy','limited_walking','fear_of_falling'],
  group: { adults: 2, children: 0, elderly: 0 },
  favorites: ['sunset'],
  visitedExperiences: ['inthanin'],
};

function depsFor(semantic: SemanticTurn): Partial<OneMindDependencies> {
  return {
    resolveCanonicalGuestId: async () => CANONICAL,
    guestDbIdFromAnonymousId: async () => GUEST_DB,
    loadConversationContext: async () => emptyConversationContextState(NOW),
    persistConversationContext: async () => undefined,
    loadTaskState: async () => emptyTaskStateContainer(),
    persistTaskState: async () => undefined,
    interpretSemanticTurn: async () => semantic,
    buildKnowledgeAdapters: () => ({}),
  };
}

test('Human Brain Phase 3 integration: availability meaning reaches Dialog Manager without durable dietary memory', async () => {
  const semantic: SemanticTurn = {
    domain:'restaurant',
    intent:'table_availability_check',
    action:'status',
    informationNeed:'availability',
    entities:{date:'พรุ่งนี้',time:'18:00'},
    references:[],
    constraints:['outdoor_seat'],
    confidence:0.98,
    needsClarification:false,
  };

  const result = await processThongthaiOneMindTurn({
    channel:'line',
    message:'พรุ่งนี้หกโมงมีโต๊ะไหม',
    eventId:'phase3-availability',
    providerUserKey:'line-key',
    durableMemory,
  }, depsFor(semantic), NOW);

  assert.deepEqual(result.semanticTurn.constraints, ['outdoor_seat'],
    'original current-turn semantic meaning must remain untouched');
  assert.deepEqual(result.memoryRelevance.relevantConstraints, []);
  assert.deepEqual(result.dialogPlan.knowledgeRequests[0]?.constraints, ['outdoor_seat'],
    'durable no_chicken/no_shrimp/no_spicy must not leak into availability planning');
  assert.deepEqual(result.trace.memory.appliedKeys, []);
  assert.ok(result.trace.memory.ignoredKeys.includes('constraints'));
});

test('Human Brain Phase 3 integration: menu recommendation receives only relevant dietary memory after understanding', async () => {
  const semantic: SemanticTurn = {
    domain:'restaurant',
    intent:'menu_recommendation_request',
    action:'recommend',
    informationNeed:'recommendation',
    entities:{},
    references:[],
    constraints:['current_turn_constraint'],
    confidence:0.96,
    needsClarification:false,
  };

  const result = await processThongthaiOneMindTurn({
    channel:'line',
    message:'มีอะไรกินที่เหมาะกับผมบ้าง',
    eventId:'phase3-menu-recommendation',
    providerUserKey:'line-key',
    durableMemory,
  }, depsFor(semantic), NOW);

  assert.deepEqual(result.semanticTurn.constraints, ['current_turn_constraint'],
    'memory enrichment must not rewrite the language brain output');
  const planned = result.dialogPlan.knowledgeRequests[0]?.constraints ?? [];
  assert.ok(planned.includes('current_turn_constraint'));
  assert.ok(planned.includes('no_chicken'));
  assert.ok(planned.includes('no_shrimp'));
  assert.ok(planned.includes('no_spicy'));
  assert.ok(!planned.includes('limited_walking'));
  assert.ok(!planned.includes('fear_of_falling'));
  assert.deepEqual(result.memoryRelevance.appliedKeys, ['constraints']);
});

test('Human Brain Phase 3 privacy: persisted trace names memory keys/count only, never raw memory values', async () => {
  const semantic: SemanticTurn = {
    domain:'restaurant',
    intent:'menu_recommendation_request',
    action:'recommend',
    informationNeed:'recommendation',
    entities:{},
    references:[],
    constraints:[],
    confidence:0.96,
    needsClarification:false,
  };
  const result = await processThongthaiOneMindTurn({
    channel:'line',
    message:'แนะนำอาหารหน่อย',
    eventId:'phase3-trace-privacy',
    providerUserKey:'line-key',
    durableMemory,
  }, depsFor(semantic), NOW);

  const envelope = buildOneMindTraceEnvelope({ turn:result, response:null, at:NOW });
  assert.deepEqual(envelope.memory.appliedKeys, ['constraints']);
  assert.equal(envelope.memory.relevantConstraintCount, 3);
  const serialized = JSON.stringify(envelope);
  assert.doesNotMatch(serialized,/no_shrimp|no_chicken|no_spicy|sunset|inthanin/u);
});
