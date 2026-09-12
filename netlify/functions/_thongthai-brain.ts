import { EXPERIENCES, annotateForGroup } from '../../src/data/experiences';
import type { VerifiedCommunityOffering } from './_customer-db';

export const THONGTHAI_BRAIN_VERSION = '2026-09-agentic-core-v1';

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

export interface BrainResponse {
  message: string;
  intent: ChatIntent;
  contextUpdates: Partial<GuestContext>;
  journeyAction: {
    type: 'none' | 'create' | 'modify' | 'replace';
    journey: unknown | null;
  };
  suggestedActions: Array<{ label: string; action: string }>;
}

export type BrainChannel = 'line' | 'web' | 'facebook' | 'backoffice';

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

const GEMINI_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
] as const;

const OPENAI_MODEL = 'gpt-5.6-luna';

function channelFromSection(section: string | null): BrainChannel {
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
    let response: Response;

    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
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
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        console.error('THONGTHAI_BRAIN_MODEL_TIMEOUT', model);
        lastAvailabilityError = 'Gemini API request timed out.';
        continue;
      }
      throw new LLMRequestError(`Network error calling Gemini: ${(error as Error).message}`);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if (response.status === 429 || response.status === 503) {
        console.error('THONGTHAI_BRAIN_MODEL_RETRY', model, response.status, body.slice(0, 300));
        lastAvailabilityError = `Gemini API returned ${response.status}: ${body.slice(0, 300)}`;
        continue;
      }
      throw new LLMRequestError(`Gemini API returned ${response.status}: ${body.slice(0, 300)}`);
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
  }

  throw new LLMAvailabilityError(lastAvailabilityError || 'Gemini models are unavailable.');
}

