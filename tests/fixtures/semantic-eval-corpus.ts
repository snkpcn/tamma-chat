// Golden conversation eval corpus (Phase L target: 150+; this is Phase B's first
// slice, grown every phase per THONGTHAI_HANDOFF.md). Each case pairs a real
// customer-shaped message with the SemanticTurn classification a correctly
// functioning interpreter should produce, plus a "simulatedModelOutput" -- the
// raw JSON a model SHOULD return for this case, used to test the deterministic
// validation/reference-resolution layer without a live network call (no API keys
// in this dev environment; this repo's test convention keeps `npm test` network-free
// -- see _thongthai-brain-v3.ts's interpretStayBookingTurn for the same established
// pattern). This corpus is ALSO the ground truth a live acceptance pass should
// verify the real model against before Phase O's final integration, the same way
// every earlier phase in this program was verified live against production.

import type { SemanticAction, SemanticContext, SemanticDomain } from '../../netlify/functions/_semantic-interpreter';

export type SemanticEvalCategory =
  | 'formal' | 'colloquial' | 'typo' | 'follow_up' | 'correction'
  | 'topic_switch' | 'ambiguous' | 'multi_intent';

export type SemanticEvalCase = {
  id: string;
  group?: string;
  category: SemanticEvalCategory;
  domainArea: SemanticDomain;
  message: string;
  context?: SemanticContext;
  expected: {
    domain: SemanticDomain;
    action?: SemanticAction;
    needsClarification?: boolean;
  };
  simulatedModelOutput: Record<string, unknown>;
};

const HORSE_CONTEXT: SemanticContext = {
  activeDomain: 'activity',
  recentEntities: [
    { id: 'horse:thongthai', type: 'horse', name: 'ทองไทย', domain: 'activity' },
    { id: 'horse:paradon', type: 'horse', name: 'ภาราดร', domain: 'activity' },
  ],
  lastAction: 'discover',
  openQuestion: undefined,
};

const RESTAURANT_SET_CONTEXT: SemanticContext = {
  activeDomain: 'restaurant',
  recentEntities: [
    { id: 'menu_set:budget_700_3pax', type: 'proposed_set', name: 'ชุดงบ 700 สามคน', domain: 'restaurant' },
  ],
  lastAction: 'recommend',
  openQuestion: 'pickup date/time and customer name',
};

const PROMO_CONTEXT: SemanticContext = {
  activeDomain: 'promotion',
  recentEntities: [
    { id: 'promo:tomyum_bundle', type: 'promotion', name: 'ชุดต้มยำโปร', domain: 'promotion' },
  ],
  lastAction: 'discover',
};

