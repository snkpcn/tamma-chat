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

// Verified current via search: gemini-2.0-flash (originally used here) was
// shut down June 1, 2026. gemini-3.7-flash, used here, is Google's newest
// GA Flash model as of their current docs (confirmed against three
// independent sources: ai.google.dev, Firebase AI Logic docs, and Google's
// own developer blog). Its predecessor, gemini-3.6-flash, is also still
// valid/GA if you'd rather stay one version back.
const GEMINI_MODEL = 'gemini-3.7-flash';

/**
 * Real Gemini API call, using a live GEMINI_API_KEY server-side environment
 * variable. Written to the current Gemini 3.x REST contract — confirmed via
 * search (not from training-data memory, which predates these models) that
 * temperature/top_p/top_k are deprecated and silently ignored on gemini-3.7
 * -flash, gemini-3.6-flash, and gemini-3.5-flash-lite, so they're
 * deliberately omitted below rather than included as a no-op.
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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey, // header, not query param — keeps the key out of server access logs
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          responseMimeType: 'application/json', // ask Gemini to return strict JSON directly
          maxOutputTokens: 4096, // a 3-day structured Journey with per-stop reasons can exceed 1024
          // No temperature/top_p/top_k — deprecated and ignored on 3.x Flash
          // models. No explicit thinkingLevel — left at the model default
          // rather than tuned without a clear need.
        },
      }),
    });
  } catch (networkErr) {
    throw new LLMRequestError(`Network error calling Gemini: ${(networkErr as Error).message}`);
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new LLMRequestError(`Gemini API returned ${res.status}: ${errBody.slice(0, 300)}`);
  }

  const data = await res.json() as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
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

Principles, in priority order:
1. Guest needs come before maximizing sales.
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
    raw = await callLanguageModel(systemPrompt, messages);
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
      const repaired = await callLanguageModel(systemPrompt, repairMessages);
      const parsed = validateChatResponse(JSON.parse(stripCodeFences(repaired)));
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) };
    } catch {
      return { statusCode: 502, body: JSON.stringify({ error: 'Chat response could not be validated. Please try again.' }) };
    }
  }
};
