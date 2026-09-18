import { EXPERIENCES, annotateForGroup } from '../../src/data/experiences';
import type { VerifiedCommunityOffering } from './_customer-db';
import type { PendingPromotionRedemption } from './_promotion-dialog';
import {
  THONGTHAI_BIBLE_SECTIONS,
  THONGTHAI_BIBLE_VERSION,
} from './_thongthai-bible-generated';

export const THONGTHAI_BRAIN_VERSION = '2026-09-agentic-operations-v3-activity-inventory';
export { THONGTHAI_BIBLE_VERSION };

export interface ChatTurn { role: 'user' | 'assistant'; content: string }
export interface GuestContext {
  tripDuration: string | null;
  travelerType: string | null;
  group: { adults: number | null; children: number | null; elderly: number | null };
  interests: string[];
  pace: string | null;
  budget: number | null;
  constraints: string[];
}
export interface JourneyContext {
  currentPlan: unknown | null;
  savedPlan: unknown | null;
  visitedExperiences: string[];
  favorites: string[];
  journalEntries: unknown[];
}
export interface BrainRequest {
  guestId?: string;
  message: string;
  language: 'th' | 'en' | 'zh' | 'lo' | 'vi';
  chatHistory: ChatTurn[];
  guestContext: GuestContext;
  journeyContext: JourneyContext;
  pageContext: { section: string | null };
}
export type ChatIntent =
  | 'conversation' | 'create_journey' | 'modify_journey' | 'explain_journey'
  | 'save_journey' | 'journal' | 'recommendation' | 'information'
  | 'booking' | 'order' | 'customer_service';
export type BrainChannel = 'line' | 'web' | 'facebook' | 'backoffice';
export type ResponseStyle = 'direct' | 'story' | 'contrast' | 'curious' | 'reflective' | 'planner';
export type BrainToolName =
  | 'save_journey' | 'favorite_experience' | 'unfavorite_experience' | 'mark_visited'
  | 'request_handoff' | 'list_booking_options' | 'create_booking'
  | 'create_cafe_inquiry' | 'list_otop_products' | 'create_otop_order'
  | 'list_restaurant_menu' | 'create_restaurant_preorder' | 'redeem_promotion';
export interface BrainToolCall { name: BrainToolName; args: Record<string, unknown> }
export interface BrainToolResult { name: BrainToolName; ok: boolean; detail: string }
export interface AgentStateUpdate {
  activeTopic?: string;
  travelContextSummary?: string;
  unresolvedNeed?: string;
  clearUnresolvedNeed?: boolean;
  restaurantProposedSet?: {
    source: 'restaurant_menu_advisor_v1';
    items: Array<{ name: string; quantity: number }>;
    total: number;
    budget: number | null;
    partySize: number | null;
    createdAt: string;
  };
  /** Deterministic promo-redemption-in-progress state -- set only by the
   *  TS-native fallback dialog in thongthai-chat.ts, never by the LLM's own
   *  JSON output (not part of the documented OUTPUT schema below). */
  pendingPromotionRedemption?: PendingPromotionRedemption;
  clearPendingPromotionRedemption?: boolean;
}
export interface SemanticMemoryUpdate { key: string; value: string | string[]; confidence: number }
export interface BrainRuntimeContext {
  agentState: Record<string, unknown>;
  semanticMemory: Array<{
    key: string; value: unknown; confidence: number; sourceChannel: string;
    evidenceCount: number; lastObservedAt: string;
  }>;
  worldFacts: Array<{ fact_key: string; category: string; fact_value: unknown; source: string | null; updated_at: string }>;
  toolResults: BrainToolResult[];
}
export interface BrainResponse {
  message: string;
  intent: ChatIntent;
  contextUpdates: Partial<GuestContext>;
  journeyAction: { type: 'none' | 'create' | 'modify' | 'replace'; journey: unknown | null };
  suggestedActions: Array<{ label: string; action: string }>;
  responseStyle: ResponseStyle;
  agentStateUpdate?: AgentStateUpdate;
  semanticMemoryUpdates?: SemanticMemoryUpdate[];
  toolCalls?: BrainToolCall[];
}

export class ProviderNotConfiguredError extends Error {
  constructor() { super('GEMINI_API_KEY is not set.'); this.name = 'ProviderNotConfiguredError'; }
}
class LLMRequestError extends Error {
  constructor(message: string) { super(message); this.name = 'LLMRequestError'; }
}
export class LLMAvailabilityError extends LLMRequestError {
  constructor(message: string) { super(message); this.name = 'LLMAvailabilityError'; }
}