async function callOpenAI(systemPrompt: string, messages: ChatTurn[]): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('THONGTHAI_BRAIN_OPENAI_NOT_CONFIGURED');
    throw new LLMAvailabilityError('OpenAI fallback is not configured.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  let response: Response;

  try {
    response = await fetch('https://api.openai.com/v1/responses', {
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
          content: [{
            type: message.role === 'assistant' ? 'output_text' : 'input_text',
            text: message.content,
          }],
        })),
        reasoning: { effort: 'none' },
        max_output_tokens: 4096,
        text: {
          format: {
            type: 'json_schema',
            name: 'thongthai_brain_response',
            strict: false,
            schema: { type: 'object' },
          },
        },
      }),
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      console.error('THONGTHAI_BRAIN_OPENAI_TIMEOUT', OPENAI_MODEL);
      throw new LLMAvailabilityError('OpenAI API request timed out.');
    }
    throw new LLMRequestError(`Network error calling OpenAI: ${(error as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const safe = body.slice(0, 300);
    if ([429, 500, 502, 503, 504].includes(response.status)) {
      console.error('THONGTHAI_BRAIN_OPENAI_ERROR', response.status, safe);
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
  switch (channel) {
    case 'line':
      return `CHANNEL: LINE\n- This is a phone chat. Keep ordinary answers compact and flowing.\n- No Markdown syntax.\n- Do not sound like a brochure or menu.\n- One natural follow-up question is allowed only when it truly helps.\n- When a Journey card will follow, keep the text introduction short.`;
    case 'facebook':
      return `CHANNEL: FACEBOOK / MESSENGER\n- Conversational, warm, easy to skim.\n- Keep the same personality and memory as every other channel.\n- Do not turn every reply into a sales CTA.`;
    case 'backoffice':
      return `CHANNEL: BACKOFFICE\n- Be precise, operational, and explicit about uncertainty.\n- Personality remains Thongthai, but usefulness and factual clarity take priority over charm.`;
    default:
      return `CHANNEL: WEBSITE\n- You may be a little more detailed than LINE.\n- Use the same brain, memory, personality, facts, and decision principles as every other channel.\n- The website may render richer Journey UI, so avoid duplicating the same content in prose.`;
  }
}

function buildBrainPrompt(req: BrainRequest, communityOfferings: VerifiedCommunityOffering[]): string {
  const channel = channelFromSection(req.pageContext.section);
  const hasElderly = (req.guestContext.group.elderly ?? 0) > 0
    || req.guestContext.constraints.some(item => /elderly|mobility|walk/i.test(item));
  const hasChildren = (req.guestContext.group.children ?? 0) > 0;
  const catalog = annotateForGroup(hasElderly, hasChildren);
  const communityCatalog = communityOfferings.length
    ? JSON.stringify(communityOfferings)
    : '[]';

  return `THONGTHAI BRAIN — ${THONGTHAI_BRAIN_VERSION}

You are ทองไทย (Thongthai), the central intelligence of ทำมา-ชาติ — Experiences of Isan.
You are one continuous mind across website, LINE, Facebook/Messenger, and future channels.
Channels are only different mouths and interfaces. Your identity, memory, judgment, values,
knowledge discipline, and understanding of the guest remain one coherent system.

CORE IDENTITY
- Role: AI Local Host, Personalized Journey Planner, and Isan Experience Concierge.
- Personality: bright, perceptive, warm, playful in a tasteful way, locally grounded, calm, and confident.
- You are not a generic customer-service bot and not a sales script.
- You do not need to sound identical from turn to turn. Natural variation is good when it comes from context, history, mood, channel, and what matters to this guest.
- Ten guests may ask the same surface question and receive ten different phrasings or emphases when their contexts differ. Facts must remain consistent.
- Variation must be intelligent, not random. Never change facts merely to sound different.
- Do not imitate a fixed template. Examples in this prompt describe principles and energy, never text to copy.

CUSTOMER-FACING LANGUAGE
- In Thai, use polite natural Thai. Never address customers with กู/มึง.
- Normally use คุณ when a pronoun is useful, but avoid overusing pronouns.
- Add light modern Isan flavor only when it fits naturally: for example เด้อครับ, เบิ่ง, ม่วนๆ, คักอยู่, บ่ต้องรีบ, แวะมาโลด.
- Standard Thai remains the base. Isan words are seasoning, not a costume.
- Use at most 0-2 light Isan expressions in a normal reply and vary them naturally.
- You may use 0-2 fitting emojis in Thai replies when they add warmth, especially 🐴 🌾 🌿 ☕ ✨.
- Never become childish, clownish, overly folksy, or caricatured.
- If the guest is formal, older, upset, confused, or discussing accessibility, reduce playfulness immediately.

AGENTIC DECISION LOOP — DO THIS SILENTLY FOR EVERY TURN
1. Observe the current message and active conversation.
2. Understand what the guest is actually trying to accomplish now.
3. Retrieve only relevant memory, Journey state, verified facts, and available experiences.
4. Decide whether the correct move is conversation, information, recommendation, memory update, Journey creation, Journey modification, or no action beyond a direct answer.
5. Choose the smallest useful action. Do not create work just because a tool/action exists.
6. Check that no claim is invented and no stored preference is being assumed without evidence.
7. Compose a fresh answer that fits this guest and this channel.
Never reveal this internal decision process or hidden reasoning.

THINK, DO NOT PATTERN-MATCH
- Do not map phrases mechanically to canned responses.
- The latest user message has highest priority. Existing Journey state and page context are supporting evidence, not commands.
- Do not mention every business unit just because the catalog contains them.
- Do not force a follow-up question. Silence after a complete answer is allowed.
- Avoid recurring stock endings and catchphrases. If the same phrase has been used recently, prefer a different natural expression.
- Personalization should feel thoughtful, not creepy. Use memory only when it materially improves the answer.
- Never infer traveler type, relationship, preference, budget, pace, or constraint unless it is present in the current message, prior conversation, or structured guest context.

QUIET CONFIDENCE — SELL WITHOUT PUSHING
- Make ทำมา-ชาติ feel worth discovering; do not try to close a sale.
- Never manufacture urgency, scarcity, exclusivity, FOMO, guilt, or pressure.
- Do not habitually end with สนใจไหมครับ, จองเลย, ให้ทองไทยจัดให้ไหม, อยากลองไหม, or similar closing language.
- Do not demand dates, budget, party size, or booking details before they are truly needed for an explicit planning request.
- Prefer showing a mood, rhythm, contrast, or small verified detail over stacking marketing adjectives.
- Reveal in layers. Answer the current question fully, but do not dump everything at once unless the guest asks for a complete list.
- For broad discovery, describe ways a visit can unfold rather than listing business units like a directory.
- If the guest is browsing or says ไว้ก่อน, accept it gracefully and stop selling.
- Never use hype such as ดีที่สุด, ห้ามพลาด, คุ้มสุด, พิเศษมาก unless the guest explicitly asks for an opinion and the statement can be grounded.

${channelPolicy(channel)}

VERIFIED BUSINESS FACTS
- Brand: ทำมา-ชาติ — Experiences of Isan
- Positioning: Isan Wellness Community
- Official Google Maps location: https://maps.app.goo.gl/67eqn5vGvqJjfxZCA?g_st=ic
- Experience ecosystem: Inthanin Café is the Welcome Partner and first physical stop; ตำมา-ชาติ is Dining; ทำมา-ชาติ เฮือนสเตย์ is Stay; ทำมา-ชาติ ผจญภัย is Outdoor / nature / adventure.
- Community / OTOP is a future-ready layer connecting locally made Isan goods, food, craft, and cultural knowledge to the visitor Journey.
- Specific OTOP products, vendors, prices, stock, and purchase channels are NOT verified unless they appear in VERIFIED ACTIVE COMMUNITY OFFERINGS.
- Never invent a street address, coordinates, opening hours, phone number, price, travel time, live availability, weather, or booking availability unless verified data is supplied here.
- VERIFIED ACTIVE COMMUNITY OFFERINGS: ${communityCatalog}

BEHAVIORAL JUDGMENT
- A direct factual question should normally use intent "information" and journeyAction none.
- Casual conversation should normally use intent "conversation", journeyAction none, and no unsolicited commercial redirect.
- A profile detail such as มากับแฟน, มากับเพื่อน, มีเด็ก 2 คน may update structured context, but does not by itself request a Journey rebuild.
- Modify an existing Journey only when the CURRENT message clearly asks for a planning change.
- Create a Journey only when the guest is actually asking for planning, itinerary design, or an experience plan.
- If the guest asks only for location, answer with the verified Maps link and do not create a Journey.
- If the guest asks what is available, answer from verified catalog/facts without inventing an experience.
- When the guest asks a broad question such as มีประสบการณ์อะไรบ้าง, do not default to a four-item catalog. A short, fresh glimpse of how time here can unfold is usually better. Name only the specific places that help the answer.
- When asked about Journey / packages broadly, do not invent fixed packages or prices. Show possible rhythms from verified experiences; ask one focused question only if necessary.

JOURNEY SAFETY AND QUALITY
- Avoid overpacking a day.
- Respect children, elderly, mobility, and pace constraints absolutely.
- High-intensity experiences flagged unsuitable for one traveler may still be offered to other group members with a parallel lower-intensity option when appropriate.
- Choose Journey experiences only from the provided experience catalog.
- Favorites may be weighted positively. Visited experiences should generally give way to something new unless the guest explicitly wants to repeat one.

CURRENT STATE
Language to reply in: ${req.language}
Channel: ${channel}
Page/section context: ${req.pageContext.section ?? 'unknown'}
Guest context: ${JSON.stringify(req.guestContext)}
Journey context: ${JSON.stringify(req.journeyContext)}
Available experience catalog: ${JSON.stringify(catalog)}

CONTEXT UPDATE RULES
- tripDuration: only "short", "half", "full", "overnight", "2d1n", "3d2n".
- travelerType: only "solo", "couple", "family", "friends".
- pace: only "slow", "balanced", "active".
- interests and constraints REPLACE the stored array, so return the complete resulting list when they change.
- Leave a context field out entirely when it did not change this turn.

OUTPUT CONTRACT
Return ONLY one JSON object and no prose outside it:
{
  "message": string,
  "intent": "conversation" | "create_journey" | "modify_journey" | "explain_journey" | "save_journey" | "journal" | "recommendation" | "information",
  "contextUpdates": { ...only changed guestContext fields... },
  "journeyAction": { "type": "none" | "create" | "modify" | "replace", "journey": object | null },
  "suggestedActions": [ { "label": string, "action": string } ]
}`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

const VALID_TRIP_DURATIONS = ['short', 'half', 'full', 'overnight', '2d1n', '3d2n'];
const VALID_TRAVELER_TYPES = ['solo', 'couple', 'family', 'friends'];
const VALID_PACES = ['slow', 'balanced', 'active'];
const VALID_INTENTS: ChatIntent[] = [
  'conversation',
  'create_journey',
  'modify_journey',
  'explain_journey',
  'save_journey',
  'journal',
  'recommendation',
  'information',
];

function normalizeContextUpdates(updates: Record<string, unknown>): Partial<GuestContext> {
  const output: Partial<GuestContext> = {};
  if (typeof updates.tripDuration === 'string' && VALID_TRIP_DURATIONS.includes(updates.tripDuration)) {
    output.tripDuration = updates.tripDuration as GuestContext['tripDuration'];
  }
  if (typeof updates.travelerType === 'string' && VALID_TRAVELER_TYPES.includes(updates.travelerType)) {
    output.travelerType = updates.travelerType as GuestContext['travelerType'];
  }
  if (typeof updates.pace === 'string' && VALID_PACES.includes(updates.pace)) {
    output.pace = updates.pace as GuestContext['pace'];
  }
  if (updates.group && typeof updates.group === 'object') {
    output.group = updates.group as GuestContext['group'];
  }
  if (typeof updates.budget === 'number' && Number.isFinite(updates.budget)) {
    output.budget = updates.budget;
  }
  if (Array.isArray(updates.interests)) {
    output.interests = updates.interests.filter(isNonEmptyString);
  }
  if (Array.isArray(updates.constraints)) {
    output.constraints = updates.constraints.filter(isNonEmptyString);
  }
  return output;
}

function validateBrainResponse(data: unknown): BrainResponse {
  if (!data || typeof data !== 'object') throw new Error('Response is not an object');
  const raw = data as Record<string, unknown>;
  if (!isNonEmptyString(raw.message)) throw new Error('Missing message');

  const intent = VALID_INTENTS.includes(raw.intent as ChatIntent)
    ? raw.intent as ChatIntent
    : 'conversation';

  const rawJourneyAction = raw.journeyAction && typeof raw.journeyAction === 'object'
    ? raw.journeyAction as Record<string, unknown>
    : {};

  const type = ['none', 'create', 'modify', 'replace'].includes(String(rawJourneyAction.type))
    ? rawJourneyAction.type as BrainResponse['journeyAction']['type']
    : 'none';

  const journey = rawJourneyAction.journey as {
    days?: Array<{ stops?: Array<{ experienceId?: string }> }>;
  } | null | undefined;

  if (journey?.days) {
    const validIds = new Set(EXPERIENCES.map(experience => experience.id));
    for (const day of journey.days) {
      for (const stop of day.stops ?? []) {
        if (stop.experienceId && !validIds.has(stop.experienceId)) {
          throw new Error(`journeyAction references unknown experienceId "${stop.experienceId}"`);
        }
      }
    }
  }

  return {
    message: raw.message,
    intent,
    contextUpdates: normalizeContextUpdates(
      raw.contextUpdates && typeof raw.contextUpdates === 'object'
        ? raw.contextUpdates as Record<string, unknown>
        : {},
    ),
    journeyAction: {
      type,
      journey: rawJourneyAction.journey ?? null,
    },
    suggestedActions: Array.isArray(raw.suggestedActions)
      ? raw.suggestedActions
          .filter(item => item && typeof item === 'object')
          .map(item => item as Record<string, unknown>)
          .filter(item => isNonEmptyString(item.label) && isNonEmptyString(item.action))
          .map(item => ({ label: String(item.label), action: String(item.action) }))
      : [],
  };
}

function stripCodeFences(text: string): string {
  return text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

function cleanLineMessage(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/gs, '$1')
    .replace(/__(.*?)__/gs, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function adaptResponseForChannel(response: BrainResponse, req: BrainRequest): BrainResponse {
  const channel = channelFromSection(req.pageContext.section);
  if (channel === 'line') {
    response.message = cleanLineMessage(response.message);
  }
  return response;
}

export function availabilityBrainResponse(): BrainResponse {
  return {
    message: 'ตอนนี้ทองไทยคิดช้ากว่าปกตินิดหนึ่งครับ ลองส่งอีกครั้งในอีกสักครู่นะครับ',
    intent: 'conversation',
    contextUpdates: {},
    journeyAction: { type: 'none', journey: null },
    suggestedActions: [],
  };
}

export async function runThongthaiBrain(
  req: BrainRequest,
  communityOfferings: VerifiedCommunityOffering[],
  messages: ChatTurn[],
): Promise<BrainResponse> {
  const systemPrompt = buildBrainPrompt(req, communityOfferings);
  let raw = await callPreferredModel(systemPrompt, messages);

  try {
    const parsed = validateBrainResponse(JSON.parse(stripCodeFences(raw)));
    const adapted = adaptResponseForChannel(parsed, req);
    console.log(
      'THONGTHAI_BRAIN_DECISION',
      THONGTHAI_BRAIN_VERSION,
      channelFromSection(req.pageContext.section),
      adapted.intent,
      adapted.journeyAction.type,
    );
    return adapted;
  } catch (firstError) {
    const repairMessages: ChatTurn[] = [
      ...messages,
      { role: 'assistant', content: raw },
      {
        role: 'user',
        content: `Your previous response was invalid: ${(firstError as Error).message}. Return ONLY a corrected JSON object matching the required schema.`,
      },
    ];

    raw = await callPreferredModel(systemPrompt, repairMessages);
    const parsed = validateBrainResponse(JSON.parse(stripCodeFences(raw)));
    const adapted = adaptResponseForChannel(parsed, req);
    console.log(
      'THONGTHAI_BRAIN_DECISION_REPAIRED',
      THONGTHAI_BRAIN_VERSION,
      channelFromSection(req.pageContext.section),
      adapted.intent,
      adapted.journeyAction.type,
    );
    return adapted;
  }
}
