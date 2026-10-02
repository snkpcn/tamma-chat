import type { Handler, HandlerEvent } from '@netlify/functions';
import {
  LLMAvailabilityError,
  ProviderNotConfiguredError,
  getBrainChannel,
  runThongthaiBrain,
  type AgentStateUpdate,
  type BrainChannel,
  type BrainRequest,
  type BrainResponse,
  type BrainRuntimeContext,
  type BrainToolResult,
  type ChatTurn,
  type GuestContext,
  type JourneyContext,
} from './_thongthai-brain-v3';
import {
  loadCustomerMemory,
  loadVerifiedCommunityOfferings,
  persistCustomerResult,
  capturePreferenceSignals,
} from './_customer-db';
import { resolveCanonicalGuestId } from './_thongthai-identity';
import { extractGuestPreferenceSignal } from './_customer-phrase-intelligence';
import { evaluateBotQualitySignals } from './_bot-quality-intelligence';
import { recordIntelligenceEvent } from './_customer-intelligence-events';
import {
  executeBrainTools,
  loadBrainRuntime,
  persistBrainRuntime,
  registerGuestIdentity,
} from './_thongthai-runtime-v3';
import {
  activityAssetFromText,
  activityDurationFromText,
  activityDurationOptionsForResource,
  formatActivityAssetNote,
  listServiceResources,
  loadLatestBookingStatus,
  resetLineBookingPlanningSession,
} from './_operations-db';
import { restaurantMenuAdvice } from './_restaurant-sot';
import {
  listCafeMasterMenu,
  listCafeBranchModifiers,
  type CafeMasterMenuItem,
  type CafeBranchModifier,
} from './_cafe-sot';
import { parsePreferences as parseRestaurantConstraintSignals } from './_restaurant-intelligence';
import {
  applyConversationContextUpdate,
  emptyConversationContextState,
  loadConversationContext,
  persistConversationContext,
  type ConversationContextState,
} from './_conversation-context';
import { emptyTaskStateContainer } from './_task-state';
import { persistAiResponseTurn, persistAiResponseTurnIfAbsent } from './_ai-cost-store';
import { polishCustomerMessage, limitAdvisoryList, composeLineShortReply, trimLongRecommendationForLine } from './_chat-copy-style';
import { applyThongthaiCharacterKernel } from './_thongthai-character-kernel';
import { resolveRequestedCustomerMedia } from './_thongthai-media';
import { formatExperienceDiscoveryMessage, isExperienceDiscoveryIntent } from './_experience-discovery';
import { classifyLocalConciergeQuestion, hasExplicitTransactionIntent, isHorseInfoOrComparisonQuestion, isCompareEntitiesAttributeQuestion } from './_local-concierge-intent';
import { composeLocalConciergeResponse } from './_local-concierge-response';
import { redactWeatherUrl } from './_weather-provider';
import { classifyServiceFeedback, mentionsThongthaiResponse, type ServiceFeedbackMatch, type IssueKeyword } from './_service-mind-feedback-intent';
import { composeServiceFeedbackResponse, composeEscalationResponse, composeSemanticIncidentResponse } from './_service-mind-feedback-response';
import { createFeedbackEvent } from './_service-mind-feedback-events';
import { classifyEscalationBoundary, type EscalationCategory, type EscalationMatch } from './_boundary-classifier';
import {
  classifyActivityIntentQualifier,
  composeActivityIntentStartResponse,
  composeFoodIntentStartResponse,
  composeThankYouCloseResponse,
  composeVagueVisitIntentResponse,
  isActivityIntentStartMessage,
  isFoodIntentStartMessage,
  isThankYouMessage,
  isVagueVisitIntentMessage,
} from './_service-mind-conversation-flow';
import { classifyCareContext, composeCareContextResponse } from './_service-mind-care-context';
import {
  clearRestaurantPreorderDraft,
  formatRestaurantSetPrompt,
  mergeRestaurantPreorderDraft,
  missingRestaurantPreorderFields,
  parseRestaurantPreorderTurn,
  type RestaurantPreorderDraft,
  type RestaurantProposedSetState,
} from './_restaurant-preorder-dialog';
import {
  processThongthaiOneMindTurnResilient,
  isTrustedZeroCostFactLookup,
  isShortStandaloneConceptCandidate,
} from './_thongthai-one-mind-orchestrator';
import { loadGuestAgentStateSnapshot, patchGuestAgentState } from './_guest-agent-state-store';
import { processOneMindCustomerTurn, isTrustedBoundedNoTransactionContinuation } from './_thongthai-one-mind-response';
import { recordOneMindTrace } from './_one-mind-observability';
import { runThongthaiAgentPrimaryTurn } from './_thongthai-agent-session';
import { executeThongthaiTransactionTool } from './_thongthai-agent-transactions';
import { runPrepareOnlyMultiVerticalFastPath } from './_thongthai-prepare-fastpath-v2';
import { isPhase3SemanticLearningCandidate } from './_semantic-concept-memory';
import { classifyCommercialBoundaryText } from './_commercial-intent-boundary';
import {
  classifyRawBusinessIncidentRoute,
  classifySemanticBusinessIncidentRoute,
  semanticIncidentFeedbackMatch,
} from './_business-incident-router';
import { shouldUseThongthaiAgentPrimary, shouldUseThongthaiAgentTransactionPrepare } from './_thongthai-agent-primary';
import type { DurableMemorySnapshot } from './_memory-relevance';
import type { SemanticTurn } from './_semantic-interpreter';
import { deriveSemanticMeaning } from './_semantic-meaning';
import {
  decidePromotionFallback,
  formatPromotionClarificationMessage,
  formatPromotionListMessage,
  formatPromotionRedeemPrompt,
  isPromotionAcceptIntent,
  isPromotionDiscoveryIntent,
  missingPromotionFields,
  parsePendingPromotionRedemption,
  type PendingPromotionRedemption,
  type PromotionListItem,
} from './_promotion-dialog';
import {
  extractDate,
  extractDateRange,
  extractDurationMinutes,
  extractPartySize,
  extractTime,
  hasCommitMarker,
  hasStandaloneTransactionRequest,
} from './_slot-parsers';
import { createActiveTask, isTerminalTaskStatus, loadTaskState, mergeTaskSlots, persistTaskState, startNewActiveTask, suspendActiveTask, type TaskStateContainer } from './_task-state';
import { HORSE_FACTS, INDOOR_FRIENDLY_BUSINESS_UNITS } from './_local-concierge-knowledge';
import {
  composeDeterministicResponse,
  composeGroundedDeterministicResponse,
  normalizeResponseLanguageSurface,
  type ComposedResponse,
} from './_response-composer';
import { ECOSYSTEM_PATHS, HOMESTAY_FACTS } from './_tamma-domain-knowledge';
import { EXPERIENCES } from '../../src/data/experiences';
import { classifyTopLevelSemanticIntent, topLevelIntentBlocksHorseTokenRouting } from './_top-level-intent';
import { findKnownActivityAssetSelection } from './_deterministic-semantic-turn';
import {
  normalizePendingQuestion,
  resolvePendingQuestionAnswer,
  type PendingQuestionState,
} from './_conversation-continuity';
import {
  asksIfSafe,
  interpretActivityGoal,
  interpretCustomerType,
  interpretExperience,
  interpretFear,
  interpretFirmnessPreference,
  interpretHealthConcerns,
  mentionsBrakeQuestion,
  mentionsChildPassengerQuestion,
  mentionsSpeedFear,
  mentionsSupportRequest,
  mentionsWeightOrSizeConcern,
  interpretOverallHealthConcern,
  noSafetyGuaranteeMessage,
  prefersLowWalking,
  wantsIntenseExperience,
  type CustomerTypeSignal,
} from './_semantic-hospitality-interpreter';

export type {
  BrainRequest as ChatRequest,
  BrainResponse as ChatResponse,
  ChatTurn,
  GuestContext,
  JourneyContext,
} from './_thongthai-brain-v3';

const LANGUAGES = new Set(['th', 'en', 'zh', 'lo', 'vi']);
const RESTAURANT_SET_ACCEPT_RE = /(เอา(?:ชุด|เซ็ต)นี้|เอาชุดเมื่อกี้|ชุดเมื่อกี้|เอาตามนี้|ตามนี้|โอเค(?:ชุด|เซ็ต)นี้|ตกลง(?:ชุด|เซ็ต)นี้|จัด(?:ชุด|เซ็ต)นี้|ชุดนี้เลย)/u;
const RESTAURANT_ADVISOR_CONTEXT_SOURCE = 'restaurant_menu_advisor_v1';
// "สวัสดี"/"หวัดดี" are commonly glued directly onto a polite particle with
// no space ("สวัสดีครับ", "สวัสดีค่ะ") -- the far more common real-world
// phrasing than the bare word alone. The boundary group must accept those
// particles directly, not just whitespace/punctuation/end-of-string, or the
// single most common Thai greeting silently misses the fast path.
const SIMPLE_GREETING_RE = /^(?:สวัสดี|หวัดดี|ดีครับ|ดีค่ะ|ดีคับ|hello|hi|hey)(?:$|[\s!?.ๆ，,]|ครับ|ค่ะ|คะ|คับ)[\s\S]{0,64}$/iu;
const OPERATIONAL_TOPIC_RE = /(?:จอง|ยกเลิก|เลื่อน|สั่ง|จ่าย|ชำระ|โอน|ขี่ม้า|ม้า|ภาราดร|ทองไทย|atv|เอทีวี|ยิงธนู|ร้าน|อาหาร|เมนู|ห้อง|ที่พัก|เฮือน|otop|โอทอป|ของฝาก|สมาชิก|โปร)/iu;

function emptyGuestContext(): GuestContext {
  return {
    tripDuration: null,
    travelerType: null,
    group: { adults: null, children: null, elderly: null },
    interests: [],
    pace: null,
    budget: null,
    constraints: [],
  };
}

function emptyJourneyContext(): JourneyContext {
  return {
    currentPlan: null,
    savedPlan: null,
    visitedExperiences: [],
    favorites: [],
    journalEntries: [],
  };
}

/**
 * Phase 7 task-authority boundary.
 *
 * Once a real non-terminal ActiveTask exists, that bounded task state is the
 * authoritative continuation context. Read-only Saved-Agent routing must not
 * take first refusal on later turns: the One-Mind/Dialog Manager owns
 * selection, duration, correction, side-topic suspension/resume, summary and
 * no-transaction readback. Explicit prepare-only Agent routing remains a
 * separate transaction-draft canary and is not blocked by this rule.
 */
export function activeTaskOwnsConversationBeforePrimary(container: TaskStateContainer): boolean {
  const activeOwns = Boolean(
    container.activeTask
    && !isTerminalTaskStatus(container.activeTask.status)
  );
  const suspendedOwns = Boolean(
    container.suspendedTask
    && !isTerminalTaskStatus(container.suspendedTask.status)
  );
  // A side-topic switch moves the original task into suspendedTask. It is
  // still the bounded continuation authority for explicit resume/summary
  // turns and must block read-only Agent Primary just like an active task.
  return activeOwns || suspendedOwns;
}

/**
 * Phase 7 bounded-conversation authority.
 *
 * Production proved that a clear "keep Pharadon for now, don't book" path
 * can be represented in ConversationContext working memory even when there
 * is no ActiveTask row yet. That state is still a bounded, durable
 * continuation contract: a considered selection plus explicit no-transaction
 * memory must survive side-topic switches/resume/summary without being
 * re-routed into the Saved Agent and spending the remaining conversation
 * budget.
 */
export function conversationContextOwnsConversationBeforePrimary(
  state: ConversationContextState,
): boolean {
  const hasConsideredSelection = state.workingMemory.consideredSelections.some(
    selection => selection.status === 'considering',
  );
  const hasCurrentTaskReference = typeof state.currentTaskReference === 'string'
    && state.currentTaskReference.trim().length > 0;
  return hasConsideredSelection || hasCurrentTaskReference;
}

async function hasActiveTaskBeforePrimary(guestDbId: string | null): Promise<boolean> {
  if (!guestDbId) return false;
  try {
    return activeTaskOwnsConversationBeforePrimary(await loadTaskState(guestDbId));
  } catch (error) {
    // Do not fail the whole turn because the task-state read itself failed.
    // Existing Agent/One-Mind routing can still degrade honestly.
    console.error(
      'THONGTHAI_PRE_PRIMARY_TASK_STATE_ERROR',
      error instanceof Error ? error.message.slice(0, 180) : 'unknown',
    );
    return false;
  }
}

async function hasConversationContextBeforePrimary(guestDbId: string | null): Promise<boolean> {
  if (!guestDbId) return false;
  try {
    return conversationContextOwnsConversationBeforePrimary(
      await loadConversationContext(guestDbId),
    );
  } catch (error) {
    console.error(
      'THONGTHAI_PRE_PRIMARY_CONVERSATION_CONTEXT_ERROR',
      error instanceof Error ? error.message.slice(0, 180) : 'unknown',
    );
    return false;
  }
}

async function cafeStateBeforePrimary(
  request: BrainRequest,
  guestDbId: string | null,
): Promise<Record<string, unknown> | null> {
  if (isCafeReadOnlyTurn(request.message)) return {};
  if (!guestDbId) return null;
  try {
    const snapshot = await loadGuestAgentStateSnapshot(guestDbId);
    if (!isObject(snapshot.state)) return null;
    return isCafeReadOnlyTurn(request.message, snapshot.state.active_topic)
      ? snapshot.state
      : null;
  } catch (error) {
    console.error(
      'THONGTHAI_PRE_PRIMARY_CAFE_STATE_ERROR',
      error instanceof Error ? error.message.slice(0, 180) : 'unknown',
    );
    return null;
  }
}

/**
 * Phase 7 verified-slot guard for a held horse selection.
 *
 * Syntax parsing may recognize any sensible duration, but business validity
 * belongs to the live activity_offerings table. When a customer already has
 * a horse in bounded "considering" state, reject an unsupported duration
 * before any model can persist or echo it back as accepted.
 */
async function boundedConsideredHorseDurationResponse(
  request: BrainRequest,
  guestDbId: string | null,
  channel: BrainChannel,
): Promise<BrainResponse | null> {
  if (!guestDbId) return null;
  const durationMinutes = activityDurationFromText(request.message);
  if (!durationMinutes) return null;

  const context = await loadConversationContext(guestDbId);
  const heldHorse = context.workingMemory.consideredSelections.find(selection =>
    selection.domain === 'activity'
    && selection.status === 'considering'
    && /(?:ทองไทย|ภาราดร)/u.test(selection.name)
  );
  if (!heldHorse) return null;

  const options = await activityDurationOptionsForResource('activity-horse');
  if (!options.length || options.includes(durationMinutes)) return null;

  // Materialize the already-held selection into canonical task state before
  // returning the business-truth rejection. The rejected duration itself is
  // intentionally NOT written.
  const taskState = await loadTaskState(guestDbId);
  if (!taskState.activeTask || isTerminalTaskStatus(taskState.activeTask.status)) {
    const next = startNewActiveTask(taskState, {
      type:'activity_booking',
      sourceChannel:channel,
      initialSlots:{
        resourceCode:'activity-horse',
        horseName:heldHorse.name.replace(/^น้อง/u,''),
      },
      requiredFields:['durationMinutes','date','time','partySize'],
    });
    await persistTaskState(guestDbId,next);
  }

  const optionText = options.map(minutes => `${minutes} นาที`).join(' หรือ ');
  return {
    message: `น้อง${heldHorse.name.replace(/^น้อง/u,'')} มีรอบให้เลือก ${optionText}ครับ ยังไม่มีรอบ ${durationMinutes} นาทีครับ`,
    intent: 'information',
    contextUpdates: {},
    journeyAction: { type: 'none', journey: null },
    suggestedActions: [],
    responseStyle: 'direct',
    semanticMemoryUpdates: [],
    toolCalls: [],
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isSimpleGreetingMessage(message: string): boolean {
  const trimmed = message.trim();
  return SIMPLE_GREETING_RE.test(trimmed) && !OPERATIONAL_TOPIC_RE.test(trimmed);
}

export function deterministicGreetingResponse(request: BrainRequest): BrainResponse | null {
  if (!isSimpleGreetingMessage(request.message)) return null;
  const isThai = request.language === 'th' || /[\u0E00-\u0E7F]/u.test(request.message);
  return {
    message: isThai
      ? 'สวัสดีครับ ผมทองไทยครับ 😊 วันนี้อยากให้ช่วยเรื่องกิน พัก กิจกรรม โลเคชั่น อากาศ หรือจัดทริปให้ดีครับ'
      : "Hi, I'm Thongthai 😊 I can help with dining, stays, activities, location, weather, or planning your trip.",
    intent: 'greeting',
    contextUpdates: {},
    journeyAction: { type: 'none', journey: null },
    suggestedActions: [],
    responseStyle: 'direct',
    semanticMemoryUpdates: [],
    toolCalls: [],
  };
}

// An explicit request to drop the prior conversation and start fresh. A
// small, closed marker set (not a growing phrase table), matching this
// codebase's convention for other structural intent markers.
const CONVERSATION_RESET_RE = /ลืมที่คุยกันไปก่อน|ลืมที่คุยไปก่อน|เริ่มใหม่|ล้างก่อน|ไม่เอาที่คุยเมื่อกี้/u;

/**
 * A real reset, not merely a friendly acknowledgment: clears the
 * persisted routing/discourse memory (active domain, recently-seen
 * entities, working memory, any open question, the rolling summary) so
 * the VERY NEXT message is interpreted fresh instead of being silently
 * re-anchored to whatever business domain/entity the conversation
 * happened to be on before this request. Real production incident this
 * closes: "ลืมที่คุยกันไปก่อนนะครับ" got a natural-sounding "sure, let's
 * start over" reply that never actually cleared anything, so the very
 * next message (a completely different, self-contained request) still
 * inherited the stale domain and triggered a false "do you mean what we
 * discussed before?" clarification -- see the One-Mind Dialog Manager's
 * own isAmbiguous() fix for the matching activity-domain case.
 *
 * Clears temporary planning state, including the passive legacy LINE
 * booking-session adapter, but never touches a real booking/order/payment
 * record. Conversation reset and AI accounting are deliberately separate:
 * the cost ledger keeps its current session/budget and expires only under
 * the canonical idle/session policy, so repeatedly saying "start over"
 * cannot create unlimited fresh budgets.
 */
export async function deterministicConversationResetResponse(
  request: BrainRequest,
  guestDbId: string | null,
): Promise<BrainResponse | null> {
  if (!CONVERSATION_RESET_RE.test(request.message)) return null;
  if (guestDbId) {
    await patchGuestAgentState(guestDbId, {
      set: {
        conversationContext: emptyConversationContextState(),
        taskState: emptyTaskStateContainer(),
      },
      removeKeys: [
        'active_topic', 'travel_context_summary', 'unresolved_need',
        'pending_question', 'restaurantProposedSet',
        'restaurantAdvisorContext', 'pendingPromotionRedemption',
      ],
    }).catch(error => {
      console.error('THONGTHAI_CONVERSATION_RESET_ERROR', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
    });
    await resetLineBookingPlanningSession(guestDbId).catch(error => {
      console.error('THONGTHAI_BOOKING_PLANNING_RESET_ERROR', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
    });
  }
  return {
    message: 'ได้ครับ เริ่มคุยกันใหม่จากข้อความถัดไปเลยนะครับ 😊',
    intent: 'information',
    contextUpdates: {},
    journeyAction: { type: 'none', journey: null },
    suggestedActions: [],
    responseStyle: 'direct',
    semanticMemoryUpdates: [],
    toolCalls: [],
  };
}

// Bare attention-getting interjections ("เห้ยยย", "ฮัลโหล") and presence
// checks ("อยู่ไหม", "มีใครอยู่ไหม") -- unlike SIMPLE_GREETING_RE these carry
// no greeting word at all, so they need their own narrow, whole-message-only
// markers. Anchored start-to-end on purpose: this must never fire on a
// message that merely CONTAINS one of these words alongside real content
// (e.g. "ทองไทยอยู่ไหมกิจกรรมม้า"), only on the bare interjection itself.
// This is checked in the SAME early, pre-LLM slot as deterministicGreetingResponse
// so a casual message never depends on LLM/provider availability at all --
// see THONGTHAI_HANDOFF.md's "LINE Full Audit" entry for why a generic
// "คิดช้า" apology was reaching messages like this one before.
const CASUAL_ATTENTION_RE = /^(?:เห้ย+|เฮ้ย+|ฮัลโหล+|เอ้ย+)(?:ครับ|ค่ะ|คะ|คับ|จ้า|จ๊ะ)?[\s!ๆ.,?？~]*$/iu;
const PRESENCE_CHECK_RE = /^(?:มีใครอยู่(?:ไหม|มั้ย|ป่าว|เปล่า|บ้าง)|(?:ทองไทย\s*)?อยู่(?:ไหม|มั้ย|ป่าว|เปล่า))[\s!.,?？~]*$/iu;

// A bare, ambiguous fragment with no real content ("สติ", "อะไร", "งง")
// carries no domain topic and no slot -- neither the LLM nor any
// deterministic responder can ground an answer in it. Production incident
// this closes: such a message used to fall all the way through to the
// generic "คิดช้ากว่าปกติ" degraded-provider apology (implying the AI was
// slow/down, when the real issue was the message itself being too short to
// interpret) or, worse, reached the LLM at all for something a template can
// answer instantly. Checked in the SAME early, pre-LLM slot as
// deterministicGreetingResponse/deterministicCasualChatResponse so this
// never depends on LLM/provider availability. Anchored whole-message-only,
// exactly like CASUAL_ATTENTION_RE above, so it never fires on a message
// that merely CONTAINS one of these words alongside real content (e.g.
// "ร้านอาหารมีอะไรแนะนำ" keeps its own restaurant-advisor handling).
const SHORT_UNCLEAR_TEXT_RE = /^(?:สติ|เอ้า+|อะไร|งง+|ห้ะ+|อืม+|ต่อ|แล้วไง)(?:ครับ|ค่ะ|คะ|คับ|จ้า|จ๊ะ|อะ|นะ)?[\s!ๆ.,?？~]*$/iu;

export function isShortUnclearTextMessage(message: string): boolean {
  return SHORT_UNCLEAR_TEXT_RE.test(message.trim());
}

export function deterministicShortUnclearTextResponse(request: BrainRequest): BrainResponse | null {
  if (!isShortUnclearTextMessage(request.message)) return null;
  return {
    message: 'ขอโทษครับ หมายถึงให้ทองไทยตั้งสติ/ตอบใหม่ หรืออยากถามเรื่องไหนต่อครับ?',
    intent: 'conversation',
    contextUpdates: {},
    journeyAction: { type: 'none', journey: null },
    suggestedActions: [],
    responseStyle: 'direct',
    semanticMemoryUpdates: [],
    toolCalls: [],
  };
}

export function isCasualAttentionMessage(message: string): boolean {
  const trimmed = message.trim();
  return CASUAL_ATTENTION_RE.test(trimmed) || PRESENCE_CHECK_RE.test(trimmed);
}

export function deterministicCasualChatResponse(request: BrainRequest): BrainResponse | null {
  if (!isCasualAttentionMessage(request.message)) return null;
  const isThai = request.language === 'th' || /[฀-๿]/u.test(request.message);
  return {
    message: isThai
      ? 'ครับผม ทองไทยอยู่นี่ครับ 😊 มีอะไรให้ช่วยไหมครับ'
      : "Yep, Thongthai's here 😊 What can I help you with?",
    intent: 'greeting',
    contextUpdates: {},
    journeyAction: { type: 'none', journey: null },
    suggestedActions: [],
    responseStyle: 'direct',
    semanticMemoryUpdates: [],
    toolCalls: [],
  };
}

// Phase 2 stabilization: when "ทองไทย" is clearly being used as the
// assistant's name, answer as the assistant instead of letting the lexical
// horse-name collision reach activity selection. This is deliberately narrow;
// explicit horse/riding phrasing is classified HORSE_RELATED and never enters
// this responder.
export function deterministicBotAddressResponse(request: BrainRequest): BrainResponse | null {
  if (classifyTopLevelSemanticIntent(request.message) !== 'BOT_ADDRESS') return null;
  const text = request.message.trim();
  const message = /ขอบคุณ/u.test(text)
    ? 'ยินดีครับ 😊 ทองไทยอยู่นี่ครับ ถ้ามีอะไรให้ช่วยต่อบอกได้เลยครับ'
    : /สวัสดี/u.test(text)
      ? 'สวัสดีครับ 😊 ทองไทยอยู่นี่ครับ วันนี้อยากให้ช่วยเรื่องกิน พัก กิจกรรม โลเคชั่น อากาศ หรือจัดทริปครับ?'
      : /ตอบใหม่|อธิบาย/u.test(text)
        ? 'ได้ครับ บอกจุดที่อยากให้ทองไทยตอบใหม่หรืออธิบายเพิ่มได้เลยครับ'
        : 'ได้ครับ 😊 อยากให้ทองไทยช่วยแนะนำเรื่องกิน พัก กิจกรรม โลเคชั่น อากาศ หรือจัดทริปครับ?';
  return {
    message,
    intent: 'conversation',
    contextUpdates: {},
    journeyAction: { type: 'none', journey: null },
    suggestedActions: [],
    responseStyle: 'direct',
    semanticMemoryUpdates: [],
    toolCalls: [],
  };
}

// Per-intent-category degraded response when the LLM/provider is genuinely
// unavailable AND no deterministic composer (promotion fallback, One-Mind
// pipeline) could compose a grounded answer either. A single flat "คิดช้า"
// apology for every category is what produced the generic-fallback bug --
// this at least tells a weather/booking/feedback question something
// relevant to what it actually asked, and never claims an action (a
// booking, a saved feedback note) that did not actually happen.
type DegradedFallbackCategory = 'weather' | 'booking' | 'feedback' | 'casual';

export function isAgentTransactionPrepareIntent(
  message: string,
  topLevelSemanticIntent: string,
): boolean {
  return classifyCommercialBoundaryText(message,topLevelSemanticIntent).prepareEligible;
}

export function categorizeDegradedFallback(message: string): DegradedFallbackCategory {
  if (classifyServiceFeedback(message)) return 'feedback';
  if (classifyLocalConciergeQuestion(message)?.category === 'weather_condition') return 'weather';
  if (hasExplicitTransactionIntent(message) || OPERATIONAL_TOPIC_RE.test(message)) return 'booking';
  return 'casual';
}

function isAgentPreflightBudgetGuard(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.includes('conversation cost cap reached')
    || message.includes('remaining combined budget is below the safe per-turn reserve');
}

export function degradedFallbackResponse(category: DegradedFallbackCategory): BrainResponse {
  const message = category === 'weather'
    ? 'ตอนนี้ทองไทยเช็กสภาพอากาศไม่ทันครับ ลองถามอีกครั้งในอีกสักครู่ หรือเช็กแอปพยากรณ์อากาศคู่กันไปก่อนนะครับ'
    : category === 'booking'
      ? 'ตอนนี้ระบบจองของทองไทยตอบช้ากว่าปกติครับ ข้อมูลที่พิมพ์มายังไม่หายไปไหน ลองส่งอีกครั้งในอีกสักครู่นะครับ'
      : category === 'feedback'
        ? 'ขอบคุณสำหรับข้อความนี้ครับ ตอนนี้ระบบตอบช้ากว่าปกติเล็กน้อย รบกวนส่งอีกครั้งในอีกสักครู่ เพื่อให้ทองไทยรับเรื่องไว้อย่างถูกต้องครับ'
        : 'ทองไทยอยู่นี่ครับ แต่ตอนนี้คิดช้ากว่าปกตินิดหนึ่ง ลองพิมพ์อีกครั้งในอีกสักครู่นะครับ 😊';
  return {
    message,
    intent: 'conversation',
    contextUpdates: {},
    journeyAction: { type: 'none', journey: null },
    suggestedActions: [],
    responseStyle: 'direct',
    semanticMemoryUpdates: [],
    toolCalls: [],
  };
}

function normalizeGuestContext(value: unknown): GuestContext {
  if (!isObject(value)) return emptyGuestContext();
  const group = isObject(value.group) ? value.group : {};
  return {
    tripDuration: typeof value.tripDuration === 'string' ? value.tripDuration : null,
    travelerType: typeof value.travelerType === 'string' ? value.travelerType : null,
    group: {
      adults: typeof group.adults === 'number' ? group.adults : null,
      children: typeof group.children === 'number' ? group.children : null,
      elderly: typeof group.elderly === 'number' ? group.elderly : null,
    },
    interests: Array.isArray(value.interests)
      ? value.interests.filter((item): item is string => typeof item === 'string')
      : [],
    pace: typeof value.pace === 'string' ? value.pace : null,
    budget: typeof value.budget === 'number' ? value.budget : null,
    constraints: Array.isArray(value.constraints)
      ? value.constraints.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

function normalizeJourneyContext(value: unknown): JourneyContext {
  if (!isObject(value)) return emptyJourneyContext();
  return {
    currentPlan: value.currentPlan ?? null,
    savedPlan: value.savedPlan ?? null,
    visitedExperiences: Array.isArray(value.visitedExperiences)
      ? value.visitedExperiences.filter((item): item is string => typeof item === 'string')
      : [],
    favorites: Array.isArray(value.favorites)
      ? value.favorites.filter((item): item is string => typeof item === 'string')
      : [],
    journalEntries: Array.isArray(value.journalEntries) ? value.journalEntries : [],
  };
}

function normalizeChatHistory(value: unknown): ChatTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => isObject(item))
    .filter(item => (item.role === 'user' || item.role === 'assistant') && isNonEmptyString(item.content))
    .map(item => ({ role: item.role as ChatTurn['role'], content: item.content as string }));
}

function normalizeRequest(body: unknown): BrainRequest | null {
  if (!isObject(body) || !isNonEmptyString(body.message)) return null;
  const language = isNonEmptyString(body.language) && LANGUAGES.has(body.language)
    ? body.language as BrainRequest['language']
    : 'th';
  const pageContext = isObject(body.pageContext)
    ? { section: typeof body.pageContext.section === 'string' ? body.pageContext.section : null }
    : { section: null };
  return {
    guestId: typeof body.guestId === 'string' ? body.guestId : undefined,
    environment: body.environment === 'test' ? 'test' : 'live',
    message: body.message.trim(),
    language,
    chatHistory: normalizeChatHistory(body.chatHistory),
    guestContext: normalizeGuestContext(body.guestContext),
    journeyContext: normalizeJourneyContext(body.journeyContext),
    pageContext,
  };
}

function durableMemoryFromRequest(request: BrainRequest): DurableMemorySnapshot {
  return {
    travelerType: request.guestContext.travelerType,
    pace: request.guestContext.pace,
    interests: [...request.guestContext.interests],
    constraints: [...request.guestContext.constraints],
    group: { ...request.guestContext.group },
    favorites: [...request.journeyContext.favorites],
    visitedExperiences: [...request.journeyContext.visitedExperiences],
  };
}

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

function mergeAgentState(
  first: AgentStateUpdate | undefined,
  second: AgentStateUpdate | undefined,
): AgentStateUpdate | undefined {
  const merged = { ...(first ?? {}), ...(second ?? {}) };
  return Object.keys(merged).length ? merged : undefined;
}

function restaurantSetFromToolResults(toolResults: BrainToolResult[]): AgentStateUpdate | undefined {
  for (const result of toolResults) {
    if (result.name !== 'list_restaurant_menu' || !result.ok) continue;
    try {
      const detail = JSON.parse(result.detail) as Record<string, unknown>;
      const advisor = detail.advisor && typeof detail.advisor === 'object' ? detail.advisor as Record<string, unknown> : {};
      const set = advisor.set && typeof advisor.set === 'object' ? advisor.set as Record<string, unknown> : null;
      const rawItems = set && Array.isArray(set.items) ? set.items : [];
      const items = rawItems.slice(0,20)
        .map(item => item && typeof item === 'object' ? item as Record<string, unknown> : {})
        .map(item => ({
          name: typeof item.name === 'string' ? item.name.slice(0,160) : '',
          quantity: typeof item.quantity === 'number' && Number.isFinite(item.quantity) ? Math.max(1, Math.floor(item.quantity)) : 1,
        }))
        .filter(item => item.name);
      if (advisor.mode === 'compose_set' && items.length) {
        return {
          restaurantProposedSet: {
            source: 'restaurant_menu_advisor_v1',
            items,
            total: typeof set?.total === 'number' && Number.isFinite(set.total) ? Math.max(0, Math.floor(set.total)) : 0,
            budget: typeof set?.budget === 'number' && Number.isFinite(set.budget) ? Math.max(0, Math.floor(set.budget)) : null,
            partySize: typeof set?.partySize === 'number' && Number.isFinite(set.partySize) ? Math.max(1, Math.floor(set.partySize)) : null,
            createdAt: new Date().toISOString(),
          },
        };
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

function mergeAfterTools(first: BrainResponse, second: BrainResponse, toolResults: BrainToolResult[]): BrainResponse {
  return {
    ...first,
    message: second.message,
    responseStyle: second.responseStyle,
    suggestedActions: second.suggestedActions.length ? second.suggestedActions : first.suggestedActions,
    agentStateUpdate: mergeAgentState(mergeAgentState(first.agentStateUpdate, second.agentStateUpdate), restaurantSetFromToolResults(toolResults)),
    semanticMemoryUpdates: first.semanticMemoryUpdates,
    toolCalls: [],
  };
}

function currentRestaurantAdvisorContext(runtime: { agentState: Record<string, unknown> }): AgentStateUpdate['restaurantAdvisorContext'] | null {
  const raw = runtime.agentState.restaurantAdvisorContext;
  if (!isObject(raw) || !Array.isArray(raw.recentMessages)) return null;
  const recentMessages = raw.recentMessages
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(item => item.trim().replace(/\s+/g, ' ').slice(0, 180))
    .slice(-8);
  const recentRecommendationNames = Array.isArray(raw.recentRecommendationNames)
    ? raw.recentRecommendationNames
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map(item => item.trim().replace(/\s+/g, ' ').slice(0, 160))
      .slice(-20)
    : [];
  if (!recentMessages.length) return null;
  return {
    source: RESTAURANT_ADVISOR_CONTEXT_SOURCE,
    recentMessages,
    recentRecommendationNames,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  };
}

function restaurantAdvisorRecentMessages(
  request: BrainRequest,
  runtime: { agentState: Record<string, unknown> },
): string[] {
  const stored = currentRestaurantAdvisorContext(runtime)?.recentMessages ?? [];
  const transported = request.chatHistory.slice(-6).map(turn => turn.content);
  return [...stored, ...transported].slice(-8);
}

function isRestaurantAlternativeRequest(message: string): boolean {
  return /(?:แนะนำ.*อีก|มีอะไร.*อีก|เมนู.*อื่น|อย่างอื่น|อันอื่น|อย่างอื่นอีก)/u.test(message);
}

function restaurantAdvisorContextUpdate(
  request: BrainRequest,
  runtime: { agentState: Record<string, unknown> },
  shownRecommendationNames?: string[],
): AgentStateUpdate {
  const recentMessages = [...restaurantAdvisorRecentMessages(request, runtime), request.message]
    .map(item => item.trim().replace(/\s+/g, ' ').slice(0, 180))
    .filter(Boolean)
    .slice(-8);
  const previousRecommendationNames = currentRestaurantAdvisorContext(runtime)?.recentRecommendationNames ?? [];
  const recentRecommendationNames = shownRecommendationNames === undefined
    ? previousRecommendationNames
    : isRestaurantAlternativeRequest(request.message)
      ? [...new Set([...previousRecommendationNames, ...shownRecommendationNames])].slice(-20)
      : [...new Set(shownRecommendationNames)].slice(-20);
  return {
    activeTopic: 'restaurant',
    restaurantAdvisorContext: {
      source: RESTAURANT_ADVISOR_CONTEXT_SOURCE,
      recentMessages,
      recentRecommendationNames,
      updatedAt: new Date().toISOString(),
    },
  };
}

function polishedResponse(response: BrainResponse, channel: BrainChannel): BrainResponse {
  const message = polishCustomerMessage(response.message, channel);
  return { ...response, message: message || response.message.trim() };
}

/** Canonical last-mile customer egress for every public brain path. */
export function normalizeFinalCustomerMessage(
  message:string,
  language:BrainRequest['language'],
  channel:BrainChannel,
):string {
  const languageNormalized=normalizeResponseLanguageSurface(message,language);
  return polishCustomerMessage(languageNormalized,channel)
    || languageNormalized
    || message.trim();
}

function duplicateRestaurantPreorderMessage(
  language: BrainRequest['language'],
  toolResults: Array<{ name: string; ok: boolean; detail: string }>,
): string | null {
  const result = toolResults.find(item => item.name === 'create_restaurant_preorder' && item.ok);
  if (!result) return null;
  try {
    const detail = JSON.parse(result.detail) as Record<string, unknown>;
    if (detail.duplicate !== true || typeof detail.preorderCode !== 'string') return null;
    const code = detail.preorderCode;
    const messages: Record<BrainRequest['language'], string> = {
      th: [
        'รายการนี้มีอยู่แล้วครับ ✅',
        'ทองไทยไม่ได้สร้างออเดอร์ซ้ำ',
        `รหัสเดิม: ${code}`,
        'สถานะ: รอร้านรับออเดอร์',
        '',
        'ระบบใช้คำขอเดิมของคุณครับ รอทีมร้านกดรับออเดอร์ได้เลย',
      ].join('\n'),
      en: `This preorder already exists ✅\nNo duplicate order was created.\nExisting code: ${code}\nStatus: waiting for the restaurant to accept.`,
      zh: `这笔预订单已经存在 ✅\n系统没有重复创建订单。\n原订单号：${code}\n状态：等待餐厅接单。`,
      lo: `ລາຍການນີ້ມີຢູ່ແລ້ວ ✅\nລະບົບບໍ່ໄດ້ສ້າງອໍເດີຊ້ຳ\nລະຫັດເດີມ: ${code}\nສະຖານະ: ລໍຖ້າຮ້ານຮັບອໍເດີ`,
      vi: `Đơn đặt trước này đã tồn tại ✅\nHệ thống không tạo đơn trùng.\nMã cũ: ${code}\nTrạng thái: đang chờ nhà hàng nhận đơn.`,
    };
    return messages[language];
  } catch {
    return null;
  }
}

function normThai(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

// Master Roadmap Phase 2 fix -- superseded an earlier, WRONG attempt at
// this same gate (see git history: a 10-minute "recently active"
// recency window on restaurantAdvisorContext). That attempt still
// broke the owner's explicit, unconditional product rule: "a customer
// telling Thongthai a constraint is not the same as asking for a menu
// ... only recommend when asked" -- a constraint UPDATE sent right
// after a genuine recommendation (e.g. "ไม่กินไก่" moments after
// "ร้านอาหารมีอะไรแนะนำ") refreshes restaurantAdvisorContext.updatedAt
// to "now," so it was ALWAYS inside that window and ALWAYS fell through
// to the full recommendation dump again -- exactly the bug this closes.
// The only thing that legitimately overrides a bare declaration now is
// a CONCRETE, in-progress proposed order (currentRestaurantSet) --
// silently abandoning an actual pending order over a constraint mention
// would be a worse failure than this one. No other notion of "the
// conversation is still active" survives: conversational recency can
// never distinguish "moments ago" from "an hour ago" reliably enough to
// safely gate this, as the prior attempt's own regression proved.
function hasPendingRestaurantOrder(runtime: { agentState: Record<string, unknown> }): boolean {
  return Boolean(currentRestaurantSet(runtime));
}

function currentRestaurantSet(runtime: { agentState: Record<string, unknown> }): RestaurantProposedSetState | null {
  const raw = runtime.agentState.restaurantProposedSet;
  if (!isObject(raw) || !Array.isArray(raw.items)) return null;
  const items = raw.items
    .filter(isObject)
    .map(item => ({
      name: typeof item.name === 'string' ? item.name.trim() : '',
      quantity: typeof item.quantity === 'number' && Number.isFinite(item.quantity) ? Math.max(1, Math.floor(item.quantity)) : 1,
    }))
    .filter(item => item.name);
  if (!items.length) return null;
  const draftRaw = isObject(raw.preorderDraft) ? raw.preorderDraft : null;
  const preorderDraft: RestaurantPreorderDraft | undefined = draftRaw ? {
    date: typeof draftRaw.date === 'string' ? draftRaw.date : null,
    time: typeof draftRaw.time === 'string' ? draftRaw.time : null,
    customerName: typeof draftRaw.customerName === 'string' ? draftRaw.customerName : null,
    phone: typeof draftRaw.phone === 'string' ? draftRaw.phone : null,
    email: typeof draftRaw.email === 'string' ? draftRaw.email : null,
    acceptedAt: typeof draftRaw.acceptedAt === 'string' ? draftRaw.acceptedAt : new Date().toISOString(),
  } : undefined;
  return {
    source: typeof raw.source === 'string' ? raw.source : 'restaurant_menu_advisor_v1',
    items,
    total: typeof raw.total === 'number' ? raw.total : undefined,
    budget: typeof raw.budget === 'number' ? raw.budget : null,
    partySize: typeof raw.partySize === 'number' ? raw.partySize : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
    preorderDraft,
  };
}

export function isRestaurantAdvisorTurn(request: BrainRequest, runtime: { agentState: Record<string, unknown> }): boolean {
  const text = normThai(request.message);
  // "เป็ดน้ำ"/"ปั่นเป็ดน้ำ"/"เรือเป็ด"/"ถีบเป็ด" name the pedal-boat activity
  // here, never a live/cooked duck -- excluded the same way every other
  // activity already is, so a future menu item sharing the "เป็ด" root
  // (a real duck dish) can never accidentally pull a pedal-boat question
  // into the restaurant advisor.
  if (/(ขี่ม้า|atv|เอทีวี|ยิงธนู|ห้องพัก|ที่พัก|เฮือน|otop|กาแฟ|คาเฟ่|เป็ดน้ำ|ปั่นเป็ด|เรือเป็ด|ถีบเป็ด|pedal)/iu.test(text)) return false;
  // A promotion mention must always reach the LLM brain's redeem_promotion tool --
  // this deterministic shortcut has no knowledge of active_promotions_live and
  // would otherwise intercept "เอาโปรตำไทย..." before the promo could ever be redeemed.
  // Negative lookahead excludes "โปรด..." (please/kindly), an unrelated polite word.
  if (/โปร(?!ด(?:แนะนำ|ช่วย|หน่อย|บอก|จัด|หา))/u.test(text)) return false;
  const proposedSet = currentRestaurantSet(runtime);
  if (proposedSet?.preorderDraft) return true;
  if (RESTAURANT_SET_ACCEPT_RE.test(text) && proposedSet) return true;
  const hasRestaurantHistory = request.chatHistory.slice(-6).some(turn =>
    /(ตำลาว|ตำไทย|ชุดอาหาร|ร้านอาหาร|ตำมา-ชาติ|เมนู|สั่งอาหาร|แพ้ถั่ว|ไม่เอาหมู)/u.test(turn.content));
  const hasRestaurantServerContext = Boolean(currentRestaurantAdvisorContext(runtime)) || Boolean(proposedSet);
  // "ไรกิน"/"มีไรกิน" is the colloquial shortening of "อะไรกิน" (dropping the
  // leading อะ), as in the canonical smoke phrase "ร้านมีไรกิน" -- without this,
  // that phrasing missed every deterministic branch above and fell through to
  // a full LLM round trip, which the legacy path only reaches as a One-Mind
  // safety net that's already spent most of the request's time budget.
  // "ไก่"/"หมู"/"เนื้อ" (bare protein words) were missing here even though
  // "เผ็ด"/"ปลาร้า"/"ถั่ว"/"กุ้ง" already worked the same way -- real
  // production gap: "ไม่กินไก่ มีอะไรแนะนำ" as a customer's very FIRST
  // message never reached the restaurant advisor at all (no restaurant
  // context existed yet for restaurantFollowUp's own history/context
  // check to fall back on), even though the semantically identical
  // "กินไม่เผ็ด แพ้กุ้ง มีอะไรแนะนำ" always worked correctly.
  const explicitFood = /(ที่ร้าน|ร้านอาหาร|ตำมา-ชาติ|ตำมา|เมนู|อาหาร|กินอะไร|อะไรกิน|ไรกิน|อะไรอร่อย|ตำ|ลาบ|น้ำตก|ยำ|ต้มแซ่บ|คอหมู|เสือร้องไห้|ไก่บ้าน|ปลาช่อน|ปลานิล|ข้าวเหนียว|เผ็ด|ปลาร้า|ถั่ว|กุ้ง|ไก่|หมู|เนื้อ|พริก)/u.test(text);
  if (explicitFood) return true;
  // "แนะนำ" alone (e.g. "มีอะไรแนะนำอีก" -- a natural "what else do you
  // recommend" follow-up) was missing here -- real production gap: with
  // restaurant context already established, this colloquial follow-up
  // matched none of the other markers and fell all the way through to a
  // generic, unrelated "no confirmed data" fallback instead of re-
  // running the recommendation with the guest's remembered constraints.
  // Safe to add broadly here (unlike in classifyRestaurantDietaryIntent's
  // own constraint marker) because this whole branch only fires when
  // hasRestaurantHistory/hasRestaurantServerContext is ALREADY true --
  // i.e. the guest is already in a restaurant-topic conversation.
  const restaurantFollowUp = /(งบ|แพ้|ไม่กิน|ไม่เอา|จัด.*ชุด|จัด.*โต๊ะ|เพิ่มอะไร|ต่างกัน|อันไหน|เอาชุด|ชุดเมื่อกี้|อันเมื่อกี้|อันนั้น|ราคา|กี่บาท|เผ็ด|จืด|หวาน|เค็ม|\d+\s*คน|คนเดียว|สองคน|สามคน|สี่คน|แนะนำ)/u.test(text);
  return (hasRestaurantHistory || hasRestaurantServerContext) && restaurantFollowUp;
}

function formatMoney(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.round(n)} บาท` : '-';
}

// RESTAURANT_CONSTRAINT_COPY_FIX_V1
//
// advisor.parsed reflects the WHOLE rolling recentMessages window (needed
// so menu filtering still respects a constraint stated several turns ago),
// but this function claims to say what was "just" confirmed -- restating a
// stale, unrelated constraint from earlier in that window (e.g. a shrimp
// exclusion from several turns back) as freshly confirmed on a turn that
// never mentioned it reads as a fabricated/irrelevant answer. Real
// production incident this closes: a spice-only question ("ไม่ค่อยเผ็ด...
// ทานเผ็ดไม่เก่ง") got back "✅ ...ไม่มีกุ้ง" because an earlier, unrelated
// turn in the window had mentioned shrimp. Re-parses the CURRENT message
// alone and only labels a constraint that's present in BOTH the full
// rolling parse (so it's still real/still filtering) AND this turn's own
// text (so it's honestly "just said", not "remembered from before").
function formatRestaurantConstraintAck(advisor: any, message: string): string {
  const parsed = advisor?.parsed && typeof advisor.parsed === 'object' ? advisor.parsed as Record<string, unknown> : null;
  if (!parsed) return '';
  const mentionedNow = parseRestaurantConstraintSignals({ query: message, recentMessages: [] }, []);

  const labels: string[] = [];
  const avoidProteins = (Array.isArray(parsed.avoidProteins) ? parsed.avoidProteins.map(String) : [])
    .filter(protein => mentionedNow.avoidProteins.includes(protein as any));
  const proteinLabels: Record<string, string> = {
    pork:'ไม่มีหมู', beef:'ไม่มีเนื้อวัว', chicken:'ไม่มีไก่', fish:'ไม่มีปลา', egg:'ไม่มีไข่',
  };
  for (const protein of avoidProteins) if (proteinLabels[protein]) labels.push(proteinLabels[protein]);

  if (parsed.vegetarian === true && mentionedNow.vegetarian) labels.push('มังสวิรัติ');

  const avoidIngredients = (Array.isArray(parsed.avoidIngredients) ? parsed.avoidIngredients.map(String) : [])
    .filter(ingredient => mentionedNow.avoidIngredients.some(nowIngredient => ingredient.includes(nowIngredient) || nowIngredient.includes(ingredient)));
  if (avoidIngredients.some(value => value.includes('ปลาร้า'))) labels.push('ไม่มีปลาร้า');
  if (avoidIngredients.some(value => value.includes('กุ้ง'))) labels.push('ไม่มีกุ้ง');
  if (avoidIngredients.some(value => value.includes('ถั่ว'))) labels.push('ไม่มีถั่วลิสง');

  const allergens = (Array.isArray(parsed.allergenFlags) ? parsed.allergenFlags.map(String) : [])
    .filter(allergen => mentionedNow.allergenFlags.includes(allergen));
  const allergenLabels: Record<string, string> = { peanut:'เลี่ยงถั่ว', shrimp:'เลี่ยงกุ้ง', fish:'เลี่ยงปลา', egg:'เลี่ยงไข่' };
  for (const allergen of allergens) if (allergenLabels[allergen]) labels.push(allergenLabels[allergen]);

  if (mentionedNow.spice != null) {
    if (parsed.spice === 'none') labels.push('ไม่เผ็ด');
    else if (parsed.spice === 'mild') labels.push('ไม่เผ็ดจัด');
    else if (parsed.spice === 'medium') labels.push('เผ็ดกลาง');
  }

  const unique = [...new Set(labels)];
  return unique.length ? `✅ คัดเมนูตามที่บอกให้แล้วครับ: ${unique.join(' · ')}` : '';
}

// "Do not dump long menu/product lists unless user asks for a list" (see
// THONGTHAI_HANDOFF.md's "Post-PR67 Polish" entry) -- an explicit request
// for the full catalog or prices widens formatAdvisorMessage's default
// top-3 host-style cap back out, instead of always showing everything.
const FULL_MENU_LIST_MARKER = /ขอเมนูทั้งหมด|เอามาหมด|ขอดูเมนูทั้งหมด|ส่งเมนูละเอียด|มีอะไรบ้าง.*(?:หมด|ทั้งหมด)/u;

function wantsFullRestaurantList(message: string): boolean {
  return FULL_MENU_LIST_MARKER.test(message);
}

// Master Roadmap Phase 2 fix -- restaurant memory UX regression (owner's
// retest of PR #72/#73 caught this): a bare constraint/allergy
// DECLARATION ("กินไม่เผ็ด แพ้กุ้ง") was getting the SAME full
// recommendation dump formatAdvisorMessage produces for an actual
// recommendation REQUEST ("ร้านอาหารมีอะไรแนะนำ") -- and the later,
// genuine recommendation request then repeated that exact same long
// caution+menu block again, since nothing distinguished "just declaring
// a constraint" from "asking what to eat," and nothing suppressed the
// caution block on a turn that didn't restate the allergy itself. Two
// small, closed marker sets close this without touching how constraints
// are captured or stored (that part -- _customer-db.ts's
// capturePreferenceSignals plus GuestContext.constraints -- was already
// correct; this is a response-composition fix only).
// "มีอะไร..." ("what is there...") is itself a discovery/recommendation
// construction regardless of what follows it -- "มีอะไรไม่เผ็ด" ("what
// do you have that's not spicy") is a real production phrasing that
// combines a constraint AND a request in one, and must still get the
// full (filtered) recommendation list, never the short ack alone.
// "กินอะไรได้บ้าง"/"กินได้บ้าง" ("what can [they] eat") is just as common a
// recommendation phrasing as "กินอะไรดี" or "มีอะไร...", but was missing
// here -- real production incident this closes: "แฟนแพ้กุ้ง มีอะไรกินได้
// บ้าง" only matched because it also happened to contain "มีอะไร"; the
// equally common "แพ้กุ้ง กินอะไรได้บ้าง" (no "มี") matched nothing here at
// all and silently fell back to the short constraint-only acknowledgment
// instead of a real recommendation.
const RESTAURANT_RECOMMEND_REQUEST_MARKER = /มีอะไร|แนะนำอะไร|อยากกิน|กินอะไรดี|กินอะไรได้|ขอเมนู|มีเมนู|จัดชุด|จัดโต๊ะ|อะไรอร่อย|มีไรกิน|ไรกิน/u;
// The SAME constraint vocabulary _restaurant-intelligence.ts's own
// parsePreferences checks -- but tested against ONLY the current
// message (never chat history), to tell "the customer just stated this"
// apart from "this is only known because it's remembered." Kept in sync
// by hand, same discipline as every other cross-module marker pair in
// this codebase (see _semantic-hospitality-interpreter.ts's
// LOW_WALKING_MARKER comment for the precedent this follows).
const RESTAURANT_CONSTRAINT_MENTION_MARKER = /เผ็ด|แพ้|ปลาร้า|ถั่ว(?:ลิสง)?|กุ้ง|พริก|ไม่กิน|ไม่เอา|มังสวิรัติ|งด(?:หมู|เนื้อ|ไก่|ปลา|ไข่)/u;
// A CORRECTION ("จริง ๆ กินไก่ได้" -- "actually I can eat chicken") is
// still a constraint-related message, not a recommendation request --
// but it contains none of RESTAURANT_CONSTRAINT_MENTION_MARKER's own
// "new restriction" vocabulary (no "ไม่กิน"/"ไม่เอา"/"งด..."), so without
// this it would classify as OTHER and fall through to a full menu dump.
// Kept as a separate, narrow marker (rather than broadening the general
// one with bare "ไก่"/"หมู"/"เนื้อ") so an unrelated food mention like
// "มีเมนูไก่ไหม" never gets misread as a dietary constraint.
const RESTAURANT_CONSTRAINT_CORRECTION_MARKER = /(?:จริง ๆ|จริงๆ|แก้ไข|เปลี่ยนใจ).{0,12}(?:กินเผ็ดได้|ทานเผ็ดได้|กินไก่ได้|ทานไก่ได้|กินหมูได้|ทานหมูได้|กินเนื้อได้|ทานเนื้อได้|กินกุ้งได้|ทานกุ้งได้)/u;

export type RestaurantDietaryIntent =
  | 'CONSTRAINT_ONLY'
  | 'RECOMMENDATION_ONLY'
  | 'CONSTRAINT_AND_RECOMMENDATION'
  | 'OTHER';

// The single hard gate this whole feature rests on: a dietary constraint
// message is NEVER inferred to be a menu request just because a
// constraint is present. Only an explicit recommendation-trigger word
// (RESTAURANT_RECOMMEND_REQUEST_MARKER) ever allows a recommendation.
export function classifyRestaurantDietaryIntent(message: string): RestaurantDietaryIntent {
  const hasConstraint = RESTAURANT_CONSTRAINT_MENTION_MARKER.test(message) || RESTAURANT_CONSTRAINT_CORRECTION_MARKER.test(message);
  const hasRecommendRequest = RESTAURANT_RECOMMEND_REQUEST_MARKER.test(message);
  if (hasConstraint && hasRecommendRequest) return 'CONSTRAINT_AND_RECOMMENDATION';
  if (hasConstraint) return 'CONSTRAINT_ONLY';
  if (hasRecommendRequest) return 'RECOMMENDATION_ONLY';
  return 'OTHER';
}

function mentionsRestaurantConstraintNow(intent: RestaurantDietaryIntent): boolean {
  return intent === 'CONSTRAINT_ONLY' || intent === 'CONSTRAINT_AND_RECOMMENDATION';
}

function restaurantConstraintAvoidLabels(advisor: any): string[] {
  const parsed = advisor?.parsed && typeof advisor.parsed === 'object' ? advisor.parsed as Record<string, unknown> : null;
  const labels: string[] = [];
  if (!parsed) return labels;
  const allergens = Array.isArray(parsed.allergenFlags) ? parsed.allergenFlags.map(String) : [];
  const allergenAvoidLabels: Record<string, string> = { shrimp: 'กุ้ง/กุ้งแห้ง', peanut: 'ถั่ว', fish: 'ปลา', egg: 'ไข่' };
  for (const allergen of allergens) if (allergenAvoidLabels[allergen] && !labels.includes(allergenAvoidLabels[allergen])) labels.push(allergenAvoidLabels[allergen]);
  const avoidIngredients = Array.isArray(parsed.avoidIngredients) ? parsed.avoidIngredients.map(String) : [];
  if (avoidIngredients.some(value => value.includes('ปลาร้า')) && !labels.includes('ปลาร้า')) labels.push('ปลาร้า');
  if (avoidIngredients.some(value => value.includes('กุ้ง')) && !labels.includes('กุ้ง')) labels.push('กุ้ง');
  if (avoidIngredients.some(value => value.includes('ถั่ว')) && !labels.includes('ถั่ว')) labels.push('ถั่ว');
  const avoidProteins = Array.isArray(parsed.avoidProteins) ? parsed.avoidProteins.map(String) : [];
  const proteinLabels: Record<string, string> = { pork: 'หมู', beef: 'เนื้อวัว', chicken: 'ไก่', fish: 'ปลา', egg: 'ไข่' };
  for (const protein of avoidProteins) if (proteinLabels[protein] && !labels.includes(proteinLabels[protein])) labels.push(proteinLabels[protein]);
  return labels;
}

// Short acknowledgment-only reply for a bare constraint declaration --
// never the full menu-recommendation format. Reuses restaurantMenuAdvice's
// OWN parsed constraints (so the "what I'll avoid" wording always
// matches what was actually filtered, cumulative across the whole
// conversation, never a second, separately-maintained copy) but
// composes a two-line acknowledgment instead of a recommendation list.
// The staff/cross-contamination CAUTION, unlike the avoid-list, is
// gated on the CURRENT message only ("แพ้" mentioned THIS turn) -- real
// production bug this closes: advisor.parsed.allergenFlags reflects the
// whole rolling recentMessages window, so a LATER, unrelated constraint
// update (e.g. "ไม่กินไก่" sent after an earlier "แพ้กุ้ง") kept re-
// showing the full caution block every single turn, exactly the
// "repeated full allergy warning" the owner's own example explicitly
// shows should NOT happen on a follow-up constraint update.
function formatConstraintDeclarationAck(advisor: any, message: string): string {
  const parsed = advisor?.parsed && typeof advisor.parsed === 'object' ? advisor.parsed as Record<string, unknown> : null;
  // Same current-turn-only filtering formatRestaurantConstraintAck applies
  // (see its own comment): a bare constraint declaration must only
  // acknowledge what THIS message actually stated, never a stale
  // avoid/spice signal carried over from earlier in the rolling window.
  const mentionedNow = parseRestaurantConstraintSignals({ query: message, recentMessages: [] }, []);
  const avoidLabels = restaurantConstraintAvoidLabels(advisor).filter(label =>
    mentionedNow.avoidIngredients.some(now => label.includes(now) || now.includes(label))
    || mentionedNow.avoidProteins.some(protein => ({ pork:'หมู', beef:'เนื้อวัว', chicken:'ไก่', fish:'ปลา', egg:'ไข่' } as Record<string,string>)[protein] === label)
    || mentionedNow.allergenFlags.some(allergen => ({ shrimp:'กุ้ง/กุ้งแห้ง', peanut:'ถั่ว', fish:'ปลา', egg:'ไข่' } as Record<string,string>)[allergen] === label));
  const spice = mentionedNow.spice != null ? parsed?.spice : null;
  const spicePart = spice === 'none' ? 'เลือกแบบไม่เผ็ด' : spice === 'mild' ? 'เลือกแบบเผ็ดน้อย' : '';
  const avoidPart = avoidLabels.length ? `เลี่ยง${avoidLabels.join('/')}` : '';
  const actionParts = [avoidPart, spicePart].filter(Boolean);
  const lead = actionParts.length
    ? `รับทราบครับ 🙏 เดี๋ยวทองไทยจะ${actionParts.join(' และ')}ให้นะครับ`
    : 'รับทราบครับ 🙏 เดี๋ยวทองไทยจะช่วยเลือกเมนูที่เหมาะกับที่บอกให้นะครับ';
  const hasAllergyFlag = Array.isArray(parsed?.allergenFlags) && (parsed!.allergenFlags as unknown[]).length > 0;
  const allergyMentionedNow = /แพ้/u.test(message);
  const caution = (hasAllergyFlag && allergyMentionedNow) ? 'หน้างานขอให้แจ้งพนักงานอีกครั้งเรื่องแพ้อาหาร เพื่อกันการปนเปื้อนครับ' : '';
  return composeLineShortReply([lead, caution]);
}

// A CORRECTION ("จริง ๆ กินไก่ได้") needs its OWN short reply, never
// formatConstraintDeclarationAck's -- that function derives its wording
// from advisor.parsed, which is re-computed from the rolling
// recentMessages window and would STILL contain the just-corrected
// restriction from an earlier turn in the same window, wrongly saying
// "จะเลี่ยงไก่" right after the customer said they CAN eat it. This reads
// the correction directly off the current message instead, matching the
// exact per-item vocabulary RESTAURANT_CONSTRAINT_CORRECTION_MARKER
// already recognizes. Returns null for a non-correction message.
function formatConstraintCorrectionAck(message: string): string | null {
  const corrected = (
    /(?:จริง ๆ|จริงๆ|แก้ไข|เปลี่ยนใจ).{0,12}(?:กินเผ็ดได้|ทานเผ็ดได้)/u.test(message) ? 'เผ็ด' :
    /(?:จริง ๆ|จริงๆ|แก้ไข|เปลี่ยนใจ).{0,12}(?:กินไก่ได้|ทานไก่ได้)/u.test(message) ? 'ไก่' :
    /(?:จริง ๆ|จริงๆ|แก้ไข|เปลี่ยนใจ).{0,12}(?:กินหมูได้|ทานหมูได้)/u.test(message) ? 'หมู' :
    /(?:จริง ๆ|จริงๆ|แก้ไข|เปลี่ยนใจ).{0,12}(?:กินเนื้อได้|ทานเนื้อได้)/u.test(message) ? 'เนื้อ' :
    /(?:จริง ๆ|จริงๆ|แก้ไข|เปลี่ยนใจ).{0,12}(?:กินกุ้งได้|ทานกุ้งได้)/u.test(message) ? 'กุ้ง' :
    null
  );
  if (!corrected) return null;
  return `รับทราบครับ 🙏 ถ้างั้นทาน${corrected}ได้ตามปกติเลยครับ`;
}

// Natural, non-repeating phrase for a recommendation reply that's using
// a REMEMBERED constraint (not restated this turn) -- e.g. "เลี่ยงกุ้งและ
// ไม่เผ็ด" -- so formatAdvisorMessage can say "ถ้ายัง...อยู่" instead of
// re-showing the full caution block every single turn.
function naturalRestaurantConstraintPhrase(advisor: any): string {
  const parsed = advisor?.parsed && typeof advisor.parsed === 'object' ? advisor.parsed as Record<string, unknown> : null;
  if (!parsed) return '';
  const avoidLabels = restaurantConstraintAvoidLabels(advisor).map(label => label.replace('/กุ้งแห้ง', ''));
  const parts: string[] = [];
  if (avoidLabels.length) parts.push(`เลี่ยง${avoidLabels.join('/')}`);
  if (parsed.spice === 'none') parts.push('ไม่เผ็ด');
  else if (parsed.spice === 'mild') parts.push('เผ็ดน้อย');
  return parts.join('และ');
}

function isBareStapleRecommendationRow(row: any): boolean {
  const mealRoles = Array.isArray(row?.mealRoles) ? row.mealRoles.filter((value: unknown): value is string => typeof value === 'string') : [];
  const proteinTags = Array.isArray(row?.proteinTags) ? row.proteinTags.filter((value: unknown): value is string => typeof value === 'string') : [];
  return mealRoles.length > 0 && mealRoles.every((role: string) => role === 'side') && proteinTags.length === 0;
}

function advisorRecommendationSelection(
  advisor: any,
  fullList: boolean,
  currentMessage: string,
  alreadyShownNames: string[] = [],
): { shown: any[]; moreAvailable: boolean; wantsAlternative: boolean } {
  const rawRows = Array.isArray(advisor?.recommendations) ? advisor.recommendations : [];
  const wantsAlternative = !fullList && isRestaurantAlternativeRequest(currentMessage);

  // A generic recommendation should not promote bare staples (plain rice,
  // plain noodles, etc.) as standalone "best picks". Keep them available in
  // full-list/compose/pairing experiences, where side dishes are useful.
  const scopedRows = !fullList && advisor?.mode === 'recommend'
    ? rawRows.filter((row: any) => !isBareStapleRecommendationRow(row))
    : rawRows;

  const alreadyShown = new Set(alreadyShownNames.map(name => name.trim()).filter(Boolean));
  const candidateRows = wantsAlternative
    ? scopedRows.filter((row: any) => !alreadyShown.has(String(row?.name ?? '').trim()))
    : scopedRows;

  const shown = fullList
    ? candidateRows
    : wantsAlternative
      ? candidateRows.slice(0, 3)
      : limitAdvisoryList(candidateRows, 3);
  return {
    shown,
    moreAvailable: candidateRows.length > shown.length,
    wantsAlternative,
  };
}

function formatAdvisorMessage(
  advisor: any,
  fullList = false,
  constraintMentionedNow = true,
  currentMessage = '',
  alreadyShownNames: string[] = [],
): string {
  const notices: string[] = Array.isArray(advisor?.notices) ? advisor.notices : [];
  // "แพ้กุ้ง ตำไทยกินได้ไหม" -- answer about THAT specific named dish from
  // its real recorded ingredients/allergenFlags, never a generic
  // constraint-declaration ack that ignores the actual question, and
  // never a full ingredient dump. Mirrors the allergy safety net's own
  // conservative reasoning: "safe" here means "not excluded by what's
  // recorded," never a claim of certainty, so a severe allergy still
  // gets pointed at staff/kitchen confirmation either way.
  if (advisor?.mode === 'item_safety_check' && advisor.itemSafety?.item) {
    const { item, safe } = advisor.itemSafety as { item: { name: string }; safe: boolean };
    const allergenLabelByCode: Record<string, string> = { peanut: 'ถั่ว', shrimp: 'กุ้ง/กุ้งแห้ง', fish: 'ปลา', egg: 'ไข่' };
    const allergenFlags: string[] = Array.isArray(advisor?.parsed?.allergenFlags) ? advisor.parsed.allergenFlags : [];
    const allergenLabel = allergenFlags.map(code => allergenLabelByCode[code]).filter(Boolean).join('/')
      || 'สารก่อภูมิแพ้ที่บอกไว้';
    return safe
      ? composeLineShortReply([
          `จากข้อมูลเมนูที่มี ${item.name} ไม่มี${allergenLabel}เป็นส่วนประกอบครับ`,
          'แต่ถ้าแพ้รุนแรง ขอให้แจ้งพนักงานอีกครั้งก่อนสั่ง เผื่อเรื่องครัวร่วมเพื่อความปลอดภัยครับ',
        ])
      : composeLineShortReply([
          `${item.name} มี${allergenLabel}เป็นส่วนประกอบครับ ขอแนะนำให้เลี่ยงไว้ก่อนนะครับ`,
          'ถ้าอยากได้เมนูทดแทนที่ปลอดภัยกว่า บอกได้เลยครับ เดี๋ยวช่วยแนะนำให้',
        ]);
  }
  if (advisor?.mode === 'compare' && Array.isArray(advisor.comparison) && advisor.comparison.length) {
    const [first, second] = advisor.comparison;
    const lines = advisor.comparison.slice(0, 4).map((row: any) => {
      const details = [row.summary, `ราคา ${formatMoney(row.price)}`, row.signature ? 'เมนูเด่นร้าน' : null]
        .filter(Boolean).join(' · ');
      return `• ${row.name}\n  ${details}`;
    });
    return [
      first && second ? `🍽️ ${first.name} vs ${second.name}` : '🍽️ เทียบจากเมนูจริง',
      '',
      ...lines,
      notices[0] ? `\n⚠️ ${notices[0]}` : '',
    ].filter(Boolean).join('\n');
  }
  if (advisor?.mode === 'compose_set' && advisor.set?.items?.length) {
    const set = advisor.set;
    const lines = set.items.map((line: any) =>
      `• ${line.name} ×${line.quantity} — ${formatMoney(line.lineTotal)}`);
    const constraintAck = formatRestaurantConstraintAck(advisor, currentMessage);
    return [
      constraintAck,
      '🍽️ ชุดที่ทองไทยแนะนำ',
      '',
      ...lines,
      '',
      `💰 รวม ${formatMoney(set.total)}${set.budget != null ? ` / งบ ${formatMoney(set.budget)}` : ''}`,
      set.remainingBudget != null && set.remainingBudget > 0 ? `เหลืองบ ${formatMoney(set.remainingBudget)}` : '',
      set.limitedByBudget ? 'จัดให้พอดีงบ โดยเก็บเมนูหลักไว้ก่อนครับ' : '',
      set.optionalDessert ? `🍨 เพิ่มได้: ${set.optionalDessert.name} ${formatMoney(set.optionalDessert.price)}` : '',
      notices[0] ? `⚠️ ${notices[0]}` : '',
      '',
      'ถ้าชุดนี้โอเค พิมพ์ “เอาชุดนี้” ได้เลยครับ',
    ].filter(Boolean).join('\n');
  }
  // Host-style, not a menu dump: allergy/spice caution (if any) leads,
  // top 3 items by default -- the full catalog only when the customer
  // explicitly asks (wantsFullRestaurantList) -- and one useful next step
  // instead of a per-item sales pitch. See THONGTHAI_HANDOFF.md's
  // "Post-PR67 Polish" entry for the evidence this closes: a real
  // production reply for an allergy question led with a long item/price
  // dump instead of care first.
  const allRows = Array.isArray(advisor?.recommendations) ? advisor.recommendations : [];
  if (allRows.length) {
    const { shown, moreAvailable, wantsAlternative } = advisorRecommendationSelection(
      advisor,
      fullList,
      currentMessage,
      alreadyShownNames,
    );
    // Master Roadmap Phase 2 fix -- the full caution block (constraintAck
    // + allergyNotice) only leads when THIS message is the one restating
    // the constraint; on a later turn using a REMEMBERED constraint
    // (constraintMentionedNow=false), that block is dropped in favor of
    // a short "ถ้ายัง...อยู่" phrase below -- otherwise every follow-up
    // recommendation request re-dumps the exact same long block the
    // customer already saw (the owner's own retest catch).
    const constraintAck = constraintMentionedNow ? formatRestaurantConstraintAck(advisor, currentMessage) : '';
    const allergyNotice = constraintMentionedNow
      ? notices.find((notice: string) => /สารก่อภูมิแพ้/u.test(notice))
      : undefined;
    const rememberedConstraintPhrase = constraintMentionedNow ? '' : naturalRestaurantConstraintPhrase(advisor);
    const parsed = advisor?.parsed && typeof advisor.parsed === 'object' ? advisor.parsed as Record<string, unknown> : null;
    const partySizeKnown = parsed?.partySize != null;
    if (wantsAlternative && shown.length === 0) {
      const prefix = rememberedConstraintPhrase ? `ถ้ายัง${rememberedConstraintPhrase}อยู่ ` : '';
      return composeLineShortReply([
        `${prefix}ตอนนี้เมนูที่ผ่านเงื่อนไขและยืนยันได้มีเท่านี้ก่อนครับ`,
        'ทองไทยไม่อยากวนเมนูเดิมหรือเดาเมนูเพิ่มให้ครับ',
      ]);
    }
    const intro = advisor?.mode === 'pairing'
      ? 'มีเมนูนี้แล้ว เพิ่มนี้จะบาลานซ์โต๊ะกำลังดีครับ'
      : wantsAlternative
        ? rememberedConstraintPhrase
          ? `ถ้ายัง${rememberedConstraintPhrase}อยู่ มีอีกครับ ลองชุดนี้ได้เลย 😊`
          : 'มีอีกครับ ลอง 1–2 อย่างนี้ได้เลย 😊'
        : rememberedConstraintPhrase
          ? `ถ้ายัง${rememberedConstraintPhrase}อยู่ ทองไทยแนะนำเริ่มจาก 2–3 อย่างนี้ครับ 😊`
          : (constraintAck || allergyNotice) ? 'จากเมนูที่มี ทองไทยแนะนำ' : '🍽️ เมนูที่น่าลองตอนนี้';
    const closing = advisor?.mode === 'pairing'
      ? ''
      : !partySizeKnown ? 'มากี่คนครับ เดี๋ยวทองไทยช่วยจัดให้พอดีโต๊ะครับ'
        : moreAvailable && !fullList ? 'ถ้าอยากดูเมนูละเอียด ทองไทยส่งต่อให้ได้ครับ' : '';
    return composeLineShortReply([
      // Allergy/dietary caution always leads (hard rule: care/safety
      // note first) -- constraintAck confirms exactly what was filtered
      // ("ไม่มีกุ้งแห้ง · เลี่ยงกุ้ง"), allergyNotice adds the staff-notify
      // caution a filtered ingredient list alone can't guarantee. Both
      // are '' /undefined (never shown) when the constraint is only
      // remembered, not restated this turn -- see rememberedConstraintPhrase.
      constraintAck,
      allergyNotice,
      intro,
      ...shown.map((row: any) => {
        const reason = fullList && Array.isArray(row.reasons) && row.reasons.length
          ? trimLongRecommendationForLine(row.reasons[0]) : '';
        return `• ${row.name} — ${formatMoney(row.price)}${reason ? ` (${reason})` : ''}`;
      }),
      closing,
    ]);
  }
  return notices[0] ?? 'ตอนนี้ยังไม่มีเมนูที่ตรงเงื่อนไขและพร้อมขายในสต๊อกครับ';
}

function proposedSetFromAdvisor(advisor: any): AgentStateUpdate | undefined {
  if (advisor?.mode !== 'compose_set' || !Array.isArray(advisor.set?.items) || !advisor.set.items.length) return undefined;
  return {
    restaurantProposedSet: {
      source: 'restaurant_menu_advisor_v1',
      items: advisor.set.items.map((line: any) => ({ name: String(line.name), quantity: Math.max(1, Number(line.quantity) || 1) })),
      total: Math.max(0, Math.floor(Number(advisor.set.total) || 0)),
      budget: typeof advisor.set.budget === 'number' ? Math.max(0, Math.floor(advisor.set.budget)) : null,
      partySize: typeof advisor.set.partySize === 'number' ? Math.max(1, Math.floor(advisor.set.partySize)) : null,
      createdAt: new Date().toISOString(),
    },
  };
}

function formatPreorderPickup(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat('th-TH', {
    timeZone:'Asia/Bangkok', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', hour12:false,
  }).format(date);
}

function preorderFailureMessage(detail: string): string {
  if (detail === 'menu_item_unavailable') return 'มีบางเมนูในชุดนี้เพิ่งไม่พร้อมขายครับ เดี๋ยวทองไทยจัดชุดใหม่จากของที่พร้อมให้ได้เลย';
  if (detail === 'menu_item_not_found') return 'ชุดเดิมมีเมนูที่หาไม่เจอในรายการล่าสุดครับ เดี๋ยวทองไทยจัดใหม่จากเมนูจริงให้';
  if (detail === 'invalid_requested_time') return 'เวลารับอาหารยังไม่ชัดครับ ลองพิมพ์ใหม่แบบ “พรุ่งนี้ 14:00” ได้เลย';
  return 'ตอนนี้ระบบสร้างออเดอร์ให้ยังไม่สำเร็จครับ ข้อมูลชุดเดิมยังอยู่ ลองส่งวัน เวลา หรือชื่ออีกครั้งได้เลย';
}

function transactionNotificationMessage(detail: Record<string, unknown>): string {
  const status = detail.notificationStatus;
  if (status === 'sent') return 'แจ้งทีมงานทาง LINE แล้วครับ';
  if (status === 'duplicate') return 'ทีมงานได้รับการแจ้งเตือนรายการนี้แล้วครับ';
  if (status === 'not_bound') return 'บันทึกเข้าหลังบ้านแล้ว แต่กลุ่ม LINE ของทีมนี้ยังไม่ได้ผูกครับ';
  if (status === 'failed') return 'บันทึกเข้าหลังบ้านแล้ว แต่การแจ้งกลุ่ม LINE ไม่สำเร็จ ทีมงานตรวจต่อจากหลังบ้านได้ครับ';
  return 'บันทึกเข้าหลังบ้านแล้วครับ';
}

function isRestaurantPriceQuestion(text: string): boolean {
  return /(ราคา|กี่บาท|เท่าไร|เท่าไหร่|รวม)/u.test(text);
}

function isRestaurantAdvisorSideQuestion(text: string): boolean {
  return isRestaurantPriceQuestion(text)
    || /(เผ็ด|จืด|หวาน|เค็ม|ไม่กิน|ไม่เอา|แพ้|มีอะไร|เมนู|แนะนำ|อันไหน|ต่างกัน)/u.test(text)
    || isPromotionDiscoveryIntent(text);
}

export async function restaurantPreorderDialogResponse(
  request: BrainRequest,
  runtime: { agentState: Record<string, unknown> },
  guestDbId: string | null,
  channel: BrainChannel,
): Promise<BrainResponse | null> {
  const set = currentRestaurantSet(runtime);
  if (!set) return null;
  const acceptedNow = RESTAURANT_SET_ACCEPT_RE.test(normThai(request.message));
  if (!acceptedNow && !set.preorderDraft) return null;
  const text = normThai(request.message);

  if (!acceptedNow && set.preorderDraft && isRestaurantAdvisorSideQuestion(text)) {
    if (isRestaurantPriceQuestion(text) && typeof set.total === 'number') {
      return {
        message: [
          `ชุดเมื่อกี้รวม ${Math.round(set.total)} บาทครับ`,
          'ถ้าจะสั่งต่อ ขอวัน + เวลารับอาหารได้เลย เช่น “พรุ่งนี้ 14:00”',
        ].join('\n'),
        intent:'information',
        contextUpdates:{},
        journeyAction:{type:'none',journey:null},
        suggestedActions:[],
        responseStyle:'direct',
        agentStateUpdate:{ restaurantProposedSet: set as AgentStateUpdate['restaurantProposedSet'] },
        semanticMemoryUpdates:[],
        toolCalls:[],
      };
    }
    return null;
  }

  const parsed = parseRestaurantPreorderTurn(request.message, set.preorderDraft ?? {});
  const draft = mergeRestaurantPreorderDraft(set.preorderDraft, parsed);
  const pendingSet: RestaurantProposedSetState = { ...set, preorderDraft:draft };
  const missing = missingRestaurantPreorderFields(draft);

  if (missing.length || !guestDbId) {
    return {
      message: !guestDbId
        ? 'ทองไทยจำชุดนี้ไว้แล้วครับ แต่ตอนนี้ยังเปิดรายการในระบบไม่ได้ ลองส่งข้อความอีกครั้งได้เลย'
        : formatRestaurantSetPrompt(pendingSet, draft),
      intent:'order',
      contextUpdates:{},
      journeyAction:{type:'none',journey:null},
      suggestedActions:[],
      responseStyle:'direct',
      agentStateUpdate:{ restaurantProposedSet: pendingSet as AgentStateUpdate['restaurantProposedSet'] },
      semanticMemoryUpdates:[],
      toolCalls:[],
    };
  }

  const firstResponse: BrainResponse = {
    message:'', intent:'order', contextUpdates:{}, journeyAction:{type:'none',journey:null},
    suggestedActions:[], responseStyle:'direct',
    agentStateUpdate:{ restaurantProposedSet: pendingSet as AgentStateUpdate['restaurantProposedSet'] },
    semanticMemoryUpdates:[], toolCalls:[],
  };
  const toolResults = await executeBrainTools(
    guestDbId,
    channel,
    [{
      name:'create_restaurant_preorder',
      args:{
        date:draft.date,
        time:draft.time,
        items:set.items,
        customerName:draft.customerName,
        phone:draft.phone,
        email:draft.email,
      },
    }],
    firstResponse,
    request,
  );
  const result = toolResults[0];
  if (!result?.ok) {
    return {
      ...firstResponse,
      message: preorderFailureMessage(result?.detail ?? 'execution_failed'),
      agentStateUpdate:{ restaurantProposedSet: pendingSet as AgentStateUpdate['restaurantProposedSet'] },
    };
  }

  let detail: Record<string, unknown> = {};
  try { detail = JSON.parse(result.detail) as Record<string, unknown>; } catch { /* keep safe defaults */ }
  const duplicate = detail.duplicate === true;
  const code = typeof detail.preorderCode === 'string' ? detail.preorderCode : '';
  const pickup = typeof detail.requestedFor === 'string' ? formatPreorderPickup(detail.requestedFor) : `${draft.date} ${draft.time}`;
  const total = typeof detail.totalAmount === 'number' ? detail.totalAmount : set.total;
  const clearedSet = clearRestaurantPreorderDraft(set);

  return {
    ...firstResponse,
    message: [
      duplicate ? 'รายการนี้มีอยู่แล้วครับ ✅' : 'เรียบร้อยครับ ✅',
      code ? `🍽️ ออเดอร์ ${code}` : '🍽️ ตำมา-ชาติ',
      `🕑 รับอาหาร ${pickup}`,
      typeof total === 'number' ? `💰 รวม ${Math.round(total)} บาท` : '',
      '📌 สถานะ: รอร้านรับออเดอร์',
      '',
      duplicate
        ? 'ทองไทยใช้รายการเดิมให้ ไม่ได้สร้างซ้ำครับ'
        : transactionNotificationMessage(detail),
    ].filter(Boolean).join('\n'),
    agentStateUpdate:{ restaurantProposedSet: clearedSet as AgentStateUpdate['restaurantProposedSet'] },
  };
}

// ---------------------------------------------------------------------------
// Promotion OS Phase 2.1: deterministic discovery/redemption dialog. Never
// preempts a healthy LLM -- promotionDiscoveryFallbackResponse is only ever
// called from the LLMAvailabilityError catch block in the handler below.
// promotionContinuationResponse, like the restaurant preorder dialog, DOES
// run unconditionally before the LLM once a redemption is already in
// progress, so a multi-turn redemption reliably finishes even if the model
// recovers or degrades mid-conversation.
// ---------------------------------------------------------------------------

function activePromotionsFromRuntime(runtime: BrainRuntimeContext): PromotionListItem[] {
  const fact = runtime.worldFacts.find(item => item.fact_key === 'active_promotions_live');
  const value = fact?.fact_value as { promotions?: unknown } | undefined;
  const promotions = Array.isArray(value?.promotions) ? value!.promotions : [];
  return promotions.filter((item): item is PromotionListItem =>
    Boolean(item) && typeof item === 'object' && typeof (item as PromotionListItem).campaignId === 'string');
}

function promotionRedemptionFailureMessage(detail: string): string {
  const messages: Record<string, string> = {
    promotion_not_found: 'ขออภัยครับ หาโปรโมชันนี้ไม่เจอในระบบแล้ว',
    promotion_not_active: 'โปรโมชันนี้ยังไม่เปิดใช้งานหรือปิดไปแล้วครับ',
    promotion_not_started: 'โปรโมชันนี้ยังไม่เริ่มครับ',
    promotion_expired: 'โปรโมชันนี้หมดเขตแล้วครับ',
    promotion_redemption_limit_reached: 'โปรโมชันนี้มีคนใช้สิทธิ์ครบแล้วครับ',
    promotion_channel_not_allowed: 'โปรโมชันนี้ไม่ได้เปิดให้ใช้ในช่องทางนี้ครับ',
    promotion_has_no_items: 'โปรโมชันนี้ยังไม่มีรายการสินค้าที่ใช้งานได้ครับ',
    menu_item_unavailable: 'มีเมนูในโปรนี้เพิ่งไม่พร้อมขายครับ รบกวนสอบถามทีมงานอีกครั้ง',
    menu_item_not_found: 'มีเมนูในโปรนี้หาไม่เจอในรายการล่าสุดครับ รบกวนสอบถามทีมงานอีกครั้ง',
    invalid_requested_time: 'เวลารับอาหารยังไม่ชัดครับ ลองพิมพ์ใหม่แบบ "พรุ่งนี้ 14:00" ได้เลย',
  };
  return messages[detail] ?? 'ตอนนี้ระบบรับสิทธิ์โปรโมชันให้ยังไม่สำเร็จครับ ข้อมูลเดิมยังอยู่ ลองส่งอีกครั้งได้เลย';
}

const PROMOTION_TERMINAL_FAILURES = new Set([
  'promotion_not_found', 'promotion_not_active', 'promotion_not_started', 'promotion_expired',
  'promotion_redemption_limit_reached', 'promotion_channel_not_allowed', 'promotion_has_no_items',
]);

async function resolvePromotionRedemption(
  pending: PendingPromotionRedemption,
  request: BrainRequest,
  guestDbId: string | null,
  channel: BrainChannel,
): Promise<BrainResponse> {
  const parsed = parseRestaurantPreorderTurn(request.message, pending.draft, new Date(), { allowLooseName: false });
  const draft: RestaurantPreorderDraft = mergeRestaurantPreorderDraft(pending.draft, parsed);
  const updatedPending: PendingPromotionRedemption = { ...pending, draft };
  const missing = missingPromotionFields(updatedPending);

  if (missing.length || !guestDbId) {
    return {
      message: !guestDbId
        ? 'ทองไทยจำโปรนี้ไว้แล้วครับ แต่ตอนนี้ยังเปิดรายการในระบบไม่ได้ ลองส่งข้อความอีกครั้งได้เลยครับ'
        : formatPromotionRedeemPrompt(updatedPending),
      intent:'booking',
      contextUpdates:{},
      journeyAction:{type:'none',journey:null},
      suggestedActions:[],
      responseStyle:'direct',
      agentStateUpdate:{ pendingPromotionRedemption: updatedPending },
      semanticMemoryUpdates:[],
      toolCalls:[],
    };
  }

  const firstResponse: BrainResponse = {
    message:'', intent:'booking', contextUpdates:{}, journeyAction:{type:'none',journey:null},
    suggestedActions:[], responseStyle:'direct',
    agentStateUpdate:{ pendingPromotionRedemption: updatedPending },
    semanticMemoryUpdates:[], toolCalls:[],
  };
  const toolResults = await executeBrainTools(
    guestDbId,
    channel,
    [{
      name:'redeem_promotion',
      args:{
        campaignId: updatedPending.campaignId,
        customerName: draft.customerName,
        ...(draft.date ? { date: draft.date } : {}),
        ...(draft.time ? { time: draft.time } : {}),
        ...(draft.phone ? { phone: draft.phone } : {}),
        ...(draft.email ? { email: draft.email } : {}),
      },
    }],
    firstResponse,
    request,
  );
  const result = toolResults[0];
  if (!result?.ok) {
    const detail = result?.detail ?? 'execution_failed';
    const terminal = PROMOTION_TERMINAL_FAILURES.has(detail);
    return {
      ...firstResponse,
      message: promotionRedemptionFailureMessage(detail),
      agentStateUpdate: terminal
        ? { clearPendingPromotionRedemption: true }
        : { pendingPromotionRedemption: updatedPending },
    };
  }

  let detail: Record<string, unknown> = {};
  try { detail = JSON.parse(result.detail) as Record<string, unknown>; } catch { /* keep safe defaults */ }
  const status = typeof detail.status === 'string' ? detail.status : 'redeemed';
  const preorder = detail.preorder && typeof detail.preorder === 'object' ? detail.preorder as Record<string, unknown> : null;
  const code = preorder && typeof preorder.preorderCode === 'string' ? preorder.preorderCode : '';

  const message = status === 'redeemed'
    ? [
        'รับสิทธิ์โปรโมชันเรียบร้อยครับ ✅',
        `💡 ${updatedPending.title}`,
        code ? `🍽️ ออเดอร์ ${code}` : '',
        draft.date && draft.time ? `🕑 รับอาหาร ${formatPreorderPickup(`${draft.date}T${draft.time}:00+07:00`)}` : '',
        typeof updatedPending.promoTotal === 'number' ? `💰 ราคาพิเศษ ${Math.round(updatedPending.promoTotal)} บาท` : '',
        '📌 สถานะ: รอร้านรับออเดอร์',
      ].filter(Boolean).join('\n')
    : [
        'ทองไทยบันทึกคำขอรับสิทธิ์โปรโมชันไว้แล้วครับ ✅',
        `💡 ${updatedPending.title}`,
        'ทีมงานจะติดต่อกลับเพื่อดำเนินการต่อครับ',
      ].join('\n');

  return { ...firstResponse, message, agentStateUpdate:{ clearPendingPromotionRedemption: true } };
}

export async function promotionContinuationResponse(
  request: BrainRequest,
  runtime: BrainRuntimeContext,
  guestDbId: string | null,
  channel: BrainChannel,
): Promise<BrainResponse | null> {
  const pending = parsePendingPromotionRedemption(runtime.agentState.pendingPromotionRedemption);
  if (!pending) return null;

  // A repeated discovery question ("มีโปรอะไร", "มีโปรอะไรอีก", "มีโปรไหนบ้าง", ...)
  // must never be fed into the redemption field-parser -- parseRestaurantPreorderTurn's
  // loose name fallback would otherwise treat the customer's own question text as
  // their name. Only an explicit acceptance phrase, or a message that isn't itself
  // a pure discovery re-ask, continues the redemption; a bare re-ask re-shows the
  // live promo list and leaves the pending redemption untouched.
  const isDiscoveryReAsk = isPromotionDiscoveryIntent(request.message)
    && !isPromotionAcceptIntent(request.message)
    && !RESTAURANT_SET_ACCEPT_RE.test(request.message);
  if (isDiscoveryReAsk) {
    const promotions = activePromotionsFromRuntime(runtime);
    return {
      message: formatPromotionListMessage(promotions), intent:'recommendation', contextUpdates:{},
      journeyAction:{type:'none',journey:null}, suggestedActions:[], responseStyle:'direct',
      agentStateUpdate:{ pendingPromotionRedemption: pending },
      semanticMemoryUpdates:[], toolCalls:[],
    };
  }

  return resolvePromotionRedemption(pending, request, guestDbId, channel);
}

/**
 * Only ever invoked when the LLM brain itself is unavailable (see the
 * LLMAvailabilityError catch in the handler). Resolves discovery/redemption
 * intent entirely from real, already-eligibility-filtered
 * active_promotions_live data already loaded into runtime.worldFacts --
 * never a fresh guess, never an invented promotion/price/item.
 */
export async function promotionDiscoveryFallbackResponse(
  request: BrainRequest,
  runtime: BrainRuntimeContext,
  guestDbId: string | null,
  channel: BrainChannel,
): Promise<BrainResponse | null> {
  const promotions = activePromotionsFromRuntime(runtime);
  const decision = decidePromotionFallback(request.message, promotions, {
    activeTopic: runtime.agentState.active_topic,
  });

  if (decision.kind === 'not_promo_related') return null;
  if (decision.kind === 'no_promotions') {
    return {
      message: formatPromotionListMessage([]), intent:'information', contextUpdates:{},
      journeyAction:{type:'none',journey:null}, suggestedActions:[], responseStyle:'direct',
      agentStateUpdate:{ activeTopic:'promotion' },
      semanticMemoryUpdates:[], toolCalls:[],
    };
  }
  if (decision.kind === 'clarify') {
    return {
      message: formatPromotionClarificationMessage(decision.promotions), intent:'information', contextUpdates:{},
      journeyAction:{type:'none',journey:null}, suggestedActions:[], responseStyle:'direct',
      agentStateUpdate:{ activeTopic:'promotion' },
      semanticMemoryUpdates:[], toolCalls:[],
    };
  }
  if (decision.kind === 'context_followup') {
    const titles = decision.promotions.map(promo => promo.title).filter(Boolean);
    const message = titles.length === 1
      ? `โปรที่คุยไว้คือ “${titles[0]}” ครับ แต่ข้อมูลที่ยืนยันได้ตอนนี้ยังไม่ได้ระบุว่าโปรนี้ใช้กับกิจกรรมได้หรือไม่ ทองไทยเลยไม่ขอเดาให้ผิดครับ`
      : `ตอนนี้มีหลายโปรโมชั่นที่เปิดใช้อยู่ครับ (${titles.join(' / ')}) แต่ “อันเมื่อกี้” ยังชี้ไม่ชัดว่าเป็นโปรไหน และข้อมูลที่ยืนยันได้ยังไม่ได้ระบุการใช้กับกิจกรรมครับ บอกชื่อโปรได้เลยครับ`;
    return {
      message, intent:'information', contextUpdates:{},
      journeyAction:{type:'none',journey:null}, suggestedActions:[], responseStyle:'direct',
      agentStateUpdate:{ activeTopic:'promotion' },
      semanticMemoryUpdates:[], toolCalls:[],
    };
  }
  if (decision.kind === 'list') {
    // A pure discovery listing ("มีโปรอะไร") is not acceptance -- even when
    // exactly one promo is active, seeing the list must never by itself
    // start a pending redemption the customer never asked for (see
    // decidePromotionFallback's own isGenuinePromotionAcceptance: only a
    // 'start_redemption' decision, reached below, represents real intent).
    return {
      message: formatPromotionListMessage(decision.promotions), intent:'recommendation', contextUpdates:{},
      journeyAction:{type:'none',journey:null}, suggestedActions:[], responseStyle:'direct',
      agentStateUpdate: { activeTopic:'promotion' },
      semanticMemoryUpdates:[], toolCalls:[],
    };
  }
  return resolvePromotionRedemption(decision.pending, request, guestDbId, channel);
}


const CAFE_EXPLICIT_MARKER = /(?:คาเฟ่|กาแฟ|ลาเต้|อเมริกาโน่|คาปูชิโน่|เอสเปรสโซ่|อินทนิน|inthanin)/iu;
const CAFE_READ_ONLY_FOLLOWUP_MARKER = /(?:เครื่องดื่ม|ราคา|กี่บาท|เปิด|ปิด|กี่โมง|เมนู|มีอะไร|แนะนำ|ไม่กินกาแฟ|ไม่ดื่มกาแฟ|ไม่เอานมวัว|นมวัว|หวาน|ขม|เย็น|น้ำตาล|เมื่อกี้|ตัวไหน|เปลี่ยนใจ|ไม่เอาตัวนั้น|เอาไว้ก่อน|ยังไม่สั่ง|ยังไม่ต้องทำรายการ|ส่งไปที่ร้าน|ถึงร้านแล้วค่อย|ที่จอดรถ|อีกประมาณ.*ชั่วโมง|แฟน|คนเดียว|กลับมาเรื่อง)/u;

function isCafeReadOnlyTurn(message: string, activeTopic?: unknown): boolean {
  const text = message.trim();
  if (hasExplicitTransactionIntent(text)) return false;

  // Explicit topic switches always outrank stale café continuity. Without
  // this gate a previous activeTopic='cafe' plus generic words such as
  // "เมนู/มีอะไร/แนะนำ" can hijack a fresh restaurant/activity/stay/OTOP
  // question and answer about Inthanin instead.
  const explicitNonCafeTopic =
    /(?:ร้านอาหาร|ตำมา-ชาติ|ตำมา|ขี่ม้า|ม้า|atv|เอทีวี|ยิงธนู|ธนู|ที่พัก|เฮือนสเตย์|ห้องพัก|otop|โอทอป|ของฝาก|สินค้า(?:ชุมชน)?)/iu.test(text);
  if (explicitNonCafeTopic && !CAFE_EXPLICIT_MARKER.test(text)) return false;

  if (CAFE_EXPLICIT_MARKER.test(text)) return true;
  return activeTopic === 'cafe' && CAFE_READ_ONLY_FOLLOWUP_MARKER.test(text);
}

function recentCafeConversationText(agentState:Record<string,unknown>):string{
  const raw=agentState.conversationContext;
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return '';
  const turns=(raw as {recentTurns?:unknown}).recentTurns;
  if(!Array.isArray(turns))return '';
  return turns
    .slice(-12)
    .map(turn=>turn&&typeof turn==='object'&&typeof (turn as {content?:unknown}).content==='string'
      ? String((turn as {content:string}).content)
      : '')
    .filter(Boolean)
    .join('\n');
}

function cafePreferenceSummary(constraints: readonly string[]): string {
  const labels = [
    constraints.includes('no_coffee') ? 'ไม่เอากาแฟ' : '',
    constraints.includes('low_sweet') ? 'หวานน้อย' : '',
    constraints.includes('low_bitter') ? 'ไม่ขมมาก' : '',
    constraints.includes('no_cow_milk') ? 'ไม่เอานมวัว' : '',
    constraints.includes('no_sugar') ? 'ไม่ใส่น้ำตาล' : '',
  ].filter(Boolean);
  return labels.length ? labels.join(' · ') : 'ยังไม่ได้ล็อกรสชาติหรือเมนู';
}

const CAFE_MENU_ALIASES:Record<string,readonly string[]>={
  espresso:['เอสเพรสโซ่','เอสเปรสโซ่','เอสเปรสโซ','espresso'],
  americano:['อเมริกาโน่','อเมริกาโน','americano'],
  es_all_day:['เอสออลเดย์','เอส ออล เดย์','es all day'],
  cappuccino:['คาปูชิโน่','คาปูชิโน','cappuccino'],
  cafe_latte:['คาเฟ่ลาเต้','ลาเต้','cafe latte','latte'],
  mocha:['มอคค่า','มอคคา','mocha'],
  caramel_macchiato:['คาราเมล มัคคิอาโต้','คาราเมลมัคคิอาโต้','caramel macchiato'],
  cocoa:['โกโก้','cocoa'],
  fresh_milk:['นมสด','fresh milk'],
  pink_milk:['นมชมพู','pink milk'],
  thai_tea_latte:['ชาไทยลาเต้','ชาไทย','thai tea latte','thai tea'],
  green_tea_latte:['ชาเขียวลาเต้','ชาเขียว','green tea latte','green tea'],
  black_tea:['ชาดำ','black tea'],
  lemon_tea:['ชามะนาว','lemon tea'],
  uji_pure_matcha:['อูจิ เพียวมัทฉะ','อูจิเพียวมัทฉะ','เพียวมัทฉะ','มัทฉะ','uji pure matcha','matcha'],
};

function normalizeCafeLookup(value:string):string{
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('th-TH')
    .replace(/[()•·.,/\\_\-:!?'"“”‘’]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function compactCafeLookup(value:string):string{
  return normalizeCafeLookup(value).replace(/\s+/g,'');
}

function resolveCafeMenuItem(message:string,items:readonly CafeMasterMenuItem[]):CafeMasterMenuItem|null{
  const compact=compactCafeLookup(message);
  const candidates:Array<{item:CafeMasterMenuItem;score:number}>=[];
  for(const item of items){
    const aliases=[
      item.name_th,
      item.name_en,
      ...(CAFE_MENU_ALIASES[item.code]??[]),
    ].filter(Boolean);
    for(const alias of aliases){
      const needle=compactCafeLookup(alias);
      if(!needle||!compact.includes(needle))continue;
      let score=needle.length;
      // A generic "ลาเต้" must never beat the explicit tea-latte names.
      if(item.code==='cafe_latte'&&needle===compactCafeLookup('ลาเต้'))score-=20;
      candidates.push({item,score});
    }
  }
  candidates.sort((a,b)=>b.score-a.score);
  const resolved=candidates[0]?.item??null;
  if(resolved)return resolved;
  // Human shorthand: "ลาเต้" by itself means the coffee latte unless the
  // customer explicitly says tea/green-tea/Thai-tea/matcha.
  const normalizedMessage=compactCafeLookup(message);
  const genericLatte=normalizedMessage.includes(compactCafeLookup('ลาเต้'))
    || normalizedMessage.includes(compactCafeLookup('latte'));
  const teaLatte=/(?:ชาไทย|ชาเขียว|มัทฉะ|matcha|thai\s*tea|green\s*tea)/iu.test(normalizeCafeLookup(message));
  if(genericLatte&&!teaLatte){
    return items.find(item=>item.code==='cafe_latte'&&item.active)??null;
  }
  return null;
}

function resolveCafeSlot(message:string,item:CafeMasterMenuItem){
  const compact=compactCafeLookup(message);
  const standard:Record<string,readonly string[]>={
    hot:['ร้อน','hot'],
    iced:['เย็น','iced','ice'],
    frappe:['ปั่น','frappe','frappé'],
  };
  const matches=item.slots
    .filter(slot=>slot.active)
    .map(slot=>{
      const aliases=[
        slot.slot_code,
        slot.label_th,
        slot.label_en,
        ...(standard[slot.slot_code]??[]),
      ];
      const best=aliases
        .map(alias=>compactCafeLookup(alias))
        .filter(alias=>alias&&compact.includes(alias))
        .sort((a,b)=>b.length-a.length)[0];
      return best?{slot,score:best.length}:null;
    })
    .filter((value):value is {slot:CafeMasterMenuItem['slots'][number];score:number}=>Boolean(value))
    .sort((a,b)=>b.score-a.score);
  return matches[0]?.slot??null;
}

function resolveCafeModifier(message:string,modifiers:readonly CafeBranchModifier[]):CafeBranchModifier|null{
  const compact=compactCafeLookup(message);
  return modifiers.find(mod=>{
    if(!mod.active)return false;
    const aliases=[mod.modifier_code,mod.name_th,mod.name_en];
    if(mod.modifier_code==='oat_milk')aliases.push('นมโอ๊ต','โอ๊ต','oat milk','oat');
    return aliases.some(alias=>{
      const needle=compactCafeLookup(alias);
      return Boolean(needle&&compact.includes(needle));
    });
  })??null;
}

function cafeMoney(value:number):string{
  return Number(value).toLocaleString('th-TH',{maximumFractionDigits:2})+' บาท';
}

function cafeSlotLine(slot:CafeMasterMenuItem['slots'][number]):string{
  return `${slot.label_th} ${cafeMoney(slot.price)}`;
}

function cafeMenuListMessage(items:readonly CafeMasterMenuItem[]):string{
  const groups:Array<[CafeMasterMenuItem['category'],string]>=[
    ['coffee','กาแฟ'],
    ['tea','ชา'],
    ['matcha','มัทฉะ'],
    ['non_coffee','ไม่ใช่กาแฟ'],
  ];
  const lines=['มีครับ ที่ Inthanin ตาดโตนมีเครื่องดื่มหลัก ๆ ประมาณนี้'];
  for(const [category,label] of groups){
    const names=items.filter(item=>item.active&&item.category===category).map(item=>item.name_th);
    if(names.length)lines.push(`• ${label}: ${names.join(' · ')}`);
  }
  lines.push('', 'ถ้ามีตัวที่เล็งไว้ บอกชื่อมาได้เลยครับ เดี๋ยวทองไทยเช็กร้อน/เย็น/ปั่นกับราคาให้ตรงตัว');
  return lines.join('\n');
}

function cafeRecommendationMessage(
  request:BrainRequest,
  items:readonly CafeMasterMenuItem[],
):string{
  const active=items.filter(item=>item.active);
  const constraints=new Set(request.guestContext.constraints??[]);
  const selfNoCoffee=constraints.has('no_coffee')
    || /(?:ผม|ฉัน|หนู|ดิฉัน|เราเอง).{0,20}(?:ไม่กินกาแฟ|ไม่ดื่มกาแฟ|ไม่เอากาแฟ)/u.test(request.message);
  const companionNoCoffee=/(?:แฟน|ภรรยา|สามี|เพื่อน|ลูก).{0,24}(?:ไม่กินกาแฟ|ไม่ดื่มกาแฟ|ไม่เอากาแฟ)/u.test(request.message);
  const sharedNoCoffee=/(?:เราสองคน|เราทั้งคู่|ทั้งคู่).{0,24}(?:ไม่กินกาแฟ|ไม่ดื่มกาแฟ|ไม่เอากาแฟ)/u.test(request.message);
  const genericNoCoffee=/(?:ไม่กินกาแฟ|ไม่ดื่มกาแฟ|ไม่เอากาแฟ|no\s*coffee)/iu.test(request.message)
    && !companionNoCoffee
    && !/(?:ผม|ฉัน|หนู|ดิฉัน).{0,26}(?:ชอบ|เอา|อยากได้).{0,12}กาแฟ/u.test(request.message);
  const noCoffee=selfNoCoffee||sharedNoCoffee||genericNoCoffee;
  const couple=/(?:แฟน|คู่รัก|สองคน|2\s*คน|couple)/iu.test(request.message);
  const selfStrongCoffee=/(?:ผม|ฉัน|หนู|ดิฉัน).{0,26}(?:ชอบ|เอา|อยากได้).{0,12}กาแฟ.{0,12}(?:เข้ม|แรง)/u.test(request.message);
  const sharedLowSweet=/(?:เราสองคน|เราทั้งคู่|ทั้งคู่).{0,30}(?:ไม่ชอบหวาน|ไม่หวานมาก|หวานน้อย)/u.test(request.message)
    || constraints.has('low_sweet');

  if(couple&&companionNoCoffee&&!noCoffee){
    const selfPick=active.find(item=>item.code==='americano')
      ?? active.find(item=>item.code==='espresso')
      ?? active.find(item=>item.category==='coffee');
    const companionPick=active.find(item=>item.code==='uji_pure_matcha')
      ?? active.find(item=>item.code==='thai_tea_latte')
      ?? active.find(item=>item.category!=='coffee');
    if(selfPick&&companionPick){
      const lines=[
        'แยกให้สองคนคนละแก้วตามที่บอกได้ครับ',
        `• ของคุณ: ${selfPick.name_th}${selfStrongCoffee?' — เริ่มจากฝั่งกาแฟที่ตรงโจทย์เข้มก่อน':''}`,
        `• ของแฟน: ${companionPick.name_th} — ฝั่งไม่ใช่กาแฟ`,
      ];
      if(sharedLowSweet)lines.push('เรื่องความหวาน ทั้งสองคนเอาไม่หวานมากไว้ก่อนครับ เดี๋ยวตอนเลือกแบบร้อน/เย็นค่อยเช็กการปรับของแต่ละเมนูให้ตรงอีกที');
      return lines.join('\n');
    }
  }

  const preferredCodes=noCoffee
    ? ['uji_pure_matcha','thai_tea_latte','green_tea_latte','cocoa','lemon_tea']
    : couple
      ? ['cafe_latte','uji_pure_matcha','thai_tea_latte','caramel_macchiato']
      : ['americano','cafe_latte','uji_pure_matcha','thai_tea_latte'];

  const picked:CafeMasterMenuItem[]=[];
  for(const code of preferredCodes){
    const item=active.find(candidate=>candidate.code===code);
    if(item&&!picked.includes(item))picked.push(item);
    if(picked.length>=3)break;
  }
  if(picked.length<3){
    for(const item of active){
      if(noCoffee&&item.category==='coffee')continue;
      if(!picked.includes(item))picked.push(item);
      if(picked.length>=3)break;
    }
  }

  if(!picked.length)return 'ตอนนี้ทองไทยยังคัดเมนูแนะนำให้ไม่ได้ครับ';

  if(noCoffee){
    return [
      'ถ้าไม่เอากาแฟ ตัดฝั่งกาแฟออกได้เลยครับ',
      picked.map(item=>item.name_th).join(' · '),
      '',
      'อยากไปทางชา/มัทฉะ หรือเครื่องดื่มไม่กาแฟแบบอื่นมากกว่ากันครับ เดี๋ยวทองไทยคัดให้แคบลงอีก',
    ].join('\n');
  }

  if(couple){
    const coffee=picked.filter(item=>item.category==='coffee').slice(0,1);
    const alternatives=picked.filter(item=>item.category!=='coffee').slice(0,2);
    const lines=['ถ้าไปกันสองคน ทองไทยคัดให้คนละแนวก่อน จะเลือกง่ายกว่าดูทั้งเมนูครับ'];
    if(coffee.length)lines.push(`ฝั่งกาแฟ: ${coffee.map(item=>item.name_th).join(' · ')}`);
    if(alternatives.length)lines.push(`ฝั่งชา/มัทฉะหรือไม่กาแฟ: ${alternatives.map(item=>item.name_th).join(' · ')}`);
    const remaining=picked.filter(item=>!coffee.includes(item)&&!alternatives.includes(item));
    if(remaining.length)lines.push(`อีกตัวที่น่าดู: ${remaining.map(item=>item.name_th).join(' · ')}`);
    lines.push('', 'ถ้าสองคนชอบคนละแบบ บอกแค่ว่าใครเอากาแฟหรือไม่กาแฟกับหวานประมาณไหนครับ เดี๋ยวทองไทยจับคู่ให้');
    return lines.join('\n');
  }

  return [
    `ถ้าอยากเลือกง่าย ๆ ทองไทยคัดไว้ 3 ตัวต่างแนวก่อนครับ — ${picked.map(item=>item.name_th).join(' · ')}`,
    '',
    'อยากเริ่มจากกาแฟหรือไม่กาแฟก่อนครับ เดี๋ยวทองไทยตัดให้เหลือ 1–2 ตัวที่ตรงกว่านี้',
  ].join('\n');
}

export function cafeGroundedAnswer(
  request:BrainRequest,
  items:readonly CafeMasterMenuItem[],
  modifiers:readonly CafeBranchModifier[],
):{answer:string;grounded:boolean}|null{
  const message=request.message.trim();
  const item=resolveCafeMenuItem(message,items);
  const isMenuDiscovery=/(?:มีเมนูอะไร|เมนูมีอะไร|มีอะไรบ้าง|มีเครื่องดื่มอะไร|ขอเมนู)/u.test(message)
    || /(?:what.*menu|drink.*menu)/iu.test(message);
  const isRecommendationAsk=/(?:แนะนำ|เลือกให้|ตัวไหนดี|อะไรดี|recommend)/iu.test(message);
  const isFullListAsk=/(?:ทั้งหมด|ทุกเมนู|ขอเมนู|เมนูทั้งหมด|full\s*menu|all\s*menu)/iu.test(message);
  const isPriceAsk=/(?:ราคา|เท่าไหร่|เท่าไร|กี่บาท|how\s*much|price)/iu.test(message);
  const isStyleAsk=/(?:มีแบบไหน|แบบไหนบ้าง|ร้อน|เย็น|ปั่น|hot|iced|frappe)/iu.test(message);
  const asksStock=/(?:สต็อก|หมดไหม|มีของไหม|พร้อมขายไหม|stock)/iu.test(message);

  if(asksStock){
    return {
      answer:'เมนูกับราคาเช็กให้ได้ครับ แต่จำนวนของคงเหลือหน้าร้านยังไม่ได้อัปเดตสด ทองไทยเลยไม่อยากเดาว่าหมดหรือยัง',
      grounded:false,
    };
  }

  if(!item&&isRecommendationAsk&&!isFullListAsk){
    return {answer:cafeRecommendationMessage(request,items),grounded:true};
  }
  if(!item&&isMenuDiscovery){
    return {answer:cafeMenuListMessage(items),grounded:true};
  }
  if(!item&&(isPriceAsk||isStyleAsk)){
    return {
      answer:'ทองไทยเห็นว่าถามเรื่องราคา/รูปแบบเครื่องดื่มครับ แต่จับชื่อเมนูยังไม่ชัวร์ พิมพ์ชื่อเมนูอีกนิดเดียวแล้วทองไทยเช็กให้ตรงตัวได้เลยครับ',
      grounded:false,
    };
  }
  if(!item)return null;

  const activeSlots=item.slots.filter(slot=>slot.active).sort((a,b)=>a.sort_order-b.sort_order);
  const slot=resolveCafeSlot(message,item);
  const modifier=resolveCafeModifier(message,modifiers);

  if(modifier){
    if(!modifier.applies_to.includes(item.code)){
      return {
        answer:`${item.name_th} ตอนนี้เมนูนี้ยังไม่มีตัวเลือก${modifier.name_th}ครับ`,
        grounded:true,
      };
    }
    if(slot&&!modifier.styles.includes(slot.slot_code)){
      return {
        answer:`${item.name_th} ${slot.label_th} ตอนนี้แบบ${slot.label_th}ยังไม่ได้เปิดตัวเลือก${modifier.name_th}ครับ`,
        grounded:true,
      };
    }
  }

  if(slot){
    let price=slot.price;
    const details=[`${item.name_th} ${slot.label_th} ${cafeMoney(price)}ครับ`];
    if(modifier){
      price+=modifier.surcharge;
      details[0]=`${item.name_th} ${slot.label_th} เปลี่ยนเป็น${modifier.name_th} รวม ${cafeMoney(price)}ครับ`;
      details.push(`ราคาปกติ ${cafeMoney(slot.price)} + ${modifier.name_th} ${cafeMoney(modifier.surcharge)}`);
    }
    return {answer:details.join('\n'),grounded:true};
  }

  if(isPriceAsk||isStyleAsk){
    if(!activeSlots.length){
      return {answer:`${item.name_th} ตอนนี้ยังไม่มีราคาของเมนูนี้ให้ยืนยันครับ`,grounded:true};
    }
    const lines=[`${item.name_th} มี ${activeSlots.map(cafeSlotLine).join(' · ')}ครับ`];
    if(modifier){
      const eligible=activeSlots.filter(s=>modifier.styles.includes(s.slot_code));
      if(eligible.length){
        lines.push(`${modifier.name_th} +${cafeMoney(modifier.surcharge)} ใช้ได้กับ ${eligible.map(s=>s.label_th).join(' / ')}ครับ`);
      }
    }
    return {answer:lines.join('\n'),grounded:true};
  }

  if(activeSlots.length){
    return {
      answer:`${item.name_th} มีครับ — ${activeSlots.map(cafeSlotLine).join(' · ')}ครับ`,
      grounded:true,
    };
  }
  return {answer:`${item.name_th} มีเมนูนี้ครับ แต่ตอนนี้ยังไม่มีราคาให้ยืนยัน`,grounded:true};
}

async function deterministicCafeResponse(
  request: BrainRequest,
  runtime: Pick<BrainRuntimeContext,'agentState'>,
): Promise<BrainResponse | null> {
  const message = request.message.trim();
  if (!isCafeReadOnlyTurn(message, runtime.agentState?.active_topic)) return null;

  let items:CafeMasterMenuItem[]=[];
  let modifiers:CafeBranchModifier[]=[];
  try{
    [items,modifiers]=await Promise.all([
      listCafeMasterMenu(),
      listCafeBranchModifiers('inthanin_tadtone'),
    ]);
  }catch(error){
    console.error(
      'THONGTHAI_CAFE_MENU_SOT_ERROR',
      error instanceof Error?error.message.slice(0,220):'unknown',
    );
  }

  const recentCafeText=recentCafeConversationText(runtime.agentState??{});
  const splitFollowup=/ของผม.{0,24}(?:เย็น|ร้อน|ปั่น).{0,40}(?:แฟน)/u.test(message)
    || /(?:แฟน).{0,40}(?:ของผม).{0,24}(?:เย็น|ร้อน|ปั่น)/u.test(message);
  if(items.length&&splitFollowup&&/อเมริกาโน่/u.test(recentCafeText)&&/อูจิ\s*เพียวมัทฉะ/u.test(recentCafeText)){
    const selfItem=items.find(item=>item.code==='americano'&&item.active);
    const requestedSlot=selfItem?resolveCafeSlot(message,selfItem):null;
    const selfLine=selfItem&&requestedSlot
      ? `ของคุณต่อจากเมื่อกี้เป็น ${selfItem.name_th} ${requestedSlot.label_th} ${cafeMoney(requestedSlot.price)}ครับ`
      : 'ของคุณยังคงฝั่งอเมริกาโน่ไว้ครับ';
    const companionLine='ส่วนของแฟน เมื่อกี้คัดอูจิ เพียวมัทฉะไว้ในฝั่งไม่ใช่กาแฟครับ แต่ข้อมูลเมนูที่มีไม่ได้บอกรสชาติละเอียดพอให้ทองไทยฟันธงว่า “หอมและดื่มง่ายที่สุด” โดยไม่เดา';
    return {
      message:[selfLine,companionLine,'ถ้าอยากได้ดื่มง่ายกว่าแนวมัทฉะ บอกได้ครับ เดี๋ยวทองไทยคัดจากฝั่งชาให้แทน'].join('\n\n'),
      intent:'recommendation',
      contextUpdates:{},
      journeyAction:{type:'none',journey:null},
      suggestedActions:[],
      responseStyle:'direct',
      agentStateUpdate:{activeTopic:'cafe'},
      semanticMemoryUpdates:[],
      toolCalls:[],
    };
  }

  const grounded=items.length?cafeGroundedAnswer(request,items,modifiers):null;
  if(grounded){
    return {
      message:grounded.answer,
      intent:'information',
      contextUpdates:{},
      journeyAction:{type:'none',journey:null},
      suggestedActions:[],
      responseStyle:'direct',
      agentStateUpdate:{
        activeTopic:'cafe',
        ...(grounded.grounded?{clearUnresolvedNeed:true}:{unresolvedNeed:'cafe_stock_not_connected'}),
      },
      semanticMemoryUpdates:[],
      toolCalls:[],
    };
  }

  const preferences = cafePreferenceSummary(request.guestContext.constraints ?? []);
  let answer = '';

  if (/(?:ยังไม่(?:สั่ง|ต้องทำรายการ)|เอาไว้ก่อน|เลือกไว้ก่อน)/u.test(message)) {
    answer = `รับทราบครับ ตอนนี้เก็บไว้แค่ความชอบ: ${preferences} ยังไม่ได้สั่งและยังไม่ได้ส่งรายการไปที่ Inthanin Café ตาดโตนครับ`;
  } else if (/(?:รายการ.*ส่ง.*ร้าน|ส่งไปที่ร้าน.*หรือยัง)/u.test(message)) {
    answer = 'จากข้อความที่คุยกันรอบนี้ ยังไม่มีคำสั่งให้ส่งรายการไปที่ Inthanin Café ตาดโตนครับ ตอนนี้ยังเป็นการเลือกและถามข้อมูลเท่านั้นครับ';
  } else if (/(?:เปิด|ปิด|กี่โมง|อีกประมาณ.*ชั่วโมง|ที่จอดรถ)/u.test(message)) {
    answer = 'ตอนนี้ทองไทยยังยืนยันเวลาเปิด-ปิดกับข้อมูลที่จอดรถของ Inthanin Café ตาดโตนให้ไม่ได้ครับ เลยไม่ขอเดาให้ผิด';
  } else if (/ถามเผื่อแฟน/u.test(message) && /คนเดียว/u.test(message)) {
    answer = `รับทราบครับ วันนี้มาคนเดียว ส่วนเรื่องเครื่องดื่มไม่กาแฟเป็นคำถามเผื่อแฟนครับ ตอนนี้ยังไม่ได้สั่งอะไร และความชอบที่จำไว้คือ ${preferences}ครับ`;
  } else if (/ไม่ได้แพ้นม/u.test(message)) {
    answer = /แฟน/u.test(message)
      ? 'เข้าใจครับ ของแฟนคือช่วงนี้ไม่อยากดื่มนมวัว แต่ไม่ได้แพ้นมครับ ทองไทยจะไม่ตีความเป็นเรื่องแพ้อาหาร'
      : 'เข้าใจครับ เป็นความชอบที่ไม่อยากดื่มนมวัวช่วงนี้ ไม่ใช่อาการแพ้นมครับ';
  } else if (/(?:เมื่อกี้|จากที่คุยมา|สนใจอะไรไว้|ตัวไหนเหมาะ|เปลี่ยนใจ|ไม่เอาตัวนั้น|กลับมาเรื่อง)/u.test(message)) {
    answer = items.length
      ? `ได้ครับ กลับมาเรื่อง Inthanin กัน ตอนนี้ที่จำไว้คือ ${preferences} ถ้ามีเมนูที่เล็งไว้บอกชื่อมาได้เลยครับ`
      : `ที่คุยกันไว้ตอนนี้เป็นความชอบเรื่องเครื่องดื่ม: ${preferences}ครับ แต่รอบนี้ทองไทยเช็กเมนูไม่ได้ จึงยังไม่ขอเดาชื่อเมนูให้ผิดครับ`;
  } else if (
    preferences !== 'ยังไม่ได้ล็อกรสชาติหรือเมนู'
    && /(?:หวาน|ขม|ไม่กินกาแฟ|ไม่ดื่มกาแฟ|ไม่เอากาแฟ|นมวัว|น้ำตาล|เย็น)/u.test(message)
  ) {
    answer = items.length
      ? `รับทราบครับ ตอนนี้ความชอบคือ ${preferences}ครับ ถ้ามีเมนูที่สนใจ บอกชื่อมาได้เลยครับ เดี๋ยวทองไทยเช็กราคาแต่ละแบบให้`
      : `ตอนนี้ที่จำไว้คือ ${preferences} ครับ แต่รอบนี้ทองไทยยังยืนยันเมนูกับราคาให้ไม่ได้ เลยไม่ขอเดาให้ผิดครับ`;
  } else if(items.length){
    answer=cafeMenuListMessage(items);
  } else {
    answer='ตอนนี้ทองไทยยังยืนยันเมนูกับราคา Inthanin ตาดโตนให้ไม่ได้ครับ เลยไม่ขอเดาชื่อเมนูหรือราคาให้ผิด\n\nถ้าอยากคุยต่อ บอกได้เลยว่าอยากได้กาแฟ ชา หรือเครื่องดื่มไม่กาแฟ หรือจะให้ทองไทยช่วยดูร้านอาหาร ที่พัก หรือกิจกรรมก่อนได้ครับ';
  }

  return {
    message: answer,
    intent: 'information',
    contextUpdates: {},
    journeyAction: { type:'none', journey:null },
    suggestedActions: [],
    responseStyle: 'direct',
    agentStateUpdate: {
      activeTopic: 'cafe',
      unresolvedNeed: items.length ? 'cafe_read_only_inquiry' : 'cafe_menu_source_unavailable',
    },
    semanticMemoryUpdates: [],
    toolCalls: [],
  };
}

function deterministicExperienceDiscoveryResponse(
  request: BrainRequest,
  runtime: BrainRuntimeContext,
): BrainResponse | null {
  if (!isExperienceDiscoveryIntent(request.message)) return null;
  return {
    message: formatExperienceDiscoveryMessage(runtime.worldFacts),
    intent:'recommendation',
    contextUpdates:{},
    journeyAction:{type:'none',journey:null},
    suggestedActions:[],
    responseStyle:'direct',
    semanticMemoryUpdates:[],
    toolCalls:[],
  };
}

// Local Concierge: broad local-area/weather-condition/food-culture/visitor-
// journey/activity-suitability/safety questions -- see
// _local-concierge-intent.ts and THONGTHAI_HANDOFF.md's Local Concierge
// Intelligence Framework section. Checked AFTER the broad ecosystem
// discovery matcher (so "มาครั้งแรกมีอะไรแนะนำ"-style bare discovery keeps
// its own established handler) and BEFORE the activity/restaurant
// deterministic responses (so a blended question like "ฝนตกขี่ม้าได้ไหม"
// gets concierge-shaped reasoning instead of a generic activity-inventory
// answer that ignores the weather framing). Yields immediately if the
// SAME message also carries an explicit transaction/commit signal --
// local context must never swallow an explicit booking/confirm/signup/
// redeem intent (see Gates 1-3's exactly-once/no-premature-transaction
// discipline, which this must not regress).
// A specific food allergy ("แพ้กุ้ง กินอะไรได้บ้าง") or a personalized
// dietary question (a named companion who needs safe/suitable food -- a
// child, an elderly guest) must defer to the restaurant SOT advisor below
// (deterministicRestaurantResponse), which does real per-item, ingredient-
// based filtering against the live menu -- local concierge's food_culture
// answer is a generic Isan-cuisine description with no allergy/
// suitability awareness at all, and would otherwise win here first
// (FOOD_VISITOR_MARKER's "กินอะไรได้" matches this exact phrasing). Real
// production incident this closes: "เด็กกินอะไรได้บ้าง"/"ผู้สูงอายุกินอะไร
// ดี" (no explicit "แพ้..." allergy word, just an age-group qualifier)
// still fell through to the generic food-culture blurb instead of a real
// menu recommendation. Same "defer to the more specific, safety-aware
// handler" precedent as every care/safety guard in this codebase.
const LOCAL_CONCIERGE_ALLERGY_DEFER_RE = /แพ้\s*(?:ถั่ว(?:ลิสง)?|กุ้ง|ไข่|ปลา|อาหารทะเล|นม)|เด็ก|ผู้สูงอายุ/u;

async function deterministicLocalConciergeResponse(request: BrainRequest): Promise<BrainResponse | null> {
  if (hasExplicitTransactionIntent(request.message)) return null;
  const match = classifyLocalConciergeQuestion(request.message);
  if (!match) return null;
  if (match.category === 'food_culture' && LOCAL_CONCIERGE_ALLERGY_DEFER_RE.test(request.message)) return null;
  return {
    message: await composeLocalConciergeResponse(match, request.message),
    intent: 'information',
    contextUpdates: {},
    journeyAction: { type: 'none', journey: null },
    suggestedActions: [],
    responseStyle: 'direct',
    semanticMemoryUpdates: [],
    toolCalls: [],
  };
}

async function deterministicRestaurantResponse(
  request: BrainRequest,
  runtime: { agentState: Record<string, unknown> },
  guestDbId: string | null,
  channel: BrainChannel,
): Promise<BrainResponse | null> {
  if (!isRestaurantAdvisorTurn(request, runtime)) return null;
  const preorderDialog = await restaurantPreorderDialogResponse(request, runtime, guestDbId, channel);
  if (preorderDialog) return preorderDialog;
  const advice = await restaurantMenuAdvice({
    query: request.message,
    partySize: null,
    budget: typeof request.guestContext.budget === 'number' ? request.guestContext.budget : null,
    constraints: request.guestContext.constraints,
    recentMessages: restaurantAdvisorRecentMessages(request, runtime),
  });
  const priorRecommendationNames = currentRestaurantAdvisorContext(runtime)?.recentRecommendationNames ?? [];
  // Master Roadmap Phase 2 fix -- the ONE hard gate: a dietary constraint
  // message is NEVER a menu request. CONSTRAINT_ONLY always gets a short
  // acknowledgment only, never the full recommendation dump -- see
  // classifyRestaurantDietaryIntent's own comment. The owner's own
  // product rule is unconditional here: telling Thongthai a constraint
  // is never the same as asking for a menu, no matter how recently a
  // recommendation was shown. Never claims a compare/compose_set turn
  // (those have their own, already-correct formats), or a message
  // sent while a CONCRETE proposed order is pending
  // (hasPendingRestaurantOrder's own comment).
  const dietaryIntent = classifyRestaurantDietaryIntent(request.message);
  if (advice.mode !== 'compare' && advice.mode !== 'compose_set' && advice.mode !== 'item_safety_check'
    && !hasPendingRestaurantOrder(runtime)
    && dietaryIntent === 'CONSTRAINT_ONLY') {
    return {
      message: formatConstraintCorrectionAck(request.message) ?? formatConstraintDeclarationAck(advice, request.message),
      intent: 'information',
      contextUpdates: {},
      journeyAction: { type: 'none', journey: null },
      suggestedActions: [],
      responseStyle: 'direct',
      agentStateUpdate: restaurantAdvisorContextUpdate(request, runtime),
      semanticMemoryUpdates: [],
      toolCalls: [],
    };
  }
  const fullList = wantsFullRestaurantList(request.message);
  const selection = advisorRecommendationSelection(advice, fullList, request.message, priorRecommendationNames);
  const shownRecommendationNames = selection.shown
    .map((row: any) => typeof row?.name === 'string' ? row.name.trim() : '')
    .filter(Boolean);
  const advisorContext = restaurantAdvisorContextUpdate(request, runtime, shownRecommendationNames);
  return {
    message: formatAdvisorMessage(
      advice,
      fullList,
      mentionsRestaurantConstraintNow(dietaryIntent),
      request.message,
      priorRecommendationNames,
    ),
    intent: advice.mode === 'compare' ? 'information' : 'recommendation',
    contextUpdates:{},
    journeyAction:{type:'none',journey:null},
    suggestedActions:[],
    responseStyle:'direct',
    agentStateUpdate: mergeAgentState(proposedSetFromAdvisor(advice), advisorContext),
    semanticMemoryUpdates:[],
    toolCalls:[],
  };
}

async function deterministicActivityResponse(
  request: BrainRequest,
  guestDbId: string | null,
  channel: BrainChannel,
  transportEventId: string,
  providerUserKey: string | null,
  // Production cost invariant: at most one paid semantic call per customer
  // turn. This is a THIRD independent call site invoking
  // processOneMindCustomerTurn for the same incoming request (the other two
  // are the early "understand first" attempt and the later cutover attempt
  // in processThongthaiChatCore) -- without a cached semantic turn to reuse,
  // it would pay to re-run interpretSemanticTurn a third time. The cost
  // ledger's own eventId-keyed idempotency prevents an actual duplicate
  // OpenAI charge, but the request still wastefully re-attempts the whole
  // reservation/prompt-building path for nothing.
  cachedSemantic?: SemanticTurn,
): Promise<BrainResponse | null> {
  const direct = directCommittedActivityBookingArgs(request.message);
  if (direct) {
    return executeDeterministicActivityBooking(direct, request, guestDbId, channel);
  }

  const oneMind = await processOneMindCustomerTurn({
    channel,
    language: request.language,
    message: request.message,
    eventId: transportEventId,
    providerUserKey: providerUserKey ?? request.guestId,
    canonicalAnonymousId: request.guestId,
    guestDbId,
    durableMemory: durableMemoryFromRequest(request),
    persistState: true,
  }, cachedSemantic ? {
    interpretSemanticTurn: async () => cachedSemantic,
  } : undefined);

  const turn = oneMind.status === 'composed' || oneMind.status === 'legacy_required'
    ? oneMind.turn
    : null;
  if (!turn || turn.semanticTurn.domain !== 'activity') return null;

  // Defense in depth: the main early gate normally consumes every supervised
  // Activity turn before this compatibility function is reached. If a future
  // caller invokes this function directly with a cached/supervised result,
  // preserve the same terminal boundary instead of reopening legacy routing.
  const supervised = resolveSupervisedActivityCutover(oneMind, channel, request.language);
  if (supervised?.kind === 'execute_booking') {
    return executeDeterministicActivityBooking(supervised.args, request, guestDbId, channel);
  }
  if (supervised?.kind === 'respond') {
    return {
      message: supervised.response.message,
      intent: turn.semanticTurn.action === 'discover' || turn.semanticTurn.action === 'recommend'
        ? 'recommendation'
        : 'information',
      contextUpdates: {},
      journeyAction: { type: 'none', journey: null },
      suggestedActions: [],
      responseStyle: 'direct',
      semanticMemoryUpdates: [],
      toolCalls: [],
    };
  }

  if (oneMind.status === 'composed') {
    return {
      message: oneMind.response.message,
      intent: turn.semanticTurn.action === 'discover' || turn.semanticTurn.action === 'recommend'
        ? 'recommendation'
        : 'information',
      contextUpdates: {},
      journeyAction: { type: 'none', journey: null },
      suggestedActions: [],
      responseStyle: 'direct',
      semanticMemoryUpdates: [],
      toolCalls: [],
    };
  }

  const proposal = turn.dialogDecision.actionProposal;
  if (!proposal || proposal.toolName !== 'create_booking' || !proposal.customerCommitPresent) {
    return null;
  }
  return executeDeterministicActivityBooking(
    resolveActivityBookingProposalArgs(proposal, turn.dialogDecision.taskStateContainer.activeTask),
    request,
    guestDbId,
    channel,
  );
}

export type SupervisedActivityCutoverDecision =
  | { kind: 'respond'; response: ComposedResponse }
  | { kind: 'execute_booking'; args: Record<string, unknown> };

/**
 * The terminal boundary for a usable OpenAI-owned Activity interpretation.
 *
 * This function deliberately has no customer-text parameter. Once the
 * semantic supervisor has succeeded, every normal Activity turn must end in
 * one of two structured outcomes here:
 *
 *  - render from SemanticTurn/DialogDecision/CanonicalKnowledgeScope, or
 *  - execute the already-authorized ActionProposal.
 *
 * Returning null is reserved for non-Activity turns and genuine provider
 * fallback turns. Consequently a supervised Activity turn cannot continue
 * into the legacy raw-text responder cascade or runThongthaiBrain.
 */
export function resolveSupervisedActivityCutover(
  oneMind: Awaited<ReturnType<typeof processOneMindCustomerTurn>>,
  channel: BrainChannel,
  language: BrainRequest['language'],
): SupervisedActivityCutoverDecision | null {
  const turn = oneMind.turn;
  if (turn.semanticTurn.domain !== 'activity'
      || turn.semanticTurn.semanticSource !== 'openai_supervisor') return null;

  if (oneMind.status === 'composed') {
    return { kind: 'respond', response: oneMind.response };
  }

  const proposal = turn.dialogDecision.actionProposal;
  if (proposal?.toolName === 'create_booking' && proposal.customerCommitPresent) {
    return {
      kind: 'execute_booking',
      args: resolveActivityBookingProposalArgs(
        proposal,
        turn.dialogDecision.taskStateContainer.activeTask,
      ),
    };
  }

  const composerInput = {
    channel,
    language,
    semanticTurn: turn.dialogSemanticTurn,
    dialogDecision: turn.dialogDecision,
    knowledgeBundles: turn.groundedKnowledge,
    degradation: turn.knowledgeDegradation,
    operationalOutcome: null,
  };
  const response = composeGroundedDeterministicResponse(composerInput)
    ?? composeDeterministicResponse(composerInput);
  return { kind: 'respond', response };
}

/**
 * Provider-outage bridge for NON-COMMITTED Activity planning updates only.
 *
 * The deterministic semantic layer can safely resolve bounded horse
 * selections/corrections (including "reject X, take the other one") even when
 * the supervisor is unavailable. Those turns are conversational state updates,
 * not booking authorization. Ending them here prevents the correct structured
 * selection from falling into the legacy booking-field collector, which used
 * to surface public intent=booking despite no customer commitment.
 *
 * Explicit transaction meaning or any customer-authorized proposal still
 * returns null and keeps the established transaction executor boundary.
 */
export function resolveDeterministicActivityPlanningCutover(
  oneMind: Awaited<ReturnType<typeof processOneMindCustomerTurn>>,
  channel: BrainChannel,
  language: BrainRequest['language'],
  message: string,
): { kind:'respond'; response:ComposedResponse } | null {
  if (oneMind.status !== 'legacy_required') return null;
  const turn = oneMind.turn;
  if (turn.semanticTurn.domain !== 'activity'
      || turn.semanticTurn.semanticSource !== 'deterministic_fallback') return null;

  const meaning = turn.semanticMeaning ?? deriveSemanticMeaning(turn.dialogSemanticTurn);
  if (meaning.commitmentLevel === 'explicit_transaction'
      || turn.dialogDecision.actionProposal?.customerCommitPresent) return null;

  // This bridge exists only for an explicit correction/rejection such as
  // "ไม่เอาทองไทย ... เอาอีกตัว". Bare selections remain on their existing
  // ambiguity/context paths: a cold-start "เอาทองไทย" must still clarify,
  // while an already-established riding context keeps its established UX.
  const correctionSignal = HORSE_CORRECTION_SIGNAL_RE.test(message)
    || turn.semanticTurn.speechAct === 'correction'
    || turn.semanticTurn.action === 'correct_previous';
  if (!correctionSignal) return null;

  const composerInput = {
    channel,
    language,
    semanticTurn:turn.dialogSemanticTurn,
    dialogDecision:turn.dialogDecision,
    knowledgeBundles:turn.groundedKnowledge,
    degradation:turn.knowledgeDegradation,
    operationalOutcome:null,
  };
  const response = composeDeterministicResponse(composerInput);
  const horseName = typeof turn.dialogSemanticTurn.entities.horseName === 'string'
    ? turn.dialogSemanticTurn.entities.horseName.trim().replace(/^น้อง/u, '')
    : '';
  if (horseName && !response.message.includes(`น้อง${horseName}`)) {
    response.message = response.message.replace(horseName, `น้อง${horseName}`);
  }
  return { kind:'respond', response };
}

/** Human Core PR D: task.slots (== proposal.validatedArgs) never carries a
 *  human-readable asset name -- that lives on the task's OWN
 *  selectedEntities, already resolved by the semantic supervisor/dialog
 *  manager earlier in the conversation (see _dialog-manager.ts's
 *  resolveSelectedEntities). Reading it from there, instead of letting
 *  executeDeterministicActivityBooking re-derive it from THIS turn's raw
 *  message, means the booking confirmation names the actually-selected
 *  asset even when the customer's final commit message doesn't restate its
 *  name -- and never a wrong name matched from unrelated text in that
 *  message. */
export function resolveActivityBookingProposalArgs(
  proposal: { validatedArgs: Record<string, unknown> },
  activeTask: { selectedEntities: readonly { id: string; name: string }[] } | null | undefined,
): Record<string, unknown> {
  const selectedAssetEntity = activeTask?.selectedEntities.find(entity => entity.id.startsWith('activity_asset:'));
  const activityAssetCode = selectedAssetEntity?.id.replace(/^activity_asset:/, '');
  return {
    ...proposal.validatedArgs,
    ...(selectedAssetEntity && activityAssetCode ? {
      horseName: selectedAssetEntity.name,
      activityAssetCode,
      note: formatActivityAssetNote({ name: selectedAssetEntity.name, assetCode: activityAssetCode }),
    } : {}),
  };
}

export type SupervisedStayCutoverDecision =
  | { kind:'respond'; response:ComposedResponse }
  | { kind:'execute_booking'; args:Record<string, unknown> };

/** Terminal Stay boundary after a usable OpenAI semantic result. No raw
 * customer sentence crosses this API: normal Stay either renders from the
 * existing SemanticMeaning/scope/knowledge state or executes one validated,
 * explicitly committed proposal. */
export function resolveSupervisedStayCutover(
  oneMind: Awaited<ReturnType<typeof processOneMindCustomerTurn>>,
  channel: BrainChannel,
  language: BrainRequest['language'],
): SupervisedStayCutoverDecision | null {
  const turn = oneMind.turn;
  if (turn.semanticTurn.domain !== 'stay' || turn.semanticTurn.semanticSource !== 'openai_supervisor') return null;
  if (oneMind.status === 'composed') return { kind:'respond', response:oneMind.response };

  const meaning = deriveSemanticMeaning(turn.semanticTurn);
  const proposal = turn.dialogDecision.actionProposal;
  if (meaning.commitmentLevel === 'explicit_transaction'
      && proposal?.toolName === 'create_booking'
      && proposal.customerCommitPresent) {
    return {
      kind:'execute_booking',
      args:resolveStayBookingProposalArgs(proposal, turn.dialogDecision.taskStateContainer.activeTask),
    };
  }

  const composerInput = {
    channel,
    language,
    semanticTurn:turn.dialogSemanticTurn,
    dialogDecision:turn.dialogDecision,
    knowledgeBundles:turn.groundedKnowledge,
    degradation:turn.knowledgeDegradation,
    operationalOutcome:null,
  };
  const stateUpdate = turn.semanticTurn.speechAct === 'selection'
    || turn.semanticTurn.speechAct === 'correction'
    || turn.semanticTurn.action === 'modify'
    || turn.semanticTurn.action === 'correct_previous';
  const response = stateUpdate
    ? composeDeterministicResponse(composerInput)
    : composeGroundedDeterministicResponse(composerInput) ?? composeDeterministicResponse(composerInput);
  return { kind:'respond', response };
}

/** Provider-outage bridge for Stay writes only. Read-only deterministic
 * meanings still yield to the existing compatibility path; this accepts
 * nothing unless Dialog Manager already emitted a complete, explicitly
 * committed create_booking proposal for the active Stay task. */
export function resolveDeterministicStayTransactionCutover(
  oneMind: Awaited<ReturnType<typeof processOneMindCustomerTurn>>,
): { kind:'execute_booking'; args:Record<string, unknown> } | null {
  if (oneMind.status !== 'legacy_required') return null;
  const turn = oneMind.turn;
  if (turn.semanticTurn.domain !== 'stay'
      || turn.semanticTurn.semanticSource !== 'deterministic_fallback') return null;
  const task = turn.dialogDecision.taskStateContainer.activeTask;
  const proposal = turn.dialogDecision.actionProposal;
  const meaning = turn.semanticMeaning ?? deriveSemanticMeaning(turn.dialogSemanticTurn);
  if (meaning.commitmentLevel !== 'explicit_transaction'
      || task?.type !== 'stay_booking'
      || proposal?.toolName !== 'create_booking'
      || !proposal.customerCommitPresent
      || turn.dialogDecision.mode !== 'propose_action') return null;
  return {
    kind:'execute_booking',
    args:resolveStayBookingProposalArgs(proposal, task),
  };
}

/** Structured-only Stay transaction args. Canonical selection lives on the
 * active task; dates/party size/nights were normalized by the dialog layer.
 * This function deliberately has no message/request parameter. */
export type SupervisedRestaurantCutoverDecision =
  | { kind:'respond'; response:ComposedResponse }
  | { kind:'execute_preorder'; args:Record<string, unknown> }
  | { kind:'execute_table_booking'; args:Record<string, unknown> };

/** Human Core PR F terminal Restaurant boundary. Once the OpenAI supervisor
 * owns Restaurant meaning, the turn cannot fall into legacy dietary/advisor
 * regexes, raw preorder parsers, or runThongthaiBrain. */
export function resolveSupervisedRestaurantCutover(
  oneMind: Awaited<ReturnType<typeof processOneMindCustomerTurn>>,
  channel: BrainChannel,
  language: BrainRequest['language'],
): SupervisedRestaurantCutoverDecision | null {
  const turn = oneMind.turn;
  if (turn.semanticTurn.domain !== 'restaurant'
      || turn.semanticTurn.semanticSource !== 'openai_supervisor') return null;
  if (oneMind.status === 'composed') return { kind:'respond', response:oneMind.response };

  const meaning = turn.semanticMeaning ?? deriveSemanticMeaning(turn.dialogSemanticTurn);
  const proposal = turn.dialogDecision.actionProposal;
  if (meaning.commitmentLevel === 'explicit_transaction' && proposal?.customerCommitPresent) {
    if (proposal.toolName === 'create_restaurant_preorder') {
      return { kind:'execute_preorder', args:resolveRestaurantPreorderProposalArgs(proposal) };
    }
    if (proposal.toolName === 'create_booking'
        && turn.dialogDecision.taskStateContainer.activeTask?.type === 'restaurant_booking') {
      return { kind:'execute_table_booking', args:resolveRestaurantTableBookingProposalArgs(proposal) };
    }
  }

  const composerInput = {
    channel,
    language,
    semanticTurn:turn.dialogSemanticTurn,
    dialogDecision:turn.dialogDecision,
    knowledgeBundles:turn.groundedKnowledge,
    degradation:turn.knowledgeDegradation,
    operationalOutcome:null,
  };
  const stateUpdate = turn.semanticTurn.speechAct === 'selection'
    || turn.semanticTurn.speechAct === 'correction'
    || turn.semanticTurn.action === 'modify'
    || turn.semanticTurn.action === 'correct_previous'
    || turn.semanticTurn.action === 'provide_information';
  const response = stateUpdate
    ? composeDeterministicResponse(composerInput)
    : composeGroundedDeterministicResponse(composerInput) ?? composeDeterministicResponse(composerInput);
  return { kind:'respond', response };
}

export type SupervisedPromotionCutoverDecision =
  | { kind:'respond'; response:ComposedResponse }
  | { kind:'execute_redemption'; args:Record<string, unknown> };

/** Human Core PR G terminal Promotion boundary. Once OpenAI supervision owns
 * Promotion meaning, normal turns render from structured state/live facts and
 * an actual redemption can only execute an already-verified ActionProposal.
 * No raw customer sentence crosses this boundary. */
export function resolveSupervisedPromotionCutover(
  oneMind:Awaited<ReturnType<typeof processOneMindCustomerTurn>>,
  channel:BrainChannel,
  language:BrainRequest['language'],
):SupervisedPromotionCutoverDecision|null {
  const turn=oneMind.turn;
  if(turn.semanticTurn.domain!=='promotion'
      || turn.semanticTurn.semanticSource!=='openai_supervisor') return null;
  if(oneMind.status==='composed') return {kind:'respond',response:oneMind.response};

  const meaning=turn.semanticMeaning ?? deriveSemanticMeaning(turn.dialogSemanticTurn);
  const proposal=turn.dialogDecision.actionProposal;
  if(meaning.commitmentLevel==='explicit_transaction'
      && proposal?.toolName==='redeem_promotion'
      && proposal.customerCommitPresent
      && turn.dialogDecision.taskStateContainer.activeTask?.type==='promotion_redemption') {
    return {kind:'execute_redemption',args:resolvePromotionRedemptionProposalArgs(proposal)};
  }

  const composerInput={
    channel,
    language,
    semanticTurn:turn.dialogSemanticTurn,
    dialogDecision:turn.dialogDecision,
    knowledgeBundles:turn.groundedKnowledge,
    degradation:turn.knowledgeDegradation,
    operationalOutcome:null,
  };
  const stateUpdate=turn.semanticTurn.speechAct==='selection'
    || turn.semanticTurn.speechAct==='correction'
    || ['confirm','modify','correct_previous','provide_information'].includes(turn.semanticTurn.action);
  const response=stateUpdate
    ? composeDeterministicResponse(composerInput)
    : composeGroundedDeterministicResponse(composerInput) ?? composeDeterministicResponse(composerInput);
  return {kind:'respond',response};
}

/** Structured-only Promotion redemption sanitizer. campaignId may enter the
 * executor only after Dialog Manager verified it against live eligible facts. */
export function resolvePromotionRedemptionProposalArgs(
  proposal:{validatedArgs:Record<string,unknown>},
):Record<string,unknown> {
  const value=proposal.validatedArgs;
  const campaignId=typeof value.campaignId==='string'
    ? value.campaignId.trim().replace(/^promo:/u,'')
    : '';
  return {
    campaignId,
    ...(typeof value.campaignCode==='string'&&value.campaignCode.trim()?{campaignCode:value.campaignCode.trim()}:{}),
    ...(typeof value.title==='string'&&value.title.trim()?{title:value.title.trim()}:{}),
    ...(typeof value.promotionName==='string'&&value.promotionName.trim()?{promotionName:value.promotionName.trim()}:{}),
    requiresDateTime:value.requiresDateTime!==false,
    ...(typeof value.promoTotal==='number'&&Number.isFinite(value.promoTotal)?{promoTotal:value.promoTotal}:{}),
    ...(typeof value.date==='string'&&value.date.trim()?{date:value.date.trim()}:{}),
    ...(typeof value.time==='string'&&value.time.trim()?{time:value.time.trim()}:{}),
    customerName:typeof value.customerName==='string'?value.customerName.trim():'',
    ...(typeof value.phone==='string'&&value.phone.trim()?{phone:value.phone.trim()}:{}),
    ...(typeof value.email==='string'&&value.email.trim()?{email:value.email.trim()}:{}),
    ...(typeof value.note==='string'&&value.note.trim()?{note:value.note.trim()}:{}),
  };
}

export type SupervisedCafeCutoverDecision =
  | { kind:'respond'; response:ComposedResponse }
  | { kind:'execute_inquiry'; args:Record<string, unknown> };

/** Human Core PR H terminal Cafe boundary. Cafe still has no verified live
 *  menu/price/hours source and no direct sale executor. It does, however,
 *  have a real staff-inquiry operation. A supervised explicit submission may
 *  execute only an already-validated create_cafe_inquiry proposal; every
 *  read-only Cafe turn keeps the honest "no verified source" response. */
export function resolveSupervisedCafeCutover(
  oneMind: Awaited<ReturnType<typeof processOneMindCustomerTurn>>,
  channel: BrainChannel,
  language: BrainRequest['language'],
): SupervisedCafeCutoverDecision | null {
  const turn = oneMind.turn;
  if (turn.semanticTurn.domain !== 'cafe' || turn.semanticTurn.semanticSource !== 'openai_supervisor') return null;
  if (oneMind.status === 'composed') return { kind:'respond', response:oneMind.response };

  const meaning = turn.semanticMeaning ?? deriveSemanticMeaning(turn.dialogSemanticTurn);
  const proposal = turn.dialogDecision.actionProposal;
  if (meaning.commitmentLevel === 'explicit_transaction'
      && proposal?.toolName === 'create_cafe_inquiry'
      && proposal.customerCommitPresent
      && turn.dialogDecision.taskStateContainer.activeTask?.type === 'cafe_inquiry') {
    const value = proposal.validatedArgs;
    return {
      kind:'execute_inquiry',
      args:{
        question:typeof value.question === 'string' ? value.question.trim() : '',
        ...(typeof value.customerName === 'string' && value.customerName.trim()
          ? { customerName:value.customerName.trim() } : {}),
        ...(typeof value.phone === 'string' && value.phone.trim()
          ? { phone:value.phone.trim() } : {}),
        ...(typeof value.email === 'string' && value.email.trim()
          ? { email:value.email.trim() } : {}),
      },
    };
  }

  const composerInput = {
    channel,
    language,
    semanticTurn:turn.dialogSemanticTurn,
    dialogDecision:turn.dialogDecision,
    knowledgeBundles:turn.groundedKnowledge,
    degradation:turn.knowledgeDegradation,
    operationalOutcome:null,
  };
  const response = composeGroundedDeterministicResponse(composerInput) ?? composeDeterministicResponse(composerInput);
  return { kind:'respond', response };
}

export type SupervisedOtopCutoverDecision =
  | { kind:'respond'; response:ComposedResponse }
  | { kind:'execute_order'; args:Record<string, unknown> };

/** Terminal OTOP boundary. A supervised catalog/read-only turn renders from
 * live product facts, while a write can execute only the Dialog Manager's
 * validated create_otop_order proposal. This prevents a correctly understood
 * OTOP purchase from falling through into the legacy Restaurant responder. */
export function resolveSupervisedOtopCutover(
  oneMind:Awaited<ReturnType<typeof processOneMindCustomerTurn>>,
  channel:BrainChannel,
  language:BrainRequest['language'],
):SupervisedOtopCutoverDecision|null {
  const turn=oneMind.turn;
  if(turn.semanticTurn.domain!=='otop'
      || turn.semanticTurn.semanticSource!=='openai_supervisor') return null;
  if(oneMind.status==='composed') return {kind:'respond',response:oneMind.response};

  const proposal=turn.dialogDecision.actionProposal;
  const task=turn.dialogDecision.taskStateContainer.activeTask;
  // Dialog Manager's customerCommitPresent is the canonical current-turn
  // authorization proof. Production legitimately labels "ยืนยันสั่ง..." as
  // action=confirm (rather than order) while still emitting this validated
  // proposal; requiring a second commitment label here discards the correct
  // proposal and can never add safety beyond that canonical proof.
  if(proposal?.toolName==='create_otop_order'
      && proposal.customerCommitPresent
      && task?.type==='otop_order'
      && turn.dialogDecision.mode==='propose_action') {
    const value=proposal.validatedArgs;
    const sku=typeof value.sku==='string'?value.sku.trim():'';
    const quantity=Math.floor(Number(value.quantity));
    if(sku && Number.isInteger(quantity) && quantity>=1 && quantity<=99) {
      return {
        kind:'execute_order',
        args:{
          sku,quantity,
          fulfillmentType:value.fulfillmentType==='shipping'?'shipping':'pickup',
          ...(typeof value.customerName==='string'&&value.customerName.trim()?{customerName:value.customerName.trim()}:{}),
          ...(typeof value.phone==='string'&&value.phone.trim()?{phone:value.phone.trim()}:{}),
          ...(typeof value.email==='string'&&value.email.trim()?{email:value.email.trim()}:{}),
          ...(typeof value.shippingAddress==='string'&&value.shippingAddress.trim()?{shippingAddress:value.shippingAddress.trim()}:{}),
          ...(typeof value.note==='string'&&value.note.trim()?{note:value.note.trim()}:{}),
        },
      };
    }
  }

  const composerInput={
    channel,language,semanticTurn:turn.dialogSemanticTurn,
    dialogDecision:turn.dialogDecision,knowledgeBundles:turn.groundedKnowledge,
    degradation:turn.knowledgeDegradation,operationalOutcome:null,
  };
  const response=composeGroundedDeterministicResponse(composerInput)
    ?? composeDeterministicResponse(composerInput);
  return {kind:'respond',response};
}

/** Defense-in-depth sanitizer for a proposal already validated by Dialog
 * Manager/domain policy. No customer message enters this function. */
export function resolveRestaurantTableBookingProposalArgs(
  proposal: { validatedArgs:Record<string, unknown> },
): Record<string, unknown> {
  const args = proposal.validatedArgs;
  const partySize = Number(args.partySize);
  return {
    ...args,
    serviceType:'restaurant',
    ...(typeof args.date === 'string' ? { date:args.date.trim() } : {}),
    ...(typeof args.time === 'string' ? { time:args.time.trim() } : {}),
    ...(Number.isInteger(partySize) ? { partySize } : {}),
    ...(typeof args.customerName === 'string' ? { customerName:args.customerName.trim() } : {}),
    ...(typeof args.phone === 'string' ? { phone:args.phone.trim() } : {}),
    ...(typeof args.email === 'string' ? { email:args.email.trim() } : {}),
  };
}

export function resolveRestaurantPreorderProposalArgs(
  proposal: { validatedArgs:Record<string, unknown> },
): Record<string, unknown> {
  const args = proposal.validatedArgs;
  const items = Array.isArray(args.items)
    ? args.items.flatMap(value => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
        const row = value as Record<string, unknown>;
        const name = typeof row.name === 'string' ? row.name.trim() : '';
        const quantity = Number(row.quantity);
        return name && Number.isInteger(quantity) && quantity >= 1 && quantity <= 50
          ? [{ name, quantity }]
          : [];
      })
    : [];
  return {
    ...args,
    items,
    ...(typeof args.customerName === 'string' ? { customerName:args.customerName.trim() } : {}),
    ...(typeof args.phone === 'string' ? { phone:args.phone.trim() } : {}),
    ...(typeof args.email === 'string' ? { email:args.email.trim() } : {}),
  };
}

export function resolveStayBookingProposalArgs(
  proposal: { validatedArgs:Record<string, unknown> },
  activeTask: { selectedEntities:readonly { id:string; name:string }[] } | null | undefined,
): Record<string, unknown> {
  const stays = activeTask?.selectedEntities.filter(entity => entity.id.startsWith('stay:')) ?? [];
  const selected = stays.length === 1 ? stays[0] : null;
  return {
    ...proposal.validatedArgs,
    ...(selected ? {
      resourceCode:selected.id.replace(/^stay:/u, ''),
      accommodationName:selected.name,
    } : {}),
  };
}

export function directCommittedActivityBookingArgs(message: string): Record<string, unknown> | null {
  if (!hasCommitMarker(message)) return null;
  const selectedAsset = activityAssetFromText(message);
  if (!selectedAsset) return null;
  const date = extractDate(message);
  const time = extractTime(message);
  const durationMinutes = extractDurationMinutes(message);
  const partySize = extractPartySize(message);
  if (!date || !time || !durationMinutes || !partySize) return null;
  const phone = message.match(/(?:เบอร์|โทร)\s*([0-9][0-9\s-]{7,18}[0-9])/u)?.[1]?.replace(/\D/g, '') ?? null;
  const customerName = message.match(/(?:^|\s)ชื่อ\s*([^,\n]+?)(?=\s*(?:เบอร์|โทร|จำนวน|ยืนยัน|ครับ|ค่ะ|คะ|$))/u)?.[1]?.trim() ?? null;
  return {
    serviceType: 'activity',
    resourceCode: selectedAsset.resourceCode,
    horseName: selectedAsset.name,
    date,
    time,
    durationMinutes,
    partySize,
    ...(customerName ? { customerName } : {}),
    ...(phone ? { phone } : {}),
    note: formatActivityAssetNote(selectedAsset),
  };
}

const THAI_MONTHS: Record<string, number> = {
  มกราคม: 1, มกรา: 1, 'ม.ค': 1,
  กุมภาพันธ์: 2, กุมภา: 2, 'ก.พ': 2,
  มีนาคม: 3, มีนา: 3, 'มี.ค': 3,
  เมษายน: 4, เมษา: 4, 'เม.ย': 4,
  พฤษภาคม: 5, พฤษภา: 5, 'พ.ค': 5,
  มิถุนายน: 6, มิถุนา: 6, 'มิ.ย': 6,
  กรกฎาคม: 7, กรกฎา: 7, 'ก.ค': 7,
  สิงหาคม: 8, สิงหา: 8, 'ส.ค': 8,
  กันยายน: 9, กันยา: 9, 'ก.ย': 9,
  ตุลาคม: 10, ตุลา: 10, 'ต.ค': 10,
  พฤศจิกายน: 11, พฤศจิกา: 11, 'พ.ย': 11,
  ธันวาคม: 12, ธันวา: 12, 'ธ.ค': 12,
};

function extractThaiMonthDate(message: string): string | null {
  const match = message.match(/(\d{1,2})\s*(มกราคม|มกรา|ม\.ค|กุมภาพันธ์|กุมภา|ก\.พ|มีนาคม|มีนา|มี\.ค|เมษายน|เมษา|เม\.ย|พฤษภาคม|พฤษภา|พ\.ค|มิถุนายน|มิถุนา|มิ\.ย|กรกฎาคม|กรกฎา|ก\.ค|สิงหาคม|สิงหา|ส\.ค|กันยายน|กันยา|ก\.ย|ตุลาคม|ตุลา|ต\.ค|พฤศจิกายน|พฤศจิกา|พ\.ย|ธันวาคม|ธันวา|ธ\.ค)\.?\s*(20\d{2}|25\d{2})?/u);
  if (!match) return null;
  const day = Number(match[1]);
  const month = THAI_MONTHS[match[2].replace(/\.$/, '')];
  let year = match[3] ? Number(match[3]) : new Date().getFullYear();
  if (year > 2400) year -= 543;
  if (!month || day < 1 || day > 31 || year < 2000 || year > 2200) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function activityFallbackCommit(message: string): boolean {
  return hasCommitMarker(message) || /^(?:ยืนยัน|ตกลง|โอเค|confirm)(?:\s|$|ครับ|ค่ะ|คะ|คับ)/iu.test(message.trim());
}

// hasCommitMarker's phrases ("จองเลย", "ยืนยันจอง"/"ยืนยันการจอง",
// "สั่งเลย"/"ยืนยันการสั่ง") name the transaction itself and are trustworthy
// authorization on their own, at any point in the conversation. The REST of
// activityFallbackCommit's markers (a bare "ยืนยัน"/"ตกลง"/"โอเค") are
// generic agreement words -- "yes" to WHATEVER the bot's last message said,
// not specifically "submit this booking". Real risk this closes: this
// fallback's own draft/missing-field check scans the WHOLE joined
// conversation text for slot values, so once a genuine slot-filling
// exchange has ever completed all required fields, EVERY later bare "โอเค"
// -- even one replying to a completely unrelated later message (a weather
// question, a compliment) -- would otherwise re-fire the exact same stale
// draft as a fresh, real booking write. A generic acknowledgement is only
// trustworthy as booking authorization when it is a direct reply to the
// bot HAVING JUST SHOWN this fallback's own ready-to-confirm summary --
// see ACTIVITY_BOOKING_CONFIRM_PROMPT_MARKER below, embedded in that exact
// summary text and checked against nothing but the bot's own immediately
// preceding turn.
const ACTIVITY_BOOKING_CONFIRM_PROMPT_MARKER = 'เพื่อส่งคำขอจองเข้าระบบครับ';

function repliesToActivityBookingConfirmPrompt(request: BrainRequest): boolean {
  const last = request.chatHistory[request.chatHistory.length - 1];
  return Boolean(last) && last.role === 'assistant' && last.content.includes(ACTIVITY_BOOKING_CONFIRM_PROMPT_MARKER);
}

// The gate an actual booking WRITE may rely on: either an explicit
// booking/order verb (safe anywhere), or a generic acknowledgement that is
// verifiably answering this fallback's own just-shown confirmation prompt
// (safe because it can only mean "yes, submit THIS booking"). A bare
// acknowledgement that fails this second check falls through to
// re-showing the summary instead of executing -- never silently booking.
export function authorizedActivityBookingCommit(request: BrainRequest): boolean {
  if (!activityFallbackCommit(request.message)) return false;
  return hasCommitMarker(request.message) || repliesToActivityBookingConfirmPrompt(request);
}

function activityFallbackName(userTurns: string[]): string | null {
  const joined = userTurns.join('\n');
  const explicit = joined.match(/(?:^|\s)ชื่อ\s*([^,\n]+?)(?=\s*(?:เบอร์|โทร|จำนวน|ยืนยัน|ครับ|ค่ะ|คะ|$))/u)?.[1]?.trim();
  if (explicit) return explicit.slice(0, 120);
  for (const turn of [...userTurns].reverse()) {
    const text = turn.trim();
    if (!text || activityAssetFromText(text) || extractDurationMinutes(text) || extractDate(text) || extractThaiMonthDate(text)
        || extractTime(text) || extractPartySize(text) || /\d{8,}/u.test(text) || activityFallbackCommit(text)) continue;
    if (/^(?:SMOKE\s+(?:RE)?TEST|TEST)\b/iu.test(text)) return text.slice(0, 120);
  }
  return null;
}

function activityFallbackPhone(text: string): string | null {
  return text.match(/(?:เบอร์|โทร)?\s*(0\d[\d\s-]{7,18}\d)/u)?.[1]?.replace(/\D/g, '') ?? null;
}

// "ม้า"/"ขี่ม้า"/"อยากขี่" -- the same closed markers already used inside
// activityBookingFallbackDraft's own context check, extracted here so both
// that function and the bare-selection clarification below use IDENTICAL
// vocabulary for what counts as "explicit horse-riding intent."
function hasExplicitHorseBookingIntent(text: string): boolean {
  return /ขี่ม้า|จองม้า|อยาก.*ม้า|ม้า|อยากขี่/u.test(text);
}

// "ขี่ทองไทย"/"จะขี่ทองไทย"/"อยากขี่ภาราดร" -- a riding verb attached
// DIRECTLY to a specific horse's proper name, without the generic word
// "ม้า" anywhere (that shape is already covered by
// hasExplicitHorseBookingIntent and routes through the full
// activityBookingFallbackDraft slot-filling flow instead). This is its
// own, narrower signal: real production incident this closes -- "จะขี่
// ทองไทย" with no prior conversation was still being treated as
// AMBIGUOUS (same as a bare "เอาทองไทย"/"ทองไทย") and, before context was
// established, got the "horse or assistant?" clarification even though
// naming a riding verb together with the horse's name leaves nothing
// genuinely ambiguous to ask about.
function hasRidingVerbAttachedToHorseName(text: string): boolean {
  return /ขี่(?:ทองไทย|ภาราดร)/u.test(text);
}

// Whether a horse-booking task is already legitimately underway --
// checked against PRIOR turns only, so a bare "เอาทองไทย" that only
// LOOKS like a continuation because it's the second-plus message in a
// totally unrelated conversation still gets caught (see
// isBareAmbiguousHorseSelection below).
function hasActiveHorseBookingContext(request: BrainRequest): boolean {
  const priorUserText = request.chatHistory.filter(turn => turn.role === 'user').map(turn => turn.content).join('\n');
  return hasExplicitHorseBookingIntent(priorUserText) || activityFallbackCommit(request.message);
}

// The client doesn't always resend the full visible conversation as
// request.chatHistory (some flows, and every test that seeds task state
// directly via guest_agent_state, send it empty) -- so "no chatHistory
// context" alone can't safely mean "this guest has never discussed
// horses." An activity task EVER having existed for this guest (even one
// that's since been cancelled/completed) is real evidence the
// conversation already established that context, and asking a
// disambiguation question at that point would be worse than just
// honoring the obvious selection.
async function hasEverDiscussedActivityDomain(guestDbId: string | null): Promise<boolean> {
  const snapshot = await loadGuestAgentStateSnapshot(guestDbId);
  const taskState = snapshot.state?.taskState as { activeTask?: { domain?: string } } | undefined;
  return taskState?.activeTask?.domain === 'activity';
}

// "ทองไทย" is a real, deliberate name collision -- the bot's own name AND
// a horse's name -- so a bare "เอาทองไทย"/"เลือกภาราดร"/a bare horse name
// alone is genuinely ambiguous without EITHER an already-open horse-
// booking task OR the current message itself expressing real riding
// intent ("อยากขี่ทองไทย", "เอาม้าภาราดร"). Real production incident this
// closes: with NO prior context at all, a bare horse-name mention was
// silently accepted by the One-Mind semantic layer's own, separate
// findKnownActivityAssetSelection check (_deterministic-semantic-turn.ts,
// which has no context/intent gate of its own) and quietly opened a
// horse-booking task the customer never asked to start, producing a
// garbled missing-field prompt instead of ever asking what they meant.
function isBareAmbiguousHorseSelection(request: BrainRequest): { name: string } | null {
  if (topLevelIntentBlocksHorseTokenRouting(classifyTopLevelSemanticIntent(request.message))) return null;
  const asset = activityAssetFromText(request.message);
  if (!asset) return null;
  if (mentionsThongthaiResponse(request.message)) return null;
  if (isHorseInfoOrComparisonQuestion(request.message)) return null;
  // A temperament/beginner-suitability comparison naming both horses
  // ("ภาราดรกับทองไทยตัวไหนนิสัยดีกว่า") must reach detectCompareEntities's
  // existing honest "ไม่มีข้อมูล" decline, not this clarification --
  // activityAssetFromText matches a horse's name inside it exactly like a
  // real selection attempt would, so this needs its own explicit check.
  if (isCompareEntitiesAttributeQuestion(request.message)) return null;
  if (hasExplicitHorseBookingIntent(request.message)) return null;
  return asset;
}

/**
 * A deterministic clarification for a bare, ambiguous horse-name mention
 * with no active booking context -- see isBareAmbiguousHorseSelection's
 * own doc comment for the incident this closes. Checked at the very top
 * of the activity-booking precedence chain (before
 * activityBookingFallbackResponse even runs, and long before the One-Mind
 * orchestrator would otherwise see the message), so this always wins over
 * silently starting a booking, but never overrides an ALREADY-open task
 * or a message that itself clearly asks to ride.
 */
export async function bareHorseSelectionClarification(request: BrainRequest, guestDbId: string | null): Promise<BrainResponse | null> {
  const ambiguous = isBareAmbiguousHorseSelection(request);
  if (!ambiguous) return null;
  if (hasRidingVerbAttachedToHorseName(request.message)) return null;
  if (hasActiveHorseBookingContext(request)) return null;
  const everDiscussedActivity = await hasEverDiscussedActivityDomain(guestDbId).catch(() => false);
  if (everDiscussedActivity) return null;

  // Customer-facing text always shows the owner-required display name
  // (HORSE_FACTS.name, "น้องทองไทย"/"น้องภาราดร"), never ambiguous.name's
  // bare internal form -- that bare form is still what gets persisted
  // below (persistHorseSelectionWithContextResponse etc.), display and
  // storage deliberately kept separate (see HORSE_FACTS's own comment).
  const isThongthai = ambiguous.name === 'ทองไทย';
  const displayName = isThongthai ? HORSE_FACTS.thongthai.name : HORSE_FACTS.pharadon.name;
  const message = isThongthai
    ? `หมายถึงอยากเลือก “${displayName}” เป็นม้าสำหรับขี่ หรือเรียกทองไทยผู้ช่วยแชทครับ 😊`
    : `หมายถึงม้า “${displayName}” ใช่ไหมครับ ถ้าอยากขี่ม้า พิมพ์ว่า “อยากขี่ม้า” ได้เลยครับ`;
  return {
    message,
    intent: 'information',
    contextUpdates: {},
    journeyAction: { type: 'none', journey: null },
    suggestedActions: [],
    responseStyle: 'direct',
    semanticMemoryUpdates: [],
    toolCalls: [],
  };
}

const ACTIVITY_BOOKING_REQUIRED_FIELDS = ['assetSelection', 'duration', 'date', 'time', 'partySize', 'customerName', 'phone'] as const;

// Persists a horse choice onto the guest's activity_booking ActiveTask
// (creating one if none is open) so a LATER turn -- including on LINE,
// where chatHistory is always empty -- still knows which horse was
// picked. Reuses the same _task-state.ts machinery every other domain
// uses rather than a bespoke JSONB shape.
async function persistHorseSelection(guestDbId: string | null, channel: BrainChannel, horseName: string): Promise<void> {
  if (!guestDbId) return;
  try {
    let container = await loadTaskState(guestDbId);

    // An explicit horse selection is a real domain switch. Preserve an
    // unrelated unfinished task in the bounded suspended slot instead of
    // overwriting it or letting it block horse context on the next LINE turn.
    if (container.activeTask
        && !isTerminalTaskStatus(container.activeTask.status)
        && container.activeTask.domain !== 'activity') {
      container = suspendActiveTask(container);
    }

    const reusable = container.activeTask
      && container.activeTask.type === 'activity_booking'
      && !isTerminalTaskStatus(container.activeTask.status);
    const task = reusable
      ? mergeTaskSlots(container.activeTask!, {
        assetSelection: horseName,
        horseName,
        resourceCode: 'activity-horse',
      }, ACTIVITY_BOOKING_REQUIRED_FIELDS)
      : mergeTaskSlots(
        createActiveTask({ type: 'activity_booking', sourceChannel: channel, requiredFields: ACTIVITY_BOOKING_REQUIRED_FIELDS }),
        {
          assetSelection: horseName,
          horseName,
          resourceCode: 'activity-horse',
        },
        ACTIVITY_BOOKING_REQUIRED_FIELDS,
      );
    await persistTaskState(guestDbId, { ...container, activeTask: task });
  } catch (error) {
    console.error('THONGTHAI_HORSE_SELECTION_PERSIST_ERROR', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
  }
}

/**
 * Phase 7 final boundary: an explicit horse selection combined with a current-
 * turn no-booking marker is planning state, never a booking-field collection
 * prompt. Persist the bounded, non-committed selection so later duration /
 * resume turns have server-side continuity, then stop with information intent.
 */
export async function explicitHorseHoldWithoutBookingResponse(
  request: BrainRequest,
  guestDbId: string | null,
  channel: BrainChannel,
  boundaryMode: string,
): Promise<BrainResponse | null> {
  if (boundaryMode !== 'WITHHOLD') return null;
  // This zero-cost fast path is deliberately narrower than the commercial
  // WITHHOLD class. It owns only a direct NAMED hold ("เอาภาราดรไว้ก่อน").
  // Conditional/fallback availability language still needs semantic
  // supervision because it can name two horses and encode branching logic.
  if (!/(?:เอา|เลือก)\s*(?:น้อง)?(?:ทองไทย|ภาราดร).{0,16}ไว้ก่อน/u.test(request.message)) return null;
  if (/(?:ถ้า|ไม่ว่าง|ว่าง|เต็ม|คิว)/u.test(request.message)) return null;
  const asset = activityAssetFromText(request.message);
  if (!asset || asset.resourceCode !== 'activity-horse') return null;
  await persistHorseSelection(guestDbId, channel, asset.name);
  const displayName = asset.name.startsWith('น้อง') ? asset.name : `น้อง${asset.name}`;
  return {
    message:`ได้ครับ เก็บ${displayName}ไว้เป็นตัวเลือกก่อนนะครับ ยังไม่ได้จองหรือส่งรายการครับ`,
    intent:'information',
    contextUpdates:{},
    journeyAction:{type:'none',journey:null},
    suggestedActions:[],
    responseStyle:'direct',
    semanticMemoryUpdates:[],
    toolCalls:[],
  };
}

// Once a horse-booking conversation is already established (chatHistory
// showing explicit riding intent, OR -- for LINE, where chatHistory never
// carries prior turns -- a persisted activity-domain task from an earlier
// turn), a bare horse-name mention is no longer ambiguous: it's a real
// selection. bareHorseSelectionClarification already declines to ask the
// "horse or assistant?" question in exactly this situation; this is what
// actually DOES something with the selection instead of silently falling
// through toward the LLM -- confirms the choice warmly (ride-feel +
// personality, the same HORSE_FACTS data the horse-comparison responder
// uses, so the two never drift), asks the one caring question that
// matters next (rider experience + party size), and persists the pick.
export async function horseSelectionWithContextResponse(
  request: BrainRequest,
  guestDbId: string | null,
  channel: BrainChannel,
): Promise<BrainResponse | null> {
  const ambiguous = isBareAmbiguousHorseSelection(request);
  if (!ambiguous) return null;
  const hasContext = hasRidingVerbAttachedToHorseName(request.message)
    || hasActiveHorseBookingContext(request)
    || await hasEverDiscussedActivityDomain(guestDbId).catch(() => false);
  if (!hasContext) return null;

  const facts = ambiguous.name === 'ทองไทย' ? HORSE_FACTS.thongthai : HORSE_FACTS.pharadon;

  await persistHorseSelection(guestDbId, channel, ambiguous.name);

  // Read the persisted activity task AFTER selection so the follow-up asks
  // only for genuinely missing care basics. LINE carries no chatHistory, so
  // the task slots are the authoritative cross-turn continuation state.
  const selectedTask = await loadTaskState(guestDbId).catch(() => null);
  const slots = selectedTask?.activeTask?.type === 'activity_booking'
    ? selectedTask.activeTask.slots
    : {};
  const hasExperience = Boolean(slots.riderExperience);
  const hasPartySize = typeof slots.partySize === 'number' && slots.partySize > 0;
  const nextQuestion = !hasExperience && !hasPartySize
    ? 'เคยขี่ม้ามาก่อนไหมครับ แล้วมากี่คนครับ?'
    : !hasExperience
      ? 'เคยขี่ม้ามาก่อนไหมครับ?'
      : !hasPartySize
        ? 'แล้วมากี่คนครับ?'
        : HORSE_DETAIL_CLARIFICATION_QUESTION;

  const message = [
    `ได้ครับ เลือก${facts.name}นะครับ 😊`,
    `${facts.name}จะ${facts.rideFeelTh} คาแรกเตอร์${facts.personalityTh}ครับ`,
    nextQuestion,
  ].join('\n');

  return {
    message,
    intent: 'information',
    contextUpdates: {},
    journeyAction: { type: 'none', journey: null },
    suggestedActions: [],
    responseStyle: 'direct',
    semanticMemoryUpdates: [],
    toolCalls: [],
  };
}

// The continuation half of horseSelectionWithContextResponse's care
// question ("เคยขี่ม้ามาก่อนไหมครับ แล้วมากี่คนครับ?"). Real production
// incident this closes: the customer's answer ("ไม่เคยครับมาคนเดียว") named
// no horse and no activity keyword, so it matched NOTHING deterministic
// and fell all the way through to the One-Mind orchestrator's generic
// "ขอรายละเอียดเพิ่มอีกนิดครับ จะได้ช่วยต่อให้ตรงเรื่อง" clarification --
// which never says what detail is missing, so asking "รายละเอียดอะไรครับ?"
// back just got the SAME vague line again. This only claims the turn when
// there is a real, active horse selection still waiting on rider
// experience/party size, and only when the message actually parses as an
// answer to that -- otherwise it defers exactly like before.
function parseRiderExperience(text: string): 'beginner' | 'experienced' | null {
  return interpretExperience(text);
}

// A first-person-singular self-reference with no companion mention
// anywhere in the message ("ผมไม่เคยขี่ครับ...") -- a genuine, if soft,
// solo signal, used only as a last resort when neither an explicit
// number nor "คนเดียว" is present. Real gap this closes: a compound
// answer that names experience/health but never separately states party
// size ("ผมไม่เคยขี่ครับ ไม่กังวลครับ ไม่ปวดหลัง") otherwise stalled the
// flow waiting on a party-size question the customer had already
// implicitly answered by speaking only about themselves.
const SOLO_SELF_REFERENCE_RE = /^(?:ผม|ดิฉัน|หนู)(?!.*(?:กับ|พา|หลายคน|\d+\s*คน|มากัน))/u;

function parsePartySizeFromCareAnswer(text: string): number | null {
  if (/คนเดียว/u.test(text)) return 1;
  const explicit = extractPartySize(text);
  if (explicit) return explicit;
  if (SOLO_SELF_REFERENCE_RE.test(text.trim())) return 1;
  return null;
}

const HORSE_DETAIL_CLARIFICATION_QUESTION = 'มีเจ็บหลัง เจ็บเข่า เจ็บสะโพก หรือกังวลเรื่องการทรงตัวไหมครับ?';

const DETAIL_CONFUSION_MARKER = /รายละเอียดอะไร|หมายถึงอะไร|คืออะไร|อะไรบ้างครับ|อะไรบ้างคะ/u;

async function loadHorseBookingTask(guestDbId: string | null) {
  if (!guestDbId) return null;
  const container = await loadTaskState(guestDbId);
  const task = container.activeTask;
  if (!task || task.type !== 'activity_booking' || isTerminalTaskStatus(task.status)) return null;
  if (!task.slots.assetSelection) return null;
  return { container, task };
}

export async function horseCareFollowupResponse(
  request: BrainRequest,
  guestDbId: string | null,
  channel: BrainChannel,
): Promise<BrainResponse | null> {
  const found = await loadHorseBookingTask(guestDbId).catch(() => null);
  if (!found) return null;
  const { task } = found;

  if (task.slots.riderExperience && task.slots.partySize) return null; // care basics already known -- horseCareDetailExplainerResponse owns anything further

  const experience = parseRiderExperience(request.message);
  const partySize = parsePartySizeFromCareAnswer(request.message);
  if (!experience && !partySize) return null;

  const resolvedExperience = experience ?? (task.slots.riderExperience as string | undefined) ?? null;
  const resolvedPartySize = partySize ?? (task.slots.partySize as number | undefined) ?? null;
  await persistHorseCareSlots(guestDbId, channel, { riderExperience: resolvedExperience, partySize: resolvedPartySize });

  const experienceLabel = resolvedExperience === 'beginner' ? 'มือใหม่' : null;
  const partyLabel = resolvedPartySize === 1 ? 'มาคนเดียว' : null;

  // A compound message can answer experience/party AND the health/balance
  // question in one shot ("ผมไม่เคยขี่ครับ ไม่กังวลครับ ไม่ปวดหลัง") -- once
  // both basics are resolved, check for that in the SAME message instead
  // of asking a question the customer already answered.
  if (resolvedExperience && resolvedPartySize) {
    const healthConcern = interpretOverallHealthConcern(request.message);
    if (healthConcern) {
      await persistHorseHealthSlot(guestDbId, healthConcern);
      const healthLabel = healthConcern === 'none' ? 'ไม่มีอาการเจ็บหลัง/กังวลเรื่องทรงตัวนะครับ' : null;
      const ack = ['รับทราบครับ', experienceLabel, partyLabel, healthLabel && 'และ' + healthLabel].filter(Boolean).join(' ');
      return {
        message: [
          `${ack} 😊`,
          'แบบนี้ทองไทยแนะนำให้เริ่มแบบชิล ๆ ก่อน ทีมจะช่วยดูใกล้ ๆ ตอนขึ้น-ลงม้าและเริ่มช้า ๆ ได้ครับ',
          'อยากเริ่ม 30 นาทีแบบลองก่อน หรืออยากเก็บบรรยากาศนานขึ้นเป็น 60 นาทีครับ?',
        ].join('\n'),
        intent: 'information',
        contextUpdates: {},
        journeyAction: { type: 'none', journey: null },
        suggestedActions: [],
        responseStyle: 'direct',
        semanticMemoryUpdates: [],
        toolCalls: [],
      };
    }
  }

  const ack = ['รับทราบครับ', experienceLabel, partyLabel].filter(Boolean).join(' ');

  return {
    message: `${ack} เดี๋ยวทีมช่วยดูใกล้ ๆ ได้ครับ 😊\n${HORSE_DETAIL_CLARIFICATION_QUESTION}`,
    intent: 'information',
    contextUpdates: {},
    journeyAction: { type: 'none', journey: null },
    suggestedActions: [],
    responseStyle: 'direct',
    semanticMemoryUpdates: [],
    toolCalls: [],
  };
}

// If the customer answers the health-question with confusion ("รายละเอียด
// อะไรครับ?") instead of an answer, explain exactly what's being asked
// rather than repeating anything vague. Checked as its own responder
// (not folded into horseCareFollowupResponse above) because by this point
// riderExperience/partySize are already persisted, so the condition is
// simpler to express standalone.
export async function horseCareDetailExplainerResponse(
  request: BrainRequest,
  guestDbId: string | null,
): Promise<BrainResponse | null> {
  if (!DETAIL_CONFUSION_MARKER.test(request.message)) return null;
  const found = await loadHorseBookingTask(guestDbId).catch(() => null);
  if (!found) return null;
  const { task } = found;
  if (!task.slots.riderExperience || !task.slots.partySize) return null;
  if (task.slots.healthConcern) return null; // horseHealthFollowupResponse owns anything once the health question is answered

  return {
    message: 'ขอโทษครับ ทองไทยหมายถึงข้อมูลคนขี่นิดนึงครับ เช่น มีเจ็บหลัง/เข่า/สะโพกไหม หรือกังวลเรื่องการทรงตัวไหมครับ จะได้ให้ทีมดูแลเหมาะขึ้นครับ',
    intent: 'information',
    contextUpdates: {},
    journeyAction: { type: 'none', journey: null },
    suggestedActions: [],
    responseStyle: 'direct',
    semanticMemoryUpdates: [],
    toolCalls: [],
  };
}

// The third step: once rider experience + party size + the health/balance
// question are all answered, acknowledge everything understood so far and
// move to the one remaining useful question (duration) -- instead of
// falling through to a generic "need more detail" again. Real production
// incident this closes: the customer answered "ไม่กังวลครับ" (no health
// concern) and the bot asked for "more detail" a second time, because
// nothing captured that answer at all.
function parseHealthConcern(text: string): 'none' | 'present' | null {
  return interpretOverallHealthConcern(text);
}

export async function horseHealthFollowupResponse(
  request: BrainRequest,
  guestDbId: string | null,
  channel: BrainChannel,
): Promise<BrainResponse | null> {
  const found = await loadHorseBookingTask(guestDbId).catch(() => null);
  if (!found) return null;
  const { task } = found;
  if (!task.slots.riderExperience || !task.slots.partySize) return null;
  if (task.slots.healthConcern) return null; // already answered -- nothing more for this responder to add

  const healthConcern = parseHealthConcern(request.message);
  if (!healthConcern) return null;

  await persistHorseHealthSlot(guestDbId, healthConcern);

  const experienceLabel = task.slots.riderExperience === 'beginner' ? 'มือใหม่' : null;
  const partyLabel = task.slots.partySize === 1 ? 'มาคนเดียว' : null;
  const healthLabel = healthConcern === 'none' ? 'ไม่มีอาการเจ็บหลัง/กังวลเรื่องทรงตัวนะครับ' : null;
  const ack = ['รับทราบครับ', experienceLabel, partyLabel, healthLabel && 'และ' + healthLabel].filter(Boolean).join(' ');

  return {
    message: [
      `${ack} 😊`,
      'แบบนี้ทองไทยแนะนำให้เริ่มแบบชิล ๆ ก่อน ทีมจะช่วยดูใกล้ ๆ ตอนขึ้น-ลงม้าและเริ่มช้า ๆ ได้ครับ',
      'อยากเริ่ม 30 นาทีแบบลองก่อน หรืออยากเก็บบรรยากาศนานขึ้นเป็น 60 นาทีครับ?',
    ].join('\n'),
    intent: 'information',
    contextUpdates: {},
    journeyAction: { type: 'none', journey: null },
    suggestedActions: [],
    responseStyle: 'direct',
    semanticMemoryUpdates: [],
    toolCalls: [],
  };
}

async function persistHorseCareSlots(
  guestDbId: string | null,
  channel: BrainChannel,
  slots: { riderExperience: string | null; partySize: number | null },
): Promise<void> {
  if (!guestDbId) return;
  try {
    const container = await loadTaskState(guestDbId);
    const reusable = container.activeTask
      && container.activeTask.type === 'activity_booking'
      && !isTerminalTaskStatus(container.activeTask.status);
    if (!reusable) return;
    const patch: Record<string, unknown> = {};
    if (slots.riderExperience !== null) patch.riderExperience = slots.riderExperience;
    if (slots.partySize !== null) patch.partySize = slots.partySize;
    const task = mergeTaskSlots(container.activeTask!, patch, ACTIVITY_BOOKING_REQUIRED_FIELDS);
    await persistTaskState(guestDbId, { ...container, activeTask: task });
  } catch (error) {
    console.error('THONGTHAI_HORSE_CARE_SLOT_PERSIST_ERROR', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
  }
}

async function persistHorseHealthSlot(
  guestDbId: string | null,
  healthConcern: 'none' | 'present',
): Promise<void> {
  if (!guestDbId) return;
  try {
    const container = await loadTaskState(guestDbId);
    const reusable = container.activeTask
      && container.activeTask.type === 'activity_booking'
      && !isTerminalTaskStatus(container.activeTask.status);
    if (!reusable) return;
    const task = mergeTaskSlots(container.activeTask!, { healthConcern }, ACTIVITY_BOOKING_REQUIRED_FIELDS);
    await persistTaskState(guestDbId, { ...container, activeTask: task });
  } catch (error) {
    console.error('THONGTHAI_HORSE_HEALTH_SLOT_PERSIST_ERROR', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
  }
}

async function persistHorseFearSlot(guestDbId: string | null, fear: 'concerned' | 'not_worried'): Promise<void> {
  if (!guestDbId) return;
  try {
    const container = await loadTaskState(guestDbId);
    const reusable = container.activeTask
      && container.activeTask.type === 'activity_booking'
      && !isTerminalTaskStatus(container.activeTask.status);
    if (!reusable) return;
    const task = mergeTaskSlots(container.activeTask!, { fearOrConfidence: fear }, ACTIVITY_BOOKING_REQUIRED_FIELDS);
    await persistTaskState(guestDbId, { ...container, activeTask: task });
  } catch (error) {
    console.error('THONGTHAI_HORSE_FEAR_SLOT_PERSIST_ERROR', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
  }
}

async function persistHorseCustomerTypeSlot(guestDbId: string | null, customerType: NonNullable<CustomerTypeSignal>): Promise<void> {
  if (!guestDbId) return;
  try {
    const container = await loadTaskState(guestDbId);
    const reusable = container.activeTask
      && container.activeTask.type === 'activity_booking'
      && !isTerminalTaskStatus(container.activeTask.status);
    if (!reusable) return;
    const task = mergeTaskSlots(
      container.activeTask!,
      { customerType: customerType.kind, customerAgeYears: customerType.ageYears },
      ACTIVITY_BOOKING_REQUIRED_FIELDS,
    );
    await persistTaskState(guestDbId, { ...container, activeTask: task });
  } catch (error) {
    console.error('THONGTHAI_HORSE_CUSTOMER_TYPE_PERSIST_ERROR', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
  }
}

// Fear/concern expressed at ANY point in the horse-care flow before the
// health question is answered -- e.g. "กังวลนิดนึง" said in place of an
// experience/party or health answer. Real gap this closes: neither
// horseCareFollowupResponse's nor horseHealthFollowupResponse's parsers
// recognize a bare expression of concern as an answer to anything, so it
// fell all the way through to the generic vague fallback -- exactly the
// "keyword-triggered, doesn't actually understand" gap the owner's
// semantic-intelligence request is about. Never steals a turn that ALSO
// answers a still-open slot (e.g. a message naming both experience AND
// concern) -- horseCareFollowupResponse/horseHealthFollowupResponse still
// own those, unchanged.
export async function horseCareFearResponse(
  request: BrainRequest,
  guestDbId: string | null,
): Promise<BrainResponse | null> {
  const found = await loadHorseBookingTask(guestDbId).catch(() => null);
  if (!found) return null;
  const { task } = found;
  if (task.slots.healthConcern) return null; // fully resolved -- nothing left for this responder

  const fear = interpretFear(request.message);
  if (fear !== 'concerned') return null;

  const needsExperience = !task.slots.riderExperience || !task.slots.partySize;
  if (needsExperience && interpretExperience(request.message) !== null) return null;
  if (!needsExperience && interpretOverallHealthConcern(request.message) !== null) return null;

  await persistHorseFearSlot(guestDbId, 'concerned');

  const reassurance = needsExperience
    ? 'เข้าใจครับ ไม่ต้องกังวลนะครับ ทีมจะช่วยดูใกล้ ๆ ให้ตลอดครับ 😊'
    : 'เข้าใจครับ ถ้ากังวลนิดนึง แนะนำเริ่ม 30 นาทีแบบชิล ๆ ก่อนครับ ทีมจะช่วยดูใกล้ ๆ ตอนขึ้น-ลงม้า และเริ่มช้า ๆ ได้ครับ';
  const nextQuestion = needsExperience
    ? 'เคยขี่ม้ามาก่อนไหมครับ แล้วมากี่คนครับ?'
    : HORSE_DETAIL_CLARIFICATION_QUESTION;

  return {
    message: `${reassurance}\n${nextQuestion}`,
    intent: 'information',
    contextUpdates: {},
    journeyAction: { type: 'none', journey: null },
    suggestedActions: [],
    responseStyle: 'direct',
    semanticMemoryUpdates: [],
    toolCalls: [],
  };
}

// "ปลอดภัยไหม"/"ขอแบบปลอดภัยที่สุด" during an active horse-care conversation
// -- never a guarantee (see _semantic-hospitality-interpreter.ts's
// noSafetyGuaranteeMessage doc comment for why this is shared wording
// meant for every risky activity, not just horses), then continues asking
// whatever is still missing so the question never dead-ends the flow.
export async function horseSafetyQuestionResponse(
  request: BrainRequest,
  guestDbId: string | null,
): Promise<BrainResponse | null> {
  if (!asksIfSafe(request.message)) return null;
  const found = await loadHorseBookingTask(guestDbId).catch(() => null);
  if (!found) return null;
  const { task } = found;

  const needsExperience = !task.slots.riderExperience || !task.slots.partySize;
  const nextQuestion = task.slots.healthConcern
    ? null
    : needsExperience ? 'เคยขี่ม้ามาก่อนไหมครับ แล้วมากี่คนครับ?' : HORSE_DETAIL_CLARIFICATION_QUESTION;

  return {
    message: nextQuestion ? `${noSafetyGuaranteeMessage('ขี่ม้า')}\n${nextQuestion}` : noSafetyGuaranteeMessage('ขี่ม้า'),
    intent: 'information',
    contextUpdates: {},
    journeyAction: { type: 'none', journey: null },
    suggestedActions: [],
    responseStyle: 'direct',
    semanticMemoryUpdates: [],
    toolCalls: [],
  };
}

// A compound opening message that both expresses horse-riding intent AND
// names a care-relevant signal in the SAME message -- a family/elderly
// companion, a child (with age if stated), or a health concern -- e.g.
// "แม่อยากขี่ม้า เข่าไม่ค่อยดี" or "เด็ก 8 ขวบอยากขี่". Real gap this
// closes: these compound messages matched neither
// isActivityIntentStartMessage's tightly-anchored exact phrases nor
// isBareAmbiguousHorseSelection's named-horse check, so they fell through
// to a generic response that never acknowledged the care context at all.
// Deliberately never promises safety and never rushes to duration -- team
// assessment is offered instead of a guarantee, matching every other
// risky-activity responder in this file.
//
// Defers to isActivityIntentStartMessage whenever IT already matches
// (e.g. "อยากขี่ม้า มีเด็กไปด้วย") -- that phrase-anchored mechanism (see
// _service-mind-conversation-flow.ts's ACTIVITY_INTENT_QUALIFIER_PHRASE)
// already asks a MORE specific age/comfort question for exactly that
// shape; this responder exists only for compound messages that mechanism
// doesn't cover (an unanchored companion mention, a stated age, a health
// concern with no qualifier phrase match).
export async function horseCompoundCareIntentResponse(
  request: BrainRequest,
  guestDbId: string | null,
  channel: BrainChannel,
): Promise<BrainResponse | null> {
  if (!hasExplicitHorseBookingIntent(request.message)) return null;
  if (mentionsThongthaiResponse(request.message)) return null;
  if (isActivityIntentStartMessage(request.message)) return null;

  const customerType = interpretCustomerType(request.message);
  const health = interpretOverallHealthConcern(request.message);
  const fear = interpretFear(request.message);
  const riderExperience = interpretExperience(request.message);
  const partySize = parsePartySizeFromCareAnswer(request.message);
  if (!customerType && health !== 'present' && fear !== 'concerned') return null;

  const found = await loadHorseBookingTask(guestDbId).catch(() => null);
  if (found && found.task.slots.riderExperience && found.task.slots.partySize) return null;

  await markActivityIntentStarted(guestDbId, channel);

  // Persist every care fact already expressed in this opening turn. The reply
  // below already uses these signals semantically; failing to store them made
  // the next LINE webhook re-ask questions the customer had answered.
  if (riderExperience || partySize) {
    await persistHorseCareSlots(guestDbId, channel, {
      riderExperience,
      partySize,
    });
  }
  if (customerType) await persistHorseCustomerTypeSlot(guestDbId, customerType);
  if (health === 'present') await persistHorseHealthSlot(guestDbId, 'present');
  if (fear === 'concerned') await persistHorseFearSlot(guestDbId, 'concerned');

  let careNote: string;
  if (customerType?.kind === 'elderly') {
    const healthClause = health === 'present' ? 'และมีเรื่องสุขภาพที่กังวลด้วยใช่ไหมครับ' : '';
    careNote = `เข้าใจครับ พาผู้ใหญ่มาด้วย${healthClause ? healthClause : 'ด้วย'} 🙏 ทองไทยแนะนำให้ทีมงานช่วยประเมินและดูแลใกล้ ๆ ก่อนขึ้นม้านะครับ เริ่มจากช้า ๆ ได้ ถ้าถึงหน้างานแล้วรู้สึกไม่พร้อม ทีมจะช่วยแนะนำทางเลือกอื่นให้ครับ`;
  } else if (customerType?.kind === 'child') {
    const ageLabel = customerType.ageYears ? `เด็ก ${customerType.ageYears} ขวบ` : 'น้อง ๆ';
    careNote = `เข้าใจครับ ${ageLabel}อยากขี่ม้าด้วยใช่ไหมครับ 😊 ทองไทยแนะนำให้ทีมงานช่วยประเมินความพร้อมและดูแลใกล้ ๆ ตลอดนะครับ ผู้ปกครองอยู่ด้วยได้เลยครับ ทองไทยไม่ขอการันตีความปลอดภัย 100% แต่ทีมจะดูแลอย่างดีที่สุดครับ`;
  } else if (fear === 'concerned') {
    careNote = 'เข้าใจครับ ไม่ต้องกังวลนะครับ 😊 ทองไทยแนะนำให้เริ่มแบบชิล ๆ ก่อน ทีมงานจะช่วยดูใกล้ ๆ ตลอดและเริ่มช้า ๆ ให้ครับ ทองไทยไม่ขอการันตีความปลอดภัย 100% แต่ทีมจะดูแลอย่างดีที่สุดครับ';
  } else {
    careNote = 'เข้าใจครับ ทองไทยแนะนำให้ทีมงานช่วยประเมินและดูแลใกล้ ๆ ก่อนขึ้นม้านะครับ เริ่มจากช้า ๆ ได้ครับ ทองไทยไม่ขอการันตีความปลอดภัย 100% แต่ทีมจะดูแลอย่างดีที่สุดครับ';
  }

  const nextQuestion = riderExperience && partySize
    ? HORSE_DETAIL_CLARIFICATION_QUESTION
    : riderExperience
      ? 'แล้วมากี่คนครับ?'
      : partySize
        ? 'เคยขี่ม้ามาก่อนไหมครับ?'
        : 'เคยขี่ม้ามาก่อนไหมครับ แล้วมากี่คนครับ?';

  return {
    message: `${careNote}\n${nextQuestion}`,
    intent: 'information',
    contextUpdates: {},
    journeyAction: { type: 'none', journey: null },
    suggestedActions: [],
    responseStyle: 'direct',
    semanticMemoryUpdates: [],
    toolCalls: [],
  };
}

// Additional horse-riding scenario signals: a goal that doesn't need a
// full ride at all (photo-only / touch-only), a stated ride-feel
// preference between the two real configured horses ("นิ่มกว่า" ->
// ภาราดร, "แน่นกว่า" -> ทองไทย -- see _local-concierge-knowledge.ts's
// HORSE_FACTS, never a claim beyond what's configured there), a weight/
// size concern, or a request for hands-on support ("ให้คนจูงได้ไหม").
// Fires on either an explicit horse-intent opening message OR an already-
// active horse task, mirroring horseCareFearResponse/
// horseSafetyQuestionResponse's own dual entry point.
export async function horseScenarioSignalResponse(
  request: BrainRequest,
  guestDbId: string | null,
  channel: BrainChannel,
): Promise<BrainResponse | null> {
  if (mentionsThongthaiResponse(request.message)) return null;
  const hasIntent = hasExplicitHorseBookingIntent(request.message);
  // Broader than loadHorseBookingTask (which requires a horse ALREADY
  // selected) -- a firmness preference/goal/support question can arrive
  // right after a bare "อยากขี่ม้า" opener, before any specific horse name
  // has been chosen, so this only needs "an activity conversation is
  // already underway" (the same signal isBareAmbiguousHorseSelection's own
  // hasActiveHorseBookingContext/hasEverDiscussedActivityDomain checks
  // use), not a fully-resolved horse task.
  const alreadyInActivityContext = hasActiveHorseBookingContext(request)
    || await hasEverDiscussedActivityDomain(guestDbId).catch(() => false);
  if (!alreadyInActivityContext && !hasIntent) return null;

  const goal = interpretActivityGoal(request.message);
  if (goal === 'photo_only') {
    return {
      message: 'ได้เลยครับ 😊 ถ่ายรูปกับม้าได้โดยไม่ต้องขี่เลยครับ ทีมงานจะช่วยพาเข้าไปใกล้ ๆ แบบปลอดภัยให้ครับ',
      intent: 'information', contextUpdates: {}, journeyAction: { type: 'none', journey: null },
      suggestedActions: [], responseStyle: 'direct', semanticMemoryUpdates: [], toolCalls: [],
    };
  }
  if (goal === 'touch_only') {
    return {
      message: 'ได้เลยครับ 😊 ดูใกล้ ๆ หรือให้อาหารม้าได้โดยไม่ต้องขี่ครับ ทีมงานจะดูแลให้ปลอดภัยตลอดครับ',
      intent: 'information', contextUpdates: {}, journeyAction: { type: 'none', journey: null },
      suggestedActions: [], responseStyle: 'direct', semanticMemoryUpdates: [], toolCalls: [],
    };
  }

  const firmness = interpretFirmnessPreference(request.message);
  if (firmness) {
    // Bare internal name persists to task state (the real storage
    // contract); facts.name is the owner-required display name shown to
    // the customer -- see HORSE_FACTS's own comment.
    const bareHorseName = firmness === 'softer' ? 'ภาราดร' : 'ทองไทย';
    const facts = firmness === 'softer' ? HORSE_FACTS.pharadon : HORSE_FACTS.thongthai;
    await persistHorseSelection(guestDbId, channel, bareHorseName);
    return {
      message: [
        `ได้ครับ เลือก${facts.name}นะครับ 😊`,
        `${facts.name}จะ${facts.rideFeelTh} คาแรกเตอร์${facts.personalityTh}ครับ`,
        'เคยขี่ม้ามาก่อนไหมครับ แล้วมากี่คนครับ?',
      ].join('\n'),
      intent: 'information', contextUpdates: {}, journeyAction: { type: 'none', journey: null },
      suggestedActions: [], responseStyle: 'direct', semanticMemoryUpdates: [], toolCalls: [],
    };
  }

  if (mentionsWeightOrSizeConcern(request.message)) {
    return {
      message: 'ไม่ต้องกังวลนะครับ 😊 ม้าที่นี่รับน้ำหนักได้ในเกณฑ์ทั่วไปครับ แต่ขอให้ทีมงานช่วยเช็คความเหมาะสมอีกทีตอนถึงหน้างานเพื่อความชัวร์ครับ',
      intent: 'information', contextUpdates: {}, journeyAction: { type: 'none', journey: null },
      suggestedActions: [], responseStyle: 'direct', semanticMemoryUpdates: [], toolCalls: [],
    };
  }

  if (mentionsSupportRequest(request.message)) {
    return {
      message: 'มีครับ 😊 ทีมงานช่วยจูง/ประคองใกล้ ๆ ได้ตลอดครับ โดยเฉพาะช่วงขึ้น-ลงม้าและตอนเริ่มต้นครับ',
      intent: 'information', contextUpdates: {}, journeyAction: { type: 'none', journey: null },
      suggestedActions: [], responseStyle: 'direct', semanticMemoryUpdates: [], toolCalls: [],
    };
  }

  return null;
}

// ATV's own care-intro -- a minimal, narrowly-scoped counterpart to the
// horse-riding responders above. ATV has no existing dedicated booking-
// task flow to extend (unlike horse riding), so this only covers the
// specific gap the "Next Phase" spec asks for: a beginner and/or a fear-
// of-speed signal in the SAME opening message ("อยากขับ ATV ไม่เคยขับ
// กลัวเร็ว") gets a genuine care-aware reply -- team briefing, slow start
// -- instead of the legacy flow's transactional "เลือกระยะเวลา" prompt.
// Does not attempt full ATV domain coverage (no worst-case policy for
// every ATV scenario, no dedicated task-state slots) -- see
// THONGTHAI_HANDOFF.md's "Semantic Hospitality Intelligence" entry for
// what's scoped in vs. deferred.
const ATV_INTENT_MARKER = /อยากขับ\s*atv|ขับ\s*atv|เล่น\s*atv|ลอง\s*atv|atv|เอทีวี/iu;

export function hasExplicitAtvIntent(text: string): boolean {
  return ATV_INTENT_MARKER.test(text);
}

// ATV context tracking mirrors horse riding's hasEverDiscussedActivityDomain
// pattern but scoped to ATV specifically -- a follow-up question like "ถ้า
// เบรกไม่เป็นทำไง" doesn't re-name "ATV" every turn, so a bare
// hasExplicitAtvIntent check on the CURRENT message alone would miss it.
async function hasEverDiscussedAtv(guestDbId: string | null): Promise<boolean> {
  if (!guestDbId) return false;
  const snapshot = await loadGuestAgentStateSnapshot(guestDbId).catch(() => null);
  const taskState = snapshot?.state?.taskState as { activeTask?: { slots?: Record<string, unknown> } } | undefined;
  return taskState?.activeTask?.slots?.resourceCode === 'activity-atv';
}

async function markAtvIntentStarted(guestDbId: string | null, channel: BrainChannel): Promise<void> {
  if (!guestDbId) return;
  try {
    const container = await loadTaskState(guestDbId);
    const reusable = container.activeTask && container.activeTask.type === 'activity_booking' && !isTerminalTaskStatus(container.activeTask.status);
    const task = reusable
      ? mergeTaskSlots(container.activeTask!, { resourceCode: 'activity-atv' }, ACTIVITY_BOOKING_REQUIRED_FIELDS)
      : mergeTaskSlots(
        createActiveTask({ type: 'activity_booking', sourceChannel: channel, requiredFields: ACTIVITY_BOOKING_REQUIRED_FIELDS }),
        { resourceCode: 'activity-atv' },
        ACTIVITY_BOOKING_REQUIRED_FIELDS,
      );
    await persistTaskState(guestDbId, { ...container, activeTask: task });
  } catch (error) {
    console.error('THONGTHAI_ATV_TASK_START_ERROR', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
  }
}

export async function atvCareIntentResponse(
  request: BrainRequest,
  guestDbId: string | null,
  channel: BrainChannel,
): Promise<BrainResponse | null> {
  const hasIntent = hasExplicitAtvIntent(request.message);
  // "เบรก"/"ซ้อน" are unambiguous enough on their own in this business
  // (only ATV has brakes or a passenger seat) to answer even without
  // confirmed prior ATV context -- unlike the generic experience/fear/
  // health branch below, which genuinely needs SOME ATV signal (current
  // or past) to avoid misreading an unrelated message.
  const childPassenger = mentionsChildPassengerQuestion(request.message);
  const brakeQuestion = mentionsBrakeQuestion(request.message);
  if (!hasIntent && !childPassenger && !brakeQuestion) {
    const alreadyDiscussed = await hasEverDiscussedAtv(guestDbId).catch(() => false);
    if (!alreadyDiscussed) return null;
  }

  if (childPassenger) {
    await markAtvIntentStarted(guestDbId, channel);
    return {
      message: 'ต้องขอถามอายุเด็กก่อนนะครับ 😊 บางช่วงอายุนั่งซ้อนได้ แต่ต้องให้ทีมงานประเมินหน้างานอีกทีครับ ทองไทยไม่ขอการันตีล่วงหน้าครับ\nเด็กอายุประมาณเท่าไหร่ครับ?',
      intent: 'information', contextUpdates: {}, journeyAction: { type: 'none', journey: null },
      suggestedActions: [], responseStyle: 'direct', semanticMemoryUpdates: [], toolCalls: [],
    };
  }

  if (brakeQuestion) {
    return {
      message: 'ทีมงานจะสอนวิธีเบรกและควบคุมรถก่อนเริ่มเสมอครับ 😊 ถ้ายังไม่มั่นใจตอนซ้อมสามารถถามทีมงานซ้ำได้เลยครับ ไม่ต้องรีบเริ่มจนกว่าจะโอเคก่อนครับ',
      intent: 'information', contextUpdates: {}, journeyAction: { type: 'none', journey: null },
      suggestedActions: [], responseStyle: 'direct', semanticMemoryUpdates: [], toolCalls: [],
    };
  }

  if (wantsIntenseExperience(request.message)) {
    await markAtvIntentStarted(guestDbId, channel);
    return {
      message: 'เข้าใจครับ 😊 ความเร็ว/ความมันส์จะปรับตามเส้นทางและการประเมินหน้างานของทีมงานครับ ทองไทยไม่ขอการันตีระดับความเร็วล่วงหน้า แต่ทีมจะช่วยดูให้เหมาะกับคนขับจริง ๆ ครับ\nเคยขับ ATV มาก่อนไหมครับ?',
      intent: 'information', contextUpdates: {}, journeyAction: { type: 'none', journey: null },
      suggestedActions: [], responseStyle: 'direct', semanticMemoryUpdates: [], toolCalls: [],
    };
  }

  const experience = interpretExperience(request.message);
  const speedFear = mentionsSpeedFear(request.message);
  const health = interpretOverallHealthConcern(request.message);
  if (experience !== 'beginner' && !speedFear && health !== 'present') return null;

  await markAtvIntentStarted(guestDbId, channel);

  const parts = [
    'เข้าใจครับ',
    experience === 'beginner' ? 'มือใหม่' : null,
    speedFear ? 'กลัวความเร็ว' : null,
    health === 'present' ? 'มีเรื่องสุขภาพที่กังวล' : null,
  ].filter(Boolean).join(' ');

  return {
    message: [
      `${parts} ไม่ต้องกังวลนะครับ 😊 ทีมงานจะบรีฟวิธีขับและกติกาความปลอดภัยก่อนเริ่มเสมอ แนะนำให้เริ่มขับช้า ๆ ก่อน ค่อยเพิ่มความเร็วทีหลังได้ครับ`,
      'แล้วมากี่คนครับ?',
    ].join('\n'),
    intent: 'information',
    contextUpdates: {},
    journeyAction: { type: 'none', journey: null },
    suggestedActions: [],
    responseStyle: 'direct',
    semanticMemoryUpdates: [],
    toolCalls: [],
  };
}

// Archery's own care-intro -- same minimal, narrowly-scoped shape as
// atvCareIntentResponse above. Real gap this closes: "อยากยิงธนู แต่เจ็บ
// ไหล่" (shoulder pain) previously fell through to a generic "no matching
// option" line that never acknowledged the health concern at all -- see
// THONGTHAI_HANDOFF.md's "Semantic Hospitality Intelligence" entry for
// what else archery does/doesn't cover this round.
const ARCHERY_INTENT_MARKER = /ยิงธนู|ธนู/u;

export function hasExplicitArcheryIntent(text: string): boolean {
  return ARCHERY_INTENT_MARKER.test(text);
}

async function hasEverDiscussedArchery(guestDbId: string | null): Promise<boolean> {
  if (!guestDbId) return false;
  const snapshot = await loadGuestAgentStateSnapshot(guestDbId).catch(() => null);
  const taskState = snapshot?.state?.taskState as { activeTask?: { slots?: Record<string, unknown> } } | undefined;
  return taskState?.activeTask?.slots?.resourceCode === 'activity-archery';
}

async function markArcheryIntentStarted(guestDbId: string | null, channel: BrainChannel): Promise<void> {
  if (!guestDbId) return;
  try {
    const container = await loadTaskState(guestDbId);
    const reusable = container.activeTask && container.activeTask.type === 'activity_booking' && !isTerminalTaskStatus(container.activeTask.status);
    const task = reusable
      ? mergeTaskSlots(container.activeTask!, { resourceCode: 'activity-archery' }, ACTIVITY_BOOKING_REQUIRED_FIELDS)
      : mergeTaskSlots(
        createActiveTask({ type: 'activity_booking', sourceChannel: channel, requiredFields: ACTIVITY_BOOKING_REQUIRED_FIELDS }),
        { resourceCode: 'activity-archery' },
        ACTIVITY_BOOKING_REQUIRED_FIELDS,
      );
    await persistTaskState(guestDbId, { ...container, activeTask: task });
  } catch (error) {
    console.error('THONGTHAI_ARCHERY_TASK_START_ERROR', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
  }
}

export async function archeryCareIntentResponse(
  request: BrainRequest,
  guestDbId: string | null,
  channel: BrainChannel,
): Promise<BrainResponse | null> {
  const hasIntent = hasExplicitArcheryIntent(request.message);
  if (!hasIntent) {
    const alreadyDiscussed = await hasEverDiscussedArchery(guestDbId).catch(() => false);
    if (!alreadyDiscussed) return null;
  }

  const customerType = interpretCustomerType(request.message);
  const goal = interpretActivityGoal(request.message);

  if (goal === 'photo_only' && /ธนู/u.test(request.message)) {
    return {
      message: 'ได้เลยครับ 😊 ถ่ายรูปกับธนูได้โดยไม่ต้องยิงเลยครับ ทีมงานช่วยดูแลความปลอดภัยระหว่างถ่ายรูปให้ครับ',
      intent: 'information', contextUpdates: {}, journeyAction: { type: 'none', journey: null },
      suggestedActions: [], responseStyle: 'direct', semanticMemoryUpdates: [], toolCalls: [],
    };
  }

  if (customerType?.kind === 'child') {
    await markArcheryIntentStarted(guestDbId, channel);
    const ageLabel = customerType.ageYears ? `${customerType.ageYears} ขวบ` : null;
    return {
      message: [
        `เข้าใจครับ${ageLabel ? ` เด็ก ${ageLabel}` : ''} ทองไทยแนะนำให้ทีมงานสอนวิธีจับธนูและกติกาความปลอดภัยก่อนเริ่มเสมอครับ 😊`,
        'ผู้ปกครองอยู่ดูใกล้ ๆ ได้เลยครับ ทองไทยไม่ขอการันตีความปลอดภัย 100% แต่ทีมจะดูแลอย่างใกล้ชิดครับ',
      ].join('\n'),
      intent: 'information', contextUpdates: {}, journeyAction: { type: 'none', journey: null },
      suggestedActions: [], responseStyle: 'direct', semanticMemoryUpdates: [], toolCalls: [],
    };
  }

  const health = interpretHealthConcerns(request.message);
  const hasShoulderOrArmConcern = health.shoulder === true;
  const experience = interpretExperience(request.message);

  if (hasShoulderOrArmConcern) {
    return {
      message: [
        'เข้าใจครับ ถ้าไหล่ไม่ค่อยสะดวก ทองไทยแนะนำให้แจ้งทีมงานก่อนเริ่มนะครับ ทีมจะช่วยดูท่าและปรับความหนักของธนูให้เหมาะกับไหล่ได้ครับ',
        'ไม่ต้องฝืนถ้าไม่ไหวนะครับ ลองแค่ไม่กี่ดอกก่อนก็ได้ครับ 😊',
      ].join('\n'),
      intent: 'information',
      contextUpdates: {},
      journeyAction: { type: 'none', journey: null },
      suggestedActions: [],
      responseStyle: 'direct',
      semanticMemoryUpdates: [],
      toolCalls: [],
    };
  }

  if (experience === 'beginner') {
    await markArcheryIntentStarted(guestDbId, channel);
    return {
      message: 'ได้เลยครับ 😊 ทีมงานจะสอนวิธีจับธนูและท่ายิงพื้นฐานก่อนเริ่มเสมอครับ ไม่ต้องกังวลนะครับ',
      intent: 'information', contextUpdates: {}, journeyAction: { type: 'none', journey: null },
      suggestedActions: [], responseStyle: 'direct', semanticMemoryUpdates: [], toolCalls: [],
    };
  }

  return null;
}

// Homestay (เฮือนสเตย์) -- a NEW, minimal domain responder using the real
// owner-provided facts in _tamma-domain-knowledge.ts's HOMESTAY_FACTS
// (house/room-type counts, check-in/out times, room-service hours,
// booking window, final-confirmation channels). Deliberately answers ONLY
// what those static facts cover -- room COUNT and TYPE MIX, check-in/out
// timing -- and NEVER invents night-by-night availability, which changes
// daily and has no data source here; that question always gets an honest
// "team confirms" answer instead of a guess. No dedicated booking-task
// flow (matching ATV/archery's minimal-responder precedent, not horse
// riding's deeper existing infrastructure).
const HOMESTAY_INTENT_MARKER = /อยากพัก|มีที่พักไหม|เฮือนสเตย์|เช็กอิน|เช็คอิน|เช็กเอาท์|เช็คเอาท์|ห้องนอน|พักที่นี่/u;
const HOMESTAY_ROOM_COUNT_QUESTION = /กี่ห้องนอน|บ้านกี่ห้อง|มีบ้านกี่/u;
const HOMESTAY_CHECKIN_QUESTION = /เช็กอิน|เช็คอิน|เช็กเอาท์|เช็คเอาท์|ดึกได้ไหม/u;
const HOMESTAY_AVAILABILITY_QUESTION = /ว่างไหม|คืนนี้ว่าง|วันนี้ว่าง|มีห้องว่าง/u;

export function hasExplicitHomestayIntent(text: string): boolean {
  return HOMESTAY_INTENT_MARKER.test(text);
}

export function homestayFactsResponse(request: BrainRequest): BrainResponse | null {
  if (!hasExplicitHomestayIntent(request.message)) return null;

  const facts = HOMESTAY_FACTS;
  let message: string;

  if (HOMESTAY_AVAILABILITY_QUESTION.test(request.message)) {
    message = `ขอโทษนะครับ ทองไทยไม่มีข้อมูลห้องว่างแบบเรียลไทม์ตรงนี้ครับ ${facts.bookingWindowTh} และ${facts.finalConfirmationChannelsTh} ทองไทยช่วยเริ่มจองเบื้องต้นให้ได้เลยครับ`;
  } else if (HOMESTAY_ROOM_COUNT_QUESTION.test(request.message)) {
    message = `ที่เฮือนสเตย์มีทั้งหมด ${facts.totalHouses} หลังครับ แบบ 2 ห้องนอน ${facts.twoBedroomHouses} หลัง และแบบ 1 ห้องนอน ${facts.oneBedroomHouses} หลัง\nพักกี่คน แล้วต้องการกี่คืนครับ?`;
  } else if (HOMESTAY_CHECKIN_QUESTION.test(request.message)) {
    message = `${facts.checkInByTh} และ${facts.checkOutByTh}ครับ ถ้ามาถึงดึกกว่านั้นต้องแจ้งทีมงานล่วงหน้านะครับ ${facts.finalConfirmationChannelsTh}`;
  } else {
    const customerType = interpretCustomerType(request.message);
    const careNote = customerType?.kind === 'elderly'
      ? 'ทองไทยจะช่วยเลือกห้องที่เดินทางสะดวกให้นะครับ 🙏 '
      : customerType?.kind === 'child'
        ? 'พาเด็กเล็กมาพักได้ครับ 😊 '
        : '';
    message = `${careNote}ขอถามก่อนนะครับ พักวันไหน กี่คน แล้วกี่คืนครับ? (${facts.checkInByTh}, ${facts.checkOutByTh})`;
  }

  return {
    message,
    intent: 'information',
    contextUpdates: {},
    journeyAction: { type: 'none', journey: null },
    suggestedActions: [],
    responseStyle: 'direct',
    semanticMemoryUpdates: [],
    toolCalls: [],
  };
}

// Ecosystem / first-time-visitor -- a NEW, narrowly-scoped responder for
// the owner's exact "3-path" opener (สายชิล/สายกิจกรรม/สายพัก, see
// _tamma-domain-knowledge.ts's ECOSYSTEM_PATHS) plus two ecosystem-level
// (no specific business unit named) care/weather scenarios that
// previously fell through to the generic "no verified info" apology.
// Deliberately does NOT touch _experience-discovery.ts (marked LEGACY
// COMPATIBILITY FALLBACK ONLY, "MUST NOT be expanded") -- this is a
// separate, higher-precedence responder for the specific shapes below;
// _experience-discovery.ts's own broader discovery patterns still own
// everything this doesn't claim.
const FIRST_VISIT_RECOMMEND_MARKER = /(?:มาครั้งแรก|ครั้งแรก).*(?:มีอะไรแนะนำ|แนะนำอะไร|แนะนำ)/u;
// Production regression fix (Phase 2): a truly BARE "มีอะไรแนะนำ" (no
// "ครั้งแรก" context, no other domain anchor) had NO deterministic
// coverage at all -- a real, known gap flagged in THONGTHAI_HANDOFF.md's
// Phase 1 entry and deferred at the time. It falls through everything to
// the One-Mind/LLM path, which in production returned the generic
// "clarify" fallback instead of using a remembered mobility need --
// exactly the failure the owner's retest caught. Deliberately narrow
// (anchored to the WHOLE message, so it never claims a longer message
// like "ร้านอาหารมีอะไรแนะนำ", which the restaurant responder already
// owns) and deliberately only fires when guest memory actually has
// something to shape the answer with -- see the guestContext.constraints
// check below. A bare "มีอะไรแนะนำ" with NO memory signal is still left
// to the existing fallback; building the full first-time-visitor 3-path
// pitch for every anonymous "มีอะไรแนะนำ" remains out of scope here.
const BARE_RECOMMEND_MARKER = /^(?:มีอะไรแนะนำ|แนะนำอะไรดี|แนะนำอะไรบ้าง)(?:ครับ|คะ|ค่ะ)?[\s?？!.]*$/u;
const ECOSYSTEM_RAIN_WHERE_MARKER = /ฝนตก.*(?:ไปไหนดี|ที่ไหนดี|ไปที่ไหน)/u;

function experienceNames(ids: string[], limit = 2): string[] {
  const wanted = new Set(ids);
  return EXPERIENCES
    .filter(item => wanted.has(item.id))
    .map(item => item.name)
    .slice(0, limit);
}

function ecosystemPersonalizationHints(request: BrainRequest): string[] {
  const hints: string[] = [];
  const constraints = new Set(request.guestContext.constraints ?? []);

  if (constraints.has('child_friendly') || request.guestContext.travelerType === 'family') {
    hints.push('ถ้ายังมากับครอบครัวหรือมีเด็กด้วย ทองไทยจะเน้นจังหวะไม่เร่ง และให้ทีมช่วยประเมินกิจกรรมให้เหมาะกับแต่ละคนครับ');
  } else if (request.guestContext.travelerType === 'couple') {
    hints.push('ถ้ายังมากับแฟนอยู่ แนวคาเฟ่ + อาหาร + ชมพระอาทิตย์ตกก็จัดเป็นทริปคู่แบบสบาย ๆ ได้ครับ');
  }

  if (request.guestContext.pace === 'relaxed') {
    hints.push('ถ้ายังอยากชิล ๆ อยู่ ทองไทยจะวางคาเฟ่ / อาหาร / พักเป็นแกนก่อน แล้วค่อยเติมกิจกรรมตามแรงและเวลาครับ');
  }

  const favoriteNames = experienceNames(request.journeyContext.favorites ?? []);
  if (favoriteNames.length) {
    hints.push(`ถ้ายังชอบ ${favoriteNames.join(' / ')} อยู่ ทองไทยเอาไว้เป็นจุดตั้งต้นของรอบนี้ได้ครับ`);
  }

  const visitedNames = experienceNames(request.journeyContext.visitedExperiences ?? []);
  if (visitedNames.length) {
    hints.push(`ถ้าอยากไม่ซ้ำจุดที่เคยแวะอย่าง ${visitedNames.join(' / ')} รอบนี้ทองไทยช่วยข้ามแล้วจัดอย่างอื่นให้ได้ครับ`);
  }

  return hints;
}

export function ecosystemFirstVisitResponse(request: BrainRequest): BrainResponse | null {
  const message = request.message;

  if (FIRST_VISIT_RECOMMEND_MARKER.test(message)) {
    // Master Roadmap Phase 2 -- non-creepy personalization: a
    // remembered mobility need (guestContext.constraints, re-hydrated
    // from guest_memory by loadCustomerMemory at the top of
    // processThongthaiChatCore) softly shapes THIS reply, never a
    // timestamped "you told me before" callback (see
    // THONGTHAI_HANDOFF.md's "Master Roadmap Phase 2" entry for the
    // exact good/bad wording contrast this follows).
    if (request.guestContext.constraints?.includes('limited_walking')) {
      return {
        message: 'ถ้ามากับคุณแม่เหมือนเดิม ทองไทยแนะนำแบบเดินน้อยก่อนนะครับ 😊\nอยากเน้นกินข้าว คาเฟ่ หรือกิจกรรมเบา ๆ ครับ?',
        intent: 'information', contextUpdates: {}, journeyAction: { type: 'none', journey: null },
        suggestedActions: [], responseStyle: 'direct',
        agentStateUpdate: {
          activeTopic: 'ecosystem',
          unresolvedNeed: 'choose_food_cafe_or_light_activity',
          pendingQuestion: ECOSYSTEM_FOCUS_PENDING_QUESTION,
        },
        semanticMemoryUpdates: [], toolCalls: [],
      };
    }
    const personalization = ecosystemPersonalizationHints(request);
    return {
      message: [
        'ถ้ามาครั้งแรก ทองไทยแนะนำให้ดูเป็น 3 แบบครับ 😊',
        ...ECOSYSTEM_PATHS.map((path, index) => `${index + 1}) ${path.labelTh}: ${path.descriptionTh}`),
        ...(personalization.length ? ['', ...personalization] : []),
        '',
        'ขอถามนิดนึงครับ มากี่คน แล้วอยากได้ชิล ๆ หรือมีกิจกรรมด้วยครับ?',
      ].join('\n'),
      intent: 'information', contextUpdates: {}, journeyAction: { type: 'none', journey: null },
      suggestedActions: [], responseStyle: 'direct',
      agentStateUpdate: {
        activeTopic: 'ecosystem',
        unresolvedNeed: 'choose_ecosystem_path',
        pendingQuestion: ECOSYSTEM_PATH_PENDING_QUESTION,
      },
      semanticMemoryUpdates: [], toolCalls: [],
    };
  }

  if (BARE_RECOMMEND_MARKER.test(message.trim())) {
    if (request.guestContext.constraints?.includes('limited_walking')) {
      return {
        message: 'ถ้ามากับคุณแม่เหมือนเดิม ทองไทยแนะนำแบบเดินน้อยก่อนนะครับ 😊\nอยากเน้นกินข้าว คาเฟ่ หรือกิจกรรมเบา ๆ ครับ?',
        intent: 'information', contextUpdates: {}, journeyAction: { type: 'none', journey: null },
        suggestedActions: [], responseStyle: 'direct',
        agentStateUpdate: {
          activeTopic: 'ecosystem',
          unresolvedNeed: 'choose_food_cafe_or_light_activity',
          pendingQuestion: ECOSYSTEM_FOCUS_PENDING_QUESTION,
        },
        semanticMemoryUpdates: [], toolCalls: [],
      };
    }
    const restaurantConstraintKeys = new Set([
      'vegetarian','no_spicy','mild_spice','no_pork','no_beef','no_chicken','no_fish','no_egg',
      'no_plara','no_peanut','no_shrimp','peanut_allergy','shrimp_allergy','fish_allergy','egg_allergy',
      'food_allergy','authentic_isan',
    ]);
    if ((request.guestContext.constraints ?? []).some(item => restaurantConstraintKeys.has(item))) {
      return null;
    }
    const personalization = ecosystemPersonalizationHints(request);
    return {
      message: [
        'ถ้ายังไม่ได้ล็อกว่าอยากทำอะไร ทองไทยแนะนำให้เลือกฟีลก่อนครับ 😊',
        ...ECOSYSTEM_PATHS.map((path, index) => `${index + 1}) ${path.labelTh}: ${path.descriptionTh}`),
        ...(personalization.length ? ['', ...personalization] : []),
        '',
        'มากี่คน แล้วอยากได้ชิล ๆ หรือมีกิจกรรมด้วยครับ?',
      ].join('\n'),
      intent: 'information', contextUpdates: {}, journeyAction: { type: 'none', journey: null },
      suggestedActions: [], responseStyle: 'direct',
      agentStateUpdate: {
        activeTopic: 'ecosystem',
        unresolvedNeed: 'choose_ecosystem_path',
        pendingQuestion: ECOSYSTEM_PATH_PENDING_QUESTION,
      },
      semanticMemoryUpdates: [], toolCalls: [],
    };
  }

  if (ECOSYSTEM_RAIN_WHERE_MARKER.test(message)) {
    const indoorLabels = INDOOR_FRIENDLY_BUSINESS_UNITS.map(id => ({
      'thamma-chat-restaurant': 'ตำมา-ชาติ (ร้านอาหาร)',
      inthanin: 'Inthanin (คาเฟ่)',
      'thamma-chat-stay': 'ทำมา-ชาติ เฮือนสเตย์',
    } as Record<string, string>)[id] ?? id);
    return {
      message: `ฝนตกแนะนำแวะที่ร่มก่อนครับ 😊 ${indoorLabels.join(' / ')} เดี๋ยวรอฝนซาแล้วค่อยดูกิจกรรมกลางแจ้งอีกทีได้ครับ`,
      intent: 'information', contextUpdates: {}, journeyAction: { type: 'none', journey: null },
      suggestedActions: [], responseStyle: 'direct', semanticMemoryUpdates: [], toolCalls: [],
    };
  }

  const customerType = interpretCustomerType(message);
  const lowWalking = prefersLowWalking(message);
  // Defers to _service-mind-care-context.ts's classifyCareContext when IT
  // already recognizes the message (its own bounded ELDERLY_COMPANION_
  // MARKER/MOBILITY_MARKER) -- that existing responder gives a more
  // specific reply (e.g. a real follow-up mobility question) for the
  // phrasings it covers. This branch exists only for the phrasings it
  // does NOT cover (e.g. "พาแม่ไป" instead of "พาแม่มา", "เดินน้อย" instead
  // of "ไม่อยากเดินเยอะ") -- confirmed via classifyCareContext returning
  // null for those exact real gaps.
  if (customerType && lowWalking && !classifyCareContext(message)
    && !hasExplicitHorseBookingIntent(message) && !hasExplicitAtvIntent(message)
    && !hasExplicitArcheryIntent(message) && !hasExplicitHomestayIntent(message)) {
    const who = customerType.kind === 'elderly' ? 'ผู้ใหญ่' : 'เด็ก';
    return {
      message: `เข้าใจครับ พา${who}มาด้วยและอยากเดินน้อย ๆ ใช่ไหมครับ 😊 ทองไทยแนะนำแนวคาเฟ่ + ร้านอาหาร + ชมวิวใกล้ ๆ ก่อน ไม่ต้องเดินไกลครับ\nมากี่คน แล้วมีเวลาประมาณเท่าไหร่ครับ?`,
      intent: 'information', contextUpdates: {}, journeyAction: { type: 'none', journey: null },
      suggestedActions: [], responseStyle: 'direct', semanticMemoryUpdates: [], toolCalls: [],
    };
  }

  return null;
}

const ECOSYSTEM_FOCUS_PENDING_QUESTION: PendingQuestionState = {
  domain: 'general_recommendation',
  kind: 'preference_choice',
  choices: [
    { value: 'restaurant', aliases: ['กินข้าว', 'อาหาร', 'ของกิน', 'กินก่อน', 'เน้นกิน', 'เน้นอาหาร', 'หิว'] },
    { value: 'cafe', aliases: ['คาเฟ่', 'กาแฟ', 'เครื่องดื่ม', 'นั่งคาเฟ่'] },
    { value: 'light_activity', aliases: ['กิจกรรมเบา', 'ทำอะไรเบา', 'ขยับเบา', 'ชมวิว', 'กิจกรรม'] },
  ],
};

const ECOSYSTEM_PATH_PENDING_QUESTION: PendingQuestionState = {
  domain: 'general_recommendation',
  kind: 'preference_choice',
  choices: [
    { value: 'ecosystem_chill', aliases: ['สายชิล', 'ชิล', 'ชิล ๆ', 'ชิลๆ', 'คาเฟ่', 'ถ่ายรูป'] },
    { value: 'ecosystem_activity', aliases: ['สายกิจกรรม', 'กิจกรรม', 'สายลุย', 'ลุย', 'อยากลุย'] },
    { value: 'ecosystem_stay', aliases: ['สายพัก', 'พัก', 'ค้างคืน', 'เฮือนสเตย์', 'ที่พัก'] },
  ],
};

function isExplicitSwitchAwayFromPendingQuestion(
  request: BrainRequest,
  pending: PendingQuestionState,
): boolean {
  // A pending general-recommendation refinement must never capture a clear
  // new domain. The pending answer matcher itself is data-driven from the
  // choices persisted by the question producer.
  if (pending.domain !== 'general_recommendation') return false;
  const intent = classifyTopLevelSemanticIntent(request.message);
  if (intent === 'LOCATION_REQUEST' || intent === 'WEATHER_REQUEST'
    || intent === 'BOT_ADDRESS' || intent === 'HORSE_RELATED') return true;

  const cafeText = request.message.trim();
  const specificCafeFactQuestion = CAFE_EXPLICIT_MARKER.test(cafeText)
    && /(?:มี|เมนู|ราคา|กี่บาท|เท่าไหร่|เท่าไร|เปิด|ปิด|กี่โมง|เวลา)/u.test(cafeText);
  if (specificCafeFactQuestion) return true;

  return hasExplicitAtvIntent(request.message)
    || hasExplicitArcheryIntent(request.message)
    || hasExplicitHomestayIntent(request.message);
}

async function pendingQuestionContinuationResponse(
  request: BrainRequest,
  guestDbId: string | null,
  channel: BrainChannel,
): Promise<BrainResponse | null> {
  if (!guestDbId) return null;

  const snapshot = await loadGuestAgentStateSnapshot(guestDbId).catch(error => {
    console.error(
      'THONGTHAI_PENDING_QUESTION_STATE_ERROR',
      error instanceof Error ? error.message.slice(0, 220) : 'unknown',
    );
    return { state: null } as Awaited<ReturnType<typeof loadGuestAgentStateSnapshot>>;
  });
  if (!isObject(snapshot.state)) return null;

  const pending = normalizePendingQuestion(snapshot.state.pending_question);
  if (!pending) return null;

  // A clear new domain wins even if its sentence happens to contain one
  // of the old choice labels (e.g. "ขอโลเคชั่นคาเฟ่"). Only a pending
  // question from THAT domain should be allowed to consume such a turn.
  if (isExplicitSwitchAwayFromPendingQuestion(request, pending)) {
    await patchGuestAgentState(guestDbId, { removeKeys: ['pending_question'] }).catch(error => {
      console.error(
        'THONGTHAI_PENDING_QUESTION_CLEAR_ERROR',
        error instanceof Error ? error.message.slice(0, 220) : 'unknown',
      );
      return false;
    });
    return null;
  }

  const resolution = resolvePendingQuestionAnswer(request.message, pending);
  if (!resolution) return null;

  if (resolution.domain !== 'general_recommendation'
      || resolution.kind !== 'preference_choice'
      || typeof resolution.value !== 'string') return null;

  if (resolution.value === 'ecosystem_chill') {
    return {
      message: 'สายชิลได้เลยครับ 😊 แนะนำฟีลคาเฟ่ + ถ่ายรูป + อาหารก่อนครับ แล้วค่อยต่ออย่างอื่นตามเวลาได้\nมากี่คน แล้วมีเวลาประมาณเท่าไหร่ครับ?',
      intent: 'recommendation',
      contextUpdates: {},
      journeyAction: { type: 'none', journey: null },
      suggestedActions: [],
      responseStyle: 'direct',
      agentStateUpdate: {
        activeTopic: 'ecosystem',
        clearUnresolvedNeed: true,
        clearPendingQuestion: true,
      },
      semanticMemoryUpdates: [],
      toolCalls: [],
    };
  }

  if (resolution.value === 'ecosystem_activity') {
    return {
      message: 'สายกิจกรรมได้เลยครับ 😊 ที่ทำมา-ชาติมีขี่ม้า / ATV / ยิงธนูครับ\nอยากเริ่มจากอันไหนก่อนครับ เดี๋ยวทองไทยช่วยดูรายละเอียดให้ต่อ',
      intent: 'recommendation',
      contextUpdates: {},
      journeyAction: { type: 'none', journey: null },
      suggestedActions: [],
      responseStyle: 'direct',
      agentStateUpdate: {
        activeTopic: 'activity_discovery',
        clearUnresolvedNeed: true,
        clearPendingQuestion: true,
      },
      semanticMemoryUpdates: [],
      toolCalls: [],
    };
  }

  if (resolution.value === 'ecosystem_stay') {
    return {
      message: 'สายพักได้เลยครับ 😊 มีทำมา-ชาติ เฮือนสเตย์ + บรรยากาศธรรมชาติครับ\nมากี่คน และอยากพักกี่คืนครับ เดี๋ยวทองไทยช่วยต่อให้โดยไม่เดาห้องว่าง',
      intent: 'recommendation',
      contextUpdates: {},
      journeyAction: { type: 'none', journey: null },
      suggestedActions: [],
      responseStyle: 'direct',
      agentStateUpdate: {
        activeTopic: 'stay',
        clearUnresolvedNeed: true,
        clearPendingQuestion: true,
      },
      semanticMemoryUpdates: [],
      toolCalls: [],
    };
  }

  if (resolution.value === 'restaurant') {
    const advice = await restaurantMenuAdvice({
      query: 'ร้านอาหารมีอะไรแนะนำ',
      partySize: null,
      budget: typeof request.guestContext.budget === 'number' ? request.guestContext.budget : null,
      constraints: request.guestContext.constraints,
      recentMessages: [],
    });

    const selection = advisorRecommendationSelection(
      advice,
      false,
      'ร้านอาหารมีอะไรแนะนำ',
      [],
    );
    const shownRecommendationNames = selection.shown
      .map((row: any) => typeof row?.name === 'string' ? row.name.trim() : '')
      .filter(Boolean);

    if (Array.isArray(advice?.recommendations) && advice.recommendations.length) {
      return {
        message: formatAdvisorMessage(
          advice,
          false,
          false,
          'ร้านอาหารมีอะไรแนะนำ',
          [],
        ),
        intent: 'recommendation',
        contextUpdates: {},
        journeyAction: { type: 'none', journey: null },
        suggestedActions: [],
        responseStyle: 'direct',
        agentStateUpdate: {
          activeTopic: 'restaurant',
          clearUnresolvedNeed: true,
          clearPendingQuestion: true,
          restaurantAdvisorContext: {
            source: RESTAURANT_ADVISOR_CONTEXT_SOURCE,
            recentMessages: ['ร้านอาหารมีอะไรแนะนำ'],
            recentRecommendationNames: shownRecommendationNames,
            updatedAt: new Date().toISOString(),
          },
        },
        semanticMemoryUpdates: [],
        toolCalls: [],
      };
    }

    return {
      message: composeFoodIntentStartResponse(),
      intent: 'recommendation',
      contextUpdates: {},
      journeyAction: { type: 'none', journey: null },
      suggestedActions: [],
      responseStyle: 'direct',
      agentStateUpdate: {
        activeTopic: 'restaurant',
        clearUnresolvedNeed: true,
        clearPendingQuestion: true,
      },
      semanticMemoryUpdates: [],
      toolCalls: [],
    };
  }

  if (resolution.value === 'cafe') {
    return {
      message: 'ได้ครับ 😊 งั้นเน้นคาเฟ่ก่อน แวะ Inthanin นั่งพัก เดินน้อย แล้วค่อยชมวิวใกล้ ๆ ได้ครับ\nอยากได้กาแฟ ชา หรือเครื่องดื่มไม่กาแฟครับ?',
      intent: 'recommendation',
      contextUpdates: {},
      journeyAction: { type: 'none', journey: null },
      suggestedActions: [],
      responseStyle: 'direct',
      agentStateUpdate: {
        activeTopic: 'cafe',
        clearUnresolvedNeed: true,
        clearPendingQuestion: true,
      },
      semanticMemoryUpdates: [],
      toolCalls: [],
    };
  }

  if (resolution.value === 'light_activity') {
    return {
      message: 'ได้ครับ 😊 ถ้าอยากทำอะไรเบา ๆ และเดินน้อย ทองไทยช่วยคัดต่อให้ได้ครับ\nอยากลองขี่ม้า ยิงธนู หรือเอาแบบนั่งพักชมวิวก่อนครับ?',
      intent: 'recommendation',
      contextUpdates: {},
      journeyAction: { type: 'none', journey: null },
      suggestedActions: [],
      responseStyle: 'direct',
      agentStateUpdate: {
        activeTopic: 'activity_discovery',
        clearUnresolvedNeed: true,
        clearPendingQuestion: true,
      },
      semanticMemoryUpdates: [],
      toolCalls: [],
    };
  }

  return null;
}

export function activityBookingFallbackDraft(request: BrainRequest): Record<string, unknown> | null {
  // Whole-sentence intent wins over stale horse history/entity tokens. A
  // location/weather/bot-address turn must never be consumed as a horse
  // continuation merely because "ทองไทย" is also a horse name or because an
  // old activity task exists.
  if (topLevelIntentBlocksHorseTokenRouting(classifyTopLevelSemanticIntent(request.message))) return null;
  const userTurns = request.chatHistory.filter(turn => turn.role === 'user').map(turn => turn.content).concat(request.message);
  const text = userTurns.join('\n');
  // The CURRENT message's own explicit horse name always wins over
  // anything named earlier in the conversation. Real production incident
  // this closes: activityAssetFromText(text) scans the WHOLE joined
  // history, and ACTIVITY_ASSET_SELECTIONS' array-declaration order (not
  // recency, not the current turn) decided the winner whenever BOTH
  // horses had been named at some point ("อยากขี่ม้า" -> "เอาภาราดร" ->
  // "เอาทองไทย" kept re-selecting ภาราดร, since it's declared first in
  // that array and BOTH names are still present in the joined text) --
  // only fall back to scanning the joined history when the CURRENT
  // message itself names no horse at all (e.g. "30 นาที" continuing an
  // already-made selection).
  const selectedAsset = activityAssetFromText(request.message) ?? activityAssetFromText(text);
  if (!selectedAsset) return null;

  // "ทองไทย" is a real, deliberate name collision: the bot's own name AND
  // a horse's name. activityAssetFromText matches it purely on lexical
  // grounds, so a message about THONGTHAI'S OWN ANSWERS ("ทองไทยตอบยาวไป")
  // must never be read as selecting the horse -- checked first, and wins
  // regardless of any other signal below (see
  // _service-mind-feedback-intent.ts's THONGTHAI_RESPONSE_MENTION, the
  // SAME closed marker set the feedback classifier itself uses, so the
  // two paths can never disagree about what counts as "about Thongthai").
  if (mentionsThongthaiResponse(request.message)) return null;

  // A horse info/comparison question ("ทองไทยกับภาราดรต่างกันยังไง") must
  // NEVER be read as selecting/reselecting a horse -- checked BEFORE the
  // context check below on purpose. Real incident this closes: with an
  // ALREADY-OPEN horse-booking task (e.g. ทองไทย selected in an earlier
  // turn), asking to compare the two horses named BOTH of them, and
  // activityAssetFromText matched whichever horse happened to be named
  // LAST in the joined text -- silently re-selecting a DIFFERENT horse
  // than the one already chosen and re-asking for booking details, even
  // though the customer was only asking a question. See
  // _local-concierge-intent.ts's isHorseInfoOrComparisonQuestion, which
  // reuses the SAME classifyLocalConciergeQuestion markers the horse-
  // facts composer itself answers from, so this guard and that composer
  // can never disagree about what counts as a comparison question.
  if (isHorseInfoOrComparisonQuestion(request.message)) return null;

  // A blanket "more than one turn ever exchanged" used to count as horse-
  // booking context on its own -- that's what let an UNRELATED second
  // turn (e.g. a safety complaint followed by unrelated feedback) get
  // misread as continuing a horse selection that was never actually
  // happening. Real context requires the conversation to actually mention
  // riding/horses (bare "ม้า" covers "ขี่ม้า"/"จองม้า"/"อยาก...ม้า" as
  // substrings) or express an explicit intent to ride ("อยากขี่ทองไทย" --
  // naming a specific horse instead of the word "ม้า"). Deliberately NOT
  // a bare "ขี่" alone -- that also matches a horse-FACTS question like
  // "ทองไทยขี่ยังไง" (how does it ride), which must reach the horse-facts
  // composer, not this booking fallback.
  const hasHorseBookingContext = /ขี่ม้า|จองม้า|อยาก.*ม้า|ม้า|อยากขี่/u.test(text) || activityFallbackCommit(request.message);
  if (!hasHorseBookingContext) return null;

  const date = extractDate(text) ?? extractThaiMonthDate(text);
  const time = extractTime(text);
  const durationMinutes = extractDurationMinutes(text);
  const partySize = extractPartySize(text);
  const customerName = activityFallbackName(userTurns);
  const phone = activityFallbackPhone(text);

  return {
    serviceType: 'activity',
    resourceCode: 'activity-horse',
    horseName: selectedAsset.name,
    note: formatActivityAssetNote(selectedAsset),
    ...(date ? { date } : {}),
    ...(time ? { time } : {}),
    ...(durationMinutes ? { durationMinutes } : {}),
    ...(partySize ? { partySize } : {}),
    ...(customerName ? { customerName } : {}),
    ...(phone ? { phone } : {}),
  };
}

function missingActivityFallbackFields(draft: Record<string, unknown>): string[] {
  const missing: string[] = [];
  if (!draft.date) missing.push('วันที่');
  if (!draft.time) missing.push('เวลา');
  if (!draft.durationMinutes) missing.push('ระยะเวลา');
  if (!draft.partySize) missing.push('จำนวนผู้ขี่');
  if (!draft.customerName) missing.push('ชื่อผู้จอง');
  if (!draft.phone) missing.push('เบอร์โทร');
  return missing;
}


export function activityPrepareOnlyToolArgs(
  draft: Record<string, unknown>,
): Record<string, unknown> | null {
  // Prepare mode needs only the fields consumed by prepare_activity_booking.
  // Legacy activity execution additionally expects resourceCode, but the
  // prepare tool resolves the canonical horse resource itself. Reusing the
  // legacy missing-field gate here made complete customer requests fall
  // through to transaction-capable legacy routing.

  const horseName = typeof draft.horseName === 'string' ? draft.horseName.trim() : '';
  const date = typeof draft.date === 'string' ? draft.date.trim() : '';
  const time = typeof draft.time === 'string' ? draft.time.trim() : '';
  const durationMinutes = Number(draft.durationMinutes);
  const partySize = Number(draft.partySize);
  const customerName = typeof draft.customerName === 'string' ? draft.customerName.trim() : '';
  const phone = typeof draft.phone === 'string' ? draft.phone.trim() : '';
  if (!horseName || !date || !time || !Number.isInteger(durationMinutes)
      || !Number.isInteger(partySize) || !customerName || !phone) return null;
  return {
    activity_code: 'horse',
    asset_name: horseName,
    date,
    time,
    duration_minutes: durationMinutes,
    party_size: partySize,
    customer_name: customerName,
    phone,
  };
}

function displayHorseName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim().replace(/^น้อง/u, '') : '';
  return name ? `น้อง${name}` : 'ม้าที่เลือก';
}

export function composeActivityPrepareOnlyResponse(
  value: Record<string, unknown>,
  confirmedTurn = false,
): BrainResponse | null {
  if (value.ok !== true || value.prepared !== true) return null;
  const summary = value.summary && typeof value.summary === 'object' && !Array.isArray(value.summary)
    ? value.summary as Record<string, unknown>
    : {};
  if (confirmedTurn) {
    return {
      message:'รับการยืนยันแล้วครับ แต่ตอนนี้ระบบยังไม่เปิดให้ส่งคำขอจองจริง รายการยังเป็นแบบร่างและยังไม่มีการสร้างการจองครับ',
      intent:'booking',
      contextUpdates:{},
      journeyAction:{type:'none',journey:null},
      suggestedActions:[],
      responseStyle:'direct',
      semanticMemoryUpdates:[],
      toolCalls:[],
    };
  }
  const exactPhrase = typeof value.exact_confirmation_phrase_th === 'string'
    && value.exact_confirmation_phrase_th.trim()
    ? value.exact_confirmation_phrase_th.trim()
    : 'ยืนยันจอง';
  const details = [
    `เตรียมรายการจองไว้แล้วครับ (ยังไม่ได้ส่งจองจริง)`,
    `• ขี่ม้า: ${displayHorseName(summary.asset)}`,
    summary.date ? `• วันที่ ${summary.date}${summary.time ? ` เวลา ${summary.time}` : ''}` : '',
    summary.duration_minutes ? `• ${summary.duration_minutes} นาที · ${summary.party_size ?? 1} ท่าน` : '',
    summary.expected_price != null ? `• ราคา ${summary.expected_price} บาท` : '',
    summary.customer_name ? `• ชื่อ ${summary.customer_name}${summary.phone ? ` · โทร ${summary.phone}` : ''}` : '',
    `หากรายละเอียดถูกต้อง พิมพ์ “${exactPhrase}” ครับ`,
  ].filter(Boolean);
  return {
    message:details.join('\n'),
    intent:'booking',
    contextUpdates:{},
    journeyAction:{type:'none',journey:null},
    suggestedActions:[],
    responseStyle:'direct',
    semanticMemoryUpdates:[],
    toolCalls:[],
  };
}

async function prepareOnlyActivityFastPath(
  request: BrainRequest,
  guestDbId: string,
  channel: BrainChannel,
  eventId: string,
): Promise<BrainResponse | null> {
  const context = {
    guestDbId,
    channel,
    environment:'live' as const,
    eventId,
    message:request.message,
    transactionMode:'prepare' as const,
  };

  // A later explicit confirmation in Gate 0 only re-reads the draft. Commit
  // tools are absent and the prepare runtime independently rejects commits.
  if (hasCommitMarker(request.message)) {
    const raw = await executeThongthaiTransactionTool('get_prepared_activity_booking', {}, context);
    let value: Record<string, unknown> = {};
    try { value = JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
    const response = composeActivityPrepareOnlyResponse(value, true);
    if (response) return response;
  }

  const draft = activityBookingFallbackDraft(request);
  const args = draft ? activityPrepareOnlyToolArgs(draft) : null;
  if (!args || !hasStandaloneTransactionRequest(request.message)) return null;

  const raw = await executeThongthaiTransactionTool('prepare_activity_booking', args, context);
  let value: Record<string, unknown> = {};
  try { value = JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
  return composeActivityPrepareOnlyResponse(value, false);
}

function activityBookingFallbackPrompt(request: BrainRequest): BrainResponse | null {
  const draft = activityBookingFallbackDraft(request);
  if (!draft) return null;
  if (authorizedActivityBookingCommit(request)) return null;
  const missing = missingActivityFallbackFields(draft);
  const horseName = String(draft.horseName);
  const summary = [
    `เลือกม้า: ${horseName}`,
    draft.date ? `วันที่: ${draft.date}` : '',
    draft.time ? `เวลา: ${draft.time}` : '',
    draft.durationMinutes ? `ระยะเวลา: ${draft.durationMinutes} นาที` : '',
    draft.partySize ? `จำนวนผู้ขี่: ${draft.partySize} คน` : '',
    draft.customerName ? `ชื่อ: ${draft.customerName}` : '',
  ].filter(Boolean);
  return {
    message: missing.length
      ? [`รับทราบครับ ผมล็อกตัวเลือกเป็น ${horseName} ไว้ในบทสนทนานี้`, ...summary, `ขอเพิ่มอีกนิดครับ: ${missing.join(', ')}`].join('\n')
      : [`สรุปคำขอจองขี่ม้า ${horseName}`, ...summary, `ถ้าถูกต้อง พิมพ์ “ยืนยัน” ${ACTIVITY_BOOKING_CONFIRM_PROMPT_MARKER}`].join('\n'),
    intent: 'booking',
    contextUpdates: {},
    journeyAction: { type: 'none', journey: null },
    suggestedActions: [],
    responseStyle: 'direct',
    semanticMemoryUpdates: [],
    toolCalls: [],
  };
}

async function activityBookingFallbackResponse(
  request: BrainRequest,
  guestDbId: string | null,
  channel: BrainChannel,
): Promise<BrainResponse | null> {
  const draft = activityBookingFallbackDraft(request);
  if (!draft) return null;
  const prompt = activityBookingFallbackPrompt(request);
  if (prompt) return prompt;
  const missing = missingActivityFallbackFields(draft);
  if (missing.length) {
    return {
      message: `ยังส่งคำขอจองไม่ได้ครับ ขอข้อมูลเพิ่มก่อน: ${missing.join(', ')}`,
      intent: 'booking',
      contextUpdates: {},
      journeyAction: { type: 'none', journey: null },
      suggestedActions: [],
      responseStyle: 'direct',
      semanticMemoryUpdates: [],
      toolCalls: [],
    };
  }
  return executeDeterministicActivityBooking(draft, request, guestDbId, channel);
}

export function resolveExplicitStayFallbackArgs(
  message:string,
  resources:ReadonlyArray<{code:string;name:string}>,
  now:Date=new Date(),
):Record<string,unknown>|null {
  if (!hasStandaloneTransactionRequest(message)
      || !/จอง/u.test(message)
      || !/(?:เฮือนสเตย์|โฮมสเตย์|ที่พัก|ห้องนอน)/u.test(message)) return null;
  const normalizedMessage=message.replace(/[\s\-–—_/]/gu,'').toLowerCase();
  const matches=resources.filter(resource => {
    const normalizedName=resource.name.replace(/[\s\-–—_/]/gu,'').toLowerCase();
    return normalizedName.length>=2 && normalizedMessage.includes(normalizedName);
  });
  if(matches.length!==1) return null;
  const range=extractDateRange(message,now);
  const date=range?.date ?? extractDate(message,now);
  const endDate=range?.endDate;
  const partySize=extractPartySize(message);
  const phone=message.match(/(?:เบอร์|โทร)\s*([0-9][0-9\s-]{7,18}[0-9])/u)?.[1]?.replace(/\D/g,'');
  const customerName=message.match(/(?:^|\s)ชื่อ\s*([^,\n]+?)(?=\s*(?:เบอร์|โทร|จำนวน|จอง|ยืนยัน|ส่ง|ครับ|ค่ะ|คะ|$))/u)?.[1]?.trim();
  if(!date||!endDate||!partySize||!phone||!customerName) return null;
  return {
    serviceType:'stay', resourceCode:matches[0]!.code,
    accommodationName:matches[0]!.name, date, endDate, partySize,
    quantity:1, customerName, phone,
    ...(/ผู้สูงอายุ/u.test(message)?{note:'มีผู้สูงอายุร่วมเข้าพัก — กรุณาตรวจสอบการเข้าถึงก่อนยืนยัน'}:{}),
  };
}

async function explicitStayBookingFallback(
  request:BrainRequest,
  guestDbId:string|null,
  channel:BrainChannel,
):Promise<BrainResponse|null> {
  if(!hasStandaloneTransactionRequest(request.message)) return null;
  const resources=await listServiceResources('stay');
  const args=resolveExplicitStayFallbackArgs(request.message,resources);
  return args?executeDeterministicStayBooking(args,request,guestDbId,channel):null;
}

async function executeDeterministicActivityBooking(
  args: Record<string, unknown>,
  request: BrainRequest,
  guestDbId: string | null,
  channel: BrainChannel,
): Promise<BrainResponse> {
  // Human Core PR D: pure execution glue. The canonical asset id/name/note
  // have already been resolved from task.selectedEntities by
  // resolveActivityBookingProposalArgs. This boundary never calls a language
  // parser -- not on request.message and not even on the structured name.
  const horseName = typeof args.horseName === 'string' ? args.horseName : null;
  const selectedHorseName = horseName;
  const note = typeof args.note === 'string' ? args.note : null;

  const firstResponse: BrainResponse = {
    message: '',
    intent: 'booking',
    contextUpdates: {},
    journeyAction: { type: 'none', journey: null },
    suggestedActions: [],
    responseStyle: 'direct',
    semanticMemoryUpdates: [],
    toolCalls: [],
  };
  const [result] = await executeBrainTools(
    guestDbId,
    channel,
    [{
      name: 'create_booking',
      args: {
        serviceType: 'activity',
        ...args,
        ...(note ? { note } : {}),
      },
    }],
    firstResponse,
    request,
  );
  if (!result?.ok) {
    return {
      ...firstResponse,
      message: 'ยังส่งคำขอจองไม่สำเร็จครับ ลองเลือกวัน เวลา และระยะเวลาอีกครั้ง หรือให้ทีมงานช่วยต่อได้เลยครับ',
    };
  }
  let detail: Record<string, unknown> = {};
  try { detail = JSON.parse(result.detail) as Record<string, unknown>; } catch { /* keep defaults */ }
  const bookingCode = typeof detail.bookingCode === 'string' ? detail.bookingCode : '';
  return {
    ...firstResponse,
    message: [
      'ส่งคำขอจองเข้าระบบแล้วครับ ✅',
      bookingCode ? `เลขที่จอง ${bookingCode}` : '',
      selectedHorseName ? `ม้าที่เลือก: ${selectedHorseName}` : '',
      transactionNotificationMessage(detail),
      'ทีมงานจะยืนยันอีกครั้งทาง LINE / โทร / อีเมล',
    ].filter(Boolean).join('\n'),
  };
}

async function executeDeterministicRestaurantTableBooking(
  args: Record<string, unknown>,
  request: BrainRequest,
  guestDbId: string | null,
  channel: BrainChannel,
): Promise<BrainResponse> {
  // Human Core PR F: Restaurant table booking execution consumes only the
  // Dialog Manager's structured proposal. request is transport context only.
  const date = typeof args.date === 'string' ? args.date.trim() : '';
  const time = typeof args.time === 'string' ? args.time.trim() : '';
  const partySize = Number(args.partySize);
  const customerName = typeof args.customerName === 'string' ? args.customerName.trim() : '';
  const phone = typeof args.phone === 'string' ? args.phone.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)
      || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(time)
      || !Number.isInteger(partySize) || partySize < 1 || partySize > 50
      || !customerName || !phone) {
    return {
      message:'ยังส่งคำขอจองโต๊ะไม่ได้ครับ ข้อมูลวัน เวลา จำนวนคน ชื่อ หรือเบอร์โทรยังไม่ครบ',
      intent:'booking', contextUpdates:{}, journeyAction:{type:'none',journey:null},
      suggestedActions:[], responseStyle:'direct', semanticMemoryUpdates:[], toolCalls:[],
    };
  }

  const firstResponse: BrainResponse = {
    message:'', intent:'booking', contextUpdates:{}, journeyAction:{type:'none',journey:null},
    suggestedActions:[], responseStyle:'direct', semanticMemoryUpdates:[], toolCalls:[],
  };
  const [result] = await executeBrainTools(guestDbId, channel, [{
    name:'create_booking',
    args:{ ...args, serviceType:'restaurant', date, time, partySize, customerName, phone },
  }], firstResponse, request);
  if (!result?.ok) {
    return { ...firstResponse, message:'ยังส่งคำขอจองโต๊ะไม่สำเร็จครับ ระบบยังไม่ยืนยันรอบที่ขอ จึงยังไม่ได้สร้างรายการจอง' };
  }

  let detail: Record<string, unknown> = {};
  try { detail = JSON.parse(result.detail) as Record<string, unknown>; } catch { /* safe copy below */ }
  const bookingCode = typeof detail.bookingCode === 'string' ? detail.bookingCode : '';
  const status = typeof detail.status === 'string' ? detail.status : 'requested';
  return {
    ...firstResponse,
    message:[
      'รับคำขอจองโต๊ะเข้าระบบแล้วครับ ✅',
      bookingCode ? `เลขที่คำขอ ${bookingCode}` : '',
      `${date} เวลา ${time} · ${partySize} ท่าน`,
      status === 'confirmed' ? 'สถานะ: ยืนยันแล้ว' : 'สถานะ: รอทีมงานยืนยัน',
      transactionNotificationMessage(detail),
    ].filter(Boolean).join('\n'),
  };
}

async function executeDeterministicRestaurantPreorder(
  args: Record<string, unknown>,
  request: BrainRequest,
  guestDbId: string | null,
  channel: BrainChannel,
): Promise<BrainResponse> {
  // Human Core PR F: structured-only Restaurant execution. The customer
  // sentence is never parsed here; request is transport context only.
  const items = Array.isArray(args.items)
    ? args.items.flatMap(value => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
        const row = value as Record<string, unknown>;
        const name = typeof row.name === 'string' ? row.name.trim() : '';
        const quantity = Number(row.quantity);
        return name && Number.isInteger(quantity) && quantity >= 1 && quantity <= 50
          ? [{ name, quantity }]
          : [];
      })
    : [];
  const date = typeof args.date === 'string' ? args.date.trim() : '';
  const time = typeof args.time === 'string' ? args.time.trim() : '';
  const customerName = typeof args.customerName === 'string' ? args.customerName.trim() : '';
  const phone = typeof args.phone === 'string' ? args.phone.trim() : '';
  if (!items.length || !/^\d{4}-\d{2}-\d{2}$/u.test(date)
      || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(time)
      || !customerName || !phone) {
    return {
      message:'ยังส่งออเดอร์ไม่ได้ครับ ข้อมูลรายการอาหาร/จำนวน วัน เวลา ชื่อ หรือเบอร์โทรยังไม่ครบ',
      intent:'order', contextUpdates:{}, journeyAction:{type:'none',journey:null},
      suggestedActions:[], responseStyle:'direct', semanticMemoryUpdates:[], toolCalls:[],
    };
  }

  const firstResponse: BrainResponse = {
    message:'', intent:'order', contextUpdates:{}, journeyAction:{type:'none',journey:null},
    suggestedActions:[], responseStyle:'direct', semanticMemoryUpdates:[], toolCalls:[],
  };
  const [result] = await executeBrainTools(guestDbId, channel, [{
    name:'create_restaurant_preorder',
    args:{
      ...args,
      date,
      time,
      items,
      customerName,
      phone,
    },
  }], firstResponse, request);
  if (!result?.ok) {
    return { ...firstResponse, message:'ยังส่งออเดอร์ไม่สำเร็จครับ ระบบร้านตรวจรายการหรือจำนวนที่พร้อมสั่งไม่ผ่าน จึงยังไม่ได้สร้างออเดอร์' };
  }

  let detail: Record<string, unknown> = {};
  try { detail = JSON.parse(result.detail) as Record<string, unknown>; } catch { /* keep safe defaults */ }
  const preorderCode = typeof detail.preorderCode === 'string' ? detail.preorderCode : '';
  const totalAmount = typeof detail.totalAmount === 'number' ? detail.totalAmount : null;
  const createdItems = Array.isArray(detail.items) ? detail.items : [];
  const itemLines = createdItems.flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name : '';
    const quantity = Number(row.quantity);
    return name && Number.isFinite(quantity) ? [`• ${name} × ${quantity}`] : [];
  });
  return {
    ...firstResponse,
    message:[
      'ส่งออเดอร์เข้าระบบแล้วครับ ✅',
      preorderCode ? `เลขออเดอร์ ${preorderCode}` : '',
      ...itemLines,
      totalAmount !== null ? `รวม ${Math.round(totalAmount)} บาท` : '',
      `รับอาหาร ${date} เวลา ${time}`,
      'สถานะ: รอร้านรับออเดอร์',
      transactionNotificationMessage(detail),
    ].filter(Boolean).join('\n'),
  };
}

async function executeDeterministicCafeInquiry(
  args:Record<string,unknown>,
  request:BrainRequest,
  guestDbId:string|null,
  channel:BrainChannel,
):Promise<BrainResponse> {
  // Structured-only operational handoff. This deliberately creates an
  // inquiry, not a cafe sale/order, because Cafe has no verified catalog,
  // stock, price, or checkout source in production today.
  const question=typeof args.question==='string'?args.question.trim():'';
  const customerName=typeof args.customerName==='string'?args.customerName.trim():'';
  const phone=typeof args.phone==='string'?args.phone.trim():'';
  const email=typeof args.email==='string'?args.email.trim():'';
  const firstResponse:BrainResponse={
    message:'',intent:'customer_service',contextUpdates:{},journeyAction:{type:'none',journey:null},
    suggestedActions:[],responseStyle:'direct',semanticMemoryUpdates:[],toolCalls:[],
  };
  if(!question) {
    return {...firstResponse,message:'ยังส่งเรื่องให้ทีมคาเฟ่ไม่ได้ครับ ขอเรื่องที่ต้องการให้ทีมช่วยเพิ่มอีกนิด'};
  }
  const [result]=await executeBrainTools(guestDbId,channel,[{
    name:'create_cafe_inquiry',
    args:{question,...(customerName?{customerName}:{}),...(phone?{phone}:{}),...(email?{email}:{})},
  }],firstResponse,request);
  if(!result?.ok) {
    return {...firstResponse,message:'ยังส่งเรื่องให้ทีมคาเฟ่ไม่สำเร็จครับ จึงยังไม่ได้สร้างรายการติดตาม'};
  }
  let detail:Record<string,unknown>={};
  try { detail=JSON.parse(result.detail) as Record<string,unknown>; } catch { /* safe copy below */ }
  const inquiryCode=typeof detail.inquiryCode==='string'?detail.inquiryCode:'';
  return {
    ...firstResponse,
    message:[
      'สร้างรายการติดตามของ Inthanin Café แล้วครับ ✅',
      inquiryCode?`เลขที่ติดตาม ${inquiryCode}`:'',
      'สถานะ: รอทีมงานติดต่อกลับ',
      transactionNotificationMessage(detail),
      'รายการนี้เป็นคำขอให้ทีมตรวจสอบ ยังไม่ใช่ออเดอร์หรือการชำระเงิน',
    ].filter(Boolean).join('\n'),
  };
}

async function executeDeterministicOtopOrder(
  args:Record<string,unknown>,
  request:BrainRequest,
  guestDbId:string|null,
  channel:BrainChannel,
):Promise<BrainResponse> {
  const sku=typeof args.sku==='string'?args.sku.trim():'';
  const quantity=Math.floor(Number(args.quantity));
  const fulfillmentType=args.fulfillmentType==='shipping'?'shipping':'pickup';
  const firstResponse:BrainResponse={
    message:'',intent:'order',contextUpdates:{},journeyAction:{type:'none',journey:null},
    suggestedActions:[],responseStyle:'direct',semanticMemoryUpdates:[],toolCalls:[],
  };
  if(!sku || !Number.isInteger(quantity) || quantity<1 || quantity>99) {
    return {...firstResponse,message:'ยังสร้างออเดอร์ OTOP ไม่ได้ครับ กรุณาเลือกสินค้าและจำนวนอีกครั้ง'};
  }
  const [result]=await executeBrainTools(guestDbId,channel,[{
    name:'create_otop_order',
    args:{
      sku,quantity,fulfillmentType,
      ...(typeof args.customerName==='string'?{customerName:args.customerName}:{}),
      ...(typeof args.phone==='string'?{phone:args.phone}:{}),
      ...(typeof args.email==='string'?{email:args.email}:{}),
      ...(typeof args.shippingAddress==='string'?{shippingAddress:args.shippingAddress}:{}),
      ...(typeof args.note==='string'?{note:args.note}:{}),
    },
  }],firstResponse,request);
  if(!result?.ok) {
    return {...firstResponse,message:'ยังสร้างออเดอร์ OTOP ไม่สำเร็จครับ ระบบตรวจสินค้าและสต็อกไม่ผ่าน จึงยังไม่ตัดสต็อกหรือสร้างยอดชำระ'};
  }
  let detail:Record<string,unknown>={};
  try { detail=JSON.parse(result.detail) as Record<string,unknown>; } catch { /* safe defaults */ }
  const orderCode=typeof detail.orderCode==='string'?detail.orderCode:'';
  const total=typeof detail.total==='number'?detail.total:Number(detail.total);
  return {
    ...firstResponse,
    message:[
      'สร้างออเดอร์ OTOP แล้วครับ ✅',
      orderCode?`เลขออเดอร์ ${orderCode}`:'',
      Number.isFinite(total)?`ยอดชำระ ${Math.round(total)} บาท`:'',
      fulfillmentType==='shipping'?'จัดส่งตามที่อยู่ที่ให้ไว้':'รับสินค้าที่ร้าน',
      'สถานะ: รอดำเนินการและรอชำระเงิน',
      transactionNotificationMessage(detail),
    ].filter(Boolean).join('\n'),
  };
}

async function executeDeterministicPromotionRedemption(
  args:Record<string,unknown>,
  request:BrainRequest,
  guestDbId:string|null,
  channel:BrainChannel,
):Promise<BrainResponse> {
  // request is transport context only. No request.message parsing is allowed.
  const campaignId=typeof args.campaignId==='string'?args.campaignId.trim():'';
  const customerName=typeof args.customerName==='string'?args.customerName.trim():'';
  const requiresDateTime=args.requiresDateTime!==false;
  const date=typeof args.date==='string'?args.date.trim():'';
  const time=typeof args.time==='string'?args.time.trim():'';
  const firstResponse:BrainResponse={
    message:'',intent:'booking',contextUpdates:{},journeyAction:{type:'none',journey:null},
    suggestedActions:[],responseStyle:'direct',semanticMemoryUpdates:[],toolCalls:[],
  };
  if(!guestDbId||!campaignId||!customerName||(requiresDateTime&&(!date||!time))) {
    return {
      ...firstResponse,
      message:'ยังใช้สิทธิ์โปรโมชันไม่ได้ครับ เพราะข้อมูลโปร ชื่อผู้รับสิทธิ์ หรือวันเวลาที่ยืนยันต้องใช้ยังไม่ครบ และยังไม่ได้สร้างรายการ',
    };
  }

  const safeArgs={
    campaignId,
    customerName,
    ...(date?{date}:{}),
    ...(time?{time}:{}),
    ...(typeof args.phone==='string'&&args.phone.trim()?{phone:args.phone.trim()}:{}),
    ...(typeof args.email==='string'&&args.email.trim()?{email:args.email.trim()}:{}),
    ...(typeof args.note==='string'&&args.note.trim()?{note:args.note.trim()}:{}),
  };
  const [result]=await executeBrainTools(
    guestDbId,channel,[{name:'redeem_promotion',args:safeArgs}],firstResponse,request,
  );
  if(!result?.ok) return {...firstResponse,message:promotionRedemptionFailureMessage(result?.detail??'execution_failed')};

  let detail:Record<string,unknown>={};
  try{detail=JSON.parse(result.detail) as Record<string,unknown>;}catch{/* safe defaults */}
  const status=typeof detail.status==='string'?detail.status:'requested';
  const campaignCode=typeof detail.campaignCode==='string'
    ? detail.campaignCode
    : (typeof args.campaignCode==='string'?args.campaignCode:'');
  const title=typeof args.title==='string'
    ? args.title
    : (typeof args.promotionName==='string'?args.promotionName:'โปรโมชันที่เลือก');
  const preorder=detail.preorder&&typeof detail.preorder==='object'&&!Array.isArray(detail.preorder)
    ? detail.preorder as Record<string,unknown>
    : null;
  const preorderCode=preorder&&typeof preorder.preorderCode==='string'?preorder.preorderCode:'';
  const promoTotal=typeof args.promoTotal==='number'?args.promoTotal:null;

  return {
    ...firstResponse,
    message:[
      status==='redeemed'?'ใช้สิทธิ์โปรโมชันเรียบร้อยครับ ✅':'บันทึกคำขอใช้สิทธิ์โปรโมชันแล้วครับ ✅',
      `💡 ${title}`,
      campaignCode?`รหัสโปร ${campaignCode}`:'',
      preorderCode?`🍽️ ออเดอร์ ${preorderCode}`:'',
      date&&time?`🕑 วันที่ ${date} เวลา ${time}`:'',
      promoTotal!==null?`💰 ราคาพิเศษ ${Math.round(promoTotal)} บาท`:'',
      status==='redeemed'?'สถานะ: ใช้สิทธิ์แล้ว':'สถานะ: รอดำเนินการ/ยืนยัน',
    ].filter(Boolean).join('\n'),
  };
}

async function executeDeterministicStayBooking(
  args: Record<string, unknown>,
  request: BrainRequest,
  guestDbId: string | null,
  channel: BrainChannel,
): Promise<BrainResponse> {
  // Pure structured glue: request is passed only as transport context to the
  // existing tool runtime. This function never reads request.message or runs
  // any date/entity/commitment parser.
  const accommodationName = typeof args.accommodationName === 'string' ? args.accommodationName : null;
  const firstResponse: BrainResponse = {
    message:'', intent:'booking', contextUpdates:{},
    journeyAction:{ type:'none', journey:null }, suggestedActions:[],
    responseStyle:'direct', semanticMemoryUpdates:[], toolCalls:[],
  };
  const [result] = await executeBrainTools(guestDbId, channel, [{
    name:'create_booking', args:{ serviceType:'stay', ...args },
  }], firstResponse, request);
  if (!result?.ok) return { ...firstResponse, message:'ยังส่งคำขอจองที่พักไม่สำเร็จครับ กรุณาตรวจวันเข้าพัก วันออก จำนวนคน และตัวเลือกที่พักอีกครั้ง' };
  let detail: Record<string, unknown> = {};
  try { detail = JSON.parse(result.detail) as Record<string, unknown>; } catch { /* keep defaults */ }
  const bookingCode = typeof detail.bookingCode === 'string' ? detail.bookingCode : '';
  return {
    ...firstResponse,
    message:[
      'ส่งคำขอจองที่พักเข้าระบบแล้วครับ ✅',
      bookingCode ? `เลขที่จอง ${bookingCode}` : '',
      accommodationName ? `ที่พักที่เลือก: ${accommodationName}` : '',
      transactionNotificationMessage(detail),
      'ทีมงานจะตรวจสอบและยืนยันอีกครั้งทาง LINE / โทร / อีเมล',
    ].filter(Boolean).join('\n'),
  };
}
// Service Mind -- compliment/complaint/suggestion/safety-issue/system-
// feedback. Checked early (right after the activity-booking fallback,
// before One-Mind and every other deterministic responder) for two
// reasons: (1) a complaint/safety report must never be swallowed by
// domain routing (activity/restaurant/local-concierge all have their own,
// unrelated reasons to match parts of a complaint's vocabulary), and (2)
// classifyServiceFeedback deliberately does NOT check
// hasExplicitTransactionIntent, so a feedback match here must win
// BEFORE any transaction-processing code ever sees the message --
// "บริการแย่มาก ยืนยัน" needs to be handled as a complaint, not read as a
// booking confirmation, and returning here immediately is what guarantees
// that (see _service-mind-feedback-intent.ts's own header comment).
// Master Roadmap Phase 1 -- Escalation Boundary Policy. A message naming
// a topic outside Thongthai's authority (refund/discount/claim/
// liability/safety-guarantee/reputational-threat/severe-medical-risk/
// unverified-availability) gets a deterministic guardrail reply, never
// an LLM-drafted one -- see _boundary-classifier.ts's own header comment
// for the owner's explicit decision this implements. Checked BEFORE
// deterministicServiceFeedbackResponse specifically because two of these
// categories (accident_liability, severe_allergy_medical) would
// otherwise be misclassified by that responder's own classifyServiceFeedback
// (its URGENT_SAFETY_MARKER already contains "อุบัติเหตุ"/"แพ้อาหารรุนแรง"
// for genuine in-progress-emergency detection) as an urgent safety_issue
// REPORT, producing the wrong reply for what is actually a liability
// QUESTION or a bare severe-medical-risk statement -- confirmed directly
// before building this fix (see the handoff entry for the exact before/
// after classification proof).
const ESCALATION_ISSUE_KEYWORD: Record<EscalationCategory, IssueKeyword> = {
  refund_request: 'payment',
  special_discount: 'pricing',
  claim_request: 'payment',
  accident_liability: 'safety',
  safety_guarantee: 'safety',
  bad_review_threat: 'service',
  severe_allergy_medical: 'safety',
  unverified_availability: 'booking',
};

// safety_issue reuses the EXISTING needsOwnerEscalation rule (always
// escalates to domain + owner_general regardless of severity) for the
// genuinely safety/liability/medical-risk categories; 'complaint' with a
// severity of 'high' (not 'urgent') keeps the others from ALSO triggering
// that automatic owner_general escalation when they already route to
// owner_general directly via business_unit='general' -- avoiding a
// redundant double-target for a message that only ever had one real
// target anyway.
const ESCALATION_FEEDBACK_TYPE: Record<EscalationCategory, 'complaint' | 'safety_issue'> = {
  refund_request: 'complaint',
  special_discount: 'complaint',
  claim_request: 'complaint',
  accident_liability: 'safety_issue',
  safety_guarantee: 'safety_issue',
  bad_review_threat: 'complaint',
  severe_allergy_medical: 'safety_issue',
  unverified_availability: 'complaint',
};

const ESCALATION_SEVERITY: Record<EscalationCategory, 'normal' | 'high' | 'urgent'> = {
  refund_request: 'high',
  special_discount: 'normal',
  claim_request: 'high',
  accident_liability: 'urgent',
  safety_guarantee: 'urgent',
  bad_review_threat: 'high',
  severe_allergy_medical: 'urgent',
  unverified_availability: 'normal',
};

async function deterministicEscalationResponse(
  request: BrainRequest,
  channel: BrainChannel,
  guestDbId: string | null,
  sourceEventKey: string,
  preclassified?: EscalationMatch | null,
): Promise<BrainResponse | null> {
  const match = preclassified ?? classifyEscalationBoundary(request.message);
  if (!match) return null;

  const respond = (message: string): BrainResponse => ({
    message,
    intent: 'information',
    contextUpdates: {},
    journeyAction: { type: 'none', journey: null },
    suggestedActions: [],
    responseStyle: 'direct',
    semanticMemoryUpdates: [],
    toolCalls: [],
  });

  if (!match.escalates) {
    // The one non-escalating instance (bare, generic safety-guarantee
    // question) -- honest answer only, no feedback event, no notification.
    return respond(composeEscalationResponse(match, true, [], request.language));
  }

  const serviceFeedbackMatch: ServiceFeedbackMatch = {
    feedbackType: ESCALATION_FEEDBACK_TYPE[match.category],
    businessUnit: match.domainUnit ?? 'general',
    severity: ESCALATION_SEVERITY[match.category],
    staffName: null,
    personMentions: [],
    businessUnitMentions: [],
    sentimentKeywords: [],
    issueKeywords: [ESCALATION_ISSUE_KEYWORD[match.category]],
    namedAssets: [],
    keywordSummary: { topPositive: [], topNegative: [] },
  };
  const eventResult = await createFeedbackEvent({
    match: serviceFeedbackMatch, message: request.message, channel, guestDbId, sourceEventKey,
  });
  return respond(composeEscalationResponse(match, eventResult.eventId != null, eventResult.targets, request.language));
}

async function deterministicServiceFeedbackResponse(
  request: BrainRequest,
  channel: BrainChannel,
  guestDbId: string | null,
  sourceEventKey: string,
  preclassified?: ServiceFeedbackMatch | null,
): Promise<BrainResponse | null> {
  const match = preclassified ?? classifyServiceFeedback(request.message);
  if (!match) return null;
  const eventResult = await createFeedbackEvent({
    match, message: request.message, channel, guestDbId, sourceEventKey,
  });
  return {
    message: composeServiceFeedbackResponse(match, eventResult.notificationQueued, eventResult, request.language),
    intent: 'information',
    contextUpdates: {},
    journeyAction: { type: 'none', journey: null },
    suggestedActions: [],
    responseStyle: 'direct',
    semanticMemoryUpdates: [],
    toolCalls: [],
  };
}

// Section 1 (before conversation): a truly bare "I want to visit" message
// with no other structure gets ONE good clarifying question instead of
// falling through to the LLM with nothing to go on. See
// _service-mind-conversation-flow.ts's own header comment for why this is
// deliberately narrow.
function deterministicVagueVisitIntentResponse(request: BrainRequest): BrainResponse | null {
  if (!isVagueVisitIntentMessage(request.message)) return null;
  return {
    message: composeVagueVisitIntentResponse(),
    intent: 'information',
    contextUpdates: {},
    journeyAction: { type: 'none', journey: null },
    suggestedActions: [],
    responseStyle: 'direct',
    semanticMemoryUpdates: [],
    toolCalls: [],
  };
}

// Section 1 (before conversation): a bare "อยากกิน" gets a caring
// spice/allergy question instead of risking a generic non-answer; a bare
// "อยากขี่ม้า" gets a caring experience/feel question instead of a plain
// asset-inventory listing. See _service-mind-conversation-flow.ts's own
// header comments for why each marker is deliberately narrow.
function deterministicFoodIntentStartResponse(request: BrainRequest): BrainResponse | null {
  if (!isFoodIntentStartMessage(request.message)) return null;
  return {
    message: composeFoodIntentStartResponse(),
    intent: 'information',
    contextUpdates: {},
    journeyAction: { type: 'none', journey: null },
    suggestedActions: [],
    responseStyle: 'direct',
    semanticMemoryUpdates: [],
    toolCalls: [],
  };
}

function deterministicActivityIntentStartResponse(request: BrainRequest): BrainResponse | null {
  if (!isActivityIntentStartMessage(request.message)) return null;
  const explicitQualifier = classifyActivityIntentQualifier(request.message);
  const rememberedConstraints = new Set(request.guestContext.constraints ?? []);
  const rememberedQualifier = rememberedConstraints.has('beginner_friendly')
    ? 'beginner'
    : rememberedConstraints.has('fear_of_falling') || rememberedConstraints.has('fear_of_speed')
      ? 'cautious'
      : rememberedConstraints.has('child_friendly') || rememberedConstraints.has('elderly_friendly')
        ? 'family'
        : null;
  return {
    message: composeActivityIntentStartResponse(explicitQualifier ?? rememberedQualifier),
    intent: 'information',
    contextUpdates: {},
    journeyAction: { type: 'none', journey: null },
    suggestedActions: [],
    responseStyle: 'direct',
    semanticMemoryUpdates: [],
    toolCalls: [],
  };
}

// composeActivityIntentStartResponse's care-question reply is pure text --
// it never used to persist anything, so a LATER bare horse-name mention in
// the SAME conversation (e.g. "เอาทองไทย" right after "อยากขี่ม้า") had no
// way to know an activity conversation was already underway.
// bareHorseSelectionClarification's own hasEverDiscussedActivityDomain
// guard reads taskState.activeTask.domain === 'activity' from persisted
// guest_agent_state precisely to cover this -- LINE always passes an
// empty chatHistory (see _line-webhook-core.ts's askThongthai), so
// persisted state is the ONLY memory that survives between LINE turns.
// Starting a real (not fake) activity_booking task here, via the same
// _task-state.ts machinery every other domain uses, is what makes that
// guard see this conversation as already in progress. Never overwrites an
// unrelated task the guest may already have active elsewhere.
async function markActivityIntentStarted(guestDbId: string | null, channel: BrainChannel): Promise<void> {
  if (!guestDbId) return;
  try {
    let container = await loadTaskState(guestDbId);

    if (container.activeTask && !isTerminalTaskStatus(container.activeTask.status)) {
      // Same-domain activity context is already exactly what we need.
      if (container.activeTask.domain === 'activity') return;

      // A clear explicit activity/horse intent must be allowed to switch
      // domains. Preserve the unrelated unfinished task using the existing
      // bounded task stack instead of silently refusing the switch.
      container = suspendActiveTask(container);
    }

    const next = startNewActiveTask(container, {
      type: 'activity_booking',
      sourceChannel: channel,
      requiredFields: ACTIVITY_BOOKING_REQUIRED_FIELDS,
    });
    await persistTaskState(guestDbId, next);
  } catch (error) {
    console.error('THONGTHAI_ACTIVITY_INTENT_TASK_START_ERROR', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
  }
}

// Care-aware wording for family/children/elderly/mobility context (see
// _service-mind-care-context.ts's own header comment for exactly which
// combinations this claims and why it must run before local-concierge's
// own visitor_journey/food_culture/activity_suitability composers --
// those are correct but don't explicitly voice comfort/pace/safety care).
function deterministicCareContextResponse(request: BrainRequest): BrainResponse | null {
  const match = classifyCareContext(request.message);
  if (!match) return null;
  return {
    message: composeCareContextResponse(match),
    intent: 'information',
    contextUpdates: {},
    journeyAction: { type: 'none', journey: null },
    suggestedActions: [],
    responseStyle: 'direct',
    semanticMemoryUpdates: [],
    toolCalls: [],
  };
}

// Section 3 (after conversation): a bare "thank you" gets a warm close
// and, per Customer Service Doctrine's "ask only at the right time," a
// light feedback invitation -- never a survey, never spammed onto an
// unrelated turn (this responder only ever fires on the narrow
// THANK_YOU_MARKER shape, nothing else).
function supervisedOpenWorldResponse(
  turn: SemanticTurn,
  request: BrainRequest,
): BrainResponse {
  const isThai = request.language === 'th' || /[\u0E00-\u0E7F]/u.test(request.message);
  let message:string;

  if (turn.domain === 'incident') {
    message = isThai
      ? 'รับเรื่องครับ ช่วยบอกจุดที่เกิดเหตุหรือจุดที่เห็นครั้งสุดท้าย เวลาประมาณ และรายละเอียดสิ่งที่เกิดขึ้นอีกนิดครับ ทองไทยจะช่วยรวบรวมให้ทีมตรวจสอบต่อ'
      : 'I understand this is an incident report. Please share the approximate time, location, and a few details so I can help route it for follow-up.';
  } else if (turn.domain === 'local') {
    message = isThai
      ? 'ถ้าเป็นสิ่งที่เกิดขึ้นรอบพื้นที่ตอนนี้ ทองไทยยังไม่มีข้อมูลสดยืนยันจากหน้างานครับ เลยไม่อยากเดา ถ้าบอกจุดหรือช่วงเวลาที่หมายถึงได้ จะช่วยต่อให้ตรงขึ้นครับ'
      : 'I understand you are asking about something around the area. I do not have a live on-site view, so I will not guess. Share the spot or time you mean and I can help narrow it down.';
  } else if (turn.needsClarification) {
    message = isThai
      ? 'เข้าใจเรื่องที่ถามอยู่ครับ แต่ยังขาดรายละเอียดสำคัญอีกนิด บอกเพิ่มได้เลยว่าหมายถึงอะไรหรืออยากให้ทองไทยช่วยแบบไหน'
      : 'I understand the topic, but I need one more detail to know exactly what you want help with.';
  } else if (turn.speechAct === 'social' || turn.action === 'unknown') {
    message = isThai
      ? 'ได้ครับ คุยกับทองไทยได้เลย ถ้ามีอะไรอยากให้ช่วยต่อ บอกมาได้ตรง ๆ ครับ'
      : 'Sure. You can talk to me normally—tell me what you want help with next.';
  } else {
    message = isThai
      ? 'เข้าใจครับ เรื่องนี้ไม่ได้เป็นคำสั่งจองหรือสั่งซื้อ ทองไทยจะไม่ทำรายการอะไรเอง ถ้าต้องใช้ข้อมูลเฉพาะเพิ่มเติมจะเช็กจากแหล่งที่ยืนยันได้ก่อนครับ'
      : 'Understood. This is not a booking or purchase instruction, so I will not submit anything. If specific facts are needed, I will rely on a verified source first.';
  }

  return {
    message,
    intent:'conversation',
    contextUpdates:{},
    journeyAction:{ type:'none', journey:null },
    suggestedActions:[],
    responseStyle:'direct',
    semanticMemoryUpdates:[],
    toolCalls:[],
  };
}

function deterministicThankYouCloseResponse(request: BrainRequest): BrainResponse | null {
  if (!isThankYouMessage(request.message)) return null;
  return {
    message: composeThankYouCloseResponse(true),
    intent: 'conversation',
    contextUpdates: {},
    journeyAction: { type: 'none', journey: null },
    suggestedActions: [],
    responseStyle: 'direct',
    semanticMemoryUpdates: [],
    toolCalls: [],
  };
}

export type ThongthaiChatCoreResult = { statusCode: number; payload: Record<string, unknown> };

const RESTAURANT_DURABLE_CONSTRAINT_CODES = new Set([
  'vegetarian','no_spicy','mild_spice','no_pork','no_beef','no_chicken','no_fish','no_egg',
  'no_plara','no_peanut','no_shrimp','peanut_allergy','shrimp_allergy','fish_allergy','egg_allergy',
  'food_allergy','authentic_isan',
]);

const DURABLE_RESTAURANT_CONSTRAINT_FOLLOWUP_RE =
  /(?:ที่บอก(?:ไป|ไว้)?|ที่แจ้ง(?:ไว้)?|ตามที่บอก|ตามที่แจ้ง|เงื่อนไขที่บอก|ข้อจำกัดที่บอก)/u;

function hasDurableRestaurantConstraint(request: BrainRequest): boolean {
  return (request.guestContext.constraints ?? []).some(code => RESTAURANT_DURABLE_CONSTRAINT_CODES.has(code));
}

/**
 * Grounded menu follow-ups with durable dietary context do not need semantic
 * model ownership. They have one authoritative job: apply the remembered
 * normalized constraints to the live restaurant menu. This runs before Agent
 * Primary / semantic cutover so a clear "which menu suits what I told you"
 * turn cannot degrade into FACT_UNKNOWN while the actual live menu is
 * available to deterministicRestaurantResponse.
 */
function isSafetyCriticalRestaurantRecommendation(message: string): boolean {
  if (!/แพ้(?:กุ้ง|ถั่ว|ปลา|ไข่|อาหารทะเล|ทะเล)/u.test(message)) return false;
  const intent = classifyRestaurantDietaryIntent(message);
  return intent === 'CONSTRAINT_AND_RECOMMENDATION';
}

/**
 * Phase 7 final latency/safety boundary.
 *
 * A current-turn food allergy plus an explicit recommendation request has a
 * complete local answer path: normalized constraint capture + live menu
 * filtering + cross-contamination caution. Sending that turn to 100% Agent
 * Primary adds latency/failure risk without adding authority. Keep this
 * narrow to actual allergy+recommendation turns so generic food-culture or
 * spice-only cold starts retain their established language-owned behavior.
 */
async function safetyCriticalRestaurantRecommendationBeforePrimary(
  request: BrainRequest,
  guestDbId: string | null,
  channel: BrainChannel,
): Promise<BrainResponse | null> {
  if (!guestDbId || !isSafetyCriticalRestaurantRecommendation(request.message)) return null;
  const snapshot = await loadGuestAgentStateSnapshot(guestDbId).catch(() => null);
  const agentState = snapshot && isObject(snapshot.state) ? snapshot.state : {};
  if (!isRestaurantAdvisorTurn(request, { agentState })) return null;
  return deterministicRestaurantResponse(request, { agentState }, guestDbId, channel);
}

async function durableRestaurantRecommendationBeforeSemantic(
  request: BrainRequest,
  guestDbId: string | null,
  channel: BrainChannel,
  hadDurableConstraintBeforeTurn: boolean,
): Promise<BrainResponse | null> {
  if (!guestDbId || !hadDurableConstraintBeforeTurn) return null;
  if (!DURABLE_RESTAURANT_CONSTRAINT_FOLLOWUP_RE.test(request.message)) return null;
  const intent = classifyRestaurantDietaryIntent(request.message);
  // This fast path is ONLY for a follow-up recommendation whose dietary
  // constraints are already durable. A current-turn constraint +
  // recommendation must stay on the established restaurant/local-concierge
  // path so the current declaration is captured/acknowledged normally and
  // existing safety tests keep their intended source boundary.
  if (intent !== 'RECOMMENDATION_ONLY') return null;
  const snapshot = await loadGuestAgentStateSnapshot(guestDbId).catch(() => null);
  const agentState = snapshot && isObject(snapshot.state) ? snapshot.state : {};
  if (!isRestaurantAdvisorTurn(request, { agentState })) return null;
  return deterministicRestaurantResponse(request, { agentState }, guestDbId, channel);
}

function asksActivityAvailabilityWithoutBooking(message: string, boundaryMode: string): boolean {
  if (boundaryMode !== 'WITHHOLD') return false;
  return /(?:เช็ก|เช็ค|ตรวจ|ดู).{0,24}(?:ว่าง|คิว)|(?:ว่าง|คิว).{0,24}(?:ไหม|มั้ย|หรือเปล่า|ได้ไหม)/u.test(message);
}

/**
 * Availability-only + explicit no-booking is a read-only status question.
 * When date/time is missing, answer the missing-slot question deterministically
 * before state-summary composition. This prevents a semantically correct
 * availability turn from nondeterministically collapsing into a mere task
 * recap ("ภาราดร 45 นาที") that never answers availability at all.
 */
async function boundedActivityAvailabilityClarification(
  request: BrainRequest,
  guestDbId: string | null,
  boundaryMode: string,
): Promise<BrainResponse | null> {
  if (!guestDbId || !asksActivityAvailabilityWithoutBooking(request.message, boundaryMode)) return null;
  const task = await loadTaskState(guestDbId).catch(() => null);
  const active = task?.activeTask?.type === 'activity_booking' && !isTerminalTaskStatus(task.activeTask.status)
    ? task.activeTask : null;
  const date = extractDate(request.message) ?? (typeof active?.slots?.date === 'string' ? active.slots.date : null);
  const time = extractTime(request.message) ?? (typeof active?.slots?.time === 'string' ? active.slots.time : null);
  if (date && time) return null;

  const horse = typeof active?.slots?.assetSelection === 'string'
    ? active.slots.assetSelection
    : typeof active?.slots?.horseName === 'string'
      ? active.slots.horseName
      : '';
  const duration = Number(active?.slots?.durationMinutes ?? active?.slots?.duration);
  const subject = horse
    ? `${horse}${Number.isFinite(duration) && duration > 0 ? ` ${duration} นาที` : ''}`
    : 'รอบกิจกรรมที่เลือกไว้';
  const missing = [date ? '' : 'วัน', time ? '' : 'เวลา'].filter(Boolean).join('และ');
  return {
    message:`ได้ครับ จะเช็กคิวว่างของ${subject}ให้ครับ ขอ${missing}ที่อยากมาเพิ่มก่อนนะครับ ตอนนี้ยังไม่ได้จองหรือส่งรายการครับ`,
    intent:'information',
    contextUpdates:{},
    journeyAction:{type:'none',journey:null},
    suggestedActions:[],
    responseStyle:'direct',
    semanticMemoryUpdates:[],
    toolCalls:[],
  };
}

const HORSE_COMPARISON_FOLLOWUP_RE = /(?:ต่างกัน|เปรียบเทียบ|ตัวไหนดี|เลือกตัวไหน|เลือกตัวไหนดี)/u;

/**
 * Phase 7 latency boundary for a contextual two-horse comparison.
 *
 * A follow-up such as "สองตัวนี้ต่างกันยังไง" contains no horse name on its
 * own, so read-only Agent Primary previously took first refusal and could hit
 * the 30s gateway timeout. Resolve it deterministically only when prior bounded
 * context proves BOTH canonical horses were the subject of the conversation.
 */
async function boundedHorseComparisonBeforePrimary(
  request: BrainRequest,
  guestDbId: string | null,
): Promise<BrainResponse | null> {
  if (hasExplicitTransactionIntent(request.message) || !HORSE_COMPARISON_FOLLOWUP_RE.test(request.message)) return null;

  const priorText = request.chatHistory.slice(-10).map(turn => turn.content).join('\n');
  let hasBothHorseContext = /ทองไทย/u.test(priorText) && /ภาราดร/u.test(priorText);

  if (!hasBothHorseContext && guestDbId) {
    const context = await loadConversationContext(guestDbId).catch(() => null);
    if (context) {
      const boundedText = context.recentTurns.map(turn => turn.content).join('\n');
      const entityIds = new Set(context.recentEntities.map(entity => entity.id));
      hasBothHorseContext =
        (/ทองไทย/u.test(boundedText) && /ภาราดร/u.test(boundedText))
        || (entityIds.has('activity_asset:horse-thongthai') && entityIds.has('activity_asset:horse-pharadon'));
    }
  }

  if (!hasBothHorseContext) return null;
  return {
    message: await composeLocalConciergeResponse({ category:'horse_comparison' }, request.message),
    intent:'information',
    contextUpdates:{},
    journeyAction:{type:'none',journey:null},
    suggestedActions:[],
    responseStyle:'direct',
    semanticMemoryUpdates:[],
    toolCalls:[],
  };
}

const HORSE_CORRECTION_SIGNAL_RE = /(?:ไม่เอา|ไม่ใช่|เปลี่ยนใจ|อีกตัว|ตัวอื่น|ตัวที่เหลือ|เอาแทน|แทน)/u;

/**
 * A bounded correction among the owner-verified horse assets still benefits
 * from One-Mind's semantic supervision, but it must not enter the heavier
 * Agent Primary loop first. This predicate changes routing only; One-Mind
 * remains the component that interprets and persists the correction.
 */
function horseCorrectionRoutesBeforePrimary(request: BrainRequest): boolean {
  if (hasExplicitTransactionIntent(request.message) || !HORSE_CORRECTION_SIGNAL_RE.test(request.message)) return false;
  return Boolean(findKnownActivityAssetSelection(request.message));
}

function directOtherHorseCorrectionResponse(request: BrainRequest): BrainResponse | null {
  const text=request.message.trim();
  if(hasExplicitTransactionIntent(text) || !/(?:อีกตัว|ตัวอื่น|ตัวที่เหลือ)/u.test(text))return null;

  const rejectsThongthai=/(?:ไม่เอา|ไม่ใช่|เปลี่ยนใจจาก).{0,12}(?:น้อง)?ทองไทย/u.test(text);
  const rejectsPharadon=/(?:ไม่เอา|ไม่ใช่|เปลี่ยนใจจาก).{0,12}(?:น้อง)?ภาราดร/u.test(text);
  if(rejectsThongthai===rejectsPharadon)return null;

  const selected=rejectsThongthai?HORSE_FACTS.pharadon:HORSE_FACTS.thongthai;
  const rejected=rejectsThongthai?HORSE_FACTS.thongthai:HORSE_FACTS.pharadon;
  const lines=[
    `ได้ครับ งั้นตัด${rejected.name}ออก เหลือ${selected.name}ครับ`,
    `ข้อมูลที่ยืนยันได้คือ ${selected.name}${selected.rideFeelTh} แต่ทองไทยยังไม่ใช้จุดนี้ฟันธงเรื่องความเหมาะสมเฉพาะคนครับ`,
  ];
  if(/กลัวตก|กลัวล้ม|มือใหม่|ไม่เคยขี่/u.test(text)){
    lines.push('ถ้ากังวลเรื่องตกหรือยังไม่เคยขี่ ให้ทีมหน้างานช่วยดูความมั่นใจและความเหมาะสมก่อนขึ้นม้าครับ');
  }
  lines.push('ตอนนี้ยังเป็นแค่การเลือกไว้ ยังไม่ได้จองหรือส่งรายการครับ');
  return {
    message:lines.join('\n\n'),
    intent:'recommendation',
    contextUpdates:{},
    journeyAction:{type:'none',journey:null},
    suggestedActions:[],
    responseStyle:'direct',
    agentStateUpdate:{activeTopic:'activity'},
    semanticMemoryUpdates:[],
    toolCalls:[],
  };
}

const BOOKING_STATUS_READBACK_RE =
  /(?:ยังไม่ได้จอง.{0,20}(?:ใช่ไหม|ใช่มั้ย|หรือยัง|ไหม|มั้ย)|มี(?:รายการ)?จอง.{0,16}(?:ไหม|มั้ย|หรือยัง)|จองอะไร(?:ไว้)?.{0,12}(?:ไหม|มั้ย|หรือยัง)|จองไปหรือยัง|จองแล้วหรือยัง|ได้จอง.{0,12}หรือยัง)/u;

function publicBookingStatusLabel(status: string): string {
  if (status === 'confirmed') return 'ยืนยันแล้ว';
  if (status === 'cancelled') return 'ยกเลิกแล้ว';
  if (status === 'completed') return 'เสร็จสมบูรณ์';
  if (status === 'no_show') return 'ปิดรายการแล้ว';
  return 'รอทีมงานตรวจสอบ';
}

/**
 * Transaction-status questions are answered from guest-scoped booking truth,
 * not from working task/catalog state. This closes the Phase 7 failure where
 * an empty booking result was rendered as "ไม่มีตัวเลือกที่ตรง".
 */
async function verifiedBookingStatusReadbackBeforePrimary(
  request: BrainRequest,
  guestDbId: string | null,
): Promise<BrainResponse | null> {
  // A mixed request such as "สรุป...แล้วตอนนี้ยังไม่ได้จองใช่ไหม" is a
  // summary first, not a status-only lookup. Let One-Mind/Response Composer
  // preserve the full grounded working state and include the no-booking
  // boundary in that summary instead of collapsing it to one DB sentence.
  if (/สรุป/u.test(request.message)) return null;
  if (!guestDbId || hasExplicitTransactionIntent(request.message) || !BOOKING_STATUS_READBACK_RE.test(request.message)) return null;
  const latest = await loadLatestBookingStatus(guestDbId);
  const message = latest
    ? [
        'มีรายการจองที่ส่งเข้าระบบแล้วครับ',
        `เลขที่คำขอ: ${latest.bookingCode}`,
        `สถานะ: ${publicBookingStatusLabel(latest.status)}`,
      ].join('\n')
    : 'ใช่ครับ ตอนนี้ยังไม่มีรายการจองที่ถูกส่งเข้าระบบสำหรับบัญชีนี้ครับ สิ่งที่คุยหรือเลือกไว้ยังไม่ได้จองหรือส่งรายการครับ';

  return {
    message,
    intent:'information',
    contextUpdates:{},
    journeyAction:{type:'none',journey:null},
    suggestedActions:[],
    responseStyle:'direct',
    semanticMemoryUpdates:[],
    toolCalls:[],
  };
}

// The single canonical entry point into Thongthai's shared brain -- called by
// BOTH the web HTTP handler below and LINE's adapter (_line-webhook-core.ts).
// LINE used to reach this over HTTP (a self-fetch to this same site's own
// thongthai-chat function); it now calls this function directly, in-process.
// See THONGTHAI_HANDOFF.md's "LINE self-fetch" finding for why that mattered.
// `eventId` is whatever the transport already determined as a stable id for
// this turn (LINE's own message id; the web handler's rawBody.eventId or
// x-nf-request-id/x-request-id header), or null if transport gave us nothing
// stable for this turn.
export async function processThongthaiChatCore(request: BrainRequest, eventId: string | null): Promise<ThongthaiChatCoreResult> {
  let explicitAiResponseTurnPersisted = false;

  async function coreResult(statusCode: number, payload: unknown): Promise<ThongthaiChatCoreResult> {
    const typed = payload as Record<string, unknown>;

    // Phase 6.2 canonical final-language egress.
    //
    // Every customer path -- Agent Primary, One-Mind, grounded composer,
    // deterministic responders, incident/guardrail responders and legacy
    // compatibility paths -- eventually returns through coreResult. The
    // Response Composer's own language guard is necessary but not sufficient:
    // real production proved several valid reply paths never pass through
    // that composer and could still append Thai politeness to English/Chinese
    // ("...per personครับ", "有的ครับ"). Normalize the surface ONCE here,
    // immediately before telemetry/persistence/public return, so no path can
    // bypass the requested response language.
    if (statusCode === 200 && typeof typed?.message === 'string') {
      typed.message = normalizeFinalCustomerMessage(typed.message,request.language,channel);
      typed.message = applyThongthaiCharacterKernel({
        message: typed.message,
        customerMessage: request.message,
        language: request.language,
        channel,
      });

      const requestedMedia = await resolveRequestedCustomerMedia({
        customerMessage: request.message,
        assistantMessage: typed.message,
        language: request.language,
        chatHistory: request.chatHistory,
      });
      if (requestedMedia) {
        typed.media = requestedMedia.media;
        const mediaAck = normalizeFinalCustomerMessage(requestedMedia.overrideMessage,request.language,channel);
        const keepExistingAnswer = /(?:ราคา|กี่บาท|เท่าไหร่|เท่าไร|มีของ|เหลือ|สต็อก|stock|price|how\s*much|วัสดุ|ทำจาก|ที่มา|รายละเอียด|ไซซ์|ขนาด)/iu.test(request.message);
        const combined = keepExistingAnswer && typeof typed.message === 'string' && typed.message.trim()
          ? `${typed.message.trim()}\n\n${mediaAck}`
          : mediaAck;
        typed.message = applyThongthaiCharacterKernel({
          message: combined,
          customerMessage: request.message,
          language: request.language,
          channel,
        });
      }
    }

    if (statusCode === 200 && typeof typed?.message === 'string') {
      const signals = evaluateBotQualitySignals({
        customerMessage: request.message,
        assistantMessage: typed.message,
        chatHistory: request.chatHistory,
      });
      await Promise.all(signals.map(signal => recordIntelligenceEvent({
        eventType: signal.eventType,
        category: signal.category,
        domain: signal.domain,
        guestDbId,
        message: request.message,
        channel: channel === 'line' ? 'line' : channel === 'web' ? 'web' : 'other',
        sourceEventId: transportEventId,
      }))).catch(error => {
        console.error('THONGTHAI_BOT_QUALITY_EVENT_ERROR', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
      });
    }
    if (!explicitAiResponseTurnPersisted && statusCode === 200 && typeof typed?.message === 'string') {
      const telemetryConversationId=String(request.guestId ?? guestDbId ?? '').trim();
      if(telemetryConversationId){
        // Every successful customer-facing reply must leave a turn row so
        // the idle cost notifier can report the exact conversation even
        // when this path used zero OpenAI calls. One-Mind already writes a
        // richer row; this insert is deliberately ignore-on-conflict.
        await persistAiResponseTurnIfAbsent({
          conversationId:telemetryConversationId,
          eventId:transportEventId,
          channel,
          finalResponseSource:'legacy_or_unclassified',
          modelReplyUsed:false,
          groundedKnowledgeSupplied:false,
          zeroCostTurn:false,
          environment:'live',
          occurredAt:new Date().toISOString(),
        }).catch(error=>{
          console.error('AI_RESPONSE_TURN_FALLBACK_PERSIST_ERROR',error instanceof Error?error.message.slice(0,180):'unknown');
        });
      }
    }
    return { statusCode, payload: typed };
  }

  const channel = getBrainChannel(request.pageContext.section);
  const providerUserKey = request.guestId;
  const canonicalGuestId = await resolveCanonicalGuestId(channel, providerUserKey);
  if (canonicalGuestId && canonicalGuestId !== request.guestId) {
    request = { ...request, guestId: canonicalGuestId };
  }

  let guestDbId: string | null = null;
  const customerState = await loadCustomerMemory(request.guestId, request.language, request.guestContext);
  if (customerState) {
    guestDbId = customerState.guestDbId;
    request = {
      ...request,
      guestContext: customerState.guestContext,
      journeyContext: {
        ...request.journeyContext,
        currentPlan: request.journeyContext.currentPlan || customerState.journeyContext.currentPlan,
        savedPlan: request.journeyContext.savedPlan || customerState.journeyContext.savedPlan,
        visitedExperiences: request.journeyContext.visitedExperiences.length
          ? request.journeyContext.visitedExperiences
          : customerState.journeyContext.visitedExperiences,
        favorites: request.journeyContext.favorites.length
          ? request.journeyContext.favorites
          : customerState.journeyContext.favorites,
      },
    };
  }

  await registerGuestIdentity(guestDbId, channel, providerUserKey ?? request.guestId);

  // One stable identity per transport turn. LINE supplies message.id; web
  // supplies eventId/request-id when available. Generate the fallback ONCE
  // per core invocation so every side effect in this turn shares it.
  const transportEventId = eventId
    ?? `server:${channel}:${Date.now()}:${Math.random().toString(36).slice(2, 12)}`;

  // Recovery architecture: attempt the canonical language-understanding
  // pipeline once, early. If it cannot safely own the turn, legacy execution
  // remains available below; never call One-Mind twice for the same turn.
  let oneMindAttemptedEarly = false;
  let earlyOneMind: Awaited<ReturnType<typeof processOneMindCustomerTurn>> | null = null;

  // Master Roadmap Phase 2 -- Customer Intelligence Memory. Run ONCE,
  // unconditionally, for every turn -- BEFORE the deterministic
  // responder cascade (including Phase 1's escalation boundary check
  // right below) so a service-useful phrase is captured regardless of
  // which responder eventually answers, and so it can never delay or
  // interfere with that cascade's own routing decision. A pure side
  // effect on the customer's own message text -- it never calls the
  // LLM, never changes which responder answers this turn, and never
  // overrides Phase 1's boundary policy (see
  // _customer-phrase-intelligence.ts's own header comment).
  // Snapshot the durable restaurant state BEFORE capturing this turn. A
  // same-turn constraint must not be reclassified as pre-existing memory
  // and steal cold-start local-food/service-mind routing.
  const hadDurableRestaurantConstraintBeforeTurn = hasDurableRestaurantConstraint(request);
  const sameTurnPreferenceSignal = extractGuestPreferenceSignal(request.message);
  await capturePreferenceSignals(guestDbId, request.message, {
    channel: channel === 'line' ? 'line' : channel === 'web' ? 'web' : 'other',
    eventId: transportEventId,
  }).catch(error => {
    console.error('THONGTHAI_PREFERENCE_CAPTURE_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
  });

  // The write above is durable, but request.guestContext was loaded BEFORE
  // that write. LINE does not send conversation history back, so without this
  // in-memory merge the responder for the SAME turn can answer from stale
  // constraints and only "remember" the new preference on the next message.
  //
  // Production example: user said "ไม่กินกุ้ง" and the ack still said only
  // "เลี่ยงไก่ / ไม่เผ็ด" because those were yesterday's loaded constraints.
  // Merge the classifier's canonical add/remove delta into this turn's
  // GuestContext immediately; the exact same normalized signal is already what
  // capturePreferenceSignals persisted to guest_memory.
  if (
    sameTurnPreferenceSignal.addConstraints.length
    || sameTurnPreferenceSignal.removeConstraints.length
    || sameTurnPreferenceSignal.pace
    || sameTurnPreferenceSignal.travelerType
  ) {
    const remove = new Set(sameTurnPreferenceSignal.removeConstraints);
    const constraints = [
      ...new Set([
        ...request.guestContext.constraints.filter(item => !remove.has(item)),
        ...sameTurnPreferenceSignal.addConstraints,
      ]),
    ];
    request = {
      ...request,
      guestContext: {
        ...request.guestContext,
        constraints,
        pace: sameTurnPreferenceSignal.pace ?? request.guestContext.pace,
        travelerType: sameTurnPreferenceSignal.travelerType ?? request.guestContext.travelerType,
      },
    };
  }

  const topLevelSemanticIntent = classifyTopLevelSemanticIntent(request.message);
  console.log('TOP_LEVEL_SEMANTIC_INTENT', JSON.stringify({ intent: topLevelSemanticIntent }));

  const earlyGreeting = deterministicGreetingResponse(request);
  if (earlyGreeting) {
    const polished = polishedResponse(earlyGreeting, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  // Checked before any semantic/One-Mind processing so a reset request
  // never itself gets misread against the very context it's asking to
  // clear (see deterministicConversationResetResponse's own comment for
  // the real production incident this closes), and so the persisted
  // routing memory is actually gone before the NEXT turn ever reads it.
  const earlyConversationReset = await deterministicConversationResetResponse(request, guestDbId).catch(error => {
    console.error('THONGTHAI_CONVERSATION_RESET_RESPONDER_ERROR', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
    return null;
  });
  if (earlyConversationReset) {
    const polished = polishedResponse(earlyConversationReset, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    // Cost guard hotfix: this branch returns before One-Mind/semantic-
    // interpreter is ever reached, so it never spends a paid call -- but
    // without an explicit row here, ai_response_turns had no record of the
    // turn at all, making "was this genuinely zero-cost" unverifiable from
    // production telemetry. Truthful by construction: this call site never
    // has a model reply or a paid grounded-response-composition call.
    if (guestDbId) {
      await persistAiResponseTurn({
        conversationId: request.guestId ?? guestDbId,
        eventId: transportEventId,
        channel,
        finalResponseSource: 'deterministic_or_grounded_local',
        modelReplyUsed: false,
        groundedKnowledgeSupplied: false,
        zeroCostTurn: true,
        occurredAt: new Date().toISOString(),
      }).catch(error => {
        console.error('AI_RESPONSE_TURN_PERSIST_ERROR', error instanceof Error ? error.message.slice(0, 180) : 'unknown');
      });
    }
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  // Same reasoning as earlyGreeting above: a bare "เห้ยยย"/"อยู่ไหม" must
  // never depend on the LLM being up, on any channel (LINE private chat
  // shares this exact function -- see processThongthaiChatCore's callers).
  const earlyCasualChat = deterministicCasualChatResponse(request);
  if (earlyCasualChat) {
    const polished = polishedResponse(earlyCasualChat, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  // Same reasoning again: a bare, ambiguous fragment ("สติ", "งง", "อะไร")
  // must be answered with a clarifying question instantly, never routed to
  // the LLM (or its degraded-provider apology) at all -- see
  // deterministicShortUnclearTextResponse's own header comment.
  const earlyShortUnclearText = deterministicShortUnclearTextResponse(request);
  if (earlyShortUnclearText) {
    console.log('SEMANTIC_RESPONDER_SELECTED', JSON.stringify({ responder: 'deterministicShortUnclearTextResponse' }));
    const polished = polishedResponse(earlyShortUnclearText, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  // Phase 5 Business + Incident Router: one pre-model classification pass
  // owns the deterministic authority/feedback precedence. The individual
  // responders below receive the already-classified object so they cannot
  // disagree by re-running separate language matchers.
  const rawBusinessIncidentRoute = classifyRawBusinessIncidentRoute(request.message);
  if (rawBusinessIncidentRoute) {
    console.log('THONGTHAI_BUSINESS_INCIDENT_ROUTE', JSON.stringify({
      stage:'raw',
      kind:rawBusinessIncidentRoute.kind,
      lane:rawBusinessIncidentRoute.lane,
      businessUnit:rawBusinessIncidentRoute.businessUnit,
    }));
  }

  // Master Roadmap Phase 1 -- Escalation Boundary Policy. Checked BEFORE
  // deterministicServiceFeedbackResponse. Phase 5 preserves the exact
  // deterministic guardrail wording and only centralizes the routing decision.
  const escalation = rawBusinessIncidentRoute?.kind === 'authority_boundary'
    ? await deterministicEscalationResponse(
        request, channel, guestDbId, transportEventId, rawBusinessIncidentRoute.escalation,
      ).catch(error => {
        console.error('THONGTHAI_ESCALATION_BOUNDARY_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
        return null;
      })
    : null;
  if (escalation) {
    const polished = polishedResponse(escalation, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  // Service Mind / global override -- checked BEFORE any active-task
  // continuation code (activityBookingFallbackResponse, the bare-horse
  // responders, and everything after them), not just before transaction-
  // processing and One-Mind as the original comment on this block said.
  // Real production incident this closes: a mid-conversation complaint
  // ("ทองไทยอธิบายไม่รู้เรื่อง เจิดนิสัยไม่ดี", sent right after selecting a
  // horse) was being swallowed by horseSelectionWithContextResponse --
  // classifyServiceFeedback's own marker gaps meant it didn't even
  // classify as feedback at the time (fixed alongside this reorder: see
  // THONGTHAI_RESPONSE_MENTION/SYSTEM_FEEDBACK_MARKER/COMPLAINT_MARKER in
  // _service-mind-feedback-intent.ts), and because it happened to contain
  // "ทองไทย", the bare-horse-selection machinery treated it as a horse
  // pick instead. An active booking/activity context must NEVER be able
  // to swallow a complaint, staff mention, safety report, compliment, or
  // system-quality comment -- this is now enforced by ORDER, not by each
  // downstream responder having to individually remember to yield to
  // feedback (which is exactly what silently broke before).
  const serviceFeedback = rawBusinessIncidentRoute?.kind === 'service_feedback'
    ? await deterministicServiceFeedbackResponse(
        request, channel, guestDbId, transportEventId, rawBusinessIncidentRoute.feedback,
      ).catch(error => {
        console.error('THONGTHAI_SERVICE_FEEDBACK_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
        return null;
      })
    : null;
  if (serviceFeedback) {
    const polished = polishedResponse(serviceFeedback, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  const commercialBoundary = classifyCommercialBoundaryText(
    request.message,
    topLevelSemanticIntent,
  );
  const explicitTransactionIntent = commercialBoundary.currentTurnCommit;
  const transactionPrepareIntent = commercialBoundary.prepareEligible;

  const boundedDurationGuard = await boundedConsideredHorseDurationResponse(
    request,
    guestDbId,
    channel,
  ).catch(error => {
    console.error(
      'THONGTHAI_BOUNDED_DURATION_GUARD_ERROR',
      error instanceof Error ? error.message.slice(0, 220) : 'unknown',
    );
    return null;
  });
  if (boundedDurationGuard) {
    const polished = polishedResponse(boundedDurationGuard, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  const explicitHorseHold = await explicitHorseHoldWithoutBookingResponse(
    request,
    guestDbId,
    channel,
    commercialBoundary.mode,
  ).catch(error => {
    console.error('THONGTHAI_EXPLICIT_HORSE_HOLD_ERROR', error instanceof Error ? error.message.slice(0,220) : 'unknown');
    return null;
  });
  if (explicitHorseHold) {
    const polished = polishedResponse(explicitHorseHold, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message:polished.message,
      intent:polished.intent,
      contextUpdates:polished.contextUpdates,
      journeyAction:polished.journeyAction,
      suggestedActions:polished.suggestedActions,
    });
  }

  const availabilityClarification = await boundedActivityAvailabilityClarification(
    request,
    guestDbId,
    commercialBoundary.mode,
  ).catch(error => {
    console.error('THONGTHAI_BOUNDED_AVAILABILITY_CLARIFICATION_ERROR', error instanceof Error ? error.message.slice(0,220) : 'unknown');
    return null;
  });
  if (availabilityClarification) {
    const polished = polishedResponse(availabilityClarification, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message:polished.message,
      intent:polished.intent,
      contextUpdates:polished.contextUpdates,
      journeyAction:polished.journeyAction,
      suggestedActions:polished.suggestedActions,
    });
  }

  const horseComparison = await boundedHorseComparisonBeforePrimary(
    request,
    guestDbId,
  ).catch(error => {
    console.error('THONGTHAI_BOUNDED_HORSE_COMPARISON_ERROR', error instanceof Error ? error.message.slice(0,220) : 'unknown');
    return null;
  });
  if (horseComparison) {
    const polished = polishedResponse(horseComparison, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message:polished.message,
      intent:polished.intent,
      contextUpdates:polished.contextUpdates,
      journeyAction:polished.journeyAction,
      suggestedActions:polished.suggestedActions,
    });
  }

  const bookingStatusReadback = await verifiedBookingStatusReadbackBeforePrimary(
    request,
    guestDbId,
  ).catch(error => {
    console.error('THONGTHAI_VERIFIED_BOOKING_STATUS_READBACK_ERROR', error instanceof Error ? error.message.slice(0,220) : 'unknown');
    return null;
  });
  if (bookingStatusReadback) {
    const polished = polishedResponse(bookingStatusReadback, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message:polished.message,
      intent:polished.intent,
      contextUpdates:polished.contextUpdates,
      journeyAction:polished.journeyAction,
      suggestedActions:polished.suggestedActions,
    });
  }

  const safetyCriticalRestaurantRecommendation = await safetyCriticalRestaurantRecommendationBeforePrimary(
    request,
    guestDbId,
    channel,
  ).catch(error => {
    console.error('THONGTHAI_SAFETY_CRITICAL_RESTAURANT_RECOMMENDATION_ERROR', error instanceof Error ? error.message.slice(0,220) : 'unknown');
    return null;
  });
  if (safetyCriticalRestaurantRecommendation) {
    const polished = polishedResponse(safetyCriticalRestaurantRecommendation, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message:polished.message,
      intent:polished.intent,
      contextUpdates:polished.contextUpdates,
      journeyAction:polished.journeyAction,
      suggestedActions:polished.suggestedActions,
    });
  }

  const durableRestaurantRecommendation = await durableRestaurantRecommendationBeforeSemantic(
    request,
    guestDbId,
    channel,
    hadDurableRestaurantConstraintBeforeTurn,
  ).catch(error => {
    console.error('THONGTHAI_DURABLE_RESTAURANT_RECOMMENDATION_ERROR', error instanceof Error ? error.message.slice(0,220) : 'unknown');
    return null;
  });
  if (durableRestaurantRecommendation) {
    const polished = polishedResponse(durableRestaurantRecommendation, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message:polished.message,
      intent:polished.intent,
      contextUpdates:polished.contextUpdates,
      journeyAction:polished.journeyAction,
      suggestedActions:polished.suggestedActions,
    });
  }

  // Selection of the prepare-only canary is independent of the CURRENT
  // sentence's transaction wording. A later "ยืนยันส่งคำถาม", "เอาไว้ก่อน",
  // or status readback may contain no fresh จอง/สั่ง verb at all, but it still
  // belongs to the already-prepared draft. Probe that bounded draft state
  // before any model path; the probe returns null for unrelated turns.
  const prepareOnlyAgentSelected = shouldUseThongthaiAgentTransactionPrepare({
    guestKey: request.guestId,
    guestDbId,
    channel,
  });
  const prepareOnlyAgentEligible = transactionPrepareIntent && prepareOnlyAgentSelected;

  // Gate 0 latency guarantee: prepare and prepared-draft continuation turns
  // never need an LLM round trip. The runtime remains prepare-only: commit
  // tools are absent and independently hard-blocked server-side.
  if (prepareOnlyAgentSelected && guestDbId) {
    const preparedFast = await runPrepareOnlyMultiVerticalFastPath(
      request,
      guestDbId,
      channel,
      transportEventId,
    ).catch(error => {
      console.error(
        'THONGTHAI_AGENT_PREPARE_MULTI_FASTPATH_ERROR',
        error instanceof Error ? error.message.slice(0, 220) : 'unknown',
      );
      return null;
    }) ?? (prepareOnlyAgentEligible ? await prepareOnlyActivityFastPath(
      request,
      guestDbId,
      channel,
      transportEventId,
    ).catch(error => {
      console.error(
        'THONGTHAI_AGENT_PREPARE_FASTPATH_ERROR',
        error instanceof Error ? error.message.slice(0, 220) : 'unknown',
      );
      return null;
    }) : null);
    if (preparedFast) {
      const polished = polishedResponse(preparedFast, channel);
      try {
        await persistAiResponseTurn({
          conversationId:request.guestId,
          eventId:transportEventId,
          channel,
          finalResponseSource:'agent_prepare_fastpath',
          modelReplyUsed:false,
          groundedKnowledgeSupplied:true,
          zeroCostTurn:true,
          environment:'live',
          occurredAt:new Date().toISOString(),
        });
        explicitAiResponseTurnPersisted = true;
      } catch (error) {
        console.error(
          'AGENT_PREPARE_FASTPATH_RESPONSE_TURN_PERSIST_ERROR',
          error instanceof Error ? error.message.slice(0, 180) : 'unknown',
        );
      }
      return coreResult(200, {
        message:polished.message,
        intent:polished.intent,
        contextUpdates:polished.contextUpdates,
        journeyAction:polished.journeyAction,
        suggestedActions:polished.suggestedActions,
      });
    }
  }

  // A complete, explicitly-authorized transaction normally reaches its
  // established executor before the conversation-first composer. A guest in
  // the Agent prepare-only canary is the deliberate exception: suppress the
  // legacy write path so the Agent can prepare/review a draft while commit
  // remains impossible.
  const committedActivityDraft = activityBookingFallbackDraft(request);
  if (!prepareOnlyAgentEligible
      && committedActivityDraft
      && authorizedActivityBookingCommit(request)
      && missingActivityFallbackFields(committedActivityDraft).length === 0) {
    const executed = await executeDeterministicActivityBooking(
      committedActivityDraft,
      request,
      guestDbId,
      channel,
    );
    const polished = polishedResponse(executed, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  const committedExactStay = prepareOnlyAgentEligible
    ? null
    : await explicitStayBookingFallback(request, guestDbId, channel).catch(error => {
        console.error('THONGTHAI_PRE_SUPERVISION_STAY_FALLBACK_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
        return null;
      });
  if (committedExactStay) {
    const polished = polishedResponse(committedExactStay, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  // Location is an owner-verified deterministic fact class. Preserve it
  // before semantic supervision using the same local-concierge classifier
  // that owns the final response. This specifically covers natural phrasing
  // such as "ร้านอยู่แถวไหนคะ", which the top-level semantic intent parser
  // does not necessarily label as LOCATION_REQUEST.
  const preserveVerifiedLocationBeforeSupervision = !hasExplicitTransactionIntent(request.message)
    && classifyLocalConciergeQuestion(request.message)?.category === 'location';

  // Narrow production hotfix for a COMPLETE visitor-journey request.
  //
  // Do NOT bypass semantic supervision for the whole Local Concierge family:
  // bare companion/preference turns feed semantic concept memory, and grounded
  // horse comparisons deliberately use the model-owned final composer. The
  // real Messenger failure was a much narrower shape: the customer already
  // supplied (1) a time budget, (2) party context, and (3) a pace/mood, so the
  // canonical visitor-journey responder has everything it needs and paying a
  // semantic call can only produce the generic recommendation-without-facts
  // fallback. Preserve ONLY that complete, non-transactional planning class
  // before Agent Primary / early One-Mind.
  const localConciergeBeforeSupervision = !hasExplicitTransactionIntent(request.message)
    ? classifyLocalConciergeQuestion(request.message)
    : null;
  const completeVisitorJourneyBeforeSupervision =
    localConciergeBeforeSupervision?.category === 'visitor_journey'
    && /(?:มีเวลา|ชั่วโมง|ชม\.?|นาที|ครึ่งวัน|เต็มวัน|ค้างคืน|\d+\s*คืน)/u.test(request.message)
    && /(?:คนเดียว|มากับ(?:แฟน|ครอบครัว|เด็ก|ผู้ใหญ่|เพื่อน|แม่|พ่อ|ลูก)|มีเด็ก|มีผู้สูงอายุ|พา(?:แฟน|แม่|พ่อ|ลูก)มา)/u.test(request.message)
    && /(?:ชิล|ไม่รีบ|พักใจ|ไม่อยากเดินเยอะ|ลุย|ผจญภัย|จัดทริป|จัดแผน|จัดโปรแกรม)/u.test(request.message);

  const phase3SemanticLearningEligible = !explicitTransactionIntent
    && topLevelSemanticIntent !== 'WEATHER_REQUEST'
    && !preserveVerifiedLocationBeforeSupervision
    && !completeVisitorJourneyBeforeSupervision
    && isShortStandaloneConceptCandidate(request.message)
    && isPhase3SemanticLearningCandidate(request.message);

  // Thongthai Saved-Agent production routing.
  //
  // Ordinary turns follow the proven read-only rollout. Explicit transaction
  // turns may enter only through the separate prepare-only canary. In that
  // mode the Agent may persist a review draft but cannot cross the commit
  // boundary. Weather/location stay on their established paths.
  // Keep the Phase 4 source-level contract explicit: commercial planning /
  // withholding already had first refusal over the 100% read-only Agent.
  const phase4CommercialBoundaryEligible =
    commercialBoundary.routeToOneMindBeforePrimary;

  const activeTaskBeforePrimary = !prepareOnlyAgentEligible
    && await hasActiveTaskBeforePrimary(guestDbId);
  const boundedConversationBeforePrimary = !prepareOnlyAgentEligible
    && await hasConversationContextBeforePrimary(guestDbId);

  // Phase 7 continuation authority:
  // - non-terminal ActiveTask, OR
  // - bounded ConversationContext carrying a considered selection/task ref
  // owns the turn before read-only Agent Primary.
  // Prepare-only routing remains separately authorized and unchanged.
  const directHorseAlternative = directOtherHorseCorrectionResponse(request);
  if (directHorseAlternative) {
    const polished = polishedResponse(directHorseAlternative, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  const horseCorrectionBeforePrimary = horseCorrectionRoutesBeforePrimary(request);
  const cafeStateForPrePrimary = await cafeStateBeforePrimary(request, guestDbId);
  const cafeReadOnlyBeforePrimary = cafeStateForPrePrimary !== null;

  // Narrow cafe -> restaurant topic-switch fast path. It exists only for an
  // EXPLICIT restaurant/menu discovery in the current sentence. Do not use
  // the broad restaurant advisor classifier here: that classifier also
  // considers history/memory and would steal unrelated food-culture,
  // availability, correction, and cross-domain turns before the semantic
  // brain sees them.
  const restaurantTopicSwitchBeforePrimary =
    !explicitTransactionIntent
    && /(?:ร้านอาหาร|ตำมา-ชาติ|ตำมา)/u.test(request.message)
    && /(?:เมนู|มีอะไร|แนะนำ|กินอะไร|อะไรกิน|ไรกิน|อะไรอร่อย)/u.test(request.message)
    && !/(?:โต๊ะ|ว่าง|สถานะ|กี่โมง|จอง|สั่ง|ยืนยัน)/u.test(request.message);

  const readOnlyPrimaryAgentEligible = !phase3SemanticLearningEligible
    && !restaurantTopicSwitchBeforePrimary
    && !completeVisitorJourneyBeforeSupervision
    && !cafeReadOnlyBeforePrimary
    && !phase4CommercialBoundaryEligible
    && !horseCorrectionBeforePrimary
    && !activeTaskBeforePrimary
    && !boundedConversationBeforePrimary
    && shouldUseThongthaiAgentPrimary({
    guestKey: request.guestId,
    guestDbId,
    channel,
    explicitTransactionIntent,
    weatherRequest: topLevelSemanticIntent === 'WEATHER_REQUEST',
    locationRequest: preserveVerifiedLocationBeforeSupervision
      || topLevelSemanticIntent === 'LOCATION_REQUEST',
  });
  const primaryAgentEligible = prepareOnlyAgentEligible || readOnlyPrimaryAgentEligible;

  if (cafeReadOnlyBeforePrimary) {
    const cafeResponse = await deterministicCafeResponse(request, {
      agentState: cafeStateForPrePrimary ?? {},
    });
    if (cafeResponse) {
      const polished = polishedResponse(cafeResponse, channel);
      await persistBrainRuntime(guestDbId, channel, polished);
      try {
        const currentContext = await loadConversationContext(guestDbId);
        const nextContext = applyConversationContextUpdate(currentContext, {
          eventId: transportEventId,
          channel,
          userMessage: request.message,
          assistantMessage: polished.message,
          activeDomain: 'cafe',
          activeTopic: 'cafe',
        });
        await persistConversationContext(guestDbId, nextContext);
      } catch (error) {
        console.error(
          'THONGTHAI_CAFE_CONTEXT_MIRROR_ERROR',
          error instanceof Error ? error.message.slice(0,180) : 'unknown',
        );
      }
      return coreResult(200, {
        message: polished.message,
        intent: polished.intent,
        contextUpdates: polished.contextUpdates,
        journeyAction: polished.journeyAction,
        suggestedActions: polished.suggestedActions,
      });
    }
  }

  if (primaryAgentEligible && guestDbId) {
    try {
      const agentTurn = await runThongthaiAgentPrimaryTurn({
        guestDbId,
        conversationId: request.guestId,
        eventId: transportEventId,
        channel,
        message: request.message,
        memoryContext: {
          travelerType: request.guestContext.travelerType,
          group: request.guestContext.group,
          interests: request.guestContext.interests,
          pace: request.guestContext.pace,
          budget: request.guestContext.budget,
          constraints: request.guestContext.constraints,
        },
        transactionMode: prepareOnlyAgentEligible ? 'prepare' : 'off',
      });

      const primaryResponse = polishedResponse({
        message: agentTurn.output,
        intent: 'information',
        contextUpdates: {},
        journeyAction: { type: 'none', journey: null },
        suggestedActions: [],
        responseStyle: 'direct',
        semanticMemoryUpdates: [],
        toolCalls: [],
      }, channel);

      // runThongthaiAgentPrimaryTurn already persists the primary session and
      // minimal legacy runtime fields in one CAS write. Do not repeat the full
      // persistBrainRuntime path here (another CAS read/write plus guest-event
      // insert) on the customer-response critical path.
      try {
        await persistAiResponseTurn({
          conversationId: request.guestId,
          eventId: transportEventId,
          channel,
          finalResponseSource: 'thongthai_agent_primary',
          modelReplyUsed: true,
          groundedKnowledgeSupplied: agentTurn.toolCalls.length > 0,
          zeroCostTurn: false,
          environment: 'live',
          occurredAt: new Date().toISOString(),
        });
        explicitAiResponseTurnPersisted = true;
      } catch (error) {
        console.error(
          'AGENT_PRIMARY_RESPONSE_TURN_PERSIST_ERROR',
          error instanceof Error ? error.message.slice(0, 180) : 'unknown',
        );
      }

      console.log('THONGTHAI_AGENT_PRIMARY_RESPONSE', JSON.stringify({
        channel,
        toolCalls: agentTurn.toolCalls,
        createdSession: agentTurn.createdSession,
        turnCostThb: agentTurn.usage.costThb,
        conversationCostThb: agentTurn.cumulativeCostThb,
      }));

      // Messenger/LINE do not send chatHistory on the next webhook. Mirror
      // every successful Agent turn into the same bounded server-side
      // ConversationContext used by One-Mind so a later budget/provider
      // fallback still knows what the customer and Agent just discussed.
      try {
        const currentContext = await loadConversationContext(guestDbId);
        const nextContext = applyConversationContextUpdate(currentContext, {
          eventId: transportEventId,
          channel,
          userMessage: request.message,
          assistantMessage: primaryResponse.message,
        });
        await persistConversationContext(guestDbId, nextContext);
      } catch (error) {
        console.error(
          'THONGTHAI_AGENT_CONTEXT_MIRROR_ERROR',
          error instanceof Error ? error.message.slice(0,180) : 'unknown',
        );
      }

      return coreResult(200, {
        message: primaryResponse.message,
        intent: primaryResponse.intent,
        contextUpdates: primaryResponse.contextUpdates,
        journeyAction: primaryResponse.journeyAction,
        suggestedActions: primaryResponse.suggestedActions,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error ?? 'unknown');
      console.error('THONGTHAI_AGENT_PRIMARY_ERROR', detail.slice(0,260));

      // These two failures happen before a new paid Agent turn is sent. Do not
      // punish the customer with the old "คิดช้า ลองใหม่" loop: safely fall
      // through to One-Mind/deterministic responders, whose own cost ledger
      // still enforces the same <=5 THB conversation cap.
      if (isAgentPreflightBudgetGuard(error)) {
        console.log('THONGTHAI_AGENT_PRIMARY_BUDGET_FALLTHROUGH', JSON.stringify({ channel }));
      } else {
        // For provider/tool failures after an Agent attempt, keep the
        // no-double-spend rule: do not launch another paid model path.
        const fallback = polishedResponse(
          degradedFallbackResponse(categorizeDegradedFallback(request.message)),
          channel,
        );
        await persistBrainRuntime(guestDbId, channel, fallback);
        return coreResult(200, {
          message: fallback.message,
          intent: fallback.intent,
          contextUpdates: fallback.contextUpdates,
          journeyAction: fallback.journeyAction,
          suggestedActions: fallback.suggestedActions,
        });
      }
    }
  }

  // Human Conversation Recovery: UNDERSTAND FIRST.
  //
  // Safety/escalation/service-feedback responders above may remain
  // deterministic because they are guardrails. Ordinary customer language
  // reaches One-Mind BEFORE pending-question matchers, horse/stay/activity
  // regex responders, or other legacy domain routers. If One-Mind says the
  // turn needs a real transaction executor, it returns legacy_required and
  // the unchanged executor path below still owns the write.
  if (process.env.THONGTHAI_ONE_MIND_CUTOVER === '1'
      && !preserveVerifiedLocationBeforeSupervision
      && !completeVisitorJourneyBeforeSupervision
      && !restaurantTopicSwitchBeforePrimary
      && topLevelSemanticIntent !== 'WEATHER_REQUEST') {
    try {
      const oneMind = await processOneMindCustomerTurn({
        channel,
        language:request.language,
        message:request.message,
        eventId:transportEventId,
        providerUserKey:providerUserKey ?? request.guestId,
        canonicalAnonymousId:request.guestId,
        guestDbId,
        durableMemory:durableMemoryFromRequest(request),
        persistState:true,
      }, {}, {}, undefined, { requireSemanticSupervisor:true });
      // Production cost invariant: at most one paid semantic call per
      // customer turn. This early attempt already spent it (or already
      // knows the provider is unavailable) -- record the result so every
      // later consumer in this request (supervisedRestaurantStatus below,
      // and the cachedSemantic reuse in the second One-Mind attempt further
      // down) sees it, instead of silently discarding it and paying for
      // interpretSemanticTurn a second time for the same request.
      earlyOneMind = oneMind;
      await recordOneMindTrace(oneMind.observability);

      // Phase 5 post-understanding router. This closes the gap where OpenAI
      // correctly understood a complaint/help/incident phrased outside the
      // narrow raw deterministic vocabulary, but the composed answer returned
      // before any durable ops_feedback_events case was created. Structured
      // INCIDENT meaning now becomes an operational case BEFORE any business
      // or transaction continuation. Phase 4's commercial boundary is not
      // changed; this is an even earlier incident-precedence guard.
      const routedMeaning = oneMind.turn.semanticMeaning
        ?? deriveSemanticMeaning(oneMind.turn.dialogSemanticTurn);
      const semanticBusinessIncidentRoute = classifySemanticBusinessIncidentRoute(routedMeaning);
      console.log('THONGTHAI_BUSINESS_INCIDENT_ROUTE', JSON.stringify({
        stage:'semantic',
        kind:semanticBusinessIncidentRoute.kind,
        lane:semanticBusinessIncidentRoute.lane,
        businessUnit:semanticBusinessIncidentRoute.businessUnit,
        domain:routedMeaning.domain,
        speechAct:routedMeaning.speechAct,
      }));
      const semanticIncidentSourceTrusted = oneMind.turn.semanticTurn.semanticSource === 'openai_supervisor'
        || oneMind.turn.semanticTurn.semanticSource === 'semantic_concept_memory';
      if (semanticBusinessIncidentRoute.kind === 'semantic_incident' && semanticIncidentSourceTrusted) {
        const incidentMatch = semanticIncidentFeedbackMatch(routedMeaning);
        const eventResult = await createFeedbackEvent({
          match:incidentMatch,
          message:request.message,
          channel,
          guestDbId,
          sourceEventKey:transportEventId,
        });
        const incidentResponse = polishedResponse({
          message:composeSemanticIncidentResponse(
            incidentMatch,
            eventResult.eventId != null,
            eventResult.targets,
            request.language,
          ),
          intent:'information',
          contextUpdates:{},
          journeyAction:{type:'none',journey:null},
          suggestedActions:[],
          responseStyle:'direct',
          semanticMemoryUpdates:[],
          toolCalls:[],
        }, channel);
        await persistBrainRuntime(guestDbId, channel, incidentResponse);
        return coreResult(200, {
          message:incidentResponse.message,
          intent:incidentResponse.intent,
          contextUpdates:incidentResponse.contextUpdates,
          journeyAction:incidentResponse.journeyAction,
          suggestedActions:incidentResponse.suggestedActions,
        });
      }

      // Only a real OpenAI-owned interpretation consumes the early semantic
      // slot. If the supervisor is unavailable, leave the later proven
      // deterministic One-Mind compatibility cutover available.
      oneMindAttemptedEarly = oneMind.turn.semanticTurn.semanticSource === 'openai_supervisor';
      // Cost guard hotfix: this gate used to accept ONLY an openai_supervisor
      // result, so a genuinely zero-cost deterministic_fallback answer
      // (isTrustedZeroCostFactLookup already proved it unambiguous enough to
      // skip the paid semantic-interpreter call -- see
      // _thongthai-one-mind-orchestrator.ts) was discarded here and the turn
      // fell through into a legacy path that paid for grounded-response-
      // composition anyway. Confirmed directly against production
      // ai_api_cost_events: "เป็ดน้ำเท่าไหร่"/"ขี่ม้ากี่บาท" correctly skipped
      // semantic-interpreter but still logged a real grounded-response-
      // composition charge, because this gate threw away their correct,
      // free, already-composed answer. This accepts that SAME narrow,
      // reviewed allowlist here too -- never any deterministic_fallback
      // result, only the ones the cost architecture already trusts enough to
      // have skipped the paid call for in the first place.
      const trustedZeroCostReady = oneMind.status === 'composed'
        && oneMind.turn.semanticTurn.semanticSource === 'deterministic_fallback'
        && oneMind.response.mode === 'deterministic'
        && isTrustedZeroCostFactLookup(oneMind.turn.dialogSemanticTurn, request.message);
      const trustedBoundedNoTransactionReady = oneMind.status === 'composed'
        && oneMind.turn.semanticTurn.semanticSource === 'deterministic_fallback'
        && oneMind.response.mode === 'deterministic'
        && isTrustedBoundedNoTransactionContinuation(oneMind.turn);
      const learnedSemanticReady = oneMind.status === 'composed'
        && oneMind.turn.semanticTurn.semanticSource === 'semantic_concept_memory';
      const supervisedMeaningReady = (oneMind.status === 'composed'
        && oneMind.turn.semanticTurn.semanticSource === 'openai_supervisor')
        || learnedSemanticReady
        || trustedZeroCostReady
        || trustedBoundedNoTransactionReady;
      if (supervisedMeaningReady) {
        console.log('THONGTHAI_HUMAN_CONVERSATION_FIRST', JSON.stringify({
          domain:oneMind.turn.semanticTurn.domain,
          action:oneMind.turn.semanticTurn.action,
          responseIntent:oneMind.turn.dialogDecision.responseIntent,
          composerMode:oneMind.response.mode,
          stateConflictRetries:oneMind.turn.trace.stateConflictRetries ?? 0,
        }));
        const responseFromSystem = {
          message:oneMind.response.message,
          intent:oneMind.turn.semanticTurn.action === 'recommend'
            || oneMind.turn.semanticTurn.action === 'discover'
            ? 'recommendation'
            : 'information',
          contextUpdates:{},
          journeyAction:{type:'none' as const, journey:null},
          suggestedActions:[],
          responseStyle:'direct' as const,
          semanticMemoryUpdates:[],
          toolCalls:[],
        };
        const supervisedResponse = polishedResponse(responseFromSystem, channel);
        await persistBrainRuntime(guestDbId, channel, supervisedResponse);
        return coreResult(200, {
          message:supervisedResponse.message,
          intent:supervisedResponse.intent,
          contextUpdates:supervisedResponse.contextUpdates,
          journeyAction:supervisedResponse.journeyAction,
          suggestedActions:supervisedResponse.suggestedActions,
        });
      }
      console.log('THONGTHAI_HUMAN_CONVERSATION_LEGACY_REQUIRED', JSON.stringify({
        reason:oneMind.status === 'legacy_required'
          ? oneMind.reason
          : 'semantic_supervisor_unavailable',
        domain:oneMind.turn.semanticTurn.domain,
        action:oneMind.turn.semanticTurn.action,
        semanticSource:oneMind.turn.semanticTurn.semanticSource ?? 'unknown',
      }));
    } catch (error) {
      // Strangler safety during recovery: language-first failure must not take
      // down the existing product. Legacy remains a fallback until the full
      // conversation acceptance suite is green.
      console.error(
        'THONGTHAI_HUMAN_CONVERSATION_FIRST_ERROR',
        error instanceof Error ? error.message.slice(0, 220) : 'unknown',
      );
    }
  }

  // Human Core PR D: a usable OpenAI-owned Activity interpretation is a
  // TERMINAL routing decision. It may render a structured response or execute
  // an explicitly-authorized structured proposal, but it may never continue
  // into the legacy Activity raw-text cascade or the legacy general LLM.
  // Provider-outage/deterministic interpretations intentionally return null
  // here and retain the bounded compatibility fallback below.
  const supervisedActivity = earlyOneMind
    ? resolveSupervisedActivityCutover(earlyOneMind, channel, request.language)
    : null;
  if (supervisedActivity?.kind === 'execute_booking') {
    const executed = await executeDeterministicActivityBooking(
      supervisedActivity.args,
      request,
      guestDbId,
      channel,
    );
    const polished = polishedResponse(executed, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }
  if (supervisedActivity?.kind === 'respond') {
    const semantic = earlyOneMind!.turn.semanticTurn;
    const polished = polishedResponse({
      message: supervisedActivity.response.message,
      intent: semantic.action === 'discover' || semantic.action === 'recommend'
        ? 'recommendation'
        : 'information',
      contextUpdates: {},
      journeyAction: { type: 'none', journey: null },
      suggestedActions: [],
      responseStyle: 'direct',
      semanticMemoryUpdates: [],
      toolCalls: [],
    }, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  const deterministicActivityPlanning = earlyOneMind
    ? resolveDeterministicActivityPlanningCutover(earlyOneMind, channel, request.language, request.message)
    : null;
  if (deterministicActivityPlanning?.kind === 'respond') {
    const semantic = earlyOneMind!.turn.dialogSemanticTurn;
    const polished = polishedResponse({
      message:deterministicActivityPlanning.response.message,
      intent:'information',
      contextUpdates:{},
      journeyAction:{type:'none',journey:null},
      suggestedActions:[],
      responseStyle:'direct',
      semanticMemoryUpdates:[],
      toolCalls:[],
    }, channel);

    // legacy_required does not persist One-Mind state. Preserve this safe
    // consider/correction turn explicitly in ConversationContext so LINE
    // continuity survives the provider outage without opening a booking task.
    if (guestDbId) {
      const selectedHorse = typeof semantic.entities.horseName === 'string'
        ? semantic.entities.horseName.trim().replace(/^น้อง/u, '')
        : '';
      if (selectedHorse) {
        // Preserve the same bounded planning-state contract every other horse
        // selection uses. persistHorseSelection writes only non-committed task
        // slots; it does not create a booking or authorize a transaction.
        await persistHorseSelection(guestDbId, channel, selectedHorse);
      }

      const currentContext = await loadConversationContext(guestDbId);
      const nextContext = applyConversationContextUpdate(currentContext, {
        eventId:transportEventId,
        channel,
        userMessage:request.message,
        assistantMessage:polished.message,
        activeDomain:'activity',
        lastAction:semantic.action,
        semanticTurn:semantic,
      });
      await persistConversationContext(guestDbId, nextContext);
    }

    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message:polished.message,
      intent:polished.intent,
      contextUpdates:polished.contextUpdates,
      journeyAction:polished.journeyAction,
      suggestedActions:polished.suggestedActions,
    });
  }

  // Human Core PR E: the equivalent terminal boundary for Stay. A usable
  // OpenAI-owned Stay meaning cannot reach homestayFactsResponse, any other
  // raw-text Stay responder, or runThongthaiBrain below this point.
  const supervisedStay = earlyOneMind
    ? resolveSupervisedStayCutover(earlyOneMind, channel, request.language)
    : null;
  const deterministicStayTransaction = earlyOneMind
    ? resolveDeterministicStayTransactionCutover(earlyOneMind)
    : null;
  const stayBookingArgs = supervisedStay?.kind === 'execute_booking'
    ? supervisedStay.args
    : deterministicStayTransaction?.args;
  if (stayBookingArgs) {
    const executed = await executeDeterministicStayBooking(stayBookingArgs, request, guestDbId, channel);
    const polished = polishedResponse(executed, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message:polished.message,
      intent:polished.intent,
      contextUpdates:polished.contextUpdates,
      journeyAction:polished.journeyAction,
      suggestedActions:polished.suggestedActions,
    });
  }
  // A fully-labelled request with one exact live property must not be
  // downgraded into the supervised read-only response below. This fallback
  // still fails closed on ambiguous room-type text and stores only a pending
  // request when no schedule exists.
  const exactStayFallback = await explicitStayBookingFallback(request,guestDbId,channel).catch(error => {
    console.error('THONGTHAI_EXACT_STAY_FALLBACK_ERROR', error instanceof Error ? error.message.slice(0,220) : 'unknown');
    return null;
  });
  if(exactStayFallback) {
    const polished=polishedResponse(exactStayFallback,channel);
    await persistBrainRuntime(guestDbId,channel,polished);
    return coreResult(200,{
      message:polished.message,intent:polished.intent,contextUpdates:polished.contextUpdates,
      journeyAction:polished.journeyAction,suggestedActions:polished.suggestedActions,
    });
  }
  if (supervisedStay?.kind === 'respond') {
    const semantic = earlyOneMind!.turn.semanticTurn;
    const polished = polishedResponse({
      message:supervisedStay.response.message,
      intent:semantic.action === 'discover' || semantic.action === 'recommend' ? 'recommendation' : 'information',
      contextUpdates:{}, journeyAction:{ type:'none', journey:null }, suggestedActions:[],
      responseStyle:'direct', semanticMemoryUpdates:[], toolCalls:[],
    }, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message:polished.message,
      intent:polished.intent,
      contextUpdates:polished.contextUpdates,
      journeyAction:polished.journeyAction,
      suggestedActions:polished.suggestedActions,
    });
  }

  // Human Core PR F: terminal Restaurant cutover. A usable supervised
  // Restaurant meaning must end here and never reach legacy restaurant
  // advisor/preorder raw-text parsing or the legacy general LLM below.
  const supervisedRestaurant = earlyOneMind
    ? resolveSupervisedRestaurantCutover(earlyOneMind, channel, request.language)
    : null;
  if (supervisedRestaurant?.kind === 'execute_table_booking') {
    const executed = await executeDeterministicRestaurantTableBooking(
      supervisedRestaurant.args,
      request,
      guestDbId,
      channel,
    );
    const polished = polishedResponse(executed, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message:polished.message,
      intent:polished.intent,
      contextUpdates:polished.contextUpdates,
      journeyAction:polished.journeyAction,
      suggestedActions:polished.suggestedActions,
    });
  }
  if (supervisedRestaurant?.kind === 'execute_preorder') {
    const executed = await executeDeterministicRestaurantPreorder(
      supervisedRestaurant.args,
      request,
      guestDbId,
      channel,
    );
    const polished = polishedResponse(executed, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message:polished.message,
      intent:polished.intent,
      contextUpdates:polished.contextUpdates,
      journeyAction:polished.journeyAction,
      suggestedActions:polished.suggestedActions,
    });
  }
  if (supervisedRestaurant?.kind === 'respond') {
    const semantic = earlyOneMind!.turn.semanticTurn;
    const polished = polishedResponse({
      message:supervisedRestaurant.response.message,
      intent:semantic.action === 'discover' || semantic.action === 'recommend' ? 'recommendation' : 'information',
      contextUpdates:{}, journeyAction:{type:'none',journey:null}, suggestedActions:[],
      responseStyle:'direct', semanticMemoryUpdates:[], toolCalls:[],
    }, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message:polished.message,
      intent:polished.intent,
      contextUpdates:polished.contextUpdates,
      journeyAction:polished.journeyAction,
      suggestedActions:polished.suggestedActions,
    });
  }

  // Human Core PR G: terminal Promotion boundary. Supervised Promotion
  // cannot reach promotionContinuationResponse, raw promotion matchers, or
  // runThongthaiBrain below this point.
  const supervisedPromotion=earlyOneMind
    ? resolveSupervisedPromotionCutover(earlyOneMind,channel,request.language)
    : null;
  if(supervisedPromotion?.kind==='execute_redemption') {
    const executed=await executeDeterministicPromotionRedemption(
      supervisedPromotion.args,request,guestDbId,channel,
    );
    const polished=polishedResponse(executed,channel);
    await persistBrainRuntime(guestDbId,channel,polished);
    return coreResult(200,{
      message:polished.message,intent:polished.intent,
      contextUpdates:polished.contextUpdates,journeyAction:polished.journeyAction,
      suggestedActions:polished.suggestedActions,
    });
  }
  if(supervisedPromotion?.kind==='respond') {
    const semantic=earlyOneMind!.turn.semanticTurn;
    const polished=polishedResponse({
      message:supervisedPromotion.response.message,
      intent:semantic.action==='discover'||semantic.action==='recommend'?'recommendation':'information',
      contextUpdates:{},journeyAction:{type:'none',journey:null},suggestedActions:[],
      responseStyle:'direct',semanticMemoryUpdates:[],toolCalls:[],
    },channel);
    await persistBrainRuntime(guestDbId,channel,polished);
    return coreResult(200,{
      message:polished.message,intent:polished.intent,
      contextUpdates:polished.contextUpdates,journeyAction:polished.journeyAction,
      suggestedActions:polished.suggestedActions,
    });
  }

  // Human Core PR H: terminal Cafe boundary. Supervised Cafe cannot reach
  // deterministicCafeResponse's raw-text keyword gate or runThongthaiBrain
  // below this point.
  const supervisedCafe = earlyOneMind
    ? resolveSupervisedCafeCutover(earlyOneMind, channel, request.language)
    : null;
  if (supervisedCafe?.kind === 'execute_inquiry') {
    const executed = await executeDeterministicCafeInquiry(
      supervisedCafe.args,
      request,
      guestDbId,
      channel,
    );
    const polished = polishedResponse(executed, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message:polished.message,
      intent:polished.intent,
      contextUpdates:polished.contextUpdates,
      journeyAction:polished.journeyAction,
      suggestedActions:polished.suggestedActions,
    });
  }
  if (supervisedCafe?.kind === 'respond') {
    const semantic = earlyOneMind!.turn.semanticTurn;
    const polished = polishedResponse({
      message:supervisedCafe.response.message,
      intent:semantic.action === 'discover' || semantic.action === 'recommend' ? 'recommendation' : 'information',
      contextUpdates:{}, journeyAction:{type:'none',journey:null}, suggestedActions:[],
      responseStyle:'direct', semanticMemoryUpdates:[], toolCalls:[],
    }, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message:polished.message,
      intent:polished.intent,
      contextUpdates:polished.contextUpdates,
      journeyAction:polished.journeyAction,
      suggestedActions:polished.suggestedActions,
    });
  }

  // Terminal OTOP boundary. A validated purchase must execute here instead
  // of falling through into legacy Restaurant/menu responders.
  const supervisedOtop=earlyOneMind
    ? resolveSupervisedOtopCutover(earlyOneMind,channel,request.language)
    : null;
  if(supervisedOtop?.kind==='execute_order') {
    const executed=await executeDeterministicOtopOrder(
      supervisedOtop.args,request,guestDbId,channel,
    );
    const polished=polishedResponse(executed,channel);
    await persistBrainRuntime(guestDbId,channel,polished);
    return coreResult(200,{
      message:polished.message,intent:polished.intent,
      contextUpdates:polished.contextUpdates,journeyAction:polished.journeyAction,
      suggestedActions:polished.suggestedActions,
    });
  }
  if(supervisedOtop?.kind==='respond') {
    const semantic=earlyOneMind!.turn.semanticTurn;
    const polished=polishedResponse({
      message:supervisedOtop.response.message,
      intent:semantic.action==='discover'||semantic.action==='recommend'?'recommendation':'information',
      contextUpdates:{},journeyAction:{type:'none',journey:null},suggestedActions:[],
      responseStyle:'direct',semanticMemoryUpdates:[],toolCalls:[],
    },channel);
    await persistBrainRuntime(guestDbId,channel,polished);
    return coreResult(200,{
      message:polished.message,intent:polished.intent,
      contextUpdates:polished.contextUpdates,journeyAction:polished.journeyAction,
      suggestedActions:polished.suggestedActions,
    });
  }

  // Phase 2 closeout — resolve the answer to Thongthai's own persisted
  // question before ordinary domain routing. Safety/authority + service
  // feedback remain above this block. If the customer states a clear new
  // domain instead, the resolver clears only that stale pending question and
  // yields, so location/weather/horse/ATV/etc. continue through their normal
  // authoritative responders below.
  const pendingQuestionContinuation = await pendingQuestionContinuationResponse(request, guestDbId, channel).catch(error => {
    console.error(
      'THONGTHAI_PENDING_QUESTION_CONTINUATION_ERROR',
      error instanceof Error ? error.message.slice(0, 220) : 'unknown',
    );
    return null;
  });
  if (pendingQuestionContinuation) {
    console.log('SEMANTIC_RESPONDER_SELECTED', JSON.stringify({ responder: 'pendingQuestionContinuationResponse' }));
    const polished = polishedResponse(pendingQuestionContinuation, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  // Phase 2 stabilization — meaning-first semantic gate. Explicit location
  // and weather questions are answered BEFORE any horse/activity continuation
  // can inspect entity tokens or stale task state. Safety/escalation and
  // service feedback remain above this block and keep higher precedence.
  if (topLevelSemanticIntent === 'LOCATION_REQUEST' || topLevelSemanticIntent === 'WEATHER_REQUEST') {
    const semanticConcierge = await deterministicLocalConciergeResponse(request).catch(error => {
      console.error('THONGTHAI_SEMANTIC_GATE_CONCIERGE_ERROR', error instanceof Error ? redactWeatherUrl(error.message.slice(0, 220)) : 'unknown');
      return null;
    });
    if (semanticConcierge) {
      console.log('SEMANTIC_RESPONDER_SELECTED', JSON.stringify({ responder: 'semanticGateLocalConcierge', intent: topLevelSemanticIntent }));
      const polished = polishedResponse(semanticConcierge, channel);
      await persistBrainRuntime(guestDbId, channel, polished);
      return coreResult(200, {
        message: polished.message,
        intent: polished.intent,
        contextUpdates: polished.contextUpdates,
        journeyAction: polished.journeyAction,
        suggestedActions: polished.suggestedActions,
      });
    }
  }

  const botAddress = deterministicBotAddressResponse(request);
  if (botAddress) {
    console.log('SEMANTIC_RESPONDER_SELECTED', JSON.stringify({ responder: 'deterministicBotAddressResponse' }));
    const polished = polishedResponse(botAddress, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  // Semantic care/risk signals that can arrive at almost any point in the
  // horse-care conversation -- fear/concern instead of a direct slot
  // answer, a "ปลอดภัยไหม" safety question, a compound opening message
  // naming a family/elderly/child/health context, or a weather/ground
  // concern. Checked BEFORE activityBookingFallbackResponse: that
  // responder's own asset/duration-driven draft logic has no concept of
  // care signals and would otherwise silently start (or continue) a plain
  // booking, swallowing the very information this section exists to
  // notice -- see each responder's own doc comment for the specific
  // production gap it closes.
  const horseFear = await horseCareFearResponse(request, guestDbId).catch(error => {
    console.error('THONGTHAI_HORSE_FEAR_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
    return null;
  });
  if (horseFear) {
    console.log('SEMANTIC_RESPONDER_SELECTED', JSON.stringify({ responder: 'horseCareFearResponse' }));
    const polished = polishedResponse(horseFear, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  const horseSafety = await horseSafetyQuestionResponse(request, guestDbId).catch(error => {
    console.error('THONGTHAI_HORSE_SAFETY_QUESTION_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
    return null;
  });
  if (horseSafety) {
    console.log('SEMANTIC_RESPONDER_SELECTED', JSON.stringify({ responder: 'horseSafetyQuestionResponse' }));
    const polished = polishedResponse(horseSafety, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  const horseCompoundCare = await horseCompoundCareIntentResponse(request, guestDbId, channel).catch(error => {
    console.error('THONGTHAI_HORSE_COMPOUND_CARE_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
    return null;
  });
  if (horseCompoundCare) {
    console.log('SEMANTIC_RESPONDER_SELECTED', JSON.stringify({ responder: 'horseCompoundCareIntentResponse' }));
    const polished = polishedResponse(horseCompoundCare, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  const horseScenario = await horseScenarioSignalResponse(request, guestDbId, channel).catch(error => {
    console.error('THONGTHAI_HORSE_SCENARIO_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
    return null;
  });
  if (horseScenario) {
    console.log('SEMANTIC_RESPONDER_SELECTED', JSON.stringify({ responder: 'horseScenarioSignalResponse' }));
    const polished = polishedResponse(horseScenario, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  const atvCare = await atvCareIntentResponse(request, guestDbId, channel).catch(error => {
    console.error('THONGTHAI_ATV_CARE_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
    return null;
  });
  if (atvCare) {
    console.log('SEMANTIC_RESPONDER_SELECTED', JSON.stringify({ responder: 'atvCareIntentResponse' }));
    const polished = polishedResponse(atvCare, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  const archeryCare = await archeryCareIntentResponse(request, guestDbId, channel).catch(error => {
    console.error('THONGTHAI_ARCHERY_CARE_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
    return null;
  });
  if (archeryCare) {
    console.log('SEMANTIC_RESPONDER_SELECTED', JSON.stringify({ responder: 'archeryCareIntentResponse' }));
    const polished = polishedResponse(archeryCare, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  const homestayFacts = homestayFactsResponse(request);
  if (homestayFacts) {
    const polished = polishedResponse(homestayFacts, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  const ecosystemFirstVisit = ecosystemFirstVisitResponse(request);
  if (ecosystemFirstVisit) {
    const polished = polishedResponse(ecosystemFirstVisit, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  const earlyActivityFallback = await activityBookingFallbackResponse(request, guestDbId, channel).catch(error => {
    console.error('THONGTHAI_ACTIVITY_HISTORY_FALLBACK_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
    return null;
  });
  if (earlyActivityFallback) {
    console.log('ACTIVITY_BOOKING_FALLBACK_SELECTED', JSON.stringify({ responder: 'activityBookingFallbackResponse' }));
    const polished = polishedResponse(earlyActivityFallback, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  // A bare, ambiguous horse-name mention with no active booking context
  // (see bareHorseSelectionClarification's own header comment) -- checked
  // right after the activity-booking fallback returned nothing, and
  // BEFORE the One-Mind orchestrator would otherwise see the message and
  // silently open a booking task via its own, separate asset-selection
  // check. Internally yields on feedback/comparison-shaped messages and
  // on any already-open task, so it never overrides those.
  const bareHorseClarification = await bareHorseSelectionClarification(request, guestDbId).catch(error => {
    console.error('THONGTHAI_BARE_HORSE_CLARIFICATION_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
    return null;
  });
  if (bareHorseClarification) {
    const polished = polishedResponse(bareHorseClarification, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  // The other side of bareHorseSelectionClarification: when context IS
  // already established, actually select the horse and ask the one
  // caring question that matters next, instead of silently falling
  // through toward the LLM.
  const horseSelection = await horseSelectionWithContextResponse(request, guestDbId, channel).catch(error => {
    console.error('THONGTHAI_HORSE_SELECTION_CONTEXT_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
    return null;
  });
  if (horseSelection) {
    const polished = polishedResponse(horseSelection, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  // The continuation of horseSelection's own care question -- answers it
  // ("ไม่เคยครับมาคนเดียว") and asks the next specific question, instead of
  // falling through to a generic "need more detail" that never says what.
  const horseCareFollowup = await horseCareFollowupResponse(request, guestDbId, channel).catch(error => {
    console.error('THONGTHAI_HORSE_CARE_FOLLOWUP_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
    return null;
  });
  if (horseCareFollowup) {
    const polished = polishedResponse(horseCareFollowup, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  // If the customer is confused by the health/balance question itself
  // ("รายละเอียดอะไรครับ?"), explain exactly what's being asked rather than
  // repeating anything vague.
  const horseCareDetailExplainer = await horseCareDetailExplainerResponse(request, guestDbId).catch(error => {
    console.error('THONGTHAI_HORSE_CARE_DETAIL_EXPLAINER_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
    return null;
  });
  if (horseCareDetailExplainer) {
    const polished = polishedResponse(horseCareDetailExplainer, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  // Third step: the customer's answer to the health/balance question
  // ("ไม่กังวลครับ") -- acknowledge everything understood so far and move
  // to the one remaining useful question (duration), instead of a
  // generic "need more detail" a second time.
  const horseHealthFollowup = await horseHealthFollowupResponse(request, guestDbId, channel).catch(error => {
    console.error('THONGTHAI_HORSE_HEALTH_FOLLOWUP_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
    return null;
  });
  if (horseHealthFollowup) {
    const polished = polishedResponse(horseHealthFollowup, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  const careContext = deterministicCareContextResponse(request);
  if (careContext) {
    const polished = polishedResponse(careContext, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  const vagueVisitIntent = deterministicVagueVisitIntentResponse(request);
  if (vagueVisitIntent) {
    const polished = polishedResponse(vagueVisitIntent, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  const foodIntentStart = deterministicFoodIntentStartResponse(request);
  if (foodIntentStart) {
    const polished = polishedResponse(foodIntentStart, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  const activityIntentStart = deterministicActivityIntentStartResponse(request);
  if (activityIntentStart) {
    const polished = polishedResponse(activityIntentStart, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    await markActivityIntentStarted(guestDbId, channel);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  const thankYouClose = deterministicThankYouCloseResponse(request);
  if (thankYouClose) {
    const polished = polishedResponse(thankYouClose, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  // Phase G.2 strangler cutover. OFF by default. Only task-free READ-ONLY
  // turns in the explicitly proven domains can return from One-Mind here.
  // Transactional/in-progress-task turns are inspected but not persisted and
  // fall through to the unchanged legacy path below.
  // Preserve the existing authoritative zero-cost broad-discovery fast path.
  // One-Mind's ecosystem cutover can otherwise compose FACT_UNKNOWN before
  // deterministicExperienceDiscoveryResponse gets a chance to render the
  // verified experience/activity catalog (regression observed in LINE for
  // colloquial Thai such as "มีไรทำมั่ง"). This is a domain-level routing
  // guard, not a phrase-by-phrase answer patch: the shared
  // isExperienceDiscoveryIntent matcher owns the entire broad-discovery class.
  const preserveExperienceDiscoveryFastPath = isExperienceDiscoveryIntent(request.message);

  // Production LINE sends chatHistory: [], so a bare restaurant follow-up
  // ("มีอะไรแนะนำอีก") cannot prove its topic from transport history alone.
  // The deterministic restaurant path already persists restaurantAdvisorContext
  // in guest_agent_state; consult that SMALL server-side snapshot before the
  // One-Mind cutover gets a chance to claim a generic recommendation turn.
  //
  // Keep this lookup narrow: explicit food turns already classify correctly
  // with empty state, and unrelated generic recommendations should not pay an
  // extra state read. Only RECOMMENDATION_ONLY turns need continuity proof.
  // Human Brain Phase 1: the legacy restaurant advisor owns the specific
  // jobs it is proven to do well (dietary declarations and explicit menu/
  // recommendation requests). A message is NOT reserved for that responder
  // merely because it contains a restaurant/food domain noun.
  //
  // This distinction is semantic-class based, not a phrase patch. It prevents
  // a richer restaurant question (availability/status/etc.) from being reduced
  // to "restaurant topic" before One-Mind can read the whole sentence, while
  // keeping every established dietary/menu fast path intact.
  const restaurantIntentClass = classifyRestaurantDietaryIntent(request.message);
  let preserveRestaurantFastPath = restaurantIntentClass !== 'OTHER'
    && isRestaurantAdvisorTurn(request, { agentState: {} });
  const supervisedRestaurantStatus = earlyOneMind?.turn.semanticTurn.semanticSource === 'openai_supervisor'
    && earlyOneMind.turn.semanticTurn.domain === 'restaurant'
    && (
      earlyOneMind.turn.semanticTurn.action === 'status'
      || earlyOneMind.turn.semanticTurn.informationNeed === 'availability'
      || earlyOneMind.turn.semanticTurn.informationNeed === 'transaction_status'
    );
  if (supervisedRestaurantStatus) preserveRestaurantFastPath = false;
  if (!preserveRestaurantFastPath
      && restaurantIntentClass === 'RECOMMENDATION_ONLY'
      && guestDbId) {
    const snapshot = await loadGuestAgentStateSnapshot(guestDbId).catch(error => {
      console.error(
        'THONGTHAI_RESTAURANT_PRECUTOVER_STATE_ERROR',
        error instanceof Error ? error.message.slice(0, 220) : 'unknown',
      );
      return { state: null } as Awaited<ReturnType<typeof loadGuestAgentStateSnapshot>>;
    });
    if (isObject(snapshot.state)) {
      preserveRestaurantFastPath = isRestaurantAdvisorTurn(request, { agentState: snapshot.state });
    }
  }
  // SAME class of guard as the two above: without it, One-Mind's own
  // structural markers (e.g. findActivityTopic matching "ม้า") can claim a
  // blended local-concierge question like "ฝนตกขี่ม้าได้ไหม" as plain
  // activity-topic discovery BEFORE deterministicLocalConciergeResponse
  // ever gets a chance -- answering the activity-inventory question while
  // silently dropping the weather-conditional framing the customer
  // actually asked. Reuses the exact same classifier
  // deterministicLocalConciergeResponse itself uses (including its
  // explicit-transaction-intent yield), so this guard and that function
  // can never disagree about which messages this covers.
  const preserveLocalConciergeFastPath = !hasExplicitTransactionIntent(request.message)
    && Boolean(classifyLocalConciergeQuestion(request.message));

  // Phase 4 Cafe: the production One-Mind cutover runs before the legacy
  // deterministic responder. Preserve this read-only class exactly like
  // restaurant/local-concierge so the honest no-verified-data boundary cannot
  // be swallowed by a model-composed or stale-domain answer. For a
  // transport-history-free follow-up
  // ("ราคาเท่าไร"), consult only the bounded active_topic snapshot.
  // This checkpoint runs BEFORE BrainRuntime is loaded below, so inspect
  // only the persisted agent-state snapshot here. Reading `runtime` at this
  // point creates a temporal-dead-zone crash that takes unrelated domains
  // down with it. This pre-cutover probe is read-only; the real continuation
  // still uses the fully loaded runtime later.
  let hasPendingPromotionRedemption = false;
  if (guestDbId) {
    const snapshot = await loadGuestAgentStateSnapshot(guestDbId).catch(error => {
      console.error(
        'THONGTHAI_PROMOTION_PRECUTOVER_STATE_ERROR',
        error instanceof Error ? error.message.slice(0, 220) : 'unknown',
      );
      return { state:null } as Awaited<ReturnType<typeof loadGuestAgentStateSnapshot>>;
    });
    hasPendingPromotionRedemption = isObject(snapshot.state)
      && Boolean(parsePendingPromotionRedemption(snapshot.state.pendingPromotionRedemption));
  }
  const preservePromotionFastPath =
    hasPendingPromotionRedemption
    || isPromotionDiscoveryIntent(request.message)
    || isPromotionAcceptIntent(request.message);

  let preserveCafeFastPath = isCafeReadOnlyTurn(request.message);
  if (!preserveCafeFastPath
      && CAFE_READ_ONLY_FOLLOWUP_MARKER.test(request.message.trim())
      && guestDbId) {
    const snapshot = await loadGuestAgentStateSnapshot(guestDbId).catch(error => {
      console.error(
        'THONGTHAI_CAFE_PRECUTOVER_STATE_ERROR',
        error instanceof Error ? error.message.slice(0, 220) : 'unknown',
      );
      return { state: null } as Awaited<ReturnType<typeof loadGuestAgentStateSnapshot>>;
    });
    preserveCafeFastPath = isObject(snapshot.state)
      && isCafeReadOnlyTurn(request.message, snapshot.state.active_topic);
  }

  if (process.env.THONGTHAI_ONE_MIND_CUTOVER === '1' && !preserveExperienceDiscoveryFastPath
      && !preserveRestaurantFastPath && !preserveLocalConciergeFastPath
      && !preservePromotionFastPath && !preserveCafeFastPath) {
    try {
      const cachedSemantic = earlyOneMind?.turn.semanticTurn;
      const oneMind = await processOneMindCustomerTurn({
        channel,
        language:request.language,
        message:request.message,
        eventId:transportEventId,
        providerUserKey:providerUserKey ?? request.guestId,
        canonicalAnonymousId:request.guestId,
        guestDbId,
        durableMemory:durableMemoryFromRequest(request),
        // Reuse the already-understood meaning, then let the existing
        // Dialog Manager persist its bounded conversational task state.
        persistState:true,
      }, cachedSemantic ? {
        interpretSemanticTurn: async () => cachedSemantic,
      } : undefined);
      earlyOneMind = oneMind;
      if (oneMind.status === 'composed') {
        await recordOneMindTrace(oneMind.observability);
        console.log('THONGTHAI_ONE_MIND_CUTOVER', JSON.stringify({
          domain:oneMind.turn.semanticTurn.domain,
          action:oneMind.turn.semanticTurn.action,
          responseIntent:oneMind.turn.dialogDecision.responseIntent,
          composerMode:oneMind.response.mode,
          stateConflictRetries:oneMind.turn.trace.stateConflictRetries ?? 0,
        }));
        const mappedIntent = oneMind.turn.semanticTurn.action === 'recommend'
          || oneMind.turn.semanticTurn.action === 'discover'
          ? 'recommendation'
          : 'information';
        const customerMessage = polishCustomerMessage(oneMind.response.message, channel) || oneMind.response.message.trim();
        return coreResult(200, {
          message:customerMessage,
          intent:mappedIntent,
          contextUpdates:{},
          journeyAction:{type:'none',journey:null},
          suggestedActions:[],
        });
      }
      await recordOneMindTrace(oneMind.observability);
      console.log('THONGTHAI_ONE_MIND_LEGACY_REQUIRED', JSON.stringify({
        reason:oneMind.reason,
        domain:oneMind.turn.semanticTurn.domain,
        action:oneMind.turn.semanticTurn.action,
      }));
    } catch (error) {
      // Strangler safety: until full G.2 equivalence is proven, One-Mind
      // failure never takes the legacy product down with it.
      console.error(
        'THONGTHAI_ONE_MIND_CUTOVER_ERROR',
        error instanceof Error ? error.message.slice(0, 220) : 'unknown',
      );
    }
  }

  // Phase G.1: optional SHADOW orchestration only. It never supplies the
  // customer response and cannot execute transactions. Production remains on
  // the legacy response path until G.2; this hook exists so branch/local
  // acceptance can compare the One-Mind decision against legacy behavior.
  if (process.env.THONGTHAI_ONE_MIND_SHADOW === '1'
      && process.env.THONGTHAI_ONE_MIND_CUTOVER !== '1') {
    const shadowEventId = eventId ?? `shadow:${channel}:${Date.now()}`;
    try {
      const shadow = await processThongthaiOneMindTurnResilient({
        channel,
        message: request.message,
        eventId: shadowEventId,
        providerUserKey: providerUserKey ?? request.guestId,
        canonicalAnonymousId: request.guestId,
        guestDbId,
        durableMemory: durableMemoryFromRequest(request),
        // Persist only when explicitly enabled AND the transport gave us a
        // stable event id. A generated shadow id must never mutate continuity.
        persistState: process.env.THONGTHAI_ONE_MIND_SHADOW_PERSIST === '1' && Boolean(eventId),
      });
      console.log(
        'THONGTHAI_ONE_MIND_SHADOW',
        JSON.stringify(shadow.status === 'ok'
          ? { status:'ok', trace:shadow.result.trace, degradation:shadow.result.knowledgeDegradation }
          : { status:'degraded', degradation:shadow.degradation }),
      );
    } catch (error) {
      console.error(
        'THONGTHAI_ONE_MIND_SHADOW_ERROR',
        error instanceof Error ? error.message.slice(0, 220) : 'unknown',
      );
    }
  }


  const history = request.chatHistory.slice(-16);
  const lastTurn = history[history.length - 1];
  const currentAlreadyIncluded = Boolean(
    lastTurn && lastTurn.role === 'user' && lastTurn.content.trim() === request.message.trim(),
  );
  const messages: ChatTurn[] = currentAlreadyIncluded
    ? history
    : [...history, { role: 'user', content: request.message }];

  const [communityOfferings, loadedRuntime] = await Promise.all([
    loadVerifiedCommunityOfferings(),
    loadBrainRuntime(guestDbId, channel),
  ]);
  // The provider's cost guard requires a real AiCallContext for any
  // production (non-certification, non-test) call -- see
  // _thongthai-brain-v3.ts's callPreferredModel. Without this, every real
  // invocation of the legacy brain fallback (runThongthaiBrain, still load-
  // bearing for domains/turns the One-Mind read-only cutover and zero-cost
  // deterministic degradation don't resolve) threw before ever reaching
  // OpenAI, silently collapsing to the generic "คิดช้ากว่าปกติ" apology.
  const runtime: BrainRuntimeContext = {
    ...loadedRuntime,
    costContext: {
      conversationId: providerUserKey ?? guestDbId ?? 'unknown',
      guestDbId,
      channel,
      eventId: transportEventId,
      callerLabel: 'thongthai-brain-v3',
    },
  };

  // A promotion redemption already in progress must reliably finish
  // regardless of LLM health -- checked unconditionally, before the LLM,
  // same discipline as the restaurant preorder continuation below.
  const promotionContinuation = await promotionContinuationResponse(request, runtime, guestDbId, channel).catch(error => {
    console.error('THONGTHAI_PROMOTION_CONTINUATION_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
    return null;
  });
  if (promotionContinuation) {
    const polished = polishedResponse(promotionContinuation, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  // Promotion discovery is read-only and fully backed by loaded live promotion
  // facts, so it should not wait for a model call. This also lets side
  // questions like "มีโปรด้วยไหม" work while another topic is active.
  const promotionDiscovery = await promotionDiscoveryFallbackResponse(request, runtime, guestDbId, channel).catch(error => {
    console.error('THONGTHAI_PROMOTION_DISCOVERY_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
    return null;
  });
  if (promotionDiscovery) {
    const polished = polishedResponse(promotionDiscovery, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  const deterministicCafe = await deterministicCafeResponse(request, runtime);
  if (deterministicCafe) {
    const polished = polishedResponse(deterministicCafe, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  // Local Concierge: broad local-area/weather-condition/food-culture/
  // visitor-journey/activity-suitability/safety questions -- checked BEFORE
  // the bare ecosystem broad-discovery fallback below, since a message can
  // structurally match BOTH (e.g. "ฝนตกแล้วยังทำอะไรได้บ้าง" matches
  // isExperienceDiscoveryIntent's own "ทำอะไรได้บ้าง" pattern too) and the
  // more specific, weather-aware answer is the better one when both apply.
  // Also checked before the activity/restaurant deterministic responses
  // further below (so "ฝนตกขี่ม้าได้ไหม" gets concierge-shaped reasoning,
  // not a generic activity-inventory answer that ignores the weather
  // framing) -- see the matching preserveLocalConciergeFastPath guard
  // above the One-Mind cutover block, which uses the SAME classifier so
  // One-Mind can't claim these messages first either. See
  // deterministicLocalConciergeResponse's own header comment for the full
  // precedence reasoning and the explicit-transaction-intent yield.
  // High-confidence restaurant dietary/recommendation intent must not be
  // swallowed by Local Concierge's broader food-culture classifier. A real
  // production failure showed "ไม่กินเผ็ดด้วยนะ" and
  // "ไม่กินเผ็ด ไม่กินไก่ ไม่กินกุ้ง มีอะไรแนะนำบ้าง" returning generic
  // Isan-food copy instead of updating/enforcing dietary constraints.
  //
  // This is a semantic-precedence gate, not a phrase patch: once the dedicated
  // restaurant intent classifier says the turn is a dietary declaration or
  // explicit recommendation and the restaurant domain accepts the turn, the
  // grounded restaurant responder below owns it. Weather/location still win
  // earlier through the top-level semantic gate.
  const restaurantDietaryIntentForPrecedence = classifyRestaurantDietaryIntent(request.message);
  // Do not steal broad food-culture discovery ("อยากกินอีสาน ไม่กินเผ็ด")
  // from Local Concierge. The restaurant fast path owns:
  //   1) a pure dietary declaration/update, and
  //   2) a dietary message that ALSO explicitly asks for a concrete menu/
  //      recommendation ("...มีอะไรแนะนำบ้าง", "...กินอะไรดี", etc.).
  // Bare "อยากกิน..." remains hospitality/food-culture intent.
  const explicitGroundedMenuAsk = /มีอะไร|แนะนำอะไร|กินอะไรดี|ขอเมนู|มีเมนู|จัดชุด|จัดโต๊ะ|อะไรอร่อย|มีไรกิน|ไรกิน/u.test(request.message);
  const preferGroundedRestaurant = isRestaurantAdvisorTurn(request, runtime)
    && (
      restaurantDietaryIntentForPrecedence === 'CONSTRAINT_ONLY'
      || (
        restaurantDietaryIntentForPrecedence === 'CONSTRAINT_AND_RECOMMENDATION'
        && explicitGroundedMenuAsk
      )
    );

  const localConcierge = preferGroundedRestaurant
    ? null
    : await deterministicLocalConciergeResponse(request).catch(error => {
      // redactWeatherUrl: defense-in-depth -- some fetch implementations
      // embed the request URL (appid=<key> included) in their own error
      // message; never let that reach a log line unredacted.
      console.error('THONGTHAI_LOCAL_CONCIERGE_ERROR', error instanceof Error ? redactWeatherUrl(error.message.slice(0, 220)) : 'unknown');
      return null;
    });
  if (localConcierge) {
    const polished = polishedResponse(localConcierge, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  // Broad discovery such as "มีอะไรทำบ้าง" is a core product question and
  // must not depend on LLM availability or be swallowed by activity routing.
  // Answer it deterministically from the shared experience catalog + live
  // activity inventory before the broader activity interpreter runs.
  const experienceDiscovery = deterministicExperienceDiscoveryResponse(request, runtime);
  if (experienceDiscovery) {
    const polished = polishedResponse(experienceDiscovery, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  // Restaurant topic continuity must win BEFORE the activity semantic
  // interpreter. deterministicActivityResponse invokes One-Mind/model semantic
  // interpretation even for a turn that later proves not to be activity.
  // With LINE chatHistory empty and an old horse task still present, the real
  // model could claim a bare restaurant follow-up ("มีอะไรแนะนำอีก") and
  // compose a generic/activity clarification before the deterministic
  // restaurant responder ever ran. isRestaurantAdvisorTurn already rejects
  // explicit horse/ATV/archery turns, so putting the grounded restaurant
  // responder first is a domain-level precedence fix, not a phrase patch.
  const deterministicRestaurant = await deterministicRestaurantResponse(request, runtime, guestDbId, channel).catch(error => {
    console.error('THONGTHAI_RESTAURANT_DETERMINISTIC_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
    return null;
  });
  if (deterministicRestaurant) {
    console.log('SEMANTIC_RESPONDER_SELECTED', JSON.stringify({ responder: 'deterministicRestaurantResponse' }));
    const polished = polishedResponse(deterministicRestaurant, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  const deterministicActivity = await deterministicActivityResponse(
    request,
    guestDbId,
    channel,
    transportEventId,
    providerUserKey,
    earlyOneMind?.turn.semanticTurn,
  ).catch(error => {
    console.error('THONGTHAI_ACTIVITY_DETERMINISTIC_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
    return null;
  });
  if (deterministicActivity) {
    const polished = polishedResponse(deterministicActivity, channel);
    await persistBrainRuntime(guestDbId, channel, polished);
    return coreResult(200, {
      message: polished.message,
      intent: polished.intent,
      contextUpdates: polished.contextUpdates,
      journeyAction: polished.journeyAction,
      suggestedActions: polished.suggestedActions,
    });
  }

  // If every proven deterministic/business responder above yielded but the
  // semantic supervisor already produced a safe, non-transactional One-Mind
  // response, use that deterministic/grounded response instead of invoking
  // the legacy generative brain. This keeps OpenAI in the teacher role.
  const earlyFallbackSafe = earlyOneMind?.status === 'composed'
    && !earlyOneMind.turn.taskStateBefore.activeTask
    && !earlyOneMind.turn.taskStateAfter.activeTask
    && !earlyOneMind.turn.semanticTurn.taskDirective
    && ['ask','discover','recommend','compare','status'].includes(earlyOneMind.turn.semanticTurn.action);
  if (earlyFallbackSafe && earlyOneMind?.status === 'composed') {
    const supervisedFallback = polishedResponse({
      message: earlyOneMind.response.message,
      intent: earlyOneMind.turn.semanticTurn.action === 'recommend'
        || earlyOneMind.turn.semanticTurn.action === 'discover'
        ? 'recommendation'
        : 'information',
      contextUpdates:{},
      journeyAction:{type:'none', journey:null},
      suggestedActions:[],
      responseStyle:'direct',
      semanticMemoryUpdates:[],
      toolCalls:[],
    }, channel);
    await persistBrainRuntime(guestDbId, channel, supervisedFallback);
    return coreResult(200, {
      message:supervisedFallback.message,
      intent:supervisedFallback.intent,
      contextUpdates:supervisedFallback.contextUpdates,
      journeyAction:supervisedFallback.journeyAction,
      suggestedActions:supervisedFallback.suggestedActions,
    });
  }


  let firstResponse: BrainResponse;
  try {
    firstResponse = await runThongthaiBrain(request, communityOfferings, messages, runtime);
  } catch (error) {
    console.error('THONGTHAI_BRAIN_ERROR', error);
    if (error instanceof ProviderNotConfiguredError) {
      return coreResult(503, { error: 'AI provider not configured', message: 'This deployment has no LLM API key configured.' });
    }
    if (error instanceof LLMAvailabilityError) {
      // The LLM itself is unavailable -- try the deterministic promo fallback
      // before giving up with the generic "try again" message. Only engages
      // for a message that actually mentions a promotion; anything else
      // still gets the plain unavailability reply.
      const promotionFallback = await promotionDiscoveryFallbackResponse(request, runtime, guestDbId, channel).catch(fallbackError => {
        console.error('THONGTHAI_PROMOTION_FALLBACK_ERROR', fallbackError instanceof Error ? fallbackError.message.slice(0, 220) : 'unknown');
        return null;
      });
      if (promotionFallback) {
        const polished = polishedResponse(promotionFallback, channel);
        await persistBrainRuntime(guestDbId, channel, polished);
        return coreResult(200, {
          message: polished.message,
          intent: polished.intent,
          contextUpdates: polished.contextUpdates,
          journeyAction: polished.journeyAction,
          suggestedActions: polished.suggestedActions,
        });
      }
      // Zero-cost architecture (Phase P): before the flat "try again" apology,
      // try the canonical One-Mind pipeline's deterministic degradation --
      // Task State + Dialog Manager + Response Composer can still retain
      // context, fill/correct a slot, select a previously-shown entity, or
      // ask ONE honest clarifying question without the model. The model
      // already failed once this turn (this IS that failure), so
      // interpretSemanticTurn is overridden to rethrow the SAME error
      // immediately rather than spend a second real provider attempt --
      // "at most one LLM call per customer turn" still holds.
      const oneMindFallback = await processOneMindCustomerTurn({
        channel, language: request.language, message: request.message,
        eventId: transportEventId,
        providerUserKey: providerUserKey ?? request.guestId,
        canonicalAnonymousId: request.guestId,
        guestDbId,
        durableMemory: durableMemoryFromRequest(request),
        persistState: true,
      }, {
        interpretSemanticTurn: async () => { throw error; },
      }, {}, undefined, { allowGenuinelyUnclassifiedFallback: true }).catch(fallbackError => {
        console.error('THONGTHAI_ONE_MIND_FALLBACK_ERROR', fallbackError instanceof Error ? fallbackError.message.slice(0, 220) : 'unknown');
        return null;
      });
      if (oneMindFallback && oneMindFallback.status === 'composed') {
        const mappedIntent = oneMindFallback.turn.semanticTurn.action === 'recommend'
          || oneMindFallback.turn.semanticTurn.action === 'discover'
          ? 'recommendation'
          : 'information';
        const polished = polishedResponse({
          message: oneMindFallback.response.message,
          intent: mappedIntent,
          contextUpdates: {},
          journeyAction: { type: 'none', journey: null },
          suggestedActions: [],
          responseStyle: 'direct',
          semanticMemoryUpdates: [],
          toolCalls: [],
        }, channel);
        await persistBrainRuntime(guestDbId, channel, polished);
        return coreResult(200, {
          message: polished.message,
          intent: polished.intent,
          contextUpdates: polished.contextUpdates,
          journeyAction: polished.journeyAction,
          suggestedActions: polished.suggestedActions,
        });
      }
      const fallback = polishedResponse(degradedFallbackResponse(categorizeDegradedFallback(request.message)), channel);
      return coreResult(200, fallback);
    }
    return coreResult(502, { error: 'Thongthai brain request failed. Please try again.' });
  }

  await persistCustomerResult(guestDbId, firstResponse, request.journeyContext, request.language);

  let finalResponse = firstResponse;
  const toolCalls = firstResponse.toolCalls ?? [];
  if (toolCalls.length) {
    const toolResults = await executeBrainTools(
      guestDbId,
      channel,
      toolCalls,
      firstResponse,
      request,
    );
    const duplicatePreorderNotice = duplicateRestaurantPreorderMessage(request.language, toolResults);
    if (duplicatePreorderNotice) {
      finalResponse = {
        ...firstResponse,
        toolCalls: [],
        suggestedActions: [],
        message: duplicatePreorderNotice,
      };
    } else {
      try {
        const afterTools = await runThongthaiBrain(
          request,
          communityOfferings,
          messages,
          { ...runtime, toolResults },
        );
        finalResponse = mergeAfterTools(firstResponse, afterTools, toolResults);
      } catch (error) {
        console.error('THONGTHAI_BRAIN_POST_TOOL_ERROR', error);
        finalResponse = {
          ...firstResponse,
          toolCalls: [],
          message: toolResults.every(result => result.ok)
            ? firstResponse.message
            : `${firstResponse.message}\n\nมีบางอย่างที่ทองไทยยังทำให้ไม่สำเร็จครับ ลองอีกครั้งได้เลย`,
        };
      }
    }
  }

  finalResponse = polishedResponse(finalResponse, channel);
  await persistBrainRuntime(guestDbId, channel, finalResponse);

  return coreResult(200, {
    message: finalResponse.message,
    intent: finalResponse.intent,
    contextUpdates: finalResponse.contextUpdates,
    journeyAction: finalResponse.journeyAction,
    suggestedActions: finalResponse.suggestedActions,
  });
}

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let rawBody: unknown;
  try {
    rawBody = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Malformed JSON body' });
  }

  const request = normalizeRequest(rawBody);
  if (!request) return json(400, { error: 'Missing required field: message' });

  const rawEventId = isObject(rawBody) && isNonEmptyString(rawBody.eventId)
    ? rawBody.eventId.trim().slice(0, 180)
    : null;
  const headerEventId = isNonEmptyString(event.headers?.['x-nf-request-id'])
    ? event.headers['x-nf-request-id'].trim().slice(0, 180)
    : (isNonEmptyString(event.headers?.['x-request-id'])
      ? event.headers['x-request-id'].trim().slice(0, 180)
      : null);

  const result = await processThongthaiChatCore(request, rawEventId ?? headerEventId);
  return json(result.statusCode, result.payload);
};
