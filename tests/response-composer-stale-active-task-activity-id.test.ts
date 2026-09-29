// Cost guard follow-up regression: requestedActivityId (_response-composer.ts)
// let a STALE active task's resourceCode silently override an explicit
// activity named in the CURRENT turn.
//
// Real production regression, reported after PR #240 (owner's live LINE
// retest): once an activity task had been opened earlier in the
// conversation (e.g. selecting a horse), a LATER, completely unrelated
// price question naming a DIFFERENT activity explicitly ("เป็ดน้ำเท่าไหร่")
// answered "ราคาของปั่นเรือเป็ดน้ำยังไม่มีข้อมูลยืนยันในระบบครับ" even though
// production activity_offerings genuinely has pedal_boat pricing and the
// knowledge gateway had already correctly fetched it for this exact turn
// (confirmed: PR #239/#240's own fix made this turn genuinely zero-cost --
// zero_cost_turn=true in production telemetry -- the bug was purely in
// WHICH activity's facts activityPriceAnswer filtered down to, not in cost
// routing or fact fetching).
//
// Root cause: requestedActivityId checked
// dialogDecision.taskStateContainer.activeTask?.slots.resourceCode FIRST,
// unconditionally, before ever looking at the CURRENT turn's own
// entities.activityCode (already correctly resolved to 'pedal_boat' by
// _deterministic-semantic-turn.ts). Whenever knowledgeBundles only carried
// the CURRENT turn's requested activity's facts (as they do here -- the
// knowledge gateway is correctly scoped per-turn), filtering
// activityPriceAnswer's price entries down to the STALE task's activity id
// found zero matching entries, producing the "price not confirmed"
// apology text instead of the real price.
//
// Fixed by reordering requestedActivityId to prefer an explicit
// entities.activityCode (or a direct keyword match in this turn's own
// text) over the active task's resourceCode -- the active task only
// decides when THIS turn names nothing explicit itself (the genuinely
// context-dependent "ราคาเท่าไหร่" case that fallback exists for).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeGroundedDeterministicResponse } from '../netlify/functions/_response-composer';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';
import { emptyTaskStateContainer, type ActiveTask } from '../netlify/functions/_task-state';
import type { DialogDecision } from '../netlify/functions/_dialog-manager';
import type { GroundedFact, KnowledgeBundle } from '../netlify/functions/_knowledge-resolver';

const NOW = new Date('2026-09-29T11:30:00.000Z');

function fact(key: string, value: unknown): GroundedFact {
  return { key, value, domain: 'activity', sourceId: 'activity_catalog', sourceType: 'activity_live', authoritative: true, fetchedAt: NOW.toISOString() };
}

// Real activity_offerings/service_resources shape (see _activity-sot.ts) --
// production-matching pedal_boat values (verified directly against
// Supabase project upaokrprawzhgzeqsdke this session): 30min=50 THB,
// 60min=100 THB, inventoryTotal=2.
function pedalBoatOnlyBundle(): KnowledgeBundle {
  return {
    domain: 'activity',
    sources: [{ need: 'price', sourceId: 'activity_catalog', sourceType: 'activity_live', status: 'ok' }],
    facts: [
      fact('activity:pedal_boat:name', 'ปั่นเรือเป็ดน้ำ'),
      fact('activity:pedal_boat:resourceCode', 'activity-pedal-boat'),
      fact('activity:pedal_boat:30min:price', 50),
      fact('activity:pedal_boat:60min:price', 100),
      fact('activity:pedal_boat:inventoryTotal', 2),
    ],
    entities: [],
    missing: [],
    warnings: [],
    freshness: 'live',
  };
}

function staleHorseTask(): ActiveTask {
  return {
    taskId: 't-horse-1', type: 'activity_booking', domain: 'activity', status: 'collecting',
    slots: { resourceCode: 'activity-horse', horseName: 'ภาราดร' }, missingFields: ['date'], selectedEntities: [], constraints: [],
    commitmentIntent: false, sourceChannel: 'line', createdAt: '2026-09-29T10:00:00.000Z', updatedAt: '2026-09-29T10:00:00.000Z',
  };
}

