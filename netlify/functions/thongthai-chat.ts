/**
 * netlify/functions/thongthai-chat.ts
 *
 * Real multi-turn conversational endpoint for ทองไทย.
 *
 * STATUS: complete request/response handling, prompt construction with
 * full conversation history and guest/journey context, structured output
 * validation, AND a real Gemini API call in callLanguageModel() — this is
 * not a stub. What's still missing is a real GEMINI_API_KEY in this
 * deployment's environment variables (none exists here to test with) and
 * an actual network round-trip to Google's servers, which I have no way to
 * perform or verify from this environment. Once a key is set, the code
 * path is real; I just haven't watched it succeed against the live API.
 *
 * Endpoint once deployed: POST /.netlify/functions/thongthai-chat
 */

import type { Handler, HandlerEvent } from '@netlify/functions';
import { EXPERIENCES, annotateForGroup } from '../../src/data/experiences';

// ---------------------------------------------------------------------------
// Request / response contracts — exactly the shapes specified for this
// endpoint, so the frontend fetch() call and this handler agree byte-for-byte.
// ---------------------------------------------------------------------------

export interface ChatTurn { role: 'user' | 'assistant'; content: string; }

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

export interface ChatRequest {
  message: string;
  language: 'th' | 'en' | 'zh' | 'lo' | 'vi';
  chatHistory: ChatTurn[];
  guestContext: GuestContext;
  journeyContext: JourneyContext;
  pageContext: { section: string | null };
}

export type ChatIntent =
  | 'conversation' | 'create_journey' | 'modify_journey' | 'explain_journey'
  | 'save_journey' | 'journal' | 'recommendation' | 'information';

export interface ChatResponse {
  message: string;
  intent: ChatIntent;
  contextUpdates: Partial<GuestContext>;
  journeyAction: { type: 'none' | 'create' | 'modify' | 'replace'; journey: unknown | null };
  suggestedActions: Array<{ label: string; action: string }>;
}

// ---------------------------------------------------------------------------
// Provider abstraction — identical pattern to thongthai-agent.ts, kept
// separate because chat and planning have different prompt shapes, but both
// funnel through the same "never fake a live call" discipline.
// ---------------------------------------------------------------------------

class ProviderNotConfiguredError extends Error {
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

class LLMAvailabilityError extends LLMRequestError {
  constructor(message: string) {
    super(message);
    this.name = 'LLMAvailabilityError';
  }
}

// gemini-2.0-flash (originally used here) was shut down June 1, 2026.
// The primary production list starts with models that have succeeded in
// production. gemini-3.7-flash is intentionally excluded while its 503
// UNAVAILABLE frequency remains high.
const GEMINI_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
] as const;

const OPENAI_MODEL = 'gpt-5.6-luna';

/**
 * Real Gemini API call, using a live GEMINI_API_KEY server-side environment
 * variable. Written to the current Gemini 3.x REST contract — confirmed via
 * search (not from training-data memory, which predates these models) that
 * temperature/top_p/top_k are deprecated and silently ignored on Gemini 3.x
 * Flash models, so they're deliberately omitted below rather than included
 * as a no-op.
 * Structurally correct against the documented contract, but — same caveat
 * as always — never run against the live endpoint, since no real key
 * exists in this environment to test with.
 */
async function callLanguageModel(systemPrompt: string, messages: ChatTurn[]): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ProviderNotConfiguredError();

  // Gemini has no separate "assistant" role — its equivalent is "model".
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  let lastAvailabilityError = '';

  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    let res: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey, // header, not query param — keeps the key out of server access logs
        },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: {
            responseMimeType: 'application/json', // ask Gemini to return strict JSON directly
            thinkingConfig: {
              thinkingLevel: 'low',
            },
            maxOutputTokens: 4096, // a 3-day structured Journey with per-stop reasons can exceed 1024
            // No temperature/top_p/top_k — deprecated and ignored on 3.x Flash
            // models.
          },
        }),
      });
    } catch (networkErr) {
      if ((networkErr as Error).name === 'AbortError') {
        console.error('THONGTHAI_AI_MODEL_TIMEOUT', model);
        lastAvailabilityError = 'Gemini API request timed out.';
        continue;
      }
      throw new LLMRequestError(`Network error calling Gemini: ${(networkErr as Error).message}`);
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');

      if (res.status === 429 || res.status === 503) {
        console.error('THONGTHAI_AI_MODEL_RETRY', model, res.status, errBody);
        lastAvailabilityError = `Gemini API returned ${res.status}: ${errBody.slice(0, 300)}`;
        continue;
      }

      throw new LLMRequestError(`Gemini API returned ${res.status}: ${errBody.slice(0, 300)}`);
    }

    console.log('THONGTHAI_AI_MODEL_SUCCESS', model);

    const data = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
      promptFeedback?: { blockReason?: string };
    };

    if (data.promptFeedback?.blockReason) {
      throw new LLMRequestError(`Gemini blocked the request: ${data.promptFeedback.blockReason}`);
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new LLMRequestError('Gemini returned no text content (check candidates[0].finishReason for why).');
    }

    return text;
  }

  throw new LLMAvailabilityError(lastAvailabilityError || 'Gemini models are unavailable.');
}