const GEMINI_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash'] as const;
const OPENAI_MODEL = 'gpt-5.6-luna';
const VALID_INTENTS: ChatIntent[] = [
  'conversation','create_journey','modify_journey','explain_journey','save_journey','journal',
  'recommendation','information','booking','order','customer_service',
];
const VALID_STYLES: ResponseStyle[] = ['direct','story','contrast','curious','reflective','planner'];
const VALID_TOOLS: BrainToolName[] = [
  'save_journey','favorite_experience','unfavorite_experience','mark_visited','request_handoff',
  'list_booking_options','create_booking','create_cafe_inquiry','list_otop_products','create_otop_order',
  'list_restaurant_menu','create_restaurant_preorder','redeem_promotion',
];
const VALID_TRIP_DURATIONS = ['short','half','full','overnight','2d1n','3d2n'];
const VALID_TRAVELER_TYPES = ['solo','couple','family','friends'];
const VALID_PACES = ['slow','balanced','active'];
const SAFE_SEMANTIC_KEYS = new Set([
  'discovery_style','preferred_moods','experience_preferences','stay_preferences','activity_preferences','avoid_experiences',
]);

export function getBrainChannel(section: string | null): BrainChannel {
  if (section === 'line') return 'line';
  if (section === 'facebook' || section === 'messenger') return 'facebook';
  if (section === 'backoffice' || section === 'admin') return 'backoffice';
  return 'web';
}

async function callGemini(systemPrompt: string, messages: ChatTurn[]): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ProviderNotConfiguredError();
  const contents = messages.map(message => ({
    role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }],
  }));
  let lastAvailabilityError = '';
  for (const model of GEMINI_MODELS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] }, contents,
          generationConfig: { responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' }, maxOutputTokens: 4096 },
        }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        if (response.status === 429 || response.status === 503) {
          lastAvailabilityError = `Gemini ${response.status}`;
          continue;
        }
        throw new LLMRequestError(`Gemini ${response.status}: ${body.slice(0, 240)}`);
      }
      const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; promptFeedback?: { blockReason?: string } };
      if (data.promptFeedback?.blockReason) throw new LLMRequestError(`Gemini blocked: ${data.promptFeedback.blockReason}`);
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new LLMRequestError('Gemini returned no text');
      console.log('THONGTHAI_BRAIN_MODEL_SUCCESS', model, THONGTHAI_BRAIN_VERSION);
      return text;
    } catch (error) {
      if ((error as Error).name === 'AbortError') { lastAvailabilityError = 'Gemini timeout'; continue; }
      if (error instanceof LLMRequestError) throw error;
      throw new LLMRequestError(`Gemini network error: ${(error as Error).message}`);
    } finally { clearTimeout(timeout); }
  }
  throw new LLMAvailabilityError(lastAvailabilityError || 'Gemini unavailable');
}

async function callOpenAI(systemPrompt: string, messages: ChatTurn[]): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new LLMAvailabilityError('OpenAI fallback not configured');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: OPENAI_MODEL, instructions: systemPrompt,
        input: messages.map(message => ({ role: message.role, content: [{ type: message.role === 'assistant' ? 'output_text' : 'input_text', text: message.content }] })),
        reasoning: { effort: 'none' }, max_output_tokens: 4096,
        text: { format: { type: 'json_schema', name: 'thongthai_brain_response', strict: false, schema: { type: 'object' } } },
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if ([429,500,502,503,504].includes(response.status)) throw new LLMAvailabilityError(`OpenAI ${response.status}`);
      throw new LLMRequestError(`OpenAI ${response.status}: ${body.slice(0, 240)}`);
    }
    const data = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
    let text = data.output_text ?? '';
    if (!text) for (const item of data.output ?? []) for (const content of item.content ?? []) if (content.type === 'output_text' && content.text) text += content.text;
    if (!text) throw new LLMRequestError('OpenAI returned no text');
    return text;
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw new LLMAvailabilityError('OpenAI timeout');
    throw error;
  } finally { clearTimeout(timeout); }
}

export async function callPreferredModel(systemPrompt: string, messages: ChatTurn[]): Promise<string> {
  try { return await callGemini(systemPrompt, messages); }
  catch (error) {
    if (!(error instanceof LLMAvailabilityError)) throw error;
    console.log('THONGTHAI_BRAIN_PROVIDER_FALLBACK', 'gemini', 'openai');
    return callOpenAI(systemPrompt, messages);
  }
}

export interface StayBookingInterpretation {
  checkInDate: string | null;
  checkOutDate: string | null;
  partySize: number | null;
  roomQuantity: number | null;
}

/**
 * Uses the same Thongthai model stack as the main conversation brain to understand
 * a booking turn. Database state remains authoritative; this only extracts fields
 * the customer actually expressed, including colloquial Thai and misspellings.
 */
