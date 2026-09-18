// Multi-turn golden scenarios (Phase C). Grown alongside tests/fixtures/
// semantic-eval-corpus.ts toward the >=150 total scenario count -- each turn
// below counts as one scenario. Network-free: each turn carries a
// simulatedModelOutput (see semantic-eval-corpus.ts's header for why), used
// to drive the SAME parseSemanticTurnResponse validation layer against the
// conversation-context reducer's output, proving continuity end-to-end
// without a live model call. Live model conformance for these turns is
// deferred to the same acceptance job as the rest of the corpus (see
// SEMANTIC_EVAL_STATUS in _semantic-interpreter.ts).

import type { SemanticAction, SemanticDomain } from '../../netlify/functions/_semantic-interpreter';
import type { ConversationContextUpdate } from '../../netlify/functions/_conversation-context';

export type MultiTurnScenarioStep = {
  message: string;
  channel: string;
  eventId: string;
  simulatedModelOutput: Record<string, unknown>;
  expected: { domain: SemanticDomain; action?: SemanticAction };
  /** The context update this turn's downstream logic (a later phase's Dialog
   *  Manager) would apply, given the interpreted SemanticTurn. Phase C only
   *  proves this update composes correctly with the reducer -- it does not
   *  execute it against a real tool/DB. */
  contextUpdate: Omit<ConversationContextUpdate, 'userMessage' | 'channel' | 'eventId'>;
};

/**
 * The exact scenario from the Phase C brief: broad discovery -> domain
 * narrowing -> comparison -> selection -> continuation -> availability ask.
 * Do NOT fake availability or claim a booking anywhere in this scenario --
 * real availability/action comes in later phases (Dialog Manager +
 * Knowledge Resolver + transaction layer).
 */
export const HORSE_BOOKING_SCENARIO: MultiTurnScenarioStep[] = [
  {
    message: 'มีไรทำมั่ง',
    channel: 'web',
    eventId: 'horse-scenario-1',
    simulatedModelOutput: { domain: 'ecosystem', intent: 'broad_experience_discovery', action: 'discover', entities: {}, references: [], constraints: [], confidence: 0.87, needsClarification: false },
    expected: { domain: 'ecosystem', action: 'discover' },
    contextUpdate: { activeDomain: 'ecosystem', lastAction: 'discover', summaryFact: 'customer asked what there is to do (broad discovery)' },
  },
  {
    message: 'ม้าล่ะ',
    channel: 'web',
    eventId: 'horse-scenario-2',
    simulatedModelOutput: { domain: 'activity', intent: 'ask_about_horse_activity', action: 'ask', entities: {}, references: [], constraints: [], confidence: 0.78, needsClarification: false },
    expected: { domain: 'activity', action: 'ask' },
    contextUpdate: {
      activeDomain: 'activity', activeTopic: 'horse activity', lastAction: 'ask',
      newEntities: [
        { id: 'conv:horse:thongthai', type: 'horse', name: 'ทองไทย', domain: 'activity', source: 'conversation', canonical: false },
        { id: 'conv:horse:paradon', type: 'horse', name: 'ภาราดร', domain: 'activity', source: 'conversation', canonical: false },
      ],
      summaryFact: 'customer asked specifically about horse riding; ทองไทย and ภาราดร introduced',
    },
  },
  {
    message: 'ตัวไหนนิสัยดีกว่า',
    channel: 'web',
    eventId: 'horse-scenario-3',
    simulatedModelOutput: { domain: 'activity', intent: 'compare_horses_by_temperament', action: 'compare', entities: {}, references: [{ type: 'entity_selection', refersToPriorContext: true }], constraints: [], confidence: 0.8, needsClarification: false },
    expected: { domain: 'activity', action: 'compare' },
    contextUpdate: { lastAction: 'compare' },
  },
  {
    message: 'เอาภาราดร',
    channel: 'web',
    eventId: 'horse-scenario-4',
    simulatedModelOutput: { domain: 'activity', intent: 'select_horse', action: 'confirm', entities: { horseName: 'ภาราดร' }, references: [{ type: 'entity_selection', value: 'ภาราดร', refersToPriorContext: true }], constraints: [], confidence: 0.92, needsClarification: false },
    expected: { domain: 'activity', action: 'confirm' },
    contextUpdate: {
      lastAction: 'confirm', currentTaskReference: 'activity_booking:horse:paradon',
      newEntities: [{ id: 'conv:horse:paradon', type: 'horse', name: 'ภาราดร', domain: 'activity', source: 'conversation', canonical: false }],
      summaryFact: 'customer selected ภาราดร',
    },
  },
  {
    message: 'พรุ่งนี้สองคน',
    channel: 'line', // cross-channel continuation within the same scenario, proving the SAME task survives a channel switch mid-flow
    eventId: 'horse-scenario-5',
    simulatedModelOutput: { domain: 'activity', intent: 'provide_booking_slot_info', action: 'provide_information', entities: { date: 'พรุ่งนี้', partySize: 2 }, references: [{ type: 'implicit_continuation', refersToPriorContext: true }], constraints: [], confidence: 0.88, needsClarification: false },
    expected: { domain: 'activity', action: 'provide_information' },
    contextUpdate: { lastAction: 'provide_information', openQuestion: 'specific available time', summaryFact: 'customer wants tomorrow, 2 people' },
  },
  {
    message: 'บ่ายสามได้ปะ',
    channel: 'line',
    eventId: 'horse-scenario-6',
    simulatedModelOutput: { domain: 'activity', intent: 'check_specific_time_availability', action: 'ask', entities: { time: 'บ่ายสาม' }, references: [{ type: 'implicit_continuation', refersToPriorContext: true }], constraints: [], confidence: 0.83, needsClarification: false },
    expected: { domain: 'activity', action: 'ask' },
    // Real availability/action is NOT decided here -- Phase C stops at
    // "the system knows exactly what service/entity/date/party/time this
    // refers to." Whether บ่ายสาม is actually open is a later phase's job.
    contextUpdate: { lastAction: 'ask' },
  },
];
