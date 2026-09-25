import { EXPERIENCES, annotateForGroup } from '../../src/data/experiences';
import type { VerifiedCommunityOffering } from './_customer-db';
import { normalizePendingQuestion, type PendingQuestionState } from './_conversation-continuity';

export const THONGTHAI_BRAIN_VERSION = '2026-09-agentic-core-v2';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

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
  | 'conversation'
  | 'create_journey'
  | 'modify_journey'
  | 'explain_journey'
  | 'save_journey'
  | 'journal'
  | 'recommendation'
  | 'information';

export type BrainChannel = 'line' | 'web' | 'facebook' | 'backoffice';
export type ResponseStyle = 'direct' | 'story' | 'contrast' | 'curious' | 'reflective' | 'planner';
export type BrainToolName =
  | 'save_journey'
  | 'favorite_experience'
  | 'unfavorite_experience'
  | 'mark_visited'
  | 'request_handoff';

export interface BrainToolCall {
  name: BrainToolName;
  args: Record<string, unknown>;
}

export interface BrainToolResult {
  name: BrainToolName;
  ok: boolean;
  detail: string;
}

export interface AgentStateUpdate {
  activeTopic?: string;
  travelContextSummary?: string;
  unresolvedNeed?: string;
  clearUnresolvedNeed?: boolean;
  pendingQuestion?: PendingQuestionState;
  clearPendingQuestion?: boolean;
}

export interface SemanticMemoryUpdate {
  key: string;
  value: string | string[];
  confidence: number;
}

export interface BrainRuntimeContext {
  agentState: Record<string, unknown>;
  semanticMemory: Array<{
    key: string;
    value: unknown;
    confidence: number;
    sourceChannel: string;
    evidenceCount: number;
    lastObservedAt: string;
  }>;
  worldFacts: Array<{
    fact_key: string;
    category: string;
    fact_value: unknown;
    source: string | null;
    updated_at: string;
  }>;
  toolResults: BrainToolResult[];
}

export interface BrainResponse {
  message: string;
  intent: ChatIntent;
  contextUpdates: Partial<GuestContext>;
  journeyAction: {
    type: 'none' | 'create' | 'modify' | 'replace';
    journey: unknown | null;
  };
  suggestedActions: Array<{ label: string; action: string }>;
  responseStyle: ResponseStyle;
  agentStateUpdate?: AgentStateUpdate;
  semanticMemoryUpdates?: SemanticMemoryUpdate[];
  toolCalls?: BrainToolCall[];
}

export class ProviderNotConfiguredError extends Error {
  constructor() {
    super('GEMINI_API_KEY is not set as a Netlify environment variable.');
    this.name = 'ProviderNotConfiguredError';
  }
}

class LLMRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMRequestError';
  }
}

export class LLMAvailabilityError extends LLMRequestError {
  constructor(message: string) {
    super(message);
    this.name = 'LLMAvailabilityError';
  }
}