export async function interpretStayBookingTurn(
  message: string,
  current: StayBookingInterpretation,
): Promise<StayBookingInterpretation> {
  const currentBangkok = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const prompt = `You are the language-understanding layer of Thongthai for an active stay-booking conversation.
Understand natural Thai, English, colloquial wording, omitted words, and ordinary typing mistakes from context.
Today in Bangkok is ${currentBangkok}.
Current collected booking state: ${JSON.stringify(current)}

Extract only values stated or unambiguously implied by THIS customer message. The current state tells you what question is pending.
- If check-in already exists and check-out is missing, a date-only answer such as "วันที่ 2", even with a misspelled checkout word, means check-out.
- Resolve relative dates and year rollovers in Asia/Bangkok.
- Do not invent a value. Do not return prose.
- Return dates as Gregorian YYYY-MM-DD and counts as integers.

Return ONLY JSON:
{"checkInDate":string|null,"checkOutDate":string|null,"partySize":number|null,"roomQuantity":number|null}`;
  const raw = await callPreferredModel(prompt, [{ role: 'user', content: message }]);
  const parsed = JSON.parse(stripCodeFences(raw)) as Record<string, unknown>;
  const date = (value: unknown) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parsedDate = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== value ? null : value;
  };
  const count = (value: unknown, max: number) => {
    const number = Number(value);
    return Number.isInteger(number) && number >= 1 && number <= max ? number : null;
  };
  const checkInDate = date(parsed.checkInDate);
  const checkOutDate = date(parsed.checkOutDate);
  return {
    checkInDate,
    checkOutDate: checkOutDate && checkOutDate > (checkInDate ?? current.checkInDate ?? '') ? checkOutDate : null,
    partySize: count(parsed.partySize, 50),
    roomQuantity: count(parsed.roomQuantity, 20),
  };
}

function channelPolicy(channel: BrainChannel): string {
  if (channel === 'line') return 'LINE: short phone chat; no Markdown; natural, compact, never brochure-like.';
  if (channel === 'facebook') return 'FACEBOOK/MESSENGER: conversational and skimmable; same brain and memory.';
  if (channel === 'backoffice') return 'BACKOFFICE: operational clarity first; state uncertainty explicitly.';
  return 'WEBSITE: slightly more detail is fine; avoid duplicating rich UI.';
}

