// Live LINE follow-up mandate: two structural failures both traced to the
// same root cause -- 'active_task_summary' turns trusted the semantic
// model's own free-text `reply` (safeModelConversationReply) instead of the
// deterministic, grounded readback (activeTaskSummaryMessage). A model that
// has verified organization knowledge (accommodation exists) and a
// conversational instinct to be "helpful" silently invented content the
// customer never asked about:
//
// - "ที่พักทำมา-ชาติ เฮือนสเตย์" appeared in a summary after a conversation
//   that only ever discussed food and horse riding -- organization
//   knowledge leaking into customer intent.
// - "วันแรก: ขี่ม้า / วันที่สอง: ตำลาว" appeared after the customer merely
//   described an in-visit ORDER ("กินเสร็จแล้วค่อยไปขี่ม้า" -- eat, then
//   ride), never a multi-day stay.
//
// Fix: composeThongthaiResponse now NEVER calls safeModelConversationReply
// for responseIntent='active_task_summary' (it refuses that responseIntent
// outright); the summary is always built by activeTaskSummaryMessage from
// grounded ConversationContext state only. A separate, general safety net
// (assertNoInventedTemporalStructure) blocks day-ordinal labels appearing in
// ANY model-composed customer-facing text unless the customer's own words
// actually grounded a multi-day plan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  composeThongthaiResponse,
  composeDeterministicResponse,
  assertNoInventedTemporalStructure,
  ResponseCompositionError,
  type ResponseComposerInput,
} from '../netlify/functions/_response-composer';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';
import type { DialogDecision } from '../netlify/functions/_dialog-manager';
import { emptyConversationContextState, type ConversationContextState } from '../netlify/functions/_conversation-context';

function baseTurn(overrides: Partial<SemanticTurn> = {}): SemanticTurn {
  return {
    domain: 'general', intent: 'summarize_active_task', action: 'ask',
    informationNeed: 'none', entities: {}, references: [], constraints: [],
    confidence: 0.9, needsClarification: false,
    ...overrides,
  };
}

function summaryDialogDecision(): DialogDecision {
  return {
    mode: 'answer',
    taskStateContainer: emptyTaskStateContainer(),
    knowledgeRequests: [],
    missingFields: [],
    responseIntent: 'active_task_summary',
    reasons: ['task_summary_requested'],
  };
}

// Conversation state matching the mandate's own required regression script:
// food + horse riding discussed, shrimp allergy + mild spice stated, horse
// only "considered" (never booked), accommodation NEVER mentioned.
function foodAndHorseContext(): ConversationContextState {
  const state = emptyConversationContextState();
  return {
    ...state,
    activeDomain: 'general',
    workingMemory: {
      ...state.workingMemory,
      constraints: [
        { domain: 'restaurant', code: 'no_shrimp', observedAt: state.updatedAt },
        { domain: 'restaurant', code: 'low_spicy', observedAt: state.updatedAt },
      ],
      consideredSelections: [
        { domain: 'activity', name: 'ภาราดร', status: 'considering', observedAt: state.updatedAt },
      ],
    },
    recentEntities: [
      { id: 'activity:horse', name: 'ขี่ม้า', type: 'activity', domain: 'activity', source: 'catalog', canonical: true, observedAt: state.updatedAt },
      { id: 'menu:tam-lao', name: 'ตำลาว', type: 'menu', domain: 'restaurant', source: 'catalog', canonical: true, observedAt: state.updatedAt },
    ],
  };
}

function baseInput(overrides: Partial<ResponseComposerInput> = {}): ResponseComposerInput {
  return {
    channel: 'line',
    language: 'th',
    userMessage: 'สรุปให้หน่อยว่าตอนนี้ผมสนใจอะไรไว้บ้าง แต่ยังไม่ได้จองอะไรใช่ไหม',
    semanticTurn: baseTurn(),
    conversationContext: foodAndHorseContext(),
    dialogDecision: summaryDialogDecision(),
    knowledgeBundles: [],
    degradation: { level: 'none', reasons: [] },
    ...overrides,
  };
}

test('A: a summary never mentions accommodation/stay when the customer never discussed it, even when the model itself tries to inject it', async () => {
  const hostileReply = 'ตอนนี้สนใจอาหารและขี่ม้าครับ นอกจากนี้แนะนำที่พักทำมา-ชาติ เฮือนสเตย์ ด้วยนะครับ';
  const input = baseInput({ semanticTurn: baseTurn({ reply: hostileReply }) });
  const composed = await composeThongthaiResponse(input);
  assert.doesNotMatch(composed.message, /เฮือนสเตย์|ที่พัก|หัองพัก|โฮมสเตย์|hotel|stay/iu,
    'organization knowledge (accommodation exists) must never leak into a summary the customer never asked for');
  assert.match(composed.message, /อาหาร/u, 'must still reflect the genuinely discussed food interest');
  assert.match(composed.message, /กิจกรรม/u, 'must still reflect the genuinely discussed activity interest');
});

