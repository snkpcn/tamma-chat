import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';
import {
  planMemoryRelevance,
  type DurableMemorySnapshot,
} from '../netlify/functions/_memory-relevance';

function turn(overrides: Partial<SemanticTurn> = {}): SemanticTurn {
  return {
    domain: 'restaurant',
    intent: 'table_availability_check',
    action: 'status',
    informationNeed: 'availability',
    entities: {},
    references: [],
    constraints: [],
    confidence: 0.98,
    needsClarification: false,
    ...overrides,
  };
}

const richMemory: DurableMemorySnapshot = {
  travelerType: 'couple',
  pace: 'relaxed',
  interests: ['food','coffee','adventure'],
  constraints: [
    'no_chicken','no_shrimp','no_spicy',
    'limited_walking','beginner_friendly','fear_of_falling',
  ],
  group: { adults: 2, children: 0, elderly: 0 },
  favorites: ['sunset'],
  visitedExperiences: ['inthanin'],
};

test('Human Brain Phase 3 RED: restaurant availability ignores dietary and lifestyle memory', () => {
  const plan = planMemoryRelevance(turn(), richMemory);
  assert.deepEqual(plan.relevantConstraints, []);
  assert.equal(plan.travelerType, null);
  assert.equal(plan.pace, null);
  assert.deepEqual(plan.interests, []);
  assert.deepEqual(plan.favorites, []);
  assert.deepEqual(plan.visitedExperiences, []);
  assert.ok(plan.ignoredKeys.includes('constraints'));
  assert.ok(plan.ignoredKeys.includes('travelerType'));
});

test('Human Brain Phase 3 RED: restaurant recommendation gets only food-relevant memory', () => {
  const plan = planMemoryRelevance(turn({
    intent:'menu_recommendation_request',
    action:'recommend',
    informationNeed:'recommendation',
  }), richMemory);

  assert.deepEqual(
    [...plan.relevantConstraints].sort(),
    ['no_chicken','no_shrimp','no_spicy'].sort(),
  );
  assert.equal(plan.travelerType, null);
  assert.equal(plan.pace, null);
  assert.deepEqual(plan.interests, []);
  assert.ok(plan.appliedKeys.includes('constraints'));
  assert.ok(!plan.relevantConstraints.includes('limited_walking'));
  assert.ok(!plan.relevantConstraints.includes('fear_of_falling'));
});

test('Human Brain Phase 3 RED: restaurant ingredient question gets dietary safety memory, not trip-style memory', () => {
  const plan = planMemoryRelevance(turn({
    intent:'ingredient_question',
    action:'ask',
    informationNeed:'ingredients',
  }), richMemory);
  assert.ok(plan.relevantConstraints.includes('no_shrimp'));
  assert.ok(plan.relevantConstraints.includes('no_chicken'));
  assert.equal(plan.travelerType, null);
  assert.equal(plan.pace, null);
  assert.deepEqual(plan.favorites, []);
});

test('Human Brain Phase 3 RED: ecosystem recommendation may use trip-style memory softly', () => {
  const plan = planMemoryRelevance(turn({
    domain:'ecosystem',
    intent:'broad_experience_discovery',
    action:'recommend',
    informationNeed:'recommendation',
  }), richMemory);

  assert.equal(plan.travelerType, 'couple');
  assert.equal(plan.pace, 'relaxed');
  assert.deepEqual(plan.interests, ['food','coffee','adventure']);
  assert.deepEqual(plan.favorites, ['sunset']);
  assert.deepEqual(plan.visitedExperiences, ['inthanin']);
  assert.ok(plan.relevantConstraints.includes('limited_walking'));
  assert.ok(!plan.relevantConstraints.includes('no_shrimp'),
    'food-specific memory must not leak into broad ecosystem planning unless the current turn is actually about food');
});

test('Human Brain Phase 3 RED: activity recommendation uses care/mobility memory, not dietary memory', () => {
  const plan = planMemoryRelevance(turn({
    domain:'activity',
    intent:'activity_recommendation',
    action:'recommend',
    informationNeed:'recommendation',
  }), richMemory);

  assert.ok(plan.relevantConstraints.includes('limited_walking'));
  assert.ok(plan.relevantConstraints.includes('beginner_friendly'));
  assert.ok(plan.relevantConstraints.includes('fear_of_falling'));
  assert.ok(!plan.relevantConstraints.includes('no_shrimp'));
  assert.ok(!plan.relevantConstraints.includes('no_chicken'));
});

test('Human Brain Phase 3 RED: location/weather/payment/status questions ignore unrelated durable memory', () => {
  for (const semantic of [
    turn({domain:'ecosystem',intent:'location_request',action:'ask',informationNeed:'none'}),
    turn({domain:'ecosystem',intent:'weather_question',action:'ask',informationNeed:'none'}),
    turn({domain:'payment',intent:'refund_status',action:'status',informationNeed:'transaction_status'}),
    turn({domain:'stay',intent:'room_availability',action:'status',informationNeed:'availability'}),
  ]) {
    const plan = planMemoryRelevance(semantic, richMemory);
    assert.deepEqual(plan.relevantConstraints, [], JSON.stringify(semantic));
    assert.equal(plan.travelerType, null, JSON.stringify(semantic));
    assert.equal(plan.pace, null, JSON.stringify(semantic));
    assert.deepEqual(plan.interests, [], JSON.stringify(semantic));
  }
});

test('Human Brain Phase 3 doctrine: relevance planning never mutates or reclassifies the semantic turn', () => {
  const semantic = turn({
    domain:'restaurant',
    intent:'table_availability_check',
    action:'status',
    informationNeed:'availability',
    entities:{date:'พรุ่งนี้',time:'18:00'},
    constraints:['outdoor_seat'],
  });
  const before = structuredClone(semantic);
  planMemoryRelevance(semantic, richMemory);
  assert.deepEqual(semantic, before);
});
