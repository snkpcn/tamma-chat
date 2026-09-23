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
} from './_customer-db';
import { resolveCanonicalGuestId } from './_thongthai-identity';
import {
  executeBrainTools,
  loadBrainRuntime,
  persistBrainRuntime,
  registerGuestIdentity,
} from './_thongthai-runtime-v3';
import { activityAssetFromText, formatActivityAssetNote } from './_operations-db';
import { restaurantMenuAdvice } from './_restaurant-sot';
import { polishCustomerMessage } from './_chat-copy-style';
import { formatExperienceDiscoveryMessage, isExperienceDiscoveryIntent } from './_experience-discovery';
import { classifyLocalConciergeQuestion, hasExplicitTransactionIntent, isHorseInfoOrComparisonQuestion, isCompareEntitiesAttributeQuestion } from './_local-concierge-intent';
import { composeLocalConciergeResponse } from './_local-concierge-response';
import { redactWeatherUrl } from './_weather-provider';
import { classifyServiceFeedback, mentionsThongthaiResponse } from './_service-mind-feedback-intent';
import { composeServiceFeedbackResponse } from './_service-mind-feedback-response';
import { createFeedbackEvent } from './_service-mind-feedback-events';
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
import { processThongthaiOneMindTurnResilient } from './_thongthai-one-mind-orchestrator';
import { loadGuestAgentStateSnapshot } from './_guest-agent-state-store';
import { processOneMindCustomerTurn } from './_thongthai-one-mind-response';
import { recordOneMindTrace } from './_one-mind-observability';
import {
  buildPendingPromotionRedemption,
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
  extractDurationMinutes,
  extractPartySize,
  extractTime,
  hasCommitMarker,
} from './_slot-parsers';
import { createActiveTask, isTerminalTaskStatus, loadTaskState, mergeTaskSlots, persistTaskState, startNewActiveTask } from './_task-state';
import { HORSE_FACTS } from './_local-concierge-knowledge';

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

// Per-intent-category degraded response when the LLM/provider is genuinely
// unavailable AND no deterministic composer (promotion fallback, One-Mind
// pipeline) could compose a grounded answer either. A single flat "คิดช้า"
// apology for every category is what produced the generic-fallback bug --
// this at least tells a weather/booking/feedback question something
// relevant to what it actually asked, and never claims an action (a
// booking, a saved feedback note) that did not actually happen.
type DegradedFallbackCategory = 'weather' | 'booking' | 'feedback' | 'casual';

