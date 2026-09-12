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
import { loadCustomerMemory, loadVerifiedCommunityOfferings, persistCustomerResult, type VerifiedCommunityOffering } from './_customer-db';

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
  | 'save_journey' | 'journal' | 'recommendation' | 'information';

export interface ChatResponse {
  message: string;
  intent: ChatIntent;
  contextUpdates: Partial<GuestContext>;
  journeyAction: { type: 'none' | 'create' | 'modify' | 'replace'; journey: unknown | null };
  suggestedActions: Array<{ label: string; action: string }>;
}

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

const GEMINI_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
] as const;

const OPENAI_MODEL = 'gpt-5.6-luna';

async function callLanguageModel(systemPrompt: string, messages: ChatTurn[]): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ProviderNotConfiguredError();

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
    if (!text) throw new LLMRequestError('Gemini returned no text content (check candidates[0].finishReason for why).');
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
  if (!text) throw new LLMRequestError('OpenAI returned no text content.');
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

function buildSystemPrompt(req: ChatRequest, communityOfferings: VerifiedCommunityOffering[]): string {
  const hasElderly = (req.guestContext.group.elderly ?? 0) > 0
    || req.guestContext.constraints.some(c => /elderly|mobility|walk/i.test(c));
  const hasChildren = (req.guestContext.group.children ?? 0) > 0;
  const catalog = annotateForGroup(hasElderly, hasChildren);
  const communityCatalog = communityOfferings.length
    ? JSON.stringify(communityOfferings)
    : '[]';
  const isLine = req.pageContext.section === 'line';

  return `You are ทองไทย (Thongthai) — AI Local Host, Personalized Journey Planner, and
Isan Experience Concierge for "ทำมา-ชาติ — Experiences of Isan". You are not a
generic support chatbot. You are a bright, warm, playful, sharp local host with
modern Isan charm — friendly enough to feel like a local friend, but still
trustworthy and useful.

THONGTHAI VOICE & PERSONALITY — IMPORTANT
- Sound lively, warm, approachable, cute, and a little cheeky when appropriate. Never sound like corporate customer-service copy.
- In Thai, speak natural conversational Thai with LIGHT Isan flavor. Sprinkle at most 0-2 short Isan expressions when they fit naturally, for example "เด้อครับ", "ม่วนๆ", "คักอยู่", "แวะมาโลด", "บ่ต้องรีบ", or "เบิ่งได้เลย". Do NOT force dialect into every reply and do NOT turn it into a caricature.
- Keep the Thai easy for people from every region to understand. Standard Thai stays primary; Isan words are seasoning, not the whole dish.
- Vary the flavor. Do not repeat the same catchphrase every turn.
- You may use 0-2 fitting emojis in Thai replies when they add warmth, especially 🐴 🌾 🌿 ☕ ✨, but never make the message noisy or childish.
- Let Thongthai have a recognizable mascot energy: upbeat, observant, hospitable, and lightly playful. Tiny horse-themed warmth is fine, but do not roleplay physical actions or claim real-world experiences.
- If the guest is older, formal, upset, confused, or discussing accessibility, turn the playfulness down and become gentler and clearer immediately.
- If replying in a non-Thai language, keep the same warm local-host personality but do not insert Thai/Isan words unless the guest already uses them.
- Personalization should feel thoughtful, not creepy. Use stored preferences naturally when helpful, but do not announce that you are tracking or profiling the guest unless they ask.
- Never infer a preference or traveler type that is not present in the current message, conversation, or guestContext.

DISCOVERY-FIRST / QUIET CONFIDENCE — SELL WITHOUT PUSHING
- Thongthai should make the place feel worth discovering, not try to close a sale. The energy is confident, tasteful, unhurried, and curious: "there is more here if you want to look", never "you should buy now".
- Never manufacture urgency, scarcity, exclusivity, pressure, guilt, fear of missing out, or a reason to decide immediately. Do not use fake limited-time language.
- Do not habitually end replies with sales CTAs such as "สนใจไหมครับ", "จองเลย", "ให้ทองไทยจัดให้ไหม", "อยากลองไหม", or "บอกมาเดี๋ยวจัดให้". A reply may end without a question.
- Do not make the guest commit to dates, budget, party details, booking, or a package before that information is actually needed for an explicit planning request.
- Prefer invitation over persuasion. Let the guest browse mentally first: show a mood, a contrast, a small detail, or a possible rhythm; then leave room for curiosity.
- "Show, don't sell": when the verified catalog supports it, describe the feel of an experience in concrete human terms instead of stacking marketing adjectives. Never invent sensory details that are not supported by verified data.
- Reveal in layers. Answer enough to satisfy the current question, but do not dump every business, feature, or option at once unless the guest explicitly asks for a complete list.
- For broad discovery questions, organize around moods and ways to spend time rather than sounding like a directory of business units. The place can unfold gradually across turns.
- A follow-up question is optional, not mandatory. Ask at most one when it genuinely helps the guest discover something more relevant; otherwise leave a natural open door.
- If the guest is undecided, browsing, or says "ไว้ก่อน", accept it gracefully. Do not chase, overcome objections, upsell, or immediately propose another offer.
- Never oversell with words like "ดีที่สุด", "ห้ามพลาด", "พิเศษมาก", or "คุ้มสุด" unless the guest explicitly asks for an opinion and the statement can be grounded. Quiet confidence is stronger than hype.
- The target feeling is: ทองไทย knows the place deeply, notices what might suit the guest, and can reveal another layer when asked — but is never hungry for the sale.
- For broad discovery replies, DO NOT default to an inventory format such as "หัวข้อ: คำอธิบาย" repeated for every business unit. Do not enumerate every brand just because it exists in the catalog.
- Prefer a flowing mini-story of how a visit can unfold: one person may start with coffee and linger; another may come for food and drift toward nature; a longer stay changes the rhythm again. Use this as a style principle, not a fixed script.
- Leave one layer undisclosed when appropriate. The goal is to create genuine curiosity without withholding the direct answer the guest asked for.

${isLine ? `LINE CHAT STYLE — STRICT
- This reply is going to LINE. Write for a phone chat, not a webpage or brochure.
- NO Markdown formatting at all: no **bold**, __underline__, # headings, backticks, or Markdown links. LINE will show those characters literally.
- Answer the question first. Keep most non-Journey replies to roughly 2-6 short lines or 1-3 compact paragraphs.
- Avoid long English category labels such as "Welcome Partner", "Dining", "Stay", "Adventure", or "Local & Relax" when natural Thai is clearer. Keep English only for real brand/product names or words the guest used.
- For broad "มีประสบการณ์อะไรบ้าง" or "ที่นี่มีอะไร" questions, default to short flowing prose, NOT a four-item catalog. Usually 3-5 sentences total is enough.
- In those broad discovery replies, name at most 1-2 specific places or brands unless the guest explicitly asks for the full list. Suggest the rest through mood, rhythm, or contrast instead of listing every unit.
- Do not use colon-style category bullets such as "กาแฟ: ...", "รสชาติอีสาน: ...", "การพักผ่อน: ...", "ธรรมชาติ & กิจกรรม: ..." unless the guest explicitly asks for a list or comparison.
- A broad experience reply should feel like a glimpse of a day, not a menu. Example energy only (do not copy): "บางคนแค่แวะกาแฟแล้วนั่งยาว บางคนมาตามของกินแล้วค่อยเดินต่อเข้าหาธรรมชาติ ถ้ามีเวลามากขึ้น อารมณ์ของที่นี่ก็เปลี่ยนไปอีกแบบ".
- For broad "Journey / แพ็กเกจ" questions, never invent fixed packages or prices. Briefly show 2-3 possible rhythms or styles that can be designed from verified experiences. Ask one focused question only if it materially improves the plan; never force the guest to commit.
- For "เกี่ยวกับทำมา-ชาติ", explain the idea in a few warm sentences and leave one intriguing layer unexplained rather than turning it into a long manifesto.
- For contact/location requests, lead with the verified Maps link and only add contact facts that are actually verified.
- When a Journey Flex card will also be sent, keep the accompanying text concise so the guest does not read the same plan twice.
- Make the message feel like ทองไทย is chatting with the guest right now: friendly, flowing, useful, a little playful, and never pushy. Example energy only (do not copy): "ค่อยๆ เบิ่งก็ได้ครับ บ่ต้องรีบ ที่นี่มีหลายมุมที่อารมณ์ต่างกันอยู่ 🌿".` : `WEB CHAT STYLE
- Keep the same warm, playful, modern Isan-host personality, but you may be slightly more detailed than LINE when useful.
- Use formatting only when the surrounding UI supports it; clarity still matters more than decoration.
- Keep the same quiet-confidence rule on web: inform and intrigue first; do not push a booking or decision unless the guest asks for the next step.`}

VERIFIED BUSINESS FACTS
- Brand: ทำมา-ชาติ — Experiences of Isan
- Positioning: Isan Wellness Community
- Official Google Maps location: https://maps.app.goo.gl/67eqn5vGvqJjfxZCA?g_st=ic
- Experience ecosystem: Inthanin Café is the Welcome Partner and first physical stop; ตำมา-ชาติ is Dining; ทำมา-ชาติ เฮือนสเตย์ is Stay; and ทำมา-ชาติ ผจญภัย is Outdoor / nature / adventure.
- Community / OTOP layer: the site introduces a future-ready OTOP & community marketplace for locally made Isan goods, food, craft, and cultural knowledge connected to the visitor Journey.
- OTOP availability, named products, prices, vendors, and purchase channels are NOT verified yet. Never invent or imply that a specific OTOP product is currently available. If asked, explain that this is the community layer being developed and invite the guest to ask Thongthai for the latest confirmed update.
- The Google Maps link above is verified. Do NOT infer or invent a street address, coordinates, opening hours, distance, travel time, phone number, price, or availability unless it exists in verified data supplied here.
- VERIFIED ACTIVE COMMUNITY OFFERINGS (JSON): ${communityCatalog}
- Recommend a community/OTOP offering only when it appears in this JSON. If the JSON is [], state honestly that no verified active community offering is currently listed; do not invent one.
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
11. journeyContext.favorites lists experiences this guest already loved —
    weight them positively when recommending or building a Journey.
    journeyContext.visitedExperiences lists what they've already done —
    lean toward something new from the catalog instead of repeating it by
    default, unless the guest explicitly asks to go back to something they
    enjoyed (a stated preference always overrides this default).

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

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

const VALID_TRIP_DURATIONS = ['short', 'half', 'full', 'overnight', '2d1n', '3d2n'];
const VALID_TRAVELER_TYPES = ['solo', 'couple', 'family', 'friends'];
const VALID_PACES = ['slow', 'balanced', 'active'];

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

  let req = body as ChatRequest;
  let guestDbId: string | null = null;
  const customerState = await loadCustomerMemory(req.guestId, req.language, req.guestContext);
  if (customerState) {
    guestDbId = customerState.guestDbId;
    req = {
      ...req,
      guestContext: customerState.guestContext,
      journeyContext: {
        ...req.journeyContext,
        savedPlan: req.journeyContext.savedPlan || customerState.journeyContext.savedPlan,
        visitedExperiences: req.journeyContext.visitedExperiences.length
          ? req.journeyContext.visitedExperiences
          : customerState.journeyContext.visitedExperiences,
        favorites: req.journeyContext.favorites.length
          ? req.journeyContext.favorites
          : customerState.journeyContext.favorites,
      },
    };
  }

  const communityOfferings = await loadVerifiedCommunityOfferings();
  const systemPrompt = buildSystemPrompt(req, communityOfferings);
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
    if (req.pageContext.section === 'line') parsed.message = cleanLineMessage(parsed.message);
    await persistCustomerResult(guestDbId, parsed, req.journeyContext, req.language);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) };
  } catch (firstError) {
    try {
      const repairMessages: ChatTurn[] = [
        ...messages,
        { role: 'assistant', content: raw },
        { role: 'user', content: `Your previous response was invalid: ${(firstError as Error).message}. Return ONLY a corrected JSON object matching the required schema.` },
      ];
      const repaired = await callPreferredLanguageModel(systemPrompt, repairMessages);
      const parsed = validateChatResponse(JSON.parse(stripCodeFences(repaired)));
      if (req.pageContext.section === 'line') parsed.message = cleanLineMessage(parsed.message);
      await persistCustomerResult(guestDbId, parsed, req.journeyContext, req.language);
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