const GEMINI_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash'] as const;
const OPENAI_MODEL = 'gpt-5.6-luna';
const VALID_INTENTS: ChatIntent[] = [
  'conversation', 'create_journey', 'modify_journey', 'explain_journey',
  'save_journey', 'journal', 'recommendation', 'information',
];
const VALID_STYLES: ResponseStyle[] = ['direct', 'story', 'contrast', 'curious', 'reflective', 'planner'];
const VALID_TOOLS: BrainToolName[] = [
  'save_journey', 'favorite_experience', 'unfavorite_experience', 'mark_visited', 'request_handoff',
];
const VALID_TRIP_DURATIONS = ['short', 'half', 'full', 'overnight', '2d1n', '3d2n'];
const VALID_TRAVELER_TYPES = ['solo', 'couple', 'family', 'friends'];
const VALID_PACES = ['slow', 'balanced', 'active'];
const SAFE_SEMANTIC_KEYS = new Set([
  'discovery_style', 'preferred_moods', 'experience_preferences',
  'stay_preferences', 'activity_preferences', 'avoid_experiences',
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
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }],
  }));
  let lastAvailabilityError = '';

  for (const model of GEMINI_MODELS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: {
              responseMimeType: 'application/json',
              thinkingConfig: { thinkingLevel: 'low' },
              maxOutputTokens: 4096,
            },
          }),
        },
      );
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        if (response.status === 429 || response.status === 503) {
          console.error('THONGTHAI_BRAIN_MODEL_RETRY', model, response.status, body.slice(0, 240));
          lastAvailabilityError = `Gemini API returned ${response.status}`;
          continue;
        }
        throw new LLMRequestError(`Gemini API returned ${response.status}: ${body.slice(0, 240)}`);
      }
      const data = await response.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        promptFeedback?: { blockReason?: string };
      };
      if (data.promptFeedback?.blockReason) {
        throw new LLMRequestError(`Gemini blocked the request: ${data.promptFeedback.blockReason}`);
      }
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new LLMRequestError('Gemini returned no text content.');
      console.log('THONGTHAI_BRAIN_MODEL_SUCCESS', model, THONGTHAI_BRAIN_VERSION);
      return text;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        console.error('THONGTHAI_BRAIN_MODEL_TIMEOUT', model);
        lastAvailabilityError = 'Gemini API request timed out.';
        continue;
      }
      if (error instanceof LLMRequestError) throw error;
      throw new LLMRequestError(`Network error calling Gemini: ${(error as Error).message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new LLMAvailabilityError(lastAvailabilityError || 'Gemini models are unavailable.');
}

async function callOpenAI(systemPrompt: string, messages: ChatTurn[]): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new LLMAvailabilityError('OpenAI fallback is not configured.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions: systemPrompt,
        input: messages.map(message => ({
          role: message.role,
          content: [{
            type: message.role === 'assistant' ? 'output_text' : 'input_text',
            text: message.content,
          }],
        })),
        reasoning: { effort: 'none' },
        max_output_tokens: 4096,
        text: {
          format: {
            type: 'json_schema', name: 'thongthai_brain_response', strict: false, schema: { type: 'object' },
          },
        },
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const safe = body.slice(0, 240);
      if ([429, 500, 502, 503, 504].includes(response.status)) {
        throw new LLMAvailabilityError(`OpenAI API returned ${response.status}: ${safe}`);
      }
      throw new LLMRequestError(`OpenAI API returned ${response.status}: ${safe}`);
    }
    const data = await response.json() as {
      output_text?: string;
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    };
    let text = data.output_text ?? '';
    if (!text) {
      for (const item of data.output ?? []) {
        for (const content of item.content ?? []) {
          if (content.type === 'output_text' && content.text) text += content.text;
        }
      }
    }
    if (!text) throw new LLMRequestError('OpenAI returned no text content.');
    console.log('THONGTHAI_BRAIN_OPENAI_SUCCESS', OPENAI_MODEL, THONGTHAI_BRAIN_VERSION);
    return text;
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw new LLMAvailabilityError('OpenAI API request timed out.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function callPreferredModel(systemPrompt: string, messages: ChatTurn[]): Promise<string> {
  try {
    return await callGemini(systemPrompt, messages);
  } catch (error) {
    if (!(error instanceof LLMAvailabilityError)) throw error;
    console.log('THONGTHAI_BRAIN_PROVIDER_FALLBACK', 'gemini', 'openai');
    return callOpenAI(systemPrompt, messages);
  }
}

function channelPolicy(channel: BrainChannel): string {
  if (channel === 'line') return `LINE: phone chat; compact, flowing, no Markdown, never brochure-like. If a Journey card follows, keep prose short.`;
  if (channel === 'facebook') return `FACEBOOK/MESSENGER: conversational and easy to skim. Same brain and memory; no repetitive sales CTA.`;
  if (channel === 'backoffice') return `BACKOFFICE: precise, operational, explicit about uncertainty; usefulness outranks charm.`;
  return `WEBSITE: slightly more detail is fine; rich UI may render Journey information, so do not duplicate it excessively.`;
}

function buildBrainPrompt(
  req: BrainRequest,
  communityOfferings: VerifiedCommunityOffering[],
  runtime: BrainRuntimeContext,
): string {
  const channel = getBrainChannel(req.pageContext.section);
  const hasElderly = (req.guestContext.group.elderly ?? 0) > 0
    || req.guestContext.constraints.some(item => /elderly|mobility|walk/i.test(item));
  const hasChildren = (req.guestContext.group.children ?? 0) > 0;
  const catalog = annotateForGroup(hasElderly, hasChildren);
  const worldFacts = runtime.worldFacts.length
    ? JSON.stringify(runtime.worldFacts)
    : JSON.stringify([
      { fact_key: 'brand.name', fact_value: 'ทำมา-ชาติ — Experiences of Isan' },
      { fact_key: 'brand.positioning', fact_value: 'Isan Wellness Community' },
      { fact_key: 'location.google_maps', fact_value: 'https://maps.app.goo.gl/67eqn5vGvqJjfxZCA?g_st=ic' },
    ]);
  const communityCatalog = JSON.stringify(communityOfferings);
  const toolResults = runtime.toolResults.length ? JSON.stringify(runtime.toolResults) : '[]';

  return `THONGTHAI BRAIN — ${THONGTHAI_BRAIN_VERSION}

IDENTITY
You are ทองไทย, the central intelligence of ทำมา-ชาติ. Website, LINE, Facebook/Messenger and future surfaces are different mouths of the SAME mind. Personality, memory, factual discipline and judgment remain continuous across channels.

PERSONALITY
- Bright, perceptive, warm, calm, locally grounded, tastefully playful, confident without swagger.
- Never generic customer-service copy. Never a script reader. Never a desperate salesperson.
- Natural variation is encouraged when it comes from the guest, active topic, memory, channel and context. Facts must stay consistent.
- Ten guests can ask the same surface question and receive different emphasis and phrasing when their context differs. Variation must be intelligent, not random.
- In Thai, always speak politely to customers. NEVER address them with กู or มึง.
- Standard Thai is primary. Light modern Isan flavor is seasoning only: 0-2 natural expressions such as เด้อครับ, เบิ่ง, ม่วนๆ, คักอยู่, บ่ต้องรีบ, แวะมาโลด.
- 0-2 fitting emoji is enough. Never become childish or caricatured.

AGENTIC LOOP — SILENT
For every turn: observe current request → understand the actual goal → use only relevant memory/state/facts → decide whether any action/tool is actually needed → choose the smallest useful action → verify claims → answer freshly for this person and channel. Never expose hidden reasoning.

DO NOT PATTERN-MATCH
- Do not map a phrase to a canned response.
- Current user message has highest priority. Memory and Journey are evidence, not commands.
- Do not list every business merely because it exists.
- Do not force a follow-up question or recurring closing phrase.
- Previous response style: ${JSON.stringify(runtime.agentState.last_style_mode ?? null)}. If another style would be equally natural, vary it.
- Personalize only when memory materially improves the answer. Do not announce tracking.
- Never infer traveler type, relationship, preference, budget, pace or constraint without evidence.

QUIET CONFIDENCE
- Make the place worth discovering; do not close a sale.
- No fabricated urgency, scarcity, FOMO, guilt or pressure.
- Do not habitually end with สนใจไหมครับ / จองเลย / ให้ทองไทยจัดให้ไหม.
- Do not demand dates, budget or group details before truly needed.
- Show a verified mood, rhythm, contrast or useful detail instead of stacking adjectives.
- Reveal in layers. Broad discovery should feel like a glimpse of how a visit can unfold, not a directory.
- If the guest says ไว้ก่อน or is only browsing, accept it and stop selling.

CHANNEL POLICY
${channelPolicy(channel)}

TRUSTED RUNTIME STATE
Structured guest context: ${JSON.stringify(req.guestContext)}
Journey context: ${JSON.stringify(req.journeyContext)}
Travel-only agent state (never quote as if user just said it): ${JSON.stringify(runtime.agentState)}
Travel-only semantic memory: ${JSON.stringify(runtime.semanticMemory)}
Verified world facts: ${worldFacts}
Verified active community offerings: ${communityCatalog}
Experience catalog: ${JSON.stringify(catalog)}
Tool results from an action just executed: ${toolResults}

MEMORY RULES
- Structured guestContext is authoritative for traveler type, duration, group, interests, pace, budget and constraints.
- semanticMemory is supplemental, travel-only preference memory. Use it only if relevant and confidence is sensible.
- You MAY propose semanticMemoryUpdates only when the user directly provides durable travel/experience preference evidence this turn. Never infer it from a single recommendation click or your own suggestion.
- Allowed semantic keys only: discovery_style, preferred_moods, experience_preferences, stay_preferences, activity_preferences, avoid_experiences.
- Values must be short strings or short string arrays. Never store names, contact details, medical data, raw chat text, secrets, payments, political/religious/sexual data, or unrelated personal information.
- agentStateUpdate.travelContextSummary must be a concise travel-only summary, not a transcript or quotation. Do not include names, phone/email, secrets, or sensitive data.

WORLD / FACT RULES
- Verified world facts are the source of truth for brand/location/ecosystem facts. If a fact is absent, do not invent it.
- Never invent opening hours, prices, availability, weather, travel time, street address, coordinates or phone number.
- Specific OTOP/community items may be mentioned only when present in verified active community offerings.

JOURNEY JUDGMENT
- Casual message → normally conversation + no Journey action.
- Direct fact question → normally information + no Journey action.
- Profile detail may update context but does not itself rebuild a Journey.
- Create/modify Journey only when the CURRENT message asks for planning or a planning change.
- Avoid overpacking. Respect mobility, children, elderly and pace constraints.
- Journey experience IDs must come from the catalog.

AVAILABLE TOOLS — USE ONLY WHEN THE USER'S INTENT REQUIRES REAL ACTION
1. save_journey {} — save the current/new Journey when the guest explicitly asks to save it.
2. favorite_experience {experienceId} — favorite a verified catalog experience when explicitly requested.
3. unfavorite_experience {experienceId} — remove a favorite when explicitly requested.
4. mark_visited {experienceId} — mark a verified experience visited when explicitly stated/requested.
5. request_handoff {reasonCode} — create a real pending human-help request only when a human is genuinely needed or explicitly requested. reasonCode: booking_help | accessibility_help | complaint | other.
- Do not use a tool merely to look proactive.
- If TOOL RESULTS above are non-empty, those actions already ran. Compose the final reply based on success/failure and return toolCalls: []. Do not repeat them.

CONTEXT UPDATE RULES
- tripDuration only: short | half | full | overnight | 2d1n | 3d2n.
- travelerType only: solo | couple | family | friends.
- pace only: slow | balanced | active.
- interests and constraints replace stored arrays: if changed, return the complete resulting array.
- Leave unchanged fields out.

OUTPUT
Reply language: ${req.language}. Channel: ${channel}.
Return ONLY one JSON object:
{
  "message": string,
  "intent": "conversation" | "create_journey" | "modify_journey" | "explain_journey" | "save_journey" | "journal" | "recommendation" | "information",
  "contextUpdates": { ...changed structured fields only... },
  "journeyAction": { "type": "none" | "create" | "modify" | "replace", "journey": object | null },
  "suggestedActions": [ { "label": string, "action": string } ],
  "responseStyle": "direct" | "story" | "contrast" | "curious" | "reflective" | "planner",
  "agentStateUpdate": { "activeTopic"?: string, "travelContextSummary"?: string, "unresolvedNeed"?: string, "clearUnresolvedNeed"?: boolean, "pendingQuestion"?: { "domain": string, "kind": "preference_choice" | "entity_choice" | "party_size", "choices"?: [{ "value": string, "aliases": string[] }], "slot"?: string }, "clearPendingQuestion"?: boolean },
  "semanticMemoryUpdates": [ { "key": string, "value": string | string[], "confidence": number } ],
  "toolCalls": [ { "name": string, "args": object } ]
}`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeContextUpdates(updates: Record<string, unknown>): Partial<GuestContext> {
  const output: Partial<GuestContext> = {};
  if (typeof updates.tripDuration === 'string' && VALID_TRIP_DURATIONS.includes(updates.tripDuration)) output.tripDuration = updates.tripDuration;
  if (typeof updates.travelerType === 'string' && VALID_TRAVELER_TYPES.includes(updates.travelerType)) output.travelerType = updates.travelerType;
  if (typeof updates.pace === 'string' && VALID_PACES.includes(updates.pace)) output.pace = updates.pace;
  if (updates.group && typeof updates.group === 'object') output.group = updates.group as GuestContext['group'];
  if (typeof updates.budget === 'number' && Number.isFinite(updates.budget)) output.budget = updates.budget;
  if (Array.isArray(updates.interests)) output.interests = updates.interests.filter(isNonEmptyString);
  if (Array.isArray(updates.constraints)) output.constraints = updates.constraints.filter(isNonEmptyString);
  return output;
}

function normalizeAgentState(value: unknown): AgentStateUpdate | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const out: AgentStateUpdate = {};
  if (isNonEmptyString(raw.activeTopic)) out.activeTopic = raw.activeTopic.slice(0, 100);
  if (isNonEmptyString(raw.travelContextSummary)) out.travelContextSummary = raw.travelContextSummary.slice(0, 600);
  if (isNonEmptyString(raw.unresolvedNeed)) out.unresolvedNeed = raw.unresolvedNeed.slice(0, 220);
  if (raw.clearUnresolvedNeed === true) out.clearUnresolvedNeed = true;
  const pendingQuestion = normalizePendingQuestion(raw.pendingQuestion);
  if (pendingQuestion) out.pendingQuestion = pendingQuestion;
  if (raw.clearPendingQuestion === true) out.clearPendingQuestion = true;
  return Object.keys(out).length ? out : undefined;
}

function normalizeSemanticUpdates(value: unknown): SemanticMemoryUpdate[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => item && typeof item === 'object')
    .map(item => item as Record<string, unknown>)
    .filter(item => typeof item.key === 'string' && SAFE_SEMANTIC_KEYS.has(item.key))
    .map(item => ({
      key: String(item.key),
      value: Array.isArray(item.value)
        ? item.value.filter(isNonEmptyString).slice(0, 12)
        : isNonEmptyString(item.value) ? String(item.value).slice(0, 120) : '',
      confidence: Math.max(0.5, Math.min(1, Number(item.confidence) || 0.7)),
    }))
    .filter(item => Array.isArray(item.value) ? item.value.length > 0 : Boolean(item.value))
    .slice(0, 8);
}

function normalizeToolCalls(value: unknown, toolResultsPresent: boolean): BrainToolCall[] {
  if (toolResultsPresent || !Array.isArray(value)) return [];
  const validExperienceIds = new Set(EXPERIENCES.map(item => item.id));
  const calls: BrainToolCall[] = [];
  for (const item of value.slice(0, 4)) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    if (!VALID_TOOLS.includes(raw.name as BrainToolName)) continue;
    const name = raw.name as BrainToolName;
    const args = raw.args && typeof raw.args === 'object' ? raw.args as Record<string, unknown> : {};
    if (['favorite_experience', 'unfavorite_experience', 'mark_visited'].includes(name)) {
      const experienceId = typeof args.experienceId === 'string' ? args.experienceId : '';
      if (!validExperienceIds.has(experienceId)) continue;
      calls.push({ name, args: { experienceId } });
      continue;
    }
    if (name === 'request_handoff') {
      const allowed = new Set(['booking_help', 'accessibility_help', 'complaint', 'other']);
      const reasonCode = allowed.has(String(args.reasonCode)) ? String(args.reasonCode) : 'other';
      calls.push({ name, args: { reasonCode } });
      continue;
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
  const style = VALID_STYLES.includes(raw.responseStyle as ResponseStyle) ? raw.responseStyle as ResponseStyle : 'direct';
  const rawJourney = raw.journeyAction && typeof raw.journeyAction === 'object'
    ? raw.journeyAction as Record<string, unknown>
    : {};
  const actionType = ['none', 'create', 'modify', 'replace'].includes(String(rawJourney.type))
    ? rawJourney.type as BrainResponse['journeyAction']['type']
    : 'none';
  const journey = rawJourney.journey as { days?: Array<{ stops?: Array<{ experienceId?: string }> }> } | null | undefined;
  if (journey?.days) {
    const validIds = new Set(EXPERIENCES.map(item => item.id));
    for (const day of journey.days) {
      for (const stop of day.stops ?? []) {
        if (stop.experienceId && !validIds.has(stop.experienceId)) throw new Error(`Unknown experienceId ${stop.experienceId}`);
      }
    }
  }
  return {
    message: raw.message,
    intent,
    contextUpdates: normalizeContextUpdates(raw.contextUpdates && typeof raw.contextUpdates === 'object' ? raw.contextUpdates as Record<string, unknown> : {}),
    journeyAction: { type: actionType, journey: rawJourney.journey ?? null },
    suggestedActions: Array.isArray(raw.suggestedActions)
      ? raw.suggestedActions.filter(item => item && typeof item === 'object').map(item => item as Record<string, unknown>).filter(item => isNonEmptyString(item.label) && isNonEmptyString(item.action)).map(item => ({ label: String(item.label).slice(0, 80), action: String(item.action).slice(0, 160) })).slice(0, 6)
      : [],
    responseStyle: style,
    agentStateUpdate: normalizeAgentState(raw.agentStateUpdate),
    semanticMemoryUpdates: normalizeSemanticUpdates(raw.semanticMemoryUpdates),
    toolCalls: normalizeToolCalls(raw.toolCalls, runtime.toolResults.length > 0),
  };
}

function stripCodeFences(text: string): string {
  return text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
}

function cleanLineMessage(text: string): string {
  return text.replace(/\*\*(.*?)\*\*/gs, '$1').replace(/__(.*?)__/gs, '$1').replace(/^#{1,6}\s+/gm, '').replace(/^\s*[-*]\s+/gm, '• ').replace(/`([^`]+)`/g, '$1').replace(/\n{3,}/g, '\n\n').trim();
}

function adaptForChannel(response: BrainResponse, req: BrainRequest): BrainResponse {
  if (getBrainChannel(req.pageContext.section) === 'line') response.message = cleanLineMessage(response.message);
  return response;
}

export function availabilityBrainResponse(): BrainResponse {
  return {
    message: 'ตอนนี้ทองไทยคิดช้ากว่าปกตินิดหนึ่งครับ ลองส่งอีกครั้งในอีกสักครู่นะครับ',
    intent: 'conversation',
    contextUpdates: {},
    journeyAction: { type: 'none', journey: null },
    suggestedActions: [],
    responseStyle: 'direct',
    agentStateUpdate: {},
    semanticMemoryUpdates: [],
    toolCalls: [],
  };
}

export async function runThongthaiBrain(
  req: BrainRequest,
  communityOfferings: VerifiedCommunityOffering[],
  messages: ChatTurn[],
  runtime: BrainRuntimeContext,
): Promise<BrainResponse> {
  const systemPrompt = buildBrainPrompt(req, communityOfferings, runtime);
  let raw = await callPreferredModel(systemPrompt, messages);
  try {
    const result = adaptForChannel(validateBrainResponse(JSON.parse(stripCodeFences(raw)), runtime), req);
    console.log('THONGTHAI_BRAIN_DECISION', THONGTHAI_BRAIN_VERSION, getBrainChannel(req.pageContext.section), result.intent, result.journeyAction.type, result.toolCalls?.length ?? 0);
    return result;
  } catch (firstError) {
    raw = await callPreferredModel(systemPrompt, [
      ...messages,
      { role: 'assistant', content: raw },
      { role: 'user', content: `Your previous response was invalid: ${(firstError as Error).message}. Return ONLY a corrected JSON object matching the contract.` },
    ]);
    const result = adaptForChannel(validateBrainResponse(JSON.parse(stripCodeFences(raw)), runtime), req);
    console.log('THONGTHAI_BRAIN_DECISION_REPAIRED', THONGTHAI_BRAIN_VERSION, getBrainChannel(req.pageContext.section), result.intent, result.journeyAction.type, result.toolCalls?.length ?? 0);
    return result;
  }
}