async function callOpenAI(systemPrompt: string, messages: ChatTurn[]): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('THONGTHAI_AI_OPENAI_NOT_CONFIGURED');
    throw new LLMAvailabilityError('OpenAI fallback is not configured.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  let res: Response;

  try {
    res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions: systemPrompt,
        input: messages.map(message => ({
          role: message.role,
          content: [{ type: 'input_text', text: message.content }],
        })),
        reasoning: { effort: 'none' },
        max_output_tokens: 4096,
        text: {
          format: {
            type: 'json_schema',
            name: 'thongthai_chat_response',
            strict: false,
            schema: { type: 'object' },
          },
        },
      }),
    });
  } catch (networkErr) {
    if ((networkErr as Error).name === 'AbortError') {
      console.error('THONGTHAI_AI_OPENAI_TIMEOUT', OPENAI_MODEL);
      throw new LLMAvailabilityError('OpenAI API request timed out.');
    }
    throw new LLMRequestError(`Network error calling OpenAI: ${(networkErr as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    const safeErrorBody = errBody.slice(0, 300);

    if ([429, 500, 502, 503, 504].includes(res.status)) {
      console.error('THONGTHAI_AI_OPENAI_ERROR', res.status, safeErrorBody);
      throw new LLMAvailabilityError(`OpenAI API returned ${res.status}: ${safeErrorBody}`);
    }

    console.error('THONGTHAI_AI_OPENAI_ERROR', res.status, safeErrorBody);
    throw new LLMRequestError(`OpenAI API returned ${res.status}: ${safeErrorBody}`);
  }

  const data = await res.json() as {
    output_text?: string;
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  };
  let text = data.output_text ?? '';
  if (!text) {
    for (const item of data.output ?? []) {
      for (const content of item.content ?? []) {
        if (content.type === 'output_text' && content.text) text += content.text;
      }
    }
  }

  if (!text) {
    throw new LLMRequestError('OpenAI returned no text content.');
  }

  console.log('THONGTHAI_AI_OPENAI_SUCCESS', OPENAI_MODEL);
  return text;
}

async function callPreferredLanguageModel(systemPrompt: string, messages: ChatTurn[]): Promise<string> {
  try {
    return await callLanguageModel(systemPrompt, messages);
  } catch (err) {
    if (!(err instanceof LLMAvailabilityError)) throw err;

    console.log('THONGTHAI_AI_PROVIDER_FALLBACK', 'gemini', 'openai');
    return callOpenAI(systemPrompt, messages);
  }
}

// ---------------------------------------------------------------------------
// System prompt — identity, principles, and the live guest/journey state,
// rebuilt fresh on every request so the model always sees current context
// rather than relying on its own memory of the conversation.
// ---------------------------------------------------------------------------

function buildSystemPrompt(req: ChatRequest): string {
  const hasElderly = (req.guestContext.group.elderly ?? 0) > 0
    || req.guestContext.constraints.some(c => /elderly|mobility|walk/i.test(c));
  const hasChildren = (req.guestContext.group.children ?? 0) > 0;
  const catalog = annotateForGroup(hasElderly, hasChildren);

  return `You are ทองไทย (Thongthai) — AI Local Host, Personalized Journey Planner, and
Isan Experience Concierge for "ทำมา-ชาติ — Experiences of Isan". You are not a
generic support chatbot; you are a warm, intelligent, concise local host.

VERIFIED BUSINESS FACTS
- Brand: ทำมา-ชาติ — Experiences of Isan
- Positioning: Isan Wellness Community
- Official Google Maps location: https://maps.app.goo.gl/67eqn5vGvqJjfxZCA?g_st=ic
- Experience ecosystem: Inthanin Café is the Welcome Partner and first physical stop; ตำมา-ชาติ is Dining; ทำมา-ชาติ เฮือนสเตย์ is Stay; and ทำมา-ชาติ ผจญภัย is Outdoor / nature / adventure.
- The Google Maps link above is verified. Do NOT infer or invent a street address, coordinates, opening hours, distance, travel time, phone number, price, or availability unless it exists in verified data supplied here.
- If the guest asks only "อยู่ที่ไหน", "ขอโลเคชั่น", "พิกัด", "map", "location", or "เดินทางไปยังไง", answer the factual location question directly with the official Google Maps link. Do not create or modify a Journey for a location request.

CURRENT MESSAGE INTENT PRECEDENCE — highest priority, before all Journey reasoning:
1. Explicit request in the CURRENT user message.
2. Direct factual question in the CURRENT message.
3. New guest information revealed in the CURRENT message.
4. Conversation history.
5. Existing Journey context.
6. Page context.
Lower-priority context must NEVER override a clear current request. The existence of a current Journey does NOT mean every following message is a Journey modification.

DIRECT FACTUAL QUESTIONS
- Direct factual questions include where the place is, location/map/coordinates, what is available, what the place is, what food is available, whether there is accommodation, what activities are available, and questions about known verified business facts.
- For a direct factual question, intent MUST be "information"; journeyAction MUST be { "type": "none", "journey": null }; and answer only the requested information.
- Do NOT create, replace, modify, or repeat the current Journey unless the guest explicitly asks for planning. For a location-only request, return the official Google Maps link above.

PROFILE UPDATE IS NOT A JOURNEY MODIFICATION
- When the guest reveals trip information without asking to adjust a plan, update context only and keep journeyAction as { "type": "none", "journey": null }.
- "มากับเพื่อน" updates travelerType to "friends"; "มากับแฟน" updates it to "couple"; "มากับครอบครัว" updates it to "family"; and "มีเด็ก 2 คน" updates the group. Acknowledge naturally, but do NOT rebuild or display a Journey unless the guest explicitly asks to adjust it.
- Modify an existing Journey only when the CURRENT message clearly asks for a planning change, such as "ปรับแผนให้เหมาะกับเพื่อนหน่อย", "วันที่สองเอาเบาลง", "ไม่เอา Adventure", "เพิ่มร้านอาหารให้หน่อย", "เปลี่ยนแผน", or "จัดใหม่สำหรับครอบครัว".
- Messages such as "มากับเพื่อน", "ง่วง", "อยู่ที่ไหน", "อยากมีแฟน", "หิว", "ฝนตก", and "ขอโลเคชั่น" are NOT Journey modifications by themselves.
- Even when a Journey exists, unrelated casual messages such as "อยากมีแฟนจัง", "เหงา", "เบื่อ", "ง่วง", and "คุยเล่นหน่อย" are normal conversation. Do not turn them into a package, couple Journey, Stay recommendation, or Journey modification.
- Never return a Journey object merely to remind the guest about an existing Journey. When no Journey change was requested, journeyAction.type MUST be "none" and journeyAction.journey MUST be null; the existing Journey is already stored in journeyContext.

RESPONSE DISCIPLINE — silently check before returning JSON:
A. What exactly did the latest user message ask?
B. Is it a factual question, casual message, profile update, recommendation, new Journey request, or explicit Journey modification?
C. Am I creating a Journey only because one already exists? If yes, stop and use journeyAction none.
D. Am I answering information I do not actually have? If yes, say it is not verified instead of inventing it.
E. Is there a simpler direct answer? Prefer the direct answer.
Do not expose this internal check or hard-code replies from examples.

CONVERSATION MODE / INTENT ROUTING — follow this before offering any recommendation:
- You are an intelligent local host who can have natural conversation. You are NOT a sales bot.
- First identify whether the guest is making casual conversation or has a Journey / experience intent.
- For ordinary casual conversation, respond naturally to what the guest actually said and their feeling or situation. Be a good conversational companion without redirecting the topic.
- Do NOT automatically mention ทำมา-ชาติ, เฮือนสเตย์, Dining, Adventure, Inthanin, packages, booking, or Journey planning unless they are genuinely relevant to the guest message.
- You may mention a ทำมา-ชาติ experience only when the guest explicitly asks about the property, experiences, food, stay, activities, trip planning, itinerary, packages, or what to do there; or when a recommendation is clearly useful and contextually relevant. Never recommend something just to promote it.
- Relevance comes before promotion. If a recommendation would feel like an ad instead of a natural response, do not make the recommendation.
- Treat messages such as "ง่วง", "เบื่อ", "อยากมีแฟน", "วันนี้เหนื่อย", "คุยเป็นเพื่อนหน่อย", "อากาศดีจัง", and "คิดถึงแฟน" as CASUAL intent. Respond to the topic naturally; do not start Journey planning.
- Treat messages such as "ช่วยจัดทริป 3 วัน 2 คืน", "พาครอบครัวมาเที่ยว", "วันนี้มีเวลา 4 ชั่วโมงทำอะไรดี", "อยากกินอะไรที่นี่", "มีที่พักไหม", "มีกิจกรรมอะไรให้เด็กทำ", and "ช่วยปรับวันที่สองให้เบาลง" as JOURNEY / EXPERIENCE intent. Use recommendation, create_journey, or modify_journey only when appropriate.
- For short or ambiguous messages, do not assume commercial intent. For example, "หิว" can be a normal conversation about what food they feel like eating; "ง่วง" does not mean they want Stay; and "อยากพัก" does not mean they want to book accommodation.
- Follow the active conversation context. If it is already clearly about planning a trip, short messages such as "ง่วง", "อยากพัก", or "เอาเบาๆ" may be interpreted in relation to that Journey. If there is no active travel-planning context, treat them as normal conversation.
- For casual conversation, intent must normally be "conversation"; journeyAction must be { "type": "none", "journey": null }; suggestedActions should normally be []; do not create or modify a Journey; and do not update guestContext unless the guest actually reveals travel-relevant information worth remembering.
- Be warm, intelligent, concise, natural Thai, and polite without being stiff. Casual replies are generally one to three short sentences; one natural follow-up question is allowed only when useful. Do not sound like customer-service copy, an advertisement, or an over-explanation.
- Never claim emotions, personal experiences, relationships, or a human life of your own. You can be warm and conversational without pretending to be human.
Principles, in priority order:
1. Guest needs come before maximizing sales. Relevance comes before promotion.
2. Personalize using the guest context and conversation history below.
3. Avoid overpacking any day of the itinerary.
4. Respect children, elderly, mobility, and pace constraints absolutely: never
   assign a high-intensity activity (marked "flaggedFor" in the catalog below)
   to the specific traveler(s) it's unsuitable for. But do NOT remove that
   activity for the whole group — for a mixed group, reason about splitting
   it: e.g. children do Adventure while an elderly member has a parallel
   lower-intensity option (a slow walk, a café, resting at Stay) at the same
   time. Only exclude an activity entirely if every present traveler is
   affected by its flag.
5. Preserve an authentic Isan experience.
6. Briefly explain a recommendation when the guest asks why, in one or two
   plain sentences — never expose scoring numbers or internal reasoning steps.
7. Remember everything in guestContext and journeyContext below — do not
   ask the guest to repeat information already captured there.
8. When the guest describes a change ("วันที่สองขอตื่นสาย", "ไม่เอา Adventure"),
   treat it as modify_journey against journeyContext.currentPlan, not a new plan.
9. NEVER invent live facts: prices, hours, availability, weather. If asked
   and you don't have verified data, say so plainly.
10. Choose experiences ONLY from the catalog below — never invent a business.

Respond in language: ${req.language}. If the guest writes in a different
language, understand it, but keep replying in ${req.language} unless they
clearly switch.

Current guest context (update via contextUpdates when the guest reveals new
information; leave a field's update out entirely if unchanged):
${JSON.stringify(req.guestContext)}

Current Journey context:
${JSON.stringify(req.journeyContext)}

Guest is currently viewing page section: ${req.pageContext.section ?? 'unknown'}

Available experience catalog (entries carry a "flaggedFor" note where an
activity is unsuitable for a specific traveler in this guest's group — see
principle 4 above for how to handle that; nothing has been removed):
${JSON.stringify(catalog)}

contextUpdates field rules — read carefully, this differs by field type:
- tripDuration: use ONLY one of these exact strings: "short" (2-3 hours),
  "half" (half day), "full" (1 day), "overnight", "2d1n" (2 days 1 night),
  "3d2n" (3 days 2 nights). Never a free-text description like "3 days 2 nights".
- travelerType: use ONLY one of: "solo", "couple", "family", "friends".
- pace: use ONLY one of: "slow", "balanced", "active".
- group, budget: object/number reflecting only what's known.
- interests, constraints: these REPLACE the stored array — always return the
  COMPLETE resulting list, not just what changed this turn. If the guest has
  ["food","nature"] and adds "adventure", return ["food","nature","adventure"].
  If they later say "ไม่เอา adventure แล้ว" (remove/no longer want adventure),
  return ["food","nature"] — the item actually removed, not kept forever.

Respond with ONLY a single JSON object matching this shape, no prose outside it:
{
  "message": string,
  "intent": "conversation" | "create_journey" | "modify_journey" | "explain_journey" | "save_journey" | "journal" | "recommendation" | "information",
  "contextUpdates": { ...only the guestContext fields that changed this turn, following the field rules above... },
  "journeyAction": { "type": "none" | "create" | "modify" | "replace", "journey": object | null },
  "suggestedActions": [ { "label": string, "action": string } ]
}`;
}

// ---------------------------------------------------------------------------
// Response validation — same discipline as the planning agent: never trust
// model JSON blindly, never let it reference an experience outside the catalog.
// ---------------------------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

const VALID_TRIP_DURATIONS = ['short', 'half', 'full', 'overnight', '2d1n', '3d2n'];
const VALID_TRAVELER_TYPES = ['solo', 'couple', 'family', 'friends'];
const VALID_PACES = ['slow', 'balanced', 'active'];

// Server-side normalization net for item 5 — the prompt instructs Gemini to
// use canonical values, but a model can still drift (e.g. "3 days 2 nights"
// instead of "3d2n"). Rather than trust the prompt alone, drop anything
// that isn't one of the exact allowed values so a malformed value can never
// silently corrupt persisted guestContext on the frontend.
function normalizeContextUpdates(updates: Record<string, unknown>): Partial<GuestContext> {
  const out: Partial<GuestContext> = {};
  if (typeof updates.tripDuration === 'string' && VALID_TRIP_DURATIONS.includes(updates.tripDuration)) {
    out.tripDuration = updates.tripDuration as GuestContext['tripDuration'];
  }
  if (typeof updates.travelerType === 'string' && VALID_TRAVELER_TYPES.includes(updates.travelerType)) {
    out.travelerType = updates.travelerType as GuestContext['travelerType'];
  }
  if (typeof updates.pace === 'string' && VALID_PACES.includes(updates.pace)) {
    out.pace = updates.pace as GuestContext['pace'];
  }
  if (updates.group && typeof updates.group === 'object') out.group = updates.group as GuestContext['group'];
  if (typeof updates.budget === 'number') out.budget = updates.budget;
  if (Array.isArray(updates.interests)) out.interests = updates.interests.filter(isNonEmptyString);
  if (Array.isArray(updates.constraints)) out.constraints = updates.constraints.filter(isNonEmptyString);
  return out;
}

const VALID_INTENTS: ChatIntent[] = [
  'conversation', 'create_journey', 'modify_journey', 'explain_journey',
  'save_journey', 'journal', 'recommendation', 'information',
];

function validateChatResponse(data: unknown): ChatResponse {
  if (typeof data !== 'object' || data === null) throw new Error('Response is not an object');
  const d = data as Record<string, unknown>;
  if (!isNonEmptyString(d.message)) throw new Error('Missing message');
  const intent = VALID_INTENTS.includes(d.intent as ChatIntent) ? (d.intent as ChatIntent) : 'conversation';

  const journeyActionRaw = (d.journeyAction as Record<string, unknown>) ?? {};
  const actionType = ['none', 'create', 'modify', 'replace'].includes(journeyActionRaw.type as string)
    ? (journeyActionRaw.type as 'none' | 'create' | 'modify' | 'replace')
    : 'none';

  // If the model proposes journey stops, every referenced experience must
  // exist in the real catalog — reject (don't silently pass through) anything else.
  const validIds = new Set(EXPERIENCES.map(e => e.id));
  const journey = journeyActionRaw.journey as { days?: Array<{ stops?: Array<{ experienceId?: string }> }> } | null;
  if (journey?.days) {
    for (const day of journey.days) {
      for (const stop of day.stops ?? []) {
        if (stop.experienceId && !validIds.has(stop.experienceId)) {
          throw new Error(`journeyAction references unknown experienceId "${stop.experienceId}"`);
        }
      }
    }
  }

  return {
    message: d.message as string,
    intent,
    contextUpdates: normalizeContextUpdates((d.contextUpdates as Record<string, unknown>) ?? {}),
    journeyAction: { type: actionType, journey: journeyActionRaw.journey ?? null },
    suggestedActions: Array.isArray(d.suggestedActions) ? d.suggestedActions as ChatResponse['suggestedActions'] : [],
  };
}

function stripCodeFences(text: string): string {
  return text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

function isValidRequest(body: unknown): body is ChatRequest {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  return isNonEmptyString(b.message) && isNonEmptyString(b.language) && Array.isArray(b.chatHistory);
}

function availabilityChatResponse(): ChatResponse {
  return {
    message: 'ตอนนี้ระบบ AI ตอบช้ากว่าปกติครับ ลองส่งอีกครั้งในอีกสักครู่นะครับ',
    intent: 'conversation',
    contextUpdates: {},
    journeyAction: { type: 'none', journey: null },
    suggestedActions: [],
  };
}

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body: unknown;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Malformed JSON body' }) };
  }

  if (!isValidRequest(body)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields: message, language, chatHistory' }) };
  }
  const req = body as ChatRequest;

  const systemPrompt = buildSystemPrompt(req);
  // Defensive dedup: even though the frontend now sends chatHistory BEFORE
  // pushing the current turn, don't trust that blindly from every possible
  // caller — if the last history entry already IS this exact user message,
  // don't append it again. The model must see each user turn exactly once.
  const history = req.chatHistory.slice(-12);
  const lastEntry = history[history.length - 1];
  const alreadyIncluded = lastEntry && lastEntry.role === 'user' && lastEntry.content === req.message;
  const messages: ChatTurn[] = alreadyIncluded ? history : [...history, { role: 'user', content: req.message }];

  let raw: string;
  try {
    raw = await callPreferredLanguageModel(systemPrompt, messages);
  } catch (err) {
      console.error('THONGTHAI_AI_ERROR', err);
    if (err instanceof ProviderNotConfiguredError) {
      return {
        statusCode: 503,
        body: JSON.stringify({
          error: 'AI provider not configured',
          message: 'This deployment has no LLM API key set. See callLanguageModel() in thongthai-chat.ts. The frontend should fall back to the local ConciergeProvider on this response.',
        }),
      };
    }
    if (err instanceof LLMAvailabilityError) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(availabilityChatResponse()),
      };
    }
    return { statusCode: 502, body: JSON.stringify({ error: 'Chat request failed. Please try again.' }) };
  }

  try {
    const parsed = validateChatResponse(JSON.parse(stripCodeFences(raw)));
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) };
  } catch (firstError) {
    // one repair retry, same discipline as the planning agent
    try {
      const repairMessages: ChatTurn[] = [
        ...messages,
        { role: 'assistant', content: raw },
        { role: 'user', content: `Your previous response was invalid: ${(firstError as Error).message}. Return ONLY a corrected JSON object matching the required schema.` },
      ];
      const repaired = await callPreferredLanguageModel(systemPrompt, repairMessages);
      const parsed = validateChatResponse(JSON.parse(stripCodeFences(repaired)));
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) };
    } catch (repairError) {
      if (repairError instanceof LLMAvailabilityError) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(availabilityChatResponse()),
        };
      }
      return { statusCode: 502, body: JSON.stringify({ error: 'Chat response could not be validated. Please try again.' }) };
    }
  }
};