export function categorizeDegradedFallback(message: string): DegradedFallbackCategory {
  if (classifyServiceFeedback(message)) return 'feedback';
  if (classifyLocalConciergeQuestion(message)?.category === 'weather_condition') return 'weather';
  if (hasExplicitTransactionIntent(message) || OPERATIONAL_TOPIC_RE.test(message)) return 'booking';
  return 'casual';
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
    message: body.message.trim(),
    language,
    chatHistory: normalizeChatHistory(body.chatHistory),
    guestContext: normalizeGuestContext(body.guestContext),
    journeyContext: normalizeJourneyContext(body.journeyContext),
    pageContext,
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
  if (!recentMessages.length) return null;
  return {
    source: RESTAURANT_ADVISOR_CONTEXT_SOURCE,
    recentMessages,
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

function restaurantAdvisorContextUpdate(
  request: BrainRequest,
  runtime: { agentState: Record<string, unknown> },
): AgentStateUpdate {
  const recentMessages = [...restaurantAdvisorRecentMessages(request, runtime), request.message]
    .map(item => item.trim().replace(/\s+/g, ' ').slice(0, 180))
    .filter(Boolean)
    .slice(-8);
  return {
    activeTopic: 'restaurant',
    restaurantAdvisorContext: {
      source: RESTAURANT_ADVISOR_CONTEXT_SOURCE,
      recentMessages,
      updatedAt: new Date().toISOString(),
    },
  };
}

function polishedResponse(response: BrainResponse, channel: BrainChannel): BrainResponse {
  const message = polishCustomerMessage(response.message, channel);
  return { ...response, message: message || response.message.trim() };
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
  if (/(ขี่ม้า|atv|เอทีวี|ยิงธนู|ห้องพัก|ที่พัก|เฮือน|otop|กาแฟ|คาเฟ่)/iu.test(text)) return false;
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
  const explicitFood = /(ที่ร้าน|ร้านอาหาร|ตำมา-ชาติ|ตำมา|เมนู|อาหาร|กินอะไร|อะไรกิน|ไรกิน|อะไรอร่อย|ตำ|ลาบ|น้ำตก|ยำ|ต้มแซ่บ|คอหมู|เสือร้องไห้|ไก่บ้าน|ปลาช่อน|ปลานิล|ข้าวเหนียว|เผ็ด|ปลาร้า|ถั่ว|กุ้ง)/u.test(text);
  if (explicitFood) return true;
  const restaurantFollowUp = /(งบ|แพ้|ไม่กิน|ไม่เอา|จัด.*ชุด|จัด.*โต๊ะ|เพิ่มอะไร|ต่างกัน|อันไหน|เอาชุด|ชุดเมื่อกี้|อันเมื่อกี้|อันนั้น|ราคา|กี่บาท|เผ็ด|จืด|หวาน|เค็ม|\d+\s*คน|คนเดียว|สองคน|สามคน|สี่คน)/u.test(text);
  return (hasRestaurantHistory || hasRestaurantServerContext) && restaurantFollowUp;
}

function formatMoney(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.round(n)} บาท` : '-';
}

// RESTAURANT_CONSTRAINT_COPY_FIX_V1
function formatRestaurantConstraintAck(advisor: any): string {
  const parsed = advisor?.parsed && typeof advisor.parsed === 'object' ? advisor.parsed as Record<string, unknown> : null;
  if (!parsed) return '';

  const labels: string[] = [];
  const avoidProteins = Array.isArray(parsed.avoidProteins) ? parsed.avoidProteins.map(String) : [];
  const proteinLabels: Record<string, string> = {
    pork:'ไม่มีหมู', beef:'ไม่มีเนื้อวัว', chicken:'ไม่มีไก่', fish:'ไม่มีปลา', egg:'ไม่มีไข่',
  };
  for (const protein of avoidProteins) if (proteinLabels[protein]) labels.push(proteinLabels[protein]);

  if (parsed.vegetarian === true) labels.push('มังสวิรัติ');

  const avoidIngredients = Array.isArray(parsed.avoidIngredients) ? parsed.avoidIngredients.map(String) : [];
  if (avoidIngredients.some(value => value.includes('ปลาร้า'))) labels.push('ไม่มีปลาร้า');
  if (avoidIngredients.some(value => value.includes('กุ้ง'))) labels.push('ไม่มีกุ้งแห้ง');
  if (avoidIngredients.some(value => value.includes('ถั่ว'))) labels.push('ไม่มีถั่วลิสง');

  const allergens = Array.isArray(parsed.allergenFlags) ? parsed.allergenFlags.map(String) : [];
  const allergenLabels: Record<string, string> = { peanut:'เลี่ยงถั่ว', shrimp:'เลี่ยงกุ้ง', fish:'เลี่ยงปลา', egg:'เลี่ยงไข่' };
  for (const allergen of allergens) if (allergenLabels[allergen]) labels.push(allergenLabels[allergen]);

  if (parsed.spice === 'none') labels.push('ไม่เผ็ด');
  else if (parsed.spice === 'mild') labels.push('ไม่เผ็ดจัด');
  else if (parsed.spice === 'medium') labels.push('เผ็ดกลาง');

  const unique = [...new Set(labels)];
  return unique.length ? `✅ คัดเมนูตามที่บอกให้แล้วครับ: ${unique.join(' · ')}` : '';
}

function formatAdvisorMessage(advisor: any): string {
  const notices: string[] = Array.isArray(advisor?.notices) ? advisor.notices : [];
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
    const constraintAck = formatRestaurantConstraintAck(advisor);
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
  const rows = Array.isArray(advisor?.recommendations) ? advisor.recommendations.slice(0, advisor.mode === 'pairing' ? 3 : 4) : [];
  if (rows.length) {
    const constraintAck = formatRestaurantConstraintAck(advisor);
    const intro = advisor?.mode === 'pairing'
      ? '🍽️ มีเมนูนี้แล้ว เพิ่มอีกนิดจะบาลานซ์โต๊ะกำลังดีครับ'
      : constraintAck ? '🍽️ จากเมนูที่มีตอนนี้ ทองไทยแนะนำ' : '🍽️ เมนูที่น่าลองตอนนี้';
    return [
      constraintAck,
      intro,
      '',
      ...rows.map((row: any) => {
        const reason = Array.isArray(row.reasons) && row.reasons.length ? row.reasons[0] : '';
        return `• ${row.name} — ${formatMoney(row.price)}${reason ? `\n  ${reason}` : ''}`;
      }),
      notices[0] ? `\n⚠️ ${notices[0]}` : '',
    ].filter(Boolean).join('\n');
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
        : 'ส่งเข้าหลังร้านและแจ้งทีมแล้วครับ',
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
async function promotionDiscoveryFallbackResponse(
  request: BrainRequest,
  runtime: BrainRuntimeContext,
  guestDbId: string | null,
  channel: BrainChannel,
): Promise<BrainResponse | null> {
  const promotions = activePromotionsFromRuntime(runtime);
  const decision = decidePromotionFallback(request.message, promotions);

  if (decision.kind === 'not_promo_related') return null;
  if (decision.kind === 'no_promotions') {
    return {
      message: formatPromotionListMessage([]), intent:'information', contextUpdates:{},
      journeyAction:{type:'none',journey:null}, suggestedActions:[], responseStyle:'direct',
      semanticMemoryUpdates:[], toolCalls:[],
    };
  }
  if (decision.kind === 'clarify') {
    return {
      message: formatPromotionClarificationMessage(decision.promotions), intent:'information', contextUpdates:{},
      journeyAction:{type:'none',journey:null}, suggestedActions:[], responseStyle:'direct',
      semanticMemoryUpdates:[], toolCalls:[],
    };
  }
  if (decision.kind === 'list') {
    return {
      message: formatPromotionListMessage(decision.promotions), intent:'recommendation', contextUpdates:{},
      journeyAction:{type:'none',journey:null}, suggestedActions:[], responseStyle:'direct',
      agentStateUpdate: decision.promotions.length === 1
        ? { pendingPromotionRedemption: buildPendingPromotionRedemption(decision.promotions[0]!) }
        : {},
      semanticMemoryUpdates:[], toolCalls:[],
    };
  }
  return resolvePromotionRedemption(decision.pending, request, guestDbId, channel);
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
async function deterministicLocalConciergeResponse(request: BrainRequest): Promise<BrainResponse | null> {
  if (hasExplicitTransactionIntent(request.message)) return null;
  const match = classifyLocalConciergeQuestion(request.message);
  if (!match) return null;
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
  const advisorContext = restaurantAdvisorContextUpdate(request, runtime);
  return {
    message: formatAdvisorMessage(advice),
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
    persistState: true,
  });

  const turn = oneMind.status === 'composed' || oneMind.status === 'legacy_required'
    ? oneMind.turn
    : null;
  if (!turn || turn.semanticTurn.domain !== 'activity') return null;

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
  if (!proposal || proposal.toolName !== 'create_booking' || !proposal.customerCommitPresent) return null;
  return executeDeterministicActivityBooking(
    { ...proposal.validatedArgs } as Record<string, unknown>,
    request,
    guestDbId,
    channel,
  );
}

function directCommittedActivityBookingArgs(message: string): Record<string, unknown> | null {
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

  const message = ambiguous.name === 'ทองไทย'
    ? 'หมายถึงอยากเลือก “ทองไทย” เป็นม้าสำหรับขี่ หรือเรียกทองไทยผู้ช่วยแชทครับ 😊'
    : `หมายถึงม้า “${ambiguous.name}” ใช่ไหมครับ ถ้าอยากขี่ม้า พิมพ์ว่า “อยากขี่ม้า” ได้เลยครับ`;
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
    const container = await loadTaskState(guestDbId);
    const reusable = container.activeTask
      && container.activeTask.type === 'activity_booking'
      && !isTerminalTaskStatus(container.activeTask.status);
    const task = reusable
      ? mergeTaskSlots(container.activeTask!, { assetSelection: horseName, resourceCode: 'activity-horse' }, ACTIVITY_BOOKING_REQUIRED_FIELDS)
      : mergeTaskSlots(
        createActiveTask({ type: 'activity_booking', sourceChannel: channel, requiredFields: ACTIVITY_BOOKING_REQUIRED_FIELDS }),
        { assetSelection: horseName, resourceCode: 'activity-horse' },
        ACTIVITY_BOOKING_REQUIRED_FIELDS,
      );
    await persistTaskState(guestDbId, { ...container, activeTask: task });
  } catch (error) {
    console.error('THONGTHAI_HORSE_SELECTION_PERSIST_ERROR', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
  }
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
  const message = [
    `ได้ครับ เลือก${ambiguous.name}นะครับ 😊`,
    `${ambiguous.name}จะ${facts.rideFeelTh} คาแรกเตอร์${facts.personalityTh}ครับ`,
    'เคยขี่ม้ามาก่อนไหมครับ แล้วมากี่คนครับ?',
  ].join('\n');

  await persistHorseSelection(guestDbId, channel, ambiguous.name);

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

export function activityBookingFallbackDraft(request: BrainRequest): Record<string, unknown> | null {
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

function activityBookingFallbackPrompt(request: BrainRequest): BrainResponse | null {
  const draft = activityBookingFallbackDraft(request);
  if (!draft) return null;
  if (activityFallbackCommit(request.message)) return null;
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
      : [`สรุปคำขอจองขี่ม้า ${horseName}`, ...summary, 'ถ้าถูกต้อง พิมพ์ “ยืนยัน” เพื่อส่งคำขอจองเข้าระบบครับ'].join('\n'),
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

async function executeDeterministicActivityBooking(
  args: Record<string, unknown>,
  request: BrainRequest,
  guestDbId: string | null,
  channel: BrainChannel,
): Promise<BrainResponse> {
  const horseName = typeof args.horseName === 'string' ? args.horseName : null;
  const selectedAsset = horseName ? activityAssetFromText(horseName) : activityAssetFromText(request.message);
  const selectedHorseName = horseName ?? selectedAsset?.name ?? null;
  const note = selectedAsset ? formatActivityAssetNote(selectedAsset) : (typeof args.note === 'string' ? args.note : null);

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
      'ทีมงานจะยืนยันอีกครั้งทาง LINE / โทร / อีเมล',
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
async function deterministicServiceFeedbackResponse(
  request: BrainRequest,
  channel: BrainChannel,
  guestDbId: string | null,
): Promise<BrainResponse | null> {
  const match = classifyServiceFeedback(request.message);
  if (!match) return null;
  const { notificationQueued } = await createFeedbackEvent({
    match, message: request.message, channel, guestDbId,
  });
  return {
    message: composeServiceFeedbackResponse(match, notificationQueued),
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
  return {
    message: composeActivityIntentStartResponse(classifyActivityIntentQualifier(request.message)),
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
    const container = await loadTaskState(guestDbId);
    if (container.activeTask && !['completed', 'cancelled', 'failed', 'superseded'].includes(container.activeTask.status)) {
      return;
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
  function coreResult(statusCode: number, payload: unknown): ThongthaiChatCoreResult {
    return { statusCode, payload: payload as Record<string, unknown> };
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

  // eventId is whatever the transport layer determined (LINE's own message
  // id; the web HTTP handler's rawBody.eventId or x-nf-request-id/x-request-id
  // header -- see the handler below). A generated per-invocation fallback
  // still separates two intentional identical messages when transport gave
  // us nothing stable (unlike hashing message text).
  const transportEventId = eventId
    ?? `server:${channel}:${Date.now()}:${Math.random().toString(36).slice(2, 12)}`;

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

  const earlyActivityFallback = await activityBookingFallbackResponse(request, guestDbId, channel).catch(error => {
    console.error('THONGTHAI_ACTIVITY_HISTORY_FALLBACK_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
    return null;
  });
  if (earlyActivityFallback) {
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

  // Service Mind -- see deterministicServiceFeedbackResponse's own header
  // comment for why this must be checked this early (before any
  // transaction-processing code, before One-Mind, before domain routing).
  const serviceFeedback = await deterministicServiceFeedbackResponse(request, channel, guestDbId).catch(error => {
    console.error('THONGTHAI_SERVICE_FEEDBACK_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
    return null;
  });
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
  const preserveRestaurantFastPath = isRestaurantAdvisorTurn(request, { agentState: {} });
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
  if (process.env.THONGTHAI_ONE_MIND_CUTOVER === '1' && !preserveExperienceDiscoveryFastPath
      && !preserveRestaurantFastPath && !preserveLocalConciergeFastPath) {
    try {
      const oneMind = await processOneMindCustomerTurn({
        channel,
        language:request.language,
        message:request.message,
        eventId:transportEventId,
        providerUserKey:providerUserKey ?? request.guestId,
        canonicalAnonymousId:request.guestId,
        guestDbId,
        persistState:true,
      });
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
        return coreResult(200, {
          message:oneMind.response.message,
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

  const [communityOfferings, runtime] = await Promise.all([
    loadVerifiedCommunityOfferings(),
    loadBrainRuntime(guestDbId, channel),
  ]);

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
  const localConcierge = await deterministicLocalConciergeResponse(request).catch(error => {
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

  const deterministicActivity = await deterministicActivityResponse(
    request,
    guestDbId,
    channel,
    transportEventId,
    providerUserKey,
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

  const deterministicRestaurant = await deterministicRestaurantResponse(request, runtime, guestDbId, channel).catch(error => {
    console.error('THONGTHAI_RESTAURANT_DETERMINISTIC_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
    return null;
  });
  if (deterministicRestaurant) {
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