function buildBrainPrompt(req: BrainRequest, communityOfferings: VerifiedCommunityOffering[], runtime: BrainRuntimeContext): string {
  const channel = getBrainChannel(req.pageContext.section);
  const hasElderly = (req.guestContext.group.elderly ?? 0) > 0 || req.guestContext.constraints.some(item => /elderly|mobility|walk/i.test(item));
  const hasChildren = (req.guestContext.group.children ?? 0) > 0;
  const catalog = annotateForGroup(hasElderly, hasChildren);
  const currentBangkok = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
  return `THONGTHAI BRAIN — ${THONGTHAI_BRAIN_VERSION} — BIBLE ${THONGTHAI_BIBLE_VERSION}

IDENTITY
${THONGTHAI_BIBLE_SECTIONS.identity}
Current Bangkok date/time: ${currentBangkok} (Asia/Bangkok). Resolve relative dates such as วันนี้/พรุ่งนี้ from this.

PERSONALITY
${THONGTHAI_BIBLE_SECTIONS.personality}

CONVERSATION DOCTRINE
${THONGTHAI_BIBLE_SECTIONS.conversationDoctrine}

ECOSYSTEM VOCABULARY & RELATIONSHIPS
${THONGTHAI_BIBLE_SECTIONS.ecosystemVocabulary}

CUSTOMER SERVICE DOCTRINE
${THONGTHAI_BIBLE_SECTIONS.customerServiceDoctrine}

RECOMMENDATION DOCTRINE
${THONGTHAI_BIBLE_SECTIONS.recommendationDoctrine}

OPERATIONAL TRUTH DOCTRINE
${THONGTHAI_BIBLE_SECTIONS.operationalTruthDoctrine}

MEMORY & PRIVACY DOCTRINE
${THONGTHAI_BIBLE_SECTIONS.memoryPrivacyDoctrine}

FAILURE DOCTRINE
${THONGTHAI_BIBLE_SECTIONS.failureDoctrine}

CHANNEL PRESENTATION DOCTRINE
${THONGTHAI_BIBLE_SECTIONS.channelPresentationDoctrine}

OPERATIONS MODE
You can now perform REAL operational work. Do not pretend a booking/order exists unless a create tool returns success.
- Restaurant booking: requires a date, a specific available time/slot, party size, and enough customer identity/contact information for staff to follow up. A LINE conversation can count as a reachable channel, but still ask the customer's name before creating the booking if no name is known in the current conversation.
- Stay booking: requires check-in date, check-out date, room quantity, and customer name. Contact information should be requested if not already supplied.
- Stay special request is part of the booking itself, not a separate generic handoff. Once required stay details are complete, ask once naturally whether the guest needs anything prepared or noted for the stay (examples: extra pillows, child/elderly needs, accessibility, allergy/food concern, celebration setup, arrival timing, housekeeping preference). This question is optional and must not become a loop. If the guest already gave a request, do not ask again. If the guest says none/no, proceed immediately.
- Put the guest's operational special request into create_booking.note so it travels with the Booking to backoffice and the stay team. Preserve the meaning faithfully; summarize only enough to be clear. Never promise the request is guaranteed. Say the team will review/confirm it with the booking when fulfillment is not already verified.
- Restaurant MENU source of truth is verified world fact restaurant_menu_live, backed by tamma_chart_os menu + recipes + live stock. For food/menu/price/ingredient/availability questions, use ONLY this live source. Never rely on an old poster, memory, or invented dish. If orderable=false, say the dish is temporarily unavailable and, when useful, name the unavailable ingredient. The customer menu page is the menuUrl in that fact.
- For restaurant recommendation, comparison, budget/set building, pairing, substitution, constraints, allergy/avoidance, or "what should I eat" requests, CALL list_restaurant_menu. The tool returns advisor: deterministic grounded selection/scoring/set math. Compose your language from advisor; do not choose/invent items yourself from memory.
- Do not surface internal menu descriptions that look like placeholders/backoffice copy. Prefer advisor summaries/profile dimensions and live prices.
- If advisor.notices mentions allergy/cross-contact, include the warning naturally. Never claim an allergy is 100% safe or cross-contamination-free.
- When the guest asks for a budget/table/set, answer with the advisor set only: items, quantities, line totals, total, remaining budget if useful, and any budget limitation. Do not exceed advisor.set.total or add dishes not in advisor.
- When the guest changes constraints after a previous restaurant set (e.g. "ไม่เอาหมู", "เผ็ดไป"), call list_restaurant_menu again and use the recomposed advisor result.
- If the guest explicitly accepts the latest restaurant set ("เอาชุดนี้", "ตามนี้", "โอเคชุดนี้"), use Travel-only working state.restaurantProposedSet as the exact preorder items. Do not make the guest retype menu names. If date/time/name are missing, collect only missing fields. Once complete, call create_restaurant_preorder with those exact items.
- If list_restaurant_menu TOOL RESULT advisor.mode is compose_set and advisor.set.items exist, include agentStateUpdate.restaurantProposedSet with those item names/quantities/total/budget/partySize/source so the next turn can create a preorder from "เอาชุดนี้".
- Restaurant PREORDER is different from a restaurant/table booking. For food ordered ahead, collect exact menu items + quantity, pickup date, pickup time, customer name, and contact if the channel itself is not reachable. Then use create_restaurant_preorder. A successful preorder is REQUESTED until staff accepts it in the restaurant LINE group. Never claim staff accepted it before the tool result says so.
- If create_restaurant_preorder TOOL RESULT contains duplicate=true, this is an EXISTING preorder, not a new one. Explicitly say no duplicate was created, show the existing preorder code, and keep its existing status. Never say the duplicate request was newly accepted/recorded.
- Activity booking is inventory-backed. The verified world facts contain the current real catalog, prices and active inventory. Never invent them.
- Valid activity resource mapping: ATV = activity-atv, ขี่ม้า = activity-horse, ยิงธนู = activity-archery. Do not use the old generic activity-adventure resource.
- Before creating an activity booking, collect: exact activity, duration (30/60/90 minutes), date, a specific available start time, participant count, and customer name/contact. Participant count consumes the same number of physical capacity units.
- For activity pricing, a null price means the owner has not configured that price yet. Say the price is not set/needs staff confirmation; never turn null into 0 or invent a price.
- Café questions: answer verified facts directly. If the requested fact is not verified or the customer asks staff to contact them, create a café inquiry rather than inventing an answer.
- OTOP: list real orderable products first. Create an order only after the guest explicitly selects a product/quantity and provides enough contact/fulfillment details.
- A booking/order initially means REQUESTED, not confirmed. Staff confirmation happens in backoffice. Say that clearly without sounding bureaucratic.
- Promotions: verified world fact active_promotions_live is the ONLY source of real, currently-live promotions for this channel. It already excludes draft/pending_review/paused/ended/cancelled/test, expired or not-yet-started windows, wrong channel, over-redeemed, and any promo with an unavailable item. Never mention, invent, or offer a promotion that is not in this list. Quote only the items, quantities and prices it contains — never recompute a discount or margin yourself. If a guest asks about a deal/promotion/discount that is not in this list, say there is no such active promotion right now rather than guessing. To redeem one, call redeem_promotion with its campaignId. businessScope "restaurant" also needs pickup date/time and a customer name (same as a preorder) before calling. Any other businessScope has no automated booking yet — after redeem_promotion succeeds, tell the guest staff will follow up to arrange it; never claim it is fully booked.
- Never invent availability, price, stock, opening hours or confirmation.
- Never store contact data in semanticMemory or agentState. Contact data may appear only in an operational tool call that the guest explicitly provided for the transaction.

TOOL USE
1. list_booking_options {serviceType, date, resourceCode?, durationMinutes?, partySize?} — check live schedule for restaurant | stay | activity. For activity, pass the exact resourceCode plus 30/60/90 duration and participant count so availability spans the whole requested duration. For stay this lists check-in day availability only; use create_booking with check-in/check-out for final allocation.
2. create_booking {serviceType, resourceCode?, date, time?, endDate?, durationMinutes?, partySize?, quantity?, customerName?, phone?, email?, note?} — create a REAL requested booking. For activity, resourceCode and durationMinutes are mandatory and the selected slot must be unambiguous. For stay, note is the guest's special request / preparation note and must travel with the booking when provided. Use only after explicit booking intent and enough details. Do not call if multiple slots are still ambiguous.
3. create_cafe_inquiry {question, customerName?, phone?, email?} — create a real staff follow-up item when the café question cannot be answered from verified facts or human contact is requested.
4. list_otop_products {} — list current real orderable OTOP products and stock-safe product information.
5. create_otop_order {sku, quantity, customerName?, phone?, email?, fulfillmentType?, shippingAddress?, note?} — create a REAL requested order after explicit choice.
6. list_restaurant_menu {} — read the current real ตำมา-ชาติ menu, prices, ingredients and live availability from the restaurant source of truth. Required for restaurant recommendations, comparisons, budget sets, pairings, substitutions and food constraints.
7. create_restaurant_preorder {date, time, items:[{name,quantity}], customerName, phone?, email?, note?} — create a REAL food preorder request. Item names must come from the live menu. Date/time is the requested food pickup time in Asia/Bangkok.
8. redeem_promotion {campaignId, date?, time?, customerName, phone?, email?, note?} — redeem one entry from verified world fact active_promotions_live by its campaignId. date/time are required only when that promotion's businessScope is "restaurant". Never call with a campaignId not present in active_promotions_live.
9. save_journey {}, favorite_experience {experienceId}, unfavorite_experience {experienceId}, mark_visited {experienceId}, request_handoff {reasonCode} keep their prior meanings.
If TOOL RESULTS below are non-empty, those actions already ran. Do not repeat them in the same turn; compose the final answer from their success/failure.

CHANNEL
${channelPolicy(channel)}

TRUSTED STATE
Guest context: ${JSON.stringify(req.guestContext)}
Journey context: ${JSON.stringify(req.journeyContext)}
Travel-only working state: ${JSON.stringify(runtime.agentState)}
Travel-only semantic memory: ${JSON.stringify(runtime.semanticMemory)}
Verified world facts: ${JSON.stringify(runtime.worldFacts)}
Verified community offerings: ${JSON.stringify(communityOfferings)}
Experience catalog: ${JSON.stringify(catalog)}
TOOL RESULTS: ${runtime.toolResults.length ? JSON.stringify(runtime.toolResults) : '[]'}

MEMORY / PRIVACY
Structured travel context is authoritative. Semantic memory may store only durable travel/experience preferences. Never store names, phone, email, address, payments, raw chat text or unrelated personal information there.
Allowed semantic keys: discovery_style, preferred_moods, experience_preferences, stay_preferences, activity_preferences, avoid_experiences.
Food preferences/avoidances may be carried only as structured guestContext.constraints, never raw text or health diagnosis. Allowed food constraint codes include: no_pork, no_beef, no_chicken, no_fish, no_egg, no_plara, no_peanut, no_shrimp, vegetarian, no_spicy, mild_spice, peanut_allergy, shrimp_allergy, fish_allergy, egg_allergy, authentic_isan, beginner_friendly, kid_friendly.

JOURNEY
Casual/factual questions do not change a Journey. Create/modify only when the CURRENT request asks for planning. Respect mobility, children, elderly and pace constraints. Journey IDs must come from the catalog.

OUTPUT
Reply language: ${req.language}. Channel: ${channel}.
Return ONLY one JSON object:
{
  "message": string,
  "intent": "conversation"|"create_journey"|"modify_journey"|"explain_journey"|"save_journey"|"journal"|"recommendation"|"information"|"booking"|"order"|"customer_service",
  "contextUpdates": object,
  "journeyAction": {"type":"none"|"create"|"modify"|"replace","journey":object|null},
  "suggestedActions": [{"label":string,"action":string}],
  "responseStyle": "direct"|"story"|"contrast"|"curious"|"reflective"|"planner",
  "agentStateUpdate": {"activeTopic"?:string,"travelContextSummary"?:string,"unresolvedNeed"?:string,"clearUnresolvedNeed"?:boolean,"restaurantProposedSet"?:object},
  "semanticMemoryUpdates": [{"key":string,"value":string|string[],"confidence":number}],
  "toolCalls": [{"name":string,"args":object}]
}`;
}