export const SEMANTIC_EVAL_CORPUS: SemanticEvalCase[] = [
  // --- Semantic equivalence group: broad ecosystem discovery (7 variants, user-specified) ---
  { id: 'discover-01', group: 'broad_discovery', category: 'formal', domainArea: 'ecosystem',
    message: 'มีอะไรทำบ้าง',
    expected: { domain: 'ecosystem', action: 'discover' },
    simulatedModelOutput: { domain: 'ecosystem', intent: 'broad_experience_discovery', action: 'discover', entities: {}, references: [], constraints: [], confidence: 0.9, needsClarification: false } },
  { id: 'discover-02', group: 'broad_discovery', category: 'colloquial', domainArea: 'ecosystem',
    message: 'มีไรทำมั่ง',
    expected: { domain: 'ecosystem', action: 'discover' },
    simulatedModelOutput: { domain: 'ecosystem', intent: 'broad_experience_discovery', action: 'discover', entities: {}, references: [], constraints: [], confidence: 0.87, needsClarification: false } },
  { id: 'discover-03', group: 'broad_discovery', category: 'colloquial', domainArea: 'ecosystem',
    message: 'มีไรทำมั้ง',
    expected: { domain: 'ecosystem', action: 'discover' },
    simulatedModelOutput: { domain: 'ecosystem', intent: 'broad_experience_discovery', action: 'discover', entities: {}, references: [], constraints: [], confidence: 0.87, needsClarification: false } },
  { id: 'discover-04', group: 'broad_discovery', category: 'colloquial', domainArea: 'ecosystem',
    message: 'มีไรให้เล่น',
    expected: { domain: 'ecosystem', action: 'discover' },
    simulatedModelOutput: { domain: 'ecosystem', intent: 'broad_experience_discovery', action: 'discover', entities: {}, references: [], constraints: [], confidence: 0.85, needsClarification: false } },
  { id: 'discover-05', group: 'broad_discovery', category: 'colloquial', domainArea: 'ecosystem',
    message: 'แถวนี้ทำไรดี',
    expected: { domain: 'ecosystem', action: 'discover' },
    simulatedModelOutput: { domain: 'ecosystem', intent: 'broad_experience_discovery', action: 'discover', entities: {}, references: [], constraints: [], confidence: 0.8, needsClarification: false } },
  { id: 'discover-06', group: 'broad_discovery', category: 'formal', domainArea: 'ecosystem',
    message: 'ที่นี่มีอะไรน่าทำ',
    expected: { domain: 'ecosystem', action: 'discover' },
    simulatedModelOutput: { domain: 'ecosystem', intent: 'broad_experience_discovery', action: 'discover', entities: {}, references: [], constraints: [], confidence: 0.88, needsClarification: false } },
  { id: 'discover-07', group: 'broad_discovery', category: 'colloquial', domainArea: 'ecosystem',
    message: 'พาแฟนมา มีไรทำ',
    expected: { domain: 'ecosystem', action: 'discover' },
    simulatedModelOutput: { domain: 'ecosystem', intent: 'broad_experience_discovery', action: 'discover', entities: { travelerType: 'couple' }, references: [], constraints: [], confidence: 0.82, needsClarification: false } },

  // --- Semantic equivalence group: restaurant recommendation (3 variants, user-specified) ---
  { id: 'restaurant-01', group: 'restaurant_recommendation', category: 'colloquial', domainArea: 'restaurant',
    message: 'ร้านมีไรกิน',
    expected: { domain: 'restaurant', action: 'recommend' },
    simulatedModelOutput: { domain: 'restaurant', intent: 'menu_recommendation_request', action: 'recommend', entities: {}, references: [], constraints: [], confidence: 0.88, needsClarification: false } },
  { id: 'restaurant-02', group: 'restaurant_recommendation', category: 'colloquial', domainArea: 'restaurant',
    message: 'มีเมนูไรมั่ง',
    expected: { domain: 'restaurant', action: 'recommend' },
    simulatedModelOutput: { domain: 'restaurant', intent: 'menu_recommendation_request', action: 'recommend', entities: {}, references: [], constraints: [], confidence: 0.85, needsClarification: false } },
  { id: 'restaurant-03', group: 'restaurant_recommendation', category: 'formal', domainArea: 'restaurant',
    message: 'แนะนำอะไรกินหน่อย',
    expected: { domain: 'restaurant', action: 'recommend' },
    simulatedModelOutput: { domain: 'restaurant', intent: 'menu_recommendation_request', action: 'recommend', entities: {}, references: [], constraints: [], confidence: 0.9, needsClarification: false } },

  // --- Semantic equivalence group: stay availability (2 variants, user-specified) ---
  { id: 'stay-01', group: 'stay_availability', category: 'colloquial', domainArea: 'stay',
    message: 'มีห้องปะ',
    expected: { domain: 'stay', action: 'ask' },
    simulatedModelOutput: { domain: 'stay', intent: 'room_availability_query', action: 'ask', entities: {}, references: [], constraints: [], confidence: 0.83, needsClarification: false } },
  { id: 'stay-02', group: 'stay_availability', category: 'formal', domainArea: 'stay',
    message: 'พรุ่งนี้ว่างไหม',
    expected: { domain: 'stay', action: 'ask' },
    simulatedModelOutput: { domain: 'stay', intent: 'room_availability_query', action: 'ask', entities: { date: 'พรุ่งนี้' }, references: [], constraints: [], confidence: 0.75, needsClarification: false } },

  // --- Semantic equivalence group: promotion discovery/status (2 variants, user-specified) ---
  { id: 'promotion-01', group: 'promotion_discovery', category: 'colloquial', domainArea: 'promotion',
    message: 'โปรมีไร',
    expected: { domain: 'promotion', action: 'discover' },
    simulatedModelOutput: { domain: 'promotion', intent: 'promotion_discovery', action: 'discover', entities: {}, references: [], constraints: [], confidence: 0.87, needsClarification: false } },
  { id: 'promotion-02', group: 'promotion_status', category: 'colloquial', domainArea: 'promotion',
    message: 'โปรเมื่อกี้ยังได้อยู่ไหม',
    context: PROMO_CONTEXT,
    expected: { domain: 'promotion', action: 'status' },
    simulatedModelOutput: { domain: 'promotion', intent: 'promotion_status_check', action: 'status',
      entities: {}, references: [{ type: 'previous_selection', value: 'โปรเมื่อกี้', refersToPriorContext: true }],
      constraints: [], confidence: 0.8, needsClarification: false } },

  // --- Reference resolution group (user-specified follow-ups, all with horse activity context) ---
  { id: 'reference-01', group: 'reference_resolution', category: 'follow_up', domainArea: 'activity',
    message: 'ม้าล่ะ',
    context: { activeDomain: 'ecosystem', recentEntities: [], lastAction: 'discover' },
    expected: { domain: 'activity', action: 'ask' },
    simulatedModelOutput: { domain: 'activity', intent: 'ask_about_horse_activity', action: 'ask', entities: {}, references: [], constraints: [], confidence: 0.78, needsClarification: false } },
  { id: 'reference-02', group: 'reference_resolution', category: 'follow_up', domainArea: 'activity',
    message: 'ตัวไหน',
    context: HORSE_CONTEXT,
    expected: { domain: 'activity', action: 'ask' },
    simulatedModelOutput: { domain: 'activity', intent: 'ask_which_horse', action: 'ask', entities: {},
      references: [{ type: 'entity_selection', refersToPriorContext: true }], constraints: [], confidence: 0.72, needsClarification: false } },
  { id: 'reference-03', group: 'reference_resolution', category: 'follow_up', domainArea: 'activity',
    message: 'เอาภาราดร',
    context: HORSE_CONTEXT,
    expected: { domain: 'activity', action: 'confirm' },
    simulatedModelOutput: { domain: 'activity', intent: 'select_horse', action: 'confirm', entities: { horseName: 'ภาราดร' },
      references: [{ type: 'entity_selection', value: 'ภาราดร', refersToPriorContext: true }], constraints: [], confidence: 0.92, needsClarification: false } },
  { id: 'reference-04', group: 'reference_resolution', category: 'follow_up', domainArea: 'restaurant',
    message: 'อันเมื่อกี้',
    context: RESTAURANT_SET_CONTEXT,
    expected: { domain: 'restaurant', action: 'confirm' },
    simulatedModelOutput: { domain: 'restaurant', intent: 'accept_previous_set', action: 'confirm', entities: {},
      references: [{ type: 'previous_selection', value: 'อันเมื่อกี้', refersToPriorContext: true }], constraints: [], confidence: 0.8, needsClarification: false } },
  { id: 'reference-05', group: 'reference_resolution', category: 'correction', domainArea: 'activity',
    message: 'ไม่ใช่ หมายถึงม้า',
    context: { activeDomain: 'activity', recentEntities: [{ id: 'activity:atv', type: 'activity', name: 'ATV', domain: 'activity' }], lastAction: 'recommend' },
    expected: { domain: 'activity', action: 'correct_previous' },
    simulatedModelOutput: { domain: 'activity', intent: 'correct_activity_choice', action: 'correct_previous', entities: { activityType: 'horse' },
      references: [{ type: 'previous_turn', refersToPriorContext: true }], constraints: [], confidence: 0.85, needsClarification: false } },
  { id: 'reference-06', group: 'reference_resolution', category: 'follow_up', domainArea: 'activity',
    message: 'พรุ่งนี้สองคน',
    context: { activeDomain: 'activity', recentEntities: [{ id: 'horse:paradon', type: 'horse', name: 'ภาราดร', domain: 'activity' }], lastAction: 'confirm', openQuestion: 'date and party size' },
    expected: { domain: 'activity', action: 'provide_information' },
    simulatedModelOutput: { domain: 'activity', intent: 'provide_booking_slot_info', action: 'provide_information',
      entities: { date: 'พรุ่งนี้', partySize: 2 }, references: [{ type: 'implicit_continuation', refersToPriorContext: true }], constraints: [], confidence: 0.88, needsClarification: false } },
  { id: 'reference-07', group: 'reference_resolution', category: 'follow_up', domainArea: 'activity',
    message: 'บ่ายสามได้ปะ',
    context: { activeDomain: 'activity', recentEntities: [{ id: 'horse:paradon', type: 'horse', name: 'ภาราดร', domain: 'activity' }], lastAction: 'provide_information', openQuestion: 'specific available time' },
    expected: { domain: 'activity', action: 'ask' },
    simulatedModelOutput: { domain: 'activity', intent: 'check_specific_time_availability', action: 'ask',
      entities: { time: 'บ่ายสาม' }, references: [{ type: 'implicit_continuation', refersToPriorContext: true }], constraints: [], confidence: 0.83, needsClarification: false } },

  // --- The exact user-specified comparison case ---
  { id: 'reference-08-compare', group: 'reference_resolution', category: 'follow_up', domainArea: 'activity',
    message: 'ตัวไหนนิสัยดีกว่า',
    context: HORSE_CONTEXT,
    expected: { domain: 'activity', action: 'compare', needsClarification: false },
    simulatedModelOutput: { domain: 'activity', intent: 'compare_horses_by_temperament', action: 'compare', entities: {},
      references: [{ type: 'entity_selection', refersToPriorContext: true }], constraints: [], confidence: 0.8, needsClarification: false } },

  // --- Typos / abbreviations beyond the required groups ---
  { id: 'typo-01', category: 'typo', domainArea: 'ecosystem',
    message: 'มีอะไลทำบ้าง',
    expected: { domain: 'ecosystem', action: 'discover' },
    simulatedModelOutput: { domain: 'ecosystem', intent: 'broad_experience_discovery', action: 'discover', entities: {}, references: [], constraints: [], confidence: 0.7, needsClarification: false } },
  { id: 'typo-02', category: 'typo', domainArea: 'restaurant',
    message: 'ร้านมีอารัยกิน',
    expected: { domain: 'restaurant', action: 'recommend' },
    simulatedModelOutput: { domain: 'restaurant', intent: 'menu_recommendation_request', action: 'recommend', entities: {}, references: [], constraints: [], confidence: 0.68, needsClarification: false } },
  { id: 'typo-03', category: 'typo', domainArea: 'stay',
    message: 'มีห้องพักไหมค่ะ พรุ่งนี้',
    expected: { domain: 'stay', action: 'ask' },
    simulatedModelOutput: { domain: 'stay', intent: 'room_availability_query', action: 'ask', entities: { date: 'พรุ่งนี้' }, references: [], constraints: [], confidence: 0.85, needsClarification: false } },

  // --- Topic switches ---
  { id: 'topic-switch-01', category: 'topic_switch', domainArea: 'activity',
    message: 'เอาล่ะ พอแล้วเรื่องม้า ขอถามเรื่องที่พักแทน มีห้องว่างไหม',
    context: HORSE_CONTEXT,
    expected: { domain: 'stay', action: 'ask' },
    simulatedModelOutput: { domain: 'stay', intent: 'room_availability_query', action: 'ask', entities: {}, references: [], constraints: [], confidence: 0.86, needsClarification: false } },
  { id: 'topic-switch-02', category: 'topic_switch', domainArea: 'promotion',
    message: 'อ้อ ลืมถาม มีโปรอะไรบ้างตอนนี้',
    context: RESTAURANT_SET_CONTEXT,
    expected: { domain: 'promotion', action: 'discover' },
    simulatedModelOutput: { domain: 'promotion', intent: 'promotion_discovery', action: 'discover', entities: {}, references: [], constraints: [], confidence: 0.84, needsClarification: false } },

  // --- Multi-intent ---
  { id: 'multi-intent-01', category: 'multi_intent', domainArea: 'restaurant',
    message: 'ร้านมีไรกิน แล้วก็อยากรู้ด้วยว่ามีโปรไหม',
    expected: { domain: 'restaurant', action: 'recommend' },
    simulatedModelOutput: { domain: 'restaurant', intent: 'menu_recommendation_request_with_promo_interest', action: 'recommend',
      entities: {}, references: [], constraints: [], confidence: 0.7, needsClarification: false } },

  // --- Ambiguous cases requiring clarification ---
  { id: 'ambiguous-01', category: 'ambiguous', domainArea: 'unknown',
    message: 'เอาอันนั้น',
    context: emptyContextForTest(),
    expected: { domain: 'unknown', needsClarification: true },
    simulatedModelOutput: { domain: 'unknown', intent: 'unclear_selection', action: 'unknown', entities: {},
      references: [{ type: 'previous_selection', value: 'อันนั้น', refersToPriorContext: true }], constraints: [], confidence: 0.3, needsClarification: true, clarificationReason: 'no prior context to resolve against' } },
  { id: 'ambiguous-02', category: 'ambiguous', domainArea: 'activity',
    message: 'ตัวไหนดี',
    context: { activeDomain: 'activity', recentEntities: [
      { id: 'horse:thongthai', type: 'horse', name: 'ทองไทย', domain: 'activity' },
      { id: 'horse:paradon', type: 'horse', name: 'ภาราดร', domain: 'activity' },
      { id: 'atv:standard', type: 'activity', name: 'ATV', domain: 'activity' },
    ] },
    expected: { domain: 'activity', needsClarification: false },
    simulatedModelOutput: { domain: 'activity', intent: 'ask_recommendation_among_options', action: 'ask', entities: {},
      references: [{ type: 'entity_selection', refersToPriorContext: true }], constraints: [], confidence: 0.6, needsClarification: false } },
  { id: 'ambiguous-03', category: 'ambiguous', domainArea: 'support',
    message: 'ช่วยหน่อย',
    expected: { domain: 'support', needsClarification: true },
    simulatedModelOutput: { domain: 'support', intent: 'vague_help_request', action: 'unknown', entities: {}, references: [], constraints: [], confidence: 0.35, needsClarification: true, clarificationReason: 'no specific request stated' } },

  // --- Activity domain breadth (ATV/archery, not just horses) ---
  { id: 'activity-atv-01', category: 'formal', domainArea: 'activity',
    message: 'ขี่ ATV ได้ไหม พรุ่งนี้',
    expected: { domain: 'activity', action: 'ask' },
    simulatedModelOutput: { domain: 'activity', intent: 'atv_availability_query', action: 'ask', entities: { activityType: 'atv', date: 'พรุ่งนี้' }, references: [], constraints: [], confidence: 0.87, needsClarification: false } },
  { id: 'activity-archery-01', category: 'colloquial', domainArea: 'activity',
    message: 'ยิงธนูเล่นไงเหรอ',
    expected: { domain: 'activity', action: 'ask' },
    simulatedModelOutput: { domain: 'activity', intent: 'ask_activity_how_it_works', action: 'ask', entities: { activityType: 'archery' }, references: [], constraints: [], confidence: 0.82, needsClarification: false } },

  // --- Membership ---
  { id: 'membership-01', category: 'formal', domainArea: 'membership',
    message: 'สมัครสมาชิกยังไง',
    expected: { domain: 'membership', action: 'ask' },
    simulatedModelOutput: { domain: 'membership', intent: 'membership_signup_query', action: 'ask', entities: {}, references: [], constraints: [], confidence: 0.9, needsClarification: false } },
  { id: 'membership-02', category: 'colloquial', domainArea: 'membership',
    message: 'ขอดูข้อมูลสมาชิกหน่อย',
    expected: { domain: 'membership', action: 'status' },
    simulatedModelOutput: { domain: 'membership', intent: 'view_membership_profile', action: 'status', entities: {}, references: [], constraints: [], confidence: 0.85, needsClarification: false } },

  // --- OTOP ---
  { id: 'otop-01', category: 'formal', domainArea: 'otop',
    message: 'มีสินค้า OTOP อะไรขายบ้าง',
    expected: { domain: 'otop', action: 'discover' },
    simulatedModelOutput: { domain: 'otop', intent: 'otop_product_discovery', action: 'discover', entities: {}, references: [], constraints: [], confidence: 0.88, needsClarification: false } },
  { id: 'otop-02', category: 'colloquial', domainArea: 'otop',
    message: 'ขอสั่งของฝากสักอัน',
    expected: { domain: 'otop', action: 'order' },
    simulatedModelOutput: { domain: 'otop', intent: 'otop_order_intent', action: 'order', entities: {}, references: [], constraints: [], confidence: 0.75, needsClarification: false } },

  // --- Café ---
  { id: 'cafe-01', category: 'colloquial', domainArea: 'cafe',
    message: 'ร้านกาแฟเปิดกี่โมง',
    expected: { domain: 'cafe', action: 'ask' },
    simulatedModelOutput: { domain: 'cafe', intent: 'cafe_hours_query', action: 'ask', entities: {}, references: [], constraints: [], confidence: 0.88, needsClarification: false } },
  { id: 'cafe-02', category: 'formal', domainArea: 'cafe',
    message: 'Inthanin มีเมนูปั่นไหม',
    expected: { domain: 'cafe', action: 'ask' },
    simulatedModelOutput: { domain: 'cafe', intent: 'cafe_menu_query', action: 'ask', entities: {}, references: [], constraints: [], confidence: 0.83, needsClarification: false } },

  // --- Payment ---
  { id: 'payment-01', category: 'colloquial', domainArea: 'payment',
    message: 'ขอ QR จ่ายเงินหน่อย',
    expected: { domain: 'payment', action: 'status' },
    simulatedModelOutput: { domain: 'payment', intent: 'request_payment_qr', action: 'status', entities: {}, references: [], constraints: [], confidence: 0.85, needsClarification: false } },
  { id: 'payment-02', category: 'formal', domainArea: 'payment',
    message: 'เช็คสถานะการชำระเงินหน่อยครับ',
    expected: { domain: 'payment', action: 'status' },
    simulatedModelOutput: { domain: 'payment', intent: 'check_payment_status', action: 'status', entities: {}, references: [], constraints: [], confidence: 0.88, needsClarification: false } },

  // --- Journey/plan ---
  { id: 'journey-01', category: 'colloquial', domainArea: 'journey',
    message: 'บันทึกแผนนี้ไว้หน่อย',
    expected: { domain: 'journey', action: 'confirm' },
    simulatedModelOutput: { domain: 'journey', intent: 'save_journey', action: 'confirm', entities: {}, references: [], constraints: [], confidence: 0.8, needsClarification: false } },
  { id: 'journey-02', category: 'formal', domainArea: 'journey',
    message: 'ขอดูแผนเที่ยวที่วางไว้',
    expected: { domain: 'journey', action: 'status' },
    simulatedModelOutput: { domain: 'journey', intent: 'view_saved_journey', action: 'status', entities: {}, references: [], constraints: [], confidence: 0.82, needsClarification: false } },

  // --- Cancel/modify ---
  { id: 'cancel-01', category: 'formal', domainArea: 'stay',
    message: 'ขอยกเลิกการจองห้องพักครับ',
    expected: { domain: 'stay', action: 'cancel' },
    simulatedModelOutput: { domain: 'stay', intent: 'cancel_booking', action: 'cancel', entities: {}, references: [], constraints: [], confidence: 0.9, needsClarification: false } },
  { id: 'modify-01', category: 'colloquial', domainArea: 'activity',
    message: 'ขอเปลี่ยนเวลาจองม้าได้ไหม',
    expected: { domain: 'activity', action: 'modify' },
    simulatedModelOutput: { domain: 'activity', intent: 'modify_booking_time', action: 'modify', entities: {}, references: [], constraints: [], confidence: 0.85, needsClarification: false } },

  // --- Support/handoff ---
  { id: 'support-01', category: 'formal', domainArea: 'support',
    message: 'ขอคุยกับพนักงานจริงๆ ได้ไหมครับ',
    expected: { domain: 'support', action: 'ask' },
    simulatedModelOutput: { domain: 'support', intent: 'request_human_handoff', action: 'ask', entities: {}, references: [], constraints: [], confidence: 0.88, needsClarification: false } },
  { id: 'support-02', category: 'colloquial', domainArea: 'support',
    message: 'มีปัญหาเรื่องออเดอร์ ช่วยดูให้หน่อย',
    expected: { domain: 'support', action: 'ask' },
    simulatedModelOutput: { domain: 'support', intent: 'report_order_issue', action: 'ask', entities: {}, references: [], constraints: [], confidence: 0.78, needsClarification: false } },

  // --- Order/book with constraints ---
  { id: 'restaurant-constraint-01', category: 'colloquial', domainArea: 'restaurant',
    message: 'มากันสามคน งบ 700 ไม่เอาหมู',
    expected: { domain: 'restaurant', action: 'recommend' },
    simulatedModelOutput: { domain: 'restaurant', intent: 'budget_set_request', action: 'recommend',
      entities: { partySize: 3, budget: 700 }, references: [], constraints: ['no_pork'], confidence: 0.85, needsClarification: false } },
  { id: 'activity-book-01', category: 'formal', domainArea: 'activity',
    message: 'ขอจองขี่ม้าพรุ่งนี้บ่ายสองสองคนครับ',
    expected: { domain: 'activity', action: 'book' },
    simulatedModelOutput: { domain: 'activity', intent: 'book_horse_activity', action: 'book',
      entities: { date: 'พรุ่งนี้', time: 'บ่ายสอง', partySize: 2 }, references: [], constraints: [], confidence: 0.9, needsClarification: false } },

  // --- Corrections beyond the required one ---
  { id: 'correction-02', category: 'correction', domainArea: 'restaurant',
    message: 'เผ็ดไปหน่อย ขอเปลี่ยนเป็นไม่เผ็ด',
    context: RESTAURANT_SET_CONTEXT,
    expected: { domain: 'restaurant', action: 'modify' },
    simulatedModelOutput: { domain: 'restaurant', intent: 'adjust_spice_level', action: 'modify', entities: {},
      references: [{ type: 'previous_selection', refersToPriorContext: true }], constraints: ['no_spicy'], confidence: 0.86, needsClarification: false } },
  { id: 'correction-03', category: 'correction', domainArea: 'activity',
    message: 'ไม่ใช่สองคน สามคนต่างหาก',
    context: { activeDomain: 'activity', recentEntities: [], lastAction: 'provide_information' },
    expected: { domain: 'activity', action: 'correct_previous' },
    simulatedModelOutput: { domain: 'activity', intent: 'correct_party_size', action: 'correct_previous',
      entities: { partySize: 3 }, references: [{ type: 'previous_turn', refersToPriorContext: true }], constraints: [], confidence: 0.88, needsClarification: false } },
];

function emptyContextForTest(): SemanticContext {
  return { activeDomain: null, recentEntities: [] };
}