test('A: the deterministic summary itself never invents an undiscussed domain', () => {
  const composed = composeDeterministicResponse(baseInput());
  assert.doesNotMatch(composed.message, /เฮือนสเตย์|ที่พัก|คาเฟ่|ของฝาก|OTOP/iu);
});

test('B: assertNoInventedTemporalStructure blocks an invented Day-1/Day-2 itinerary from a mere sequence statement', () => {
  const input: Pick<ResponseComposerInput, 'userMessage' | 'conversationContext'> = {
    userMessage: 'ถ้ากินเสร็จแล้วค่อยไปขี่ม้า แบบนี้โอเคไหม',
    conversationContext: foodAndHorseContext(),
  };
  assert.throws(
    () => assertNoInventedTemporalStructure('ได้ครับ วันแรก: ขี่ม้า วันที่สอง: ตำลาว', input),
    (error: unknown) => error instanceof ResponseCompositionError,
    'an in-visit ORDER ("eat, then ride") must never be rewritten into separate calendar days',
  );
});

test('B: assertNoInventedTemporalStructure allows day labels when the customer themselves supplied multi-day context', () => {
  const input: Pick<ResponseComposerInput, 'userMessage' | 'conversationContext'> = {
    userMessage: 'พักสองวันหนึ่งคืน วันแรกอยากขี่ม้า วันที่สองอยากไปตลาด',
    conversationContext: emptyConversationContextState(),
  };
  assert.doesNotThrow(() => assertNoInventedTemporalStructure('ได้ครับ วันแรก: ขี่ม้า วันที่สอง: ไปตลาด', input));
});

test('C: no explicit day/duration count is ever asserted when the customer never gave one -- composeThongthaiResponse refuses to expose the invented text rather than silently passing it through', async () => {
  // The customer's own words ("กินเสร็จแล้วค่อยไปขี่ม้า") never supply a day
  // count, so composeThongthaiResponse must not let a model-composed reply
  // claiming otherwise reach the customer. It refuses via the same
  // ResponseCompositionError mechanism assertOperationalClaimSafety already
  // uses for a false booking claim -- the caller (processThongthaiChatCore)
  // degrades to an honest fallback rather than ever seeing this string.
  const hostileReply = 'จัดให้เลยครับ วันแรก: ขี่ม้าตอนเช้า วันที่สอง: ไปตลาดตำลาว';
  const sequenceTurn = baseTurn({
    intent: 'confirm_activity_sequence', reply: hostileReply, action: 'confirm',
  });
  const dialogDecision: DialogDecision = {
    mode: 'answer',
    taskStateContainer: emptyTaskStateContainer(),
    knowledgeRequests: [],
    missingFields: [],
    responseIntent: 'grounded_answer',
    reasons: [],
  };
  const input = baseInput({
    userMessage: 'ถ้ากินเสร็จแล้วค่อยไปขี่ม้า แบบนี้โอเคไหม',
    semanticTurn: sequenceTurn,
    dialogDecision,
  });
  await assert.rejects(
    () => composeThongthaiResponse(input),
    (error: unknown) => error instanceof ResponseCompositionError,
    'a same-visit sequence must never let an invented multi-day reply through, even when the model proposes one',
  );
});

test('D: a horse the customer explicitly left unbooked ("ไว้ก่อน แต่ยังไม่จอง") stays tentative, never confirmed, in the summary', () => {
  const composed = composeDeterministicResponse(baseInput());
  assert.match(composed.message, /ภาราดร/u, 'the considered horse must still be named');
  assert.match(composed.message, /ยังไม่ได้ยืนยันการจอง|ยังไม่ได้จองหรือส่งรายการ/u,
    'must explicitly state nothing has been booked');
  assert.doesNotMatch(composed.message, /จองเรียบร้อย|ยืนยันการจองแล้ว|booked|confirmed/iu);
});

test('E: cross-domain preferences (shrimp allergy + mild spice from the restaurant domain) survive into the summary alongside an unrelated activity-domain interest', () => {
  const composed = composeDeterministicResponse(baseInput());
  assert.match(composed.message, /กุ้ง/u, 'the stated shrimp allergy/exclusion must be readable back');
  assert.match(composed.message, /เผ็ด/u, 'the stated mild-spice preference must be readable back');
  assert.match(composed.message, /อาหาร/u);
  assert.match(composed.message, /กิจกรรม/u);
});

test('E: an unrelated internal/operational constraint code is never rendered verbatim as a customer preference', () => {
  const state = emptyConversationContextState();
  const context: ConversationContextState = {
    ...state,
    workingMemory: {
      ...state.workingMemory,
      constraints: [
        { domain: 'journey', code: 'consult_partner_first', observedAt: state.updatedAt },
        { domain: 'restaurant', code: 'recommend_2_to_3_items', observedAt: state.updatedAt },
      ],
    },
  };
  const composed = composeDeterministicResponse(baseInput({ conversationContext: context }));
  assert.doesNotMatch(composed.message, /consult_partner_first|recommend_2_to_3_items/u,
    'unrecognized/operational constraint codes must be silently omitted, never guessed at or rendered raw');
});