function isNonEmptyString(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function normalizeContextUpdates(updates: Record<string, unknown>): Partial<GuestContext> {
  const out: Partial<GuestContext> = {};
  if (typeof updates.tripDuration === 'string' && VALID_TRIP_DURATIONS.includes(updates.tripDuration)) out.tripDuration = updates.tripDuration;
  if (typeof updates.travelerType === 'string' && VALID_TRAVELER_TYPES.includes(updates.travelerType)) out.travelerType = updates.travelerType;
  if (typeof updates.pace === 'string' && VALID_PACES.includes(updates.pace)) out.pace = updates.pace;
  if (updates.group && typeof updates.group === 'object') out.group = updates.group as GuestContext['group'];
  if (typeof updates.budget === 'number' && Number.isFinite(updates.budget)) out.budget = updates.budget;
  if (Array.isArray(updates.interests)) out.interests = updates.interests.filter(isNonEmptyString);
  if (Array.isArray(updates.constraints)) out.constraints = updates.constraints.filter(isNonEmptyString);
  return out;
}
function normalizeAgentState(value: unknown): AgentStateUpdate | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>; const out: AgentStateUpdate = {};
  if (isNonEmptyString(raw.activeTopic)) out.activeTopic = raw.activeTopic.slice(0,100);
  if (isNonEmptyString(raw.travelContextSummary)) out.travelContextSummary = raw.travelContextSummary.slice(0,600);
  if (isNonEmptyString(raw.unresolvedNeed)) out.unresolvedNeed = raw.unresolvedNeed.slice(0,220);
  if (raw.clearUnresolvedNeed === true) out.clearUnresolvedNeed = true;
  const proposed = sanitizeRestaurantProposedSet(raw.restaurantProposedSet);
  if (proposed) out.restaurantProposedSet = proposed;
  return Object.keys(out).length ? out : undefined;
}
function sanitizeRestaurantProposedSet(value: unknown): AgentStateUpdate['restaurantProposedSet'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const items = rawItems.slice(0,20)
    .map(item => item && typeof item === 'object' ? item as Record<string, unknown> : {})
    .map(item => ({ name:safeString(item.name,160), quantity:safeNumber(item.quantity,1,50) ?? 1 }))
    .filter((item): item is { name:string; quantity:number } => Boolean(item.name));
  if (!items.length) return undefined;
  const total = typeof raw.total === 'number' && Number.isFinite(raw.total) ? Math.max(0, Math.floor(raw.total)) : 0;
  const budget = typeof raw.budget === 'number' && Number.isFinite(raw.budget) ? Math.max(0, Math.floor(raw.budget)) : null;
  const partySize = typeof raw.partySize === 'number' && Number.isFinite(raw.partySize) ? Math.max(1, Math.floor(raw.partySize)) : null;
  return {
    source:'restaurant_menu_advisor_v1',
    items,
    total,
    budget,
    partySize,
    createdAt:isNonEmptyString(raw.createdAt) ? String(raw.createdAt).slice(0,40) : new Date().toISOString(),
  };
}
function normalizeSemanticUpdates(value: unknown): SemanticMemoryUpdate[] {
  if (!Array.isArray(value)) return [];
  return value.filter(item => item && typeof item === 'object').map(item => item as Record<string, unknown>)
    .filter(item => typeof item.key === 'string' && SAFE_SEMANTIC_KEYS.has(item.key))
    .map(item => ({
      key: String(item.key),
      value: Array.isArray(item.value) ? item.value.filter(isNonEmptyString).slice(0,12) : isNonEmptyString(item.value) ? String(item.value).slice(0,120) : '',
      confidence: Math.max(0.5, Math.min(1, Number(item.confidence) || 0.7)),
    })).filter(item => Array.isArray(item.value) ? item.value.length > 0 : Boolean(item.value)).slice(0,8);
}
function safeString(value: unknown, max = 1000): string | undefined {
  return isNonEmptyString(value) ? value.trim().slice(0,max) : undefined;
}
function safeNumber(value: unknown, min: number, max: number): number | undefined {
  const n = Number(value); return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : undefined;
}
function dateString(value: unknown): string | undefined {
  const s = safeString(value, 10); return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
}
function timeString(value: unknown): string | undefined {
  const s = safeString(value, 5); return s && /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : undefined;
}
export function normalizeToolCalls(value: unknown, toolResultsPresent: boolean, runtime: BrainRuntimeContext): BrainToolCall[] {
  if (toolResultsPresent || !Array.isArray(value)) return [];
  const experienceIds = new Set(EXPERIENCES.map(item => item.id));
  const calls: BrainToolCall[] = [];
  for (const item of value.slice(0,4)) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    if (!VALID_TOOLS.includes(raw.name as BrainToolName)) continue;
    const name = raw.name as BrainToolName;
    const args = raw.args && typeof raw.args === 'object' ? raw.args as Record<string, unknown> : {};
    if (['favorite_experience','unfavorite_experience','mark_visited'].includes(name)) {
      const id = safeString(args.experienceId,120); if (id && experienceIds.has(id)) calls.push({ name, args: { experienceId: id } }); continue;
    }
    if (name === 'request_handoff') {
      const allowed = new Set(['booking_help','accessibility_help','complaint','other']);
      calls.push({ name, args: { reasonCode: allowed.has(String(args.reasonCode)) ? String(args.reasonCode) : 'other' } }); continue;
    }
    if (name === 'list_booking_options') {
    const serviceType = safeString(args.serviceType,20);
    const date = dateString(args.date);
    if (serviceType && ['restaurant','stay','activity'].includes(serviceType) && date) calls.push({ name, args: {
      serviceType, date,
      ...(safeString(args.resourceCode,80) ? { resourceCode: safeString(args.resourceCode,80) } : {}),
      ...(safeNumber(args.durationMinutes,30,90) && [30,60,90].includes(Number(args.durationMinutes)) ? { durationMinutes: safeNumber(args.durationMinutes,30,90) } : {}),
      ...(safeNumber(args.partySize,1,50) ? { partySize: safeNumber(args.partySize,1,50) } : {}),
    }});
    continue;
  }
    if (name === 'create_booking') {
    const serviceType = safeString(args.serviceType,20); const date = dateString(args.date);
    if (!serviceType || !['restaurant','stay','activity'].includes(serviceType) || !date) continue;
    calls.push({ name, args: {
      serviceType, date,
      ...(safeString(args.resourceCode,80) ? { resourceCode: safeString(args.resourceCode,80) } : {}),
      ...(timeString(args.time) ? { time: timeString(args.time) } : {}),
      ...(dateString(args.endDate) ? { endDate: dateString(args.endDate) } : {}),
      ...(safeNumber(args.durationMinutes,30,90) && [30,60,90].includes(Number(args.durationMinutes)) ? { durationMinutes: safeNumber(args.durationMinutes,30,90) } : {}),
      ...(safeNumber(args.partySize,1,50) ? { partySize: safeNumber(args.partySize,1,50) } : {}),
      ...(safeNumber(args.quantity,1,20) ? { quantity: safeNumber(args.quantity,1,20) } : {}),
      ...(safeString(args.customerName,120) ? { customerName: safeString(args.customerName,120) } : {}),
      ...(safeString(args.phone,30) ? { phone: safeString(args.phone,30) } : {}),
      ...(safeString(args.email,160) ? { email: safeString(args.email,160) } : {}),
      ...(safeString(args.note,1000) ? { note: safeString(args.note,1000) } : {}),
    }}); continue;
  }
    if (name === 'list_restaurant_menu') { calls.push({ name, args: {} }); continue; }
    if (name === 'create_restaurant_preorder') {
      const date = dateString(args.date); const time = timeString(args.time);
      const customerName = safeString(args.customerName,120);
      const rawItems = Array.isArray(args.items) ? args.items : [];
      let items = rawItems.slice(0,20).map(item => item && typeof item === 'object' ? item as Record<string,unknown> : {})
        .map(item => ({ name:safeString(item.name,160), quantity:safeNumber(item.quantity,1,50) ?? 1 }))
        .filter((item): item is {name:string;quantity:number} => Boolean(item.name));
      if (!items.length && args.useLastRestaurantSet === true) {
        items = sanitizeRestaurantProposedSet(runtime.agentState.restaurantProposedSet)?.items ?? [];
      }
      if (!date || !time || !customerName || !items.length) continue;
      calls.push({ name, args: { date,time,items,customerName,
        ...(safeString(args.phone,30) ? {phone:safeString(args.phone,30)} : {}),
        ...(safeString(args.email,160) ? {email:safeString(args.email,160)} : {}),
        ...(safeString(args.note,1000) ? {note:safeString(args.note,1000)} : {}),
      }}); continue;
    }
    if (name === 'create_cafe_inquiry') {
      const question = safeString(args.question,2000); if (!question) continue;
      calls.push({ name, args: {
        question,
        ...(safeString(args.customerName,120) ? { customerName: safeString(args.customerName,120) } : {}),
        ...(safeString(args.phone,30) ? { phone: safeString(args.phone,30) } : {}),
        ...(safeString(args.email,160) ? { email: safeString(args.email,160) } : {}),
      }}); continue;
    }
    if (name === 'redeem_promotion') {
      const campaignId = safeString(args.campaignId,64);
      const customerName = safeString(args.customerName,120);
      if (!campaignId || !/^[0-9a-f-]{8,64}$/i.test(campaignId) || !customerName) continue;
      calls.push({ name, args: { campaignId, customerName,
        ...(dateString(args.date) ? { date: dateString(args.date) } : {}),
        ...(timeString(args.time) ? { time: timeString(args.time) } : {}),
        ...(safeString(args.phone,30) ? { phone: safeString(args.phone,30) } : {}),
        ...(safeString(args.email,160) ? { email: safeString(args.email,160) } : {}),
        ...(safeString(args.note,1000) ? { note: safeString(args.note,1000) } : {}),
      }}); continue;
    }
    if (name === 'list_otop_products') { calls.push({ name, args: {} }); continue; }
    if (name === 'create_otop_order') {
      const sku = safeString(args.sku,80); const quantity = safeNumber(args.quantity,1,99); if (!sku || !quantity) continue;
      const fulfillmentType = String(args.fulfillmentType) === 'shipping' ? 'shipping' : 'pickup';
      calls.push({ name, args: {
        sku, quantity, fulfillmentType,
        ...(safeString(args.customerName,120) ? { customerName: safeString(args.customerName,120) } : {}),
        ...(safeString(args.phone,30) ? { phone: safeString(args.phone,30) } : {}),
        ...(safeString(args.email,160) ? { email: safeString(args.email,160) } : {}),
        ...(safeString(args.shippingAddress,500) ? { shippingAddress: safeString(args.shippingAddress,500) } : {}),
        ...(safeString(args.note,1000) ? { note: safeString(args.note,1000) } : {}),
      }}); continue;
    }
    calls.push({ name, args: {} });
  }
  return calls;
}
function validateBrainResponse(data: unknown, runtime: BrainRuntimeContext): BrainResponse {
  if (!data || typeof data !== 'object') throw new Error('Response is not an object');
  const raw = data as Record<string, unknown>;
  if (!isNonEmptyString(raw.message)) throw new Error('Missing message');
  const intent = VALID_INTENTS.includes(raw.intent as ChatIntent) ? raw.intent as ChatIntent : 'conversation';
  const rawJourney = raw.journeyAction && typeof raw.journeyAction === 'object' ? raw.journeyAction as Record<string, unknown> : {};
  const type = ['none','create','modify','replace'].includes(String(rawJourney.type)) ? rawJourney.type as BrainResponse['journeyAction']['type'] : 'none';
  const journey = rawJourney.journey as { days?: Array<{ stops?: Array<{ experienceId?: string }> }> } | null | undefined;
  if (journey?.days) {
    const valid = new Set(EXPERIENCES.map(item => item.id));
    for (const day of journey.days) for (const stop of day.stops ?? []) if (stop.experienceId && !valid.has(stop.experienceId)) throw new Error(`Unknown experience ${stop.experienceId}`);
  }
  return {
    message: raw.message.trim(), intent,
    contextUpdates: normalizeContextUpdates(raw.contextUpdates && typeof raw.contextUpdates === 'object' ? raw.contextUpdates as Record<string, unknown> : {}),
    journeyAction: { type, journey: rawJourney.journey ?? null },
    suggestedActions: Array.isArray(raw.suggestedActions) ? raw.suggestedActions.filter(x => x && typeof x === 'object').map(x => x as Record<string, unknown>).filter(x => isNonEmptyString(x.label) && isNonEmptyString(x.action)).map(x => ({ label: String(x.label).slice(0,80), action: String(x.action).slice(0,200) })).slice(0,6) : [],
    responseStyle: VALID_STYLES.includes(raw.responseStyle as ResponseStyle) ? raw.responseStyle as ResponseStyle : 'direct',
    agentStateUpdate: normalizeAgentState(raw.agentStateUpdate),
    semanticMemoryUpdates: normalizeSemanticUpdates(raw.semanticMemoryUpdates),
    toolCalls: normalizeToolCalls(raw.toolCalls, runtime.toolResults.length > 0, runtime),
  };
}
export function stripCodeFences(text: string): string { return text.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/i,'').trim(); }
function cleanLineMessage(text: string): string {
  return text.replace(/\*\*(.*?)\*\*/gs,'$1').replace(/__(.*?)__/gs,'$1').replace(/^#{1,6}\s+/gm,'').replace(/^\s*[-*]\s+/gm,'• ').replace(/`([^`]+)`/g,'$1').replace(/\n{3,}/g,'\n\n').trim();
}
function adaptResponse(response: BrainResponse, req: BrainRequest): BrainResponse {
  if (getBrainChannel(req.pageContext.section) === 'line') response.message = cleanLineMessage(response.message);
  return response;
}
export function availabilityBrainResponse(): BrainResponse {
  return { message: 'ตอนนี้ทองไทยคิดช้ากว่าปกตินิดหนึ่งครับ ลองส่งอีกครั้งในอีกสักครู่นะครับ', intent: 'conversation', contextUpdates: {}, journeyAction: { type: 'none', journey: null }, suggestedActions: [], responseStyle: 'direct', semanticMemoryUpdates: [], toolCalls: [] };
}
export async function runThongthaiBrain(req: BrainRequest, communityOfferings: VerifiedCommunityOffering[], messages: ChatTurn[], runtime: BrainRuntimeContext): Promise<BrainResponse> {
  const prompt = buildBrainPrompt(req, communityOfferings, runtime);
  let raw = await callPreferredModel(prompt, messages);
  try { return adaptResponse(validateBrainResponse(JSON.parse(stripCodeFences(raw)), runtime), req); }
  catch (firstError) {
    const repaired: ChatTurn[] = [...messages, { role: 'assistant', content: raw }, { role: 'user', content: `Your previous response was invalid: ${(firstError as Error).message}. Return ONLY a corrected JSON object matching the schema.` }];
    raw = await callPreferredModel(prompt, repaired);
    return adaptResponse(validateBrainResponse(JSON.parse(stripCodeFences(raw)), runtime), req);
  }
}