function pedalBoatPriceTurn(): SemanticTurn {
  return {
    domain: 'activity', intent: 'activity_topic_narrow', action: 'discover', informationNeed: 'catalog',
    entities: { activityCode: 'pedal_boat' }, references: [], constraints: [], confidence: 0.9, needsClarification: false,
  };
}

function dialogDecisionWithStaleTask(): DialogDecision {
  const container = { ...emptyTaskStateContainer(), activeTask: staleHorseTask() };
  return {
    mode: 'query_knowledge',
    taskStateContainer: container,
    // Mirrors planKnowledgeNeeds in _dialog-manager.ts: every KnowledgeRequest
    // carries entities straight from the turn, including activityCode.
    knowledgeRequests: [{ intent: 'activity_topic_narrow', action: 'discover', entities: { activityCode: 'pedal_boat' }, constraints: [], task: staleHorseTask(), scope: undefined as never, needs: ['catalog'] } as never],
    missingFields: [],
    responseIntent: 'discovery_response',
    reasons: ['discovery_only'],
  };
}

test('REGRESSION: pedal boat price question answers correctly even while an unrelated horse task is still active', () => {
  const composed = composeGroundedDeterministicResponse({
    channel: 'line',
    language: 'th',
    userMessage: 'เป็ดน้ำเท่าไหร่',
    semanticTurn: pedalBoatPriceTurn(),
    dialogDecision: dialogDecisionWithStaleTask(),
    knowledgeBundles: [pedalBoatOnlyBundle()],
    degradation: { level: 'none', reasons: [] },
  });

  assert.ok(composed, 'must produce a composed response');
  assert.equal(composed!.mode, 'deterministic');
  assert.doesNotMatch(composed!.message, /ยังไม่มีข้อมูลยืนยัน/u, 'must never fall back to the "price not confirmed" apology when canonical pedal_boat rows exist');
  assert.doesNotMatch(composed!.message, /ไม่ขอเดา/u);
  assert.match(composed!.message, /50\s*บาท/u);
  assert.match(composed!.message, /100\s*บาท/u);
});

test('REGRESSION GUARD: horse price still correctly uses the active task resourceCode when THIS turn names nothing explicit', () => {
  const bareTurn: SemanticTurn = {
    domain: 'activity', intent: 'ask_price', action: 'ask', informationNeed: 'price',
    entities: {}, references: [], constraints: [], confidence: 0.8, needsClarification: false,
  };
  const container = { ...emptyTaskStateContainer(), activeTask: staleHorseTask() };
  const dialogDecision: DialogDecision = {
    mode: 'query_knowledge',
    taskStateContainer: container,
    knowledgeRequests: [{ intent: 'ask_price', action: 'ask', entities: {}, constraints: [], task: staleHorseTask(), scope: undefined as never, needs: ['price'] } as never],
    missingFields: [],
    responseIntent: 'grounded_answer',
    reasons: [],
  };
  const horseBundle: KnowledgeBundle = {
    domain: 'activity',
    sources: [{ need: 'price', sourceId: 'activity_catalog', sourceType: 'activity_live', status: 'ok' }],
    facts: [
      fact('activity:horse:name', 'ขี่ม้า'),
      fact('activity:horse:resourceCode', 'activity-horse'),
      fact('activity:horse:30min:price', 300),
      fact('activity:horse:45min:price', 500),
    ],
    entities: [], missing: [], warnings: [], freshness: 'live',
  };
  const composed = composeGroundedDeterministicResponse({
    channel: 'line', language: 'th', userMessage: 'ราคาเท่าไหร่',
    semanticTurn: bareTurn,
    dialogDecision,
    knowledgeBundles: [horseBundle],
    degradation: { level: 'none', reasons: [] },
  });
  assert.ok(composed);
  assert.match(composed!.message, /300\s*บาท/u, 'a bare price question with no explicit activity must still fall back to the active task');
  assert.match(composed!.message, /500\s*บาท/u);
});
