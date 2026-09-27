// Human Core PR D: the ONE generic activity care/safety/suitability/
// equipment capability -- consumes only the semantic supervisor's own
// informationNeed (safety/suitability/equipment) plus a static, verified
// policy fact, never raw customer text. Supersedes horseCareFearResponse/
// horseSafetyQuestionResponse/atvCareIntentResponse/archeryCareIntentResponse
// for whatever this capability already covers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderActivityCareResponse, type HumanGroundedRenderInput } from '../netlify/functions/_human-grounded-response';
import { composeGroundedDeterministicResponse } from '../netlify/functions/_response-composer';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';
import type { DialogDecision } from '../netlify/functions/_dialog-manager';

function turn(overrides: Partial<SemanticTurn> = {}): SemanticTurn {
  return {
    domain: 'activity', intent: 'safety_question', action: 'ask', informationNeed: 'safety',
    entities: {}, references: [], constraints: [], confidence: 0.9, needsClarification: false,
    ...overrides,
  };
}

function baseDialogDecision(overrides: Partial<DialogDecision> = {}): DialogDecision {
  return {
    mode: 'answer', taskStateContainer: emptyTaskStateContainer(), knowledgeRequests: [],
    missingFields: [], responseIntent: 'grounded_answer', reasons: [],
    ...overrides,
  };
}

function input(semanticTurn: SemanticTurn, dialogDecision: DialogDecision = baseDialogDecision()): HumanGroundedRenderInput {
  return { language: 'th', semanticTurn, dialogDecision, knowledgeBundles: [] };
}

test('a general safety question with no known activity type still gets the shared no-guarantee policy answer', () => {
  const result = renderActivityCareResponse(input(turn({ informationNeed: 'safety' })));
  assert.ok(result);
  assert.match(result!.message, /ไม่กล้าการันตีว่าปลอดภัย 100%/);
});

test('a suitability question with entities.activityCode=horse gets the horse-specific verified fact', () => {
  const result = renderActivityCareResponse(input(turn({ informationNeed: 'suitability', entities: { activityCode: 'horse' } })));
  assert.ok(result);
  assert.match(result!.message, /ทีมจะช่วยดูใกล้ ๆ ให้ตลอดครับ/);
});

test('an equipment question with entities.activityCode=atv gets the ATV brake/control fact', () => {
  const result = renderActivityCareResponse(input(turn({ informationNeed: 'equipment', entities: { activityCode: 'atv' } })));
  assert.ok(result);
  assert.match(result!.message, /สอนวิธีเบรกและควบคุมรถ/);
});

test('an equipment question for archery (no verified equipment fact beyond photo-only) still answers honestly, never inventing text', () => {
  const result = renderActivityCareResponse(input(turn({ informationNeed: 'equipment', entities: { activityCode: 'archery' } })));
  assert.ok(result);
  assert.match(result!.message, /ถ่ายรูปกับธนู/);
});

test('a resourceCode already known from the active task is used even without entities.activityCode restated this turn', () => {
  const container = emptyTaskStateContainer();
  const withTask = {
    ...container,
    activeTask: {
      taskId: 't1', type: 'activity_booking' as const, domain: 'activity' as const, status: 'collecting' as const,
      slots: { resourceCode: 'activity-atv' }, missingFields: [], selectedEntities: [], constraints: [],
      commitmentIntent: false, sourceChannel: 'web' as const, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    },
  };
  const result = renderActivityCareResponse(input(turn({ informationNeed: 'suitability', entities: {} }), baseDialogDecision({ taskStateContainer: withTask })));
  assert.ok(result);
  assert.match(result!.message, /บรีฟวิธีขับและกติกาความปลอดภัย/);
});

test('a non-care informationNeed (e.g. availability) never triggers this responder', () => {
  assert.equal(renderActivityCareResponse(input(turn({ informationNeed: 'availability' }))), null);
});

test('a non-activity domain never triggers this responder even with informationNeed=safety', () => {
  assert.equal(renderActivityCareResponse(input(turn({ domain: 'restaurant', informationNeed: 'safety' }))), null);
});

test('a suitability question with no resolvable resourceCode at all returns null rather than guessing an activity', () => {
  assert.equal(renderActivityCareResponse(input(turn({ informationNeed: 'suitability', entities: {} }))), null);
});

// Proves the actual WIRING (import + chain order in _response-composer.ts's
// composeGroundedDeterministicResponse), not just the isolated renderer --
// this is the same function _thongthai-one-mind-response.ts calls for a
// 'composed' turn, so this confirms a real 'composed' activity safety
// question reaches the verified-fact answer with zero model calls.
test('composeGroundedDeterministicResponse (the real composed-turn path) reaches the new care capability', () => {
  const composed = composeGroundedDeterministicResponse({
    channel: 'web', language: 'th', userMessage: 'ปลอดภัยไหม',
    semanticTurn: turn({ informationNeed: 'safety', entities: { activityCode: 'horse' } }),
    dialogDecision: baseDialogDecision(),
    knowledgeBundles: [],
    degradation: { level: 'none', reasons: [] },
  });
  assert.ok(composed);
  assert.equal(composed!.mode, 'deterministic');
  assert.match(composed!.message, /ไม่กล้าการันตีว่าปลอดภัย 100%/);
});
